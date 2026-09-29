"""Offline regression tests: no HTTP, Supabase or large scan."""
import os
import ast
import re
import sys
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

try:
    import yaml  # noqa: F401
except ImportError:
    sys.modules.setdefault("yaml", types.SimpleNamespace(safe_dump=lambda *a, **k: ""))
from cloud import scan_worker as worker


class FakeEngine:
    @staticmethod
    def safe_public_url(url):
        return url.startswith("https://")

    @staticmethod
    def canon(url):
        return url.split("?")[0]

    @staticmethod
    def candidate_identity(url):
        return url.split("?")[0].removesuffix("/fr")

    @staticmethod
    def dom(url):
        return url.split("/")[2]

    @staticmethod
    def listing_lead_priority(row, profile):
        return 10


class FakeCandidateStore:
    def __init__(self):
        self.saved = {}
        self.source_yield = {}
        self.phase_counts = {}

    def request(self, path, method, rows, prefer):
        for row in rows:
            self.saved.setdefault((row["job_id"], row["identity"]), row)


class WorkerTests(unittest.TestCase):
    def test_page_budget_and_time_never_reject_unexamined(self):
        for cause in ("budget_skip", "time_deferred"):
            decision = {}
            for attempt in range(1, worker.MAX_DEFER_ATTEMPTS + 1):
                status, attempts, deferrals = worker.candidate_outcome({"decision": cause}, decision)
                self.assertEqual(status, "deferred" if attempt < worker.MAX_DEFER_ATTEMPTS else "unexamined")
                self.assertEqual(attempts, 0)
                decision = {"attempts": attempts, "deferrals": deferrals}

    def test_temporary_failure_and_durable_refusal(self):
        self.assertEqual(worker.candidate_outcome({"decision": "protected_access", "fetch": {"http_status": 403}})[0], "unavailable")
        self.assertEqual(worker.candidate_outcome({"decision": "protected_access", "fetch": {"http_status": 429}})[0], "retry")
        self.assertEqual(worker.retry_delay_seconds({"fetch": {"http_status": 429}}, 2), 240)
        self.assertEqual(worker.candidate_outcome({"decision": "retry"}, {"attempts": 2})[0], "unavailable")
        self.assertEqual(worker.candidate_outcome({"decision": "known"})[0], "known")
        self.assertEqual(worker.candidate_outcome({"decision": "filtered"})[0], "filtered")

    def test_domain_suspension_and_periodic_recheck(self):
        now = datetime(2026, 9, 29, 10, 0, tzinfo=timezone.utc)
        health = {}
        for _ in range(3):
            health = worker.update_domain_health(health, "jobs.example.com",
                                                  {"decision": "protected_access"}, now)
        due = datetime.fromisoformat(health["jobs.example.com"]["suspended_until"])
        self.assertEqual((due - now).total_seconds(), 600)
        health = worker.update_domain_health(health, "jobs.example.com",
                                             {"decision": "retained"}, due)
        self.assertNotIn("jobs.example.com", health)

    def test_search_engine_order_keeps_exploration(self):
        tree = ast.parse(Path("stage_hunter.py").read_text(encoding="utf-8"))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == "search_backend_primary_index")
        scope = {}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "stage_hunter.py", "exec"), scope)
        choose = scope["search_backend_primary_index"]
        self.assertEqual([choose(i, 2, {"yahoo": 0.6}) for i in range(1, 9)],
                         [0, 0, 0, 1, 0, 0, 0, 1])
        self.assertEqual([choose(i, 2, {}) for i in range(1, 5)], [0, 1, 0, 1])

    def test_contract_variants_from_reference_log(self):
        tree = ast.parse(Path("stage_hunter.py").read_text(encoding="utf-8"))
        assignment = next(node for node in tree.body if isinstance(node, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == "INTERNSHIP_TITLE_PATTERNS"
                                  for target in node.targets))
        patterns = ast.literal_eval(assignment.value)
        matches = lambda title: any(re.search(pattern, title.lower()) for pattern in patterns)
        self.assertTrue(matches("Praktikanten im Brandschutz (Fire Engineering)"))
        self.assertTrue(matches("Praktikant:in Robotik"))
        self.assertTrue(matches("Digital Analytics Traineeship"))
        self.assertFalse(matches("Senior System Engineer Citrix"))
        self.assertFalse(matches("Dual Student Mechanical Engineering"))

    def test_filter_keeps_useful_listings_and_offers(self):
        self.assertEqual(worker.prefetch_class("https://www.googleadservices.com/pagead/aclk", "Stage")[0], "filtered")
        self.assertEqual(worker.prefetch_class("https://fr.indeed.com/jobs?q=stage", "1 834 emplois Stage")[0], "listing")
        self.assertEqual(worker.prefetch_class("https://jobs.example.com/jobs/search", "Jobs at Example")[0], "listing")
        self.assertEqual(worker.prefetch_class("https://jobs.example.com/job/123456", "Software Engineering Intern")[0], "offer")

    def test_quick_scan_stops_at_persisted_total_budget_without_rejecting_queue(self):
        job = {"mode": "Rapide", "checkpoint": {"telemetry": {"totals": {"pages_fetched": 1000}}}}
        self.assertIn("1000 pages", worker.scan_limit_reached(job))
        job["checkpoint"]["telemetry"]["totals"] = {"pages_fetched": 999, "wall_seconds": 900}
        self.assertIn("900 secondes", worker.scan_limit_reached(job))
        job["checkpoint"]["telemetry"]["totals"] = {"pages_fetched": 999, "wall_seconds": 899}
        self.assertIsNone(worker.scan_limit_reached(job))

        class Store:
            def __init__(self): self.events = []; self.released = None
            def event(self, job, message): self.events.append(message)
        store = Store()
        job["checkpoint"]["telemetry"]["totals"]["pages_fetched"] = 1000
        with patch.object(worker, "release", side_effect=lambda s, j, p, c, n: setattr(store, "released", (p, c))):
            worker.analyze(store, job, None, None)
        self.assertEqual(store.released[0], "finish")
        self.assertIn("partial_reason", store.released[1])
        self.assertIn("restent en attente", store.events[0])
        store.released = None
        with patch.object(worker, "release", side_effect=lambda s, j, p, c, n: setattr(store, "released", (p, c))):
            worker.discover(store, job, None, None)
        self.assertEqual(store.released[0], "finish")

    def test_deduplication_and_resume_after_save(self):
        store = FakeCandidateStore()
        job = {"id": "job-1", "user_id": "user-1"}
        rows = [{"url": "https://jobs.example.com/offer/123?utm_source=x", "title": "Intern"},
                {"url": "https://jobs.example.com/offer/123?utm_source=y", "title": "Intern"}]
        with patch.dict(sys.modules, {"stage_hunter": FakeEngine}):
            worker.candidate_rows(store, job, rows, profile={})
            worker.candidate_rows(store, job, rows, profile={})
        self.assertEqual(len(store.saved), 1)
        self.assertEqual(next(iter(store.saved.values()))["user_id"], "user-1")

    def test_listing_children_are_durable_after_interruption(self):
        audits = [{"decision": "budget_skip", "original_url": "https://jobs.example.com/offer/7", "title": "Intern"},
                  {"decision": "time_deferred", "original_url": "https://jobs.example.com/offer/7", "title": "Intern"}]
        rows = worker.audit_candidate_rows(audits, FakeEngine)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["_candidate_decision"]["status"], "deferred")
        store = FakeCandidateStore()
        with patch.dict(sys.modules, {"stage_hunter": FakeEngine}):
            worker.candidate_rows(store, {"id": "job-1", "user_id": "user-1"}, rows, status="deferred")
            worker.candidate_rows(store, {"id": "job-1", "user_id": "user-1"}, rows, status="deferred")
        self.assertEqual(len(store.saved), 1)

    def test_uncertain_listing_filter_is_reviewable(self):
        rows = worker.audit_candidate_rows([{"decision": "filtered", "reason": "Priorité faible",
                                             "original_url": "https://jobs.example.com/offer/8"}], FakeEngine)
        self.assertEqual(rows[0]["_candidate_decision"]["status"], "filtered")
        self.assertTrue(rows[0]["_candidate_decision"]["reviewable"])

    def test_partial_discovery_does_not_advance_cursor(self):
        class Engine:
            SCAN_METRICS = {"fixed_sites_visited": 1}
            @staticmethod
            def targeted_fixed_urls(profile): return ["https://one.example/jobs", "https://two.example/jobs"]
            @staticmethod
            def build_search_queries(profile, emit_log=False): return []
            @staticmethod
            def safe_int(value, default=0): return int(value or default)
            @staticmethod
            def fixed_site_candidates(profile): return []
        class Store:
            phase_counts = {}
            def __init__(self): self.source_yield = {}; self.checkpoint = None
            def event(self, *args): pass
            def rows(self, *args): return []
        store = Store()
        job = {"id": "job", "user_id": "user", "mode": "Rapide", "batch_size": 2,
               "checkpoint": {"direct_cursor": 0, "web_cursor": 0}}
        with patch.object(worker, "candidate_rows", return_value=0), \
             patch.object(worker, "still_owned", return_value=True), \
             patch.object(worker, "release", side_effect=lambda s, j, p, c, n: setattr(store, "checkpoint", c)):
            worker.discover(store, job, Engine, {})
        self.assertEqual(store.checkpoint["direct_cursor"], 0)
        self.assertEqual(store.checkpoint["retry_delay_seconds"], 30)

    def test_telemetry_aggregates_across_invocations(self):
        store = worker.Store.__new__(worker.Store)
        store.invocation_id = "second"
        store.invocation_started_at = "2026-09-29T10:01:00+00:00"
        store.phase_started = ("analyze", "2026-09-29T10:01:00+00:00", 10.0, 1.0, 2, 30, 40, 1.0)
        store.calls = 4
        store.bytes_sent = 70
        store.bytes_received = 140
        store.seconds = 2.0
        store.engine = None
        store.phase_counts = {"candidates_attempted": 5, "retained": 1}
        checkpoint = {"telemetry": {"last_end": "2026-09-29T10:00:00+00:00",
                                    "last_invocation_id": "first",
                                    "phases": [{"invocation_id": "first", "phase": "discover",
                                                "ended_at": "2026-09-29T10:00:00+00:00"}]}}
        with patch.object(worker.time, "perf_counter", return_value=15.0), patch.object(worker.time, "process_time", return_value=2.0):
            result = worker.record_phase(store, {}, checkpoint)
        self.assertEqual(len(result["telemetry"]["phases"]), 2)
        phase = result["telemetry"]["phases"][1]
        self.assertEqual(phase["gap_since_previous_invocation_seconds"], 60)
        self.assertEqual(phase["supabase_calls"], 3)
        self.assertEqual(phase["candidates_attempted"], 5)
        self.assertEqual(result["telemetry"]["totals"]["supabase_calls"], 3)
        self.assertEqual(result["telemetry"]["invocations"], 1)

    def test_telemetry_totals_survive_detail_limit(self):
        store = worker.Store.__new__(worker.Store)
        store.invocation_id = "new"
        store.invocation_started_at = "2026-09-29T10:01:00+00:00"
        store.phase_started = ("analyze", "2026-09-29T10:01:00+00:00", 10.0, 1.0, 2, 0, 0, 0.0)
        store.calls, store.bytes_sent, store.bytes_received, store.seconds = 3, 0, 0, 0.0
        store.engine = None
        store.phase_counts = {}
        old = {"invocation_id": "old", "phase": "analyze", "ended_at": "2026-09-29T10:00:00+00:00"}
        checkpoint = {"telemetry": {"last_end": old["ended_at"], "last_invocation_id": "old",
                                    "phases": [old] * 200, "totals": {"supabase_calls": 1000},
                                    "invocations": 5}}
        with patch.object(worker.time, "perf_counter", return_value=11.0), \
             patch.object(worker.time, "process_time", return_value=2.0):
            result = worker.record_phase(store, {}, checkpoint)
        self.assertEqual(len(result["telemetry"]["phases"]), 200)
        self.assertEqual(result["telemetry"]["totals"]["supabase_calls"], 1002)
        self.assertEqual(result["telemetry"]["invocations"], 6)

    def test_checkpoint_telemetry_remains_compact(self):
        phase = {"invocation_id": "small", "phase": "analyze", "wall_seconds": 2.5,
                 "supabase_calls": 4, "bytes_downloaded": 10000,
                 "http_errors_by_domain": {"example.com": {"403": 1}}}
        checkpoint = {"telemetry": {"phases": [phase] * 107}}
        self.assertLess(worker.payload_bytes(checkpoint), 50000)

    def test_batch_decisions_are_lease_guarded(self):
        class Store:
            def rpc(self, name, body):
                self.name, self.body = name, body
                return 1
            def rows(self, *args): return []
        store = Store()
        job = {"id": "job", "lease_token": "lease"}
        change = {"id": 1, "status": "deferred", "decision": {}, "next_attempt_at": worker.utc_now()}
        worker.apply_decisions(store, job, [change])
        self.assertEqual(store.name, "hunter_apply_scan_decisions")
        self.assertEqual(store.body["p_lease_token"], "lease")
        with self.assertRaises(RuntimeError):
            worker.apply_decisions(store, job, [change, {**change, "id": 2}])

    def test_cancel_during_release_and_expired_lease(self):
        class Store:
            phase_started = None
            def __init__(self, token, cancelled):
                self.token, self.cancelled, self.patches = token, cancelled, []
            def rpc(self, *args): return False
            def rows(self, *args):
                return [{"lease_token": self.token, "cancel_requested": self.cancelled,
                         "status": "running"}]
            def patch(self, table, query, body): self.patches.append(body)
        job = {"id": "job", "lease_token": "lease"}
        cancelled = Store("lease", True)
        with self.assertRaises(worker.ScanCancelled):
            worker.release(cancelled, job, "analyze", {}, 50)
        self.assertEqual(cancelled.patches[0]["status"], "cancelled")
        expired = Store("new-lease", False)
        with self.assertRaises(RuntimeError):
            worker.release(expired, job, "analyze", {}, 50)
        self.assertEqual(expired.patches, [])

    def test_expired_lease_stops_before_work(self):
        class Store:
            def rows(self, *args):
                return [{"lease_token": "lease", "lease_until": "2020-01-01T00:00:00+00:00",
                         "cancel_requested": False, "status": "running"}]
        self.assertFalse(worker.still_owned(Store(), {"id": "job", "lease_token": "lease"}))

    def test_error_mid_batch_keeps_checkpoint_for_retry(self):
        class Store:
            def __init__(self): self.released = []
            def rows(self, table, query):
                if "cancel_requested=eq.true" in query or "status=eq.completed" in query: return []
                return [{"lease_token": "lease", "lease_until": "2099-01-01T00:00:00+00:00", "cancel_requested": False, "status": "running"}]
            def rpc(self, name, body):
                if name == "hunter_claim_scan_job":
                    return [{"id": "job", "user_id": "user", "profile_id": "profile",
                             "mode": "Rapide", "phase": "discover", "checkpoint": {"profile_config": {}},
                             "lease_token": "lease", "progress_percent": 12}]
                return True
            def begin_phase(self, *args): pass
            def event(self, *args): pass
        store = Store()
        with patch.object(worker, "Store", return_value=store), \
             patch.object(worker, "prepare_engine", return_value=(types.SimpleNamespace(RUN_STARTED=0), {})), \
             patch.object(worker, "discover", side_effect=RuntimeError("middle of batch")), \
             patch.object(worker, "release", side_effect=lambda s, j, p, c, n: store.released.append(c)):
            with self.assertRaisesRegex(RuntimeError, "middle of batch"):
                worker._run_slice("job")
        self.assertEqual(store.released[0]["failure_streak"], 1)

    def test_single_invocation_can_cross_all_phases(self):
        class Store:
            def __init__(self):
                self.jobs = [make_job("discover"), make_job("analyze"), make_job("finish")]
                self.current = {"status": "queued", "cancel_requested": False, "lease_token": None}
                self.patches = []
            def rows(self, table, query):
                if "cancel_requested=eq.true" in query or "status=eq.completed" in query:
                    return []
                if "select=lease_token" in query:
                    return [{"lease_token": "lease", "lease_until": "2099-01-01T00:00:00+00:00", "cancel_requested": False, "status": "running"}]
                return [self.current]
            def rpc(self, name, body):
                return [self.jobs.pop(0)] if self.jobs else []
            def begin_phase(self, *args):
                pass
            def patch(self, table, query, body):
                self.patches.append(body)
        def make_job(phase):
            return {"id": "job", "user_id": "user", "profile_id": "profile", "phase": phase,
                    "mode": "Rapide", "checkpoint": {"profile_config": {}},
                    "lease_token": "lease", "progress_percent": 30}
        store = Store()
        phases = []
        clock = [0.0]
        def run_phase(name):
            phases.append(name)
            clock[0] += 1
        with patch.object(worker, "Store", return_value=store), \
             patch.object(worker, "prepare_engine", return_value=(types.SimpleNamespace(RUN_STARTED=0), {})), \
             patch.object(worker, "discover", side_effect=lambda *a: run_phase("discover")), \
             patch.object(worker, "analyze", side_effect=lambda *a: run_phase("analyze")), \
             patch.object(worker, "finish", side_effect=lambda *a: run_phase("finish")), \
             patch.object(worker.time, "perf_counter", side_effect=lambda: clock[0]), \
             patch.dict(os.environ, {"SCAN_INVOCATION_BUDGET_SECONDS": "60"}):
            result = worker._run_slice("job")
        self.assertEqual(phases, ["discover", "analyze", "finish"])
        self.assertEqual(result["batches"], 3)

    def test_dispatcher_keeps_one_profile_per_invocation(self):
        class Store:
            def __init__(self): self.claim_args = []
            def rows(self, table, query):
                if "cancel_requested=eq.true" in query or "status=eq.completed" in query: return []
                if "select=lease_token" in query:
                    return [{"status": "running", "cancel_requested": False, "lease_token": "lease", "lease_until": "2099-01-01T00:00:00+00:00"}]
                return [{"status": "queued", "cancel_requested": False, "lease_token": None}]
            def rpc(self, name, body):
                self.claim_args.append(body["p_job_id"])
                if len(self.claim_args) == 1:
                    return [{"id": "job-one", "user_id": "user-one", "profile_id": "profile-one",
                             "phase": "discover", "mode": "Rapide", "checkpoint": {"profile_config": {}},
                             "lease_token": "lease", "progress_percent": 10}]
                return []
            def begin_phase(self, *args): pass
        store = Store()
        with patch.object(worker, "Store", return_value=store), \
             patch.object(worker, "prepare_engine", return_value=(types.SimpleNamespace(RUN_STARTED=0), {})), \
             patch.object(worker, "discover"), \
             patch.dict(os.environ, {"SCAN_INVOCATION_BUDGET_SECONDS": "60"}):
            worker._run_slice()
        self.assertEqual(store.claim_args, [None, "job-one"])

    def test_timeout_margin_stops_before_next_batch(self):
        class Store:
            def __init__(self): self.claims = 0
            def rows(self, table, query):
                if "cancel_requested=eq.true" in query or "status=eq.completed" in query: return []
                if "select=lease_token" in query:
                    return [{"lease_token": "lease", "lease_until": "2099-01-01T00:00:00+00:00", "cancel_requested": False, "status": "running"}]
                return [{"status": "queued", "cancel_requested": False, "lease_token": None}]
            def rpc(self, name, body):
                self.claims += 1
                return [{"id": "job", "user_id": "user", "profile_id": "profile", "phase": "discover",
                         "mode": "Rapide", "checkpoint": {"profile_config": {}}, "lease_token": "lease",
                         "progress_percent": 10}]
            def begin_phase(self, *args): pass
        store = Store()
        clock = [0.0]
        def discover(*args): clock[0] = 20.0
        with patch.object(worker, "Store", return_value=store), \
             patch.object(worker, "prepare_engine", return_value=(types.SimpleNamespace(RUN_STARTED=0), {})), \
             patch.object(worker, "discover", side_effect=discover), \
             patch.object(worker.time, "perf_counter", side_effect=lambda: clock[0]), \
             patch.dict(os.environ, {"SCAN_INVOCATION_BUDGET_SECONDS": "60"}):
            result = worker._run_slice("job")
        self.assertEqual(result["batches"], 1)
        self.assertEqual(store.claims, 1)

    def test_final_summary_separates_terminal_states(self):
        phase = {"invocation_id": "first", "phase": "analyze", "wall_seconds": 2,
                 "active_seconds": 1, "cpu_seconds": 0.5, "network_seconds": 1,
                 "supabase_seconds": 0.2, "gap_since_previous_invocation_seconds": 0,
                 "supabase_calls": 4, "supabase_bytes_sent": 100, "supabase_bytes_received": 200,
                 "bytes_downloaded": 500, "candidates_attempted": 5}
        class Store:
            phase_started = None
            def __init__(self): self.summary = None
            def rows(self, table, query):
                if table == "hunter_offers": return [{"id": 1}]
                return [{"status": state, "decision": {}, "payload": {"source": "example.com"}}
                        for state in ("accepted", "rejected", "deferred", "unavailable", "unexamined")]
            def patch(self, table, query, body): self.summary = body["summary"]
            def event(self, *args): pass
        store = Store()
        job = {"id": "job", "user_id": "user", "profile_id": "profile", "lease_token": "lease",
               "created_at": "2026-09-29T10:00:00+00:00", "checkpoint": {"telemetry": {"phases": [phase]}}}
        with patch.object(worker, "release"), patch.object(worker, "still_owned", return_value=True):
            worker.finish(store, job)
        self.assertEqual(store.summary["new"], 1)
        self.assertEqual(store.summary["rejected"], 1)
        self.assertEqual(store.summary["deferred"], 2)
        self.assertEqual(store.summary["temporarily_unavailable"], 1)
        self.assertEqual(store.summary["metrics"]["cloud"]["totals"]["supabase_calls"], 4)


if __name__ == "__main__":
    unittest.main()

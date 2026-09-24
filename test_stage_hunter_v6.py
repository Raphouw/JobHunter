import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import stage_hunter as hunter
import stage_hunter_scheduler as scheduler
import connectors
import regions


ROOT = Path(__file__).resolve().parent


class StageHunterV6Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.france = hunter.load_profile("exemple-france")
        cls.raphael = hunter.load_profile("raphael")

    def test_source_packs_are_merged_into_profile(self):
        self.assertGreater(len(self.france["_source_pack_domains"]), 10)
        self.assertGreater(len(self.france["_source_pack_urls"]), 5)
        self.assertIn("francetravail.fr", self.france["_source_pack_domains"])

    def test_geographic_pack_outside_profile_country_is_ignored(self):
        original = ROOT / "config" / "profiles" / "_test_country_filter.yaml"
        original.write_text("""id: country-filter\nlocation:\n  countries: [France]\nsources:\n  packs: [france, switzerland]\n""", encoding="utf-8")
        try:
            profile = hunter.load_profile(original)
        finally:
            original.unlink(missing_ok=True)
        self.assertIn("francetravail.fr", profile["_source_pack_domains"])
        self.assertNotIn("jobs.ch", profile["_source_pack_domains"])

    def test_profiles_use_separate_output_directories(self):
        hunter.configure_runtime(self.france)
        self.assertEqual(hunter.DB.parent.name, "exemple-france")
        hunter.configure_runtime(self.raphael)
        self.assertEqual(hunter.DB.parent.name, "raphael")

    def test_search_region_follows_profile_country(self):
        with patch.dict(os.environ, {"SEARCH_REGION": ""}, clear=False):
            self.assertEqual(hunter.preferred_search_region(self.france), "fr-fr")
            self.assertEqual(hunter.preferred_search_region(self.raphael), "ch-fr")

    def test_france_region_is_formatted_from_city(self):
        meta = hunter.detect_meta(
            "Technicien instrumentation",
            "Poste basé à Annecy, en France. Français et anglais.",
            self.france,
            "Annecy, France",
        )
        self.assertEqual(meta[1], "Haute-Savoie | 74 | FR")
        self.assertEqual(meta[2], "Français")

    def test_simple_priority_location_is_also_detected(self):
        profile = {
            "location": {
                "countries": ["France"],
                "priority_locations": ["Grenoble"],
                "acceptable_language": ["fr"],
            }
        }
        meta = hunter.detect_meta("Chef de projet", "Poste à Grenoble", profile)
        self.assertEqual(meta[1], "Grenoble")

    def test_structured_foreign_location_is_rejected(self):
        meta = hunter.detect_meta("Automation Engineer", "PLC automation", self.france, "Austin, United States")
        reason = hunter.eligibility_rejection(
            "Automation Engineer",
            "PLC automation industrial production",
            meta,
            self.france,
            {"location": "Austin, United States"},
        )
        self.assertIn("hors pays ciblé", reason)

    def test_target_country_location_is_not_rejected(self):
        meta = hunter.detect_meta("Ingénieur automatisme", "Automatisme et capteurs", self.france, "Lyon, France")
        reason = hunter.eligibility_rejection(
            "Ingénieur automatisme",
            "Automatisme industriel, capteurs et production",
            meta,
            self.france,
            {"location": "Lyon, France"},
        )
        self.assertEqual(reason, "")

    def test_job_profile_generates_contract_queries(self):
        profile = dict(self.france)
        profile["search"] = dict(profile["search"], queries=[], auto_query_limit=6)
        profile["_source_pack_queries"] = []
        profile["sources"] = {"custom_queries": []}
        with patch.dict(os.environ, {"AUTO_QUERY_LIMIT": "6"}, clear=False):
            queries = hunter.build_search_queries(profile)
        self.assertEqual(len(queries), 6)
        self.assertTrue(any("CDI" in query for query in queries))
        self.assertFalse(any(" internship " in f" {query.lower()} " for query in queries))

    def test_internship_profile_generates_multilingual_queries(self):
        profile = dict(self.raphael)
        profile["search"] = dict(profile["search"], queries=[], auto_query_limit=3)
        profile["_source_pack_queries"] = []
        profile["sources"] = {"custom_queries": []}
        with patch.dict(os.environ, {"SEARCH_QUERY_BUDGET": "6"}, clear=False):
            queries = hunter.build_search_queries(profile)
        joined = "\n".join(queries).lower()
        self.assertIn("internship", joined)
        self.assertIn("stage", joined)
        self.assertIn("praktikum", joined)

    def test_profile_words_are_combined_for_employment(self):
        profile = dict(self.france)
        profile["target"] = {"job_titles": ["ingénieur"]}
        profile["skills"] = {"core": [], "strong_domains": ["R&D"]}
        profile["interests"] = {"very_high": [], "high": []}
        profile["_source_pack_domains"] = []
        profile["_source_pack_queries"] = []
        with patch.dict(os.environ, {"SEARCH_QUERY_BUDGET": "10"}, clear=False):
            queries = hunter.build_search_queries(profile, emit_log=False)
        self.assertTrue(any("emploi R&D ingénieur France" == query for query in queries))

    def test_multiple_countries_generate_country_specific_queries(self):
        profile = dict(self.france)
        profile["location"] = dict(profile["location"], countries=["France", "Belgium"])
        profile["_source_pack_domains"] = []
        with patch.dict(os.environ, {"SEARCH_QUERY_BUDGET": "30"}, clear=False):
            queries = hunter.build_search_queries(profile, emit_log=False)
        joined = "\n".join(queries)
        self.assertIn("France", joined)
        self.assertIn("Belgique", joined)

    def test_closed_application_message_is_detected(self):
        closed, reason = hunter.application_is_closed(
            "Embedded Systems Intern",
            "Les candidatures ne sont plus acceptées pour cette offre.",
        )
        self.assertTrue(closed)
        self.assertTrue(reason)

    def test_hidden_closed_phrase_does_not_override_apply_button(self):
        html = """<html><script>const translation='no longer accepting applications';</script>
        <main><h1>Embedded Systems Intern</h1><a href='/apply'>Apply now</a></main></html>"""
        status, reason, confidence = hunter.application_availability(
            "Embedded Systems Intern", html, html, {}
        )
        self.assertEqual(status, "open")
        self.assertIn("Bouton", reason)
        self.assertGreater(confidence, 80)

    def test_old_posting_is_not_closed_without_proof(self):
        status, reason, _ = hunter.application_availability(
            "Automation Intern", "Posted 5 months ago. Automation and sensors.", "", {}
        )
        self.assertEqual(status, "unknown")
        self.assertIn("ancienne", reason)

    def test_listing_extracts_individual_offer_links(self):
        html = """
        <html><body>
          <article><h2>Embedded Systems Intern</h2><a href="/jobs/123">Voir l'offre</a></article>
          <article><h2>Automation Engineer</h2><a href="https://example.org/jobs/456">Apply</a></article>
        </body></html>
        """
        leads = hunter.discover_listing_leads("https://example.org/jobs", html)
        self.assertEqual({lead["title"] for lead in leads}, {"Embedded Systems Intern", "Automation Engineer"})
        self.assertTrue(all(lead["url"].startswith("https://example.org/jobs/") for lead in leads))

    def test_listing_extracts_embedded_ats_json(self):
        html = """<html><script type="application/json">{
          "jobs":[{"jobTitle":"Firmware Engineering Intern","externalPath":"/jobs/REQ-123456",
          "companyName":"Example AG","locationName":"Zurich"}]}</script></html>"""
        leads = hunter.discover_listing_leads("https://example.org/careers", html)
        self.assertEqual(len(leads), 1)
        self.assertEqual(leads[0]["company"], "Example AG")
        self.assertEqual(leads[0]["url"], "https://example.org/jobs/REQ-123456")

    def test_studentship_is_an_internship_signal(self):
        self.assertTrue(hunter.internship_signal("Technical Studentship - Electrical Engineering", ""))
        self.assertTrue(hunter.internship_signal("Master Thesis - Embedded Sensors", ""))

    def test_partial_direct_career_page_from_listing_is_kept_as_offer(self):
        kind, reason = hunter.classify_with_reason(
            "https://careers.example.org/jobs/embedded-control-engineer-123456",
            "Embedded Control Engineer",
            "",
            "<html><title>Embedded Control Engineer</title></html>",
            self.raphael,
            candidate_hint=True,
        )
        self.assertEqual(kind, "offer")
        self.assertTrue(reason)

    def test_detail_url_with_language_parameter_is_not_a_listing(self):
        reason = hunter.listing_reason(
            "https://careers.example.org/jobs/embedded-intern-123456?lang=en",
            "Embedded Systems Intern",
        )
        self.assertEqual(reason, "")

    def test_fixed_urls_receive_profile_keywords(self):
        urls = hunter.targeted_fixed_urls(self.raphael)
        jobs_url = next(url for url in urls if "jobs.ch" in url)
        linkedin_url = next(url for url in urls if "linkedin.com" in url)
        self.assertIn("term=", jobs_url)
        self.assertIn("keywords=", linkedin_url)
        self.assertIn("location=Switzerland", linkedin_url)

    def test_employment_profile_skips_internship_only_fixed_page(self):
        profile = dict(self.france)
        profile["_source_pack_urls"] = [
            "https://www.iagora.com/work/en/jobs-and-internships/internships/france",
            "https://www.linkedin.com/jobs/search/?location=France",
        ]
        urls = hunter.targeted_fixed_urls(profile)
        self.assertFalse(any("/internships/" in url for url in urls))
        self.assertTrue(any("linkedin.com" in url for url in urls))

    def test_source_metrics_rank_productive_fixed_site_first(self):
        previous_db = hunter.DB
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            hunter.DB = Path(directory) / "stage_hunter.sqlite3"
            connection = hunter.init_db()
            try:
                hunter.record_source_metric(connection, "good.example", "outcome", retained=5)
                hunter.record_source_metric(connection, "empty.example", "fixed", attempts=8)
                connection.commit()
                ranked = hunter.rank_fixed_urls(connection, [
                    "https://empty.example/jobs", "https://new.example/jobs", "https://good.example/jobs"
                ])
            finally:
                connection.close()
                hunter.DB = previous_db
        self.assertEqual(ranked[0], "https://good.example/jobs")
        self.assertEqual(ranked[-1], "https://empty.example/jobs")

    def test_no_results_exception_does_not_retry_when_disabled(self):
        calls = []

        class EmptySearch:
            def __init__(self, *args, **kwargs):
                pass
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def text(self, *args, **kwargs):
                calls.append(kwargs.get("backend"))
                raise Exception("No results found")

        previous = hunter.ACTIVE_PROFILE
        hunter.ACTIVE_PROFILE = {"search": {"retry_empty_results": False}, "location": {"countries": ["Switzerland"]}}
        try:
            with patch.object(hunter, "DDGS", EmptySearch), patch.dict(os.environ, {
                "SEARCH_RETRIES": "1", "SEARCH_WORKERS": "1", "SEARCH_DELAY_MIN": "0",
                "SEARCH_DELAY_MAX": "0", "SEARCH_RETRY_BACKOFF": "0.1",
            }, clear=False):
                self.assertEqual(hunter.search_web(["internship sensors Switzerland"], 5), [])
        finally:
            hunter.ACTIVE_PROFILE = previous
        self.assertEqual(len(calls), 1)

    def test_search_backend_trace_keeps_exact_exception_type(self):
        class BrokenSearch:
            def __init__(self, *args, **kwargs):
                pass
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def text(self, *args, **kwargs):
                raise TimeoutError("engine timed out")

        with patch.object(hunter, "DDGS", BrokenSearch):
            results, trace = hunter.search_backend_once("internship sensors", "duckduckgo", 5, "ch-fr", 5)
        self.assertEqual(results, [])
        self.assertEqual(trace["status"], "error")
        self.assertEqual(trace["error_type"], "TimeoutError")
        self.assertIn("timed out", trace["error_message"])

    def test_unknown_ddgs_backends_cannot_silently_fall_back_to_auto(self):
        resolved, ignored, migrated = hunter.normalize_search_backends([
            "bing", "yandex", "duckduckgo", "duckduckgo"
        ])
        self.assertEqual(resolved, ["yahoo", "duckduckgo"])
        self.assertEqual(ignored, ["yandex"])
        self.assertEqual(migrated, [("bing", "yahoo")])

        with patch.object(hunter, "DDGS") as mocked:
            results, trace = hunter.search_backend_once("stage ingénieur", "yandex", 5, "ch-fr", 5)
        mocked.assert_not_called()
        self.assertEqual(results, [])
        self.assertEqual(trace["status"], "invalid_backend")

    def test_legacy_default_backends_are_upgraded_without_editing_env(self):
        with patch.dict(os.environ, {"SEARCH_BACKENDS": "duckduckgo,brave"}, clear=False):
            resolved, ignored, migrated, legacy = hunter.configured_search_backends()
        self.assertEqual(resolved, ["duckduckgo", "yahoo"])
        self.assertEqual(ignored, [])
        self.assertEqual(migrated, [])
        self.assertTrue(legacy)

    def test_search_ads_are_filtered_before_page_download(self):
        status = hunter.search_result_filter_status(
            "https://www.bing.com/aclick?ld=tracking&u=advertisement"
        )
        self.assertEqual(status, "Lien publicitaire ignoré")

    def test_listing_noise_filters_app_stores_and_indeed_promotions(self):
        self.assertTrue(hunter.listing_lead_is_noise(
            "https://apps.apple.com/ch/app/jobup/id123456", "Télécharger l'application"
        ))
        self.assertTrue(hunter.listing_lead_is_noise(
            "https://ch.indeed.com/career/software-engineer/salaries", "Salaire Software Engineer"
        ))
        self.assertFalse(hunter.listing_lead_is_noise(
            "https://ch.indeed.com/rc/clk?jk=abc123", "Embedded Systems Intern"
        ))

    def test_known_job_board_detail_urls_are_recognized(self):
        urls = [
            "https://www.internshipdaily.com/internship/embedded-systems-intern-zurich",
            "https://www.iagora.com/work/en/offer/internship/switzerland/robotics/123456",
            "https://www.glassdoor.ch/partner/jobListing.htm?pos=101&ao=123",
            "https://ch.indeed.com/rc/clk?jk=abc123",
        ]
        for url in urls:
            with self.subTest(url=url):
                self.assertTrue(hunter.offer_url_signal(url))

    def test_indeed_country_search_page_is_a_listing(self):
        reason = hunter.listing_reason(
            "https://ch-fr.indeed.com/q-stage-ingénieur-suisse-emplois.html?vjk=123",
            "Stage Ingénieur Suisse : plus de 25 emplois",
        )
        self.assertIn("Indeed", reason)

    def test_debug_web_search_exposes_raw_results_without_full_scan(self):
        class ProductiveSearch:
            def __init__(self, *args, **kwargs):
                pass
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def text(self, query, **kwargs):
                return [{
                    "title": "Embedded Systems Intern",
                    "href": "https://careers.example.com/jobs/embedded-intern-123456",
                    "body": "Sensors and firmware internship in Switzerland",
                }]

        with patch.object(hunter, "DDGS", ProductiveSearch):
            report = hunter.debug_web_search(
                self.raphael, "internship embedded systems Switzerland",
                ["duckduckgo"], limit=5, timeout=5, inspect_pages=False,
            )
        self.assertEqual(report["summary"]["raw_results"], 1)
        self.assertEqual(report["summary"]["unique_valid_links"], 1)
        self.assertEqual(report["results"][0]["filter_status"], "URL exploitable")

    def test_debug_engine_valid_count_is_not_changed_by_cross_engine_deduplication(self):
        class DuplicateSearch:
            def __init__(self, *args, **kwargs): pass
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def text(self, query, **kwargs):
                return [{"title": "Embedded Intern", "href": "https://example.com/jobs/123456", "body": "Internship"}]

        with patch.object(hunter, "DDGS", DuplicateSearch):
            report = hunter.debug_web_search(
                self.raphael, "internship embedded systems Switzerland",
                ["duckduckgo", "yahoo"], limit=5, timeout=5, inspect_pages=False,
            )
        self.assertEqual([item["valid_links"] for item in report["engines"]], [1, 1])
        self.assertEqual([item["new_unique_links"] for item in report["engines"]], [1, 0])

    def test_debug_web_search_follows_listing_into_offer_pages(self):
        listing_url = "https://example.com/jobs?q=internship"
        offer_url = "https://example.com/jobs/embedded-intern-123456"
        listing_html = f"""<html><body><h1>10 internships</h1><article>
        <h2>Embedded Systems Intern</h2><a href="{offer_url}">Apply</a>
        </article></body></html>"""
        offer_html = """<html><body><h1>Embedded Systems Intern</h1>
        <p>Internship in Switzerland. Sensors, firmware and embedded systems.</p>
        <h2>Your profile</h2><p>Electronics engineering student.</p><a href='/apply'>Apply now</a>
        </body></html>"""

        class ListingSearch:
            def __init__(self, *args, **kwargs): pass
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def text(self, query, **kwargs):
                return [{"title": "10 internships in Switzerland", "href": listing_url, "body": "Engineering internships"}]

        def fake_pages(rows, label="HTTP"):
            output = []
            for row in rows:
                html = offer_html if row["url"] == offer_url else listing_html
                output.append((row, html, html, row["url"]))
            return output

        with patch.object(hunter, "DDGS", ListingSearch), patch.object(hunter, "iter_parallel_pages", fake_pages):
            report = hunter.debug_web_search(
                self.raphael, "internship embedded systems Switzerland",
                ["duckduckgo"], limit=5, timeout=5, inspect_pages=True,
            )
        self.assertGreaterEqual(report["summary"]["listing_leads_found"], 1)
        self.assertEqual(report["summary"]["listing_offers_checked"], 1)
        self.assertEqual(report["listing_page_checks"][0]["url"], offer_url)

    def test_candidate_rows_are_deduplicated_before_detail_download(self):
        rows = [
            {"url": "https://example.com/jobs/123456", "title": "Embedded Intern", "company": ""},
            {"url": "https://example.com/jobs/123456?utm_source=listing", "title": "Embedded Intern", "company": "Example AG", "_contract_hint": True},
            {"url": "https://example.com/jobs/654321", "title": "Automation Intern"},
        ]
        unique, collapsed = hunter.deduplicate_candidate_rows(rows)
        self.assertEqual(len(unique), 2)
        self.assertEqual(collapsed, 1)
        self.assertEqual(unique[0]["company"], "Example AG")
        self.assertTrue(unique[0]["_contract_hint"])

    def test_listing_parent_does_not_create_a_false_contract_hint(self):
        parent_url = "https://jobup.example/search?term=stage"
        detail_url = "https://jobup.example/jobs/automation-engineer-123456"
        html = f"""<html><body><h1>100 stages et emplois</h1><article>
        <h2>Automation Engineer</h2><a href="{detail_url}">Voir l'offre</a>
        </article></body></html>"""

        def fake_pages(rows, label="HTTP"):
            return [(rows[0], html, html, parent_url)]

        with patch.object(hunter, "targeted_fixed_urls", return_value=[parent_url]), \
                patch.object(hunter, "iter_parallel_pages", fake_pages), \
                patch.dict(os.environ, {"FIXED_SITE_LIMIT": "1"}, clear=False):
            candidates = hunter.fixed_site_candidates(self.raphael)
        self.assertEqual(len(candidates), 1)
        self.assertFalse(candidates[0]["_contract_hint"])

    def test_exhaustive_mode_builds_more_than_eighty_profile_queries(self):
        profile = {
            "student": {"stage_type": "stage", "contract_types": ["stage"]},
            "target": {"job_titles": [
                "embedded engineer", "robotics engineer", "automation engineer", "R&D engineer"
            ], "sectors": ["medtech", "sportstech", "industrial automation"]},
            "skills": {"core": ["sensors", "firmware", "computer vision", "FPGA"],
                       "strong_domains": ["embedded systems", "robotics", "electronics"]},
            "interests": {"professional": ["wearable devices", "IoT"]},
            "search": {"query_budget": 240, "use_manual_queries": False, "site_query_share": 0},
            "sources": {"custom_queries": []},
            "location": {"countries": ["Switzerland", "France"]},
            "_source_pack_queries": [], "_source_pack_domains": [],
        }
        with patch.dict(os.environ, {
            "SEARCH_QUERY_BUDGET": "240", "SEARCH_ROLE_PAIR_LIMIT": "8",
            "SEARCH_INTENT_EXPANSION": "1", "SEARCH_SOURCE_QUERIES_PER_DOMAIN": "3",
        }, clear=False):
            queries = hunter.build_search_queries(profile, emit_log=False)
        self.assertGreater(len(queries), 80)
        self.assertLessEqual(len(queries), 240)
        joined = "\n".join(queries).lower()
        self.assertIn("internship", joined)
        self.assertIn("stage", joined)
        self.assertIn("praktikum", joined)

    def test_time_budget_stops_new_http_batches_cleanly(self):
        rows = [{"url": f"https://example.com/jobs/{100000 + index}", "snippet": ""} for index in range(10)]

        def fake_page(url, fallback=""):
            return "offer", "<html>offer</html>", url

        with patch.object(hunter, "page", fake_page), \
                patch.object(hunter, "scan_budget_exhausted", side_effect=[False, True]), \
                patch.dict(os.environ, {"SCAN_TIME_BUDGET_SECONDS": "3600", "SCRAPE_WORKERS": "1"}, clear=False):
            results = hunter.parallel_pages(rows, "TEST BUDGET")
        self.assertEqual(len(results), 2)

    def test_fetch_caps_large_html_responses(self):
        class FakeResponse:
            status_code = 200
            url = "https://example.com/jobs/123456"
            encoding = "utf-8"
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def iter_content(self, chunk_size=65536):
                yield b"x" * 150_000
                yield b"y" * 150_000

        class FakeSession:
            def get(self, *args, **kwargs): return FakeResponse()

        with patch.object(hunter, "http_session", return_value=FakeSession()), \
                patch.dict(os.environ, {"MAX_RESPONSE_BYTES": "250000"}, clear=False):
            body, final_url = hunter.fetch("https://example.com/jobs/123456")
        self.assertEqual(len(body), 250_000)
        self.assertEqual(final_url, "https://example.com/jobs/123456")

    def test_web_probe_rotates_primary_backends_without_extra_retries(self):
        calls = []

        class EmptySearch:
            def __init__(self, *args, **kwargs):
                pass
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def text(self, *args, **kwargs):
                calls.append(kwargs.get("backend"))
                return []

        previous = hunter.ACTIVE_PROFILE
        hunter.ACTIVE_PROFILE = {"search": {"retry_empty_results": False}, "location": {"countries": ["Switzerland"]}}
        try:
            with patch.object(hunter, "DDGS", EmptySearch), patch.dict(os.environ, {
                "SEARCH_BACKENDS": "duckduckgo,brave,google", "SEARCH_RETRIES": "0",
                "SEARCH_WORKERS": "1", "WEB_PROBE_QUERIES": "2",
                "SEARCH_DELAY_MIN": "0", "SEARCH_DELAY_MAX": "0",
            }, clear=False):
                hunter.search_web(["query one", "query two"], 5)
        finally:
            hunter.ACTIVE_PROFILE = previous
        self.assertEqual(calls, ["duckduckgo", "brave"])

    def test_empty_web_probe_opens_circuit_breaker(self):
        class EmptySearch:
            def __init__(self, *args, **kwargs): pass
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def text(self, *args, **kwargs): return []

        previous = hunter.ACTIVE_PROFILE
        hunter.ACTIVE_PROFILE = {"search": {"retry_empty_results": False}, "location": {"countries": ["France"]}}
        try:
            with patch.object(hunter, "DDGS", EmptySearch), patch.dict(os.environ, {
                "SEARCH_RETRIES": "0", "SEARCH_WORKERS": "1", "SEARCH_DELAY_MIN": "0",
                "SEARCH_DELAY_MAX": "0", "WEB_PROBE_QUERIES": "1",
                "WEB_MIN_PRODUCTIVITY": "0.1", "WEB_MIN_PROBE_LINKS": "1",
            }, clear=False):
                hunter.search_web(["query one", "query two", "query three"], 5)
        finally:
            hunter.ACTIVE_PROFILE = previous
        self.assertEqual(hunter.SCAN_METRICS["web"]["executed"], 1)
        self.assertEqual(hunter.SCAN_METRICS["web"]["skipped"], 2)
        self.assertTrue(hunter.SCAN_METRICS["web"]["circuit_breaker"])

    def test_accented_sheet_action_is_normalized(self):
        self.assertEqual(hunter.normalize_action("Transférer"), "TRANSFERER")
        self.assertEqual(hunter.normalize_action("Supprimer"), "SUPPRIMER")

    def test_existing_opportunity_sheet_row_rebuilds_empty_database(self):
        rows = [hunter.OP_HEADERS, [
            "", 88, 70, "CERN", "Technical Studentship - Electronics", "Geneva",
            "Genève | GE | FR", "Anglais", "6 mois", "Mars 2027", "Électronique",
            "Capteurs, Électronique", "Import test", "careers.cern",
            "https://careers.cern/jobs/technical-studentship-electronics-123456",
            "2026-09-22T00:00:00+00:00", "17",
        ]]

        class Request:
            def __init__(self, value):
                self.value = value
            def execute(self):
                return self.value

        class Values:
            def get(self, **kwargs):
                return Request({"values": rows})
            def update(self, **kwargs):
                return Request({})
            def batchUpdate(self, **kwargs):
                return Request({})

        class Spreadsheets:
            def values(self):
                return Values()
            def get(self, **kwargs):
                return Request({"sheets": [{"properties": {"title": "Opportunités", "sheetId": 42}}]})
            def batchUpdate(self, **kwargs):
                return Request({})

        class Service:
            def spreadsheets(self):
                return Spreadsheets()

        previous_db = hunter.DB
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            hunter.DB = Path(directory) / "stage_hunter.sqlite3"
            connection = hunter.init_db()
            try:
                result = hunter.import_opportunities(connection, Service(), "sheet-id", "Opportunités")
                offer = connection.execute("SELECT id,title,status FROM offers WHERE id=17").fetchone()
            finally:
                connection.close()
                hunter.DB = previous_db
        self.assertEqual(result["imported"], 1)
        self.assertEqual(offer, (17, "Technical Studentship - Electronics", "new"))

    def test_partial_studentship_discovered_from_listing_is_retained(self):
        row = {
            "url": "https://careers.cern/jobs/technical-studentship-electronics-123456",
            "title": "Technical Studentship - Electrical / Electronics Engineering 2027-1",
            "snippet": "Geneva Switzerland",
            "source": "careers.cern",
            "origin": "fixed_site",
            "_depth": 1,
            "_contract_hint": True,
        }
        page_text = "Student programme in Geneva. Electrical engineering, electronics, sensors and embedded control systems. Apply now."
        html = "<html><title>Technical Studentship - Electrical Engineering</title><body>Apply now</body></html>"

        def fake_pages(rows, label="HTTP"):
            return [(item, page_text, html, item["url"]) for item in rows]

        previous_db = hunter.DB
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            hunter.DB = Path(directory) / "stage_hunter.sqlite3"
            connection = hunter.init_db()
            try:
                with patch.object(hunter, "iter_parallel_pages", fake_pages), patch.object(hunter, "write_diagnostics", lambda *args: None):
                    retained, closed = hunter.ingest(connection, [row], self.raphael)
            finally:
                connection.close()
                hunter.DB = previous_db
        self.assertEqual(retained, 1)
        self.assertEqual(closed, 0)

    def test_employment_profile_rejects_internships(self):
        profile = {
            "student": {"stage_type": "emploi", "contract_types": ["CDI", "CDD"]},
            "target": {"job_titles": ["développeur full-stack"], "sectors": ["logiciel"]},
            "skills": {"core": ["Java", "React"], "strong_domains": ["développement web"]},
            "interests": {"personal": ["vélo", "cyclisme"]},
            "search": {"require_profile_relevance": True},
            "location": {"countries": ["France"]},
        }
        meta = hunter.detect_meta("Stage Chargé de SEO", "Stage de six mois à Paris, France", profile, "Paris, France")
        reason = hunter.eligibility_rejection(
            "Stage Chargé de SEO", "Stage de six mois à Paris, France", meta, profile,
            {"location": "Paris, France"},
        )
        self.assertIn("contrat incompatible", reason.lower())

    def test_software_profile_rejects_business_development(self):
        profile = {
            "student": {"stage_type": "emploi", "contract_types": ["CDI", "CDD"]},
            "target": {"job_titles": ["développeur web", "ingénieur logiciel"], "sectors": ["SaaS"]},
            "skills": {"core": ["Java", "React"], "strong_domains": ["développement web"]},
            "interests": {"personal": ["vélo", "sport"]},
            "search": {"require_profile_relevance": True},
            "location": {"countries": ["France"]},
        }
        meta = hunter.detect_meta("Business Developer - salle de sport", "Commercial fitness à Lyon, France", profile, "Lyon, France")
        reason = hunter.eligibility_rejection(
            "Business Developer - salle de sport", "Commercial fitness à Lyon, France", meta, profile,
            {"location": "Lyon, France"},
        )
        self.assertIn("développement commercial", reason)

    def test_personal_passions_never_generate_queries(self):
        profile = {
            "student": {"stage_type": "emploi", "contract_types": ["CDI", "CDD"]},
            "target": {"job_titles": ["développeur full-stack"], "sectors": ["SaaS"]},
            "skills": {"core": ["Java", "React"], "strong_domains": ["développement web"]},
            "interests": {"professional": ["logiciel"], "personal": ["vélo", "cyclisme", "fitness"]},
            "search": {"query_budget": 20, "use_manual_queries": False},
            "sources": {"custom_queries": []},
            "location": {"countries": ["France"]},
            "_source_pack_queries": [], "_source_pack_domains": [],
        }
        with patch.dict(os.environ, {"SEARCH_QUERY_BUDGET": "20"}, clear=False):
            joined = "\n".join(hunter.build_search_queries(profile, emit_log=False)).lower()
        self.assertNotIn("vélo", joined)
        self.assertNotIn("cyclisme", joined)
        self.assertNotIn("fitness", joined)

    def test_scheduler_uses_short_launcher_instead_of_long_task_command(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            root = Path(directory) / ("installation avec un chemin assez long " * 2).strip()
            python = root / ".venv" / "Scripts" / "python.exe"
            profile = root / "config" / "profiles" / "raphael.yaml"
            python.parent.mkdir(parents=True)
            profile.parent.mkdir(parents=True)
            python.touch()
            profile.write_text("id: raphael\n", encoding="utf-8")
            captured = {}

            class Result:
                returncode = 0
                stdout = "OK"
                stderr = ""

            def fake_schtasks(arguments):
                captured["arguments"] = arguments
                return Result()

            with patch.object(scheduler, "ROOT", root), \
                    patch.object(scheduler, "TASK_LAUNCHERS_DIR", root / "scheduled_tasks"), \
                    patch.object(scheduler, "ensure_windows", lambda: None), \
                    patch.object(scheduler, "run_schtasks", fake_schtasks):
                message = scheduler.install(str(profile), "07:00", "daily")

            action = captured["arguments"][captured["arguments"].index("/TR") + 1]
            self.assertLessEqual(len(action), 261)
            self.assertNotIn("stage_hunter.py", action)
            self.assertIn("créée", message)
            launcher = root / "scheduled_tasks" / "StageHunter_raphael.cmd"
            content = launcher.read_text(encoding="utf-8")
            self.assertIn("stage_hunter.py", content)
            self.assertIn(str(profile.resolve()), content)

    def test_connectors_platform_detection(self):
        self.assertEqual(connectors.get_platform_name("https://www.linkedin.com/jobs/view/12345"), "linkedin")
        self.assertEqual(connectors.get_platform_name("https://jobs.ch/fr/vacancies/detail/abc"), "jobs_ch")
        self.assertEqual(connectors.get_platform_name("https://www.jobup.ch/en/jobs/detail/123"), "jobs_ch")
        self.assertEqual(connectors.get_platform_name("https://www.iagora.com/work/en/internships/stage-sensors"), "iagora")
        self.assertEqual(connectors.get_platform_name("https://www.glassdoor.com/job-listing/role-jl.htm?jl=123"), "glassdoor")
        self.assertEqual(connectors.get_platform_name("https://ch.indeed.com/viewjob?jk=abcdef"), "indeed")
        self.assertEqual(connectors.get_platform_name("https://www.jobteaser.com/fr/job-offers/123"), "jobteaser")
        self.assertEqual(connectors.get_platform_name("https://careers.google.com/jobs/results/"), "generic")

    def test_linkedin_job_parser(self):
        html = """
        <html>
            <head><title>Embedded Systems Intern - ABB - Zurich | LinkedIn</title></head>
            <body>
                <h1 class="topcard__title">Embedded Systems Intern</h1>
                <a class="topcard__org-name-link">ABB Ltd</a>
                <span class="topcard__flavor--bullet">Zurich, Switzerland</span>
                <li class="description__job-criteria-item">Internship</li>
                <div class="show-more-less-html__markup">Develop firmware for industrial sensors.</div>
            </body>
        </html>
        """
        data = connectors.parse_specialized_job_posting("https://www.linkedin.com/jobs/view/1001", html)
        self.assertIsNotNone(data)
        self.assertEqual(data.get("title"), "Embedded Systems Intern")
        self.assertEqual(data.get("company"), "ABB Ltd")
        self.assertEqual(data.get("location"), "Zurich, Switzerland")
        self.assertIn("firmware for industrial sensors", data.get("description", ""))

    def test_jobsch_job_parser(self):
        html = """
        <html>
            <body>
                <h1 data-cy="job-title">Stagiaire R&D Capteurs - jobs.ch</h1>
                <div data-cy="company-name">Sensirion AG</div>
                <div data-cy="job-location">Stäfa, Zurich</div>
                <div data-cy="job-workload">100% · Stage</div>
                <div data-cy="job-description">Conception et test de capteurs de flux.</div>
            </body>
        </html>
        """
        data = connectors.parse_specialized_job_posting("https://www.jobs.ch/fr/vacancies/detail/999/", html)
        self.assertIsNotNone(data)
        self.assertEqual(data.get("title"), "Stagiaire R&D Capteurs")
        self.assertEqual(data.get("company"), "Sensirion AG")
        self.assertEqual(data.get("location"), "Stäfa, Zurich")
        self.assertEqual(data.get("employment_type"), "100% · Stage")
        self.assertIn("capteurs de flux", data.get("description", ""))

    def test_glassdoor_cleans_rating(self):
        html = """
        <html>
            <body>
                <h1 data-test="job-title">Robotics Engineer</h1>
                <div data-test="employer-name">CERN 4.5 ★</div>
                <div data-test="location">Geneva, Switzerland</div>
                <div data-test="jobDescription">Robotics automation for accelerators.</div>
            </body>
        </html>
        """
        data = connectors.parse_specialized_job_posting("https://www.glassdoor.ch/job-listing/123", html)
        self.assertIsNotNone(data)
        self.assertEqual(data.get("title"), "Robotics Engineer")
        self.assertEqual(data.get("company"), "CERN")

    def test_iagora_listing_and_job(self):
        html_listing = """
        <html>
            <body>
                <div class="m-job-card">
                    <a class="m-job-card__title" href="/work/en/internships/sensor-trainee">Sensor Trainee</a>
                    <div class="m-job-card__company">MicroTech SA</div>
                    <div class="m-job-card__location">Lausanne, Switzerland</div>
                </div>
            </body>
        </html>
        """
        leads = connectors.extract_specialized_listing_leads("https://www.iagora.com/work/en/internships", html_listing)
        self.assertEqual(len(leads), 1)
        self.assertEqual(leads[0]["title"], "Sensor Trainee")
        self.assertEqual(leads[0]["company"], "MicroTech SA")
        self.assertEqual(leads[0]["location"], "Lausanne, Switzerland")

    def test_multi_country_region_detection(self):
        # 1. France: Lyon in Auvergne-Rhône-Alpes
        detected = regions.detect_country_region(["Lyon, France", "Stage Ingénieur"], ["france"])
        self.assertIsNotNone(detected)
        self.assertIn("Auvergne-Rhône-Alpes", detected[0])
        self.assertIn("FR", detected[0])

        # 2. France: Toulouse in Occitanie
        detected = regions.detect_country_region(["Toulouse, France", "Stage Robotique"], ["france"])
        self.assertIsNotNone(detected)
        self.assertIn("Occitanie", detected[0])

        # 3. France: Paris in Île-de-France
        detected = regions.detect_country_region(["Paris, France", "Ingénieur IA"], ["france"])
        self.assertIsNotNone(detected)
        self.assertIn("Île-de-France", detected[0])

        # 4. Belgium: Bruxelles
        detected = regions.detect_country_region(["Bruxelles, Belgique", "Data Scientist"], ["belgium"])
        self.assertIsNotNone(detected)
        self.assertIn("Bruxelles-Capitale", detected[0])
        self.assertIn("BE", detected[0])

        # 5. Germany: München
        detected = regions.detect_country_region(["München, Deutschland", "Embedded Engineer"], ["germany"])
        self.assertIsNotNone(detected)
        self.assertIn("Bayern", detected[0])
        self.assertIn("DE", detected[0])

        # 6. Switzerland: Lausanne
        detected = regions.detect_country_region(["Lausanne, Switzerland", "Stage EPFL"], ["switzerland"])
        self.assertIsNotNone(detected)
        self.assertIn("Vaud", detected[0])
        self.assertIn("VD", detected[0])

    def test_unwrap_url_rewrites_indeed_clk(self):
        clk_url = "https://ch.indeed.com/rc/clk?jk=d3827ac51c677500&bb=test_token_123"
        unwrapped = hunter.unwrap_url(clk_url)
        self.assertEqual(unwrapped, "https://ch.indeed.com/viewjob?jk=d3827ac51c677500")

    def test_seo_salary_and_reviews_rejected_as_job_titles(self):
        # Salary guides and review pages must not be treated as jobs
        self.assertFalse(hunter.looks_like_job_title("Salaires annuels pour le poste : Stagiaire Automation R"))
        self.assertFalse(hunter.looks_like_job_title("Avis des employés pour Praktikum Im Bereich Automation"))
        self.assertFalse(hunter.looks_like_job_title("Employee reviews for Software Engineer"))
        self.assertFalse(hunter.looks_like_job_title("Salary for Robotics Intern"))
        # Real job titles must pass
        self.assertTrue(hunter.looks_like_job_title("Stagiaire en développement capteurs"))
        self.assertTrue(hunter.looks_like_job_title("Praktikum Im Bereich Automation"))

    def test_listing_reason_filters_salary_and_review_pages(self):
        self.assertIn("SEO", hunter.listing_reason("https://ch.indeed.com/salaires/poste-stagiaire", "Salaires", ""))
        self.assertIn("SEO", hunter.listing_reason("https://ch.indeed.com/viewjob?jk=123", "Salaires annuels pour le poste : Stagiaire", ""))
        self.assertIn("SEO", hunter.listing_reason("https://www.glassdoor.fr/Avis/test-reviews.htm", "Avis des employés", ""))

    def test_connectors_indeed_rewrites_clk_and_filters_salary(self):
        from bs4 import BeautifulSoup
        html = """
        <div class="job_seen_beacon">
            <h2 class="jobTitle"><a data-jk="abc12345" href="/rc/clk?jk=abc12345">Embedded Systems Intern</a></h2>
            <div data-testid="company-name">Sensirion</div>
            <div data-testid="text-location">Stäfa, Zurich</div>
        </div>
        <div class="job_seen_beacon">
            <h2 class="jobTitle"><a data-jk="junk999" href="/salaires/poste-stagiaire">Salaires annuels pour le poste : Stagiaire</a></h2>
            <div data-testid="company-name">Indeed</div>
            <div data-testid="text-location">Zurich</div>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        leads = connectors.parse_indeed_listing_leads("https://ch.indeed.com/jobs?q=stage", soup)
        self.assertEqual(len(leads), 1)
        self.assertEqual(leads[0]["title"], "Embedded Systems Intern")
        self.assertEqual(leads[0]["href"], "https://ch.indeed.com/viewjob?jk=abc12345")
        self.assertEqual(leads[0]["company"], "Sensirion")

    def test_report_table_renders_cleanly(self):
        import sqlite3
        conn = sqlite3.connect(":memory:")
        try:
            conn.execute("CREATE TABLE offers(score REAL, company TEXT, title TEXT, source TEXT, status TEXT, discovered_at TEXT)")
            conn.execute("INSERT INTO offers VALUES(95.5, 'CERN', 'Technical Student - Sensors & Robotics', 'careers.cern', 'new', '2026-09-23T12:00:00')")
            conn.execute("INSERT INTO offers VALUES(88.0, 'ABB', 'Praktikum Automation', 'abb.com', 'kept', '2026-09-23T12:00:00')")
            # Should execute without error and print formatted table
            hunter.report(conn, n=10)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()

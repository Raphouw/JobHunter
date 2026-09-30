"""Browser-only adapter. Loaded from explicit public code assets, never server.

The JS bridge makes bounded same-origin calls from a Web Worker. CPU work stays
in this Python runtime. Sequential futures avoid unsupported WASM pthreads.
"""
import json
import os
import time
import urllib.parse
from concurrent.futures import Future
from datetime import datetime, timezone

import stage_hunter as engine
import cloud.scan_worker as scanner


class SequentialPool:
    def __init__(self, *args, **kwargs): pass
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def submit(self, fn, *args, **kwargs):
        future = Future()
        try: future.set_result(fn(*args, **kwargs))
        except Exception as error: future.set_exception(error)
        return future


def install(transport, event):
    global _transport, _event, _store, _engine, _profile
    _transport, _event = transport, event
    _store = _engine = _profile = None
    engine.ThreadPoolExecutor = scanner.ThreadPoolExecutor = SequentialPool
    engine.as_completed = lambda futures: iter(futures)
    # Browser runtime gets no search credential, only names of enabled providers.
    engine.console.print = lambda *args, **kwargs: None
    os.environ['HTTP_RETRIES'] = '0'


def call(action, **body):
    return json.loads(_transport(json.dumps({'action': action, **body}, ensure_ascii=False)))


class BrowserStore(scanner.Store):
    def __init__(self):
        # These placeholders are never credentials and request() is overridden.
        os.environ['SUPABASE_URL'] = 'https://browser.invalid'
        os.environ['SUPABASE_SERVICE_ROLE_KEY'] = 'browser-transport-no-key'
        super().__init__()
        self.token = None
        self.compact_bodies = True
        self.finalize_batch_limit = 25
        self.body_page_size = 25
        self.compact_summary = True

    def rows(self, table, query):
        params = dict(urllib.parse.parse_qsl(query))
        initial_columns = 'id,' + ','.join(scanner.EXISTING_COLUMNS)
        if table == 'hunter_offers' and params.get('select') == initial_columns and 'discovered_at' not in params:
            result = []
            offset = int(params.get('offset', 0))
            for start in range(offset, offset + 1000, 25):
                started = time.perf_counter()
                self.calls += 1
                page = call('mirror', offset=start)
                self.seconds += time.perf_counter() - started
                self.bytes_received += scanner.payload_bytes(page)
                result.extend(page)
                if len(page) < 25:
                    break
            return result
        # Final scoring requests independent pages of 25 full descriptions.
        return super().rows(table, query)

    def request(self, path, method='GET', body=None, prefer=None):
        if method == 'POST' and isinstance(body, list) and scanner.payload_bytes(body) > 1_500_000:
            batch, size = [], 2
            for row in body:
                weight = scanner.payload_bytes(row) + 1
                if batch and size + weight > 1_500_000:
                    self.request(path, method, batch, prefer)
                    batch, size = [], 2
                batch.append(row)
                size += weight
            if batch:
                self.request(path, method, batch, prefer)
            return None
        started = time.perf_counter()
        self.calls += 1
        self.bytes_sent += scanner.payload_bytes(body) if body is not None else 0
        try:
            if path.startswith('rpc/'):
                data = call('rpc', name=path[4:], args=body)
                if path == 'rpc/hunter_claim_scan_job' and data:
                    self.token = data[0]['lease_token']
            else:
                data = call('store', path=path, method=method, body=body,
                            prefer=prefer, lease_token=self.token)
            self.bytes_received += scanner.payload_bytes(data)
            return data
        finally:
            self.seconds += time.perf_counter() - started

    def browser_metrics(self):
        from browser_bridge_js import metrics
        return json.loads(metrics())


def browser_fetch(url):
    result = call('fetch', url=url, lease_token=_store.token)
    engine._HTTP_LOCAL.last_fetch_meta = result['meta']
    return result['html'], result['url']


def browser_preview(url):
    html, final_url = browser_fetch(url)
    if not html:
        raise ValueError(engine._HTTP_LOCAL.last_fetch_meta.get('error') or 'Page vide')
    return html, final_url


class BrowserSession:
    def get(self, url, **kwargs):
        html, final_url = browser_fetch(url)
        from types import SimpleNamespace
        return SimpleNamespace(text=html, url=final_url,
                               status_code=engine._HTTP_LOCAL.last_fetch_meta.get('http_status') or 0)


def step(job_id, power='normal'):
    global _store, _engine, _profile
    if _store is None:
        _store = BrowserStore()
        scanner._WORKER_LOCAL.temp_dirs = []
        scanner._WORKER_LOCAL.connections = []
    claimed = _store.rpc('hunter_claim_scan_job', {'p_job_id': job_id}) or []
    if not claimed:
        rows = _store.rows('hunter_scan_jobs', f'id=eq.{job_id}&select=*')
        return json.dumps({'claimed': False, 'job': rows[0] if rows else None})
    job = claimed[0]
    if _engine is None:
        config = (job.get('checkpoint') or {}).get('profile_config')
        if config is None:
            config = _store.rows('hunter_profiles', f'id=eq.{job["profile_id"]}&select=config')[0]['config']
            job['checkpoint'] = {**job.get('checkpoint', {}), 'profile_config': config}
        previous = _store.rows('hunter_scan_jobs', f'profile_id=eq.{job["profile_id"]}&status=eq.completed&select=summary&order=finished_at.desc&limit=1')
        _store.source_yield = (((previous[0].get('summary') or {}).get('metrics') or {}).get('source_yield') or {}) if previous else {}
        _engine, _profile = scanner.prepare_engine(config, job, _store)
        prior_summary = (previous[0].get('summary') or {}) if previous else {}
        prior_web = (prior_summary.get('metrics') or {}).get('web') or {}
        prior_backends = prior_web.get('backends') or {}
        weights = {name: values.get('results', 0) / max(1, values.get('attempts', 0))
                   for name, values in prior_backends.items() if values.get('attempts', 0) >= 5}
        os.environ['SEARCH_BACKEND_WEIGHTS'] = json.dumps(weights)
        original_duplicate = _engine.find_duplicate
        def full_duplicate(connection, *args, **kwargs):
            found = original_duplicate(connection, *args, **kwargs)
            if found and str(found[5] or '').startswith('\x01'):
                remote_id = _store.existing_local_ids.get(found[0])
                filter_value = f'id=eq.{remote_id}' if remote_id else 'canonical_url=eq.' + urllib.parse.quote(_engine.canon(found[1]), safe='')
                rows = _store.rows('hunter_offers', filter_value + '&select=body&limit=1')
                if rows:
                    found = (*found[:5], rows[0].get('body') or '', *found[6:])
            return found
        _engine.find_duplicate = full_duplicate
        _engine.fetch = browser_fetch
        _engine.fetch_preview = browser_preview
        _engine.http_session = lambda: BrowserSession()
        _engine.search_backend_once = lambda query, backend, limit, region, timeout: call(
            'search', query=query, backend=backend, limit=limit, region=region, lease_token=_store.token)
        _engine.EVENT_HOOK = lambda message, style='': _event(str(message), style)
    _engine.RUN_STARTED = time.perf_counter()
    _engine.RUN_STARTED_AT = datetime.now(timezone.utc)
    os.environ['SCAN_TIME_BUDGET_SECONDS'] = str({'eco': 60, 'normal': 120, 'fast': 160, 'maximum': 180}.get(power, 120))
    os.environ['SCAN_DEADLINE_RESERVE_SECONDS'] = '20'
    os.environ['SCRAPE_WORKERS'] = os.environ['SEARCH_WORKERS'] = '1'
    os.environ['MAX_IN_FLIGHT_PAGES'] = '1'
    # Independent from CPU runtimes/network concurrency: aggregate useful
    # outcomes per phase instead of one persistence request for every offer.
    job['batch_size'] = 1 if job['phase'] == 'discover' else {'eco': 5, 'normal': 20, 'fast': 25, 'maximum': 30}.get(power, 20)
    _store.begin_phase(job['phase'], _engine)
    try:
        {'discover': scanner.discover, 'analyze': scanner.analyze,
         'finish': scanner.finish}[job['phase']](_store, job, _engine, _profile)
    except Exception:
        # Keep durable queue/results; let the controller stop and offer recovery.
        # Retry resumes with a fresh engine after the lease expires.
        raise
    rows = _store.rows('hunter_scan_jobs', f'id=eq.{job_id}&select=*')
    if _store.local_connection is not None:
        # Full descriptions live durably in Supabase. Keep only body length
        # markers locally, and rehydrate the winner when a duplicate must merge.
        _store.local_connection.execute("UPDATE offers SET body=substr(?,1,min(250,length(body))) WHERE length(body)>0 AND substr(body,1,1)<>?", ('\x01' * 250, '\x01'))
        _store.local_connection.commit()
    # VFS files consume WASM memory too. Audits/details were already persisted
    # by analyze(); retaining one file per task would recreate the exhaustive OOM.
    for directory in getattr(scanner._WORKER_LOCAL, 'temp_dirs', []):
        for pattern in ('*.jsonl', '*.bin'):
            for path in directory.rglob(pattern):
                path.unlink(missing_ok=True)
    return json.dumps({'claimed': True, 'job': rows[0] if rows else None}, ensure_ascii=False)

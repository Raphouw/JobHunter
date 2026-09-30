"""Small authenticated operations for the browser-owned Python scanner.

No orchestration, HTML parsing, ranking or scan loop executes here. The caller
never supplies an owner: every operation is confined to the authenticated job.
"""
import json
import hashlib
import os
import re
import time
import urllib.parse
import uuid

from cloud.scan_worker import Store, utc_now

MAX_BODY = 2_000_000
TABLES = {'hunter_scan_jobs', 'hunter_scan_candidates', 'hunter_offers',
          'hunter_offer_history', 'hunter_scan_events', 'hunter_site_recipes',
          'hunter_profiles'}


class BridgeError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def owned_job(store, user_id, job_id, full=False):
    job_id = str(uuid.UUID(str(job_id)))
    columns = '*' if full else 'id,profile_id,user_id,status,cancel_requested,lease_token,lease_until,executor:checkpoint->>executor,paused:checkpoint->paused'
    rows = store.rows('hunter_scan_jobs', f'id=eq.{job_id}&user_id=eq.{user_id}&select={columns}')
    if not rows or (rows[0].get('executor') or (rows[0].get('checkpoint') or {}).get('executor')) != 'browser':
        raise BridgeError(404, 'Scan navigateur introuvable')
    return rows[0]


def active_lease(job, token):
    from datetime import datetime, timezone
    until = job.get('lease_until')
    if (not token or token != job.get('lease_token') or job.get('cancel_requested')
            or job.get('status') != 'running' or not until
            or datetime.fromisoformat(until.replace('Z', '+00:00')) <= datetime.now(timezone.utc)):
        raise BridgeError(409, 'Bail interrompu ou expiré; reprendre depuis le checkpoint')


def scoped_path(path, method, job):
    """Reject joins/RPCs and impose ownership filters outside caller filters."""
    if not isinstance(path, str) or len(path) > 20_000:
        raise BridgeError(400, 'Chemin invalide')
    table, _, query = path.partition('?')
    if table not in TABLES:
        raise BridgeError(400, 'Table interdite')
    params = dict(urllib.parse.parse_qsl(query, keep_blank_values=True))
    # Embedded resource selects could expose an unrelated profile through a join.
    select = params.get('select', '*')
    if not re.fullmatch(r'[a-zA-Z0-9_,*]+', select) and not (
            table == 'hunter_scan_candidates' and select == 'status,decision,source:payload->>source'):
        raise BridgeError(400, 'Projection interdite')
    if table in {'hunter_profiles', 'hunter_site_recipes'} and method != 'GET':
        raise BridgeError(400, 'Table en lecture seule')
    if method not in {'GET', 'POST', 'PATCH', 'DELETE'}:
        raise BridgeError(400, 'Opération interdite')
    if method == 'DELETE' and (table != 'hunter_offers' or 'id' not in params):
        raise BridgeError(400, 'Suppression interdite')
    if table == 'hunter_scan_jobs' and method == 'POST':
        raise BridgeError(400, 'Insertion de job interdite')
    conflict = {'hunter_offers': 'profile_id,canonical_url',
                'hunter_offer_history': 'profile_id,identity',
                'hunter_scan_candidates': 'job_id,identity'}
    if method == 'POST' and 'on_conflict' in params and params['on_conflict'] != conflict.get(table):
        raise BridgeError(400, 'Conflit interdit')
    if table == 'hunter_site_recipes':
        params['status'] = 'eq.published'
    else:
        params['user_id'] = 'eq.' + job['user_id']
        if table in {'hunter_offers', 'hunter_offer_history'}:
            params['profile_id'] = 'eq.' + job['profile_id']
        elif table in {'hunter_scan_candidates', 'hunter_scan_events'}:
            params['job_id'] = 'eq.' + job['id']
        elif table == 'hunter_scan_jobs' and method == 'GET':
            params['profile_id'] = 'eq.' + job['profile_id']
        else:
            params['id'] = 'eq.' + (job['profile_id'] if table == 'hunter_profiles' else job['id'])
    if method == 'GET':
        params['limit'] = str(min(1000, max(1, int(params.get('limit', 1000)))))
    elif 'limit' in params:
        raise BridgeError(400, 'Limite de mutation interdite')
    return table, table + '?' + urllib.parse.urlencode(params)


def scoped_body(table, payload, job):
    if payload is None:
        return None
    rows = payload if isinstance(payload, list) else [payload]
    if len(rows) > 100 or any(not isinstance(row, dict) for row in rows):
        raise BridgeError(400, 'Lot invalide (100 lignes maximum)')
    result = []
    for row in rows:
        if set(row) & {'id', 'offer_id', 'lease_token', 'lease_until'}:
            raise BridgeError(400, 'Identifiants immuables')
        value = {**row, 'user_id': job['user_id']}
        if table in {'hunter_scan_candidates', 'hunter_scan_events'}:
            value['job_id'] = job['id']
        if table in {'hunter_offers', 'hunter_offer_history'}:
            value['profile_id'] = job['profile_id']
        if table == 'hunter_scan_jobs':
            # Job state is exclusively changed by the lease RPC/control actions.
            if set(row) - {'summary'}:
                raise BridgeError(400, 'Seul le résumé peut être écrit ici')
            value = {'summary': row['summary']}
        if table == 'hunter_offers':
            from site_network import public_http_url
            for field in ('url', 'canonical_url', 'application_url'):
                if value.get(field) and not public_http_url(value[field]):
                    raise BridgeError(400, 'URL d’offre invalide')
        result.append(value)
    return result if isinstance(payload, list) else result[0]


def execute(store, user_id, body):
    action = body.get('action')
    if action == 'start':
        from cloud.scan_worker import MODE_LIMITS
        profile_id = str(uuid.UUID(str(body.get('profile_id'))))
        mode = body.get('mode')
        if mode not in MODE_LIMITS:
            raise BridgeError(400, 'Mode invalide')
        if not store.rows('hunter_profiles', f'id=eq.{profile_id}&user_id=eq.{user_id}&select=id'):
            raise BridgeError(404, 'Profil introuvable')
        if store.rows('hunter_scan_jobs', f'user_id=eq.{user_id}&status=in.(queued,running)&select=id&limit=1'):
            raise BridgeError(409, 'Un scan est déjà actif')
        return store.request('hunter_scan_jobs', 'POST', {
            'user_id': user_id, 'profile_id': profile_id, 'mode': mode,
            'checkpoint': {'executor': 'browser'},
        }, 'return=representation')[0]
    job = owned_job(store, user_id, body.get('job_id'), full=action in {'state', 'pause', 'resume', 'cancel'})
    if action == 'state':
        import stage_hunter
        return {**job, 'search_backends': stage_hunter.configured_search_backends()[0]}
    if action == 'mirror':
        # Read small pages, compact descriptions BEFORE transport. Returning
        # 1000 full descriptions through a Vercel response exceeds payload/RAM
        # budgets even when the destination is a browser Worker.
        from cloud.scan_worker import EXISTING_COLUMNS
        offset = int(body.get('offset', 0))
        if not 0 <= offset <= 2_147_483_647:
            raise BridgeError(400, 'Page invalide')
        rows = store.rows('hunter_offers',
            f'profile_id=eq.{job["profile_id"]}&user_id=eq.{user_id}&select=id,'
            + ','.join(EXISTING_COLUMNS) + f'&order=id.asc&limit=25&offset={offset}')
        result = []
        for row in rows:
            value = {**row}
            value['_text_hashes'] = {key: hashlib.sha256(str(row.get(key) or '').encode()).hexdigest()
                                     for key in ('body', 'snippet')}
            value['body'] = '\x01' * min(250, len(row.get('body') or ''))
            result.append(value)
        return result
    if action in {'pause', 'resume', 'cancel'}:
        if job['status'] not in {'queued', 'running'}:
            return job
        patch = {'lease_token': None, 'lease_until': None}
        if action == 'cancel':
            patch.update(status='cancelled', cancel_requested=True, finished_at=utc_now())
        else:
            patch.update(status='queued', next_run_at=utc_now() if action == 'resume' else '2099-01-01T00:00:00Z',
                         checkpoint={**job.get('checkpoint', {}), 'paused': action == 'pause'})
        store.patch('hunter_scan_jobs', f'id=eq.{job["id"]}&user_id=eq.{user_id}', patch)
        return {**job, **patch}
    if action == 'rpc':
        name, args = body.get('name'), body.get('args') or {}
        if name == 'hunter_claim_scan_job':
            if job.get('paused') or (job.get('checkpoint') or {}).get('paused'):
                return []
            # Legacy server claims exclude browser jobs, including production main.
            return store.rpc('hunter_claim_browser_scan_job', {'p_job_id': job['id']})
        if name == 'hunter_apply_scan_decisions':
            active_lease(job, args.get('p_lease_token'))
            rows = args.get('p_rows')
            if not isinstance(rows, list) or len(rows) > 100:
                raise BridgeError(400, 'Lot de décisions invalide')
            return store.rpc(name, {'p_job_id': job['id'], 'p_lease_token': args['p_lease_token'], 'p_rows': rows})
        if name != 'hunter_release_scan_job':
            raise BridgeError(400, 'RPC interdite')
        active_lease(job, args.get('p_lease_token'))
        checkpoint = args.get('p_checkpoint')
        if not isinstance(checkpoint, dict):
            raise BridgeError(400, 'Checkpoint invalide')
        args = {key: args[key] for key in ('p_lease_token', 'p_phase', 'p_progress_percent', 'p_completed') if key in args}
        args.update(p_job_id=job['id'], p_checkpoint={**checkpoint, 'executor': 'browser'})
        return store.rpc(name, args)
    if action == 'store':
        method = body.get('method', 'GET')
        table, path = scoped_path(body.get('path'), method, job)
        if method == 'GET' and table == 'hunter_offers' and 'body' in urllib.parse.parse_qs(urllib.parse.urlsplit(path).query).get('select', [''])[0].split(','):
            params = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(path).query))
            # Final scoring consumes pages independently; large text pages
            # must use a small explicit limit rather than a giant response.
            if int(params.get('limit', 1000)) > 25:
                raise BridgeError(400, 'Lecture de descriptions limitée à 25 offres')
        if method != 'GET':
            active_lease(job, body.get('lease_token'))
        payload = scoped_body(table, body.get('body'), job)
        prefer = body.get('prefer')
        if prefer not in {None, 'return=minimal', 'resolution=ignore-duplicates,return=minimal',
                          'resolution=merge-duplicates,return=minimal'}:
            raise BridgeError(400, 'Option invalide')
        data = store.request(path, method, payload, prefer)
        if table == 'hunter_site_recipes' and method == 'GET':
            # Deleted public recipe markers prevent generic packs resurrecting
            # an admin-removed source. Never expose unpublished recipe content.
            removed = store.rows('hunter_site_recipes',
                'config->>deleted=eq.true&select=config&limit=100')
            from site_network import public_http_url
            markers = [{'status': 'deleted', 'config': {'listing_url': row['config']['listing_url'], 'deleted': True}}
                       for row in removed if public_http_url((row.get('config') or {}).get('listing_url'))]
            data = (data or []) + markers
        return data
    if action in {'fetch', 'search'}:
        active_lease(job, body.get('lease_token'))
        if action == 'fetch':
            from site_network import fetch_preview
            url = body.get('url')
            try:
                html, final_url = fetch_preview(url)
                return {'html': html, 'url': final_url, 'meta': {
                    'status': 'ok' if html else 'empty', 'http_status': 200,
                    'bytes_read': len(html.encode('utf-8'))}}
            except (ValueError, OSError) as error:
                message = str(error)[:240]
                code = re.search(r'HTTP (\d{3})', message)
                return {'html': '', 'url': url, 'meta': {
                    'status': 'http_error' if code else 'network_error',
                    'http_status': int(code[1]) if code else None,
                    'bytes_read': 0, 'error_type': type(error).__name__, 'error': message}}
        backend, query = body.get('backend'), body.get('query')
        if backend not in {'duckduckgo', 'yahoo', 'brave', 'brave_api', 'google', 'startpage', 'mojeek', 'searxng'}:
            raise BridgeError(400, 'Moteur invalide')
        if not isinstance(query, str) or len(query) > 1000:
            raise BridgeError(400, 'Recherche invalide')
        import stage_hunter
        results, trace = stage_hunter.search_backend_once(query, backend,
            min(20, max(1, int(body.get('limit', 8)))), str(body.get('region') or 'ch-fr')[:30], 10)
        # Third-party exceptions can contain configured URLs or credentials.
        # Keep structured status/error type, never return provider exception text.
        if trace.get('error_message'):
            trace = {**trace, 'error_message': 'La recherche externe n’a pas abouti'}
        return results, trace
    raise BridgeError(400, 'Action invalide')

"""Server network policy for user supplied listing URLs; never stored in profiles."""
from __future__ import annotations

import ipaddress
import re
import socket
from urllib.parse import urljoin, urlsplit, urlunsplit

import requests
import urllib3
from urllib3.util import Timeout


def public_http_url(url):
    try:
        if not isinstance(url, str) or len(url) > 2048 or any(ord(char) < 32 for char in url):
            return False
        p = urlsplit(url)
        host = p.hostname
        if p.scheme not in ('http', 'https') or not host or p.username or p.password or p.port not in (None, 80, 443):
            return False
        if host.lower() == 'localhost' or '.' not in host or host.endswith('.local'):
            return False
        try:
            return ipaddress.ip_address(host).is_global
        except ValueError:
            return True
    except (ValueError, TypeError):
        return False


def _resolved_ip(url):
    host = urlsplit(url).hostname
    try:
        addresses = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        if not addresses or not all(ipaddress.ip_address(row[4][0]).is_global for row in addresses):
            raise ValueError('Domaine non public')
        return addresses[0][4][0]
    except OSError as exc:
        raise ValueError('Domaine non résolu') from exc


def fetch_preview(url):
    """Bounded HTML fetch pinned to a checked IP at every redirect hop."""
    current = url
    for _ in range(4):
        if not public_http_url(current):
            raise ValueError('URL non publique ou domaine non résolu')
        parsed = urlsplit(current)
        ip = _resolved_ip(current)
        pool_type = urllib3.HTTPSConnectionPool if parsed.scheme == 'https' else urllib3.HTTPConnectionPool
        options = {'assert_hostname': parsed.hostname, 'server_hostname': parsed.hostname,
                   'ca_certs': requests.certs.where(), 'cert_reqs': 'CERT_REQUIRED'} if parsed.scheme == 'https' else {}
        pool = pool_type(ip, port=parsed.port or (443 if parsed.scheme == 'https' else 80), **options)
        path = urlunsplit(('', '', parsed.path or '/', parsed.query, ''))
        response = None
        try:
            response = pool.urlopen('GET', path, retries=False, redirect=False,
                preload_content=False, timeout=Timeout(connect=5, read=12),
                headers={'Host': parsed.netloc, 'User-Agent': 'JobHunter/1.0',
                         'Accept': 'text/html', 'Accept-Encoding': 'identity'})
            if response.status in (301, 302, 303, 307, 308):
                current = urljoin(current, response.headers.get('Location', ''))
                continue
            if response.status >= 400:
                raise ValueError(f'Page inaccessible (HTTP {response.status})')
            content_type = response.headers.get('Content-Type', '').lower()
            if content_type and 'html' not in content_type:
                raise ValueError('La page ne renvoie pas du HTML')
            chunks, size = [], 0
            for chunk in response.stream(65536):
                size += len(chunk)
                if size > 2_000_000: raise ValueError('Page HTML trop volumineuse')
                chunks.append(chunk)
            charset = re.search(r'charset=([\w-]+)', content_type)
            return b''.join(chunks).decode(charset.group(1) if charset else 'utf-8', errors='replace'), current
        finally:
            if response is not None:
                response.release_conn()
            pool.close()
    raise ValueError('Trop de redirections')

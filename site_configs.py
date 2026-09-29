"""Profile-owned listing recipes. Network policy deliberately lives in site_network.py."""
from __future__ import annotations

import re
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup
from soupsieve.util import SelectorSyntaxError

from site_network import public_http_url

FIELDS = ('detail_link', 'title', 'company', 'location', 'contract', 'date',
          'description', 'application_link')
LINK_FIELDS = {'detail_link', 'application_link'}


def validate_selector(value, label, required=False):
    if not isinstance(value, str) or len(value) > 180 or any(x in value for x in ('\x00', ':has(', ':contains(')):
        raise ValueError(f'Sélecteur {label} invalide')
    value = value.strip()
    if required and not value:
        raise ValueError(f'Sélecteur {label} requis')
    if value:
        try:
            BeautifulSoup('<html></html>', 'html.parser').select(value)
        except (SelectorSyntaxError, ValueError) as exc:
            raise ValueError(f'Sélecteur {label} invalide : {exc}') from exc
    return value


def validate_site(raw):
    if not isinstance(raw, dict):
        raise ValueError('Configuration de site invalide')
    name = str(raw.get('name') or '').strip()
    if not 1 <= len(name) <= 100:
        raise ValueError('Nom de site requis (100 caractères maximum)')
    url = str(raw.get('listing_url') or '').strip()
    placeholders = re.findall(r'\{([^{}]+)\}', url)
    if (not public_http_url(url) or len(url) > 2000
            or '{' in urlsplit(url).netloc or '}' in urlsplit(url).netloc
            or url.count('{') != len(placeholders) or url.count('}') != len(placeholders)
            or any(value not in ('keywords', 'location') for value in placeholders)):
        raise ValueError('URL de listing publique HTTP(S) requise')
    selectors = raw.get('selectors') or {}
    detail = raw.get('detail_selectors') or {}
    if not isinstance(selectors, dict) or not isinstance(detail, dict):
        raise ValueError('Sélecteurs invalides')
    card = validate_selector(selectors.get('card', ''), 'carte', True)
    fields = {key: validate_selector(selectors.get(key, ''), key, key in ('title', 'detail_link')) for key in FIELDS}
    details = {key: validate_selector(detail.get(key, ''), 'détail ' + key) for key in FIELDS if key != 'detail_link'}
    query = raw.get('query') or {}
    pagination = raw.get('pagination') or {}
    limits = raw.get('limits') or {}
    if not all(isinstance(x, dict) for x in (query, pagination, limits)):
        raise ValueError('Paramètres de parcours invalides')
    def param(value):
        value = str(value or '').strip()
        if value and not re.fullmatch(r'[A-Za-z][A-Za-z0-9_.-]{0,59}', value):
            raise ValueError('Nom de paramètre URL invalide')
        return value
    keyword = param(query.get('keyword_param'))
    location = param(query.get('location_param'))
    page_param = param(pagination.get('page_param'))
    next_selector = validate_selector(pagination.get('next_selector', ''), 'page suivante')
    if page_param and next_selector:
        raise ValueError('Choisir un paramètre de page ou un lien suivant')
    def integer(key, default, minimum, maximum, source):
        value = source.get(key, default)
        if isinstance(value, bool) or not str(value).isdigit() or not minimum <= int(value) <= maximum:
            raise ValueError(f'{key} doit être entre {minimum} et {maximum}')
        return int(value)
    return {
        'id': str(raw.get('id') or '').strip()[:80], 'name': name, 'listing_url': url,
        'enabled': bool(raw.get('enabled', False)),
        'query': {'keyword_param': keyword, 'location_param': location},
        'selectors': {'card': card, **fields}, 'detail_selectors': details,
        'pagination': {'next_selector': next_selector, 'page_param': page_param,
                       'start': integer('start', 1, 0, 100000, pagination),
                       'step': integer('step', 1, 1, 1000, pagination)},
        'limits': {'max_pages': integer('max_pages', 1, 1, 5, limits),
                   'max_offers': integer('max_offers', 40, 1, 100, limits),
                   'max_detail_pages': integer('max_detail_pages', 3, 0, 10, limits)},
    }


def profile_listing_url(site, profile):
    keyword = (profile.get('target') or {}).get('job_titles') or []
    country = (profile.get('location') or {}).get('countries') or []
    if isinstance(keyword, str): keyword = [keyword]
    if isinstance(country, str): country = [country]
    url = site['listing_url'].replace('{keywords}', quote(str(keyword[0]) if keyword else '', safe=''))
    url = url.replace('{location}', quote(str(country[0]) if country else '', safe=''))
    query = dict(parse_qsl(urlsplit(url).query, keep_blank_values=True))
    if site['query']['keyword_param'] and keyword:
        query[site['query']['keyword_param']] = str(keyword[0])
    if site['query']['location_param'] and country:
        query[site['query']['location_param']] = str(country[0])
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ''))


def _value(root, selector, base_url, link=False):
    if not selector:
        return ''
    node = root.select_one(selector)
    if not node:
        return ''
    if link:
        href = node.get('href') or node.get('data-url') or ''
        url = urljoin(base_url, href)
        return url if href and public_http_url(url) else ''
    return node.get_text(' ', strip=True)[:60000]


def extract_cards(html, url, site):
    soup = BeautifulSoup(html, 'html.parser')
    sel = site['selectors']
    offers = []
    seen = set()
    for card in soup.select(sel['card'])[:site['limits']['max_offers']]:
        offer = {key: _value(card, sel[key], url, key in LINK_FIELDS) for key in FIELDS}
        link = offer['detail_link']
        if link and link not in seen:
            seen.add(link)
            offers.append(offer)
    next_url = _value(soup, site['pagination']['next_selector'], url, True)
    return offers, next_url


def extract_detail(html, url, site):
    soup = BeautifulSoup(html, 'html.parser')
    return {key: _value(soup, selector, url, key in LINK_FIELDS)
            for key, selector in site['detail_selectors'].items()}


def missing_fields(offer):
    return [key for key in FIELDS if not offer.get(key)]


def page_url(url, site, index):
    param = site['pagination']['page_param']
    if not param:
        return url
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query[param] = str(site['pagination']['start'] + index * site['pagination']['step'])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ''))


def inspection_html(html, base_url):
    """Return an inert, bounded listing snapshot with stylesheets for the visual selector."""
    soup = BeautifulSoup(html, 'html.parser')
    for node in soup.select('script, noscript, iframe, object, embed, form, canvas, video, audio'):
        node.decompose()

    styles = []
    for link in soup.select('link[rel*="stylesheet"], link[as="style"]'):
        href = link.get('href')
        if href:
            target = urljoin(base_url, str(href))
            if public_http_url(target):
                link['href'] = target
                styles.append(str(link))
        link.decompose()

    for style in soup.select('style'):
        styles.append(str(style))
        style.decompose()

    for node in soup.find_all(True):
        for key in list(node.attrs):
            if key.startswith('on') or key in ('srcset', 'ping'):
                del node.attrs[key]
            elif key not in ('id', 'class', 'href', 'data-url', 'title', 'alt', 'role', 'style'):
                del node.attrs[key]
        for key in ('href', 'data-url'):
            if node.has_attr(key):
                target = urljoin(base_url, str(node[key]))
                if public_http_url(target): node[key] = target
                else: del node.attrs[key]
    root = soup.body or soup
    body_content = ''.join(str(child) for child in root.children)
    return (''.join(styles) + body_content)[:350_000]


def crawl_site(site, profile, fetch, with_details=False):
    """Use an injected network fetcher so previews and scans share extraction."""
    site = validate_site(site)
    base = profile_listing_url(site, profile)
    next_url = page_url(base, site, 0)
    listing_host = urlsplit(base).hostname
    seen_pages, seen_offers, offers = set(), set(), []
    pages = 0
    for index in range(site['limits']['max_pages']):
        if (not next_url or next_url in seen_pages or not public_http_url(next_url)
                or urlsplit(next_url).hostname not in (urlsplit(base).hostname, listing_host)): break
        seen_pages.add(next_url)
        html, final_url = fetch(next_url)
        pages += 1
        if not html: break
        listing_host = urlsplit(final_url).hostname
        cards, following = extract_cards(html, final_url, site)
        for offer in cards:
            if offer['detail_link'] in seen_offers: continue
            seen_offers.add(offer['detail_link'])
            offers.append(offer)
            if len(offers) >= site['limits']['max_offers']: break
        if len(offers) >= site['limits']['max_offers']: break
        next_url = page_url(base, site, index + 1) if site['pagination']['page_param'] else following
    if with_details:
        for offer in offers[:site['limits']['max_detail_pages']]:
            html, final_url = fetch(offer['detail_link'])
            if html:
                for key, value in extract_detail(html, final_url, site).items():
                    if value: offer[key] = value
    return {'listing_url': base, 'pages': pages, 'offers': offers,
            'missing': [missing_fields(offer) for offer in offers]}

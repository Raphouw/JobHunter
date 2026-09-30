"""Profile-owned listing recipes. Network policy deliberately lives in site_network.py."""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlencode, urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup
from soupsieve.util import SelectorSyntaxError

from site_network import public_http_url

FIELDS = ('detail_link', 'title', 'company', 'location', 'contract', 'date',
          'description', 'application_link', 'salary', 'work_time', 'experience', 'sector', 'education')
LINK_FIELDS = {'detail_link', 'application_link'}

COUNTRIES = {
    'FR': ('france',), 'CH': ('suisse', 'switzerland', 'schweiz'),
    'BE': ('belgique', 'belgium'), 'DE': ('allemagne', 'germany', 'deutschland'),
    'ES': ('espagne', 'spain', 'espana'), 'IT': ('italie', 'italy', 'italia'),
    'LU': ('luxembourg',),
}


def country_code(value):
    folded = ''.join(c for c in unicodedata.normalize('NFKD', str(value).strip())
                     if not unicodedata.combining(c)).lower()
    for code, aliases in COUNTRIES.items():
        if folded == code.lower() or folded in aliases:
            return code
    return folded.upper()


def country_matches(site, profile):
    countries = site.get('countries') or []
    wanted = (profile.get('location') or {}).get('countries') or []
    if isinstance(wanted, str): wanted = [wanted]
    return not countries or bool({country_code(c) for c in countries} & {country_code(c) for c in wanted})


def source_key(url):
    parts = urlsplit(url)
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip('/'), '', ''))


def source_disabled(url, profile):
    disabled = (profile.get('sources') or {}).get('disabled_sites') or []
    host = (urlsplit(url).hostname or '').lower().removeprefix('www.')
    return host in {(urlsplit(u).hostname or '').lower().removeprefix('www.') for u in disabled}


def reference_sites(profile):
    import yaml
    catalog = yaml.safe_load((Path(__file__).parent / 'config' / 'sources.yaml').read_text(encoding='utf-8')) or {}
    selected = (profile.get('sources') or {}).get('packs') or []
    result = {}
    for key, pack in catalog.get('packs', {}).items():
        if pack.get('countries'):
            if not country_matches(pack, profile): continue
        elif key not in selected:
            continue
        for url in pack.get('fixed_urls') or []:
            result.setdefault(url, {'name': urlsplit(url).netloc.removeprefix('www.'),
                              'listing_url': url, 'countries': pack.get('countries') or [],
                              'enabled': not source_disabled(url, profile)})
    return list(result.values())


def scan_sites(profile, shared):
    """Private recipes take precedence; disabled overrides also suppress shared recipes."""
    result, seen = [], set()
    private = (profile.get('sources') or {}).get('sites') or []
    for raw in [*private, *(row.get('config') or {} for row in shared)]:
        try:
            site = validate_site(raw)
        except (ValueError, TypeError):
            continue
        if not site['enabled'] or not country_matches(site, profile): continue
        key = source_key(site['listing_url'])
        if key in seen: continue
        seen.add(key)
        if site['enabled'] and country_matches(site, profile) and not source_disabled(site['listing_url'], profile):
            result.append(site)
    return result


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
    countries = raw.get('countries') or []
    if not isinstance(countries, list) or len(countries) > 20 or any(not isinstance(c, str) or len(c) > 60 for c in countries):
        raise ValueError('Liste de pays invalide')
    countries = list(dict.fromkeys(country_code(c) for c in countries if c.strip()))
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
    selectors_copy = dict(selectors)
    selectors_copy['detail_link'] = selectors.get('detail_link') or 'a'
    fields = {key: validate_selector(selectors_copy.get(key, ''), key, key in ('title', 'detail_link')) for key in FIELDS}
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
        'enabled': bool(raw.get('enabled', False)), 'countries': countries,
        'query': {'keyword_param': keyword, 'location_param': location},
        'selectors': {'card': card, **fields}, 'detail_selectors': details,
        'pagination': {'next_selector': next_selector, 'page_param': page_param,
                       'start': integer('start', 1, 0, 100000, pagination),
                       'step': integer('step', 1, 1, 1000, pagination)},
        'limits': {'max_pages': integer('max_pages', 1, 1, 5, limits),
                   'max_offers': integer('max_offers', 40, 1, 100, limits),
                   'max_detail_pages': integer('max_detail_pages', 3, 0, 10, limits)},
    }


COMMON_KEYWORD_PARAMS = ('term', 'q', 'query', 'keywords', 'keyword', 'k', 'what', 'search')
COMMON_LOCATION_PARAMS = ('loc', 'location', 'where', 'place', 'city', 'l')


def profile_listing_url(site, profile):
    keyword = (profile.get('target') or {}).get('job_titles') or []
    country = (profile.get('location') or {}).get('countries') or []
    if isinstance(keyword, str): keyword = [keyword]
    if isinstance(country, str): country = [country]
    if site.get('countries'):
        covered = {country_code(c) for c in site['countries']}
        country = [c for c in country if country_code(c) in covered]
    url = site['listing_url'].replace('{keywords}', quote(str(keyword[0]) if keyword else '', safe=''))
    url = url.replace('{location}', quote(str(country[0]) if country else '', safe=''))
    query = dict(parse_qsl(urlsplit(url).query, keep_blank_values=True))

    kw_param = site['query'].get('keyword_param')
    if not kw_param and keyword:
        for candidate in COMMON_KEYWORD_PARAMS:
            if candidate in query:
                kw_param = candidate
                break
    if kw_param and keyword:
        query[kw_param] = str(keyword[0])

    loc_param = site['query'].get('location_param')
    if not loc_param and country:
        for candidate in COMMON_LOCATION_PARAMS:
            if candidate in query:
                loc_param = candidate
                break
    if loc_param and country:
        query[loc_param] = str(country[0])

    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ''))


def _value(root, selector, base_url, link=False):
    if not link:
        if selector in ('.', 'self', 'this'):
            return root.get_text(' ', strip=True)[:60000]
        if not selector:
            return ''
        node = root.select_one(selector)
        return node.get_text(' ', strip=True)[:60000] if node else ''

    # Link resolution
    node = None
    if selector and selector not in ('.', 'self', 'this', 'a'):
        node = root.select_one(selector)
    if not node or not (node.get('href') or node.get('data-url')):
        if getattr(root, 'name', '') == 'a' and (root.get('href') or root.get('data-url')):
            node = root
        elif hasattr(root, 'find_parent') and root.find_parent('a') and (root.find_parent('a').get('href') or root.find_parent('a').get('data-url')):
            node = root.find_parent('a')
        elif hasattr(root, 'find') and root.find('a', href=True):
            node = root.find('a', href=True)
        elif selector:
            node = root.select_one(selector)

    if not node:
        return ''
    href = node.get('href') or node.get('data-url') or ''
    url = urljoin(base_url, href)
    return url if href and public_http_url(url) else ''


def extract_cards(html, url, site):
    soup = BeautifulSoup(html, 'html.parser')
    sel = site['selectors']
    offers = []
    seen = set()
    cards = soup.select(sel['card']) if sel.get('card') else []
    for card in cards[:site['limits']['max_offers']]:
        offer = {key: _value(card, sel.get(key, ''), url, key in LINK_FIELDS) for key in FIELDS}
        link = offer['detail_link']
        if not link:
            link = _value(card, 'a', url, True)
            offer['detail_link'] = link
        if link and link not in seen:
            seen.add(link)
            offers.append(offer)
    next_url = _value(soup, site['pagination'].get('next_selector', ''), url, True)
    return offers, next_url


def extract_detail(html, url, site):
    soup = BeautifulSoup(html, 'html.parser')
    details = {key: _value(soup, selector, url, key in LINK_FIELDS)
               for key, selector in site.get('detail_selectors', {}).items() if selector}
    # Intelligent fallback for description if not captured by configured selector
    if not details.get('description'):
        for cand in soup.select('[data-cy*="description"], [data-testid*="description"], .job-description, .vacancy-description, #job-description, article, .description, main'):
            text = cand.get_text(' ', strip=True)
            if len(text) > 80:
                details['description'] = text[:60000]
                break
    return details


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
    for node in soup.select('script, noscript, iframe, object, embed, canvas, video, audio'):
        node.decompose()
    for node in soup.select('form'):
        node.unwrap()

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
            elif key not in ('id', 'class', 'href', 'data-url', 'title', 'alt', 'role', 'style', 'width', 'height') and not key.startswith('data-'):
                del node.attrs[key]
        for key in ('href', 'data-url'):
            if node.has_attr(key):
                target = urljoin(base_url, str(node[key]))
                if public_http_url(target): node[key] = target
                else: del node.attrs[key]
    root = soup.body or soup
    body_content = str(root) if soup.body else ''.join(str(child) for child in root.children)
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

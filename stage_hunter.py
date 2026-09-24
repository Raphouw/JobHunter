from __future__ import annotations
import argparse, base64, calendar, hashlib, ipaddress, json, os, random, re, sqlite3, threading, time, unicodedata, zlib
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from html import unescape as html_unescape
from pathlib import Path
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode, unquote, urljoin
import pandas as pd, requests, yaml
from bs4 import BeautifulSoup
from ddgs import DDGS
from dotenv import load_dotenv
from rapidfuzz.fuzz import ratio, token_set_ratio
from requests.adapters import HTTPAdapter
from rich.console import Console
from rich import box
from rich.table import Table
from rich.text import Text
from trafilatura import extract
from urllib3.util import Retry
import connectors
import regions

import sys
if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass
if hasattr(sys.stderr, 'reconfigure'):
    try: sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception: pass
ROOT=Path(__file__).resolve().parent; load_dotenv(ROOT/'.env'); console=Console()
VERSION='6.2.7'
PRODUCT_NAME='Job Hunter'
SUPPORTED_SEARCH_BACKENDS=('duckduckgo','yahoo','brave','google','startpage','mojeek')
SEARCH_BACKEND_ALIASES={'bing':'yahoo'}
RUN_STARTED=time.perf_counter();RUN_STARTED_AT=datetime.now(timezone.utc)
SCAN_METRICS={'phases':{},'web':{},'fixed_sites':{},'recommendations':[]}
RESUME_RUNTIME_KEYS=(
    'MAX_TOTAL_DETAIL_PAGES','MAX_RECURSIVE_LEADS','MAX_LISTING_DETAILS','LISTING_CRAWL_DEPTH',
    'MAX_LEADS_PER_SUBLISTING','MIN_LISTING_LEAD_PRIORITY','SCAN_TIME_BUDGET_SECONDS',
    'SCAN_DEADLINE_RESERVE_SECONDS','MIN_OPPORTUNITY_SCORE','SCRAPE_WORKERS',
    'MAX_IN_FLIGHT_PAGES','MAX_RESPONSE_BYTES','HTTP_TIMEOUT_SECONDS','HTTP_RETRIES',
)
DECISION_AUDIT_PATH=None
_DECISION_AUDIT_HANDLE=None
_DECISION_AUDIT_COUNT=0
PROFILE=ROOT/'config'/'profiles'/'raphael.yaml';ACTIVE_PROFILE={};ACTIVE_PROFILE_ID='raphael'
DB=ROOT/'output'/ACTIVE_PROFILE_ID/'stage_hunter.sqlite3'; OUT=ROOT/'output'/ACTIVE_PROFILE_ID/'stage_hunter.xlsx'; LISTING_LEADS_OUT=ROOT/'output'/ACTIVE_PROFILE_ID/'stage_hunter_listing_leads.xlsx'; REJECTIONS_OUT=ROOT/'output'/ACTIVE_PROFILE_ID/'stage_hunter_rejections.xlsx'; DIAGNOSTICS=ROOT/'output'/ACTIVE_PROFILE_ID/'stage_hunter_diagnostics.json'
CREDS=ROOT/'credentials'; SECRET=CREDS/'google_client_secret.json'; TOKEN=CREDS/'google_token.json'
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36'
HEADERS={
    'User-Agent':UA,
    'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language':'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7,de;q=0.5',
    'Sec-Fetch-Mode':'navigate','Sec-Fetch-Site':'cross-site'
}
_HTTP_LOCAL=threading.local()
SCOPES=['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/gmail.readonly']
OP_HEADERS=['Action','Score /100','Confiance','Entreprise','Offre','Ville / lieu','Canton','Langue','Durée','Début','Domaine','Compétences détectées','Pourquoi','Source','Lien','Date découverte','ID Stage Hunter']
RESPONSE_HEADERS=['Canton','Nom Entreprise',"Ville de l'Entreprise","Secteur d'activité","Activité détaillée (l'entreprise)",'Lien 1','Lien 2','Lien 3','Statut de la démarche effectuée',"Note /10 (A combien ça m'intéresse)",'Statut actuel','Email de contact','Retours']
ACTION_LOG_TAB='_StageHunter_Actions'
CANTONS={
    'AR':('Appenzell Rhodes-Extérieures','AL',['appenzell ausserrhoden','appenzell rhodes-extérieures','herisau']),
    'AI':('Appenzell Rhodes-Intérieures','AL',['appenzell innerrhoden','appenzell rhodes-intérieures','appenzell']),
    'AG':('Argovie','AL',['aargau','argovie','aarau','baden']),
    'BL':('Bâle-Campagne','AL',['basel-landschaft','bâle-campagne','liestal']),
    'BS':('Bâle-Ville','AL',['basel-stadt','bâle-ville','basel','bâle']),
    'BE':('Berne','AL/FR',['bern','berne','biel','bienne','thun']),
    'FR':('Fribourg','FR/AL',['fribourg','freiburg','bulle']),
    'GE':('Genève','FR',['geneva','genève','geneve']),
    'GL':('Glaris','AL',['glarus','glaris']),
    'GR':('Grisons','AL/ROM/IT',['graubünden','graubunden','grisons','chur','coire']),
    'JU':('Jura','FR',['delémont','delemont','jura']),
    'LU':('Lucerne','AL',['lucerne','luzern']),
    'NE':('Neuchâtel','FR',['neuchâtel','neuchatel']),
    'NW':('Nidwald','AL',['nidwalden','nidwald','stans']),
    'OW':('Obwald','AL',['obwalden','obwald','sarnen']),
    'SG':('Saint-Gall','AL',['st. gallen','st gallen','saint-gall','sankt gallen']),
    'SH':('Schaffhouse','AL',['schaffhausen','schaffhouse']),
    'SZ':('Schwytz','AL',['schwyz','schwytz']),
    'SO':('Soleure','AL',['solothurn','soleure']),
    'TI':('Tessin','IT',['ticino','tessin','lugano','bellinzona']),
    'TG':('Thurgovie','AL',['thurgau','thurgovie','frauenfeld']),
    'UR':('Uri','AL',['uri','altdorf']),
    'VS':('Valais','FR/AL',['valais','wallis','sion','martigny','visp']),
    'VD':('Vaud','FR',['vaud','lausanne','yverdon','nyon','renens','ecublens']),
    'ZG':('Zoug','AL',['zug','zoug','rotkreuz']),
    'ZH':('Zurich','AL',['zurich','zürich','winterthur'])
}
COUNTRY_ALIASES={
    'switzerland':['switzerland','suisse','schweiz','svizzera','ch'],
    'france':['france','fr'],
    'belgium':['belgium','belgique','belgie','be'],
    'germany':['germany','deutschland','allemagne','de'],
    'luxembourg':['luxembourg','lu'],
    'italy':['italy','italia','italie','it'],
    'spain':['spain','espana','espagne','es'],
    'austria':['austria','osterreich','autriche','at'],
    'netherlands':['netherlands','nederland','pays-bas','nl'],
    'united kingdom':['united kingdom','uk','england','great britain','royaume-uni'],
    'united states':['united states','united states of america','usa','us'],
    'canada':['canada','ca']
}
TRACKING_QUERY_KEYS={'fbclid','gclid','dclid','msclkid','source','src','uid','mid','ref','refid','campaign','campaign_id','ad_id','mc_cid','mc_eid','sourceid'}
EXCEL_ILLEGAL_RE=re.compile(r'[\x00-\x08\x0B\x0C\x0E-\x1F]')
AGGREGATOR_HOSTS={
    'ch.indeed.com','indeed.com','fr.glassdoor.ch','glassdoor.ch','glassdoor.com',
    'iagora.com','jooble.org','ch.jooble.org','emploisuisse.com','meetfrank.com',
    'englishjobsearch.ch','developerjobs.ch','robotik.jobs'
}
JOB_BOARD_HOSTS=AGGREGATOR_HOSTS|{'jobs.ch','jobup.ch','jobscout24.ch','linkedin.com','ch.linkedin.com','swissdevjobs.ch','eth-gethired.ch'}
VERIFIED_DIRECT_HOSTS={
    'jobs.ethz.ch','careers.cern','sentec.com','careers.roche.com','careers.stryker.com',
    'careers.abb.com','jobs.siemens.com','careers.hitachi.com','careers.bobst.com',
    'careers.sensirion.com','jobs.sensirion.com','jobs.logitech.com','jobs.sonova.com',
    'careers.zimmerbiomet.com','careers.zimmer.com','leica-geosystems.com','u-blox.com',
}
LISTING_TITLE_PHRASES=(
    'all jobs','alle jobs','todas as posições','todas as posicoes','jobs at ','jobs in switzerland',
    'emplois en suisse','internships in switzerland','internship offers','career opportunities',
    'student & university opportunities','students switzerland','join our team','job search results',
    'offres de stage','offres d’emploi','offres d\'emploi','stellenangebote','freie stellen'
)
APPLICATION_CONFIRMATION_PHRASES=(
    'thank you for applying','thanks for applying','application received','we received your application',
    'your application has been received','application confirmation','candidature reçue','candidature recue',
    'merci pour votre candidature','nous avons reçu votre candidature','nous avons bien reçu votre candidature',
    'bewerbung erhalten','vielen dank für deine bewerbung','vielen dank für ihre bewerbung'
)
INTERNSHIP_TITLE_PATTERNS=(
    r'\bintern(?:ship)?\b',r'\bstage\b',r'\bstagiaire\b',r'\bpraktikum\b',r'\btrainee\b',
    r'\bstage\s+(?:ingenieur|de fin|pfe|\(|en\b)',r'\bstudentship\b',
    r'\bstudent\s+(?:programme|program|placement|intern|job|opportunity)\b',
    r'\btechnical\s+student\b',r'\bshort[- ]term\s+internship\b',
    r'\bmaster(?:\'s)?\s+thesis\b',r'\bthesis\s+(?:student|internship|project)\b',
    r'\bpfe\b',r'\balternance\b',r'\bapprentice(?:ship)?\b',r'\bwerkstudent\b'
)
HOBBY_ONLY_TERMS={
    'velo','vélo','cyclisme','cycling','sport','fitness','football','running','course a pied',
    'gaming','jeu video','jeux video','musique','cinema','voyage','lecture'
}
WEAK_RELEVANCE_TERMS={
    'application','applications','site','web','development','developpement','développement',
    'informatique','computer science','software','it','ia','ai','technologie','technology',
    'langage de programmation','programming'
}
MONTHS={
    'january':1,'janvier':1,'januar':1,'february':2,'février':2,'fevrier':2,'februar':2,
    'march':3,'mars':3,'märz':3,'maerz':3,'april':4,'avril':4,'mai':5,'may':5,
    'june':6,'juin':6,'juni':6,'july':7,'juillet':7,'juli':7,'august':8,'août':8,
    'aout':8,'september':9,'septembre':9,'oktober':10,'october':10,'octobre':10,
    'november':11,'novembre':11,'dezember':12,'december':12,'décembre':12,'decembre':12
}

def norm(s): return re.sub(r'\s+',' ',html_unescape(str(s or ''))).strip()
def fold_text(s):return ''.join(x for x in unicodedata.normalize('NFD',norm(s).lower()) if unicodedata.category(x)!='Mn')

RELATED_CONTENT_MARKER=re.compile(
    r'(?i)\b(?:similar jobs|related jobs|jobs you may like|you may also like|also viewed|'
    r'ähnliche jobs|aehnliche jobs|weitere stellenangebote|offres similaires|emplois similaires)\b'
)

def job_relevant_text(text,html='',structured=None):
    """Keep the actual job description and discard navigation/recommended jobs."""
    structured=structured or {}
    description=norm(structured.get('description',''))
    if description:
        # JSON-LD is scoped to this posting and is safer than page-wide text.
        return description[:60_000]
    source=str(text or '')
    if html:
        soup=BeautifulSoup(html,'html.parser')
        for node in soup(['script','style','noscript','nav','footer','header','aside']):node.decompose()
        for node in list(soup.find_all(['section','div','ul','aside'])):
            heading=node.find(['h1','h2','h3','h4','strong'])
            if heading and RELATED_CONTENT_MARKER.search(norm(heading.get_text(' ',strip=True))):
                node.decompose()
        main=soup.find(['main','article'])
        if main:
            extracted=norm(main.get_text(' ',strip=True))
            if len(extracted)>len(source)*0.4:source=extracted
    match=RELATED_CONTENT_MARKER.search(source)
    if match:source=source[:match.start()]
    return norm(source)[:60_000]
def dom(u): return urlparse(u).netloc.lower().replace('www.','')
def slugify(value):
    value=''.join(x for x in unicodedata.normalize('NFD',str(value or '')) if unicodedata.category(x)!='Mn').lower()
    return re.sub(r'[^a-z0-9]+','-',value).strip('-') or 'profil'

def resolve_profile_path(profile_ref=None):
    if not profile_ref:return ROOT/'config'/'profiles'/'raphael.yaml' if (ROOT/'config'/'profiles'/'raphael.yaml').exists() else ROOT/'config'/'profile.yaml'
    candidate=Path(profile_ref)
    if candidate.exists():return candidate.resolve()
    if not candidate.suffix:candidate=candidate.with_suffix('.yaml')
    candidate=ROOT/'config'/'profiles'/candidate.name
    if candidate.exists():return candidate.resolve()
    wanted=slugify(Path(str(profile_ref)).stem)
    for path in (ROOT/'config'/'profiles').glob('*.yaml'):
        if slugify(path.stem)==wanted:return path.resolve()
        try:
            content=yaml.safe_load(path.read_text(encoding='utf-8')) or {}
        except yaml.YAMLError:
            continue
        if wanted in {slugify(content.get('id')),slugify(content.get('name'))}:return path.resolve()
    raise FileNotFoundError(f'Profil introuvable : {profile_ref}')

def load_source_catalog():
    path=ROOT/'config'/'sources.yaml'
    if not path.exists():return {}
    return yaml.safe_load(path.read_text(encoding='utf-8')) or {}

def load_profile(profile_ref=None):
    path=resolve_profile_path(profile_ref);profile=yaml.safe_load(path.read_text(encoding='utf-8')) or {}
    sources=profile.setdefault('sources',{});catalog=load_source_catalog().get('packs',{})
    configured_countries=(profile.get('location') or {}).get('countries') or (profile.get('location') or {}).get('country') or []
    if isinstance(configured_countries,str):configured_countries=[configured_countries]
    def canonical_country(value):
        folded=fold_text(value)
        for canonical,aliases in COUNTRY_ALIASES.items():
            if folded==canonical or folded in {fold_text(alias) for alias in aliases}:return canonical
        return folded
    wanted_countries={canonical_country(value) for value in configured_countries}
    pack_queries=[];pack_domains=[];pack_urls=[]
    for pack_name in sources.get('packs',[]) or []:
        pack=catalog.get(str(pack_name),{}) or {}
        pack_countries={canonical_country(value) for value in pack.get('countries',[]) or []}
        if pack_countries and wanted_countries and not (pack_countries & wanted_countries):
            continue
        pack_queries.extend(pack.get('queries',[]) or [])
        pack_domains.extend(pack.get('domains',[]) or [])
        pack_urls.extend(pack.get('fixed_urls',[]) or [])
    pack_domains.extend(sources.get('custom_domains',[]) or [])
    pack_urls.extend(sources.get('custom_urls',[]) or [])
    profile['_profile_path']=str(path)
    profile['_source_pack_queries']=list(dict.fromkeys(norm(x) for x in pack_queries if norm(x)))
    profile['_source_pack_domains']=list(dict.fromkeys(norm(x) for x in pack_domains if norm(x)))
    profile['_source_pack_urls']=list(dict.fromkeys(norm(x) for x in pack_urls if norm(x)))
    return profile

def configure_runtime(profile):
    global PROFILE,ACTIVE_PROFILE,ACTIVE_PROFILE_ID,DB,OUT,LISTING_LEADS_OUT,REJECTIONS_OUT,DIAGNOSTICS,SECRET,TOKEN,SCAN_METRICS
    ACTIVE_PROFILE=profile;PROFILE=Path(profile['_profile_path']);ACTIVE_PROFILE_ID=slugify(profile.get('id') or profile.get('name') or PROFILE.stem)
    output_dir=ROOT/'output'/ACTIVE_PROFILE_ID
    DB=output_dir/'stage_hunter.sqlite3';OUT=output_dir/'stage_hunter.xlsx';LISTING_LEADS_OUT=output_dir/'stage_hunter_listing_leads.xlsx';REJECTIONS_OUT=output_dir/'stage_hunter_rejections.xlsx';DIAGNOSTICS=output_dir/'stage_hunter_diagnostics.json'
    google=(profile.get('integrations') or {}).get('google') or {}
    secret_path=google.get('client_secret_file');token_path=google.get('token_file')
    SECRET=(ROOT/secret_path).resolve() if secret_path else CREDS/'google_client_secret.json'
    TOKEN=(ROOT/token_path).resolve() if token_path else CREDS/'google_token.json'
    SCAN_METRICS={'phases':{},'web':{},'fixed_sites':{},'recommendations':[]}
    return ACTIVE_PROFILE_ID
def has_term(text,term):return bool(re.search(r'(?<!\w)'+re.escape(str(term).lower())+r'(?!\w)',text.lower()))
def elapsed_label(start=None):
    seconds=int(time.perf_counter()-(RUN_STARTED if start is None else start)); return f'{seconds//60:02d}:{seconds%60:02d}'
def log_event(message,style=''):
    console.print(Text('['+elapsed_label()+']',style='dim'),Text(' '+str(message),style=style))
def short_text(value,limit=78):
    value=norm(value); return value if len(value)<=limit else value[:limit-1]+'…'
def format_canton(code):
    name,languages,_=CANTONS[code]; return f'{name} | {code} | {languages}'

def profile_regions(profile):
    location=profile.get('location') or {};items=list(location.get('regions') or location.get('priority_regions') or [])
    # A profile created from the interface only needs a list of preferred
    # places. Treat them as simple regions until richer aliases are added.
    known={fold_text(item.get('name') if isinstance(item,dict) else item) for item in items}
    for place in (location.get('priority_locations',[]) or []) + (location.get('priority_cantons',[]) or []):
        folded=fold_text(place)
        if folded and folded not in known:
            items.append(place); known.add(folded)
    out=[]
    for item in items:
        if isinstance(item,str):out.append({'name':item,'code':'','languages':'','aliases':[item]})
        elif isinstance(item,dict):
            name=norm(item.get('name') or item.get('label') or item.get('code'))
            if name:out.append({'name':name,'code':norm(item.get('code')),'languages':norm(item.get('languages')),'aliases':list(item.get('aliases') or [])+[name]})
    return out

def format_region(region):
    parts=[region.get('name',''),region.get('code',''),region.get('languages','')]
    return ' | '.join(x for x in parts if x)

def country_aliases(value):
    folded=fold_text(value)
    for canonical,aliases in COUNTRY_ALIASES.items():
        if folded==canonical or folded in [fold_text(x) for x in aliases]:return canonical,aliases
    return folded,[str(value)]

def preferred_search_region(profile):
    explicit=norm(os.getenv('SEARCH_REGION',''))
    if explicit:return explicit
    configured=norm((profile.get('search') or {}).get('region'))
    if configured:return configured
    countries=(profile.get('location') or {}).get('countries') or (profile.get('location') or {}).get('country') or []
    if isinstance(countries,str):countries=[countries]
    canonical=country_aliases(countries[0])[0] if countries else ''
    return {
        'switzerland':'ch-fr','france':'fr-fr','belgium':'be-fr','germany':'de-de',
        'luxembourg':'lu-fr','italy':'it-it','spain':'es-es','austria':'at-de',
        'netherlands':'nl-nl','united kingdom':'uk-en','united states':'us-en',
        'canada':'ca-en',
    }.get(canonical,'wt-wt')
def unwrap_url(u):
    """Extract the destination hidden in email tracking or rewrite Indeed /rc/clk."""
    current=(u or '').replace('&amp;','&').strip()
    for _ in range(3):
        try:
            parsed=urlparse(current)
            q=dict(parse_qsl(parsed.query,keep_blank_values=True))
        except Exception:
            break
        host=(parsed.hostname or '').lower()
        if 'indeed.' in host and parsed.path.startswith('/rc/clk') and 'jk' in q:
            current=f"{parsed.scheme or 'https'}://{parsed.netloc}/viewjob?jk={q['jk']}"
            break
        target=next((unquote(q[k]) for k in ('url','u','target','redirect','redirect_url','destination','dest','q') if k in q and unquote(q[k]).startswith(('http://','https://'))),None)
        if not target or target==current:break
        current=target
    return current

def safe_public_url(u):
    """Reject malformed/local URLs before requests follows them."""
    try:
        p=urlparse(u); host=(p.hostname or '').lower()
        if p.scheme not in ('http','https') or not host or host in ('localhost','www') or '.' not in host:return False
        try:
            ip=ipaddress.ip_address(host)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:return False
        except ValueError:
            pass
        return True
    except Exception:
        return False

def canon(u):
    try:
        u=unwrap_url(u)
        p=urlparse(u); qs=[(k,v) for k,v in parse_qsl(p.query,keep_blank_values=True) if k.lower() not in TRACKING_QUERY_KEYS and not k.lower().startswith(('utm_','trk','tracking'))]
        return urlunparse((p.scheme.lower() or 'https',p.netloc.lower(),p.path.rstrip('/'),'',urlencode(qs),''))
    except: return u

def candidate_identity(url):
    """Use a board's stable job ID to collapse language and tracking variants."""
    canonical=canon(url or '')
    parsed=urlparse(canonical)
    host=(parsed.hostname or '').lower().removeprefix('www.')
    path=unquote(parsed.path).lower()
    if host in {'jobs.ch','jobup.ch','jobscout24.ch'}:
        match=re.search(r'/detail/([0-9a-f]{8}-[0-9a-f-]{27,})\b',path)
        if match:return 'swissboard:'+match.group(1)
    if host.endswith('linkedin.com'):
        match=re.search(r'/jobs/view/(?:[^/?#]*-)?(\d{7,})(?:$|[/?#])',path)
        if match:return 'linkedin:'+match.group(1)
    if host.endswith('iagora.com'):
        match=re.search(r'/offer/[^/?#]+/(\d{6,})(?:$|/)',path)
        if match:return 'iagora:'+match.group(1)
    if 'glassdoor.' in host:
        query=dict(parse_qsl(parsed.query))
        job_id=query.get('jl') or query.get('jobListingId') or query.get('jobId')
        if job_id and job_id.isdigit():return 'glassdoor:'+job_id
    return canonical

def init_db():
    DB.parent.mkdir(parents=True,exist_ok=True); c=sqlite3.connect(DB,timeout=30)
    c.execute('PRAGMA journal_mode=WAL');c.execute('PRAGMA busy_timeout=30000')
    c.execute('''CREATE TABLE IF NOT EXISTS offers(id INTEGER PRIMARY KEY,url TEXT UNIQUE,title TEXT,company TEXT,location TEXT,source TEXT,snippet TEXT,body TEXT,language TEXT,discovered_at TEXT,score REAL,status TEXT DEFAULT 'new',reasons TEXT,gmail_seen INTEGER DEFAULT 0)''')
    existing={x[1] for x in c.execute('PRAGMA table_info(offers)')}
    added=set()
    for name,typ in [('canonical_url','TEXT'),('canton','TEXT'),('duration','TEXT'),('start_date','TEXT'),('domain_category','TEXT'),('skills_found','TEXT'),('confidence','REAL'),('page_type','TEXT'),('review_decision','TEXT'),('reviewed_at','TEXT'),('review_note','TEXT'),('sheet_synced','INTEGER DEFAULT 0'),('availability_status',"TEXT DEFAULT 'unknown'"),('availability_reason','TEXT'),('last_checked_at','TEXT'),('fingerprint','TEXT'),('learned_adjustment','REAL DEFAULT 0')]:
        if name not in existing:c.execute(f'ALTER TABLE offers ADD COLUMN {name} {typ}');added.add(name)
    # Rows still marked ``new`` may come from a scan that finished before the
    # Tinder workflow was installed. Put them in the review queue. The Sheet
    # import below will mark rows already present remotely as synchronized.
    if 'review_decision' in added:
        c.execute("""UPDATE offers SET review_decision=CASE
            WHEN status='kept' THEN 'keep' WHEN status='deleted' THEN 'reject'
            WHEN status='new' THEN 'pending' ELSE 'unsure' END""")
    if 'sheet_synced' in added:
        c.execute("UPDATE offers SET sheet_synced=CASE WHEN status='new' THEN 0 ELSE 1 END")
    c.execute('''CREATE TABLE IF NOT EXISTS review_events(
        id INTEGER PRIMARY KEY,offer_id INTEGER NOT NULL,previous_decision TEXT,previous_status TEXT,
        decision TEXT NOT NULL,created_at TEXT NOT NULL)''')
    c.execute('''CREATE TABLE IF NOT EXISTS profile_settings(
        key TEXT PRIMARY KEY,value TEXT,updated_at TEXT NOT NULL)''')
    c.execute('''CREATE TABLE IF NOT EXISTS source_metrics(
        source TEXT NOT NULL,channel TEXT NOT NULL,runs INTEGER DEFAULT 0,attempts INTEGER DEFAULT 0,
        links INTEGER DEFAULT 0,retained INTEGER DEFAULT 0,rejected INTEGER DEFAULT 0,closed INTEGER DEFAULT 0,
        listings INTEGER DEFAULT 0,elapsed_ms INTEGER DEFAULT 0,last_run TEXT,
        PRIMARY KEY(source,channel))''')
    c.execute('''CREATE TABLE IF NOT EXISTS scan_runs(
        id INTEGER PRIMARY KEY,started_at TEXT NOT NULL,finished_at TEXT,profile_id TEXT,
        settings_json TEXT,summary_json TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS sheet_sync(
        offer_id INTEGER NOT NULL,sheet_id TEXT NOT NULL,tab TEXT NOT NULL,content_hash TEXT,
        synced_at TEXT NOT NULL,PRIMARY KEY(offer_id,sheet_id,tab))''')
    google=(ACTIVE_PROFILE.get('integrations') or {}).get('google') or {}
    db_settings={row[0]:row[1] for row in c.execute("SELECT key,value FROM profile_settings WHERE key LIKE 'google_%'")}
    settings={'google_sheet_id':google.get('sheet_id'),'google_response_tab':google.get('response_tab'),'google_opportunity_tab':google.get('opportunity_tab')}
    now=datetime.now(timezone.utc).isoformat()
    for key,value in settings.items():
        if norm(value):
            c.execute('INSERT INTO profile_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',(key,str(value),now))
    if not norm(google.get('sheet_id')) and db_settings.get('google_sheet_id'):
        google['sheet_id']=db_settings['google_sheet_id']
    if not norm(google.get('response_tab')) and db_settings.get('google_response_tab'):google['response_tab']=db_settings['google_response_tab']
    if not norm(google.get('opportunity_tab')) and db_settings.get('google_opportunity_tab'):google['opportunity_tab']=db_settings['google_opportunity_tab']
    c.commit(); return c

def set_profile_settings(values):
    DB.parent.mkdir(parents=True,exist_ok=True)
    with closing(sqlite3.connect(DB,timeout=30)) as connection, connection:
        connection.execute('''CREATE TABLE IF NOT EXISTS profile_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT NOT NULL)''')
        now=datetime.now(timezone.utc).isoformat()
        for key,value in values.items():
            connection.execute('INSERT INTO profile_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',(key,str(value or ''),now))

def get_profile_setting(key,default=''):
    if not DB.exists():return default
    try:
        with closing(sqlite3.connect(DB,timeout=10)) as connection, connection:
            row=connection.execute('SELECT value FROM profile_settings WHERE key=?',(key,)).fetchone()
            return row[0] if row else default
    except sqlite3.Error:return default

def metric_source(value):
    match=re.search(r'\bsite:([^\s]+)',str(value or ''),re.I)
    return (match.group(1).lower().removeprefix('www.') if match else '__web_generic__')

def record_source_metric(c,source,channel,attempts=0,links=0,retained=0,rejected=0,closed=0,listings=0,elapsed_ms=0):
    """Accumulate source yield so future scans can prioritize useful routes."""
    if c is None:return
    source=norm(source) or 'unknown';now=datetime.now(timezone.utc).isoformat()
    c.execute('''INSERT INTO source_metrics(source,channel,runs,attempts,links,retained,rejected,closed,listings,elapsed_ms,last_run)
        VALUES(?,?,1,?,?,?,?,?,?,?,?)
        ON CONFLICT(source,channel) DO UPDATE SET
        runs=runs+1,attempts=attempts+excluded.attempts,links=links+excluded.links,
        retained=retained+excluded.retained,rejected=rejected+excluded.rejected,
        closed=closed+excluded.closed,listings=listings+excluded.listings,
        elapsed_ms=elapsed_ms+excluded.elapsed_ms,last_run=excluded.last_run''',
        (source,channel,int(attempts),int(links),int(retained),int(rejected),int(closed),int(listings),int(elapsed_ms),now))

def source_health(c,channel=None):
    if c is None:return {}
    sql='SELECT source,channel,runs,attempts,links,retained,rejected,closed,listings,elapsed_ms FROM source_metrics'
    params=()
    if channel:sql+=' WHERE channel=?';params=(channel,)
    result={}
    for row in c.execute(sql,params):
        source,kind,runs,attempts,links,retained,rejected,closed,listings,elapsed_ms=row
        productivity=(retained or links or 0)/max(1,attempts or runs or 1)
        result[(source,kind)]={'runs':runs,'attempts':attempts,'links':links,'retained':retained,'rejected':rejected,'closed':closed,'listings':listings,'elapsed_ms':elapsed_ms,'productivity':productivity}
    return result

def rank_search_queries(c,queries):
    """Stable adaptive ordering: proven sources first, unknown next, repeatedly empty last."""
    health=source_health(c,'web')
    def priority(item):
        index,query=item;data=health.get((metric_source(query),'web')) or {}
        attempts=data.get('attempts',0);links=data.get('links',0)
        if links:return (0,-links/max(1,attempts),index)
        if attempts>=8:return (2,attempts,index)
        return (1,0,index)
    ordered=[query for _,query in sorted(enumerate(queries),key=priority)]
    return ordered

def rank_fixed_urls(c,urls):
    """Put historically productive listings first without hiding new sources."""
    if c is None:return list(urls)
    fixed=source_health(c,'fixed');outcomes=source_health(c,'outcome')
    def priority(item):
        index,url=item;source=dom(url)
        route=fixed.get((source,'fixed')) or {};outcome=outcomes.get((source,'outcome')) or {}
        retained=int(outcome.get('retained',0) or 0);links=int(route.get('links',0) or 0);attempts=int(route.get('attempts',0) or 0)
        if retained:return (0,-retained,index)
        if links:return (1,-links/max(1,attempts),index)
        if attempts>=4:return (3,attempts,index)
        return (2,0,index)
    return [url for _,url in sorted(enumerate(urls),key=priority)]

def preference_tokens(*values):
    text=fold_text(' '.join(norm(value) for value in values if value))
    stop={fold_text(x) for x in WEAK_RELEVANCE_TERMS|HOBBY_ONLY_TERMS}|{
        'intern','internship','stage','job','emploi','engineer','engineering','ingenieur','offre','poste',
        'senior','junior','full','time','temps','pour','avec','dans','the','and','for','und','der','die'
    }
    words=[word for word in re.findall(r'[a-z0-9+#]{3,}',text) if word not in stop and not word.isdigit()]
    return set(words[:80])

def review_preference_model(c):
    """Small transparent learner based only on explicit Tinder decisions."""
    enabled=get_profile_setting('learning_enabled','1')!='0'
    if not enabled:return {'enabled':False,'examples':0,'weights':{}}
    since=get_profile_setting('learning_reset_at','')
    sql="""SELECT o.title,o.company,o.domain_category,o.skills_found,o.review_decision,o.reviewed_at
        FROM offers o WHERE o.review_decision IN ('keep','reject','unsure') AND o.reviewed_at IS NOT NULL"""
    params=()
    if since:sql+=' AND o.reviewed_at>=?';params=(since,)
    weights=Counter();support=Counter();examples=0
    for title,company,domain,skills,decision,reviewed_at in c.execute(sql,params):
        examples+=1;value={'keep':2.0,'unsure':0.35,'reject':-2.0}.get(decision,0)
        for token in preference_tokens(title,domain,skills):weights[token]+=value;support[token]+=1
    filtered={token:round(max(-6,min(6,value)),2) for token,value in weights.items() if support[token]>=2 and abs(value)>=1.5}
    return {'enabled':True,'examples':examples,'weights':filtered}

def learned_score_adjustment(c,title,company,meta,model=None):
    # Keep review-derived preferences available for analysis, but don't let a
    # small and potentially biased history move offers across score thresholds.
    return 0,[]

def start_scan_run(c,profile):
    settings={'search':profile.get('search') or {},'sources':profile.get('sources') or {},'profile':diagnostic_profile_summary(profile)}
    cur=c.execute('INSERT INTO scan_runs(started_at,profile_id,settings_json) VALUES(?,?,?)',(RUN_STARTED_AT.isoformat(),ACTIVE_PROFILE_ID,json.dumps(settings,ensure_ascii=False,default=str)));c.commit();return int(cur.lastrowid)

def finish_scan_run(c,run_id,summary):
    if not run_id:return
    c.execute('UPDATE scan_runs SET finished_at=?,summary_json=? WHERE id=?',(datetime.now(timezone.utc).isoformat(),json.dumps(summary,ensure_ascii=False,default=str),run_id));c.commit()

def scan_checkpoint_path():
    return DB.parent/'scan_resume.json'

def scan_profile_signature(profile):
    fields={key:profile.get(key) or {} for key in ('student','target','location','skills','interests','search','sources')}
    payload=json.dumps(fields,ensure_ascii=False,sort_keys=True,default=str)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()

def save_scan_checkpoint(profile,candidates,direct_count,web_count):
    path=scan_checkpoint_path();path.parent.mkdir(parents=True,exist_ok=True)
    payload={'version':VERSION,'profile_id':ACTIVE_PROFILE_ID,'profile_signature':scan_profile_signature(profile),
             'created_at':datetime.now(timezone.utc).isoformat(),'direct_count':direct_count,'web_count':web_count,
             'runtime_settings':{key:os.getenv(key) for key in RESUME_RUNTIME_KEYS},'candidates':candidates}
    temporary=path.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload,ensure_ascii=False,default=str),encoding='utf-8')
    temporary.replace(path)
    log_event(f'CHECKPOINT — {len(candidates)} candidat(s) enregistrés pour une éventuelle reprise : {path.name}.','blue')

def load_scan_checkpoint(profile):
    path=scan_checkpoint_path()
    if not path.exists():raise FileNotFoundError(f'Aucun scan à reprendre : {path}')
    payload=json.loads(path.read_text(encoding='utf-8'))
    if payload.get('version')!=VERSION:raise ValueError('Ce checkpoint provient d’une autre version du moteur ; lancer un nouveau scan.')
    if payload.get('profile_id')!=ACTIVE_PROFILE_ID or payload.get('profile_signature')!=scan_profile_signature(profile):
        raise ValueError('Le profil a changé depuis ce checkpoint ; lancer un nouveau scan.')
    candidates=payload.get('candidates')
    if not isinstance(candidates,list):raise ValueError('Checkpoint de scan invalide : liste de candidats absente.')
    return payload

def scan_time_budget_seconds():
    return max(0,int(os.getenv('SCAN_TIME_BUDGET_SECONDS','0') or 0))

def scan_budget_exhausted(reserve=None):
    budget=scan_time_budget_seconds()
    if not budget:return False
    reserve=max(0,int(os.getenv('SCAN_DEADLINE_RESERVE_SECONDS','120') if reserve is None else reserve))
    return time.perf_counter()-RUN_STARTED>=max(0,budget-reserve)

def http_session():
    session=getattr(_HTTP_LOCAL,'session',None)
    if session is None:
        session=requests.Session();retry_count=max(0,min(int(os.getenv('HTTP_RETRIES','1')),3));retries=Retry(total=retry_count,connect=retry_count,read=retry_count,backoff_factor=0.45,status_forcelist=[429,500,502,503,504],allowed_methods=frozenset(['GET']))
        adapter=HTTPAdapter(max_retries=retries,pool_connections=20,pool_maxsize=20)
        session.mount('https://',adapter);session.mount('http://',adapter);session.headers.update(HEADERS);_HTTP_LOCAL.session=session
    return session

def fetch(u):
    metadata={'status':'blocked','http_status':None,'bytes_read':0,'truncated':False,'error_type':'','error':''}
    if not safe_public_url(u):
        metadata['error']='URL refusée par le contrôle de sécurité';_HTTP_LOCAL.last_fetch_meta=metadata
        return '',u
    try:
        max_bytes=max(250_000,min(int(os.getenv('MAX_RESPONSE_BYTES','5000000')),15_000_000))
        with http_session().get(u,timeout=int(os.getenv('HTTP_TIMEOUT_SECONDS','14')),allow_redirects=True,stream=True) as r:
            final_url=r.url
            metadata['http_status']=r.status_code
            if r.status_code>=400:
                metadata.update(status='http_error',error=f'HTTP {r.status_code}');_HTTP_LOCAL.last_fetch_meta=metadata
                return '',final_url
            if not safe_public_url(final_url):
                metadata.update(status='blocked',error='Redirection vers une URL refusée');_HTTP_LOCAL.last_fetch_meta=metadata
                return '',final_url
            payload=bytearray()
            for chunk in r.iter_content(chunk_size=65_536):
                if not chunk:continue
                remaining=max_bytes-len(payload)
                if remaining<=0:metadata['truncated']=True;break
                payload.extend(chunk[:remaining])
                if len(payload)>=max_bytes:
                    metadata['truncated']=True;break
            metadata.update(status='empty' if not payload else 'ok',bytes_read=len(payload));_HTTP_LOCAL.last_fetch_meta=metadata
            return payload.decode(r.encoding or 'utf-8',errors='replace'),final_url
    except Exception as error:
        metadata.update(status='network_error',error_type=type(error).__name__,error=short_text(error,240));_HTTP_LOCAL.last_fetch_meta=metadata
        return '',u

def page(u,fallback=''):
    h,final_url=fetch(u)
    if not h:return fallback,'',final_url
    return norm(extract(h,include_links=True,include_tables=True) or BeautifulSoup(h,'html.parser').get_text(' ',strip=True))[:40000],h,final_url

def iter_parallel_pages(rows,label='HTTP'):
    """Yield downloaded pages in bounded batches to keep peak RAM predictable."""
    if not rows:return []
    workers=max(1,min(int(os.getenv('SCRAPE_WORKERS','8')),12,len(rows)));results=[None]*len(rows);completed=0
    log_event(f'{label} — téléchargement parallèle de {len(rows)} page(s) avec {workers} worker(s).','cyan')
    def worker(item):
        row=item;clean_url=unwrap_url(row['url']);row['url']=clean_url;txt,html,final_url=page(clean_url,row.get('snippet',''));row['_fetch_meta']=dict(getattr(_HTTP_LOCAL,'last_fetch_meta',{'status':'unknown'}));return row,txt,html,final_url
    batch_span=max(workers,min(int(os.getenv('MAX_IN_FLIGHT_PAGES',str(workers*2))),workers*4))
    for start in range(0,len(rows),batch_span):
        if scan_budget_exhausted():
            log_event(f'{label} — budget temps atteint : {len(rows)-completed} page(s) non lancée(s), finalisation du scan.','bold yellow')
            break
        batch=rows[start:start+batch_span]
        with ThreadPoolExecutor(max_workers=min(workers,len(batch)),thread_name_prefix='stage-hunter') as pool:
            future_map={pool.submit(worker,row):start+offset for offset,row in enumerate(batch)}
            for future in as_completed(future_map):
                index=future_map[future]
                try:results[index]=future.result()
                except Exception:results[index]=(rows[index],rows[index].get('snippet',''),'',rows[index]['url'])
                completed+=1
                if completed==1 or completed%10==0 or completed==len(rows):log_event(f'{label} — {completed}/{len(rows)} page(s) téléchargée(s).','dim')
                result=results[index];results[index]=None
                if result is not None:yield result

def parallel_pages(rows,label='HTTP'):
    """Compatibility wrapper for small callers and tests."""
    return list(iter_parallel_pages(rows,label))

def _unique_terms(groups,limit=20):
    result=[];seen=set()
    for group in groups:
        values=[group] if isinstance(group,str) else list(group or [])
        for value in values:
            cleaned=norm(value)
            key=fold_text(cleaned)
            if 2<len(cleaned)<=55 and key not in seen:
                seen.add(key);result.append(cleaned)
                if len(result)>=limit:return result
    return result

def _clean_role(value):
    cleaned=norm(value)
    cleaned=re.sub(r'(?i)\b(internship|intern|stagiaire|stage|praktikum|trainee|alternance)\b',' ',cleaned)
    return norm(cleaned.strip(' -/'))

def _country_words(country):
    canonical=country_aliases(country)[0]
    return {
        'switzerland':('Switzerland','Suisse','Schweiz'),
        'france':('France','France','Frankreich'),
        'belgium':('Belgium','Belgique','Belgien'),
        'germany':('Germany','Allemagne','Deutschland'),
        'luxembourg':('Luxembourg','Luxembourg','Luxemburg'),
        'italy':('Italy','Italie','Italien'),
        'spain':('Spain','Espagne','Spanien'),
        'austria':('Austria','Autriche','Österreich'),
        'netherlands':('Netherlands','Pays-Bas','Niederlande'),
        'united kingdom':('United Kingdom','Royaume-Uni','Vereinigtes Königreich'),
        'united states':('United States','États-Unis','USA'),
        'canada':('Canada','Canada','Kanada'),
    }.get(canonical,(norm(country),norm(country),norm(country)))

def profile_professional_interests(profile):
    """Professional sectors affect discovery; personal hobbies never do."""
    target=profile.get('target') or {};interests=profile.get('interests') or {}
    explicit=interests.get('professional') or target.get('sectors') or []
    if explicit:return _unique_terms([target.get('sectors',[]),explicit],20)
    legacy=_unique_terms([interests.get('very_high',[]),interests.get('high',[])],20)
    return [term for term in legacy if fold_text(term) not in {fold_text(x) for x in HOBBY_ONLY_TERMS}]

def profile_contract_mode(profile):
    terms=profile_contract_terms(profile);joined=' '.join(terms)
    internship=any(word in joined for word in ('intern','stage','praktikum','stagiaire','studentship','trainee'))
    employment=any(word in joined for word in ('emploi','job','cdi','cdd','permanent','fixed term','full time','temps plein'))
    return 'internship' if internship and not employment else ('employment' if employment and not internship else 'mixed')

def internship_title_signal(title):
    folded=fold_text(title)
    return any(re.search(pattern,folded) for pattern in INTERNSHIP_TITLE_PATTERNS)

def contract_rejection(title,text,profile):
    """Reject an explicitly incompatible contract, never a merely unlabeled one."""
    mode=profile_contract_mode(profile)
    title_fold=fold_text(title)
    red_flags=((profile.get('target') or {}).get('red_flags') or
               (profile.get('search') or {}).get('red_flags') or [])
    if isinstance(red_flags,str):red_flags=[red_flags]
    for flag in red_flags:
        if norm(flag) and has_term(title_fold,fold_text(flag)):
            return f'Mot-clé interdit dans le titre : {norm(flag)}'
    if mode=='internship':
        incompatible_titles=(
            'senior','lead ','team lead','head of','director','manager','principal','staff engineer',
            'doctoral','doctorant','phd','postdoc','postdoctoral','professor','faculty position'
        )
        if any(term in title_fold for term in incompatible_titles):
            return 'Type de contrat incompatible avec un stage'
        return ''
    if mode!='employment':return ''
    title_intern=internship_title_signal(title)
    body_head=fold_text(text[:5000])
    body_intern=bool(re.search(r'\b(?:this internship position|this internship role|internship position|internship role|employment type\s*[:\-]?\s*intern|offre de stage|stage de fin|praktikumstelle|technical studentship|student placement)\b',body_head))
    if title_intern or body_intern:return 'Type de contrat incompatible : stage/internship'
    return ''

def profile_job_family(profile):
    target=profile.get('target') or {};skills=profile.get('skills') or {}
    sample=fold_text(' '.join(str(x) for x in ((target.get('job_titles') or target.get('roles') or [])+(skills.get('core') or [])+(skills.get('strong_domains') or []))))
    software=('developpeur','developer','frontend','backend','full stack','fullstack','web developer','software engineer','ingenieur logiciel','application developer','devops')
    engineering=('ingenieur biomedical','ingenieur instrumentation','ingenieur embarque','ingenieur robotique','ingenieur electronique','ingenieur automatisme','embedded','electronique','electronics','automation','robot','sensor','instrumentation','firmware','metrology','capteur','systemes numeriques')
    if any(term in ' '+sample+' ' for term in software) and not any(term in ' '+sample+' ' for term in ('sensor','capteur','instrumentation','embedded','firmware','robot','automatisme','electronique')):
        return 'software'
    if any(term in ' '+sample+' ' for term in engineering) or ' ingenieur ' in ' '+sample+' ' or ' engineering ' in ' '+sample+' ':
        return 'engineering'
    if any(term in ' '+sample+' ' for term in software):
        return 'software'
    return ''

def profile_search_components(profile):
    """Return the profile words that will actually drive discovery."""
    student=profile.get('student') or {};target=profile.get('target') or {};location=profile.get('location') or {}
    skills=profile.get('skills') or {};interests=profile.get('interests') or {}
    contracts=student.get('contract_types') or [student.get('stage_type') or 'job']
    if isinstance(contracts,str):contracts=[contracts]
    objective=' '.join([str(student.get('stage_type',''))]+[str(x) for x in contracts]).lower()
    internship_mode=any(x in objective for x in ('intern','stage','praktikum','stagiaire'))
    countries=location.get('countries') or location.get('country') or ['Switzerland']
    if isinstance(countries,str):countries=[countries]
    unique_countries=[];seen_countries=set()
    for country in countries:
        canonical=country_aliases(country)[0]
        if canonical not in seen_countries:seen_countries.add(canonical);unique_countries.append(norm(country))
    roles=_unique_terms([[_clean_role(x) for x in (target.get('job_titles',[]) or target.get('roles',[]) or [])]],8)
    themes=_unique_terms([
        target.get('sectors',[]),skills.get('strong_domains',[]),skills.get('core',[]),
        profile_professional_interests(profile)
    ],18)
    themes=[term for term in themes if fold_text(term) not in {fold_text(x) for x in HOBBY_ONLY_TERMS}]
    if internship_mode:
        intents=['internship','stage','Praktikum']
    else:
        contract_terms=_unique_terms([contracts],4)
        intents=_unique_terms([['emploi','job'],contract_terms],6)
    return {'internship_mode':internship_mode,'intents':intents,'roles':roles,'themes':themes,'countries':unique_countries}

def build_search_queries(profile,emit_log=True):
    """Build a small, strict-budget search plan from the person's profile."""
    search_cfg=profile.get('search') or {};sources_cfg=profile.get('sources') or {}
    configured_budget=search_cfg.get('query_budget',search_cfg.get('auto_query_limit',24))
    budget=max(4,min(int(os.getenv('SEARCH_QUERY_BUDGET',os.getenv('AUTO_QUERY_LIMIT',str(configured_budget)))),300))
    components=profile_search_components(profile)
    intents=components['intents'];roles=components['roles'];themes=components['themes'];countries=components['countries'] or ['']
    role_pair_limit=max(1,min(int(os.getenv('SEARCH_ROLE_PAIR_LIMIT','3')),8))
    expand_intents=str(os.getenv('SEARCH_INTENT_EXPANSION','0')).strip().lower() in ('1','true','yes','on')

    manual=[]
    if search_cfg.get('use_manual_queries',True):manual.extend(search_cfg.get('queries',[]) or [])
    manual.extend(sources_cfg.get('custom_queries',[]) or [])
    manual.extend(profile.get('_source_pack_queries',[]) or [])
    manual=list(dict.fromkeys(norm(q) for q in manual if norm(q)))

    generic_groups=[]
    for country_index,country in enumerate(countries):
        local_queries=[]
        country_words=_country_words(country)
        variants=[]
        for index,intent in enumerate(intents):
            if components['internship_mode']:localized_country=country_words[min(index,2)]
            else:localized_country=country_words[0] if fold_text(intent)=='job' else country_words[1]
            variants.append((intent,localized_country))
        anchors=roles or themes or ['']
        for index,role in enumerate(anchors):
            chosen_variants=variants if expand_intents else [variants[index%len(variants)]]
            for intent,country_word in chosen_variants:
                local_queries.append(norm(f'{intent} {role} {country_word}'))
        if roles and themes:
            pair_index=0
            for theme in themes:
                for role in roles[:role_pair_limit]:
                    theme_fold=fold_text(theme);role_fold=fold_text(role)
                    if theme_fold==role_fold or (len(theme_fold)>4 and theme_fold in role_fold):
                        continue
                    chosen_variants=variants if expand_intents else [variants[pair_index%len(variants)]]
                    for intent,country_word in chosen_variants:
                        # Profile words are deliberately placed before the role:
                        # emploi + R&D + ingénieur -> "emploi R&D ingénieur France".
                        local_queries.append(norm(f'{intent} {theme} {role} {country_word}'))
                        pair_index+=1
        elif themes:
            for index,theme in enumerate(themes):
                chosen_variants=variants if expand_intents else [variants[index%len(variants)]]
                for intent,country_word in chosen_variants:
                    local_queries.append(norm(f'{intent} {theme} {country_word}'))
        generic_groups.append(list(dict.fromkeys(q for q in local_queries if q)))
        if country_index>=2:break
    generic=[]
    for position in range(max((len(group) for group in generic_groups),default=0)):
        for group in generic_groups:
            if position<len(group):generic.append(group[position])

    domains=list(dict.fromkeys(profile.get('_source_pack_domains',[]) or []))
    source_queries=[];source_anchors=roles+themes or ['']
    source_queries_per_domain=max(1,min(int(os.getenv('SEARCH_SOURCE_QUERIES_PER_DOMAIN','1')),4))
    for index,domain in enumerate(domains):
        source_country=countries[index%len(countries)] if countries else ''
        country_words=_country_words(source_country)
        host=urlparse('https://'+str(domain).replace('https://','').replace('http://','')).netloc or str(domain).split('/')[0]
        for offset in range(source_queries_per_domain):
            variant_index=index+offset
            intent=intents[variant_index%len(intents)]
            if components['internship_mode']:country_word=country_words[min(variant_index%len(intents),2)]
            else:country_word=country_words[0] if fold_text(intent)=='job' else country_words[1]
            anchor=source_anchors[(index*source_queries_per_domain+offset)%len(source_anchors)]
            source_queries.append(norm(f'site:{host} {intent} {anchor} {country_word}'))
    source_queries=list(dict.fromkeys(q for q in source_queries if q))

    manual_quota=min(len(manual),max(0,budget//6))
    site_share=max(0.0,min(float(search_cfg.get('site_query_share',0.35)),0.7))
    source_quota=min(len(source_queries),max(2,round(budget*site_share)))
    generic_quota=max(0,budget-manual_quota-source_quota)
    selected=manual[:manual_quota]+generic[:generic_quota]+source_queries[:source_quota]
    leftovers=manual[manual_quota:]+generic[generic_quota:]+source_queries[source_quota:]
    for query in leftovers:
        if len(selected)>=budget:break
        if query not in selected:selected.append(query)
    selected=selected[:budget]
    if emit_log:
        log_event(f'RECHERCHE PROFIL — budget {budget} · {len(generic)} combinaison(s) métier/compétences · {len(source_queries)} source(s) · {len(manual)} requête(s) manuelle(s) · {len(selected)} retenue(s).','bold cyan')
    return selected

def normalize_search_backends(backends):
    """Return only explicit DDGS text backends.

    DDGS silently falls back to ``auto`` when an unknown backend is supplied.
    That made the former ``bing`` and ``yandex`` UI choices look productive
    even though another engine had actually answered. ``yahoo`` is the
    supported DDGS frontend backed by Bing results, so the legacy ``bing``
    value is migrated to it instead of being discarded.
    """
    values=[backends] if isinstance(backends,str) else list(backends or [])
    resolved=[];ignored=[];migrated=[]
    for raw in values:
        value=norm(raw).lower()
        if not value:continue
        mapped=SEARCH_BACKEND_ALIASES.get(value,value)
        if mapped!=value:migrated.append((value,mapped))
        if mapped not in SUPPORTED_SEARCH_BACKENDS:
            ignored.append(value);continue
        if mapped not in resolved:resolved.append(mapped)
    return resolved,ignored,migrated

def configured_search_backends():
    """Read the environment and upgrade the former untouched default."""
    raw=[x.strip() for x in os.getenv('SEARCH_BACKENDS','duckduckgo,yahoo').split(',') if x.strip()]
    legacy_upgrade=[fold_text(value) for value in raw]==['duckduckgo','brave']
    if legacy_upgrade:raw=['duckduckgo','yahoo']
    resolved,ignored,migrated=normalize_search_backends(raw)
    return resolved or ['duckduckgo','yahoo'],ignored,migrated,legacy_upgrade

def search_result_filter_status(raw_url,canonical_url='',seen=None):
    """Explain whether a search result URL can enter the discovery funnel."""
    raw_url=norm(raw_url);canonical_url=canonical_url or (canon(raw_url) if raw_url else '')
    if not raw_url:return 'URL absente'
    if not safe_public_url(canonical_url):return 'URL non publique ou invalide'
    parsed=urlparse(canonical_url);host=(parsed.hostname or '').lower().removeprefix('www.');path=parsed.path.lower()
    if (host.endswith('bing.com') and path.startswith('/aclick')) or host in {
        'googleadservices.com','ad.doubleclick.net','clickserve.dartsearch.net'
    }:
        return 'Lien publicitaire ignoré'
    if seen is not None and canonical_url in seen:return 'Doublon entre moteurs'
    return 'URL exploitable'

def search_backend_once(query,backend,limit,region,timeout):
    """Run one DDGS backend and retain the evidence normally hidden by DDGS."""
    started=time.perf_counter();trace={'backend':backend,'status':'empty','raw_count':0,'elapsed_ms':0,'error_type':'','error_message':''}
    resolved,ignored,migrated=normalize_search_backends([backend])
    if not resolved:
        trace.update(status='invalid_backend',error_type='InvalidBackend',error_message=f'Moteur DDGS non pris en charge : {backend}')
        trace['elapsed_ms']=round((time.perf_counter()-started)*1000)
        return [],trace
    backend=resolved[0];trace['backend']=backend
    if migrated:trace['requested_backend']=migrated[0][0]
    try:
        with DDGS(timeout=timeout) as client:
            results=list(client.text(query,max_results=limit,backend=backend,region=region) or [])
        trace['raw_count']=len(results);trace['status']='results' if results else 'empty'
        return results,trace
    except Exception as error:
        message=norm(str(error));trace['error_type']=type(error).__name__;trace['error_message']=message
        trace['status']='empty_exception' if 'no results found' in message.lower() else 'error'
        return [],trace
    finally:
        trace['elapsed_ms']=round((time.perf_counter()-started)*1000)

def search_trace_label(trace):
    parts=[]
    for item in trace or []:
        backend=item.get('backend','?');status=item.get('status','?');elapsed=float(item.get('elapsed_ms',0) or 0)/1000
        if status=='results':detail=f"{item.get('raw_count',0)} brut(s)"
        elif item.get('error_type'):
            detail=f"{item.get('error_type')}: {short_text(item.get('error_message') or 'sans message',80)}"
        else:detail='liste vide'
        parts.append(f'{backend}={status} ({detail}, {elapsed:.1f}s)')
    return ' · '.join(parts) or 'aucune trace moteur'

def _debug_page_record(row,text_value,html_value,final_url,profile):
    """Classify one downloaded page with the same gates as the real ingest."""
    target_url=canon(final_url or row['url'])
    structured=extract_job_posting(html_value,target_url);effective_title=norm(structured.get('title') or row.get('title'))
    effective_text=norm(structured.get('employment_type','')+' '+structured.get('description','')+' '+text_value)
    page_type,class_reason=classify_with_reason(target_url,effective_title,effective_text,html_value,profile,candidate_hint=bool(row.get('_listing_url')))
    contract_confirmed=contract_signal(effective_title,effective_text,profile)
    internship_mode=profile_search_components(profile)['internship_mode'];structured_contract=fold_text(structured.get('employment_type',''))
    contract_likely=(any(term in structured_contract for term in ('intern','stage','praktikum','trainee','student')) if internship_mode else bool(structured_contract))
    availability,availability_reason,_=application_availability(effective_title,effective_text,html_value,structured)
    meta=detect_meta(effective_title,effective_text,profile,structured.get('location',''))
    hard_rejection=eligibility_rejection(effective_title,effective_text,meta,profile,structured) if page_type=='offer' else ''
    if page_type=='listing':decision='LISTING À DÉVELOPPER';decision_reason=class_reason
    elif page_type!='offer':decision='REJETÉE';decision_reason=class_reason
    elif availability=='closed':decision='REJETÉE';decision_reason=availability_reason or 'Offre fermée'
    elif not contract_confirmed and internship_mode and not (bool((profile.get('search') or {}).get('allow_unconfirmed_contract',True)) and contract_likely):
        decision='REJETÉE';decision_reason='Aucun signal du type de contrat ciblé'
    elif hard_rejection:decision='REJETÉE';decision_reason=hard_rejection
    else:
        company=structured.get('company') or guess_company(effective_title,effective_text,target_url)
        estimated_score,confidence,reasons=score(effective_title,effective_text,meta,page_type,profile,target_url,company,structured)
        threshold=float(os.getenv('MIN_OPPORTUNITY_SCORE','30'));decision='RETENUE' if estimated_score>=threshold else 'REJETÉE'
        decision_reason=('Score simulé suffisant' if decision=='RETENUE' else f'Score simulé sous le seuil {threshold:g}')
    record={
        'title':effective_title,'url':target_url,'domain':dom(target_url),
        'html_chars':len(html_value or ''),'text_chars':len(effective_text or ''),'page_type':page_type,
        'classification_reason':class_reason,'contract_confirmed':contract_confirmed,
        'availability':availability,'decision':decision,'decision_reason':decision_reason,
    }
    return record,page_type

def debug_web_search(profile,query,backends=None,limit=5,timeout=7,inspect_pages=True,max_page_checks=6,max_listing_page_checks=4):
    """Inspect one query without touching scan history, offers, Gmail or Sheets."""
    query=norm(query);region=preferred_search_region(profile)
    requested_backends=list(dict.fromkeys(backends or ['duckduckgo','yahoo']))
    backends,ignored_backends,migrated_backends=normalize_search_backends(requested_backends)
    backends=backends or ['duckduckgo','yahoo']
    report={
        'version':VERSION,'generated_at':datetime.now(timezone.utc).isoformat(),'query':query,
        'region':region,'limit_per_backend':int(limit),'timeout_seconds':int(timeout),
        'requested_engines':requested_backends,'ignored_engines':ignored_backends,
        'migrated_engines':[{'from':before,'to':after} for before,after in migrated_backends],
        'engines':[],'results':[],'page_checks':[],'listing_leads':[],'listing_page_checks':[],
    }
    seen=set()
    for backend in backends:
        results,trace=search_backend_once(query,backend,int(limit),region,int(timeout));valid=0;new_unique=0
        for rank,item in enumerate(results,start=1):
            raw_url=norm(item.get('href') or item.get('url'));canonical=canon(raw_url) if raw_url else ''
            independent_status=search_result_filter_status(raw_url,canonical)
            filter_status=search_result_filter_status(raw_url,canonical,seen)
            if independent_status=='URL exploitable':valid+=1
            if filter_status=='URL exploitable':seen.add(canonical);new_unique+=1
            report['results'].append({
                'engine':backend,'rank':rank,'title':norm(item.get('title')),
                'url':raw_url,'canonical_url':canonical,'domain':dom(raw_url),
                'snippet':norm(item.get('body') or item.get('snippet'))[:700],
                'filter_status':filter_status,
            })
        report['engines'].append({**trace,'valid_links':valid,'new_unique_links':new_unique,'valid_unique_links':new_unique})

    if inspect_pages:
        candidates=[]
        for item in report['results']:
            if item['filter_status']=='URL exploitable' and len(candidates)<max(1,int(max_page_checks)):
                candidates.append({'url':item['canonical_url'],'title':item['title'],'snippet':item['snippet'],'source':item['domain'],'origin':'web_debug'})
        listing_detail_pool=[];listing_seen=set();report_lead_seen=set();listing_leads_raw=0
        for row,text_value,html_value,final_url in iter_parallel_pages(candidates,'TEST WEB PAGES'):
            record,page_type=_debug_page_record(row,text_value,html_value,final_url,profile)
            if page_type=='listing':
                leads=sorted(discover_listing_leads(record['url'],html_value),key=lambda lead:listing_lead_priority(lead,profile),reverse=True)
                listing_leads_raw+=len(leads)
                record['listing_leads_found']=len(leads);record['listing_leads_with_url']=sum(bool(lead.get('url')) for lead in leads)
                for lead in leads:
                    lead_url=canon(lead.get('url','')) if lead.get('url') else ''
                    lead_key=lead_url or f"{dom(record['url'])}|{fold_text(lead.get('title',''))}"
                    if not lead_key or lead_key in report_lead_seen:continue
                    report_lead_seen.add(lead_key)
                    lead_record={
                        'listing_url':record['url'],'title':lead.get('title',''),'company':lead.get('company',''),
                        'location':lead.get('location',''),'url':lead_url,
                        'priority':listing_lead_priority(lead,profile),'has_detail_url':bool(lead_url),
                    }
                    report['listing_leads'].append(lead_record)
                    if lead_url and lead_url not in listing_seen:
                        listing_seen.add(lead_url);listing_detail_pool.append({
                            'url':lead_url,'title':lead.get('title',''),'snippet':'','source':dom(lead_url),
                            'origin':'web_debug_listing','_listing_url':record['url'],'_lead_priority':listing_lead_priority(lead,profile),
                        })
            report['page_checks'].append(record)
        listing_detail_candidates=sorted(
            listing_detail_pool,
            key=lambda item:(bool(offer_url_signal(item.get('url',''))),item.get('_lead_priority',0)),
            reverse=True,
        )[:max(0,int(max_listing_page_checks))]
        if listing_detail_candidates:
            for row,text_value,html_value,final_url in iter_parallel_pages(listing_detail_candidates,'TEST WEB OFFRES'):
                record,_=_debug_page_record(row,text_value,html_value,final_url,profile)
                record['listing_url']=row.get('_listing_url','')
                report['listing_page_checks'].append(record)
        report['listing_leads_raw_count']=listing_leads_raw
    report['summary']={
        'engines_tested':len(report['engines']),
        'engines_with_results':sum(item.get('raw_count',0)>0 for item in report['engines']),
        'raw_results':sum(item.get('raw_count',0) for item in report['engines']),
        'unique_valid_links':sum(item.get('new_unique_links',0) for item in report['engines']),
        'pages_checked':len(report['page_checks']),
        'listing_leads_found':len(report['listing_leads']),
        'listing_leads_raw':report.get('listing_leads_raw_count',0),
        'listing_offers_checked':len(report['listing_page_checks']),
        'simulated_retained':sum(item.get('decision')=='RETENUE' for item in report['page_checks']+report['listing_page_checks']),
    }
    return report

def search_web(qs,limit,c=None):
    """Search in bounded waves and stop early when engines return only empties.

    Direct listings remain the primary discovery route; web search is a useful
    fallback, not a reason to wait twelve seconds for dozens of empty queries.
    """
    qs=rank_search_queries(c,list(qs));out=[];seen=set();empty=[];failed=[];total=len(qs);executed=0;productive=0
    workers=max(1,min(int(os.getenv('SEARCH_WORKERS','4')),8,total or 1))
    retries=max(0,min(int(os.getenv('SEARCH_RETRIES','1')),4))
    backoff=max(0.1,float(os.getenv('SEARCH_RETRY_BACKOFF','1.0')))
    backends,ignored_backends,migrated_backends,legacy_upgrade=configured_search_backends()
    if legacy_upgrade:log_event('WEB — ancien réglage par défaut DuckDuckGo/Brave remplacé par DuckDuckGo/Yahoo après diagnostic.','yellow')
    if ignored_backends:log_event('WEB — moteur(s) DDGS ignoré(s) car non pris en charge : '+', '.join(ignored_backends)+'.','yellow')
    if migrated_backends:log_event('WEB — alias moteur appliqué : '+', '.join(f'{a}→{b}' for a,b in migrated_backends)+'.','yellow')
    profile_retry_empty=bool((ACTIVE_PROFILE.get('search') or {}).get('retry_empty_results',False))
    retry_empty=str(os.getenv('WEB_RETRY_EMPTY_RESULTS','1' if profile_retry_empty else '0')).strip().lower() in ('1','true','yes','on')
    disable_circuit=str(os.getenv('WEB_DISABLE_CIRCUIT_BREAKER','0')).strip().lower() in ('1','true','yes','on')
    search_region=preferred_search_region(ACTIVE_PROFILE);search_timeout=max(5,int(os.getenv('SEARCH_TIMEOUT_SECONDS','14')))
    delay_min=float(os.getenv('SEARCH_DELAY_MIN','0.15'));delay_max=float(os.getenv('SEARCH_DELAY_MAX','0.35'))
    delay_low=max(0.0,min(delay_min,delay_max));delay_high=max(0.0,max(delay_min,delay_max))
    probe_size=min(total,max(workers,int(os.getenv('WEB_PROBE_QUERIES',str(workers*2)))))
    minimum_productivity=max(0.0,min(float(os.getenv('WEB_MIN_PRODUCTIVITY','0.04')),1.0))
    circuit_label='désactivé' if disable_circuit else f'sous {minimum_productivity*100:.0f}% de rendement'
    log_event(f'WEB ADAPTATIF — jusqu’à {total} requêtes · {workers} worker(s) · sonde initiale {probe_size} · coupe-circuit {circuit_label}.','bold cyan')

    def worker(index,q):
        query_started=time.perf_counter();log_event(f'WEB {index}/{total} · {short_text(q,95)}')
        # Chaque worker possède sa propre instance DDGS. Partager une seule
        # session entre threads provoque des erreurs HTTP/2 aléatoires.
        if delay_high>0:time.sleep(random.uniform(delay_low,delay_high))
        last_error='';had_empty=False;attempt_trace=[];executed_attempts=0
        primary_backend_offset=(index-1)%len(backends)
        for attempt in range(retries+1):
            # Rotate the first-choice backend across queries. With
            # retry_empty_results disabled, every configured engine is still
            # sampled without adding a second request for each empty query.
            backend=backends[(primary_backend_offset+attempt)%len(backends)]
            executed_attempts=attempt+1
            results,trace=search_backend_once(q,backend,limit,search_region,search_timeout);attempt_trace.append(trace)
            if results:return index,q,results,'',attempt+1,query_started,attempt_trace
            if trace['status'] in ('empty','empty_exception'):
                had_empty=True;last_error=''
                if not retry_empty:break
            else:last_error=f"{trace['error_type']}: {trace['error_message']}"
            if attempt<retries:
                wait=backoff*(2**attempt)+random.uniform(0.0,0.35)
                next_backend=backends[(primary_backend_offset+attempt+1)%len(backends)]
                log_event(f'WEB {index}/{total} · secours {next_backend} {attempt+2}/{retries+1} dans {wait:.1f}s','yellow')
                time.sleep(wait)
        return index,q,[],'' if had_empty else last_error,executed_attempts,query_started,attempt_trace

    def run_batch(batch,start_index):
        nonlocal executed,productive
        batch_started=time.perf_counter()
        with ThreadPoolExecutor(max_workers=min(workers,len(batch)),thread_name_prefix='stage-hunter-search') as pool:
            future_map={pool.submit(worker,start_index+offset,q):(start_index+offset,q) for offset,q in enumerate(batch)}
            for future in as_completed(future_map):
                index,q=future_map[future];executed+=1
                result_started=time.perf_counter()
                try:index,q,rr,error,attempts,query_started,attempt_trace=future.result()
                except Exception as unexpected:
                    rr=[];error=str(unexpected);attempts=1;query_started=result_started;attempt_trace=[]
                elapsed_ms=round((time.perf_counter()-query_started)*1000);source=metric_source(q)
                if error:
                    failed.append((q,error));record_source_metric(c,source,'web',attempts=attempts,elapsed_ms=elapsed_ms)
                    log_event(f'WEB {index}/{total} · erreur réseau · {search_trace_label(attempt_trace)} ({elapsed_label(query_started)})','red');continue
                if not rr:
                    empty.append(q);record_source_metric(c,source,'web',attempts=attempts,elapsed_ms=elapsed_ms)
                    log_event(f'WEB {index}/{total} · aucun résultat · {search_trace_label(attempt_trace)} ({elapsed_label(query_started)})','yellow');continue
                added=0
                for x in rr:
                    u=x.get('href') or x.get('url');cu=canon(u or '')
                    if search_result_filter_status(u or '',cu,seen)!='URL exploitable':continue
                    seen.add(cu);out.append({'url':u,'title':norm(x.get('title')),'snippet':norm(x.get('body')),'source':dom(u),'origin':'web','_search_query':q});added+=1
                if added:productive+=1
                record_source_metric(c,source,'web',attempts=attempts,links=added,elapsed_ms=elapsed_ms)
                retry_label=f' · {attempts} tentative(s)' if attempts>1 else ''
                log_event(f'WEB {index}/{total} · {len(rr)} brut(s), {added} nouveau(x) lien(s){retry_label} · {search_trace_label(attempt_trace)} ({elapsed_label(query_started)})','green' if added else 'yellow')
        return time.perf_counter()-batch_started

    first=qs[:probe_size]
    if first:run_batch(first,1)
    probe_ratio=productive/max(1,executed)
    probe_links=len(out)
    circuit_open=(not disable_circuit) and executed<total and probe_ratio<minimum_productivity and probe_links<int(os.getenv('WEB_MIN_PROBE_LINKS','5'))
    deadline_reached=False
    if circuit_open:
        skipped=total-executed
        log_event(f'WEB COUPE-CIRCUIT — sonde improductive ({productive}/{executed}, {probe_links} lien(s)) : {skipped} requête(s) lentes ignorées, passage immédiat à l’analyse.','bold yellow')
        SCAN_METRICS['recommendations'].append('Le moteur web a été interrompu tôt : les sources directes sont plus rentables pour ce profil.')
    else:
        cursor=probe_size
        batch_size=max(workers,workers*2)
        while cursor<total:
            if scan_budget_exhausted():
                deadline_reached=True
                log_event(f'WEB — budget temps atteint après {executed}/{total} requête(s), passage à l’analyse des résultats acquis.','bold yellow')
                break
            batch=qs[cursor:cursor+batch_size];run_batch(batch,cursor+1);cursor+=len(batch)
    if c is not None:c.commit()
    skipped=total-executed
    SCAN_METRICS['web']={'configured':total,'executed':executed,'skipped':skipped,'productive':productive,'empty':len(empty),'failed':len(failed),'links':len(out),'circuit_breaker':circuit_open,'deadline_reached':deadline_reached}
    log_event(f'WEB terminé · {productive}/{executed} exécutée(s) productive(s), {len(empty)} sans résultat, {len(failed)} erreur(s), {skipped} évitée(s), {len(out)} lien(s) unique(s).','bold cyan')
    if failed:
        for q,msg in failed[:5]:log_event(f'Erreur réseau · {short_text(q,70)} — {short_text(msg,110)}','yellow')
    return out

def count_job_postings(html):
    """Count schema.org JobPosting objects without trusting the page title."""
    if not html:return 0
    count=0; soup=BeautifulSoup(html,'html.parser')
    def walk(value):
        nonlocal count
        if isinstance(value,dict):
            kinds=value.get('@type',[]); kinds=kinds if isinstance(kinds,list) else [kinds]
            if any(str(kind).lower()=='jobposting' for kind in kinds):count+=1
            for child in value.values():walk(child)
        elif isinstance(value,list):
            for child in value:walk(child)
    for script in soup.find_all('script',attrs={'type':re.compile(r'ld\+json',re.I)}):
        try:walk(json.loads(script.string or script.get_text() or ''))
        except Exception:continue

    return count

def listing_reason(u,title,text='',html=''):
    """Return a human-readable reason when a URL is a results/listing page."""
    tl=norm(title).lower(); sample=norm(title+' '+text[:12000]).lower(); parsed=urlparse(u)
    path=parsed.path.lower(); query=parsed.query.lower(); host=(parsed.hostname or '').lower().removeprefix('www.')
    if host=='embedded.jobs' and (path.rstrip('/') in {'/jobs','/firmware-engineer-jobs','/robotics-embedded-systems-jobs'} or re.search(r'-jobs(?:-in-[a-z-]+)?$',path)):
        return 'Embedded.jobs : page de catégorie multi-offres'
    if host=='swiss-robotics.org' and path.rstrip('/') in {'/jobs','/job'}:
        return 'Swiss Robotics Association : listing multi-employeurs'
    # SEO aggregators often encode an arbitrary search sentence after /jobs/.
    if host=='englishjobsearch.ch' and path.startswith('/jobs/'):
        return 'EnglishJobSearch : URL de recherche /jobs/, pas une fiche'
    if host.endswith('hellowork.com') and any(marker in path for marker in ('/emploi/metier_','/emploi/ville_','/fr-fr/emploi.html','/salaire/','/entreprise/')):
        return 'HelloWork : page métier/ville/salaire, pas une offre'
    if 'glassdoor.' in host and any(marker in path for marker in ('/job/','/jobs/','/emploi/')) and not re.search(r'job-listing|partner/joblisting',path):
        return 'Glassdoor : page de résultats, pas une offre'
    if 'indeed.' in host and not path.startswith('/viewjob') and (
        path.startswith('/q-') or 'emplois-' in path or '-emplois' in path or '-jobs' in path or path.rstrip('/').endswith(('/jobs','/emplois'))
    ):
        return 'Indeed : page de résultats, pas une offre'
    if host.endswith('randstad.lu') and fold_text(tl).startswith('travailler en tant que'):
        return 'Article métier, pas une offre individuelle'
    if any(marker in path for marker in ('/salaires/','/salaire/','/cmp/','/reviews/','/salaries/','/salary/','/avis/','/career-advice/','/interview/')):
        return 'Page SEO avis/salaire/entreprise, pas une offre'
    if any(re.search(pat, fold_text(tl)) for pat in (
        r'\b(?:salaires?\s+annuels?\s+pour|salaires?\s+pour\s+le\s+poste|salaire\s+moyen\b)',
        r'\b(?:avis\s+des?\s+employ[eé]s?\s+pour|avis\s+sur\s+l[\'’]entreprise|avis\s+de\s+salari[eé]s)\b',
        r'\b(?:employee\s+reviews?\s+for|company\s+reviews?\s+for|interview\s+questions?\s+for)\b',
    )):
        return 'Page SEO avis ou salaire, pas une offre'
    if re.search(r'^(?:salaire|entreprises?|emploi)\s+.+(?:developer|developpeur|engineer|ingenieur)',fold_text(tl)) and not offer_url_signal(u):
        return 'Page SEO métier/ville, pas une offre individuelle'
    # A result count may be separated from "jobs" by the full search sentence.
    if re.search(r'\b\d{1,5}\b.{0,130}\b(jobs?|emplois?|postes?|offres?|vacancies|internships?|stages?|stellenangebote)\b',tl):
        return 'Titre contenant un nombre de résultats'
    if any(phrase in tl for phrase in LISTING_TITLE_PHRASES):
        return 'Titre générique de portail ou de page carrière'
    if re.search(r'\b(jobs?|emplois?|vacancies|internships?|stages?)\s+(?:in|en|pour)\s+(?:switzerland|suisse|schweiz|france|belgium|belgique|germany|allemagne|deutschland|luxembourg|europe)\b',tl):
        return 'Recherche nationale multi-offres'
    if re.search(r'\b(job|emploi|stage|internship)s?\b.{0,40}\b\d+\s+(?:results?|résultats?|resultate)\b',tl):
        return 'Page de résultats de recherche'
    if host.endswith('swissinterns.ch') or path.rstrip('/') in ('','/en','/fr','/de'):
        return 'Page d’accueil ou racine de portail'
    query_keys={key.lower() for key,_ in parse_qsl(parsed.query,keep_blank_values=True)}
    search_keys={'q','query','keywords','keyword','term','search','location','page','start','sort','category','filters','f_jt'}
    search_path=any(marker in path for marker in ('/jobs/search','/job-search','/search-results','/jobs/search-results')) or path.rstrip('/').endswith(('/jobs','/vacancies','/emplois'))
    if query and (search_path or bool(query_keys & search_keys)):
        return 'URL de recherche avec filtres'
    if any(marker in sample for marker in ['sorted by relevance','trié par pertinence','trier par pertinence','include languages']):
        return 'Interface de recherche détectée dans la page'
    return ''

def offer_url_signal(u):
    """Return a conservative reason when the URL itself looks like one job."""
    parsed=urlparse(u);path=parsed.path.lower().rstrip('/');query=parsed.query.lower();host=(parsed.hostname or '').lower().removeprefix('www.')
    exact_markers=(
        '/vacancies/detail/','/emplois/detail/','/jobs/view/','/job/view/','/jobs/detail/',
        '/job-details/','/jobdetail/','/job-description/','/position/','/positions/',
        '/requisition/','/requisitions/','/vacature/','/offre/','/offer/','/stellenangebot/',
        '/internship/','/job-listing/','/partner/joblisting.'
    )
    if any(marker in path for marker in exact_markers):return 'URL de fiche individuelle'
    if 'indeed.' in host and path.startswith('/rc/clk') and ('jk=' in query or 'vjk=' in query):return 'Lien individuel Indeed'
    if re.search(r'/(?:jobs?|careers?)/(?:[^/?#]+-)?\d{5,}(?:$|[-/])',path):return 'Identifiant d’offre dans l’URL'
    if re.search(r'/(?:jobs?|careers?)/[^/?#]{12,}$',path) and not query and not path.endswith(('/jobs','/job','/careers','/career')):
        if host not in {'englishjobsearch.ch'}:return 'Chemin d’offre individuel'
    return ''

def page_audit_record(row,title,reason,page_type='',text='',html='',structured=None,contract_state=''):
    """Build an inspectable rejection row with the official destination URL."""
    structured=structured or {}
    return {
        'title':norm(title),'url':row.get('url',''),'official_url':row.get('url',''),
        'original_url':row.get('_original_url') or row.get('url',''),
        'source':row.get('source') or dom(row.get('url','')),'origin':row.get('origin',''),
        'depth':row.get('_depth',0),'reason':reason,'page_type':page_type,
        'contract_state':contract_state,'contract_hint':bool(row.get('_contract_hint')),
        'text_chars':len(text or ''),'html_chars':len(html or ''),
        'structured_jobposting':bool(structured),'source_quality':source_quality_label(row.get('url','')),
        'fetch':row.get('_fetch_meta') or {},
        'evidence_sample':norm(text)[:1200],
        'structured_fields':{key:structured.get(key,'') for key in ('employment_type','location','date_posted','valid_through') if structured.get(key)},
    }

def audit_decision(row,decision,reason,title='',page_type='',text='',html='',structured=None,
                   contract_state='',availability='',score_value=None,confidence=None,score_reasons=None):
    """Append one bounded, replayable decision record without retaining the scan in RAM."""
    global _DECISION_AUDIT_HANDLE,_DECISION_AUDIT_COUNT
    if _DECISION_AUDIT_HANDLE is None:return
    record=page_audit_record(row,title or row.get('title',''),reason,page_type,text,html,structured,contract_state)
    record.update({'decision':decision,'candidate_id':_DECISION_AUDIT_COUNT+1,
                   'availability':availability,'score':score_value,'confidence':confidence,
                   'score_reasons':score_reasons or [],
                   'scoring_text':str(text or '')[:30000],
                   'scoring_text_sha256':hashlib.sha256(str(text or '').encode('utf-8')).hexdigest(),
                   'run_started_at':RUN_STARTED_AT.isoformat(),'profile_id':ACTIVE_PROFILE_ID,'version':VERSION})
    _DECISION_AUDIT_HANDLE.write(json.dumps(record,ensure_ascii=False,default=str)+'\n')
    _DECISION_AUDIT_COUNT+=1
    if _DECISION_AUDIT_COUNT%25==0:_DECISION_AUDIT_HANDLE.flush()
    if _DECISION_AUDIT_COUNT%100==0:
        try:os.fsync(_DECISION_AUDIT_HANDLE.fileno())
        except OSError:pass

def close_decision_audit():
    global _DECISION_AUDIT_HANDLE
    if _DECISION_AUDIT_HANDLE is not None:
        _DECISION_AUDIT_HANDLE.flush()
        try:os.fsync(_DECISION_AUDIT_HANDLE.fileno())
        except OSError:pass
        _DECISION_AUDIT_HANDLE.close();_DECISION_AUDIT_HANDLE=None

def classify_with_reason(u,title,text,html='',profile=None,candidate_hint=False):
    tl=norm(title).lower(); t=(title+' '+text[:5000]).lower(); parsed=urlparse(u); path=parsed.path.lower()
    bad=['how to become','comment réussir','career guide']
    if any(x in path for x in ['/occupations/','/professions/']) or any(x in tl for x in bad):return 'guide','Guide métier détecté'
    reason=listing_reason(u,title,text,html)
    if reason:return 'listing',reason
    posting_count=count_job_postings(html)
    if posting_count>1:return 'listing',f'{posting_count} objets JobPosting détectés sur la même page'
    url_reason=offer_url_signal(u)
    if url_reason or re.search(r'/offer/(internship|job)',path):
        return 'offer',url_reason or 'URL de fiche détaillée'
    if posting_count==1:return 'offer','Objet JobPosting unique'
    # Company career pages often have custom URLs but must expose several
    # offer-specific sections, not merely repeat the word "internship".
    strong=sum(x in t for x in ['responsibilities','requirements','your profile','what you will do','apply now','apply for this job','candidature','postuler','vos missions','votre profil','praktikum'])
    signal=contract_signal(title,text,profile) if profile else internship_signal(title,text)
    if signal and len(text)>=180 and strong>=1:return 'offer','Contrat ciblé et contenu détaillé'
    # Direct career pages frequently render the description client-side. A
    # title and a detail-like path discovered from a listing are still useful,
    # but will be marked as lower confidence later instead of disappearing.
    if candidate_hint and looks_like_job_title(title) and source_quality(u)>=1:
        return 'offer','Fiche issue d’un listing ciblé (contenu partiel)'
    if source_quality(u)==3 and looks_like_job_title(title) and len(path)>8:
        return 'offer','Page carrière directe avec intitulé de poste'
    return 'other','Preuves insuffisantes pour une offre individuelle'

def classify(u,title,text,html='',profile=None):
    return classify_with_reason(u,title,text,html,profile)[0]

def internship_signal(title,text):
    title_l=fold_text(title);body=fold_text(text[:16000])
    if any(re.search(pattern,title_l) for pattern in INTERNSHIP_TITLE_PATTERNS):return True
    # A mention elsewhere on the page (for example "work with an intern") is
    # not proof that the current opening is an internship. Look for a phrase
    # which describes this position itself.
    body_patterns=(
        r'\b(?:this|the|our|a|an)\s+(?:paid\s+|full[- ]time\s+|part[- ]time\s+)?internship\s+(?:position|role|opportunity)\b',
        r'\b(?:this|the|our)\s+(?:intern|trainee)\s+(?:position|role|opportunity)\b',
        r'\bemployment\s+type\s*[:\-]?\s*(?:intern(?:ship)?|praktikum|trainee)\b',
        r'\b(?:offre|poste)\s+de\s+stage\b',r'\btechnical\s+student\s+position\b',
        r'\bstudent\s+placement\s+position\b',r'\bgraduate\s+internship\s+(?:position|role)\b',
    )
    return any(re.search(pattern,body) for pattern in body_patterns)

def profile_contract_terms(profile):
    student=(profile or {}).get('student') or {};raw_terms=student.get('contract_types') or []
    terms=[raw_terms] if isinstance(raw_terms,str) else list(raw_terms)
    stage_type=str(student.get('stage_type',''))
    if stage_type:terms.append(stage_type)
    lower=' '.join(str(x).lower() for x in terms)
    if any(x in lower for x in ['intern','stage','praktikum']):terms+=['intern','internship','stage','stagiaire','praktikum']
    return list(dict.fromkeys(norm(x).lower() for x in terms if norm(x)))

def contract_signal(title,text,profile):
    sample=(title+' '+text[:12000]).lower();terms=profile_contract_terms(profile)
    objective=' '.join(terms)
    if any(word in objective for word in ('intern','stage','praktikum','stagiaire')):
        return internship_signal(title,text)
    # An individual JobPosting is already an employment signal. CDI/CDD are
    # preferences and must not discard legitimate pages that omit the label.
    if any(word in objective for word in ('emploi','job','cdi','cdd','freelance','temps plein','full-time','part-time')):
        return not bool(contract_rejection(title,text,profile))
    return any(has_term(sample,term) for term in terms) if terms else True

def eligibility_rejection(title,text,meta,profile,structured=None):
    """Return a hard-filter reason for foreign or profile-irrelevant jobs."""
    structured=structured or {};loc,canton,_,_,_,_,_=meta
    incompatible=contract_rejection(title,text,profile)
    if incompatible:return incompatible
    location=norm(structured.get('location') or loc);location_fold=fold_text(location)
    configured=(profile.get('location') or {}).get('countries') or (profile.get('location') or {}).get('country') or []
    countries=[configured] if isinstance(configured,str) else list(configured)
    target_countries={country_aliases(x)[0] for x in countries}

    # Structured JobPosting locations are more reliable than country words in
    # a global footer or a related-jobs carousel.
    if location and target_countries:
        detected=set()
        for canonical,aliases in COUNTRY_ALIASES.items():
            for alias in aliases:
                if re.search(r'(?<!\w)'+re.escape(fold_text(alias))+r'(?!\w)',location_fold):detected.add(canonical);break
        if detected and not (detected & target_countries):
            return f'Localisation hors pays ciblé : {location}'

    title_fold=fold_text(title);body=fold_text(text[:7000]);skills=profile.get('skills') or {};interests=profile.get('interests') or {}
    target_cfg=profile.get('target') or {};configured_terms=[]
    for group in (target_cfg.get('sectors',[]),skills.get('core',[]),skills.get('strong_domains',[]),profile_professional_interests(profile)):
        for term in group:
            value=fold_text(term)
            if len(value)>2 and value not in {fold_text(x) for x in HOBBY_ONLY_TERMS} and value not in configured_terms:configured_terms.append(value)
    for term in target_cfg.get('job_titles',[]) or target_cfg.get('roles',[]) or []:
        value=fold_text(term)
        if len(value)>2 and value not in configured_terms:configured_terms.append(value)
    require_relevance=bool((profile.get('search') or {}).get('require_profile_relevance',True))
    if not require_relevance or not configured_terms:return ''
    family=profile_job_family(profile)
    if family=='software':
        software_title=('developpeur','developer','software','frontend','front end','backend','back end','full stack','fullstack','web','mobile','android','ios','devops','data engineer','machine learning engineer','ai engineer','ingenieur logiciel','architecte logiciel','qa automation','test automation')
        commercial_title=('commercial','sales','business developer','business development','developpement commercial','account manager','chef de produit','product marketing','marketing','seo','communication','club de sport')
        unambiguous_software=('software','frontend','front end','backend','back end','full stack','fullstack','web developer','mobile developer','android','ios','devops','data engineer','machine learning engineer','ai engineer','ingenieur logiciel','architecte logiciel','qa automation','test automation')
        if any(term in title_fold for term in commercial_title) and not any(term in title_fold for term in unambiguous_software):
            return 'Métier hors cible : développement commercial/marketing, pas développement logiciel'
    strong_terms=[term for term in configured_terms if term not in {fold_text(x) for x in WEAK_RELEVANCE_TERMS}]
    title_hit=any(has_term(title_fold,term) for term in strong_terms)
    if family=='software':
        title_hit=title_hit or any(term in title_fold for term in ('developpeur','developer','software engineer','frontend','backend','full stack','web developer','mobile developer','devops','data engineer','machine learning engineer','ingenieur logiciel'))
    technical_title=('engineer','engineering','ingenieur','r&d','research','robot','sensor','capteur','embedded','firmware','electronic','electrical','automation','automatique','instrument','metrolog','vision','signal','software','hardware','data',' ai ','iot','telecom','biomaterial','medical device','medtech','mechatron','validation','test','laboratory','lab intern')
    title_hit=title_hit or any(term in ' '+title_fold+' ' for term in technical_title)
    body_hits=sum(1 for term in strong_terms if has_term(body,term))
    engineering_context=any(term in ' '+body+' ' for term in technical_title)
    if not title_hit and not (engineering_context and body_hits>=2):
        return 'Offre sans lien suffisant avec le profil recherché'
    return ''

def is_application_confirmation(subject,text=''):
    sample=norm(subject+' '+text[:2500]).lower()
    return any(phrase in sample for phrase in APPLICATION_CONFIRMATION_PHRASES)

def looks_like_job_title(value):
    title=norm(value); lower=title.lower()
    if not 7<=len(title)<=220:return False
    generic=('search','filter','next','previous','show more','voir plus','apply','postuler','home','accueil','login','sign in')
    if lower in generic or re.fullmatch(r'\d+',lower):return False
    folded=fold_text(title)
    junk_title_patterns=(
        r'^(?:salaires?\b|salaire\b|salaires?\s+annuels?\b|salaires?\s+moyens?\b)',
        r'^(?:avis\b|avis\s+des?\s+employ[eé]s?\b|avis\s+sur\b|avis\s+de\s+salari[eé]s?\b)',
        r'^(?:salary\b|salaries\b|average\s+salary\b|how\s+much\s+does\b)',
        r'^(?:employee\s+reviews?\b|company\s+reviews?\b|working\s+at\b)',
        r'^(?:questions?\s+d[\'’]entretien\b|interview\s+questions?\b)',
        r'\b(?:salaires?\s+pour\s+le\s+poste|salaires?\s+annuels?\s+pour|avis\s+des?\s+employ[eé]s?\s+pour)\b',
    )
    if any(re.search(pat,folded) for pat in junk_title_patterns):return False
    role_words=('intern','stage','stagiaire','praktikum','engineer','engineering','developer','scientist','research','robot','sensor','firmware','electronics','automation','associate','trainee','student','manager','assistant','commercial','sales','marketing','technician','technicien','operator','operateur','consultant','accountant','comptable','responsable','specialist','specialiste','chef de projet')
    return any(word in lower for word in role_words)

def listing_lead_is_noise(url,title=''):
    """Reject navigation, app-store and promotional links captured as cards."""
    if not url:return False
    parsed=urlparse(url);host=(parsed.hostname or '').lower().removeprefix('www.');path=parsed.path.lower()
    blocked_hosts={'apps.apple.com','itunes.apple.com','play.google.com','apps.microsoft.com','instagram.com','facebook.com'}
    if host in blocked_hosts:return True
    if search_result_filter_status(url,canon(url))!='URL exploitable':return True
    if 'indeed.' in host and (path.startswith('/career/') or path.startswith('/promo/')):return True
    if any(marker in path for marker in ('/salaires/','/salaire/','/cmp/','/reviews/','/salaries/','/salary/','/avis/','/career-advice/','/interview/')):return True
    if path in ('/login','/signin','/signup','/register','/privacy','/terms'):return True
    folded=fold_text(title)
    if any(marker in folded for marker in ('telecharger l application','download the app','app store','google play','salaires annuels pour','salaire pour le poste','avis des employes pour','employee reviews for')):return True
    return False

def discover_listing_leads(u,html):
    """Extract individual job cards from a listing, including title-only leads."""
    if not html:return []
    soup=BeautifulSoup(html,'html.parser');max_leads=int(os.getenv('MAX_LISTING_DETAILS','40'));leads=[];seen_titles={};seen_urls=set()
    def add(title,href='',company='',location=''):
        title=norm(title)
        if not looks_like_job_title(title):return
        resolved=unwrap_url(urljoin(u,href)) if href else ''
        if resolved and listing_lead_is_noise(resolved,title):return
        if resolved and (not safe_public_url(resolved) or canon(resolved)==canon(u)):resolved=''
        title_key=re.sub(r'\W+',' ',title.lower()).strip();url_key=canon(resolved) if resolved else ''
        if title_key in seen_titles:
            existing=leads[seen_titles[title_key]]
            if resolved and not existing.get('url'):existing['url']=resolved
            if company and not existing.get('company'):existing['company']=norm(company)
            if location and not existing.get('location'):existing['location']=norm(location)
            return
        if url_key and url_key in seen_urls:return
        seen_titles[title_key]=len(leads)
        if url_key:seen_urls.add(url_key)
        leads.append({'title':title,'url':resolved,'company':norm(company),'location':norm(location),'listing_url':u,'listing_source':dom(u)})

    # Specialized platform connectors (LinkedIn, jobs.ch/jobup, iAgora, Glassdoor, Indeed, JobTeaser)
    try:
        for card in connectors.extract_specialized_listing_leads(u, html):
            add(card.get('title',''), card.get('href',''), card.get('company',''), card.get('location',''))
    except Exception:
        pass

    # Prefer structured multi-offer data when available.
    def walk(value):
        if isinstance(value,dict):
            kinds=value.get('@type',[]);kinds=kinds if isinstance(kinds,list) else [kinds]
            if any(str(kind).lower()=='jobposting' for kind in kinds):
                org=value.get('hiringOrganization') or {};company=org.get('name','') if isinstance(org,dict) else ''
                add(value.get('title',''),value.get('url',''),company,'')
            for child in value.values():walk(child)
        elif isinstance(value,list):
            for child in value:walk(child)
    for script in soup.find_all('script',attrs={'type':re.compile(r'ld\+json',re.I)}):
        try:walk(json.loads(script.string or script.get_text() or ''))
        except Exception:continue

    # Workday, Greenhouse, Lever, SmartRecruiters and Next.js frequently keep
    # their cards in application/json instead of schema.org. Read bounded JSON
    # payloads and require both a job-like title and a destination URL/path.
    def walk_embedded(value,depth=0):
        if depth>10:return
        if isinstance(value,dict):
            title=next((value.get(key) for key in ('title','jobTitle','job_title','name','postingTitle') if isinstance(value.get(key),str)), '')
            href=next((value.get(key) for key in ('url','jobUrl','job_url','applyUrl','externalPath','absolute_url','hostedUrl','canonicalPositionUrl') if isinstance(value.get(key),str)), '')
            company=next((value.get(key) for key in ('company','companyName','organization','hiringOrganization') if isinstance(value.get(key),str)), '')
            location=next((value.get(key) for key in ('location','locationName','city','locationsText') if isinstance(value.get(key),str)), '')
            if title and href:add(title,href,company,location)
            for child in value.values():walk_embedded(child,depth+1)
        elif isinstance(value,list):
            for child in value[:500]:walk_embedded(child,depth+1)
    for script in soup.find_all('script',attrs={'type':re.compile(r'(?:application|text)/(?:json|x-component)',re.I)},limit=30):
        payload=script.string or script.get_text() or ''
        if not payload or len(payload)>4_000_000:continue
        try:walk_embedded(json.loads(payload))
        except Exception:continue

    detail_markers=('/vacancies/detail/','/emplois/detail/','/jobs/view/','/jobs/detail/','/job/view/','/job/','/position/','/requisition/')
    # Anchors and their surrounding card capture both conventional job boards
    # and SEO listings where the clickable icon itself has no text.
    for a in soup.find_all('a',href=True):
        href=a.get('href','');label=norm(a.get_text(' ',strip=True));container=a
        for _ in range(4):
            if not container.parent:break
            container=container.parent
            heading=container.find(['h2','h3','h4'])
            if heading and looks_like_job_title(heading.get_text(' ',strip=True)):
                label=norm(heading.get_text(' ',strip=True));break
        context=norm(container.get_text(' ',strip=True))[:700]
        resolved=unwrap_url(urljoin(u,href))
        path=urlparse(resolved).path.lower() if safe_public_url(resolved) else ''
        if any(marker in path for marker in detail_markers) or looks_like_job_title(label) or (internship_signal(label,context) and looks_like_job_title(context[:220])):
            add(label or context[:220],href)
        if len(leads)>=max_leads:break

    # Preserve visible job headings even when JavaScript hides the destination.
    if len(leads)<max_leads:
        for heading in soup.find_all(['h2','h3','h4']):
            add(heading.get_text(' ',strip=True))
            if len(leads)>=max_leads:break
    return leads[:max_leads]

def discover_detail_links(u,html):
    return [lead['url'] for lead in discover_listing_leads(u,html) if lead.get('url')]

def listing_lead_priority(lead,profile,components=None,contract_terms=None):
    """Rank listing cards with the same words that define the profile."""
    components=components or profile_search_components(profile)
    contract_terms=contract_terms or profile_contract_terms(profile)
    sample=fold_text(' '.join(str(lead.get(key,'')) for key in ('title','company','location')))
    role_hits=sum(1 for term in components['roles'] if fold_text(term) in sample)
    theme_hits=sum(1 for term in components['themes'] if fold_text(term) in sample)
    contract_hits=sum(1 for term in contract_terms if fold_text(term) in sample)
    detail_bonus=10 if offer_url_signal(lead.get('url','')) else 0
    return role_hits*12+theme_hits*5+contract_hits*4+source_quality(lead.get('url',''))+detail_bonus

def targeted_fixed_urls(profile):
    """Turn generic pack URLs into profile-aware listing searches."""
    base_urls=[u for u in (profile.get('_source_pack_urls',[]) or []) if safe_public_url(u)]
    components=profile_search_components(profile);countries=components['countries'] or ['']
    anchors=_unique_terms([components['roles'],components['themes']],6)
    if not anchors:anchors=['engineering']
    mode=profile_contract_mode(profile)
    terms=[]
    for anchor in anchors[:3]:terms.append(norm(f'{"internship" if mode=="internship" else "job"} {anchor}'))
    out=[]
    for index,base in enumerate(base_urls):
        parsed=urlparse(base);host=(parsed.hostname or '').lower().removeprefix('www.');term=terms[index%len(terms)]
        path=parsed.path.lower()
        # A country pack may contain an internship-only landing page. It must
        # never pollute an employment profile (observed with iAgora).
        if mode=='employment' and any(marker in path for marker in ('/internships/','/internship/','/stages/')):continue
        country=countries[index%len(countries)] if countries else ''
        query=dict(parse_qsl(parsed.query,keep_blank_values=True))
        if host in {'jobs.ch','jobup.ch','jobscout24.ch'}:
            query['term']=term
        elif 'linkedin.com' in host:
            query['keywords']=term;query['location']=country
        elif host.endswith('stepstone.de'):
            query['ke']=term;query['ws']=country
        elif 'indeed.' in host:
            query['q']=term;query['l']=country
        elif host.endswith('francetravail.fr'):
            query['motsCles']=term
        elif host.endswith('apec.fr'):
            query['motsCles']=term
        elif host in {'welcometothejungle.com','hellowork.com','jobteaser.com'}:
            local_intent='stage' if mode=='internship' else 'emploi'
            query['query']=norm(f'{local_intent} {anchors[index%len(anchors)]}')
        targeted=urlunparse((parsed.scheme,parsed.netloc,parsed.path,parsed.params,urlencode(query),''))
        out.append(targeted)
    return list(dict.fromkeys(out))

def fixed_site_candidates(profile,c=None):
    """Visit selected listing pages directly, without relying on a search index."""
    urls=targeted_fixed_urls(profile)
    max_sites=max(0,min(int(os.getenv('FIXED_SITE_LIMIT',str(len(urls) or 0))),30))
    urls=rank_fixed_urls(c,urls)[:max_sites]
    if not urls:
        log_event('SITES FIXES — aucune page configurée pour ce profil.','dim');return []
    rows=[{'url':u,'title':'','snippet':'','source':dom(u),'origin':'fixed_site'} for u in urls]
    candidates=[];seen=set();title_only=0;raw_leads=0
    priority_components=profile_search_components(profile);priority_contracts=profile_contract_terms(profile)
    log_event(f'SITES FIXES — exploration directe de {len(rows)} listing(s).','bold cyan')
    fixed_started=time.perf_counter()
    for row,text,html,final_url in iter_parallel_pages(rows,label='SITES FIXES'):
        leads=discover_listing_leads(final_url or row['url'],html)
        state='OK' if html else 'HTML vide / accès bloqué'
        log_event(f'SITE FIXE · {dom(final_url or row["url"])} · {state} · {len(html)} car. HTML · {len(leads)} piste(s) · {short_text(final_url or row["url"],88)}','green' if leads else 'yellow')
        raw_leads+=len(leads)
        host=dom(final_url or row['url']);SCAN_METRICS['fixed_sites'][host]={'html_chars':len(html),'leads':len(leads),'state':state}
        record_source_metric(c,host,'fixed',attempts=1,links=len(leads),elapsed_ms=0)
        title_only+=sum(1 for lead in leads if not lead.get('url'))
        leads=sorted(leads,key=lambda lead:listing_lead_priority(lead,profile,priority_components,priority_contracts),reverse=True)
        for lead in leads:
            url=lead.get('url');canonical=candidate_identity(url or '')
            if not url or canonical in seen:continue
            seen.add(canonical)
            candidates.append({
                'url':url,'title':lead.get('title',''),'snippet':'',
                'source':dom(url),'origin':'fixed_site','_depth':1,
                '_contract_hint':contract_signal(lead.get('title',''),lead.get('company','')+' '+lead.get('location',''),profile),
                '_listing_url':final_url or row['url'],
                'company':lead.get('company',''),'location':lead.get('location',''),
            })
    if c is not None:c.commit()
    SCAN_METRICS['phases']['fixed_sites_seconds']=round(time.perf_counter()-fixed_started,2)
    log_event(f'SITES FIXES — {len(candidates)} lien(s) individuel(s) extrait(s) sur {raw_leads} piste(s) · {title_only} titre(s) sans lien ignoré(s).','green' if candidates else 'yellow')
    return candidates

def profile_date(profile,key):
    raw=(profile.get('student') or {}).get(key)
    if isinstance(raw,date):return raw
    try:return date.fromisoformat(str(raw)) if raw else None
    except (TypeError,ValueError):return None

def detect_start_date(text):
    """Detect an explicitly announced internship start, not arbitrary dates."""
    sample=norm(text[:30000]).lower()
    month_names='|'.join(sorted((re.escape(x) for x in MONTHS),key=len,reverse=True))
    patterns=[
        rf'(?:start(?:ing|s| date)?|begin(?:ning|s)?|commence(?:ment|ra| en)?|début|debut|beginn)\D{{0,45}}(?:\d{{1,2}}(?:st|nd|rd|th)?\s+)?({month_names})\s*[,/-]?\s*(20\d{{2}})',
        rf'(?:from|dès|des|ab)\s+(?:\d{{1,2}}(?:st|nd|rd|th)?\s+)?({month_names})\s*[,/-]?\s*(20\d{{2}})'
    ]
    for pattern in patterns:
        match=re.search(pattern,sample,re.I)
        if match:
            month=MONTHS.get(match.group(1).lower()); year=int(match.group(2))
            if month:return date(year,month,1),f'{match.group(1).capitalize()} {year}'
    numeric=re.search(r'(?:start(?:ing| date)?|commence(?:ment)?|début|debut|beginn)\D{0,25}(\d{1,2})[./-](\d{1,2})[./-](20\d{2})',sample,re.I)
    if numeric:
        first,second,year=map(int,numeric.groups()); day,month=(first,second) if second<=12 else (second,first)
        try:return date(year,month,day),f'{day:02d}/{month:02d}/{year}'
        except ValueError:pass
    return None,''

NUMBER_WORDS={'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,'ten':10,'twelve':12,
              'ein':1,'zwei':2,'drei':3,'vier':4,'fünf':5,'funf':5,'sechs':6,'sieben':7,'acht':8,'neun':9,'zehn':10,
              'un':1,'deux':2,'trois':3,'quatre':4,'cinq':5,'sept':7,'huit':8,'neuf':9,'dix':10,'douze':12}

def duration_bounds_weeks(text):
    """Return (minimum weeks, maximum weeks, readable label) when stated."""
    sample=fold_text(text[:30000])
    amount=r'(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|ein|zwei|drei|vier|funf|sechs|sieben|acht|neun|zehn|un|deux|trois|quatre|cinq|sept|huit|neuf|douze)'
    unit=r'(months?|mois|monate|monat|weeks?|wochen|semaine(?:s)?)'
    range_match=re.search(rf'\b{amount}\s*(?:-|–|to|through|bis|à|a)\s*{amount}\s*{unit}\b',sample)
    hyphenated_month=re.search(rf'\b{amount}[- ]months?\b',sample)
    exact_match=re.search(rf'\b{amount}\s*{unit}\b',sample)
    match=range_match or exact_match or hyphenated_month
    if not match:return None,None,''
    def value(raw):return int(raw) if raw.isdigit() else NUMBER_WORDS.get(raw,0)
    first=value(match.group(1));last=value(match.group(2)) if range_match else first
    if not first or not last:return None,None,''
    if range_match:unit_value=match.group(3)
    elif exact_match:unit_value=match.group(2)
    else:unit_value='months'
    monthly=unit_value.startswith(('month','mois','monat'))
    factor=4.345 if monthly else 1.0
    label_unit='mois' if monthly else 'semaines'
    label=f'{first}–{last} {label_unit}' if range_match else f'{first} {label_unit}'
    return min(first,last)*factor,max(first,last)*factor,label

def detect_start_window(text):
    """Read a fixed or multi-month start window without choosing a fake day."""
    sample=norm(text[:30000]).lower()
    month_names='|'.join(sorted((re.escape(x) for x in MONTHS),key=len,reverse=True))
    anchored=re.search(rf'(?:start(?:ing|s| date)?|begin(?:ning|s)?|commence(?:ment|ra| en)?|début|debut|beginn|ab|from|dès)\b[^.!?\n]{0,100}?({month_names})[^.!?\n]{0,55}?(20\d{2})',sample,re.I)
    if anchored:
        clause=anchored.group(0);year=int(anchored.group(2))
        months=[MONTHS[m.group(0).lower()] for m in re.finditer(month_names,clause,re.I) if m.group(0).lower() in MONTHS]
        if months:
            first,last=min(months),max(months);label=f'{first:02d}/{year}' if first==last else f'{first:02d}–{last:02d}/{year}'
            last_day=calendar.monthrange(year,last)[1]
            return date(year,first,1),date(year,last,last_day),label
    numeric=re.search(r'(?:start(?:ing| date)?|commence(?:ment)?|début|debut|beginn)\D{0,25}(\d{1,2})[./-](\d{1,2})[./-](20\d{2})',sample,re.I)
    if numeric:
        first,second,year=map(int,numeric.groups());day,month=(first,second) if second<=12 else (second,first)
        try:
            parsed=date(year,month,day);return parsed,parsed,parsed.strftime('%d/%m/%Y')
        except ValueError:pass
    return None,None,''

def source_quality(url):
    host=dom(url)
    if host in AGGREGATOR_HOSTS or any(host.endswith('.'+x) for x in AGGREGATOR_HOSTS):return 0
    if 'linkedin.com' in host:return 1
    if host in JOB_BOARD_HOSTS or any(host.endswith('.'+x) for x in JOB_BOARD_HOSTS):return 2
    if host in VERIFIED_DIRECT_HOSTS or any(host.endswith('.'+x) for x in VERIFIED_DIRECT_HOSTS):return 3
    # Unknown hosts are not verified employer sources and get no source bonus.
    return 1

def source_quality_label(url):
    host=dom(url)
    if source_quality(url)==0:return 'agrégateur'
    if 'linkedin.com' in host:return 'réseau social'
    if source_quality(url)==2:return 'job board'
    if source_quality(url)==3:return 'site employeur vérifié'
    return 'source non vérifiée'

LANGUAGE_ALIASES={
    'de':['german','deutsch','allemand'],
    'en':['english','anglais'],
    'fr':['french','français','francais'],
    'it':['italian','italiano','italien'],
    'nl':['dutch','nederlands','néerlandais','neerlandais'],
    'es':['spanish','español','espagnol'],
}
LANGUAGE_LABELS={'de':'Allemand','en':'Anglais','fr':'Français','it':'Italien','nl':'Néerlandais','es':'Espagnol'}

def language_requirements(text):
    """Classify each language from the clause that mentions it, not nearby clauses."""
    mandatory=set();preferred=set()
    must=re.compile(r'\b(required|mandatory|must|fluent|proficient|excellent command|very good command|c1|b2|obligatoire|exigé|exige|courant|fließend|fliessend|erforderlich|voraussetzung)\b',re.I)
    prefer=re.compile(r'\b(advantage|plus|preferred|preferable|asset|appreciated|desirable|bonus|souhaité|souhaite|apprécié|apprecie|atout|idéalement|ideally|von vorteil|wünschenswert|wuenschenswert)\b',re.I)
    for sentence in re.split(r'(?<=[.!?;])\s+|[\r\n]+',norm(text[:30000])):
        folded=fold_text(sentence)
        present={code for code,aliases in LANGUAGE_ALIASES.items() if any(re.search(r'(?<!\w)'+re.escape(fold_text(alias))+r'(?!\w)',folded) for alias in aliases)}
        if not present:continue
        if must.search(folded):mandatory.update(present)
        elif prefer.search(folded):preferred.update(present)
    preferred-=mandatory
    return mandatory,preferred

def detect_meta(title,text,profile,location_hint=''):
    t=(title+' '+text).lower(); loc=norm(location_hint); canton=''; lang='Non explicite'; duration=''; start=''; cat='Engineering'
    configured_countries=(profile.get('location') or {}).get('countries') or (profile.get('location') or {}).get('country') or []
    if isinstance(configured_countries,str):configured_countries=[configured_countries]
    target_country_keys=[country_aliases(x)[0] for x in configured_countries]
    location_sources=[norm(location_hint)+' '+title,text[:10000]]
    region_hit=regions.detect_country_region(location_sources,target_country_keys,profile_custom_regions=profile_regions(profile))
    if region_hit:
        canton,matched_term=region_hit; loc=loc or norm(matched_term).title()
    mandatory_languages,preferred_languages=language_requirements(text)
    mentioned={code for code,aliases in LANGUAGE_ALIASES.items() if any(fold_text(alias) in fold_text(text[:30000]) for alias in aliases)}
    accepted={str(x).lower() for x in (profile.get('location') or {}).get('acceptable_language',['fr','en'])}
    user_langs=[str(x).lower() for x in (profile.get('location') or {}).get('acceptable_language',[])]
    language_order=[code for code in user_langs if code in LANGUAGE_ALIASES]+[code for code in ['fr','en','it','nl','es','de'] if code not in user_langs]
    primary=next((code for code in language_order if code in mandatory_languages and code in accepted),None)
    primary=primary or next((code for code in language_order if code in mandatory_languages),None)
    primary=primary or next((code for code in language_order if code in mentioned and code in accepted),None)
    primary=primary or next((code for code in language_order if code in preferred_languages),None)
    primary=primary or next((code for code in language_order if code in mentioned),None)
    if primary:
        lang=LANGUAGE_LABELS[primary]
        if primary=='de' and primary in mandatory_languages:lang='Allemand obligatoire'
        elif primary=='de':lang='Allemand mentionné'
    _,_,duration=duration_bounds_weeks(text)
    _,_,start=detect_start_window(title+' '+text)
    cats=[('Robotique',['robot','slam','perception']),('Embarqué / Firmware',['embedded','firmware','microcontroller','fpga']),('Capteurs / Instrumentation',['sensor','capteur','instrumentation','metrology','métrologie']),('Automatique / Contrôle',['automation','automatique','control system','plc']),('Électronique',['electronics','électronique','electrical']),('Signal / Vision',['signal processing','image processing','computer vision']),('IA / Data',['artificial intelligence','machine learning','data engineering']),('Medtech',['medtech','medical device']),('IoT / Objets connectés',['iot','internet of things','connected device']),('Test / Validation',['test engineering','validation','verification'])]
    for name,terms in cats:
        if any(x in t for x in terms): cat=name; break
    # Canonical groups avoid counting French/English synonyms as separate skills.
    skill_groups={
        'Capteurs':['sensors','sensor','capteurs','capteur','sensing'],
        'Instrumentation / métrologie':['instrumentation','metrology','métrologie'],
        'Acquisition de données':['data acquisition','systèmes d\'acquisition','systemes d\'acquisition'],
        'Traitement du signal':['signal processing','traitement du signal'],
        'Traitement d’images / vision':['image processing','traitement d\'images','computer vision'],
        'Automatique / contrôle':['automation','automatique','control systems','control system','plc'],
        'Systèmes embarqués':['embedded systems','embedded system','systèmes embarqués','systemes embarques'],
        'Électronique':['electronics','électronique','electronique','electrical engineering'],
        'Informatique':['computer science','informatique'],
        'IA / ML':['artificial intelligence','machine learning'],
        'Robotique / SLAM':['robotics','robotique','slam'],
        'IoT':['iot','internet of things','connected devices','objets communicants'],
        'Réseaux / cybersécurité':['networks','réseaux','reseaux','cybersecurity','sécurité informatique'],
        'Firmware / microcontrôleurs':['firmware','microcontroller','microcontrôleur','microcontroleur'],
        'FPGA / PCB':['fpga','pcb']
    }
    skills=[]
    for label,terms in skill_groups.items():
        if any(has_term(t,s) for s in terms):skills.append(label)
    return loc,canton,lang,duration,start,cat,skills[:10]

def score(title,text,meta,ptype,profile,url='',company='',structured=None):
    loc,canton,lang,duration,start,cat,skills=meta
    title_text=fold_text(title);body=fold_text(text[:30000]);student=profile.get('student') or {}
    location_cfg=profile.get('location') or {};skills_cfg=profile.get('skills') or {}
    reasons=[];sc=0;conf=30
    if ptype=='offer':sc+=10;conf+=20
    if contract_signal(title,text,profile):
        sc+=10;reasons.append('Type de contrat ciblé confirmé');conf+=10

    # Count canonical skill groups once. Synonyms, domains and interests no
    # longer stack several independent bonuses for the same word.
    if skills:
        skill_points=min(30,len(skills)*5);sc+=skill_points
        reasons.append('Compétences ciblées: '+', '.join(skills[:6]))
    target_roles=(profile.get('target') or {}).get('job_titles') or (profile.get('target') or {}).get('roles') or []
    role_terms=[]
    for role in target_roles:
        cleaned=fold_text(re.sub(r'\b(internship|intern|stagiaire|stage|praktikum|engineer|engineering|ingénieur|ingenieur)\b',' ',str(role)))
        role_terms.extend(term for term in cleaned.split() if len(term)>3)
    role_hits=list(dict.fromkeys(term for term in role_terms if has_term(title_text,term)))
    if role_hits:
        sc+=min(12,4*len(role_hits));reasons.append('Métier proche du titre ciblé: '+', '.join(role_hits[:3]))
    elif any(has_term(title_text,term) for term in ('engineer','engineering','ingenieur','robot','sensor','capteur','embedded','firmware','electronics','electrical','automation','instrumentation','mechatron','research')):
        sc+=6;reasons.append('Intitulé technique pertinent')

    professional_hits=list(dict.fromkeys(str(x) for x in profile_professional_interests(profile) if has_term(body,x)))
    if professional_hits:
        sc+=min(6,3*len(professional_hits));reasons.append('Secteurs ciblés: '+', '.join(professional_hits[:3]))

    soft_flags=((profile.get('target') or {}).get('soft_red_flags') or (profile.get('search') or {}).get('soft_red_flags') or [])
    if isinstance(soft_flags,str):soft_flags=[soft_flags]
    soft_hits=[norm(f) for f in soft_flags if norm(f) and has_term(title_text,fold_text(f))]
    if soft_hits:
        penalty=min(50,25*len(soft_hits))
        sc-=penalty
        reasons.append(f'Mots à éviter détectés dans le titre: {", ".join(soft_hits)} (−{penalty} pts)')

    canton_code='';match=re.search(r'\|\s*([A-Z]{2})\s*\|',canton or '')
    if match:canton_code=match.group(1)
    priority={str(x).upper() for x in location_cfg.get('priority_cantons',[])}|{str(x).upper() for x in location_cfg.get('priority_locations',[])}
    for region in profile_regions(profile):priority|={str(region.get('code','')).upper(),str(region.get('name','')).upper()}
    if canton:
        is_priority=canton_code in priority or any(value and value in canton.upper() for value in priority)
        sc+=8 if is_priority else 3
        reasons.append(('Zone prioritaire: ' if is_priority else 'Zone détectée: ')+canton);conf+=8

    countries=location_cfg.get('countries') or location_cfg.get('country') or []
    if isinstance(countries,str):countries=[countries]
    location_sample=fold_text(norm((structured or {}).get('location','')+' '+loc+' '+canton))
    country_hits=[]
    for country in countries:
        _,aliases=country_aliases(country)
        if any(re.search(r'(?<!\w)'+re.escape(fold_text(alias))+r'(?!\w)',location_sample) for alias in aliases):country_hits.append(str(country))
    if not country_hits and canton and any(fold_text(x) in ('switzerland','suisse','schweiz','svizzera') for x in countries):country_hits=['Switzerland']
    if country_hits:sc+=4;reasons.append('Pays ciblé: '+', '.join(country_hits[:2]));conf+=4
    else:
        conf-=8;reasons.append('Pays exact non confirmé')

    mandatory,preferred=language_requirements(text)
    acceptable={str(x).lower() for x in location_cfg.get('acceptable_language',['fr','en'])}
    supported=mandatory & acceptable
    unsupported=mandatory-acceptable
    german_cfg=location_cfg.get('german') or {}
    if supported:
        sc+=5;reasons.append('Langue obligatoire acceptée: '+', '.join(LANGUAGE_LABELS[x] for x in sorted(supported)));conf+=7
    if unsupported:
        german_penalty=int(german_cfg.get('mandatory_penalty',45)) if 'de' in unsupported else 20
        sc-=german_penalty;reasons.append('Langue obligatoire hors profil: '+', '.join(LANGUAGE_LABELS[x] for x in sorted(unsupported))+f' (−{german_penalty})');conf+=8
    if 'de' in preferred:
        penalty=int(german_cfg.get('preferred_penalty',10));sc-=penalty
        reasons.append(f'Allemand apprécié, non obligatoire (−{penalty})')
    elif preferred:
        reasons.append('Langue appréciée: '+', '.join(LANGUAGE_LABELS[x] for x in sorted(preferred)))
    elif not mandatory:
        conf-=4;reasons.append('Exigences linguistiques non extraites')

    min_weeks=max(0,int(student.get('min_weeks',0) or 0))
    duration_min,duration_max,duration_label=duration_bounds_weeks(text)
    if duration_min is not None:
        if duration_min>=min_weeks:
            sc+=5;reasons.append(f'Durée minimale compatible: {duration_label}');conf+=6
        elif duration_max<min_weeks:
            sc-=20;reasons.append(f'Durée trop courte: {duration_label}');conf+=6
        else:
            sc+=2;reasons.append(f'Durée à confirmer: {duration_label}');conf+=2
    else:
        conf-=4;reasons.append('Durée non confirmée')

    candidate_start,candidate_start_last,start_label=detect_start_window(title+' '+text)
    wanted_start=profile_date(profile,'start_date');wanted_end=profile_date(profile,'end_date')
    if candidate_start and wanted_start and wanted_end:
        required_weeks=max(min_weeks,duration_min or 0)
        latest_feasible=wanted_end-timedelta(days=round(required_weeks*7))
        earliest=max(candidate_start,wanted_start)
        latest=min(candidate_start_last,latest_feasible)
        if candidate_start_last<wanted_start:
            sc-=20;reasons.append(f'Début antérieur à la disponibilité: {start_label}');conf+=6
        elif candidate_start>wanted_end:
            sc-=20;reasons.append(f'Début après la disponibilité: {start_label}');conf+=6
        elif latest<earliest:
            sc-=20;reasons.append(f'Calendrier incompatible avec la durée minimale ({required_weeks:.0f} semaines): {start_label}');conf+=6
        else:
            sc+=5;reasons.append(f'Calendrier compatible à confirmer: {start_label}');conf+=5
    else:
        conf-=3;reasons.append('Date de début non confirmée')

    if len(text)>=1500:conf+=10
    elif len(text)<250:conf-=15
    if source_quality(url)==0:conf-=5;reasons.append('Source agrégatrice')
    elif source_quality(url)==2:conf+=4;reasons.append('Job board reconnu')
    elif source_quality(url)==3:conf+=4;reasons.append('Site employeur vérifié')
    else:reasons.append('Source non vérifiée')
    if company in ('','Unknown'):conf-=12;reasons.append('Entreprise non identifiée')
    else:conf+=4
    if structured:
        conf+=8;reasons.append('Champs structurés présents (à vérifier sur la page)')

    # Tinder decisions remain available to the UI, but do not alter ranking
    # until review reasons can distinguish skill fit from calendar/contract fit.
    learned_adjustment=0
    return max(0,min(100,round(sc,1))),max(0,min(100,conf)),reasons

def extract_job_posting(html,url=''):
    """Read schema.org JobPosting data or specialized connectors (LinkedIn, jobs.ch, iAgora, Glassdoor, Indeed)."""
    if not html:return {}
    res={}
    def walk(value):
        if isinstance(value,dict):
            kind=value.get('@type',[]); kinds=kind if isinstance(kind,list) else [kind]
            if any(str(x).lower()=='jobposting' for x in kinds):return value
            for child in value.values():
                found=walk(child)
                if found:return found
        elif isinstance(value,list):
            for child in value:
                found=walk(child)
                if found:return found
        return None
    soup=BeautifulSoup(html,'html.parser')
    for script in soup.find_all('script',attrs={'type':re.compile(r'ld\+json',re.I)}):
        try:data=json.loads(script.string or script.get_text() or '')
        except Exception:continue
        job=walk(data)
        if not job:continue
        org=job.get('hiringOrganization') or {}; company=org.get('name','') if isinstance(org,dict) else ''
        locations=job.get('jobLocation') or []; locations=locations if isinstance(locations,list) else [locations]; parts=[]
        for item in locations:
            if not isinstance(item,dict):continue
            address=item.get('address') or {}; address=address if isinstance(address,dict) else {}
            value=', '.join(norm(address.get(k)) for k in ('addressLocality','addressRegion','addressCountry') if norm(address.get(k)))
            if value:parts.append(value)
        description=BeautifulSoup(str(job.get('description','')),'html.parser').get_text(' ',strip=True)[:60_000]
        employment=job.get('employmentType','');employment=' / '.join(str(x) for x in employment) if isinstance(employment,list) else str(employment or '')
        res={
            'title':norm(job.get('title')),'company':norm(company),'location':norm(' / '.join(parts)),
            'description':norm(description),'valid_through':norm(job.get('validThrough')),
            'date_posted':norm(job.get('datePosted')),'employment_type':norm(employment),
            'job_url':norm(job.get('url')),
        }
        break

    if url:
        try:
            spec=connectors.parse_specialized_job_posting(url,html)
            if spec:
                if not res:
                    res=spec
                else:
                    for k,v in spec.items():
                        if v and not res.get(k):res[k]=v
        except Exception:
            pass
    return res

def application_availability(title,text,html='',job_data=None):
    """Return open/closed/unknown without trusting hidden global page strings.

    Job boards often keep phrases such as "job no longer available" in
    JavaScript bundles, related-offer widgets or footers. V6.1 scanned the raw
    HTML and therefore produced false closures on jobs.ch/jobup/Onlyfy.
    """
    job_data=job_data or {}
    raw=html_unescape(str(text or '')[:30000]);plain=raw
    if '<' in raw:
        soup=BeautifulSoup(raw,'html.parser')
        for node in soup(['script','style','noscript','nav','footer','header','aside']):node.decompose()
        plain=soup.get_text(' ',strip=True)
    sample=fold_text(title+' '+plain[:20000])
    phrases=[
        'no longer accepting applications','no longer available','job is no longer available',
        'not accepting applications','applications are no longer accepted','applications are closed',
        'position has been filled','vacancy has been filled','vacancy is closed',
        'application deadline has passed','this job has expired','job expired',
        'n’accepte plus les candidatures',"n'accepte plus les candidatures",'candidatures ne sont plus acceptees',
        'les candidatures ne sont plus acceptees','offre expiree','offre n’est plus disponible',
        "offre n'est plus disponible",'poste a ete pourvu','poste est pourvu',
        'bewerbungen werden nicht mehr angenommen','stelle ist nicht mehr verfugbar'
    ]
    if any(fold_text(x) in sample for x in phrases):return 'closed','Message explicite de fermeture visible',98
    if re.search(r'candidatures?.{0,35}(?:plus|pas).{0,35}acceptees?',sample):return 'closed','Message explicite de fermeture visible',98

    # L'ancienneté seule ne prouve pas une fermeture : certaines entreprises
    # gardent une campagne ouverte plusieurs mois. Elle ne devient donc qu'un
    # indice lorsque ni JobPosting actif ni bouton de candidature n'est trouvé.
    stale_months=re.search(r'(?:posted|reposted|publiée?|republication)\D{0,24}(\d+)\s+(?:months?|mois)',sample)
    valid=job_data.get('valid_through','')
    if valid:
        try:
            deadline=date.fromisoformat(valid[:10])
            if deadline<datetime.now(timezone.utc).date():return 'closed',f'Deadline dépassée ({deadline.isoformat()})',100
            return 'open',f'Deadline active jusqu’au {deadline.isoformat()}',100
        except Exception:pass
    posted=job_data.get('date_posted','');posted_age=None
    if posted:
        try:
            posted_date=date.fromisoformat(posted[:10]); max_age=int(os.getenv('MAX_JOB_AGE_DAYS','90'))
            posted_age=(datetime.now(timezone.utc).date()-posted_date).days
        except Exception:pass
    if job_data.get('title') and job_data.get('description'):
        return 'open','Objet JobPosting complet',92
    if html:
        soup=BeautifulSoup(html,'html.parser')
        apply_words=re.compile(r'\b(apply(?: now)?|postuler|bewerben|candidater|send application)\b',re.I)
        for element in soup.find_all(['a','button'],limit=250):
            if apply_words.search(norm(element.get_text(' ',strip=True))):return 'open','Bouton de candidature détecté',86
    if posted_age is not None and posted_age>int(os.getenv('MAX_JOB_AGE_DAYS','90')):
        return 'unknown',f'Annonce ancienne ({posted_age} jours), disponibilité à vérifier',35
    if stale_months and int(stale_months.group(1))>=3:
        return 'unknown',f'Annonce ancienne ({stale_months.group(1)} mois), disponibilité à vérifier',35
    return 'unknown','Statut non confirmé : aucune preuve fiable de fermeture',45

def application_is_closed(title,text,job_data=None):
    """Backward-compatible boolean facade used by tests and older callers."""
    status,reason,_=application_availability(title,text,'',job_data)
    return status=='closed',reason

def linkedin_job_state(url):
    """Use LinkedIn's public guest fragment to catch closed/removed job IDs."""
    if 'linkedin.com' not in dom(url):return False,''
    match=re.search(r'(?:jobs/view/[^/?#]*-|jobs/view/)(\d{7,})',url)
    if not match:return False,''
    job_id=match.group(1);endpoints=[
        'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/'+job_id,
        'https://www.linkedin.com/jobs/view/'+job_id,
    ]
    try:
        for endpoint in endpoints:
            response=http_session().get(endpoint,headers={'Accept-Language':'fr-FR,fr;q=0.9,en;q=0.8'},timeout=15,allow_redirects=True)
            if response.status_code in (404,410):return True,f'Annonce LinkedIn retirée (HTTP {response.status_code})'
            if response.status_code>=400:continue
            text=BeautifulSoup(response.text,'html.parser').get_text(' ',strip=True)+' '+response.text
            closed,reason=application_is_closed('',text,{})
            if closed:return True,'LinkedIn : '+reason
        return False,''
    except Exception:
        return False,''

def guess_company(title,text,url=''):
    host=dom(url);known={
        'jobs.ethz.ch':'ETH Zurich','careers.cern':'CERN','sentec.com':'Sentec',
        'careers.roche.com':'Roche','careers.stryker.com':'Stryker','careers.abb.com':'ABB',
        'jobs.siemens.com':'Siemens','careers.hitachi.com':'Hitachi','careers.bobst.com':'BOBST',
        'careers.sensirion.com':'Sensirion','jobs.logitech.com':'Logitech',
        'careers.zimmerbiomet.com':'Zimmer Biomet',
        'jobs.sonova.com':'Sonova','leica-geosystems.com':'Leica Geosystems',
        'www.leica-geosystems.com':'Leica Geosystems','u-blox.com':'u-blox','www.u-blox.com':'u-blox',
    }
    if host in known:return known[host]
    # Job-board titles often use "... - Job Offer at COMPANY - jobs.ch"
    m=re.search(r'Job Offer at\s+(.+?)\s+-\s+(?:jobs\.ch|jobup\.ch)',title,re.I)
    if m:return norm(m.group(1))
    m=re.search(r'\b(?:at|chez)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ0-9&.\' -]{2,60}?)(?:\s+[|–-]|$)',title)
    if m:return norm(m.group(1))
    m=re.search(r'^(.{2,70}?)\s+(?:hiring|recrute)\s+',title,re.I)
    if m:return norm(m.group(1))
    if 'linkedin.com' in dom(url):
        slug=unquote(urlparse(url).path.rstrip('/').split('/')[-1])
        m=re.search(r'-at-(.+?)-\d{7,}$',slug,re.I)
        if m:return norm(m.group(1).replace('-',' ').title())
    parts=[x.strip() for x in re.split(r'\s+[|–-]\s+',title) if x.strip()]
    platform_names={'jobs.ch','jobup.ch','linkedin','glassdoor','indeed','iagora.com','jooble','englishjobsearch','careers','jobs'}
    if len(parts)>=2 and parts[-1].lower() not in platform_names:return parts[-1][:80]
    if source_quality(url)==3 and host:
        brand=host.split('.')[-2] if host.count('.') else host
        if brand not in {'careers','jobs','job','recruiting'}:return brand.replace('-',' ').title()
    return 'Unknown'

def normalized_company(value):
    text=norm(value).lower()
    text=re.sub(r'\b(?:sa|ag|gmbh|sàrl|sarl|ltd|limited|inc|corp|corporation|holding|group|schweiz|switzerland)\b',' ',text)
    return re.sub(r'[^a-z0-9à-ÿ]+',' ',text).strip()

def normalized_job_title(value):
    text=norm(value).lower()
    text=re.sub(r'\b(?:m/f/d|f/m/d|m/w/d|h/f|80\s*[-–]\s*100\s*%)\b',' ',text)
    text=re.sub(r'\b(?:hiring|jobs?|offres?|emplois?|vacancies)\b',' ',text)
    text=re.sub(r'\s+(?:at|chez)\s+[^|–-]{2,80}$',' ',text)
    return re.sub(r'[^a-z0-9à-ÿ+#]+',' ',text).strip()

def offer_fingerprint(title,company,location=''):
    payload='|'.join((normalized_company(company),normalized_job_title(title),fold_text(location)[:80]))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()[:24]

def offers_match(title,company,old_title,old_company):
    wanted_title=normalized_job_title(title);old_norm=normalized_job_title(old_title);tokens={x for x in wanted_title.split() if len(x)>2}
    if len(tokens)<3:return False
    title_similarity=token_set_ratio(wanted_title,old_norm);wanted_company=normalized_company(company);old_company_norm=normalized_company(old_company)
    both_known=wanted_company not in ('','unknown') and old_company_norm not in ('','unknown')
    if both_known:return token_set_ratio(wanted_company,old_company_norm)>=78 and title_similarity>=84
    return title_similarity>=95 and len(tokens & {x for x in old_norm.split() if len(x)>2})>=3

def find_duplicate(c,cu,title,company,location=''):
    exact=c.execute("SELECT id,url,title,company,source,body,score,status FROM offers WHERE canonical_url=? OR url=? LIMIT 1",(cu,cu)).fetchone()
    if exact:return exact
    fingerprint=offer_fingerprint(title,company,location)
    fingerprint_match=c.execute("SELECT id,url,title,company,source,body,score,status FROM offers WHERE fingerprint=? LIMIT 1",(fingerprint,)).fetchone()
    if fingerprint_match:return fingerprint_match
    for row in c.execute("SELECT id,url,title,company,source,body,score,status FROM offers WHERE status NOT IN ('deleted','closed') ORDER BY id DESC LIMIT 1500"):
        _,_,old_title,old_company,_,_,_,_=row
        if offers_match(title,company,old_title,old_company):return row
    return None

def deduplicate_existing_offers(c):
    """Mark legacy active duplicates so their Sheet rows can be purged."""
    rows=c.execute("SELECT id,url,title,company,source,body,score FROM offers WHERE status='new' ORDER BY id").fetchall();groups=[];removed=0
    for row in rows:
        match=next((group for group in groups if offers_match(row[2],row[3],group[0][2],group[0][3])),None)
        if match is None:groups.append([row]);continue
        match.append(row)
    for group in groups:
        if len(group)<2:continue
        winner=max(group,key=lambda row:(source_quality(row[1]),float(row[6] or 0),len(row[5] or '')))
        for row in group:
            if row[0]==winner[0]:continue
            c.execute("UPDATE offers SET status='duplicate', reasons=COALESCE(reasons,'') || ? WHERE id=?",(f' | Doublon de l’offre #{winner[0]}',row[0]));removed+=1
            log_event(f'→ DOUBLON HISTORIQUE RETIRÉ · {short_text(row[3],24)} · {short_text(row[2],58)}','blue')
    c.commit()
    if removed:log_event(f'DÉDOUBLONNAGE — {removed} ancienne(s) ligne(s) en double retirée(s).','bold blue')
    return removed

def remember_status(c,url,title,source,status,reason):
    cu=canon(url)
    availability='closed' if status=='closed' else 'unknown'
    c.execute("INSERT OR IGNORE INTO offers(url,canonical_url,title,company,source,discovered_at,score,status,reasons,availability_status,availability_reason,last_checked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",(url,cu,title or status,'',source or dom(url),datetime.now(timezone.utc).isoformat(),0,status,reason,availability,reason,datetime.now(timezone.utc).isoformat()))

def diagnostic_profile_summary(profile):
    student=profile.get('student') or {};location=profile.get('location') or {}
    return {
        'min_weeks':int(student.get('min_weeks',20)),
        'start_date':str(student.get('start_date','')),
        'end_date':str(student.get('end_date','')),
        'acceptable_language':[str(x) for x in location.get('acceptable_language',['fr','en'])],
        'priority_cantons':[str(x) for x in location.get('priority_cantons',[])],
        'german':location.get('german') or {},
        'core_skills_count':len((profile.get('skills') or {}).get('core',[])),
        'strong_domains_count':len((profile.get('skills') or {}).get('strong_domains',[]))
    }

def excel_safe_value(value):
    """Remove characters forbidden by XLSX while preserving accents and emoji."""
    if not isinstance(value,str):return value
    return EXCEL_ILLEGAL_RE.sub('',value)[:32767]

def write_excel_safely(frame,path,label):
    """An optional Excel diagnostic must never abort an otherwise valid scan."""
    try:
        safe=frame.copy()
        for column in safe.columns:safe[column]=safe[column].map(excel_safe_value)
        safe.to_excel(path,index=False)
        return True
    except Exception as error:
        log_event(f'DIAGNOSTIC — export {label} impossible, scan poursuivi : {short_text(error,150)}','bold yellow')
        return False

def write_diagnostics(profile,payload,listing_leads):
    DIAGNOSTICS.parent.mkdir(exist_ok=True)
    data={'version':VERSION,'generated_at':datetime.now(timezone.utc).isoformat(),'profile':diagnostic_profile_summary(profile),'runtime':SCAN_METRICS,**payload}
    data['listing_leads']=listing_leads[:500]
    DIAGNOSTICS.write_text(json.dumps(data,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
    columns=['title','company','location','url','listing_source','listing_url']
    listing_ok=write_excel_safely(pd.DataFrame(listing_leads,columns=columns).drop_duplicates(subset=['title','url']),LISTING_LEADS_OUT,'pistes de listings')
    rejected=payload.get('rejected_examples') or []
    rejection_columns=['reason','page_type','contract_state','title','source','source_quality','origin','depth','text_chars','html_chars','structured_jobposting','contract_hint','official_url','original_url']
    rejection_ok=write_excel_safely(pd.DataFrame(rejected,columns=rejection_columns).drop_duplicates(subset=['reason','title','official_url']),REJECTIONS_OUT,'décisions rejetées')
    log_event(f'DIAGNOSTIC — rapport JSON : {DIAGNOSTICS.name}.','bold blue')
    if listing_ok:log_event(f'DIAGNOSTIC — {len(listing_leads)} piste(s) issue(s) de listings : {LISTING_LEADS_OUT.name}.','bold blue')
    if rejection_ok:log_event(f'DIAGNOSTIC — {len(rejected)} décision(s) refusées auditable(s), avec URL officielle : {REJECTIONS_OUT.name}.','bold blue')

def deduplicate_candidate_rows(rows):
    """Collapse repeated listing discoveries before detail-page downloads."""
    selected={};order=[]
    for row in rows:
        key=candidate_identity(row.get('url','')) or f"title:{fold_text(row.get('title',''))}"
        if key not in selected:
            selected[key]=row;order.append(key);continue
        audit_decision(row,'duplicate','URL répétée parmi les fiches découvertes',row.get('title',''))
        current=selected[key];combined_hint=bool(current.get('_contract_hint')) or bool(row.get('_contract_hint'))
        if current.get('_txt') is None and row.get('_txt') is not None:
            row['_contract_hint']=combined_hint;selected[key]=row
        else:
            current['_contract_hint']=combined_hint
            if not current.get('company') and row.get('company'):current['company']=row.get('company')
            if not current.get('location') and row.get('location'):current['location']=row.get('location')
    unique=[selected[key] for key in order]
    return unique,len(rows)-len(unique)

def ingest(c,rows,profile):
    global DECISION_AUDIT_PATH,_DECISION_AUDIT_HANDLE,_DECISION_AUDIT_COUNT
    close_decision_audit()
    run_stamp=RUN_STARTED_AT.strftime('%Y%m%d_%H%M%S_%f')
    DECISION_AUDIT_PATH=DIAGNOSTICS.with_name(f'stage_hunter_decisions_{run_stamp}.jsonl')
    DECISION_AUDIT_PATH.parent.mkdir(parents=True,exist_ok=True)
    _DECISION_AUDIT_HANDLE=DECISION_AUDIT_PATH.open('w',encoding='utf-8',buffering=1)
    _DECISION_AUDIT_COUNT=0
    detail_cache_path=DECISION_AUDIT_PATH.with_name(f'stage_hunter_details_{run_stamp}.bin')
    detail_cache=detail_cache_path.open('wb')
    cached_details=0
    def cache_detail(row,text_value,structured_value):
        nonlocal cached_details
        compact_structured={key:value for key,value in (structured_value or {}).items() if key!='description'}
        if (structured_value or {}).get('description'):compact_structured['description']=''
        payload=json.dumps({'text':text_value,'structured':compact_structured},ensure_ascii=False,default=str).encode('utf-8')
        compressed=zlib.compress(payload,3)
        row['_detail_offset']=detail_cache.tell()
        detail_cache.write(len(compressed).to_bytes(4,'little'))
        detail_cache.write(compressed)
        row['_txt']=''
        row['_structured']={}
        cached_details+=1
        if cached_details%100==0:
            detail_cache.flush()
            try:os.fsync(detail_cache.fileno())
            except OSError:pass
    audit_settings={key:os.getenv(key) for key in (
        'MAX_TOTAL_DETAIL_PAGES','MAX_RECURSIVE_LEADS','MAX_LISTING_DETAILS','LISTING_CRAWL_DEPTH',
        'SCAN_TIME_BUDGET_SECONDS','MIN_OPPORTUNITY_SCORE','SCRAPE_WORKERS','MAX_IN_FLIGHT_PAGES',
        'MAX_RESPONSE_BYTES','HTTP_TIMEOUT_SECONDS','HTTP_RETRIES')}
    audit_meta={'version':VERSION,'run_started_at':RUN_STARTED_AT.isoformat(),'profile_id':ACTIVE_PROFILE_ID,
                'profile':{key:profile.get(key) or {} for key in ('student','target','location','skills','interests','search')},
                'scan_settings':audit_settings,
                'decision_file':DECISION_AUDIT_PATH.name,'scoring_text_limit':30000}
    DECISION_AUDIT_PATH.with_suffix('.meta.json').write_text(json.dumps(audit_meta,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
    ingest_started=time.perf_counter();inserted=0;closed_count=0;expanded=[];listing_leads=[];retained_examples=[];rejected_examples=[]
    listing_leads_total=0;listing_leads_cap=max(500,min(int(os.getenv('MAX_DIAGNOSTIC_LISTING_LEADS','5000')),20_000))
    detail_cap=max(100,min(int(os.getenv('MAX_TOTAL_DETAIL_PAGES','1200')),10_000))
    detail_downloads=0
    def remember_listing_leads(leads):
        nonlocal listing_leads_total
        listing_leads_total+=len(leads)
        remaining=listing_leads_cap-len(listing_leads)
        if remaining>0:listing_leads.extend(leads[:remaining])
    stats={'known':0,'listing':0,'irrelevant':0,'low':0,'duplicate':0,'preferred_duplicate':0,'unavailable':0,'budget_skipped':0,'time_deferred':0}
    classification_reasons=Counter();rejection_reasons=Counter();listing_sources=Counter();retained_sources=Counter();downloaded_sources=Counter()
    input_sources=Counter(dom(r.get('url','')) or r.get('source','inconnu') for r in rows)
    preference_model=review_preference_model(c)
    priority_components=profile_search_components(profile);priority_contracts=profile_contract_terms(profile)
    SCAN_METRICS['learning']={'enabled':preference_model.get('enabled',False),'ranking_adjustment_enabled':False,'examples':preference_model.get('examples',0),'weighted_terms':len(preference_model.get('weights',{})),'note':'Les décisions passées sont conservées pour analyse; elles ne modifient pas le score automatique.'}
    log_event(f'ANALYSE — {len(rows)} lien(s) candidat(s) à filtrer.','bold magenta')
    pending=[];batch_seen=set()
    known_identities={candidate_identity(url) for (url,) in c.execute("SELECT url FROM offers WHERE length(body)>=250 AND status NOT IN ('deleted','closed')")}
    for r in rows:
        original_cu=canon(r['url'])
        identity=candidate_identity(r['url'])
        if identity in batch_seen:
            stats['duplicate']+=1;audit_decision(r,'duplicate','URL répétée avant téléchargement',r.get('title',''));continue
        batch_seen.add(identity)
        if identity in known_identities or c.execute('SELECT 1 FROM offers WHERE canonical_url=? OR url=?',(original_cu,original_cu)).fetchone():
            stats['known']+=1;audit_decision(r,'known','Annonce déjà connue dans la base (URL ou identifiant métier)',r.get('title',''))
        else:pending.append(r)
    if len(pending)>detail_cap:
        pending.sort(key=lambda r:(r.get('origin') in ('fixed_site','gmail'),listing_lead_priority(r,profile,priority_components,priority_contracts)),reverse=True)
        for skipped in pending[detail_cap:]:
            stats['budget_skipped']+=1
            audit_decision(skipped,'budget_skip','Plafond global de pages atteint avant le téléchargement initial',skipped.get('title',''))
        pending=pending[:detail_cap]
        log_event(f'BUDGET PAGES — {len(pending)} candidat(s) initiaux priorisés sur un maximum global de {detail_cap}.','bold yellow')
    pending_count=len(pending)
    downloaded_initial=set()
    for index,(r,txt,html,fetched_url) in enumerate(iter_parallel_pages(pending,'HTTP INITIAL'),start=1):
        detail_downloads+=1;downloaded_initial.add(id(r))
        downloaded_sources[dom(fetched_url or r['url'])]+=1
        original_cu=canon(r['url'])
        r.setdefault('_original_url',r['url'])
        item_started=time.perf_counter()
        log_event(f'ANALYSE {index}/{pending_count} · {r.get("source") or dom(r["url"])} · {short_text(r.get("title") or r["url"])}')
        final_url=canon(fetched_url or r['url']); structured=extract_job_posting(html,final_url)
        effective_title=structured.get('title') or r.get('title','')
        effective_text=job_relevant_text(txt,html,structured)
        r['_fetch_meta']=r.get('_fetch_meta') or dict(getattr(_HTTP_LOCAL,'last_fetch_meta',{'status':'unknown'}))
        if not html and not structured:
            stats['unavailable']+=1
            fetch_meta=r.get('_fetch_meta') or {}
            fetch_state=fetch_meta.get('status','unknown')
            http_code=fetch_meta.get('http_status')
            u_dom=dom(r.get('url',''))
            is_bot_blocked=(http_code in (403,429)) or (fetch_state in ('http_error','network_error') and any(k in u_dom for k in ('indeed.','glassdoor.','linkedin.')))
            if is_bot_blocked:
                reason=f'Accès protégé par anti-bot ({http_code or fetch_state})'
                audit_decision(r,'protected_access',reason,effective_title,'',effective_text,html,structured)
                log_event(f'→ ACCÈS PROTÉGÉ · {u_dom} requiert un navigateur · {short_text(r.get("url",""),72)}','dim')
            else:
                reason=f'Page inaccessible ou sans contenu exploitable ({fetch_state})'
                audit_decision(r,'retry',reason,effective_title,'',effective_text,html,structured)
                log_event(f'→ À RÉESSAYER · {reason} · {short_text(r.get("url",""),72)}','yellow')
            continue
        candidate_hint=bool(r.get('_depth') or r.get('_listing_url') or r.get('origin') in ('fixed_site','listing_recursive'))
        pt,class_reason=classify_with_reason(final_url,effective_title,effective_text,html,profile,candidate_hint=candidate_hint);classification_reasons[class_reason]+=1
        # A listing is never scored as one giant offer. Its individual cards
        # are queued when a usable link exists and always exported as leads.
        if pt=='listing':
            audit_decision(r,'listing',class_reason,effective_title,pt,effective_text,html,structured)
            leads=discover_listing_leads(final_url,html);remember_listing_leads(leads);listing_sources[dom(final_url)]+=1
            for lead in leads:
                if not lead.get('url'):continue
                expanded.append({
                    'url':lead['url'],'title':lead['title'],
                    'snippet':norm(lead.get('company','')+' '+lead.get('location','')),
                    'source':dom(lead['url']),'origin':r.get('origin','web'),'_depth':1,
                    '_listing_url':final_url,'_original_url':lead['url'],
                    '_contract_hint':contract_signal(lead.get('title',''),lead.get('company','')+' '+lead.get('location',''),profile),
                })
            original_type,_=classify_with_reason(r['url'],r.get('title',''),r.get('snippet',''),'',profile)
            if original_type=='offer' and canon(final_url)!=original_cu:
                reason='Fiche expirée redirigée vers un listing';remember_status(c,r['url'],r.get('title',''),r.get('source'),'closed',reason);closed_count+=1;audit_decision(r,'closed',reason,effective_title,pt,effective_text,html,structured,availability='closed')
            stats['listing']+=1
            log_event(f'→ LISTING · {class_reason} · {len(leads)} piste(s), {sum(bool(x.get("url")) for x in leads)} lien(s) exploitable(s) ({elapsed_label(item_started)})','cyan')
            continue
        availability,closed_reason,availability_confidence=application_availability(effective_title,effective_text,html,structured)
        if availability!='closed':
            linkedin_closed,linkedin_reason=linkedin_job_state(final_url)
            if linkedin_closed:availability,closed_reason,availability_confidence='closed',linkedin_reason,98
        if availability=='closed':
            remember_status(c,r['url'],effective_title,r.get('source'),'closed',closed_reason)
            closed_count+=1;rejection_reasons[closed_reason]+=1;rejected_examples.append(page_audit_record(r,effective_title,closed_reason,pt,effective_text,html,structured));audit_decision(r,'closed',closed_reason,effective_title,pt,effective_text,html,structured,availability=availability);log_event(f'→ FERMÉE · {closed_reason} ({elapsed_label(item_started)})','red');continue
        if pt in ('guide','other'):
            stats['irrelevant']+=1;rejection_reasons[class_reason]+=1
            rejected_examples.append(page_audit_record(r,effective_title,class_reason,pt,effective_text,html,structured))
            audit_decision(r,'not_an_offer',class_reason,effective_title,pt,effective_text,html,structured,availability=availability)
            log_event(f'→ IGNORÉ · {class_reason} · texte {len(effective_text)} car. · origine {r.get("origin","?")} ({elapsed_label(item_started)})','dim');continue
        r=dict(r); r['url']=final_url; r['title']=effective_title; r['_html']=''; r['_had_html']=bool(html); r['_pt']=pt; r['_class_reason']=class_reason; r['_linkedin_checked']=True; r['_availability']=(availability,closed_reason,availability_confidence); cache_detail(r,effective_text,structured); expanded.append(r)
    for r in pending:
        if id(r) not in downloaded_initial:
            stats['time_deferred']+=1
            audit_decision(r,'time_deferred','Budget de temps atteint avant le téléchargement initial',r.get('title',''))
    c.commit()

    # Les mêmes fiches remontent souvent dans plusieurs pages de résultats.
    # Les éliminer ici évite de télécharger plusieurs fois la même offre.
    expanded,collapsed_before_fetch=deduplicate_candidate_rows(expanded)
    if collapsed_before_fetch:
        stats['duplicate']+=collapsed_before_fetch
        log_event(f'LISTINGS — {collapsed_before_fetch} doublon(s) éliminé(s) avant téléchargement des fiches.','bold blue')

    # Les fiches de détail découvertes dans des listings sont téléchargées en
    # parallèle, puis toute écriture SQLite reste séquentielle et sûre.
    detail_pending=[r for r in expanded if r.get('_txt') is None]
    remaining=max(0,detail_cap-detail_downloads)
    if len(detail_pending)>remaining:
        detail_pending.sort(key=lambda r:listing_lead_priority(r,profile,priority_components,priority_contracts),reverse=True)
        selected={id(r) for r in detail_pending[:remaining]}
        for skipped in detail_pending[remaining:]:
            stats['budget_skipped']+=1
            audit_decision(skipped,'budget_skip','Plafond global de pages atteint avant la fiche de détail',skipped.get('title',''))
        expanded=[r for r in expanded if r.get('_txt') is not None or id(r) in selected]
        detail_pending=detail_pending[:remaining]
        log_event(f'BUDGET PAGES — {len(detail_pending)} fiche(s) de listing priorisée(s) ; plafond global {detail_cap}, {stats["budget_skipped"]} piste(s) différée(s).','bold yellow')
    for row,txt,html,final_url in iter_parallel_pages(detail_pending,'HTTP DÉTAILS'):
        detail_downloads+=1
        downloaded_sources[dom(final_url or row['url'])]+=1
        row.setdefault('_original_url',row['url']);row['url']=canon(final_url or row['url']);row['_fetch_meta']=row.get('_fetch_meta') or {'status':'unknown'};structured=extract_job_posting(html,row['url']);effective_text=job_relevant_text(txt,html,structured)
        pt,class_reason=classify_with_reason(row['url'],structured.get('title') or row.get('title',''),effective_text,html,profile,candidate_hint=True);classification_reasons[class_reason]+=1
        row['_html']='';row['_had_html']=bool(html);row['_pt']=pt;row['_class_reason']=class_reason
        if pt=='listing':row['_listing_leads']=discover_listing_leads(row['url'],html)
        if pt!='listing':row['_availability']=application_availability(structured.get('title') or row.get('title',''),effective_text,html,structured)
        cache_detail(row,effective_text,structured)

    # Some portals expose category pages before the actual job cards. Follow
    # those intermediate listings in bounded breadth-first rounds, prioritize
    # titles matching the profile, and fetch every selected detail in parallel.
    crawl_depth=max(0,min(int(os.getenv('LISTING_CRAWL_DEPTH','2')),3))
    recursive_cap=max(0,min(int(os.getenv('MAX_RECURSIVE_LEADS','160')),500))
    per_listing_cap=max(5,min(int(os.getenv('MAX_LEADS_PER_SUBLISTING','24')),80))
    minimum_lead_priority=float(os.getenv('MIN_LISTING_LEAD_PRIORITY','4'))
    known_urls=set(batch_seen)|{candidate_identity(row.get('url','')) for row in expanded}
    crawled_total=0
    for depth_round in range(crawl_depth):
        listing_rows=[row for row in expanded if row.get('_pt')=='listing' and not row.get('_listing_expanded')]
        if not listing_rows or crawled_total>=recursive_cap or detail_downloads>=detail_cap or scan_budget_exhausted():break
        discovered=[];round_started=time.perf_counter();round_leads=0
        for listing_index,row in enumerate(listing_rows,start=1):
            if scan_budget_exhausted():
                log_event(f'LISTINGS — budget temps atteint pendant le traitement des sous-listings ({listing_index-1}/{len(listing_rows)}).','bold yellow')
                break
            row['_listing_expanded']=True
            leads=row.get('_listing_leads')
            if leads is None:leads=discover_listing_leads(row['url'],row.get('_html',''))
            row['_listing_leads']=leads;remember_listing_leads(leads);row['_html']=''
            round_leads+=len(leads)
            ranked=[]
            for lead in leads:
                url=lead.get('url');canonical=candidate_identity(url or '')
                if not url or canonical in known_urls:continue
                lead['_priority']=listing_lead_priority(lead,profile,priority_components,priority_contracts)
                if lead['_priority']<minimum_lead_priority:continue
                ranked.append(lead)
            for lead in sorted(ranked,key=lambda item:item.get('_priority',0),reverse=True)[:per_listing_cap]:
                known_urls.add(candidate_identity(lead['url']));discovered.append(lead)
            if listing_index%25==0 or listing_index==len(listing_rows):
                log_event(f'LISTINGS NIVEAU {depth_round+2} — {listing_index}/{len(listing_rows)} sous-listing(s) analysé(s), {len(discovered)} piste(s) sélectionnée(s), {elapsed_label(round_started)} écoulée(s).','dim')
        if not discovered:continue
        remaining=min(recursive_cap-crawled_total,detail_cap-detail_downloads)
        discovered=sorted(discovered,key=lambda lead:lead.get('_priority',0),reverse=True)[:remaining]
        SCAN_METRICS.setdefault('recursive_listing_rounds',[]).append({'depth':depth_round+2,'listings':len(listing_rows),'leads':round_leads,'selected':len(discovered),'parsing_seconds':round(time.perf_counter()-round_started,2)})
        new_rows=[{
            'url':lead['url'],'title':lead['title'],'snippet':norm(lead.get('company','')+' '+lead.get('location','')),
            'source':dom(lead['url']),'origin':'listing_recursive','_depth':depth_round+2,
            '_listing_url':lead.get('listing_url',''),'_original_url':lead['url'],
            '_contract_hint':contract_signal(lead.get('title',''),lead.get('company','')+' '+lead.get('location',''),profile),
        } for lead in discovered]
        log_event(f'LISTINGS NIVEAU {depth_round+2} — {len(new_rows)} fiche(s) pertinentes priorisées depuis {len(listing_rows)} sous-listing(s) · seuil {minimum_lead_priority:g} · max {per_listing_cap}/listing.','bold cyan')
        downloaded_new=set()
        for row,txt,html,final_url in iter_parallel_pages(new_rows,f'LISTINGS NIVEAU {depth_round+2}'):
            detail_downloads+=1;downloaded_new.add(id(row))
            downloaded_sources[dom(final_url or row['url'])]+=1
            row['url']=canon(final_url or row['url']);row['_fetch_meta']=row.get('_fetch_meta') or {'status':'unknown'};structured=extract_job_posting(html,row['url']);effective_text=job_relevant_text(txt,html,structured)
            pt,class_reason=classify_with_reason(row['url'],structured.get('title') or row.get('title',''),effective_text,html,profile,candidate_hint=True);classification_reasons[class_reason]+=1
            row['_html']='';row['_had_html']=bool(html);row['_pt']=pt;row['_class_reason']=class_reason
            if pt=='listing':row['_listing_leads']=discover_listing_leads(row['url'],html)
            if pt!='listing':row['_availability']=application_availability(structured.get('title') or row.get('title',''),effective_text,html,structured)
            cache_detail(row,effective_text,structured)
            expanded.append(row)
        for row in new_rows:
            if id(row) not in downloaded_new:
                stats['time_deferred']+=1
                audit_decision(row,'time_deferred','Budget de temps atteint avant la fiche récursive',row.get('title',''))
        crawled_total+=len(new_rows)
    if crawled_total:log_event(f'LISTINGS — {crawled_total} fiche(s) supplémentaires ouvertes sur {crawl_depth} niveau(x) maximum.','bold cyan')

    detail_cache.flush()
    try:os.fsync(detail_cache.fileno())
    except OSError:pass
    detail_cache.close()
    detail_reader=detail_cache_path.open('rb')

    # Les fiches de détail découvertes dans des listings sont analysées ici.
    seen=set()
    for index,r in enumerate(expanded,start=1):
        if scan_budget_exhausted():
            remaining_rows=expanded[index-1:]
            for deferred in remaining_rows:
                stats['time_deferred']+=1
                audit_decision(deferred,'time_deferred','Budget de temps atteint avant la décision finale',deferred.get('title',''))
            log_event(f'ANALYSE — budget temps atteint : {len(remaining_rows)} fiche(s) différée(s) pour une reprise.','bold yellow')
            break
        cu=canon(r['url'])
        if cu in seen:continue
        seen.add(cu)
        txt=r.get('_txt');html=r.get('_html','');structured=r.get('_structured',{});pt=r.get('_pt');class_reason=r.get('_class_reason','')
        if '_detail_offset' in r:
            detail_reader.seek(r['_detail_offset'])
            payload_size=int.from_bytes(detail_reader.read(4),'little')
            cached=json.loads(zlib.decompress(detail_reader.read(payload_size)).decode('utf-8'))
            txt=cached.get('text','');structured=cached.get('structured') or {}
        if txt is None:
            stats['time_deferred']+=1
            audit_decision(r,'time_deferred','Budget de temps atteint avant la fiche de détail',r.get('title',''))
            continue
        title=norm(structured.get('title') or r.get('title'))
        if not (html or r.get('_had_html')) and not structured:
            stats['unavailable']+=1
            fetch_meta=r.get('_fetch_meta') or {}
            fetch_state=fetch_meta.get('status','unknown')
            http_code=fetch_meta.get('http_status')
            u_dom=dom(r.get('url',''))
            is_bot_blocked=(http_code in (403,429)) or (fetch_state in ('http_error','network_error') and any(k in u_dom for k in ('indeed.','glassdoor.','linkedin.')))
            if is_bot_blocked:
                reason=f'Accès protégé par anti-bot ({http_code or fetch_state})'
                audit_decision(r,'protected_access',reason,title,pt or '',txt or '',html,structured)
                log_event(f'→ ACCÈS PROTÉGÉ · {u_dom} requiert un navigateur · {short_text(r.get("url",""),72)}','dim')
            else:
                reason=f'Page inaccessible ou sans contenu exploitable ({fetch_state})'
                audit_decision(r,'retry',reason,title,pt or '',txt or '',html,structured)
                log_event(f'→ À RÉESSAYER · {reason} · {short_text(r.get("url",""),72)}','yellow')
            continue
        if not title or len(title)<5:
            soup=BeautifulSoup(html,'html.parser') if html else None; title=norm(soup.title.get_text(' ',strip=True) if soup and soup.title else '')
        if pt=='listing':
            leads=r.get('_listing_leads') or discover_listing_leads(r['url'],html)
            if not r.get('_listing_leads'):remember_listing_leads(leads)
            stats['listing']+=1;listing_sources[dom(r['url'])]+=1
            audit_decision(r,'listing',class_reason,title,pt,txt,html,structured)
            log_event(f'→ DÉTAIL RECLASSÉ LISTING · {class_reason} · {len(leads)} piste(s)','cyan')
            continue
        if pt!='offer':
            reason=class_reason or 'Type de page non exploitable';stats['irrelevant']+=1;rejection_reasons[reason]+=1
            rejected_examples.append(page_audit_record(r,title,reason,pt,txt,html,structured))
            audit_decision(r,'not_an_offer',reason,title,pt,txt,html,structured)
            log_event(f'→ IGNORÉ · {reason} · texte {len(txt or "")} car. · URL {short_text(r["url"],72)}','dim');continue
        contract_confirmed=contract_signal(title,txt,profile)
        internship_mode=profile_search_components(profile)['internship_mode']
        structured_contract=fold_text(structured.get('employment_type',''))
        if internship_mode:
            structured_likely=any(term in structured_contract for term in ('intern','stage','praktikum','trainee','student'))
        else:
            structured_likely=bool(structured_contract) and not any(term in structured_contract for term in ('intern','stage','praktikum','trainee'))
        contract_likely=bool(r.get('_contract_hint')) or structured_likely
        allow_unconfirmed=bool((profile.get('search') or {}).get('allow_unconfirmed_contract',True))
        relevance_reason=eligibility_rejection(title,txt,detect_meta(title,txt,profile,structured.get('location','')),profile,structured)
        if not contract_confirmed and internship_mode and not (allow_unconfirmed and contract_likely):
            reason='Aucun signal du type de contrat ciblé';stats['irrelevant']+=1;rejection_reasons[reason]+=1
            rejected_examples.append(page_audit_record(r,title,reason,pt,txt,html,structured,'absent'))
            audit_decision(r,'rejected_contract',reason,title,pt,txt,html,structured,'absent')
            log_event(f'→ IGNORÉ · {reason} · source {source_quality_label(r["url"])} · texte {len(txt or "")} car. · URL {short_text(r["url"],64)}','dim');continue
        contract_state='confirmé' if contract_confirmed else ('probable' if contract_likely else 'à vérifier')
        availability,closed_reason,availability_confidence=r.get('_availability') or application_availability(title,txt,html,structured)
        if availability!='closed' and not r.get('_linkedin_checked'):
            linkedin_closed,linkedin_reason=linkedin_job_state(r['url'])
            if linkedin_closed:availability,closed_reason,availability_confidence='closed',linkedin_reason,98
        if availability=='closed':
            remember_status(c,r['url'],title,r.get('source'),'closed',closed_reason)
            closed_count+=1;rejection_reasons[closed_reason]+=1;rejected_examples.append(page_audit_record(r,title,closed_reason,pt,txt,html,structured,contract_state));audit_decision(r,'closed',closed_reason,title,pt,txt,html,structured,contract_state,availability);log_event(f'→ FERMÉE · {short_text(title,70)} · {closed_reason}','red');continue
        cu=canon(r['url'])
        company=structured.get('company') or guess_company(title,txt,r['url'])
        meta=detect_meta(title,txt,profile,structured.get('location',''))
        hard_rejection=eligibility_rejection(title,txt,meta,profile,structured)
        if hard_rejection:
            stats['irrelevant']+=1;rejection_reasons[hard_rejection]+=1;rejected_examples.append(page_audit_record(r,title,hard_rejection,pt,txt,html,structured,contract_state));audit_decision(r,'rejected_eligibility',hard_rejection,title,pt,txt,html,structured,contract_state,availability);log_event(f'→ IGNORÉ · {hard_rejection} · URL {short_text(r["url"],72)}','dim');continue
        sc,conf,reasons=score(title,txt,meta,pt,profile,r['url'],company,structured)
        learned_adjustment,learned_reasons=learned_score_adjustment(c,title,company,meta,preference_model)
        sc=max(0,min(100,round(sc+learned_adjustment,1)));reasons.extend(learned_reasons)
        if not contract_confirmed:
            conf=max(0,conf-(10 if contract_likely else 18))
            reasons.append('Type de contrat à vérifier sur la page officielle')
        if sc<float(os.getenv('MIN_OPPORTUNITY_SCORE','30')):
            reason='Score sous le seuil';stats['low']+=1;rejection_reasons[reason]+=1;entry=page_audit_record(r,title,reason,pt,txt,html,structured,contract_state);entry.update({'score':sc,'confidence':conf,'score_reasons':reasons});rejected_examples.append(entry);audit_decision(r,'rejected_low_score',reason,title,pt,txt,html,structured,contract_state,availability,sc,conf,reasons);log_event(f'→ SCORE BAS · {sc}/100 · {short_text(company,24)} · {short_text(title,60)}','yellow');continue
        loc,canton,lang,duration,start,cat,skills=meta
        fingerprint=offer_fingerprint(title,company,loc)
        duplicate_row=find_duplicate(c,cu,title,company,loc)
        if duplicate_row:
            stats['duplicate']+=1;old_id,old_url,old_title,old_company,old_source,old_body,old_score,old_status=duplicate_row
            if old_status=='historical':
                audit_decision(r,'historical_duplicate','Offre déjà présente dans les réponses envoyées',title,pt,txt,html,structured,contract_state,availability,sc,conf,reasons)
                log_event(f'→ DÉJÀ DANS RÉPONSES · {short_text(old_company or company,24)} · {short_text(title,58)}','dim');continue
            better_source=source_quality(r['url'])>source_quality(old_url);richer_text=len(txt or '')>len(old_body or '')*1.15
            if better_source or richer_text:
                best_url=r['url'] if better_source else old_url;best_source=(r.get('source') or dom(r['url'])) if better_source else old_source
                best_title=title if better_source or len(title)>len(old_title or '') else old_title;best_company=company if company not in ('','Unknown') else old_company
                best_text=txt if richer_text or not old_body else old_body;best_structured=structured if best_text==txt else {}
                best_meta=detect_meta(best_title,best_text,profile,structured.get('location','') if best_text==txt else '')
                best_sc,best_conf,best_reasons=score(best_title,best_text,best_meta,'offer',profile,best_url,best_company,best_structured)
                best_adjustment,best_learned_reasons=learned_score_adjustment(c,best_title,best_company,best_meta,preference_model)
                best_sc=max(0,min(100,round(best_sc+best_adjustment,1)));best_reasons.extend(best_learned_reasons)
                best_loc,best_canton,best_lang,best_duration,best_start,best_cat,best_skills=best_meta
                c.execute('''UPDATE offers SET url=?,canonical_url=?,title=?,company=?,location=?,canton=?,source=?,snippet=?,body=?,language=?,duration=?,start_date=?,domain_category=?,skills_found=?,confidence=?,page_type=?,score=?,reasons=?,gmail_seen=?,availability_status=?,availability_reason=?,last_checked_at=?,learned_adjustment=?,fingerprint=? WHERE id=?''',(best_url,canon(best_url),best_title,best_company,best_loc,best_canton,best_source,r.get('snippet','') if best_text==txt else '',best_text,best_lang,best_duration,best_start,best_cat,', '.join(best_skills),best_conf,pt,best_sc,'\n'.join(best_reasons),1 if r.get('origin')=='gmail' else 0,availability,closed_reason,datetime.now(timezone.utc).isoformat(),best_adjustment,offer_fingerprint(best_title,best_company,best_loc),old_id))
                if better_source:stats['preferred_duplicate']+=1
                if retained_sources[dom(old_url)]>0:retained_sources[dom(old_url)]-=1
                retained_sources[dom(best_url)]+=1
                retained_examples.append({'title':best_title,'company':best_company,'url':best_url,'source':dom(best_url),'score':best_sc,'confidence':best_conf,'kind':'duplicate_merged'})
                audit_decision(r,'duplicate_merged','Doublon fusionné avec la fiche conservée',best_title,pt,best_text,'',best_structured,contract_state,availability,best_sc,best_conf,best_reasons)
                detail=('source officielle privilégiée' if better_source else 'description la plus complète conservée')
                log_event(f'→ DOUBLON FUSIONNÉ · {detail} · {short_text(best_title,58)}','blue')
            else:
                audit_decision(r,'duplicate','Doublon d’une offre déjà conservée',title,pt,txt,html,structured,contract_state,availability,sc,conf,reasons)
                log_event(f'→ DOUBLON · déjà conservé via {dom(old_url)} · {short_text(title,62)}','dim')
            continue
        if availability=='unknown':conf=max(0,conf-8);reasons.append('Disponibilité à confirmer : aucun signal fiable de fermeture')
        c.execute('''INSERT INTO offers(url,canonical_url,title,company,location,canton,source,snippet,body,language,duration,start_date,domain_category,skills_found,confidence,page_type,discovered_at,score,status,reasons,gmail_seen,review_decision,sheet_synced,availability_status,availability_reason,last_checked_at,learned_adjustment,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',(r['url'],cu,title,company,loc,canton,r.get('source') or dom(r['url']),r.get('snippet',''),txt,lang,duration,start,cat,', '.join(skills),conf,pt,datetime.now(timezone.utc).isoformat(),sc,'new','\n'.join(reasons),1 if r.get('origin')=='gmail' else 0,'pending',0,availability,closed_reason,datetime.now(timezone.utc).isoformat(),learned_adjustment,fingerprint))
        inserted+=1;retained_sources[dom(r['url'])]+=1;retained_examples.append({'title':title,'company':company,'url':r['url'],'source':dom(r['url']),'score':sc,'confidence':conf,'contract_state':contract_state,'kind':'new'});audit_decision(r,'retained','Offre retenue au-dessus du seuil',title,pt,txt,html,structured,contract_state,availability,sc,conf,reasons);log_event(f'→ RETENUE · {sc}/100 · confiance {conf}/100 · contrat {contract_state} · {source_quality_label(r["url"])} · {short_text(company,24)} · {short_text(title,55)}','bold green')
        if inserted%25==0:c.commit();log_event(f'CHECKPOINT — {inserted} offre(s) nouvelles enregistrée(s) durablement.','dim')
    c.commit()
    detail_reader.close()
    retained_sources=Counter({key:value for key,value in retained_sources.items() if value>0})
    log_event(f'ANALYSE terminée · {inserted} retenue(s), {closed_count} fermée(s), {stats["known"]} déjà connue(s), {stats["listing"]} listing(s), {stats["irrelevant"]} hors cible, {stats["low"]} score trop bas, {stats["duplicate"]} doublon(s).','bold magenta')
    if input_sources:log_event('DIAGNOSTIC — liens candidats par source : '+', '.join(f'{k}={v}' for k,v in input_sources.most_common(12)),'blue')
    if listing_sources:log_event('DIAGNOSTIC — listings par source : '+', '.join(f'{k}={v}' for k,v in listing_sources.most_common(8)),'blue')
    if rejection_reasons:log_event('DIAGNOSTIC — exclusions principales : '+', '.join(f'{k}={v}' for k,v in rejection_reasons.most_common(8)),'blue')
    if retained_sources:log_event('DIAGNOSTIC — offres retenues par source : '+', '.join(f'{k}={v}' for k,v in retained_sources.most_common(8)),'blue')
    rejected_sources=Counter(entry.get('source') or dom(entry.get('official_url','')) or 'unknown' for entry in rejected_examples)
    closed_sources=Counter(entry.get('source') or dom(entry.get('official_url','')) or 'unknown' for entry in rejected_examples if 'ferm' in fold_text(entry.get('reason','')) or 'expire' in fold_text(entry.get('reason','')) or 'deadline' in fold_text(entry.get('reason','')))
    for source,count in retained_sources.items():record_source_metric(c,source,'outcome',retained=count)
    for source,count in rejected_sources.items():record_source_metric(c,source,'outcome',rejected=count,closed=closed_sources.get(source,0),listings=listing_sources.get(source,0))
    c.commit()
    SCAN_METRICS['funnel']={'input_candidates':len(rows),'expanded_candidates':len(expanded),'listing_leads_total':listing_leads_total,'listing_leads_saved':len(listing_leads),'retained':inserted,'closed':closed_count,**stats}
    SCAN_METRICS['global_detail_budget']={'configured':detail_cap,'downloaded':detail_downloads,'skipped':stats['budget_skipped'],'time_deferred':stats['time_deferred']}
    SCAN_METRICS['detail_cache']={'path':str(detail_cache_path),'records':cached_details,'bytes':detail_cache_path.stat().st_size}
    all_sources=set(input_sources)|set(downloaded_sources)|set(retained_sources)|set(rejected_sources)|set(listing_sources)
    SCAN_METRICS['source_yield']={
        source:{
            'candidates':input_sources.get(source,0),'pages_downloaded':downloaded_sources.get(source,0),'retained':retained_sources.get(source,0),
            'rejected':rejected_sources.get(source,0),'closed':closed_sources.get(source,0),
            'listings':listing_sources.get(source,0),
            'yield_percent':round(100*retained_sources.get(source,0)/max(1,downloaded_sources.get(source,0)),1)
        } for source in sorted(all_sources)
    }
    SCAN_METRICS['phases']['analysis_seconds']=round(time.perf_counter()-ingest_started,2)
    close_decision_audit()
    SCAN_METRICS['decision_audit']={'path':str(DECISION_AUDIT_PATH),'events':_DECISION_AUDIT_COUNT,'format':'JSON Lines','evidence_sample_chars':1200}
    log_event(f'DIAGNOSTIC — journal complet des décisions : {DECISION_AUDIT_PATH.name} ({_DECISION_AUDIT_COUNT} entrée(s)).','bold blue')
    if listing_leads_total>len(listing_leads):log_event(f'DIAGNOSTIC — {listing_leads_total} piste(s) observée(s), échantillon RAM borné à {len(listing_leads)} pour les exports.','blue')
    write_diagnostics(profile,{
        'input_candidates':len(rows),'expanded_candidates':len(expanded),'stats':stats,
        'input_sources':dict(input_sources.most_common()),
        'classification_reasons':dict(classification_reasons.most_common()),
        'rejection_reasons':dict(rejection_reasons.most_common()),
        'listing_sources':dict(listing_sources.most_common()),
        'retained_sources':dict(retained_sources.most_common()),
        'retained_examples':sorted(retained_examples,key=lambda x:x.get('score',0),reverse=True)[:100],
        'rejected_examples':rejected_examples[:1000],
        'learning':{'examples':preference_model.get('examples',0),'weighted_terms':preference_model.get('weights',{})}
    },listing_leads)
    return inserted,closed_count

def revalidate_existing_offers(c,profile,limit=None):
    """Recheck active rows, remove listings and recalculate their current score."""
    limit=limit or int(os.getenv('RECHECK_MAX_OFFERS','100'))
    rows=c.execute("SELECT id,url,title,company,body,score FROM offers WHERE status='new' ORDER BY score DESC LIMIT ?",(limit,)).fetchall()
    if not rows:return 0
    log_event(f'RECONTRÔLE — vérification des {len(rows)} meilleures offres déjà présentes.','bold yellow')
    closed_count=0;preference_model=review_preference_model(c)
    for index,(offer_id,url,title,old_company,old_body,score_value) in enumerate(rows,start=1):
        started=time.perf_counter(); log_event(f'RECONTRÔLE {index}/{len(rows)} · {score_value}/100 · {short_text(title,72)}')
        local_type,local_reason=classify_with_reason(url,title,old_body or '','',profile)
        if local_type=='listing':
            c.execute("UPDATE offers SET status='closed', reasons=COALESCE(reasons,'') || ? WHERE id=?",(' | Listing retiré lors du recontrôle : '+local_reason,offer_id))
            closed_count+=1;log_event(f'→ RETIRÉE · listing historique : {local_reason} ({elapsed_label(started)})','red');continue
        txt,html,final_url=page(url,old_body or '')
        final_url=canon(final_url or url); structured=extract_job_posting(html,final_url)
        effective_title=structured.get('title') or title
        effective_text=norm(structured.get('description','')+' '+txt)
        availability,reason,availability_confidence=application_availability(effective_title,effective_text,html,structured)
        closed=availability=='closed'
        if not closed:
            current_type,type_reason=classify_with_reason(final_url,effective_title,effective_text,html,profile)
            if current_type!='offer':closed=True;reason='La fiche ne pointe plus vers une offre active : '+type_reason
        if not closed:closed,reason=linkedin_job_state(final_url)
        if closed:
            c.execute("UPDATE offers SET status='closed',availability_status='closed',availability_reason=?,last_checked_at=?, reasons=COALESCE(reasons,'') || ? WHERE id=?",(reason,datetime.now(timezone.utc).isoformat(),' | '+reason,offer_id))
            closed_count+=1; log_event(f'→ RETIRÉE · {reason} ({elapsed_label(started)})','red')
        else:
            company=structured.get('company') or old_company or guess_company(effective_title,effective_text,final_url)
            meta=detect_meta(effective_title,effective_text,profile,structured.get('location',''))
            hard_rejection=eligibility_rejection(effective_title,effective_text,meta,profile,structured)
            if hard_rejection:
                c.execute("UPDATE offers SET status='filtered', reasons=COALESCE(reasons,'') || ? WHERE id=?",(' | '+hard_rejection,offer_id))
                closed_count+=1;log_event(f'→ RETIRÉE · {hard_rejection} ({elapsed_label(started)})','yellow');continue
            new_score,confidence,reasons=score(effective_title,effective_text,meta,'offer',profile,final_url,company,structured)
            learned_adjustment,learned_reasons=learned_score_adjustment(c,effective_title,company,meta,preference_model)
            new_score=max(0,min(100,round(new_score+learned_adjustment,1)));reasons.extend(learned_reasons)
            loc,canton,lang,duration,start,cat,skills=meta;threshold=float(os.getenv('MIN_OPPORTUNITY_SCORE','30'))
            status='new' if new_score>=threshold else 'filtered'
            if availability=='unknown':confidence=max(0,confidence-8);reasons.append('Disponibilité à confirmer')
            c.execute('''UPDATE offers SET url=?,canonical_url=?,title=?,company=?,location=?,canton=?,body=?,language=?,duration=?,start_date=?,domain_category=?,skills_found=?,confidence=?,score=?,status=?,reasons=?,availability_status=?,availability_reason=?,last_checked_at=?,learned_adjustment=?,fingerprint=? WHERE id=?''',(final_url,canon(final_url),effective_title,company,loc,canton,effective_text,lang,duration,start,cat,', '.join(skills),confidence,new_score,status,'\n'.join(reasons),availability,reason,datetime.now(timezone.utc).isoformat(),learned_adjustment,offer_fingerprint(effective_title,company,loc),offer_id))
            if status=='filtered':closed_count+=1;log_event(f'→ RETIRÉE · nouveau score {new_score}/100 sous le seuil ({elapsed_label(started)})','yellow')
            else:log_event(f'→ TOUJOURS ACTIVE · score recalculé {score_value} → {new_score}/100 ({elapsed_label(started)})','green')
    c.commit(); log_event(f'RECONTRÔLE terminé · {closed_count} offre(s) expirée(s) détectée(s).','bold yellow')
    return closed_count

def google_credentials():
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    SECRET.parent.mkdir(parents=True,exist_ok=True);TOKEN.parent.mkdir(parents=True,exist_ok=True);cr=None
    if TOKEN.exists():
        try:
            # Load the scopes actually stored in the token. Passing SCOPES here
            # would make an old Sheets-only token look compatible with Gmail.
            cr=Credentials.from_authorized_user_file(str(TOKEN))
        except Exception:
            cr=None
    scopes_ok=bool(cr and cr.has_scopes(SCOPES))
    if cr and cr.valid and scopes_ok:return cr
    if cr and cr.expired and cr.refresh_token and scopes_ok:
        cr.refresh(Request())
    else:
        if not SECRET.exists():raise FileNotFoundError(f'{SECRET} manquant')
        if cr and not scopes_ok:
            console.print('[yellow]Le token Google actuel ne couvre pas encore Gmail. Une nouvelle autorisation va s\'ouvrir.[/]')
        cr=InstalledAppFlow.from_client_secrets_file(str(SECRET),SCOPES).run_local_server(port=0,prompt='consent')
    TOKEN.write_text(cr.to_json(),encoding='utf-8'); return cr

def services():
    from googleapiclient.discovery import build
    cr=google_credentials(); return build('sheets','v4',credentials=cr),build('gmail','v1',credentials=cr)
def cfg(profile=None):
    google=((profile or ACTIVE_PROFILE).get('integrations') or {}).get('google') or {}
    sid=str(google.get('sheet_id') or get_profile_setting('google_sheet_id') or os.getenv('GOOGLE_SHEET_ID','')).strip()
    resp=str(google.get('response_tab') or get_profile_setting('google_response_tab') or os.getenv('GOOGLE_RESPONSE_TAB',os.getenv('GOOGLE_SHEET_TAB','Réponses'))).strip() or 'Réponses'
    opp=str(google.get('opportunity_tab') or get_profile_setting('google_opportunity_tab') or os.getenv('GOOGLE_OPPORTUNITY_TAB','Opportunités')).strip() or 'Opportunités'
    if not sid:raise RuntimeError('GOOGLE_SHEET_ID absent du .env')
    return sid,resp,opp

def ensure_opp(svc,sid,tab):
    meta=svc.spreadsheets().get(spreadsheetId=sid).execute(); sheets={x['properties']['title']:x['properties']['sheetId'] for x in meta.get('sheets',[])}
    if tab not in sheets:
        # frozenRowCount belongs under gridProperties in the Sheets API.
        res=svc.spreadsheets().batchUpdate(spreadsheetId=sid,body={'requests':[{'addSheet':{'properties':{'title':tab,'gridProperties':{'frozenRowCount':1}}}}]}).execute(); sheet_id=res['replies'][0]['addSheet']['properties']['sheetId']
    else: sheet_id=sheets[tab]
    vals=svc.spreadsheets().values().get(spreadsheetId=sid,range=f"'{tab}'!A1:Q2").execute().get('values',[])
    if not vals or vals[0]!=OP_HEADERS: svc.spreadsheets().values().update(spreadsheetId=sid,range=f"'{tab}'!A1:Q1",valueInputOption='RAW',body={'values':[OP_HEADERS]}).execute()
    # Dropdown = stable button-like control, no Apps Script required.
    widths=[(0,1,120),(1,3,78),(3,4,170),(4,5,300),(5,6,160),(6,7,220),(7,10,105),(10,11,170),(11,12,270),(12,13,360),(13,14,150),(14,15,300),(15,16,175),(16,17,110)]
    formatting=[
        {'updateSheetProperties':{'properties':{'sheetId':sheet_id,'gridProperties':{'frozenRowCount':1}},'fields':'gridProperties.frozenRowCount'}},
        {'repeatCell':{'range':{'sheetId':sheet_id,'startRowIndex':0,'endRowIndex':1,'startColumnIndex':0,'endColumnIndex':17},'cell':{'userEnteredFormat':{'backgroundColor':{'red':0.04,'green':0.23,'blue':0.24},'textFormat':{'foregroundColor':{'red':1,'green':1,'blue':1},'bold':True},'horizontalAlignment':'CENTER','verticalAlignment':'MIDDLE','wrapStrategy':'WRAP'}},'fields':'userEnteredFormat'}},
        {'repeatCell':{'range':{'sheetId':sheet_id,'startRowIndex':1,'startColumnIndex':0,'endColumnIndex':17},'cell':{'userEnteredFormat':{'backgroundColor':{'red':0.96,'green':0.98,'blue':1.0},'textFormat':{'foregroundColor':{'red':0.06,'green':0.11,'blue':0.18}},'verticalAlignment':'MIDDLE','wrapStrategy':'WRAP'}},'fields':'userEnteredFormat'}},
        {'updateDimensionProperties':{'range':{'sheetId':sheet_id,'dimension':'ROWS','startIndex':0,'endIndex':1},'properties':{'pixelSize':48},'fields':'pixelSize'}},
        {'setDataValidation':{'range':{'sheetId':sheet_id,'startRowIndex':1,'startColumnIndex':0,'endColumnIndex':1},'rule':{'condition':{'type':'ONE_OF_LIST','values':[{'userEnteredValue':'GARDER'},{'userEnteredValue':'TRANSFERER'},{'userEnteredValue':'SUPPRIMER'}]},'strict':True,'showCustomUi':True}}},
        {'setBasicFilter':{'filter':{'range':{'sheetId':sheet_id,'startRowIndex':0,'startColumnIndex':0,'endColumnIndex':17}}}},
        {'updateDimensionProperties':{'range':{'sheetId':sheet_id,'dimension':'COLUMNS','startIndex':16,'endIndex':17},'properties':{'hiddenByUser':True},'fields':'hiddenByUser'}},
    ]
    formatting.extend({'updateDimensionProperties':{'range':{'sheetId':sheet_id,'dimension':'COLUMNS','startIndex':start,'endIndex':end},'properties':{'pixelSize':width},'fields':'pixelSize'}} for start,end,width in widths)
    svc.spreadsheets().batchUpdate(spreadsheetId=sid,body={'requests':formatting}).execute()

def ensure_response_sheet(svc,sid,tab):
    meta=svc.spreadsheets().get(spreadsheetId=sid).execute();sheets={item['properties']['title']:item['properties']['sheetId'] for item in meta.get('sheets',[])}
    if tab not in sheets:
        result=svc.spreadsheets().batchUpdate(spreadsheetId=sid,body={'requests':[{'addSheet':{'properties':{'title':tab,'gridProperties':{'frozenRowCount':1}}}}]}).execute();sheet_id=result['replies'][0]['addSheet']['properties']['sheetId']
        svc.spreadsheets().values().update(spreadsheetId=sid,range=f"'{tab}'!A1:M1",valueInputOption='RAW',body={'values':[RESPONSE_HEADERS]}).execute();header_row=0
    else:
        sheet_id=sheets[tab];values=response_values(svc,sid,tab)
        if values:
            header_row=detect_header_row(values,('entreprise',))
        else:
            header_row=0;svc.spreadsheets().values().update(spreadsheetId=sid,range=f"'{tab}'!A1:M1",valueInputOption='RAW',body={'values':[RESPONSE_HEADERS]}).execute()
    widths=[(0,1,230),(1,2,190),(2,3,160),(3,4,170),(4,5,360),(5,8,260),(8,9,300),(9,10,115),(10,11,150),(11,12,220),(12,13,340)]
    requests=[
        {'updateSheetProperties':{'properties':{'sheetId':sheet_id,'gridProperties':{'frozenRowCount':header_row+1}},'fields':'gridProperties.frozenRowCount'}},
        {'repeatCell':{'range':{'sheetId':sheet_id,'startRowIndex':header_row,'endRowIndex':header_row+1,'startColumnIndex':0,'endColumnIndex':13},'cell':{'userEnteredFormat':{'backgroundColor':{'red':0.04,'green':0.23,'blue':0.24},'textFormat':{'foregroundColor':{'red':1,'green':1,'blue':1},'bold':True},'horizontalAlignment':'CENTER','verticalAlignment':'MIDDLE','wrapStrategy':'WRAP'}},'fields':'userEnteredFormat'}},
        {'repeatCell':{'range':{'sheetId':sheet_id,'startRowIndex':header_row+1,'startColumnIndex':0,'endColumnIndex':13},'cell':{'userEnteredFormat':{'backgroundColor':{'red':0.98,'green':0.99,'blue':1.0},'textFormat':{'foregroundColor':{'red':0.06,'green':0.11,'blue':0.18}},'verticalAlignment':'MIDDLE','wrapStrategy':'WRAP'}},'fields':'userEnteredFormat'}},
        {'updateDimensionProperties':{'range':{'sheetId':sheet_id,'dimension':'ROWS','startIndex':header_row,'endIndex':header_row+1},'properties':{'pixelSize':48},'fields':'pixelSize'}},
        {'setBasicFilter':{'filter':{'range':{'sheetId':sheet_id,'startRowIndex':header_row,'startColumnIndex':0,'endColumnIndex':13}}}},
    ]
    requests.extend({'updateDimensionProperties':{'range':{'sheetId':sheet_id,'dimension':'COLUMNS','startIndex':start,'endIndex':end},'properties':{'pixelSize':width},'fields':'pixelSize'}} for start,end,width in widths)
    svc.spreadsheets().batchUpdate(spreadsheetId=sid,body={'requests':requests}).execute();return sheet_id

def format_connected_spreadsheet(svc,sid,response_tab,opportunity_tab):
    """Apply a complete readable design without requiring Apps Script."""
    ensure_response_sheet(svc,sid,response_tab);ensure_opp(svc,sid,opportunity_tab)
    meta=svc.spreadsheets().get(spreadsheetId=sid,fields='sheets(properties,conditionalFormats)').execute()
    target=next(item for item in meta.get('sheets',[]) if item['properties']['title']==opportunity_tab);sheet_id=target['properties']['sheetId']
    requests=[]
    for index in range(len(target.get('conditionalFormats',[]))-1,-1,-1):requests.append({'deleteConditionalFormatRule':{'sheetId':sheet_id,'index':index}})
    colors={
        'GARDER':({'red':0.88,'green':0.97,'blue':0.91},{'red':0.05,'green':0.35,'blue':0.18}),
        'TRANSFERER':({'red':0.89,'green':0.94,'blue':1.0},{'red':0.05,'green':0.25,'blue':0.60}),
        'SUPPRIMER':({'red':1.0,'green':0.91,'blue':0.91},{'red':0.65,'green':0.08,'blue':0.08}),
    }
    for index,(action,(background,foreground)) in enumerate(colors.items()):
        requests.append({'addConditionalFormatRule':{'index':index,'rule':{'ranges':[{'sheetId':sheet_id,'startRowIndex':1,'startColumnIndex':0,'endColumnIndex':17}],'booleanRule':{'condition':{'type':'CUSTOM_FORMULA','values':[{'userEnteredValue':f'=$A2="{action}"'}]},'format':{'backgroundColor':background,'textFormat':{'foregroundColor':foreground}}}}}})
    if requests:svc.spreadsheets().batchUpdate(spreadsheetId=sid,body={'requests':requests}).execute()
    log_event(f'GOOGLE SHEETS — mise en forme réparée pour {response_tab} et {opportunity_tab}.','bold green')
    return f'https://docs.google.com/spreadsheets/d/{sid}'

def create_connected_spreadsheet(svc,profile,profile_path=None):
    """Create a ready-to-use Sheet and persist its id in the selected profile."""
    google=(profile.get('integrations') or {}).setdefault('google',{})
    response_tab=str(google.get('response_tab') or 'Réponses');opportunity_tab=str(google.get('opportunity_tab') or 'Opportunités')
    title=PRODUCT_NAME+' — '+str(profile.get('name') or profile.get('id') or 'Recherche')
    created=svc.spreadsheets().create(body={'properties':{'title':title},'sheets':[{'properties':{'title':response_tab,'gridProperties':{'frozenRowCount':1}}}]}).execute()
    sid=created['spreadsheetId'];url=created.get('spreadsheetUrl') or f'https://docs.google.com/spreadsheets/d/{sid}'
    svc.spreadsheets().values().update(spreadsheetId=sid,range=f"'{response_tab}'!A1:M1",valueInputOption='RAW',body={'values':[RESPONSE_HEADERS]}).execute()
    format_connected_spreadsheet(svc,sid,response_tab,opportunity_tab)
    google.update({'sheet_id':sid,'sheets_enabled':True})
    set_profile_settings({'google_sheet_id':sid,'google_response_tab':response_tab,'google_opportunity_tab':opportunity_tab})
    if profile_path:
        path=Path(profile_path);path.write_text(yaml.safe_dump(profile,allow_unicode=True,sort_keys=False,width=110),encoding='utf-8')
    log_event(f'GOOGLE SHEETS — tableau créé et relié : {url}','bold green')
    return sid,url

def response_values(svc,sid,tab): return svc.spreadsheets().values().get(spreadsheetId=sid,range=f"'{tab}'!A1:Z10000").execute().get('values',[])

def normalized_header(value):
    return re.sub(r'[^a-z0-9]+',' ',fold_text(value)).strip()

def detect_header_row(values,required_words=()):
    for index,row in enumerate(values[:12]):
        labels=[normalized_header(cell) for cell in row]
        joined=' | '.join(labels)
        if all(any(word in label for label in labels) for word in required_words):return index
        if not required_words and ('action' in labels or ('entreprise' in joined and ('lien' in joined or 'url' in joined))):return index
    return 0

def find_header_column(headers,*candidates):
    labels=[normalized_header(value) for value in headers]
    wanted=[normalized_header(value) for value in candidates]
    for candidate in wanted:
        if candidate in labels:return labels.index(candidate)
    for index,label in enumerate(labels):
        if any(candidate and candidate in label for candidate in wanted):return index
    return -1

def normalize_action(value):
    action=fold_text(value).upper().replace(' ','')
    aliases={'KEEP':'GARDER','CONSERVER':'GARDER','TRANSFER':'TRANSFERER','TRANSFERT':'TRANSFERER','DELETE':'SUPPRIMER','EFFACER':'SUPPRIMER'}
    return aliases.get(action,action)

def column_letter(index):
    out=''; n=index+1
    while n:
        n,rem=divmod(n-1,26); out=chr(65+rem)+out
    return out

def cell_urls(cell):
    found=[]
    if cell.get('hyperlink'):found.append(cell['hyperlink'])
    value=cell.get('userEnteredValue',{})
    for raw in (value.get('stringValue',''),value.get('formulaValue','')):
        found += re.findall(r'https?://[^\s";,)]+',raw)
        found += re.findall(r'HYPERLINK\(\s*"([^"]+)"',raw,re.I)
    for run in cell.get('textFormatRuns',[]) or []:
        uri=run.get('format',{}).get('link',{}).get('uri')
        if uri:found.append(uri)
    return list(dict.fromkeys(canon(u) for u in found if safe_public_url(unwrap_url(u))))

def import_history(c,svc,sid,tab):
    vals=response_values(svc,sid,tab)
    if not vals:
        log_event(f'HISTORIQUE — onglet {tab} vide ou introuvable.','yellow');return 0
    hi=detect_header_row(vals,('entreprise',));heads=vals[hi];n=0;known=0;url_identity={};identities=[]
    company_col=find_header_column(heads,'Nom Entreprise','Entreprise','Société')
    title_col=find_header_column(heads,"Activité détaillée (l'entreprise)",'Activité détaillée','Titre du stage','Offre','Poste')
    link_cols=[]
    for index,header in enumerate(heads):
        label=normalized_header(header)
        if 'lien' in label or label in ('url','link'):link_cols.append(index)
    def identity_for_row(row):
        company=norm(row[company_col]) if 0<=company_col<len(row) else ''
        title=norm(row[title_col]) if 0<=title_col<len(row) else ''
        return company,title
    for sheet_row,row in enumerate(vals[hi+1:],start=hi+1):
        company,title=identity_for_row(row)
        if company and title:identities.append((company,title))
        for link_col in link_cols:
            if link_col<len(row):
                for u in re.findall(r'https?://[^\s)]+',str(row[link_col])):
                    if safe_public_url(unwrap_url(u)):url_identity[canon(u)]=(company,title)
    # values().get only returns the displayed text (often "Lien 1"). Grid data
    # is required to recover rich-text hyperlinks and HYPERLINK() formulas.
    ranges=[f"'{tab}'!{column_letter(index)}:{column_letter(index)}" for index in link_cols]
    if ranges:
        grid=svc.spreadsheets().get(spreadsheetId=sid,ranges=ranges,includeGridData=True,fields='sheets(data(startRow,rowData(values(hyperlink,userEnteredValue,textFormatRuns))))').execute()
        for sheet in grid.get('sheets',[]):
            for data in sheet.get('data',[]):
                start_row=int(data.get('startRow',0))
                for offset,grid_row in enumerate(data.get('rowData',[])):
                    sheet_row=start_row+offset;row=vals[sheet_row] if sheet_row<len(vals) else [];company,title=identity_for_row(row)
                    for cell in grid_row.get('values',[]):
                        for u in cell_urls(cell):url_identity[u]=(company,title)
    for u,(company,title) in url_identity.items():
        existing=c.execute('SELECT id,status FROM offers WHERE canonical_url=? OR url=?',(u,u)).fetchone()
        if existing:
            known+=1
            if existing[1] in ('new','kept'):c.execute("UPDATE offers SET status='transferred',review_decision='keep',reviewed_at=?,sheet_synced=1 WHERE id=?",(datetime.now(timezone.utc).isoformat(),existing[0]))
            if company or title:c.execute("UPDATE offers SET company=CASE WHEN ?!='' THEN ? ELSE company END,title=CASE WHEN ?!='' THEN ? ELSE title END WHERE id=?",(company,company,title,title,existing[0]))
        else:
            cur=c.execute("INSERT OR IGNORE INTO offers(url,canonical_url,title,company,source,discovered_at,score,status,reasons) VALUES(?,?,?,?,?,?,?,?,?)",(u,u,title or 'Historique Réponses',company,dom(u),datetime.now(timezone.utc).isoformat(),0,'historical','Historique Réponses'));n+=max(cur.rowcount,0)
    # Rows without a usable hyperlink still become semantic identities, so the
    # same company/title posted on another platform is filtered later.
    for company,title in identities:
        digest=hashlib.sha256((normalized_company(company)+'|'+normalized_job_title(title)).encode('utf-8')).hexdigest()[:24];pseudo='history://response/'+digest
        cur=c.execute("INSERT OR IGNORE INTO offers(url,canonical_url,title,company,source,discovered_at,score,status,reasons) VALUES(?,?,?,?,?,?,?,?,?)",(pseudo,pseudo,title,company,'Réponses',datetime.now(timezone.utc).isoformat(),0,'historical','Identité entreprise + titre importée de Réponses'));n+=max(cur.rowcount,0)
    c.commit()
    data_rows=sum(1 for row in vals[hi+1:] if any(norm(cell) for cell in row))
    log_event(f'HISTORIQUE — onglet {tab} : {data_rows} ligne(s), {len(url_identity)} URL(s), {len(identities)} identité(s), {known} URL(s) déjà connues, {n} nouvelle(s).','blue')
    return n

def import_opportunities(c,svc,sid,tab):
    """Reconnect Sheet rows to SQLite, including rows from an older install."""
    ensure_opp(svc,sid,tab)
    vals=svc.spreadsheets().values().get(spreadsheetId=sid,range=f"'{tab}'!A1:Q10000").execute().get('values',[])
    if not vals:
        log_event(f'OPPORTUNITÉS — onglet {tab} vide.','yellow');return {'rows':0,'imported':0,'linked':0,'actions':0}
    hi=detect_header_row(vals,('action',));headers=vals[hi]
    def col(*names):return find_header_column(headers,*names)
    columns={
        'action':col('Action'),'score':col('Score /100','Score'),'confidence':col('Confiance'),
        'company':col('Entreprise'),'title':col('Offre','Titre'),'location':col('Ville / lieu','Ville','Lieu'),
        'canton':col('Canton','Région'),'language':col('Langue'),'duration':col('Durée'),
        'start':col('Début'),'category':col('Domaine'),'skills':col('Compétences détectées','Compétences'),
        'reasons':col('Pourquoi','Raisons'),'source':col('Source'),'url':col('Lien','URL'),
        'date':col('Date découverte'),'id':col('ID Stage Hunter','ID'),
    }
    imported=linked=actions=0;updates=[];data_rows=0
    def value(row,key,default=''):
        index=columns[key];return row[index] if 0<=index<len(row) else default
    def number(raw):
        try:return float(str(raw or 0).replace(',','.').replace('/100','').strip())
        except (TypeError,ValueError):return 0.0
    for sheet_row,row in enumerate(vals[hi+1:],start=hi+2):
        if not any(norm(cell) for cell in row):continue
        data_rows+=1;action=normalize_action(value(row,'action'));actions+=int(action in ('GARDER','TRANSFERER','SUPPRIMER'))
        raw_url=norm(value(row,'url'));url=canon(raw_url) if safe_public_url(unwrap_url(raw_url)) else ''
        oid=norm(value(row,'id'));existing=None
        if oid.isdigit():existing=c.execute('SELECT id FROM offers WHERE id=?',(int(oid),)).fetchone()
        if not existing and url:existing=c.execute('SELECT id FROM offers WHERE canonical_url=? OR url=?',(url,url)).fetchone()
        if existing:
            db_id=int(existing[0]);linked+=1
            inferred_review='keep' if action in ('GARDER','TRANSFERER') else ('reject' if action=='SUPPRIMER' else 'unsure')
            c.execute("UPDATE offers SET sheet_synced=1,review_decision=CASE WHEN review_decision IS NULL OR review_decision='pending' THEN ? ELSE review_decision END WHERE id=?",(inferred_review,db_id))
        elif url:
            score_value=number(value(row,'score'));confidence_value=number(value(row,'confidence'))
            inferred_review='keep' if action in ('GARDER','TRANSFERER') else ('reject' if action=='SUPPRIMER' else 'unsure')
            fields=(url,url,norm(value(row,'title')) or 'Offre importée depuis Google Sheets',norm(value(row,'company')) or 'Unknown',norm(value(row,'location')),norm(value(row,'canton')),norm(value(row,'source')) or dom(url),'', '',norm(value(row,'language')),norm(value(row,'duration')),norm(value(row,'start')),norm(value(row,'category')),norm(value(row,'skills')),confidence_value,'offer',norm(value(row,'date')) or datetime.now(timezone.utc).isoformat(),score_value,'kept' if action=='GARDER' else 'new',norm(value(row,'reasons')) or 'Importée depuis Opportunités',0,inferred_review,1)
            if oid.isdigit() and not c.execute('SELECT 1 FROM offers WHERE id=?',(int(oid),)).fetchone():
                c.execute('''INSERT INTO offers(id,url,canonical_url,title,company,location,canton,source,snippet,body,language,duration,start_date,domain_category,skills_found,confidence,page_type,discovered_at,score,status,reasons,gmail_seen,review_decision,sheet_synced) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',(int(oid),)+fields);db_id=int(oid)
            else:
                cur=c.execute('''INSERT INTO offers(url,canonical_url,title,company,location,canton,source,snippet,body,language,duration,start_date,domain_category,skills_found,confidence,page_type,discovered_at,score,status,reasons,gmail_seen,review_decision,sheet_synced) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',fields);db_id=int(cur.lastrowid)
            imported+=1
        else:
            continue
        if columns['id']>=0 and str(db_id)!=oid:
            updates.append({'range':f"'{tab}'!{column_letter(columns['id'])}{sheet_row}",'values':[[str(db_id)]]})
    if updates:svc.spreadsheets().values().batchUpdate(spreadsheetId=sid,body={'valueInputOption':'RAW','data':updates}).execute()
    c.commit();log_event(f'OPPORTUNITÉS — onglet {tab} : {data_rows} ligne(s), {linked} reliée(s), {imported} reconstruite(s) dans la base, {actions} action(s) détectée(s).','blue')
    return {'rows':data_rows,'imported':imported,'linked':linked,'actions':actions}

def process_action_log(c,svc,sid):
    meta=svc.spreadsheets().get(spreadsheetId=sid).execute(); titles={x['properties']['title'] for x in meta.get('sheets',[])}
    if ACTION_LOG_TAB not in titles:return 0
    vals=svc.spreadsheets().values().get(spreadsheetId=sid,range=f"'{ACTION_LOG_TAB}'!A1:E10000").execute().get('values',[])
    if len(vals)<2:return 0
    status_map={'GARDER':'kept','TRANSFERER':'transferred','SUPPRIMER':'deleted'};review_map={'GARDER':'keep','TRANSFERER':'keep','SUPPRIMER':'reject'}; updates=[]; processed=0
    for row_index,row in enumerate(vals[1:],start=2):
        oid=row[0] if len(row)>0 else ''; action=normalize_action(row[1] if len(row)>1 else ''); url=canon(row[2]) if len(row)>2 and row[2] else ''; done=row[4] if len(row)>4 else ''
        if done or action not in status_map:continue
        cur=None
        reviewed_at=datetime.now(timezone.utc).isoformat()
        if str(oid).isdigit():cur=c.execute('UPDATE offers SET status=?,review_decision=?,reviewed_at=?,sheet_synced=1 WHERE id=?',(status_map[action],review_map[action],reviewed_at,int(oid)))
        if (not cur or cur.rowcount==0) and url:cur=c.execute('UPDATE offers SET status=?,review_decision=?,reviewed_at=?,sheet_synced=1 WHERE canonical_url=? OR url=?',(status_map[action],review_map[action],reviewed_at,url,url))
        updates.append({'range':f"'{ACTION_LOG_TAB}'!E{row_index}",'values':[[datetime.now(timezone.utc).isoformat()]]}); processed+=1
    if updates:svc.spreadsheets().values().batchUpdate(spreadsheetId=sid,body={'valueInputOption':'RAW','data':updates}).execute()
    c.commit(); return processed

def append_opportunities(c,svc,sid,tab):
    c.execute('''CREATE TABLE IF NOT EXISTS sheet_sync(
        offer_id INTEGER NOT NULL,sheet_id TEXT NOT NULL,tab TEXT NOT NULL,content_hash TEXT,
        synced_at TEXT NOT NULL,PRIMARY KEY(offer_id,sheet_id,tab))''')
    ensure_opp(svc,sid,tab); vals=svc.spreadsheets().values().get(spreadsheetId=sid,range=f"'{tab}'!A:Q").execute().get('values',[])
    remote={str(row[16]):(index,row) for index,row in enumerate(vals[1:],start=2) if len(row)>16 and str(row[16]).strip()}
    rows=[];synced_ids=[];updates=[];payloads={}
    for r in c.execute("""SELECT id,score,confidence,company,title,location,canton,language,duration,start_date,
        domain_category,skills_found,reasons,source,url,discovered_at FROM offers
        WHERE status IN ('new','kept') AND review_decision IN ('keep','unsure')
        ORDER BY CASE review_decision WHEN 'keep' THEN 0 ELSE 1 END,score DESC"""):
        oid=str(r[0]);desired=['',r[1],r[2],r[3],r[4],r[5],r[6],r[7],r[8],r[9],r[10],r[11],r[12],r[13],r[14],r[15],oid]
        payloads[int(r[0])]=desired
        if oid in remote:
            sheet_row,existing=remote[oid];padded=list(existing)+['']*(17-len(existing))
            if [str(x) for x in padded[1:17]]!=[str(x) for x in desired[1:17]]:
                updates.append({'range':f"'{tab}'!B{sheet_row}:Q{sheet_row}",'values':[desired[1:17]]})
            synced_ids.append(int(r[0]));continue
        rows.append(desired)
        synced_ids.append(int(r[0]))
    if rows:
        svc.spreadsheets().values().append(spreadsheetId=sid,range=f"'{tab}'!A:Q",valueInputOption='USER_ENTERED',insertDataOption='INSERT_ROWS',body={'values':rows}).execute()
        counts=Counter(str(row[13]) for row in rows)
        log_event('SHEETS — nouvelles lignes par source : '+', '.join(f'{key}={value}' for key,value in counts.most_common()),'blue')
    if updates:
        svc.spreadsheets().values().batchUpdate(spreadsheetId=sid,body={'valueInputOption':'USER_ENTERED','data':updates}).execute()
        log_event(f'SHEETS — {len(updates)} ligne(s) existante(s) actualisée(s) sans doublon.','blue')
    if synced_ids:
        placeholders=','.join('?' for _ in synced_ids);c.execute(f'UPDATE offers SET sheet_synced=1 WHERE id IN ({placeholders})',synced_ids)
        now=datetime.now(timezone.utc).isoformat()
        for offer_id in synced_ids:
            content_hash=hashlib.sha256(json.dumps(payloads.get(offer_id,[]),ensure_ascii=False,default=str).encode('utf-8')).hexdigest()
            c.execute('''INSERT INTO sheet_sync(offer_id,sheet_id,tab,content_hash,synced_at) VALUES(?,?,?,?,?)
                ON CONFLICT(offer_id,sheet_id,tab) DO UPDATE SET content_hash=excluded.content_hash,synced_at=excluded.synced_at''',(offer_id,sid,tab,content_hash,now))
        c.commit()
    sort_opportunities(svc,sid,tab)
    return len(rows)+len(updates)

def sort_opportunities(svc,sid,tab):
    """Keep unreviewed offers first and GARDER rows last, score descending."""
    vals=svc.spreadsheets().values().get(spreadsheetId=sid,range=f"'{tab}'!A2:Q10000").execute().get('values',[])
    if not vals:return
    helper=[[1 if row and normalize_action(row[0])=='GARDER' else 0] for row in vals]
    svc.spreadsheets().values().update(spreadsheetId=sid,range=f"'{tab}'!R2:R{len(vals)+1}",valueInputOption='RAW',body={'values':helper}).execute()
    meta=svc.spreadsheets().get(spreadsheetId=sid).execute();sheet_id=next(x['properties']['sheetId'] for x in meta['sheets'] if x['properties']['title']==tab)
    svc.spreadsheets().batchUpdate(spreadsheetId=sid,body={'requests':[{'sortRange':{'range':{'sheetId':sheet_id,'startRowIndex':1,'endRowIndex':len(vals)+1,'startColumnIndex':0,'endColumnIndex':18},'sortSpecs':[{'dimensionIndex':17,'sortOrder':'ASCENDING'},{'dimensionIndex':1,'sortOrder':'DESCENDING'}]}}]}).execute()
    svc.spreadsheets().values().clear(spreadsheetId=sid,range=f"'{tab}'!R1:R{len(vals)+1}",body={}).execute()

def purge_inactive_opportunities(c,svc,sid,tab):
    """Remove rows whose saved offer is now closed, deleted, or transferred."""
    ensure_opp(svc,sid,tab)
    vals=svc.spreadsheets().values().get(spreadsheetId=sid,range=f"'{tab}'!A1:Q10000").execute().get('values',[])
    inactive={str(row[0]) for row in c.execute("SELECT id FROM offers WHERE status IN ('closed','deleted','transferred','historical','filtered','duplicate')")}
    delete_rows=[]
    for index,row in enumerate(vals[1:],start=2):
        offer_id=str(row[16]).strip() if len(row)>16 else ''
        if offer_id and offer_id in inactive:delete_rows.append(index)
    if not delete_rows:return 0
    meta=svc.spreadsheets().get(spreadsheetId=sid).execute()
    sheet_id=next(x['properties']['sheetId'] for x in meta['sheets'] if x['properties']['title']==tab)
    requests=[{'deleteDimension':{'range':{'sheetId':sheet_id,'dimension':'ROWS','startIndex':row-1,'endIndex':row}}} for row in sorted(delete_rows,reverse=True)]
    svc.spreadsheets().batchUpdate(spreadsheetId=sid,body={'requests':requests}).execute()
    return len(delete_rows)

def process_actions(c,svc,sid,response_tab,opp_tab):
    ensure_opp(svc,sid,opp_tab); vals=svc.spreadsheets().values().get(spreadsheetId=sid,range=f"'{opp_tab}'!A1:Q10000").execute().get('values',[])
    if not vals:return 0,0
    opp_hi=detect_header_row(vals,('action',));opp_heads=vals[opp_hi]
    action_col=find_header_column(opp_heads,'Action');id_col=find_header_column(opp_heads,'ID Stage Hunter','ID');url_col=find_header_column(opp_heads,'Lien','URL')
    rv=response_values(svc,sid,response_tab); hi=detect_header_row(rv,('entreprise',)) if rv else 0; heads=rv[hi] if rv else [];transfer=[];delete_rows=[];kept=0;unresolved=0
    response_columns={
        'company':find_header_column(heads,'Nom Entreprise','Entreprise'),
        'location':find_header_column(heads,"Ville de l'Entreprise",'Ville','Lieu'),
        'sector':find_header_column(heads,"Secteur d'activité",'Secteur'),
        'detail':find_header_column(heads,"Activité détaillée (l'entreprise)",'Activité détaillée','Offre','Poste'),
        'link':find_header_column(heads,'Lien 1','Lien','URL'),
        'note':find_header_column(heads,"Note /10 (A combien ça m'intéresse)",'Note /10','Note'),
        'status':find_header_column(heads,'Statut actuel','Statut'),
        'returns':find_header_column(heads,'Retours','Retour','Notes'),
    }
    for idx,row in enumerate(vals[opp_hi+1:],start=opp_hi+2):
        act=normalize_action(row[action_col] if 0<=action_col<len(row) else '')
        oid=norm(row[id_col]) if 0<=id_col<len(row) else ''
        raw_url=norm(row[url_col]) if 0<=url_col<len(row) else '';url=canon(raw_url) if safe_public_url(unwrap_url(raw_url)) else ''
        db=None
        if oid.isdigit():db=c.execute('SELECT id,company,location,title,url,score,reasons,domain_category FROM offers WHERE id=?',(int(oid),)).fetchone()
        if not db and url:db=c.execute('SELECT id,company,location,title,url,score,reasons,domain_category FROM offers WHERE canonical_url=? OR url=?',(url,url)).fetchone()
        if act not in ('GARDER','TRANSFERER','SUPPRIMER'):continue
        if not db:unresolved+=1;continue
        db_id=db[0]
        if act=='TRANSFERER' and heads:
            nr=['']*len(heads)
            values={'company':db[1],'location':db[2],'sector':db[7] or 'Stage / Engineering','detail':db[3],'link':db[4],'note':round(float(db[5] or 0)/10,1),'status':'À vérifier / candidater','returns':f'Score {PRODUCT_NAME}: {db[5]}/100 | {db[6]}'}
            for key,value in values.items():
                column=response_columns[key]
                if column>=0:nr[column]=value
            transfer.append(nr);c.execute("UPDATE offers SET status='transferred',review_decision='keep',reviewed_at=?,sheet_synced=1 WHERE id=?",(datetime.now(timezone.utc).isoformat(),db_id));delete_rows.append(idx)
        elif act=='SUPPRIMER':c.execute("UPDATE offers SET status='deleted',review_decision='reject',reviewed_at=?,sheet_synced=1 WHERE id=?",(datetime.now(timezone.utc).isoformat(),db_id));delete_rows.append(idx)
        elif act=='GARDER':c.execute("UPDATE offers SET status='kept',review_decision='keep',reviewed_at=?,sheet_synced=1 WHERE id=?",(datetime.now(timezone.utc).isoformat(),db_id));kept+=1
    if transfer: svc.spreadsheets().values().append(spreadsheetId=sid,range=f"'{response_tab}'!A:Z",valueInputOption='USER_ENTERED',insertDataOption='INSERT_ROWS',body={'values':transfer}).execute()
    # Delete bottom-up via sheetId
    if delete_rows:
        meta=svc.spreadsheets().get(spreadsheetId=sid).execute(); shid=next(x['properties']['sheetId'] for x in meta['sheets'] if x['properties']['title']==opp_tab)
        req=[{'deleteDimension':{'range':{'sheetId':shid,'dimension':'ROWS','startIndex':n-1,'endIndex':n}}} for n in sorted(delete_rows,reverse=True)]
        svc.spreadsheets().batchUpdate(spreadsheetId=sid,body={'requests':req}).execute()
    c.commit()
    if kept or unresolved:log_event(f'ACTIONS — {kept} offre(s) gardée(s), {unresolved} action(s) sans correspondance après resynchronisation.','yellow' if unresolved else 'blue')
    return len(transfer),len(delete_rows)

def looks_like_job_link(u,label='',subject=''):
    if not safe_public_url(u):return False
    p=urlparse(u); host=(p.hostname or '').lower(); path=(p.path+'?'+p.query).lower(); context=(label+' '+subject).lower()
    blocked_hosts=('google.com','googleusercontent.com','gstatic.com','youtube.com','facebook.com','instagram.com','doubleclick.net')
    blocked_path=('unsubscribe','désabonnement','desabonnement','email-preferences','preferences','privacy','cookie','terms','login','signin','register','share','tracking','pixel','logo','image','assets')
    if host.endswith(blocked_hosts) or any(x in path for x in blocked_path):return False
    if re.search(r'\.(?:png|jpe?g|gif|svg|webp|css|js|ico|pdf)(?:$|\?)',path):return False
    known=('jobs.ch','jobup.ch','linkedin.com','indeed.com','glassdoor.','jobscout24.ch','iagora.com','swissdevjobs.ch','eth-gethired.ch')
    path_signal=any(x in path for x in ('/job','/jobs','/career','/careers','/vacanc','/emploi','/offre','/position','/requisition','/internship','/stage'))
    label_signal=bool(re.search(r'\b(job|offer|offre|poste|position|intern|internship|stage|stagiaire|praktikum|apply|candidater)\b',context))
    return any(x in host for x in known) or path_signal or label_signal

def gmail_candidates(gmail):
    days=os.getenv('GMAIL_LOOKBACK_DAYS','120'); mx=int(os.getenv('GMAIL_MAX_MESSAGES','150')); per_message=int(os.getenv('GMAIL_MAX_LINKS_PER_MESSAGE','12')); excluded_labels=[x.strip() for x in os.getenv('GMAIL_EXCLUDED_LABELS','STAGE').split(',') if x.strip()]; label_filter=' '.join('-label:'+x.replace(' ','-') for x in excluded_labels); q=f'(intern OR internship OR stage OR stagiaire OR praktikum) newer_than:{days}d {label_filter}'.strip(); log_event(f'GMAIL — recherche des messages, libellé(s) exclu(s) : {", ".join(excluded_labels) or "aucun"}.','bold blue'); msgs=gmail.users().messages().list(userId='me',q=q,maxResults=mx).execute().get('messages',[]); out=[]; seen=set(); rejected=0; confirmations=0
    log_event(f'GMAIL — {len(msgs)} message(s) à lire.','blue')
    def walk(payload):
        mime=payload.get('mimeType',''); data=payload.get('body',{}).get('data'); chunks=[]
        if data and (mime.startswith('text/') or not mime):
            try: chunks.append((mime,base64.urlsafe_b64decode(data+'===').decode('utf-8','ignore')))
            except: pass
        for p in payload.get('parts',[]) or []: chunks+=walk(p)
        return chunks
    for index,m in enumerate(msgs,start=1):
        try: msg=gmail.users().messages().get(userId='me',id=m['id'],format='full').execute()
        except Exception as error:
            log_event(f'GMAIL {index}/{len(msgs)} · lecture impossible : {short_text(error,90)}','yellow'); continue
        headers={h['name'].lower():h['value'] for h in msg.get('payload',{}).get('headers',[])}; subject=headers.get('subject',''); chunks=walk(msg.get('payload',{})); raw=' '.join(x[1] for x in chunks); text=BeautifulSoup(raw,'html.parser').get_text(' ',strip=True); links=[]
        if is_application_confirmation(subject,text):
            confirmations+=1;log_event(f'GMAIL {index}/{len(msgs)} · confirmation de candidature ignorée : {short_text(subject,70)}','dim');continue
        for mime,chunk in chunks:
            if 'html' in mime:
                for a in BeautifulSoup(chunk,'html.parser').find_all('a',href=True):links.append((a.get('href',''),a.get_text(' ',strip=True)))
            else:
                links += [(u,'') for u in re.findall(r'https?://[^\s<>"\']+',chunk)]
        kept_this_message=0
        for raw_url,label in links:
            u=unwrap_url(raw_url.replace('&amp;','&').rstrip(').,;'))
            if not looks_like_job_link(u,label,subject):rejected+=1; continue
            cu=canon(u)
            if cu in seen:continue
            seen.add(cu); out.append({'url':cu,'title':norm(label) or subject,'snippet':text[:1500],'source':'Gmail / '+dom(cu),'origin':'gmail'}); kept_this_message+=1
            if kept_this_message>=per_message:break
        if index==1 or index%5==0 or index==len(msgs):
            log_event(f'GMAIL {index}/{len(msgs)} · {len(out)} lien(s) plausible(s) conservé(s), {rejected} écarté(s).')
    excluded_text=', '.join(excluded_labels) if excluded_labels else 'aucun'
    log_event(f'GMAIL terminé · {len(msgs)} messages lus (libellés exclus : {excluded_text}), {len(out)} liens plausibles, {rejected} liens techniques écartés, {confirmations} confirmation(s) ignorée(s).','bold blue'); return out

def export(c):
    frame=pd.read_sql_query("""SELECT id,title,company,location,canton,language,duration,domain_category,
        source,url,score,confidence,review_decision,status,reasons,discovered_at FROM offers
        WHERE status IN ('new','kept') AND review_decision IN ('keep','unsure')
        ORDER BY CASE review_decision WHEN 'keep' THEN 0 ELSE 1 END,score DESC""",c)
    return write_excel_safely(frame,OUT,'résultats principaux')
def report(c,n=20,since=None):
    if since:
        rows=c.execute("SELECT score,company,title,source,status FROM offers WHERE status='new' AND discovered_at>=? ORDER BY score DESC LIMIT ?",(since,n)).fetchall()
        table_title=f'{PRODUCT_NAME} V{VERSION} — nouvelles de ce scan'
    else:
        rows=c.execute("SELECT score,company,title,source,status FROM offers WHERE status IN ('new','kept') ORDER BY CASE WHEN status='kept' THEN 1 ELSE 0 END,score DESC LIMIT ?",(n,)).fetchall()
        table_title=f'{PRODUCT_NAME} V{VERSION} — opportunités actives'
    t=Table(title=table_title,box=box.ROUNDED,header_style="bold magenta",title_style="bold cyan",expand=False,pad_edge=False)
    t.add_column("Score",justify="center",style="bold cyan",width=8,no_wrap=True)
    t.add_column("Entreprise",style="bold white",max_width=22,overflow="ellipsis",no_wrap=True)
    t.add_column("Offre",style="white",max_width=45,overflow="ellipsis",no_wrap=True)
    t.add_column("Source",style="dim",max_width=20,overflow="ellipsis",no_wrap=True)
    t.add_column("Statut",justify="center",style="green",width=10,no_wrap=True)
    status_map={'new':'À trier','kept':'Retenue','dismissed':'Écartée','applied':'Postulée','closed':'Fermée'}
    for r in rows:
        sc=f"{int(r[0])}%" if r[0] is not None else "-"
        st=status_map.get(str(r[4]).lower(),str(r[4]))
        t.add_row(sc,str(r[1] or ''),str(r[2] or ''),str(r[3] or ''),st)
    console.print(t)

def log_scan_configuration(profile,sheets_enabled=False,gmail_enabled=False):
    """Write every effective, non-secret scan setting before network activity."""
    student=profile.get('student') or {};target=profile.get('target') or {};location=profile.get('location') or {}
    skills=profile.get('skills') or {};interests=profile.get('interests') or {};search=profile.get('search') or {}
    sources=profile.get('sources') or {};google=(profile.get('integrations') or {}).get('google') or {}

    def items(value):
        if value is None:return []
        if isinstance(value,(list,tuple,set)):return [norm(x) for x in value if norm(x)]
        return [norm(value)] if norm(value) else []
    def joined(value,empty='aucun'):
        values=items(value);return ', '.join(values) if values else empty
    def yes(value):return 'oui' if bool(value) else 'non'
    def env_int(name,default,minimum=None,maximum=None):
        try:value=int(os.getenv(name,str(default)))
        except (TypeError,ValueError):value=int(default)
        if minimum is not None:value=max(minimum,value)
        if maximum is not None:value=min(maximum,value)
        return value
    def env_float(name,default,minimum=None,maximum=None):
        try:value=float(os.getenv(name,str(default)))
        except (TypeError,ValueError):value=float(default)
        if minimum is not None:value=max(minimum,value)
        if maximum is not None:value=min(maximum,value)
        return value

    components=profile_search_components(profile)
    queries=build_search_queries(profile,emit_log=False)
    fixed_urls=targeted_fixed_urls(profile)
    configured_budget=search.get('query_budget',search.get('auto_query_limit',24))
    query_budget=env_int('SEARCH_QUERY_BUDGET',os.getenv('AUTO_QUERY_LIMIT',configured_budget),4,300)
    search_workers=env_int('SEARCH_WORKERS',4,1,8)
    scrape_workers=env_int('SCRAPE_WORKERS',8,1,12)
    fixed_limit=env_int('FIXED_SITE_LIMIT',len(fixed_urls),0,30)
    effective_fixed_urls=fixed_urls[:fixed_limit]
    countries=location.get('countries') or location.get('country') or []
    priority_places=items(location.get('priority_locations'))+items(location.get('priority_cantons'))
    regions=[format_region(region) for region in profile_regions(profile)]
    professional=profile_professional_interests(profile)
    personal=interests.get('personal') or []
    pack_domains=profile.get('_source_pack_domains',[]) or []
    manual_queries=[]
    if search.get('use_manual_queries',True):manual_queries+=search.get('queries',[]) or []
    manual_queries+=sources.get('custom_queries',[]) or []
    manual_queries+=profile.get('_source_pack_queries',[]) or []

    log_event('CONFIGURATION — début du diagnostic effectif (aucun secret n’est affiché).','bold white')
    log_event(f'CONFIG PROFIL — contrat {profile_contract_mode(profile)} · objectif « {norm(student.get("stage_type")) or "non défini"} » · contrats acceptés : {joined(student.get("contract_types"))}.','cyan')
    log_event(f'CONFIG PROFIL — métiers : {joined(target.get("job_titles") or target.get("roles"))}.','cyan')
    log_event(f'CONFIG PROFIL — compétences techniques ({len(items(skills.get("core")))}): {joined(skills.get("core"))}.','cyan')
    log_event(f'CONFIG PROFIL — domaines maîtrisés ({len(items(skills.get("strong_domains")))}): {joined(skills.get("strong_domains"))}.','cyan')
    log_event(f'CONFIG PROFIL — secteurs/intérêts professionnels ({len(professional)}): {joined(professional)}.','cyan')
    log_event(f'CONFIG PROFIL — passions personnelles exclues de la recherche ({len(items(personal))}): {joined(personal)}.','dim')
    log_event(f'CONFIG PROFIL — pays : {joined(countries)} · lieux prioritaires : {joined(priority_places)} · régions : {joined(regions)}.','cyan')
    log_event(f'CONFIG PROFIL — langues : {joined(location.get("acceptable_language"))} · durée min {student.get("min_weeks",0)} sem. · disponibilité {student.get("start_date") or "non définie"} → {student.get("end_date") or "non définie"}.','cyan')
    log_event(f'CONFIG MOTS — intentions : {joined(components.get("intents"))} · métiers nettoyés : {joined(components.get("roles"))} · thèmes : {joined(components.get("themes"))}.','bold cyan')

    log_event(f'CONFIG RECHERCHE — mode {search.get("mode","non défini")} · stratégie {search.get("strategy","profile")} · budget demandé {query_budget} · requêtes réellement préparées {len(queries)} · résultats/requête {env_int("SEARCH_RESULTS_PER_QUERY",8,1,50)}.','bold blue')
    time_budget_label=f'{scan_time_budget_seconds()//60} min' if scan_time_budget_seconds() else 'illimité'
    log_event(f'CONFIG PROFONDE — variantes de contrat {"toutes" if str(os.getenv("SEARCH_INTENT_EXPANSION","0")).lower() in ("1","true","yes","on") else "alternées"} · jusqu’à {env_int("SEARCH_ROLE_PAIR_LIMIT",3,1,8)} métier(s) par compétence · {env_int("SEARCH_SOURCE_QUERIES_PER_DOMAIN",1,1,4)} requête(s)/domaine · budget temps {time_budget_label}.','blue')
    resolved_backend_values,ignored_backend_values,migrated_backend_values,legacy_backend_upgrade=configured_search_backends()
    backend_log=', '.join(resolved_backend_values)
    if legacy_backend_upgrade:backend_log+=' · ancien défaut DuckDuckGo/Brave migré'
    if ignored_backend_values:backend_log+=f" · ignorés: {', '.join(ignored_backend_values)}"
    if migrated_backend_values:backend_log+=f" · alias: {', '.join(f'{a}→{b}' for a,b in migrated_backend_values)}"
    log_event(f'CONFIG RECHERCHE — workers moteur {min(search_workers,max(1,len(queries)))} (plafond configuré {search_workers}) · région {preferred_search_region(profile)} · moteurs réels {backend_log} · timeout {env_int("SEARCH_TIMEOUT_SECONDS",14,5)} s.','blue')
    circuit_disabled=str(os.getenv('WEB_DISABLE_CIRCUIT_BREAKER','0')).strip().lower() in ('1','true','yes','on')
    retry_empty_effective=str(os.getenv('WEB_RETRY_EMPTY_RESULTS','1' if search.get('retry_empty_results',False) else '0')).strip().lower() in ('1','true','yes','on')
    circuit_config='désactivé' if circuit_disabled else f'sous {env_float("WEB_MIN_PRODUCTIVITY",0.04,0,1)*100:.0f}% avec minimum {env_int("WEB_MIN_PROBE_LINKS",5,0)} lien(s)'
    log_event(f'CONFIG ADAPTATIVE — sources directes en premier · sonde web {env_int("WEB_PROBE_QUERIES",search_workers*2,1)} requête(s) · coupe-circuit {circuit_config}.','bold blue')
    log_event(f'CONFIG RECHERCHE — tentatives {env_int("SEARCH_RETRIES",1,0,4)} · backoff {env_float("SEARCH_RETRY_BACKOFF",1.0,0.1):g} s · délai workers {env_float("SEARCH_DELAY_MIN",0.15,0):g}–{env_float("SEARCH_DELAY_MAX",0.35,0):g} s · retenter si vide : {yes(retry_empty_effective)}.','blue')
    log_event(f'CONFIG RÉPARTITION — part site: {float(search.get("site_query_share",0.35))*100:.0f}% · requêtes manuelles activées : {yes(search.get("use_manual_queries",True))} · {len(manual_queries)} requête(s) manuelle(s)/pack disponible(s).','blue')
    log_event(f'CONFIG VALIDATION — pertinence obligatoire : {yes(search.get("require_profile_relevance",True))} · contrat non confirmé accepté : {yes(search.get("allow_unconfirmed_contract",False))} · score minimal {env_float("MIN_OPPORTUNITY_SCORE",30,0,100):g}/100 · âge max {env_int("MAX_JOB_AGE_DAYS",90,0)} j.','blue')

    log_event(f'CONFIG PAGES — workers {scrape_workers} · maximum {env_int("MAX_IN_FLIGHT_PAGES",scrape_workers*2,1,48)} page(s) simultanément en RAM · taille/page {env_int("MAX_RESPONSE_BYTES",5_000_000,250_000,15_000_000)/1_000_000:g} Mo · timeout HTTP {env_int("HTTP_TIMEOUT_SECONDS",14,1)} s · tentatives HTTP {env_int("HTTP_RETRIES",1,0,3)} · revalidation max {env_int("RECHECK_MAX_OFFERS",100,0)} offre(s).','magenta')
    log_event(f'CONFIG LISTINGS — {len(fixed_urls)} URL(s) préparée(s), {len(effective_fixed_urls)} visitée(s) · maximum {env_int("MAX_LISTING_DETAILS",40,0)} piste(s)/listing · profondeur {env_int("LISTING_CRAWL_DEPTH",2,0,3)} · plafond récursif {env_int("MAX_RECURSIVE_LEADS",160,0,500)} · plafond global {env_int("MAX_TOTAL_DETAIL_PAGES",1200,100,10000)} page(s) analysée(s).','magenta')
    log_event(f'CONFIG PRIORISATION — seuil piste {env_float("MIN_LISTING_LEAD_PRIORITY",4,0):g} · maximum {env_int("MAX_LEADS_PER_SUBLISTING",24,1,80)} fiche(s) par sous-listing · historique de rendement activé.','magenta')
    log_event(f'CONFIG SOURCES — packs : {joined(sources.get("packs"))} · domaines pack/personnels ({len(pack_domains)}): {joined(pack_domains)}.','magenta')
    log_event(f'CONFIG SOURCES — domaines personnalisés : {joined(sources.get("custom_domains"))} · listings personnalisés : {len(items(sources.get("custom_urls")))} · requêtes personnalisées : {len(items(sources.get("custom_queries")))}.','magenta')
    for index,url in enumerate(effective_fixed_urls,start=1):
        log_event(f'CONFIG LISTING {index:02d}/{len(effective_fixed_urls):02d} — {url}','dim')

    sheet_present=bool(str(google.get('sheet_id') or os.getenv('GOOGLE_SHEET_ID','')).strip())
    log_event(f'CONFIG GOOGLE — Sheets {"activé" if sheets_enabled else "désactivé"} · identifiant Sheet {"présent" if sheet_present else "absent"} · création automatique {yes(google.get("auto_create_sheet",False))} · onglets « {google.get("response_tab","Réponses")} » / « {google.get("opportunity_tab","Opportunités")} ».','green')
    log_event(f'CONFIG GMAIL — {"activé" if gmail_enabled else "désactivé"} · recul {env_int("GMAIL_LOOKBACK_DAYS",120,0)} j · messages max {env_int("GMAIL_MAX_MESSAGES",150,0)} · liens/message {env_int("GMAIL_MAX_LINKS_PER_MESSAGE",12,0)} · libellés exclus : {os.getenv("GMAIL_EXCLUDED_LABELS","STAGE") or "aucun"}.','green')
    log_event(f'CONFIG SORTIES — base {DB.name} · Excel {OUT.name} · diagnostic {DIAGNOSTICS.name} · rejets {REJECTIONS_OUT.name}.','green')
    for index,query in enumerate(queries,start=1):
        log_event(f'CONFIG REQUÊTE {index:02d}/{len(queries):02d} — {query}','dim')
    log_event('CONFIGURATION — fin du diagnostic ; démarrage des connexions et du scan.','bold white')

def main():
    ap=argparse.ArgumentParser();sub=ap.add_subparsers(dest='cmd',required=True)
    parsers={name:sub.add_parser(name) for name in ('scan','actions','review-sync','report','google-auth','google-check','google-create-sheet','google-setup-sheet')}
    for parser in parsers.values():parser.add_argument('--profile',default=os.getenv('STAGE_HUNTER_PROFILE',''))
    parsers['scan'].add_argument('--sheets',action='store_true');parsers['scan'].add_argument('--gmail',action='store_true');parsers['scan'].add_argument('--resume',action='store_true')
    a=ap.parse_args();p=load_profile(a.profile);profile_id=configure_runtime(p);c=init_db();scan_run_id=None
    resume_checkpoint=None
    if a.cmd=='scan' and getattr(a,'resume',False):
        resume_checkpoint=load_scan_checkpoint(p)
        for key,value in (resume_checkpoint.get('runtime_settings') or {}).items():
            if key in RESUME_RUNTIME_KEYS and value is not None:os.environ[key]=str(value)
    log_event(f'{PRODUCT_NAME.upper()} V{VERSION} — démarrage de la commande {a.cmd}.','bold white')
    profile_diag=diagnostic_profile_summary(p);countries=(p.get('location') or {}).get('countries') or (p.get('location') or {}).get('country') or 'non défini'
    log_event(f'PROFIL {profile_id} — pays {countries} · durée min {profile_diag["min_weeks"]} sem. · fenêtre {profile_diag["start_date"]} → {profile_diag["end_date"]} · langues {", ".join(profile_diag["acceptable_language"])}.','cyan')
    if a.cmd=='google-auth':google_credentials();log_event('OAuth Sheets + Gmail OK.','bold green');return
    if a.cmd=='report':report(c);return
    google_cfg=(p.get('integrations') or {}).get('google') or {}
    if a.cmd=='google-create-sheet':
        sh,_=services();sid,url=create_connected_spreadsheet(sh,p,p.get('_profile_path'));log_event(f'Tableau prêt · ID {sid} · {url}','bold green');return
    if a.cmd=='google-setup-sheet':
        sh,_=services();sid,resp,opp=cfg(p);url=format_connected_spreadsheet(sh,sid,resp,opp);log_event(f'Tableau mis en forme · {url}','bold green');return
    if a.cmd=='google-check':
        sh,gm=services();messages=[]
        if google_cfg.get('sheets_enabled'):
            sid,_,_=cfg(p);meta=sh.spreadsheets().get(spreadsheetId=sid,fields='properties.title').execute();messages.append('Sheets connecté : '+meta.get('properties',{}).get('title','tableau accessible'))
        if google_cfg.get('gmail_enabled'):
            data=gm.users().getProfile(userId='me').execute();messages.append('Gmail connecté : '+data.get('emailAddress','compte accessible'))
        if not messages:messages.append('OAuth Google valide ; Sheets et Gmail sont désactivés dans ce profil')
        for message in messages:log_event(message,'bold green')
        return
    sheets_enabled=bool(getattr(a,'sheets',False) or google_cfg.get('sheets_enabled',False))
    gmail_enabled=bool(getattr(a,'gmail',False) or google_cfg.get('gmail_enabled',False))
    if a.cmd=='scan':
        log_scan_configuration(p,sheets_enabled,gmail_enabled);scan_run_id=start_scan_run(c,p)
    sh=gm=sid=resp=opp=None
    if sheets_enabled or gmail_enabled or a.cmd in ('actions','review-sync'):
        log_event('GOOGLE — connexion aux services activés…','cyan');sh,gm=services();log_event('GOOGLE — connexion OK.','green')
    configured_sid=str(google_cfg.get('sheet_id') or get_profile_setting('google_sheet_id') or os.getenv('GOOGLE_SHEET_ID','')).strip()
    if sheets_enabled and not configured_sid and google_cfg.get('auto_create_sheet',False):
        create_connected_spreadsheet(sh,p,p.get('_profile_path'))
    if sheets_enabled or a.cmd in ('actions','review-sync'):sid,resp,opp=cfg(p)
    if a.cmd=='actions':
        import_opportunities(c,sh,sid,opp);logged=process_action_log(c,sh,sid); tr,de=process_actions(c,sh,sid,resp,opp);log_event(f'{logged} action(s) Apps Script synchronisée(s), {tr} transfert(s), {de} ligne(s) traitée(s).','bold green');return
    if a.cmd=='review-sync':
        import_opportunities(c,sh,sid,opp);added=append_opportunities(c,sh,sid,opp)
        remaining=c.execute("SELECT COUNT(*) FROM offers WHERE status='new' AND review_decision='pending'").fetchone()[0]
        log_event(f'SWIPER — {added} offre(s) validée(s) envoyée(s) vers {opp} · {remaining} encore à examiner.','bold green');return
    if sheets_enabled:
        log_event('ACTIONS — synchronisation des choix effectués dans le Sheet…','cyan')
        import_opportunities(c,sh,sid,opp)
        logged=process_action_log(c,sh,sid); tr,de=process_actions(c,sh,sid,resp,opp); log_event(f'ACTIONS — {logged} journalisée(s), {tr} transfert(s), {de} ligne(s) traitée(s).','green')
        log_event('HISTORIQUE — lecture des liens déjà présents dans Réponses…','cyan')
        n=import_history(c,sh,sid,resp); log_event(f'HISTORIQUE — {n} nouvelle(s) référence(s) URL/entreprise/titre importée(s).','green')
    else:log_event('GOOGLE SHEETS — désactivé pour ce profil.','dim')
    stale=revalidate_existing_offers(c,p)
    deduplicate_existing_offers(c)
    if sheets_enabled:
        purged=purge_inactive_opportunities(c,sh,sid,opp)
        log_event(f'NETTOYAGE — {purged} ligne(s) fermée(s)/traitée(s) retirée(s) de {opp}.','yellow' if purged else 'green')
    if getattr(a,'resume',False):
        checkpoint=resume_checkpoint
        candidates=checkpoint['candidates'];direct_count=int(checkpoint.get('direct_count',0));web_count=int(checkpoint.get('web_count',0))
        log_event(f'REPRISE — {len(candidates)} candidat(s) chargés du {checkpoint.get("created_at","checkpoint")}; les offres déjà enregistrées seront ignorées.','bold cyan')
    else:
        # Productive direct listings run first. Web engines then provide a bounded
        # discovery fallback and can stop after their probe when they are empty.
        phase=time.perf_counter();candidates=fixed_site_candidates(p,c);SCAN_METRICS['phases']['direct_discovery_seconds']=round(time.perf_counter()-phase,2)
        direct_count=len(candidates);log_event(f'SOURCES DIRECTES — {direct_count} candidat(s) brut(s).','cyan')
        phase=time.perf_counter();web_candidates=search_web(build_search_queries(p),int(os.getenv('SEARCH_RESULTS_PER_QUERY','8')),c);SCAN_METRICS['phases']['web_search_seconds']=round(time.perf_counter()-phase,2)
        web_count=len(web_candidates);candidates+=web_candidates;log_event(f'WEB — {web_count} candidat(s) brut(s) ajoutés en complément.','cyan')
        if gmail_enabled:candidates+=gmail_candidates(gm)
        else:log_event('GMAIL — désactivé pour ce profil.','dim')
        save_scan_checkpoint(p,candidates,direct_count,web_count)
    phase=time.perf_counter();new,closed=ingest(c,candidates,p);SCAN_METRICS['phases']['analysis_seconds']=round(time.perf_counter()-phase,2); log_event(f'Nouvelles vraies offres retenues : {new} · fermées/expirées écartées : {closed+stale}.','bold green')
    if sheets_enabled:
        pending=c.execute("SELECT COUNT(*) FROM offers WHERE status='new' AND review_decision='pending'").fetchone()[0]
        log_event(f'SWIPER — {pending} offre(s) attendent ton tri ; aucune offre en attente n’est envoyée automatiquement vers {opp}.','bold magenta')
        added=append_opportunities(c,sh,sid,opp)
        if added:log_event(f'SHEETS — {added} ancienne(s) décision(s) Garder/À revoir synchronisée(s).','green')
    log_event('EXPORT — génération du fichier Excel local…','cyan')
    export(c);report(c,since=RUN_STARTED_AT.isoformat())
    summary={'new':new,'closed':closed+stale,'pending':c.execute("SELECT COUNT(*) FROM offers WHERE status='new' AND review_decision='pending'").fetchone()[0],'direct_candidates':direct_count,'web_candidates':web_count,'duration_seconds':round(time.perf_counter()-RUN_STARTED,2),'metrics':SCAN_METRICS}
    finish_scan_run(c,scan_run_id,summary)
    scan_checkpoint_path().unlink(missing_ok=True)
    log_event(f'SCAN TERMINÉ — durée totale {elapsed_label()} · résultats : {OUT}.','bold green')
if __name__=='__main__':main()

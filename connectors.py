"""
Connectors Module for Job Hunter (Stage Hunter v6)
Provides specialized parsing and card discovery for major job boards:
- LinkedIn
- jobs.ch / jobup.ch / jobscout24.ch
- iAgora (Internships & European placements)
- Glassdoor
- Indeed
- JobTeaser & university career portals
"""

from __future__ import annotations
import json
import re
from urllib.parse import urlparse, urljoin, unquote
from bs4 import BeautifulSoup


def _norm(text: str) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", str(text)).strip()


def _clean_company_name(company: str) -> str:
    """Strip rating badges, legal suffixes or trailing junk from company names."""
    if not company:
        return ""
    c = _norm(company)
    # Strip ratings like "4.2 ★" or "3.8*"
    c = re.sub(r"\b\d[.,]\d\s*[★*⭐]?\s*", "", c)
    # Strip trailing " - jobs.ch", " | LinkedIn", etc.
    c = re.sub(r"\s*[-|·•]\s*(?:jobs\.ch|jobup|linkedin|indeed|glassdoor|iagora).*$", "", c, flags=re.I)
    return _norm(c)


def get_platform_name(url: str) -> str:
    """Identify the job board platform from URL."""
    if not url:
        return ""
    host = urlparse(url).hostname or ""
    host = host.lower().removeprefix("www.")
    if "linkedin." in host:
        return "linkedin"
    if any(h in host for h in ("jobs.ch", "jobup.ch", "jobscout24.ch")):
        return "jobs_ch"
    if "iagora." in host:
        return "iagora"
    if "glassdoor." in host:
        return "glassdoor"
    if "indeed." in host:
        return "indeed"
    if "jobteaser." in host:
        return "jobteaser"
    return "generic"


# =============================================================================
# 1. LINKEDIN SPECIALIZED CONNECTOR
# =============================================================================

def parse_linkedin_job(url: str, soup: BeautifulSoup, html: str) -> dict | None:
    """Parse LinkedIn job posting HTML with high precision."""
    data = {}

    # 1. Job Title
    title_el = (
        soup.find("h1", class_=re.compile(r"topcard__title|top-card-layout__title|job-title", re.I))
        or soup.find("h2", class_=re.compile(r"topcard__title|top-card-layout__title", re.I))
        or soup.find("meta", property="og:title")
    )
    if title_el:
        raw_title = title_el.get("content") if title_el.name == "meta" else title_el.get_text(" ", strip=True)
        raw_title = re.sub(r"\s*\|\s*LinkedIn\s*$", "", raw_title, flags=re.I)
        # Often "Role at Company" or "Role - Company - Location"
        if " hiring " in raw_title:
            parts = raw_title.split(" hiring ")
            data["title"] = _norm(parts[1].split(" in ")[0]) if len(parts) > 1 else _norm(raw_title)
            data["company"] = _clean_company_name(parts[0])
        elif " - " in raw_title:
            parts = raw_title.split(" - ")
            data["title"] = _norm(parts[0])
            if len(parts) > 1:
                data["company"] = _clean_company_name(parts[1])
            if len(parts) > 2:
                data["location"] = _norm(parts[2])
        else:
            data["title"] = _norm(raw_title)

    # 2. Company Name
    if not data.get("company"):
        comp_el = (
            soup.find("a", class_=re.compile(r"topcard__org-name-link|topcard__flavor--black-link|sub-nav-cta__optional-url", re.I))
            or soup.find("span", class_=re.compile(r"topcard__flavor", re.I))
        )
        if comp_el:
            data["company"] = _clean_company_name(comp_el.get_text(" ", strip=True))

    # 3. Location
    if not data.get("location"):
        loc_el = (
            soup.find("span", class_=re.compile(r"topcard__flavor--bullet|top-card-layout__first-sub-headline", re.I))
            or soup.find("span", class_="job-details-jobs-unified-top-card__bullet")
        )
        if loc_el:
            data["location"] = _norm(loc_el.get_text(" ", strip=True))

    # 4. Employment Type / Criteria
    criteria = []
    for item in soup.find_all("li", class_=re.compile(r"description__job-criteria-item", re.I)):
        text = _norm(item.get_text(" ", strip=True))
        if text:
            criteria.append(text)
    if criteria:
        data["employment_type"] = " · ".join(criteria)

    # 5. Job Description
    desc_el = (
        soup.find("div", class_=re.compile(r"show-more-less-html__markup|description__text", re.I))
        or soup.find("section", class_=re.compile(r"show-more-less-html", re.I))
    )
    if desc_el:
        data["description"] = _norm(desc_el.get_text(" ", strip=True))[:50000]

    return data if data.get("title") else None


def parse_linkedin_listing_leads(url: str, soup: BeautifulSoup) -> list[dict]:
    """Extract individual job cards from a LinkedIn job listing page."""
    leads = []
    cards = soup.find_all("div", class_=re.compile(r"base-card|job-search-card", re.I))
    if not cards:
        cards = soup.find_all("li", class_=re.compile(r"jobs-search__results-list|result-card", re.I))

    for card in cards:
        title_el = (
            card.find("h3", class_=re.compile(r"base-search-card__title|job-search-card__title", re.I))
            or card.find("span", class_=re.compile(r"screen-reader-text", re.I))
            or card.find(["h3", "h4"])
        )
        link_el = card.find("a", class_=re.compile(r"base-card__full-link|job-search-card__url", re.I)) or card.find("a", href=True)
        comp_el = card.find("h4", class_=re.compile(r"base-search-card__subtitle|job-search-card__subtitle", re.I)) or card.find("a", class_=re.compile(r"hidden-nested-link", re.I))
        loc_el = card.find("span", class_=re.compile(r"job-search-card__location", re.I))

        title = _norm(title_el.get_text(" ", strip=True)) if title_el else ""
        href = link_el.get("href", "") if link_el else ""
        company = _clean_company_name(comp_el.get_text(" ", strip=True)) if comp_el else ""
        location = _norm(loc_el.get_text(" ", strip=True)) if loc_el else ""

        if title and href:
            leads.append({
                "title": title,
                "href": href,
                "company": company,
                "location": location,
            })
    return leads


# =============================================================================
# 2. JOBS.CH / JOBUP.CH SPECIALIZED CONNECTOR
# =============================================================================

def parse_jobsch_job(url: str, soup: BeautifulSoup, html: str) -> dict | None:
    """Parse jobs.ch and jobup.ch vacancies with data-cy and JSON payload support."""
    data = {}

    # Check Next.js embedded data first if present
    next_script = soup.find("script", id="__NEXT_DATA__")
    if next_script and next_script.string:
        try:
            payload = json.loads(next_script.string)
            props = payload.get("props", {}).get("pageProps", {})
            vacancy = props.get("vacancy") or props.get("job") or {}
            if vacancy:
                data["title"] = _norm(vacancy.get("title") or "")
                org = vacancy.get("company") or {}
                data["company"] = _clean_company_name(org.get("name") if isinstance(org, dict) else str(org or ""))
                place = vacancy.get("place") or vacancy.get("location") or {}
                if isinstance(place, dict):
                    loc_parts = [place.get("city"), place.get("canton"), place.get("country")]
                    data["location"] = ", ".join(p for p in loc_parts if p)
                else:
                    data["location"] = _norm(str(place or ""))
                data["description"] = _norm(BeautifulSoup(vacancy.get("descriptionHtml") or vacancy.get("description") or "", "html.parser").get_text(" ", strip=True))
                data["employment_type"] = _norm(str(vacancy.get("workload") or vacancy.get("employmentType") or ""))
                data["date_posted"] = _norm(str(vacancy.get("publicationDate") or ""))
                if data.get("title"):
                    return data
        except Exception:
            pass

    # DOM elements via data-cy and attributes
    title_el = (
        soup.find(attrs={"data-cy": "job-title"})
        or soup.find(attrs={"data-cy": "vacancy-title"})
        or soup.find("h1")
    )
    if title_el:
        t = _norm(title_el.get_text(" ", strip=True))
        t = re.sub(r"\s*[-|·]\s*(?:jobs\.ch|jobup\.ch|jobup).*$", "", t, flags=re.I)
        data["title"] = t

    comp_el = (
        soup.find(attrs={"data-cy": "company-name"})
        or soup.find(attrs={"data-cy": "company-link"})
        or soup.find("strong", attrs={"data-cy": "company-name"})
    )
    if comp_el:
        data["company"] = _clean_company_name(comp_el.get_text(" ", strip=True))

    loc_el = (
        soup.find(attrs={"data-cy": "job-location"})
        or soup.find(attrs={"data-cy": "location"})
        or soup.find("span", attrs={"data-cy": "job-location"})
    )
    if loc_el:
        data["location"] = _norm(loc_el.get_text(" ", strip=True))

    workload_el = soup.find(attrs={"data-cy": "job-workload"}) or soup.find(attrs={"data-cy": "workload"})
    if workload_el:
        data["employment_type"] = _norm(workload_el.get_text(" ", strip=True))

    desc_el = (
        soup.find(attrs={"data-cy": "job-description"})
        or soup.find(attrs={"data-cy": "vacancy-description"})
        or soup.find("div", class_=re.compile(r"vacancy-description|job-detail-description", re.I))
    )
    if desc_el:
        data["description"] = _norm(desc_el.get_text(" ", strip=True))[:50000]

    return data if data.get("title") else None


def parse_jobsch_listing_leads(url: str, soup: BeautifulSoup) -> list[dict]:
    """Extract individual job cards from jobs.ch or jobup.ch listings."""
    leads = []
    cards = soup.find_all(attrs={"data-cy": "job-card"}) or soup.find_all(attrs={"data-cy": "vacancy-card"})
    if not cards:
        cards = soup.find_all("article", class_=re.compile(r"job-card|vacancy", re.I))

    for card in cards:
        title_el = card.find(attrs={"data-cy": "job-title"}) or card.find(["h2", "h3"])
        link_el = card.find(attrs={"data-cy": "job-link"}) or card.find("a", href=re.compile(r"/detail/|/vacancies/|/offres-emploi/", re.I)) or card.find("a", href=True)
        comp_el = card.find(attrs={"data-cy": "company-name"})
        loc_el = card.find(attrs={"data-cy": "job-location"})

        title = _norm(title_el.get_text(" ", strip=True)) if title_el else ""
        href = link_el.get("href", "") if link_el else ""
        company = _clean_company_name(comp_el.get_text(" ", strip=True)) if comp_el else ""
        location = _norm(loc_el.get_text(" ", strip=True)) if loc_el else ""

        if title and href:
            leads.append({
                "title": title,
                "href": href,
                "company": company,
                "location": location,
            })
    return leads


# =============================================================================
# 3. IAGORA SPECIALIZED CONNECTOR (INTERNSHIPS & EUROPE)
# =============================================================================

def parse_iagora_job(url: str, soup: BeautifulSoup, html: str) -> dict | None:
    """Parse iAgora international internship offer."""
    data = {}

    title_el = (
        soup.find("h1", class_=re.compile(r"m-job-detail__title|job-title|offer-title", re.I))
        or soup.find("h1")
    )
    if title_el:
        t = _norm(title_el.get_text(" ", strip=True))
        t = re.sub(r"\s*[-|]\s*iAgora.*$", "", t, flags=re.I)
        data["title"] = t

    comp_el = (
        soup.find("div", class_=re.compile(r"m-job-detail__company|company-name", re.I))
        or soup.find("a", href=re.compile(r"/work/(?:en|fr)/companies/", re.I))
    )
    if comp_el:
        data["company"] = _clean_company_name(comp_el.get_text(" ", strip=True))

    loc_el = soup.find("div", class_=re.compile(r"m-job-detail__location|job-location", re.I))
    if loc_el:
        data["location"] = _norm(loc_el.get_text(" ", strip=True))

    specs_el = soup.find("div", class_=re.compile(r"m-job-detail__specs|job-specs", re.I))
    if specs_el:
        data["employment_type"] = _norm(specs_el.get_text(" ", strip=True))

    desc_el = (
        soup.find("div", class_=re.compile(r"m-job-detail__description|job-description|offer-description", re.I))
        or soup.find("div", class_="content-body")
    )
    if desc_el:
        data["description"] = _norm(desc_el.get_text(" ", strip=True))[:50000]

    return data if data.get("title") else None


def parse_iagora_listing_leads(url: str, soup: BeautifulSoup) -> list[dict]:
    """Extract leads from iAgora internship catalog."""
    leads = []
    cards = soup.find_all("div", class_=re.compile(r"m-job-card|job-item|offer-card", re.I))
    for card in cards:
        title_el = card.find(class_=re.compile(r"m-job-card__title|job-title|offer-title", re.I)) or card.find(["h2", "h3"])
        link_el = card.find("a", href=re.compile(r"/work/(?:en|fr)/(?:internships|jobs)/", re.I)) or card.find("a", href=True)
        comp_el = card.find(class_=re.compile(r"m-job-card__company|company", re.I))
        loc_el = card.find(class_=re.compile(r"m-job-card__location|location", re.I))

        title = _norm(title_el.get_text(" ", strip=True)) if title_el else ""
        href = link_el.get("href", "") if link_el else ""
        company = _clean_company_name(comp_el.get_text(" ", strip=True)) if comp_el else ""
        location = _norm(loc_el.get_text(" ", strip=True)) if loc_el else ""

        if title and href:
            leads.append({
                "title": title,
                "href": href,
                "company": company,
                "location": location,
            })
    return leads


# =============================================================================
# 4. GLASSDOOR SPECIALIZED CONNECTOR
# =============================================================================

def parse_glassdoor_job(url: str, soup: BeautifulSoup, html: str) -> dict | None:
    """Parse Glassdoor job posting with star ratings cleaned."""
    data = {}

    title_el = soup.find(attrs={"data-test": "job-title"}) or soup.find("h1")
    if title_el:
        t = _norm(title_el.get_text(" ", strip=True))
        t = re.sub(r"\s*[-|]\s*Glassdoor.*$", "", t, flags=re.I)
        t_low = t.lower()
        if any(w in t_low for w in ("salaires annuels", "salaire pour le poste", "avis des employés", "employee reviews", "interview questions")):
            return None
        data["title"] = t

    comp_el = soup.find(attrs={"data-test": "employer-name"}) or soup.find("h4", class_=re.compile(r"employer", re.I))
    if comp_el:
        data["company"] = _clean_company_name(comp_el.get_text(" ", strip=True))

    loc_el = soup.find(attrs={"data-test": "location"}) or soup.find("span", attrs={"data-test": "location"})
    if loc_el:
        data["location"] = _norm(loc_el.get_text(" ", strip=True))

    desc_el = soup.find(attrs={"data-test": "jobDescription"}) or soup.find("div", id="JobDescriptionContainer")
    if desc_el:
        data["description"] = _norm(desc_el.get_text(" ", strip=True))[:50000]

    return data if data.get("title") else None


def parse_glassdoor_listing_leads(url: str, soup: BeautifulSoup) -> list[dict]:
    """Extract leads from Glassdoor job search pages."""
    leads = []
    cards = soup.find_all(attrs={"data-test": "jobListing"}) or soup.find_all("li", class_=re.compile(r"react-job-listing", re.I))
    for card in cards:
        title_el = card.find(attrs={"data-test": "job-title"}) or card.find("a", attrs={"data-test": "job-link"}) or card.find(["h3", "h4"])
        link_el = card.find("a", attrs={"data-test": "job-link"}) or card.find("a", href=re.compile(r"/job-listing/|/partner/jobListing", re.I)) or card.find("a", href=True)
        comp_el = card.find(attrs={"data-test": "employer-short-name"}) or card.find(class_=re.compile(r"employerName|job-search-card__subtitle", re.I))
        loc_el = card.find(attrs={"data-test": "emp-location"})

        title = _norm(title_el.get_text(" ", strip=True)) if title_el else ""
        href = link_el.get("href", "") if link_el else ""
        company = _clean_company_name(comp_el.get_text(" ", strip=True)) if comp_el else ""
        location = _norm(loc_el.get_text(" ", strip=True)) if loc_el else ""

        if title and href:
            t_low = title.lower()
            h_low = href.lower()
            if any(w in t_low for w in ("salaires", "salaire", "avis des", "salary", "employee review", "reviews for", "questions d'entretien")):
                continue
            if any(w in h_low for w in ("/salaires", "/salaire", "/cmp/", "/reviews", "/salaries", "/overview")):
                continue
            leads.append({
                "title": title,
                "href": href,
                "company": company,
                "location": location,
            })
    return leads


# =============================================================================
# 5. INDEED SPECIALIZED CONNECTOR
# =============================================================================

def parse_indeed_job(url: str, soup: BeautifulSoup, html: str) -> dict | None:
    """Parse Indeed job posting."""
    data = {}

    title_el = (
        soup.find(class_=re.compile(r"jobsearch-JobInfoHeader-title", re.I))
        or soup.find("h1", class_=re.compile(r"jobsearch-JobInfoHeader", re.I))
        or soup.find("h1")
    )
    if title_el:
        t = _norm(title_el.get_text(" ", strip=True))
        t = re.sub(r"\s*[-|]\s*Indeed.*$", "", t, flags=re.I)
        t_low = t.lower()
        if any(w in t_low for w in ("salaires annuels", "salaire pour le poste", "avis des employés", "employee reviews", "interview questions")):
            return None
        data["title"] = t

    comp_el = (
        soup.find(attrs={"data-company-name": "true"})
        or soup.find(class_=re.compile(r"jobsearch-CompanyInfoContainer|companyName", re.I))
        or soup.find("div", attrs={"data-testid": "inlineHeader-companyName"})
    )
    if comp_el:
        data["company"] = _clean_company_name(comp_el.get_text(" ", strip=True))

    loc_el = (
        soup.find(attrs={"data-testid": "inlineHeader-companyLocation"})
        or soup.find(attrs={"data-testid": "job-location"})
        or soup.find("div", class_=re.compile(r"companyLocation", re.I))
    )
    if loc_el:
        data["location"] = _norm(loc_el.get_text(" ", strip=True))

    desc_el = soup.find(id="jobDescriptionText") or soup.find(class_=re.compile(r"jobsearch-jobDescriptionText", re.I))
    if desc_el:
        data["description"] = _norm(desc_el.get_text(" ", strip=True))[:50000]

    return data if data.get("title") else None


def parse_indeed_listing_leads(url: str, soup: BeautifulSoup) -> list[dict]:
    """Extract leads from Indeed search pages with direct viewjob URLs."""
    leads = []
    cards = soup.find_all(class_=re.compile(r"job_seen_beacon|jobCard_mainContent|resultContent", re.I))
    for card in cards:
        title_el = card.find(class_=re.compile(r"jcs-JobTitle|jobTitle", re.I)) or card.find(["h2", "h3"])
        link_el = card.find("a", attrs={"data-jk": True}) or card.find("a", href=re.compile(r"/viewjob|/rc/clk", re.I)) or card.find("a", href=True)
        comp_el = card.find(attrs={"data-testid": "company-name"}) or card.find(class_=re.compile(r"companyName|company_location", re.I))
        loc_el = card.find(attrs={"data-testid": "text-location"}) or card.find(class_=re.compile(r"companyLocation", re.I))

        title = _norm(title_el.get_text(" ", strip=True)) if title_el else ""
        href = link_el.get("href", "") if link_el else ""
        company = _clean_company_name(comp_el.get_text(" ", strip=True)) if comp_el else ""
        location = _norm(loc_el.get_text(" ", strip=True)) if loc_el else ""

        if title and href:
            t_low = title.lower()
            h_low = href.lower()
            if any(w in t_low for w in ("salaires", "salaire", "avis des", "salary", "employee review", "reviews for", "questions d'entretien")):
                continue
            if any(w in h_low for w in ("/salaires", "/salaire", "/cmp/", "/reviews", "/salaries", "/career-advice")):
                continue

            # Resolve direct viewjob URL if job key (jk) is present
            jk = link_el.get("data-jk", "") if link_el else ""
            if not jk and href:
                m_jk = re.search(r"[?&]jk=([a-zA-Z0-9]+)", href)
                if m_jk:
                    jk = m_jk.group(1)
            if jk:
                p_base = urlparse(url)
                href = f"https://{p_base.netloc}/viewjob?jk={jk}"

            leads.append({
                "title": title,
                "href": href,
                "company": company,
                "location": location,
            })
    return leads


# =============================================================================
# 6. JOBTEASER & UNIVERSITY CAREER PORTALS
# =============================================================================

def parse_jobteaser_job(url: str, soup: BeautifulSoup, html: str) -> dict | None:
    """Parse JobTeaser internship offer."""
    data = {}

    title_el = soup.find("h1", class_=re.compile(r"JobOfferDetailsHeader|job-title", re.I)) or soup.find("h1")
    if title_el:
        t = _norm(title_el.get_text(" ", strip=True))
        t = re.sub(r"\s*[-|]\s*JobTeaser.*$", "", t, flags=re.I)
        data["title"] = t

    comp_el = soup.find(class_=re.compile(r"JobOfferDetailsHeader__company|company-name", re.I)) or soup.find("a", href=re.compile(r"/companies/", re.I))
    if comp_el:
        data["company"] = _clean_company_name(comp_el.get_text(" ", strip=True))

    loc_el = soup.find(class_=re.compile(r"JobOfferDetailsHeader__location|location", re.I))
    if loc_el:
        data["location"] = _norm(loc_el.get_text(" ", strip=True))

    desc_el = soup.find(class_=re.compile(r"JobOfferDetailsDescription|job-description", re.I))
    if desc_el:
        data["description"] = _norm(desc_el.get_text(" ", strip=True))[:50000]

    return data if data.get("title") else None


def parse_jobteaser_listing_leads(url: str, soup: BeautifulSoup) -> list[dict]:
    """Extract leads from JobTeaser listing."""
    leads = []
    cards = soup.find_all(class_=re.compile(r"JobOfferCard|job-card", re.I))
    for card in cards:
        title_el = card.find(class_=re.compile(r"title", re.I)) or card.find(["h2", "h3"])
        link_el = card.find("a", href=re.compile(r"/job-offers/|/offres-d-emploi/", re.I)) or card.find("a", href=True)
        comp_el = card.find(class_=re.compile(r"company", re.I))
        loc_el = card.find(class_=re.compile(r"location", re.I))

        title = _norm(title_el.get_text(" ", strip=True)) if title_el else ""
        href = link_el.get("href", "") if link_el else ""
        company = _clean_company_name(comp_el.get_text(" ", strip=True)) if comp_el else ""
        location = _norm(loc_el.get_text(" ", strip=True)) if loc_el else ""

        if title and href:
            leads.append({
                "title": title,
                "href": href,
                "company": company,
                "location": location,
            })
    return leads


# =============================================================================
# UNIFIED DISPATCHERS
# =============================================================================

def parse_specialized_job_posting(url: str, html: str) -> dict | None:
    """Dispatches to the specialized parser based on URL domain."""
    if not html or not url:
        return None
    platform = get_platform_name(url)
    if platform == "generic":
        return None

    soup = BeautifulSoup(html, "html.parser")
    result = None

    if platform == "linkedin":
        result = parse_linkedin_job(url, soup, html)
    elif platform == "jobs_ch":
        result = parse_jobsch_job(url, soup, html)
    elif platform == "iagora":
        result = parse_iagora_job(url, soup, html)
    elif platform == "glassdoor":
        result = parse_glassdoor_job(url, soup, html)
    elif platform == "indeed":
        result = parse_indeed_job(url, soup, html)
    elif platform == "jobteaser":
        result = parse_jobteaser_job(url, soup, html)

    if result:
        result["source_platform"] = platform
        result.setdefault("job_url", url)
    return result


def extract_specialized_listing_leads(url: str, html: str) -> list[dict]:
    """Dispatches to the specialized listing cards parser based on URL domain."""
    if not html or not url:
        return []
    platform = get_platform_name(url)
    if platform == "generic":
        return []

    soup = BeautifulSoup(html, "html.parser")
    leads = []

    if platform == "linkedin":
        leads = parse_linkedin_listing_leads(url, soup)
    elif platform == "jobs_ch":
        leads = parse_jobsch_listing_leads(url, soup)
    elif platform == "iagora":
        leads = parse_iagora_listing_leads(url, soup)
    elif platform == "glassdoor":
        leads = parse_glassdoor_listing_leads(url, soup)
    elif platform == "indeed":
        leads = parse_indeed_listing_leads(url, soup)
    elif platform == "jobteaser":
        leads = parse_jobteaser_listing_leads(url, soup)

    return leads

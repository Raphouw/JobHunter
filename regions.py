"""
Regions Module for Job Hunter (Job Hunter v6)
Provides geographical region, canton, département and metropolitan hub detection
adapted to the searched countries (Switzerland, France, Belgium, Germany, Canada, UK).
"""

from __future__ import annotations
import re
import unicodedata
import json
import math
from functools import lru_cache
from pathlib import Path


def fold_text(text: str) -> str:
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", str(text))
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.lower().strip()


# Switzerland Cantons (26 cantons with language & main cities)
SWISS_CANTONS = {
    'AR': ('Appenzell Rhodes-Extérieures', 'AL', ['appenzell ausserrhoden', 'appenzell rhodes-extérieures', 'herisau']),
    'AI': ('Appenzell Rhodes-Intérieures', 'AL', ['appenzell innerrhoden', 'appenzell rhodes-intérieures', 'appenzell']),
    'AG': ('Argovie', 'AL', ['aargau', 'argovie', 'aarau', 'baden', 'brugg', 'wettingen']),
    'BL': ('Bâle-Campagne', 'AL', ['basel-landschaft', 'bâle-campagne', 'liestal', 'allschwil']),
    'BS': ('Bâle-Ville', 'AL', ['basel-stadt', 'bâle-ville', 'basel', 'bâle', 'riehen']),
    'BE': ('Berne', 'AL/FR', ['bern', 'berne', 'biel', 'bienne', 'thun', 'thoune']),
    'FR': ('Fribourg', 'FR/AL', ['fribourg', 'freiburg', 'bulle', 'villars-sur-glâne']),
    'GE': ('Genève', 'FR', ['genève', 'geneve', 'geneva', 'meyrin', 'vernier', 'lancy', 'carouge']),
    'GL': ('Glaris', 'AL', ['glarus', 'glaris']),
    'GR': ('Grisons', 'AL/RM/IT', ['graubünden', 'grisons', 'grigioni', 'chur', 'coire', 'davos']),
    'JU': ('Jura', 'FR', ['jura', 'delémont', 'porrentruy']),
    'LU': ('Lucerne', 'AL', ['luzern', 'lucerne', 'emmen', 'kriens']),
    'NE': ('Neuchâtel', 'FR', ['neuchâtel', 'neuchatel', 'la chaux-de-fonds', 'le locle']),
    'NW': ('Nidwald', 'AL', ['nidwalden', 'nidwald', 'stans']),
    'OW': ('Obwald', 'AL', ['obwalden', 'obwald', 'sarnen']),
    'SG': ('Saint-Gall', 'AL', ['st. gallen', 'saint-gall', 'sankt gallen', 'rapperswil']),
    'SH': ('Schaffhouse', 'AL', ['schaffhausen', 'schaffhouse', 'neuhausen']),
    'SZ': ('Schwytz', 'AL', ['schwyz', 'schwytz', 'freienbach', 'einsiedeln']),
    'SO': ('Soleure', 'AL', ['solothurn', 'soleure', 'olten', 'grenchen']),
    'TG': ('Thurgovie', 'AL', ['thurgau', 'thurgovie', 'frauenfeld', 'kreuzlingen']),
    'TI': ('Tessin', 'IT', ['ticino', 'tessin', 'lugano', 'bellinzona', 'locarno', 'mendrisio']),
    'UR': ('Uri', 'AL', ['uri', 'altdorf']),
    'VS': ('Valais', 'FR/AL', ['valais', 'wallis', 'sion', 'sierre', 'martigny', 'brig', 'visp']),
    'VD': ('Vaud', 'FR', ['vaud', 'lausanne', 'yverdon', 'nyon', 'renens', 'ecublens', 'morges', 'vevey', 'montreux']),
    'ZG': ('Zoug', 'AL', ['zug', 'zoug', 'rotkreuz', 'baar']),
    'ZH': ('Zurich', 'AL', ['zurich', 'zürich', 'winterthur', 'dübendorf', 'uster', 'dietikon'])
}

# France: 13 regions + major départements & industrial/tech hubs
FRENCH_REGIONS = {
    'ARA': ('Auvergne-Rhône-Alpes', '69/38/74', [
        'auvergne-rhône-alpes', 'auvergne-rhone-alpes', 'rhône-alpes', 'lyon', 'grenoble', 'saint-étienne',
        'clermont-ferrand', 'annecy', 'chambéry', 'valence', 'villeurbanne', 'haute-savoie', 'savoie',
        'rhône', 'isère', 'ain', 'loire', 'drôme', 'puy-de-dôme', '74', '73', '69', '38', '01', '42', '26', '63'
    ]),
    'IDF': ('Île-de-France', '75/92/93', [
        'île-de-france', 'ile-de-france', 'paris', 'hauts-de-seine', 'seine-saint-denis', 'val-de-marne',
        'seine-et-marne', 'yvelines', 'essonne', 'val-d-oise', '75', '92', '93', '94', '77', '78', '91', '95',
        'boulogne-billancourt', 'nanterre', 'créteil', 'versailles', 'saclay', 'massy', 'cergy'
    ]),
    'PACA': ('Provence-Alpes-Côte d’Azur', '13/06/83', [
        'provence-alpes-côte d’azur', 'provence-alpes-cote d\'azur', 'paca', 'marseille', 'nice', 'toulon',
        'aix-en-provence', 'avignon', 'cannes', 'antibes', 'sophia antipolis', 'bouches-du-rhône',
        'alpes-maritimes', 'var', 'vaucluse', '13', '06', '83', '84'
    ]),
    'OCC': ('Occitanie', '31/34', [
        'occitanie', 'toulouse', 'montpellier', 'nîmes', 'perpignan', 'béziers', 'blagnac', 'labège',
        'albi', 'castres', 'montauban', 'tarbes', 'auch', 'rodez', 'carcassonne', 'narbonne',
        'foix', 'cahors', 'mende', 'sète', 'lourdes', 'agde',
        'haute-garonne', 'hérault', 'gard', 'pyrénées-orientales', 'aude', 'ariège', 'aveyron',
        'gers', 'lot', 'lozère', 'hautes-pyrénées', 'tarn', 'tarn-et-garonne',
        '09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'
    ]),
    'NAQ': ('Nouvelle-Aquitaine', '33/64', [
        'nouvelle-aquitaine', 'bordeaux', 'limoges', 'poitiers', 'pau', 'la rochelle', 'mérignac', 'pessac',
        'gironde', 'pyrénées-atlantiques', 'charente-maritime', 'vienne', '33', '64', '17', '86'
    ]),
    'GES': ('Grand Est', '67/68/54', [
        'grand est', 'strasbourg', 'reims', 'metz', 'mulhouse', 'nancy', 'bas-rhin', 'haut-rhin',
        'marne', 'moselle', 'meurthe-et-moselle', '67', '68', '51', '57', '54'
    ]),
    'HDF': ('Hauts-de-France', '59/62', [
        'hauts-de-france', 'lille', 'amiens', 'roubaix', 'tourcoing', 'dunkerque', 'villeneuve-d\'ascq',
        'nord', 'pas-de-calais', 'somme', '59', '62', '80'
    ]),
    'PDL': ('Pays de la Loire', '44/49', [
        'pays de la loire', 'nantes', 'angers', 'le mans', 'saint-nazaire', 'loire-atlantique',
        'maine-et-loire', 'sarthe', 'vendée', '44', '49', '72', '85'
    ]),
    'BRE': ('Bretagne', '35/29', [
        'bretagne', 'rennes', 'brest', 'quimper', 'lorient', 'vannes', 'cesson-sévigné',
        'ille-et-vilaine', 'finistère', 'morbihan', 'côtes-d\'armor', '35', '29', '56', '22'
    ]),
    'BFC': ('Bourgogne-Franche-Comté', '21/25/90', [
        'bourgogne-franche-comté', 'bourgogne-franche-comte', 'dijon', 'besançon', 'belfort', 'montbéliard',
        'chalon-sur-saône', 'côte-d\'or', 'doubs', 'territoire de belfort', 'saône-et-loire', '21', '25', '90', '71'
    ]),
    'NOR': ('Normandie', '76/14', [
        'normandie', 'rouen', 'le havre', 'caen', 'cherbourg', 'seine-maritime', 'calvados', 'eure', '76', '14', '27'
    ]),
    'CVL': ('Centre-Val de Loire', '45/37', [
        'centre-val de loire', 'orléans', 'tours', 'bourges', 'blois', 'chartres', 'loiret', 'indre-et-loire', '45', '37'
    ]),
    'COR': ('Corse', '2A/2B', [
        'corse', 'ajaccio', 'bastia', 'corse-du-sud', 'haute-corse', '2a', '2b'
    ]),
}

# Belgium
BELGIAN_REGIONS = {
    'BRU': ('Bruxelles-Capitale', 'BRU', ['bruxelles', 'brussel', 'brussels', 'etterbeek', 'ixelles', 'anderlecht']),
    'WAL': ('Wallonie', 'WAL', ['wallonie', 'wallonia', 'liège', 'liege', 'namur', 'charleroi', 'mons', 'louvain-la-neuve', 'wavre', 'tournai', 'brabant wallon']),
    'VLA': ('Flandre', 'VLA', ['flandre', 'flanders', 'vlaanderen', 'antwerpen', 'anvers', 'gent', 'gand', 'leuven', 'louvain', 'brugge', 'bruges'])
}

# Germany
GERMAN_REGIONS = {
    'BY': ('Bayern', 'BY', ['bayern', 'bavaria', 'bavière', 'münchen', 'munich', 'nürnberg', 'augsburg', 'erlangen', 'regensburg', 'ingolstadt']),
    'BW': ('Baden-Württemberg', 'BW', ['baden-württemberg', 'baden-wurttemberg', 'stuttgart', 'karlsruhe', 'mannheim', 'freiburg', 'heidelberg', 'ulm']),
    'BE': ('Berlin', 'BER', ['berlin']),
    'NW': ('Nordrhein-Westfalen', 'NW', ['nordrhein-westfalen', 'north rhine-westphalia', 'köln', 'cologne', 'düsseldorf', 'dortmund', 'essen', 'aachen', 'bonn']),
    'HE': ('Hessen', 'HE', ['hessen', 'hesse', 'frankfurt', 'wiesbaden', 'darmstadt', 'kassel']),
    'SN': ('Sachsen', 'SN', ['sachsen', 'saxony', 'dresden', 'leipzig']),
    'HH': ('Hamburg', 'HH', ['hamburg'])
}

# Canada
CANADIAN_REGIONS = {
    'QC': ('Québec', 'QC', ['québec', 'quebec', 'montréal', 'montreal', 'laval', 'gatineau', 'sherbrooke']),
    'ON': ('Ontario', 'ON', ['ontario', 'toronto', 'ottawa', 'mississauga', 'waterloo', 'kitchener'])
}

# UK
UK_REGIONS = {
    'LDN': ('Greater London', 'LDN', ['london', 'londres', 'greater london']),
    'SCO': ('Scotland', 'SCO', ['scotland', 'écosse', 'edinburgh', 'glasgow', 'aberdeen']),
    'ENG': ('England', 'ENG', ['england', 'manchester', 'birmingham', 'cambridge', 'oxford', 'bristol', 'leeds'])
}

COUNTRY_REGIONS_MAP = {
    'switzerland': (SWISS_CANTONS, 'CH'),
    'france': (FRENCH_REGIONS, 'FR'),
    'belgium': (BELGIAN_REGIONS, 'BE'),
    'germany': (GERMAN_REGIONS, 'DE'),
    'canada': (CANADIAN_REGIONS, 'CA'),
    'united kingdom': (UK_REGIONS, 'UK'),
}

CITY_COUNTRY_FILES = {
    'france': 'FR', 'switzerland': 'CH', 'belgium': 'BE',
    'germany': 'DE', 'italy': 'IT', 'spain': 'ES', 'luxembourg': 'LU',
}


def city_key(value: str) -> str:
    """Use the same accent- and punctuation-free keys as the map city indexes."""
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', fold_text(value))).strip()


@lru_cache(maxsize=7)
def city_index(country: str) -> dict:
    code = CITY_COUNTRY_FILES.get(country)
    if not code:
        return {}
    root = Path(__file__).resolve().parent
    path = (root / 'config' / 'france_communes_coordinates.json' if country == 'france'
            else root / 'web' / 'public' / 'cities' / f'{code}.json')
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def city_coordinates(location: str, country: str) -> tuple[float, float] | None:
    """Resolve a city from a declared location; never guess a region centroid."""
    index = city_index(country)
    if not index:
        return None
    first = re.split(r'[,;|]|\s+[–—-]\s+', str(location or ''), maxsplit=1)[0]
    first = re.sub(r'\([^)]*\)', ' ', first)
    first = re.sub(r'^\s*\d{4,5}\s+', '', first)
    first = re.sub(r'\s+\d{4,5}\s*$', '', first)
    point = index.get(city_key(first))
    if country == 'france' and isinstance(point, list):
        postal = re.search(r'(?<!\d)\d{5}(?!\d)', str(location or ''))
        department = postal.group()[:2] if postal else ''
        if not department:
            match = re.search(r'(?<!\w)(?:0[1-9]|[1-8]\d|9[0-5]|2[ab])(?!\w)', fold_text(location))
            department = match.group() if match else ''
        if department:
            matches = [candidate for candidate in point if fold_text(candidate[2]) == department]
            if not matches:
                return None
            point = matches[0]
        if point and isinstance(point[0], list):
            if len(point) == 1 or (point[0][3] >= 5000 and point[0][3] >= point[1][3] * 5):
                point = point[0]
            else:
                return None
    if not isinstance(point, list) or len(point) < 2 or isinstance(point[0], list):
        return None
    return float(point[0]), float(point[1])


def city_distance_km(origin: str, destination: str, countries: list[str]) -> float | None:
    for country in countries:
        start = city_coordinates(origin, country)
        end = city_coordinates(destination, country)
        if start and end:
            lat1, lon1, lat2, lon2 = map(math.radians, (*start, *end))
            angle = 2 * math.asin(math.sqrt(
                math.sin((lat2 - lat1) / 2) ** 2 +
                math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
            ))
            return 6371.0088 * angle
    return None


def detect_country_region(location_sources: list[str], target_country_keys: list[str], profile_custom_regions: list[dict] = None) -> tuple[str, str] | None:
    """
    Detects the matching region and term from location sources.
    Respects profile custom regions first, then target countries in order.
    Returns (formatted_region_string, detected_term) or None.
    """
    # 1. Custom regions defined in the profile take first priority
    if profile_custom_regions:
        for source in location_sources:
            matches = []
            for region in profile_custom_regions:
                aliases = region.get('aliases') or [region.get('name', '')]
                for alias in aliases:
                    if not alias:
                        continue
                    m = re.search(r'(?<!\w)' + re.escape(fold_text(alias)) + r'(?!\w)', fold_text(source))
                    if m:
                        matches.append((m.start(), region, alias))
                        break
            if matches:
                _, region, alias = min(matches, key=lambda x: x[0])
                parts = [region.get('name', ''), region.get('code', ''), region.get('languages', '')]
                formatted = ' | '.join(x for x in parts if x)
                return formatted, alias

    # 2. Match based on configured countries
    ordered_countries = list(target_country_keys)
    if not ordered_countries:
        ordered_countries = ['switzerland', 'france', 'belgium', 'germany']

    for country in ordered_countries:
        if country not in COUNTRY_REGIONS_MAP:
            continue
        catalog, country_code = COUNTRY_REGIONS_MAP[country]
        for source in location_sources:
            matches = []
            for code, (name, extra, terms) in catalog.items():
                for term in terms:
                    m = re.search(r'(?<!\w)' + re.escape(fold_text(term)) + r'(?!\w)', fold_text(source))
                    if m:
                        matches.append((m.start(), code, name, extra, term))
                        break
            if matches:
                _, code, name, extra, term = min(matches, key=lambda x: x[0])
                if country == 'switzerland':
                    formatted = f"{name} | {code} | {extra}"
                else:
                    formatted = f"{name} | {extra} | {country_code}"
                return formatted, term

    return None

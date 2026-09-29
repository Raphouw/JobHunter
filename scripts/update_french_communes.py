"""Refresh the offline commune centers used by scan distance filtering.

Source: https://geo.api.gouv.fr/decoupage-administratif/communes
The generated file is committed so scans never depend on this API at runtime.
"""

import json
import re
import unicodedata
import urllib.request
from pathlib import Path


SOURCE = 'https://geo.api.gouv.fr/communes?fields=nom,code,codeDepartement,centre,population&format=json'
DESTINATION = Path(__file__).resolve().parents[1] / 'config' / 'france_communes_coordinates.json'


def key(value):
    folded = unicodedata.normalize('NFKD', value.lower())
    ascii_text = ''.join(letter for letter in folded if not unicodedata.combining(letter))
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', ascii_text)).strip()


def main():
    with urllib.request.urlopen(SOURCE, timeout=45) as response:
        communes = json.load(response)
    cities = {}
    for commune in communes:
        coordinates = (commune.get('centre') or {}).get('coordinates') or []
        if len(coordinates) != 2:
            continue
        city = key(commune.get('nom') or '')
        if not city:
            continue
        longitude, latitude = coordinates
        cities.setdefault(city, []).append([
            latitude, longitude, commune.get('codeDepartement') or '', commune.get('population') or 0,
        ])
    for rows in cities.values():
        rows.sort(key=lambda row: row[3], reverse=True)
    DESTINATION.write_text(json.dumps(cities, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(cities)} noms de communes enregistrés dans {DESTINATION}')


if __name__ == '__main__':
    main()

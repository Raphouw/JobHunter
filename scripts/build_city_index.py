"""Convert the supplied city coordinate files into small, country-specific map indexes."""

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "web" / "public" / "cities"
SOURCES = {
    "BE": "belgian_cities.js",
    "FR": "france_cities.js",
    "DE": "german_cities.js",
    "IT": "italian_cities.js",
    "LU": "luxembourg_cities.js",
    "ES": "spanish_cities.js",
    "CH": "Swiss_cities.js",
}
ENTRY = re.compile(r'"([^"]+)"\s*:\s*\{\s*"?lat"?\s*:\s*(-?[\d.]+)\s*,\s*"?lng"?\s*:\s*(-?[\d.]+)', re.S)


def normalize(value):
    value = unicodedata.normalize("NFD", value.lower())
    value = "".join(letter for letter in value if unicodedata.category(letter) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value)).strip()


def build():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for country, filename in SOURCES.items():
        source = (ROOT / "Cities" / filename).read_text(encoding="utf-8")
        cities = {}
        for name, raw_lat, raw_lng in ENTRY.findall(source):
            key = normalize(name)
            lat, lng = float(raw_lat), float(raw_lng)
            if key and -90 <= lat <= 90 and -180 <= lng <= 180:
                cities.setdefault(key, [round(lat, 4), round(lng, 4)])
        if not cities:
            raise ValueError(f"Aucune ville reconnue dans {filename}")
        (OUTPUT / f"{country}.json").write_text(
            json.dumps(cities, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        print(f"{country}: {len(cities)} villes")


if __name__ == "__main__":
    build()

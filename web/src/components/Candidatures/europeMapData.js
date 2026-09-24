// Western Europe Regions, Countries & Geocoding Dataset
// Covers Switzerland, France, Germany, Belgium, Luxembourg, Italy, and Spain

export const WESTERN_EUROPE_BOUNDS = {
  minLng: -9.5,
  maxLng: 16.5,
  minLat: 35.5,
  maxLat: 55.0,
  svgWidth: 1000,
  svgHeight: 800,
};

// Mercator projection for Western Europe
export function projectGpsEurope(lat, lng, width = 1000, height = 800) {
  if (lat == null || lng == null) return null;
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (isNaN(numLat) || isNaN(numLng)) return null;

  const { minLng, maxLng, minLat, maxLat } = WESTERN_EUROPE_BOUNDS;
  const x = ((numLng - minLng) / (maxLng - minLng)) * width;

  const latRad = (numLat * Math.PI) / 180;
  const minLatRad = (minLat * Math.PI) / 180;
  const maxLatRad = (maxLat * Math.PI) / 180;

  const mercY = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const mercMin = Math.log(Math.tan(Math.PI / 4 + minLatRad / 2));
  const mercMax = Math.log(Math.tan(Math.PI / 4 + maxLatRad / 2));

  const y = height - ((mercY - mercMin) / (mercMax - mercMin)) * height;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

export const COUNTRIES = [
  { code: 'ALL', name: 'Europe de l’Ouest', flag: '🌍', viewBox: '0 0 1000 800', scale: 1, cx: 500, cy: 400 },
  { code: 'CH', name: 'Suisse', flag: '🇨🇭', viewBox: '560 280 200 160', scale: 4.0, cx: 650, cy: 350 },
  { code: 'FR', name: 'France', flag: '🇫🇷', viewBox: '320 180 340 330', scale: 2.2, cx: 490, cy: 340 },
  { code: 'DE', name: 'Allemagne', flag: '🇩🇪', viewBox: '600 70 320 300', scale: 2.4, cx: 760, cy: 220 },
  { code: 'BE', name: 'Belgique', flag: '🇧🇪', viewBox: '470 140 120 100', scale: 5.5, cx: 530, cy: 190 },
  { code: 'LU', name: 'Luxembourg', flag: '🇱🇺', viewBox: '560 190 70 60', scale: 8.0, cx: 595, cy: 220 },
  { code: 'IT', name: 'Italie', flag: '🇮🇹', viewBox: '620 330 320 350', scale: 2.2, cx: 770, cy: 500 },
  { code: 'ES', name: 'Espagne', flag: '🇪🇸', viewBox: '140 450 360 300', scale: 2.1, cx: 320, cy: 600 },
];

export const REGIONS_BY_COUNTRY = {
  CH: [
    { code: 'VD', name: 'Vaud', country: 'CH', flag: '🇨🇭', lat: 46.52, lng: 6.63 },
    { code: 'GE', name: 'Genève', country: 'CH', flag: '🇨🇭', lat: 46.20, lng: 6.14 },
    { code: 'ZH', name: 'Zurich', country: 'CH', flag: '🇨🇭', lat: 47.37, lng: 8.54 },
    { code: 'BE', name: 'Berne', country: 'CH', flag: '🇨🇭', lat: 46.94, lng: 7.44 },
    { code: 'FR', name: 'Fribourg', country: 'CH', flag: '🇨🇭', lat: 46.80, lng: 7.15 },
    { code: 'VS', name: 'Valais', country: 'CH', flag: '🇨🇭', lat: 46.23, lng: 7.36 },
    { code: 'NE', name: 'Neuchâtel', country: 'CH', flag: '🇨🇭', lat: 46.99, lng: 6.93 },
    { code: 'BS', name: 'Bâle', country: 'CH', flag: '🇨🇭', lat: 47.55, lng: 7.59 },
    { code: 'TI', name: 'Tessin', country: 'CH', flag: '🇨🇭', lat: 46.19, lng: 9.02 },
    { code: 'SG', name: 'Saint-Gall', country: 'CH', flag: '🇨🇭', lat: 47.42, lng: 9.37 },
    { code: 'LU', name: 'Lucerne', country: 'CH', flag: '🇨🇭', lat: 47.05, lng: 8.30 },
    { code: 'ZG', name: 'Zoug', country: 'CH', flag: '🇨🇭', lat: 47.16, lng: 8.51 },
    { code: 'JU', name: 'Jura', country: 'CH', flag: '🇨🇭', lat: 47.36, lng: 7.34 },
    { code: 'AG', name: 'Argovie', country: 'CH', flag: '🇨🇭', lat: 47.39, lng: 8.04 },
    { code: 'GR', name: 'Grisons', country: 'CH', flag: '🇨🇭', lat: 46.85, lng: 9.53 },
  ],
  FR: [
    { code: 'IDF', name: 'Île-de-France', country: 'FR', flag: '🇫🇷', lat: 48.85, lng: 2.35 },
    { code: 'ARA', name: 'Auvergne-Rhône-Alpes', country: 'FR', flag: '🇫🇷', lat: 45.76, lng: 4.83 },
    { code: 'PACA', name: 'Provence-Alpes-Côte d’Azur', country: 'FR', flag: '🇫🇷', lat: 43.52, lng: 5.44 },
    { code: 'OCC', name: 'Occitanie', country: 'FR', flag: '🇫🇷', lat: 43.60, lng: 1.44 },
    { code: 'NAQ', name: 'Nouvelle-Aquitaine', country: 'FR', flag: '🇫🇷', lat: 44.83, lng: -0.57 },
    { code: 'GES', name: 'Grand Est', country: 'FR', flag: '🇫🇷', lat: 48.57, lng: 7.75 },
    { code: 'HDF', name: 'Hauts-de-France', country: 'FR', flag: '🇫🇷', lat: 50.62, lng: 3.05 },
    { code: 'PDL', name: 'Pays de la Loire', country: 'FR', flag: '🇫🇷', lat: 47.21, lng: -1.55 },
    { code: 'BRE', name: 'Bretagne', country: 'FR', flag: '🇫🇷', lat: 48.11, lng: -1.67 },
    { code: 'BFC', name: 'Bourgogne-Franche-Comté', country: 'FR', flag: '🇫🇷', lat: 47.32, lng: 5.04 },
    { code: 'NOR', name: 'Normandie', country: 'FR', flag: '🇫🇷', lat: 49.44, lng: 1.09 },
    { code: 'CVL', name: 'Centre-Val de Loire', country: 'FR', flag: '🇫🇷', lat: 47.90, lng: 1.90 },
    { code: 'COR', name: 'Corse', country: 'FR', flag: '🇫🇷', lat: 42.03, lng: 9.01 },
  ],
  DE: [
    { code: 'BY', name: 'Bavière (Bayern)', country: 'DE', flag: '🇩🇪', lat: 48.13, lng: 11.58 },
    { code: 'BW', name: 'Bade-Wurtemberg', country: 'DE', flag: '🇩🇪', lat: 48.77, lng: 9.18 },
    { code: 'NW', name: 'Rhénanie-du-Nord-Westphalie', country: 'DE', flag: '🇩🇪', lat: 51.22, lng: 6.77 },
    { code: 'HE', name: 'Hesse (Frankfurt)', country: 'DE', flag: '🇩🇪', lat: 50.11, lng: 8.68 },
    { code: 'BE', name: 'Berlin', country: 'DE', flag: '🇩🇪', lat: 52.52, lng: 13.40 },
    { code: 'HH', name: 'Hambourg', country: 'DE', flag: '🇩🇪', lat: 53.55, lng: 9.99 },
    { code: 'SN', name: 'Saxe (Leipzig/Dresden)', country: 'DE', flag: '🇩🇪', lat: 51.05, lng: 13.73 },
    { code: 'NI', name: 'Basse-Saxe (Hannover)', country: 'DE', flag: '🇩🇪', lat: 52.37, lng: 9.73 },
    { code: 'RP', name: 'Rhénanie-Palatinat', country: 'DE', flag: '🇩🇪', lat: 49.99, lng: 8.27 },
  ],
  BE: [
    { code: 'BRU', name: 'Bruxelles-Capitale', country: 'BE', flag: '🇧🇪', lat: 50.85, lng: 4.35 },
    { code: 'VLA', name: 'Flandre (Antwerpen/Gent)', country: 'BE', flag: '🇧🇪', lat: 51.21, lng: 4.40 },
    { code: 'WAL', name: 'Wallonie (Liège/Namur/LLN)', country: 'BE', flag: '🇧🇪', lat: 50.63, lng: 5.57 },
  ],
  LU: [
    { code: 'LU', name: 'Luxembourg (Centre / Esch / Kirchberg)', country: 'LU', flag: '🇱🇺', lat: 49.61, lng: 6.13 },
  ],
  IT: [
    { code: 'LOM', name: 'Lombardie (Milano)', country: 'IT', flag: '🇮🇹', lat: 45.46, lng: 9.19 },
    { code: 'PIE', name: 'Piémont (Torino)', country: 'IT', flag: '🇮🇹', lat: 45.07, lng: 7.68 },
    { code: 'VEN', name: 'Vénétie (Venezia/Verona)', country: 'IT', flag: '🇮🇹', lat: 45.43, lng: 12.33 },
    { code: 'EMR', name: 'Émilie-Romagne (Bologna)', country: 'IT', flag: '🇮🇹', lat: 44.49, lng: 11.34 },
    { code: 'TOS', name: 'Toscane (Firenze)', country: 'IT', flag: '🇮🇹', lat: 43.76, lng: 11.25 },
    { code: 'LAZ', name: 'Latium (Roma)', country: 'IT', flag: '🇮🇹', lat: 41.90, lng: 12.49 },
  ],
  ES: [
    { code: 'MAD', name: 'Communauté de Madrid', country: 'ES', flag: '🇪🇸', lat: 40.41, lng: -3.70 },
    { code: 'CAT', name: 'Catalogne (Barcelona)', country: 'ES', flag: '🇪🇸', lat: 41.38, lng: 2.17 },
    { code: 'PVA', name: 'Pays basque (Bilbao/San Sebastián)', country: 'ES', flag: '🇪🇸', lat: 43.26, lng: -2.93 },
    { code: 'VAL', name: 'Valence (València)', country: 'ES', flag: '🇪🇸', lat: 39.46, lng: -0.37 },
    { code: 'AND', name: 'Andalousie (Sevilla/Málaga)', country: 'ES', flag: '🇪🇸', lat: 37.38, lng: -5.98 },
    { code: 'GAL', name: 'Galice (Vigo/A Coruña)', country: 'ES', flag: '🇪🇸', lat: 42.87, lng: -8.54 },
  ],
};

// Western Europe Stylized Regional Geometries (SVG Polygons on 1000x800 canvas)
export const EUROPE_REGIONS_GEO = [
  // --- SUISSE (CH) ---
  {
    id: 'CH-VD', code: 'VD', name: 'Vaud', country: 'CH', flag: '🇨🇭',
    path: 'M 605,350 L 625,345 L 638,358 L 628,372 L 610,368 L 600,358 Z',
    cx: 618, cy: 358,
  },
  {
    id: 'CH-GE', code: 'GE', name: 'Genève', country: 'CH', flag: '🇨🇭',
    path: 'M 596,366 L 606,364 L 608,375 L 598,378 L 594,372 Z',
    cx: 601, cy: 371,
  },
  {
    id: 'CH-ZH', code: 'ZH', name: 'Zurich', country: 'CH', flag: '🇨🇭',
    path: 'M 685,312 L 705,310 L 712,326 L 696,332 L 684,324 Z',
    cx: 696, cy: 320,
  },
  {
    id: 'CH-BE', code: 'BE', name: 'Berne', country: 'CH', flag: '🇨🇭',
    path: 'M 632,328 L 658,322 L 666,346 L 652,362 L 634,354 L 626,338 Z',
    cx: 645, cy: 342,
  },
  {
    id: 'CH-FR', code: 'FR', name: 'Fribourg', country: 'CH', flag: '🇨🇭',
    path: 'M 622,344 L 635,340 L 640,355 L 628,362 L 620,352 Z',
    cx: 629, cy: 351,
  },
  {
    id: 'CH-VS', code: 'VS', name: 'Valais', country: 'CH', flag: '🇨🇭',
    path: 'M 625,372 L 655,364 L 680,370 L 672,390 L 638,392 L 620,380 Z',
    cx: 650, cy: 379,
  },
  {
    id: 'CH-NE', code: 'NE', name: 'Neuchâtel', country: 'CH', flag: '🇨🇭',
    path: 'M 616,332 L 630,326 L 636,338 L 622,344 Z',
    cx: 626, cy: 335,
  },
  {
    id: 'CH-BS', code: 'BS', name: 'Bâle', country: 'CH', flag: '🇨🇭',
    path: 'M 650,305 L 665,304 L 668,316 L 654,318 Z',
    cx: 660, cy: 310,
  },
  {
    id: 'CH-TI', code: 'TI', name: 'Tessin', country: 'CH', flag: '🇨🇭',
    path: 'M 686,368 L 710,366 L 716,395 L 698,405 L 688,385 Z',
    cx: 700, cy: 384,
  },
  {
    id: 'CH-SG', code: 'SG', name: 'Saint-Gall', country: 'CH', flag: '🇨🇭',
    path: 'M 714,312 L 735,310 L 740,332 L 720,338 L 710,326 Z',
    cx: 725, cy: 322,
  },
  {
    id: 'CH-REST', code: 'CH-REST', name: 'Suisse Centrale / Est', country: 'CH', flag: '🇨🇭',
    path: 'M 666,326 L 688,322 L 710,336 L 730,350 L 710,366 L 680,355 L 664,342 Z',
    cx: 690, cy: 345,
  },

  // --- FRANCE (FR) ---
  {
    id: 'FR-IDF', code: 'IDF', name: 'Île-de-France', country: 'FR', flag: '🇫🇷',
    path: 'M 436,242 L 476,238 L 484,272 L 445,278 L 430,260 Z',
    cx: 456, cy: 258,
  },
  {
    id: 'FR-ARA', code: 'ARA', name: 'Auvergne-Rhône-Alpes', country: 'FR', flag: '🇫🇷',
    path: 'M 495,350 L 565,338 L 594,365 L 585,420 L 530,432 L 485,395 Z',
    cx: 540, cy: 385,
  },
  {
    id: 'FR-PACA', code: 'PACA', name: 'Provence-Alpes-Côte d’Azur', country: 'FR', flag: '🇫🇷',
    path: 'M 532,434 L 588,422 L 615,455 L 598,495 L 542,488 L 526,456 Z',
    cx: 568, cy: 462,
  },
  {
    id: 'FR-OCC', code: 'OCC', name: 'Occitanie', country: 'FR', flag: '🇫🇷',
    path: 'M 425,410 L 490,398 L 524,455 L 496,515 L 430,518 L 405,465 Z',
    cx: 465, cy: 460,
  },
  {
    id: 'FR-NAQ', code: 'NAQ', name: 'Nouvelle-Aquitaine', country: 'FR', flag: '🇫🇷',
    path: 'M 355,340 L 435,335 L 455,405 L 418,485 L 360,505 L 340,435 L 345,375 Z',
    cx: 395, cy: 415,
  },
  {
    id: 'FR-GES', code: 'GES', name: 'Grand Est', country: 'FR', flag: '🇫🇷',
    path: 'M 488,205 L 575,190 L 635,225 L 642,285 L 572,298 L 515,268 Z',
    cx: 565, cy: 245,
  },
  {
    id: 'FR-HDF', code: 'HDF', name: 'Hauts-de-France', country: 'FR', flag: '🇫🇷',
    path: 'M 428,155 L 490,148 L 515,198 L 472,236 L 430,210 Z',
    cx: 465, cy: 185,
  },
  {
    id: 'FR-BRE', code: 'BRE', name: 'Bretagne', country: 'FR', flag: '🇫🇷',
    path: 'M 285,255 L 360,250 L 372,295 L 320,315 L 270,290 Z',
    cx: 320, cy: 278,
  },
  {
    id: 'FR-PDL', code: 'PDL', name: 'Pays de la Loire', country: 'FR', flag: '🇫🇷',
    path: 'M 355,275 L 415,270 L 428,335 L 368,348 L 345,310 Z',
    cx: 388, cy: 308,
  },
  {
    id: 'FR-NOR', code: 'NOR', name: 'Normandie', country: 'FR', flag: '🇫🇷',
    path: 'M 360,205 L 435,198 L 442,245 L 375,260 L 350,230 Z',
    cx: 395, cy: 228,
  },
  {
    id: 'FR-BFC', code: 'BFC', name: 'Bourgogne-Franche-Comté', country: 'FR', flag: '🇫🇷',
    path: 'M 482,278 L 565,270 L 602,305 L 568,345 L 485,348 Z',
    cx: 535, cy: 310,
  },
  {
    id: 'FR-CVL', code: 'CVL', name: 'Centre-Val de Loire', country: 'FR', flag: '🇫🇷',
    path: 'M 418,275 L 480,270 L 490,345 L 425,340 Z',
    cx: 452, cy: 308,
  },
  {
    id: 'FR-COR', code: 'COR', name: 'Corse', country: 'FR', flag: '🇫🇷',
    path: 'M 678,505 L 696,502 L 702,550 L 682,560 L 672,525 Z',
    cx: 688, cy: 530,
  },

  // --- BELGIQUE & LUXEMBOURG (BE / LU) ---
  {
    id: 'BE-BRU', code: 'BRU', name: 'Bruxelles-Capitale', country: 'BE', flag: '🇧🇪',
    path: 'M 524,180 L 542,178 L 544,196 L 526,198 Z',
    cx: 534, cy: 188,
  },
  {
    id: 'BE-VLA', code: 'VLA', name: 'Flandre', country: 'BE', flag: '🇧🇪',
    path: 'M 488,155 L 568,145 L 575,178 L 515,185 L 480,172 Z',
    cx: 528, cy: 165,
  },
  {
    id: 'BE-WAL', code: 'WAL', name: 'Wallonie', country: 'BE', flag: '🇧🇪',
    path: 'M 495,182 L 565,175 L 595,205 L 555,230 L 500,215 Z',
    cx: 545, cy: 202,
  },
  {
    id: 'LU-LU', code: 'LU', name: 'Luxembourg', country: 'LU', flag: '🇱🇺',
    path: 'M 588,212 L 608,210 L 612,238 L 592,240 Z',
    cx: 600, cy: 225,
  },

  // --- ALLEMAGNE (DE) ---
  {
    id: 'DE-BY', code: 'BY', name: 'Bavière (Bayern)', country: 'DE', flag: '🇩🇪',
    path: 'M 740,240 L 835,232 L 872,285 L 835,348 L 760,345 L 735,290 Z',
    cx: 805, cy: 290,
  },
  {
    id: 'DE-BW', code: 'BW', name: 'Bade-Wurtemberg', country: 'DE', flag: '🇩🇪',
    path: 'M 670,278 L 745,268 L 760,335 L 685,345 L 665,305 Z',
    cx: 715, cy: 308,
  },
  {
    id: 'DE-NW', code: 'NW', name: 'Rhénanie-du-Nord-Westphalie', country: 'DE', flag: '🇩🇪',
    path: 'M 605,145 L 680,140 L 702,198 L 640,218 L 600,185 Z',
    cx: 650, cy: 180,
  },
  {
    id: 'DE-HE', code: 'HE', name: 'Hesse (Frankfurt)', country: 'DE', flag: '🇩🇪',
    path: 'M 675,195 L 740,190 L 748,252 L 678,258 L 665,225 Z',
    cx: 708, cy: 226,
  },
  {
    id: 'DE-BE', code: 'BER', name: 'Berlin & Brandebourg', country: 'DE', flag: '🇩🇪',
    path: 'M 830,95 L 895,90 L 910,155 L 845,160 Z',
    cx: 870, cy: 125,
  },
  {
    id: 'DE-HH', code: 'HH', name: 'Hambourg & Nord', country: 'DE', flag: '🇩🇪',
    path: 'M 690,65 L 785,55 L 805,120 L 705,128 Z',
    cx: 745, cy: 90,
  },
  {
    id: 'DE-SN', code: 'SN', name: 'Saxe (Leipzig/Dresden)', country: 'DE', flag: '🇩🇪',
    path: 'M 805,162 L 895,155 L 905,215 L 815,222 Z',
    cx: 855, cy: 188,
  },
  {
    id: 'DE-RP', code: 'RP', name: 'Rhénanie-Palatinat / Sarre', country: 'DE', flag: '🇩🇪',
    path: 'M 625,218 L 685,210 L 688,272 L 632,275 Z',
    cx: 658, cy: 245,
  },

  // --- ITALIE (IT) ---
  {
    id: 'IT-LOM', code: 'LOM', name: 'Lombardie (Milano)', country: 'IT', flag: '🇮🇹',
    path: 'M 685,380 L 755,372 L 770,418 L 698,425 Z',
    cx: 728, cy: 400,
  },
  {
    id: 'IT-PIE', code: 'PIE', name: 'Piémont (Torino)', country: 'IT', flag: '🇮🇹',
    path: 'M 632,382 L 690,375 L 702,435 L 645,438 Z',
    cx: 665, cy: 410,
  },
  {
    id: 'IT-VEN', code: 'VEN', name: 'Vénétie (Venezia/Verona)', country: 'IT', flag: '🇮🇹',
    path: 'M 750,368 L 830,362 L 838,420 L 762,425 Z',
    cx: 792, cy: 395,
  },
  {
    id: 'IT-EMR', code: 'EMR', name: 'Émilie-Romagne (Bologna)', country: 'IT', flag: '🇮🇹',
    path: 'M 710,422 L 825,415 L 835,465 L 725,470 Z',
    cx: 770, cy: 442,
  },
  {
    id: 'IT-TOS', code: 'TOS', name: 'Toscane (Firenze)', country: 'IT', flag: '🇮🇹',
    path: 'M 730,465 L 795,458 L 815,515 L 750,520 Z',
    cx: 772, cy: 490,
  },
  {
    id: 'IT-LAZ', code: 'LAZ', name: 'Latium (Roma)', country: 'IT', flag: '🇮🇹',
    path: 'M 780,515 L 850,505 L 880,575 L 810,580 Z',
    cx: 830, cy: 545,
  },

  // --- ESPAGNE (ES) ---
  {
    id: 'ES-MAD', code: 'MAD', name: 'Communauté de Madrid', country: 'ES', flag: '🇪🇸',
    path: 'M 292,572 L 340,568 L 345,618 L 298,622 Z',
    cx: 320, cy: 595,
  },
  {
    id: 'ES-CAT', code: 'CAT', name: 'Catalogne (Barcelona)', country: 'ES', flag: '🇪🇸',
    path: 'M 415,518 L 485,512 L 478,575 L 405,578 Z',
    cx: 445, cy: 548,
  },
  {
    id: 'ES-PVA', code: 'PVA', name: 'Pays basque (Bilbao)', country: 'ES', flag: '🇪🇸',
    path: 'M 315,488 L 368,485 L 372,525 L 320,528 Z',
    cx: 345, cy: 508,
  },
  {
    id: 'ES-VAL', code: 'VAL', name: 'Valence (València)', country: 'ES', flag: '🇪🇸',
    path: 'M 365,585 L 418,580 L 410,665 L 358,668 Z',
    cx: 388, cy: 625,
  },
  {
    id: 'ES-AND', code: 'AND', name: 'Andalousie (Sevilla/Málaga)', country: 'ES', flag: '🇪🇸',
    path: 'M 225,655 L 365,645 L 375,735 L 235,745 Z',
    cx: 300, cy: 695,
  },
  {
    id: 'ES-GAL', code: 'GAL', name: 'Galice (Vigo/Coruña)', country: 'ES', flag: '🇪🇸',
    path: 'M 145,475 L 210,470 L 205,535 L 140,538 Z',
    cx: 175, cy: 505,
  },
];

// Major Cities Dictionary (GPS Coordinates for Automatic Pin Positioning)
export const EUROPE_CITIES = {
  // Suisse (CH)
  'lausanne': { lat: 46.5196, lng: 6.6322, country: 'CH', region: 'VD' },
  'geneve': { lat: 46.2044, lng: 6.1432, country: 'CH', region: 'GE' },
  'genève': { lat: 46.2044, lng: 6.1432, country: 'CH', region: 'GE' },
  'geneva': { lat: 46.2044, lng: 6.1432, country: 'CH', region: 'GE' },
  'zurich': { lat: 47.3769, lng: 8.5417, country: 'CH', region: 'ZH' },
  'zürich': { lat: 47.3769, lng: 8.5417, country: 'CH', region: 'ZH' },
  'berne': { lat: 46.9480, lng: 7.4474, country: 'CH', region: 'BE' },
  'bern': { lat: 46.9480, lng: 7.4474, country: 'CH', region: 'BE' },
  'bale': { lat: 47.5596, lng: 7.5886, country: 'CH', region: 'BS' },
  'bâle': { lat: 47.5596, lng: 7.5886, country: 'CH', region: 'BS' },
  'basel': { lat: 47.5596, lng: 7.5886, country: 'CH', region: 'BS' },
  'fribourg': { lat: 46.8065, lng: 7.1619, country: 'CH', region: 'FR' },
  'sion': { lat: 46.2331, lng: 7.3606, country: 'CH', region: 'VS' },
  'neuchatel': { lat: 46.9899, lng: 6.9293, country: 'CH', region: 'NE' },
  'neuchâtel': { lat: 46.9899, lng: 6.9293, country: 'CH', region: 'NE' },
  'yverdon': { lat: 46.7785, lng: 6.6412, country: 'CH', region: 'VD' },
  'nyon': { lat: 46.3833, lng: 6.2396, country: 'CH', region: 'VD' },
  'morges': { lat: 46.5113, lng: 6.4990, country: 'CH', region: 'VD' },
  'vevey': { lat: 46.4628, lng: 6.8419, country: 'CH', region: 'VD' },
  'montreux': { lat: 46.4312, lng: 6.9107, country: 'CH', region: 'VD' },
  'lugano': { lat: 46.0037, lng: 8.9511, country: 'CH', region: 'TI' },
  'lucerne': { lat: 47.0502, lng: 8.3093, country: 'CH', region: 'LU' },
  'luzern': { lat: 47.0502, lng: 8.3093, country: 'CH', region: 'LU' },
  'zoug': { lat: 47.1662, lng: 8.5155, country: 'CH', region: 'ZG' },
  'zug': { lat: 47.1662, lng: 8.5155, country: 'CH', region: 'ZG' },
  'winterthur': { lat: 47.4999, lng: 8.7241, country: 'CH', region: 'ZH' },
  'st. gallen': { lat: 47.4245, lng: 9.3767, country: 'CH', region: 'SG' },
  'biel': { lat: 47.1368, lng: 7.2468, country: 'CH', region: 'BE' },
  'bienne': { lat: 47.1368, lng: 7.2468, country: 'CH', region: 'BE' },

  // France (FR)
  'paris': { lat: 48.8566, lng: 2.3522, country: 'FR', region: 'IDF' },
  'lyon': { lat: 45.7640, lng: 4.8357, country: 'FR', region: 'ARA' },
  'marseille': { lat: 43.2965, lng: 5.3698, country: 'FR', region: 'PACA' },
  'toulouse': { lat: 43.6047, lng: 1.4442, country: 'FR', region: 'OCC' },
  'nice': { lat: 43.7102, lng: 7.2620, country: 'FR', region: 'PACA' },
  'nantes': { lat: 47.2184, lng: -1.5536, country: 'FR', region: 'PDL' },
  'strasbourg': { lat: 48.5734, lng: 7.7521, country: 'FR', region: 'GES' },
  'montpellier': { lat: 43.6108, lng: 3.8767, country: 'FR', region: 'OCC' },
  'bordeaux': { lat: 44.8378, lng: -0.5792, country: 'FR', region: 'NAQ' },
  'lille': { lat: 50.6292, lng: 3.0573, country: 'FR', region: 'HDF' },
  'rennes': { lat: 48.1173, lng: -1.6778, country: 'FR', region: 'BRE' },
  'reims': { lat: 49.2583, lng: 4.0317, country: 'FR', region: 'GES' },
  'toulon': { lat: 43.1242, lng: 5.9280, country: 'FR', region: 'PACA' },
  'saint-etienne': { lat: 45.4397, lng: 4.3872, country: 'FR', region: 'ARA' },
  'grenoble': { lat: 45.1885, lng: 5.7245, country: 'FR', region: 'ARA' },
  'dijon': { lat: 47.3220, lng: 5.0415, country: 'FR', region: 'BFC' },
  'angers': { lat: 47.4784, lng: -0.5632, country: 'FR', region: 'PDL' },
  'nimes': { lat: 43.8367, lng: 4.3601, country: 'FR', region: 'OCC' },
  'villeurbanne': { lat: 45.7667, lng: 4.8800, country: 'FR', region: 'ARA' },
  'clermont-ferrand': { lat: 45.7772, lng: 3.0870, country: 'FR', region: 'ARA' },
  'aix-en-provence': { lat: 43.5297, lng: 5.4474, country: 'FR', region: 'PACA' },
  'brest': { lat: 48.3904, lng: -4.4861, country: 'FR', region: 'BRE' },
  'tours': { lat: 47.3941, lng: 0.6848, country: 'FR', region: 'CVL' },
  'amiens': { lat: 49.8941, lng: 2.2958, country: 'FR', region: 'HDF' },
  'annecy': { lat: 45.8992, lng: 6.1294, country: 'FR', region: 'ARA' },
  'sophia antipolis': { lat: 43.6164, lng: 7.0549, country: 'FR', region: 'PACA' },
  'sophia-antipolis': { lat: 43.6164, lng: 7.0549, country: 'FR', region: 'PACA' },
  'versailles': { lat: 48.8049, lng: 2.1204, country: 'FR', region: 'IDF' },
  'saclay': { lat: 48.7303, lng: 2.1706, country: 'FR', region: 'IDF' },

  // Allemagne (DE)
  'berlin': { lat: 52.5200, lng: 13.4050, country: 'DE', region: 'BE' },
  'munich': { lat: 48.1351, lng: 11.5820, country: 'DE', region: 'BY' },
  'münchen': { lat: 48.1351, lng: 11.5820, country: 'DE', region: 'BY' },
  'frankfurt': { lat: 50.1109, lng: 8.6821, country: 'DE', region: 'HE' },
  'francfort': { lat: 50.1109, lng: 8.6821, country: 'DE', region: 'HE' },
  'stuttgart': { lat: 48.7758, lng: 9.1829, country: 'DE', region: 'BW' },
  'koln': { lat: 50.9375, lng: 6.9603, country: 'DE', region: 'NW' },
  'cologne': { lat: 50.9375, lng: 6.9603, country: 'DE', region: 'NW' },
  'köln': { lat: 50.9375, lng: 6.9603, country: 'DE', region: 'NW' },
  'dusseldorf': { lat: 51.2277, lng: 6.7735, country: 'DE', region: 'NW' },
  'düsseldorf': { lat: 51.2277, lng: 6.7735, country: 'DE', region: 'NW' },
  'hamburg': { lat: 53.5511, lng: 9.9937, country: 'DE', region: 'HH' },
  'hambourg': { lat: 53.5511, lng: 9.9937, country: 'DE', region: 'HH' },
  'karlsruhe': { lat: 49.0069, lng: 8.4037, country: 'DE', region: 'BW' },
  'nurnberg': { lat: 49.4521, lng: 11.0767, country: 'DE', region: 'BY' },
  'nuremberg': { lat: 49.4521, lng: 11.0767, country: 'DE', region: 'BY' },
  'nürnberg': { lat: 49.4521, lng: 11.0767, country: 'DE', region: 'BY' },
  'leipzig': { lat: 51.3397, lng: 12.3731, country: 'DE', region: 'SN' },
  'dresden': { lat: 51.0504, lng: 13.7373, country: 'DE', region: 'SN' },
  'dresde': { lat: 51.0504, lng: 13.7373, country: 'DE', region: 'SN' },
  'hannover': { lat: 52.3759, lng: 9.7320, country: 'DE', region: 'NI' },
  'hanovre': { lat: 52.3759, lng: 9.7320, country: 'DE', region: 'NI' },
  'bonn': { lat: 50.7374, lng: 7.0982, country: 'DE', region: 'NW' },
  'heidelberg': { lat: 49.3988, lng: 8.6724, country: 'DE', region: 'BW' },
  'freiburg': { lat: 47.9990, lng: 7.8421, country: 'DE', region: 'BW' },

  // Belgique & Luxembourg (BE / LU)
  'bruxelles': { lat: 50.8503, lng: 4.3517, country: 'BE', region: 'BRU' },
  'brussels': { lat: 50.8503, lng: 4.3517, country: 'BE', region: 'BRU' },
  'anvers': { lat: 51.2194, lng: 4.4025, country: 'BE', region: 'VLA' },
  'antwerpen': { lat: 51.2194, lng: 4.4025, country: 'BE', region: 'VLA' },
  'gand': { lat: 51.0543, lng: 3.7174, country: 'BE', region: 'VLA' },
  'gent': { lat: 51.0543, lng: 3.7174, country: 'BE', region: 'VLA' },
  'liege': { lat: 50.6326, lng: 5.5684, country: 'BE', region: 'WAL' },
  'liège': { lat: 50.6326, lng: 5.5684, country: 'BE', region: 'WAL' },
  'namur': { lat: 50.4674, lng: 4.8719, country: 'BE', region: 'WAL' },
  'charleroi': { lat: 50.4108, lng: 4.4446, country: 'BE', region: 'WAL' },
  'louvain-la-neuve': { lat: 50.6683, lng: 4.6144, country: 'BE', region: 'WAL' },
  'louvain': { lat: 50.8798, lng: 4.7005, country: 'BE', region: 'VLA' },
  'leuven': { lat: 50.8798, lng: 4.7005, country: 'BE', region: 'VLA' },
  'luxembourg': { lat: 49.6116, lng: 6.1319, country: 'LU', region: 'LU' },
  'esch-sur-alzette': { lat: 49.4958, lng: 5.9806, country: 'LU', region: 'LU' },

  // Italie (IT)
  'milan': { lat: 45.4642, lng: 9.1900, country: 'IT', region: 'LOM' },
  'milano': { lat: 45.4642, lng: 9.1900, country: 'IT', region: 'LOM' },
  'rome': { lat: 41.9028, lng: 12.4964, country: 'IT', region: 'LAZ' },
  'roma': { lat: 41.9028, lng: 12.4964, country: 'IT', region: 'LAZ' },
  'turin': { lat: 45.0703, lng: 7.6869, country: 'IT', region: 'PIE' },
  'torino': { lat: 45.0703, lng: 7.6869, country: 'IT', region: 'PIE' },
  'bologne': { lat: 44.4949, lng: 11.3426, country: 'IT', region: 'EMR' },
  'bologna': { lat: 44.4949, lng: 11.3426, country: 'IT', region: 'EMR' },
  'florence': { lat: 43.7696, lng: 11.2558, country: 'IT', region: 'TOS' },
  'firenze': { lat: 43.7696, lng: 11.2558, country: 'IT', region: 'TOS' },
  'venise': { lat: 45.4408, lng: 12.3155, country: 'IT', region: 'VEN' },
  'venezia': { lat: 45.4408, lng: 12.3155, country: 'IT', region: 'VEN' },
  'verone': { lat: 45.4384, lng: 10.9916, country: 'IT', region: 'VEN' },
  'verona': { lat: 45.4384, lng: 10.9916, country: 'IT', region: 'VEN' },
  'genoa': { lat: 44.4056, lng: 8.9463, country: 'IT', region: 'LIG' },
  'gênes': { lat: 44.4056, lng: 8.9463, country: 'IT', region: 'LIG' },

  // Espagne (ES)
  'madrid': { lat: 40.4168, lng: -3.7038, country: 'ES', region: 'MAD' },
  'barcelone': { lat: 41.3851, lng: 2.1734, country: 'ES', region: 'CAT' },
  'barcelona': { lat: 41.3851, lng: 2.1734, country: 'ES', region: 'CAT' },
  'valence': { lat: 39.4699, lng: -0.3763, country: 'ES', region: 'VAL' },
  'valencia': { lat: 39.4699, lng: -0.3763, country: 'ES', region: 'VAL' },
  'seville': { lat: 37.3891, lng: -5.9845, country: 'ES', region: 'AND' },
  'sevilla': { lat: 37.3891, lng: -5.9845, country: 'ES', region: 'AND' },
  'bilbao': { lat: 43.2630, lng: -2.9350, country: 'ES', region: 'PVA' },
  'san sebastian': { lat: 43.3183, lng: -1.9812, country: 'ES', region: 'PVA' },
  'malaga': { lat: 36.7213, lng: -4.4214, country: 'ES', region: 'AND' },
  'málaga': { lat: 36.7213, lng: -4.4214, country: 'ES', region: 'AND' },
  'saragosse': { lat: 41.6488, lng: -0.8891, country: 'ES', region: 'ARA' },
  'zaragoza': { lat: 41.6488, lng: -0.8891, country: 'ES', region: 'ARA' },
};

// Geocoding helper that detects City, Country and Region from candidatures
export function geocodeCandidature(candidature) {
  const norm = (str) =>
    String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\\\/,\(\)\.\-]/g, ' ')
      .trim();

  const loc = norm(candidature.location);
  const cant = norm(candidature.canton || candidature.region);
  const rawCountry = String(candidature.country || '').toUpperCase().trim();

  // 1. Direct city match in EUROPE_CITIES
  for (const [key, cityData] of Object.entries(EUROPE_CITIES)) {
    const cleanKey = norm(key);
    if (loc && (loc === cleanKey || loc.includes(cleanKey) || cleanKey.includes(loc))) {
      const projected = projectGpsEurope(cityData.lat, cityData.lng);
      return {
        ...projected,
        lat: cityData.lat,
        lng: cityData.lng,
        country: cityData.country,
        region: cityData.region,
        cityName: key.charAt(0).toUpperCase() + key.slice(1),
      };
    }
  }

  // 2. Region / Canton match
  for (const [countryKey, regionList] of Object.entries(REGIONS_BY_COUNTRY)) {
    for (const reg of regionList) {
      const regName = norm(reg.name);
      const regCode = norm(reg.code);
      if (
        cant &&
        (cant.includes(regCode) ||
          cant.includes(regName) ||
          regName.includes(cant) ||
          loc.includes(regName))
      ) {
        // Small random offset around region centroid so multiple city pins don't overlap completely
        const hash = Array.from(String(candidature.company || '')).reduce(
          (acc, ch) => acc + ch.charCodeAt(0),
          0
        );
        const latOffset = ((hash % 10) - 5) * 0.08;
        const lngOffset = (((hash >> 2) % 10) - 5) * 0.08;
        const projected = projectGpsEurope(reg.lat + latOffset, reg.lng + lngOffset);
        return {
          ...projected,
          lat: reg.lat,
          lng: reg.lng,
          country: reg.country,
          region: reg.code,
          cityName: candidature.location || reg.name,
        };
      }
    }
  }

  // 3. Fallback based on raw country or default Switzerland / Vaud
  const countryCode = ['CH', 'FR', 'DE', 'BE', 'LU', 'IT', 'ES'].includes(rawCountry)
    ? rawCountry
    : 'CH';

  const defaultReg = REGIONS_BY_COUNTRY[countryCode]?.[0] || REGIONS_BY_COUNTRY.CH[0];
  const projected = projectGpsEurope(defaultReg.lat, defaultReg.lng);
  return {
    ...projected,
    lat: defaultReg.lat,
    lng: defaultReg.lng,
    country: defaultReg.country,
    region: defaultReg.code,
    cityName: candidature.location || defaultReg.name,
  };
}

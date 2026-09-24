# V6.2 — analyse des scans et corrections

## V6.2.7 — protection contre les saturations mémoire

- traitement progressif des pages en lots bornés au lieu de rassembler tous les HTML avant l’analyse ;
- plafond configurable `MAX_IN_FLIGHT_PAGES`, fixé à 16 en mode Exhaustif ;
- lecture HTTP en flux avec plafond `MAX_RESPONSE_BYTES`, fixé à 3 Mo par page en mode Exhaustif ;
- libération du HTML des fiches dès que les informations nécessaires sont extraites ;
- descriptions structurées bornées à 60 000 caractères ;
- échantillon de diagnostic borné sans réduire le volume de fiches analysées ;
- journal de scan écrit au fil de l’eau sur disque, avec tampon visuel limité à 160 lignes ;
- interface Streamlit rafraîchie au maximum une fois par seconde pendant les longues analyses ;
- deux nouveaux réglages mémoire visibles dans l’interface ;
- suite portée à 48 tests automatisés.

## V6.2.6 — recherche exhaustive bornée à une heure

- ajout du mode **Exhaustif 1h**, avec 240 requêtes par défaut et plafond manuel de 300 ;
- expansion de toutes les variantes contrat × métier × compétence × pays, plus trois requêtes ciblées par domaine fixe ;
- maintien de timeouts courts avec 8 workers web et 12 workers de pages ;
- coupe-circuit désactivé et moteur de secours activé dans ce mode uniquement ;
- budget global de 3 600 secondes et réserve finale de 150 secondes pour l’analyse et les exports ;
- lancement des téléchargements en lots afin de ne pas engager des centaines de pages lorsque l’échéance approche ;
- classement global des fiches de listings avant le banc de test ;
- dédoublonnage des fiches avant leur téléchargement ;
- exclusion des App Stores, réseaux sociaux et pages promotionnelles/salaires Indeed ;
- reconnaissance renforcée des liens détail InternshipDaily, iAgora, Glassdoor et Indeed ;
- suppression de la contamination du type de contrat par le texte du listing parent ;
- journal initial enrichi avec les paramètres de profondeur, le budget temps et l’état réel du coupe-circuit ;
- suite portée à 47 tests automatisés.

## V6.2.5 — diagnostic complet des moteurs et listings

- correction des faux backends `bing` et `yandex` qui déclenchaient silencieusement le mode automatique de DDGS ;
- migration d’une ancienne configuration `bing` vers le backend pris en charge `yahoo` et rejet explicite des valeurs inconnues ;
- utilisation de `duckduckgo,yahoo` par défaut après les tests réels du 22 septembre ;
- distinction entre liens valides par moteur et nouveaux liens après dédoublonnage ;
- exclusion des liens publicitaires `bing.com/aclick` avant téléchargement ;
- reconnaissance des pages de résultats Indeed comme listings ;
- exploration des cartes trouvées dans les listings et validation des premières fiches depuis le banc de test ;
- nouveaux compteurs de pistes extraites et d’offres simulées retenues ;
- suite portée à 40 tests automatisés.

## V6.2.4 — banc de test du moteur web

- test isolé d’une requête depuis l’interface, sans lancer un scan complet ;
- comparaison multi-moteurs avec résultats bruts et exceptions exactes ;
- simulation optionnelle des filtres Stage Hunter sur six pages maximum ;
- rapport JSON conservé dans `output/<profil>/debug/` ;
- traces web détaillées dans les journaux normaux ;
- rotation DuckDuckGo/Brave dès la première tentative afin que la sonde teste réellement les deux moteurs sans requêtes supplémentaires.

## V6.2.3 — automatisation et Tinder

- contournement de la limite Windows de 261 caractères pour `/TR` avec un lanceur court généré par profil ;
- conservation du profil actif après actualisation grâce au paramètre `?profile=` ;
- rechargement automatique de toute l’interface après un scan terminé ;
- nouvelle carte Tinder plus lisible, responsive et compacte ;
- sélection d’offres pour les remettre dans Tinder ou les supprimer de la base locale pendant les tests.

## Diagnostic des deux journaux du 22 septembre 2026

### Profil Raphaël — stage en Suisse

- 77 requêtes web exécutées, 0 productive, 0 lien, 2 min 12 s consommées.
- 14 listings directs ont produit 188 liens en environ 5 secondes.
- 1 175 pistes ont été recensées dans les listings et 290 pages supplémentaires ouvertes.
- 89 offres retenues, mais 228 pages classées fermées, dont 225 par le motif générique `Page fermée/expirée`.
- Les offres retenues provenaient surtout de LinkedIn (38), CERN (25), Euraxess (14) et Sonova (5).

Conclusion : le web générique était improductif ; les sources directes étaient la vraie source de résultats. La fermeture était trop agressive et l'exploration de listings trop large.

### Profil emploi France

- 80 requêtes web exécutées, 2 productives, 24 liens, 1 min 15 s consommées.
- 9 listings directs ont produit 153 liens en environ 5 secondes.
- 3 792 pistes ont été recensées et 500 pages supplémentaires ouvertes.
- 161 offres retenues, 506 hors cible, 130 listings et 87 doublons.
- 325 stages ont été correctement rejetés, mais le profil chargeait aussi le pack Suisse ; LinkedIn Suisse/Luxembourg dominait donc encore les résultats.
- HelloWork a généré 80 pages de listing et plusieurs pages SEO métier/salaire étaient prises pour des offres.

Conclusion : le contrat était mieux filtré, mais les packs géographiques, les pages SEO et la récursion produisaient beaucoup de bruit.

## Corrections apportées

- Listings et pages carrière exécutés avant la recherche web.
- Sonde web courte et coupe-circuit configurable.
- Classement historique des requêtes et sources selon leur rendement.
- Packs géographiques incompatibles avec les pays du profil ignorés automatiquement.
- Ajout de France Travail, Apec et de pages carrière officielles au catalogue.
- Extraction des offres dans JSON-LD et JSON embarqué des principaux ATS.
- Classement des pistes avec les mots du profil, seuil minimal et plafond par sous-listing.
- Détection de pages SEO/listing renforcée pour HelloWork, Glassdoor, EnglishJobSearch et Randstad.
- Disponibilité `open / closed / unknown` ; l'ancienneté seule et les chaînes cachées ne ferment plus une annonce.
- Contrats structurés contrôlés selon le profil et intitulés incompatibles mieux rejetés.
- Empreinte de dédoublonnage entreprise + titre + lieu.
- Apprentissage local à partir des décisions Tinder, avec activation et remise à zéro.
- Synchronisation Google Sheets idempotente par identifiant Stage Hunter.
- Diagnostic UI : tunnel, motifs, rendement par source, historique et recommandations.
- Planification Windows facultative et scripts d'installation/mise à jour vérifiés.

## Résultat attendu au prochain scan

La durée ne peut pas être prédite sans les réponses réelles des sites, mais un scan similaire doit éviter la majorité des 77/80 requêtes web vides après la sonde initiale. Le volume de faux `fermée/expirée` et de pages SEO retenues doit fortement baisser. Le diagnostic V6.2 permettra de comparer précisément le prochain résultat à ces références.

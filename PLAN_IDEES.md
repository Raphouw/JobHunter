# Suivi de `Idées.txt`

Ce suivi garde chaque idée visible dans l'ordre de mise en œuvre défini par l'audit du profil Raphaël. Le nom **Job Hunter** a été avancé, car il figurait en tête de la liste d'origine. Les noms des fichiers internes `stage_hunter_*` restent stables pour préserver la base, les scripts et les intégrations.

| Lot | Contenu de l'idée d'origine | État |
|---|---|---|
| 1–3 | Examiner les longs logs ; expliquer les décisions ; corriger listings, contrats, éligibilité et score | Terminé. Explications détaillées des scores et exclusions, audit pas à pas, filtres et pondérations corrigés. |
| 4 | Explorer les listings sans dépassement ; réduire mémoire et blocages ; préserver les données en cas d'interruption | Terminé. Plafond global, dédoublonnage par identifiant, extraction au fil de l'eau, cache compressé, journaux par scan, sauvegardes périodiques et reprise. |
| 5 | Timer chaque seconde ; pourcentage et ETA ; RAM et activité du PC ; journal visible après un crash | Terminé. Compteur live 1s, jauge d'avancement %, calcul d'ETA restante, télémétrie matérielle directe (RAM totale/utilisée en Go, RAM processus en Mo, CPU %) et persistance immédiate des logs avec téléchargement. |
| 6 | Parser plus précisément chaque site de listing | Terminé. Module dédié `connectors.py` avec connecteurs spécialisés pour LinkedIn, jobs.ch / jobup.ch, iAgora, Glassdoor, Indeed et JobTeaser (cartes d'offres, nettoyage des notes étoiles, fiches détaillées). |
| 7 | Refaire Tinder en Swiper ; interface plus propre ; informations et paramètres détaillés ; mots « red flag » | Terminé. Swiper élargi sans angle mort, jauge de match SVG, rendu fluide de la carte suivante en arrière-plan sans coupure, transparence d'affinité profil (zéro mention Tinder), enrichissement des cartes (contrat, durée, extrait), règles red flag strictes et souples (−25 pts) avec simulateur interactif. |
| 8 | Transformer en site React hébergé gratuitement / local | Terminé. Application React complète et moderne (Vite) avec tableau de bord, résultats, recherche avec télémétrie, profil, intégrations Google, diagnostic et deck Swiper immersif. |

Découpage modulaire : amorcé avec l'extraction du module `connectors.py` pour alléger le moteur principal et isoler les règles de scraping. Le nom public du site est **Job Hunter**.

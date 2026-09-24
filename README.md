# Job Hunter V6.2.7 — moteur adaptatif multi-profils

Job Hunter recherche des stages, CDI, CDD, alternances ou missions à partir des métiers, compétences, secteurs, pays et langues de chaque profil. Il combine des pages carrière visitées directement, des listings de job boards, une recherche web de complément et, si souhaité, Gmail et Google Sheets.

## Installer ou mettre à jour sous Windows

1. Décompresser le dossier dans un emplacement local, idéalement hors OneDrive.
2. Pour une première installation, lancer `install.bat`.
3. Pour une mise à jour, remplacer uniquement les fichiers du programme puis lancer `Mettre_a_jour.bat`.
4. Ouvrir ensuite `Lancer_Stage_Hunter.bat`.

L'installation crée l'environnement Python, installe les dépendances, compile le code et exécute les tests automatiques. La mise à jour ne supprime jamais `.env`, `credentials`, `config/profiles` ou `output`.

Il ne faut pas supprimer la base SQLite ni les onglets Google Sheets lors d'une mise à jour : les migrations sont automatiques et l'historique sert au dédoublonnage, à l'apprentissage Tinder et au classement des sources.

## Ce qui change en V6.2

- **Sources directes d'abord** : les listings configurés sont visités avant les moteurs web.
- **Recherche web adaptative** : une courte sonde mesure le rendement. Si elle est vide, le coupe-circuit évite le reste des requêtes lentes.
- **Historique de rendement** : les sources qui ont déjà trouvé des offres passent en premier ; les sources durablement vides descendent dans la liste sans être supprimées.
- **Extraction ATS** : les fiches présentes dans JSON-LD et dans les données JSON de Workday, Greenhouse, Lever, SmartRecruiters ou Next.js peuvent être récupérées.
- **Exploration bornée** : chaque sous-listing est classé avec les mots du profil, puis seules les pistes les plus pertinentes sont ouvertes.
- **Disponibilité à trois états** : `ouverte`, `fermée` ou `à confirmer`. Une phrase cachée dans JavaScript ou l'ancienneté seule ne ferme plus une offre.
- **Contrats plus stricts** : un profil emploi rejette les stages ; un profil stage rejette les intitulés senior, direction, doctorat ou postdoctorat sans signal de stage.
- **Dédoublonnage renforcé** : URL canonique, empreinte entreprise/titre/lieu et similarité textuelle.
- **Historique Tinder conservé** : les décisions restent disponibles pour l'analyse, mais ne modifient plus le classement automatique tant qu'elles ne précisent pas pourquoi une offre a été gardée ou rejetée.
- **Google Sheets idempotent** : une offre existante est mise à jour par son ID au lieu d'être ajoutée une seconde fois.
- **Diagnostic complet** : tunnel du scan, rendement par source, motifs de rejet, temps par phase et historique des scans. Un journal JSONL conserve une décision détaillée par URL analysée, avec score, confiance, motif et extrait de preuve.
- **Score recentré sur le profil** : compétences synonymes regroupées, dates et durées comparées à la disponibilité, langue obligatoire distinguée d'une langue souhaitée, et aucun bonus donné à un contrat seulement probable.
- **Exploration bornée** : le plafond global de pages s'applique à la première collecte, aux fiches des listings et à la récursion. Les variantes d'une annonce portant le même identifiant métier sont rapprochées avant téléchargement.
- **Reprise après interruption** : la liste des candidats et les réglages sont enregistrés avant l'analyse. Une relance en mode reprise ignore les offres déjà sauvées et conserve les journaux de chaque passage.
- **Scans récurrents** : création facultative d'une tâche Windows quotidienne, en semaine ou hebdomadaire.

Le mode **Exhaustif 1h** du profil Raphaël applique maintenant réellement une limite de 3 600 secondes et un plafond global de 2 400 pages candidates téléchargées après la découverte. La zone « Nouveau scan » permet de régler ce plafond et affiche un bouton de reprise si un scan a été interrompu après la découverte. En ligne de commande, la reprise se lance avec `python stage_hunter.py scan --profile raphael --resume`.

Chaque scan conserve un journal `stage_hunter_decisions_*.jsonl`, son fichier de réglages `*.meta.json` et un cache compressé `stage_hunter_details_*.bin` dans `output/<profil>/`. Le journal contient le texte utilisé pour le score, limité à 30 000 caractères par décision. Les enregistrements en base sont validés périodiquement afin qu'une relance ne recrée pas les offres déjà conservées.

### Correctif V6.2.1

- fermeture explicite de toutes les connexions SQLite ouvertes par l'interface et les réglages ;
- tests temporaires tolérants aux délais de déverrouillage de fichiers propres à Windows ;
- sortie des tests masquée pendant une installation réussie et affichée uniquement en cas d'erreur.

### Correctif V6.2.2

- UTF-8 forcé pendant l'installation et la mise à jour sous Windows ;
- correction du `UnicodeEncodeError` CP1252 provoqué par les symboles des journaux pendant les tests.

### Correctif V6.2.3

- l’automatisation Windows utilise un lanceur court par profil et ne dépasse plus la limite de 261 caractères de `schtasks /TR` ;
- le profil actif est conservé après une actualisation du navigateur ;
- la fin d’un scan actualise immédiatement les compteurs, le diagnostic et le Tinder ;
- le Tinder a été redessiné et permet de rejouer ou supprimer localement des offres choisies pour les tests.

### Diagnostic V6.2.4

- ajout d’un banc de test web dans l’onglet Recherche, sans scan complet ni écriture dans les offres ;
- comparaison directe de DuckDuckGo, Brave, Bing, Google, Startpage, Mojeek, Yahoo et Yandex ;
- affichage des résultats bruts, durées, types d’erreur et messages exacts par moteur ;
- simulation facultative de la classification et des filtres sur les premières pages ;
- journaux de scan enrichis avec le moteur réellement utilisé et le détail de chaque tentative ;
- alternance des moteurs principaux pendant la sonde, même lorsque les résultats vides ne sont pas retentés.

### Diagnostic V6.2.5

- seuls les backends réellement pris en charge par DDGS sont proposés ;
- l’ancienne valeur `bing` est migrée vers `yahoo`, tandis que `yandex` est ignorée au lieu de lancer silencieusement le mode automatique ;
- le couple par défaut devient DuckDuckGo + Yahoo après comparaison des réponses réelles ;
- les publicités Bing sont écartées avant téléchargement et les pages de résultats Indeed restent des listings ;
- le banc de test suit désormais tout le tunnel moteur → listing → cartes extraites → premières fiches → décision simulée ;
- les liens valides d’un moteur sont distingués de sa contribution nouvelle après dédoublonnage.

### Recherche profonde V6.2.6

- nouveau mode **Exhaustif 1h** : 240 requêtes ciblées par défaut, réglables jusqu’à 300, avec budget global d’une heure ;
- combinaison étendue des contrats, langues, métiers, compétences, pays et domaines du profil ;
- huit workers de recherche et douze workers de pages, avec timeouts courts par requête ;
- deux moteurs réels alternés (`duckduckgo` et `yahoo`) et essai du second lorsqu’un premier moteur ne renvoie rien ;
- exploration directe de 30 sources, jusqu’à 100 pistes par listing et 500 fiches récursives ;
- classement global des fiches extraites avant vérification, dédoublonnage avant téléchargement et exclusion des liens promotionnels ;
- arrêt propre avant l’échéance afin de conserver le temps nécessaire à l’analyse et à l’export.

### Stabilité mémoire V6.2.7

- pages téléchargées et analysées par petits lots au lieu de conserver tout le scan en RAM ;
- HTML brut libéré dès que la classification et la disponibilité de l’offre sont connues ;
- taille de chaque réponse HTTP bornée, à 3 Mo dans le préréglage Exhaustif ;
- maximum de 16 pages simultanément en mémoire dans ce mode ;
- export de diagnostic limité à un échantillon de 3 000 pistes, sans limiter les offres réellement analysées ;
- journal complet écrit directement sur disque et seulement 160 lignes conservées pour l’affichage ;
- rafraîchissement de la console limité à une fois par seconde afin de protéger le navigateur.

## Interface

L'interface principale est maintenant une application **React** locale. Après l'installation, lancez `Lancer_Stage_Hunter.bat` : le navigateur ouvre `http://localhost:8501`. Le build compilé est fourni dans `web/dist`, donc Node.js n'est pas nécessaire pour utiliser l'application. Le moteur Python, les profils YAML et les bases SQLite existantes sont conservés.

La préparation d'un accès web privé et les conditions de déploiement sont décrites dans [WEB_MIGRATION.md](WEB_MIGRATION.md).
Le début de la migration multi-utilisateur Supabase/Vercel est décrit dans [CLOUD_SETUP.md](CLOUD_SETUP.md).

Pour travailler sur l'interface : `cd web`, `npm install`, puis `npm run build`. Le serveur local sert automatiquement le nouveau build. L'ancienne interface Streamlit reste disponible avec `streamlit run stage_hunter_ui.py` pour les fonctions avancées qui ne sont pas encore présentes dans React, comme le banc de test web et la suppression locale d'offres.

Dans **Découvrir**, glissez une carte à droite pour garder, à gauche pour passer ou vers le bas pour la revoir. Les boutons et les flèches du clavier font les mêmes actions. Chaque décision est enregistrée immédiatement dans la base locale du profil ; l'annulation restaure la dernière décision.

L'interface est organisée en huit espaces :

- **Vue d'ensemble** : état du profil, statistiques, effort du prochain scan et journal compact en direct ;
- **Tinder** : fiche détaillée, Garder / À revoir / Rejeter, progression, annulation et apprentissage ;
- **Profil** : objectif, contrats, métiers, compétences, secteurs, pays et langues ;
- **Recherche** : packs de sources, domaines et listings personnels, aperçu exact des requêtes ;
- **Diagnostic** : tunnel, sources rentables, rejets et recommandations ;
- **Connexions** : Google Sheets, Gmail, création et réparation du tableau ;
- **Automatisation** : scans récurrents Windows ;
- **Résultats** : tableau filtrable des offres validées.

Le journal visible conserve les dernières lignes seulement. Le log complet reste dans `output/<profil>/logs`.

## Profils et paramètres importants

Chaque profil YAML se trouve dans `config/profiles` et possède sa base dans `output/<id>/stage_hunter.sqlite3`.

| Paramètre | Rôle |
|---|---|
| Requêtes ciblées | Nombre maximal de combinaisons métier/compétence/pays préparées pour le web |
| Listings fixes | Nombre de pages de sources visitées directement |
| Workers recherche | Requêtes web simultanées, de 1 à 8 |
| Workers pages | Pages d'offres téléchargées simultanément, de 2 à 12 |
| Sonde web | Nombre de requêtes testées avant de décider de poursuivre |
| Profondeur des listings | Nombre de couches listing → sous-listing → fiche |
| Fiches récursives | Plafond global de pages ouvertes depuis les listings |
| Maximum par sous-listing | Empêche un portail générique de monopoliser le scan |
| Pistes lues par listing | Nombre maximal de cartes extraites de chaque page de résultats |
| Durée maximale | Budget global ; le moteur cesse de lancer de nouveaux lots puis finalise proprement |
| Explorer malgré une sonde vide | Désactive le coupe-circuit pour un scan de fond |
| Moteur de secours si vide | Essaie le moteur suivant lorsqu’une recherche ne retourne rien |
| Pages simultanément en RAM | Taille des lots de téléchargement ; 16 est le réglage sûr recommandé en Exhaustif |
| Taille maximale d'une page | Coupe les bundles HTML/JavaScript géants ; 3 Mo suffit normalement à une fiche d’offre |
| Timeout | Durée maximale d'attente par moteur ou page |

Les quatre préréglages restent modifiables : Rapide, Complet, Maximum et Exhaustif 1h. Les trois premiers peuvent interrompre le web après une sonde improductive. Exhaustif 1h poursuit l’exploration, mais chaque appel conserve son propre timeout court et le scan garde une réserve pour terminer ses exports.

## Google Sheets et Gmail

Google est facultatif et propre à chaque profil. L'onglet **Connexions** peut autoriser Google, créer et relier automatiquement un Sheet, réparer sa mise en forme et synchroniser ses actions.

Le tableau contient `Réponses` et `Opportunités`, avec filtres, listes d'actions, largeurs, couleurs et identifiants techniques. `GARDER` conserve l'offre, `SUPPRIMER` mémorise le rejet et retire la ligne, et `TRANSFERER` copie la fiche vers `Réponses`.

Sans Apps Script, les choix du Sheet sont lus avec le bouton de synchronisation ou au début du scan suivant. Le dossier `apps_script` reste disponible pour un déclenchement instantané.

Gmail n'est lu que si l'intégration est activée. Les libellés configurés dans `GMAIL_EXCLUDED_LABELS` — `STAGE` par défaut — sont exclus.

## Tinder et export

Les nouvelles offres arrivent d'abord dans Tinder. Elles ne sont pas exportées tant qu'elles n'ont pas été classées :

- **Garder** : offre validée ;
- **À revoir** : offre conservée sans décision définitive ;
- **Rejeter** : URL et décision mémorisées, offre exclue des exports.

Seules les offres Garder et À revoir sont synchronisées vers Google Sheets. Les décisions alimentent un petit modèle local et explicable, sans service externe.

## Diagnostic d'un scan

Après chaque scan, consulter l'onglet **Diagnostic** ou les fichiers :

- `stage_hunter_diagnostics.json` : configuration, tunnel, temps et rendements ;
- `stage_hunter_rejections.xlsx` : chaque refus avec motif et URL officielle ;
- `stage_hunter_listing_leads.xlsx` : pistes extraites des listings ;
- `stage_hunter.xlsx` : résultats actifs.

Les logs affichent au début tous les paramètres effectifs : profil, contrats, mots, pays, budget, workers, timeouts, sources, profondeur, Google et Gmail.

## Partager le projet

Partager le dossier du programme sans `.env`, `.venv`, `credentials` ni `output`. La personne lance ensuite `install.bat`, crée son profil dans l'interface et connecte son propre compte Google si elle le souhaite.

## Ligne de commande

```bat
run_scan.bat raphael
google_auth.bat raphael
process_actions.bat raphael
```

Ou directement :

```bash
python stage_hunter.py scan --profile raphael
python stage_hunter.py report --profile raphael
python stage_hunter_scheduler.py status --profile config/profiles/raphael.yaml
python -m unittest -v test_stage_hunter_v6.py
```
"# JobHunter" 

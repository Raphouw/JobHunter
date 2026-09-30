# Audit du scan et migration navigateur

Audit effectué le 30 septembre 2026, avant modification du moteur. Le dépôt utilise React 19/Vite et Python, pas Next.js/TypeScript. Aucun script lint/typecheck n'est actuellement configuré.

## Avant

`CloudApp.startScan` insère un job puis appelle `/api/scan`. Supabase pg_cron/pg_net relance les jobs toutes les 30 secondes. `run_slice` prend un bail atomique, importe `stage_hunter`, normalise le profil, découvre les sites et les requêtes, puis alterne discovery/analysis/finalisation pendant environ 225 secondes (fonction configurée à 300 secondes). Chaque étape écrit son checkpoint et libère le bail. Les appels HTTP, BeautifulSoup, trafilatura, connecteurs, classification, eligibility, score, SQLite et rapprochements fuzzy utilisent Vercel. Les offres et l'historique restent dans Supabase.

`CloudApp` recharge offres complètes (1000), scans (10), candidatures et événements (250) toutes les 2,5 secondes sur la page Recherche. Hors de cette page, la progression visible devient ancienne. Les changements de page conservent CloudApp mais aucun moteur navigateur n'existe.

## Cartographie avant implementation

| Opération | Catégorie | Destination et raison |
|---|---|---|
| Orchestration, budget, progression, retry, pause | A/G | Service global navigateur, état local |
| Parsing HTML, schema.org, connecteurs, sélecteurs personnalisés | B | Python/WebAssembly dans un Worker pour conserver le code métier |
| Normalisation, éligibilité, score, final score, fuzzy dedup, SQLite temporaire | B | Même moteur Python dans le Worker; pas de scoring JS approximatif |
| Sites fixes et carrières, LinkedIn guest | D | Proxy HTML borné; contrôle DNS/IP à chaque redirection |
| DDGS DuckDuckGo/Yahoo/Google/Startpage/Mojeek | D | Une recherche serveur ponctuelle; client Python non navigateur |
| Brave, SearX configuré | E | Une recherche serveur ponctuelle; variables privées serveur seulement |
| Offres, suppressions, reviews, candidatures, historique | F | Supabase reste la référence persistante |
| Service-role, CRON_SECRET, Google OAuth et tokens | C/E | Serveur exclusivement; aucune copie dans les assets publics |
| Baux atomiques, ownership, validation des écritures privilégiées | C/F | Passerelle authentifiée et RPC actuelles |
| Dispatcher automatique pour scans navigateur | G | Ignorer l'exécuteur navigateur; conserver le chemin historique |

## CORS et réseau

Le catalogue `config/sources.yaml` couvre jobs.ch, jobup.ch, jobscout24.ch, LinkedIn, iAgora, Swissdevjobs, Swissinterns, France Travail, Apec, Welcome to the Jungle, HelloWork, JobTeaser, Indeed, Jobat, References, Stepstone, Stellenanzeigen, Eures et Euraxess, plus les packs employeurs et les recettes privées/partagées. Aucun contrat CORS commun n'est déclaré dans le code. Un GET effectué depuis Python ne prouve pas un accès navigateur: headers, origine, cookies, redirections et protections peuvent varier par URL. Pour **toutes** ces sources, statut navigateur: non garanti, proxy par défaut. Un 403/429 demeure une indisponibilité/protection, jamais une autorisation de contournement. Les URLs personnalisées suivent exactement la même politique. Ne pas prétendre avoir validé CORS en production sans un test depuis l'origine déployée.

Le proxy utilise `site_network.fetch_preview`: HTTP(S) public, ports 80/443, sans credentials, DNS entièrement public, IP épinglée, validation des redirections, limite HTML 2 Mo. Les APIs de recherche restent serveur. Les retries durables des candidats, leurs délais et les cooldowns du moteur sont conservés. Le téléchargement navigateur remplace les retries internes de requests par un appel proxy par tentative; cette différence réseau doit être validée sur des sources réelles.

## CPU, RAM et sécurité

Les parsings répétés BeautifulSoup/trafilatura, scoring, fuzzy comparisons, scoring final et imports Python consomment du CPU serveur. L'attente réseau ne représente pas à elle seule l'Active CPU facturé. Les métriques existantes `time.process_time` sont des estimations, non une facture Vercel.

Risque mémoire principal: `analyze` construit `existing`, puis copie chaque offre/description dans SQLite et `existing_remote_rows`, à chaque invocation. La pagination ne borne pas cette accumulation. Autres risques: futures contenant plusieurs HTML, ensembles d'URLs, audit arrays, module global Python réutilisé par les processus chauds. Le cache de détails est déjà compressé sur disque et les téléchargements sont déjà par fenêtres; il faut conserver ces protections, pas annoncer qu'elles étaient absentes. La cause exacte de l'ancien OOM n'est pas démontrée sans heap/profil de l'exécution concernée.

La clé publishable Supabase est publique par conception. Service-role, credentials locaux et `.env` ne doivent jamais être publiés. Les assets du runtime suivent une liste explicite de fichiers de code/catalogue public. Les profils sont chargés après authentification. La passerelle contraint chaque lecture/écriture au user/profile/job, même avec la service-role. Les mutations doivent être liées au bail actif. Aucune route ne doit devenir un proxy SQL ou réseau ouvert.

## Architecture cible et phases

1. Cet audit et une baseline tests/build.
2. Runtime Python partagé, assets explicites, transport minimal authentifié; conserver le scan historique en repli.
3. ScanController global, WorkerPool paresseux, état et événements locaux. Un moteur mutable possède un seul bail à la fois; **ne pas paralléliser plusieurs phases du même job**. Le pool borne les moteurs, pas des copies inutiles du même scan. Le moteur actuel reste séquentiel à l'intérieur du Worker en l'absence de pthreads WebAssembly; un vrai pool de parsing indépendant exige une extraction ultérieure de ses globals.
4. Libérer les HTML par fenêtres; charger les historiques par pages et éviter la copie `existing` complète. Limiter logs et télémétrie.
5. Backend: téléchargement d'une page, recherche d'une requête, opération de persistance bornée; pas de boucle de scan.
6. IndexedDB: user/job/configuration publique/état/checkpoint/statistiques. Supabase conserve les résultats validés et la file durable, jamais l'HTML brut dans un checkpoint.
7. Contrôles globaux, pause/reprise/arrêt, récupération après reload; expliciter les limites d'une session navigateur.
8. Tests métier existants, isolation passerelle, crash/retry, arrêt/ressources, build, navigateur réel et mesure mémoire/CPU sur scans représentatifs avant promotion.

Fichiers prévus: `cloud/browser_bridge.py`, `api/scan_browser.py`, `scripts/build_scan_runtime.py`, `web/src/scan/*`, `web/public/scan-runtime/*` générés explicitement; adaptations ciblées à `api/scan.py`, `cloud/scan_worker.py`, `CloudApp.jsx`, scripts build et `vercel.json`. Pas de changement des candidatures ni des profils privés.

## Mesures et limites

Comparer même profil, mêmes sources et mêmes conditions réseau: durée, pages, offres/min, erreurs, nombre/volume des appels backend, CPU des appels ponctuels, mémoire JS si disponible. Le heap JavaScript seul ne mesure pas toute la mémoire WASM/du navigateur. Le runtime Python a un coût de téléchargement/initialisation; plusieurs runtimes multiplient sa RAM. Ne jamais annoncer un pourcentage d'économie sans benchmark et métriques Vercel.

Un changement de vue ne détruit pas le service. Fermer l'onglet, fermer le navigateur, mettre le PC en veille ou tuer le processus interrompt le scan; la reprise utilise les checkpoints, elle ne constitue pas une exécution en arrière-plan garantie. Le chemin navigateur doit rester expérimental jusqu'aux validations réelles; les scans serveur programmés continuent avec l'ancien moteur.

## Résultat implémenté

Avant : `Browser → /api/scan → boucle Python Vercel → résultats Supabase`.

Après, pour le scan navigateur optionnel : `Browser → ScanController → Worker Python/Pyodide → opérations ponctuelles /api/scan_browser → Supabase`.

| Sur le PC utilisateur | Encore sur Vercel |
|---|---|
| Orchestration discovery/analyze/finish, gestion des lots et délais | Authentification du bearer token Supabase |
| Parsing HTML, données structurées, extraction des connecteurs et recettes | Téléchargement d'une page via le proxy public sécurisé |
| Normalisation, critères métier, classification, eligibility | Une recherche auprès d'un fournisseur, clés privées conservées serveur |
| Score, confiance, raisons, scoring final, fuzzy dedup et rapprochements historiques | Vérification user/profile/job/bail avant opérations de persistance |
| SQLite temporaire, compactage des descriptions et nettoyage des fichiers VFS | Pages de lecture et écritures bornées vers Supabase; RPC de bail et de décisions |
| Progression locale, panneau global, pause/reprise/annulation, checkpoint IndexedDB | Scans historiques et scans programmés conservés sur le chemin serveur |

Le moteur métier `stage_hunter.py` est partagé, sans réécriture approximative JavaScript. L'adaptateur browser remplace uniquement transports et exécuteur de threads. Le code public est copié par une liste explicite; `.env`, profils privés, clés de fournisseurs et service-role sont exclus. L'archive RapidFuzz conserve son implémentation Python officielle et sa licence MIT. Certaines dépendances Pyodide diffèrent des versions du serveur : la parité est validée sur une fixture, pas sur tout Internet.

La passerelle charge les descriptions historiques par pages de 25, transporte des marqueurs de longueur et des hashes SHA-256, et recharge une description complète seulement pour une fusion. Les résultats usuels et décisions sont écrits par lots; les gros lots sont découpés selon leur volume. La finalisation est reprenable, avec un curseur et des pages de 25 descriptions. Les PATCH individuels du scoring final subsistent : le transport n'est donc pas encore entièrement regroupé par lots. Les boucles de pagination d'historique et de résumé continuent jusqu'à épuisement des pages, sans coupure arbitraire à 100 000 lignes.

Le contrôleur est indépendant de la vue. Un Web Lock empêche deux onglets de piloter simultanément un compte, en complément des baux serveur. L'arrêt termine le Worker et invalide son bail; un téléchargement serveur déjà parti peut achever son appel borné. IndexedDB conserve les identifiants, métriques, puissance et 100 logs maximum, sans bearer ni HTML brut. Le checkpoint serveur conserve la file et les résultats durables. Une pause ou un rechargement détruit le runtime temporaire; la reprise le reconstruit.

### Fichiers effectivement concernés

- Backend : `api/scan_browser.py`, `cloud/browser_bridge.py`, `api/scan.py`, `cloud/scan_worker.py`, `cloud/browser_runtime.py`, `vercel.json`.
- Frontend : `web/src/scan/ScanController.js`, `WorkerPool.js`, `scan.worker.js`, `CheckpointManager.js`, `ScanPanel.jsx`, `scan-panel.css`, `web/src/cloud/CloudApp.jsx`.
- Assets/build : `scripts/build_scan_runtime.mjs`, `scripts/build_scan_runtime.py`, `web/scan-vendor/`, `web/package.json`, `.gitignore`, `.env.example`.
- Vérification : `test_browser_bridge.py`, `scripts/test_scan_controller.mjs`, `scripts/test_browser_runtime.cjs`, deux budgets explicites dans `test_stage_hunter_v6.py` pour isoler les tests des valeurs `.env` locales.

### Vérifications réalisées

- 134 tests Python passent, incluant les tests métier existants, ownership de la passerelle, baux expirés, projections interdites, miroir compact et finalisation reprenable.
- Contrôleur : 5 000 tâches simulées, logs bornés, rejet d'un second scan, pause/annulation, reprise, backend indisponible, nettoyage du Worker et stockage plein après création d'un job.
- Build cloud Vite réussi. Les avertissements de taille de chunks et de directives `use client` de framer-motion subsistent. Aucun outil TypeScript/lint n'est configuré dans ce dépôt JavaScript.
- Vrai navigateur Edge et vrai runtime Pyodide : parsing, score, confiance et motifs identiques au moteur serveur sur la fixture; deux pistes, une 404 isolée, une offre retenue; persistance et finalisation passent.
- Vrai IndexedDB : reprise après reload, isolation des comptes, suppression du checkpoint, exclusion du token/HTML. Vrai CloudApp : panneau conservé lors de la navigation vers Mes offres et le dashboard.

Avant push : intégration sur `origin/main` (`eea393e`) sans conflit; 135 tests Python passent sur cette base et le build cloud réussit. Les fichiers de villes publics utilisés par le chargeur géographique publié sont également inclus dans la liste d'assets du runtime. Les autres modifications locales du dossier principal sont exclues de cette branche.

Les appels Supabase et les pages sources de ce test navigateur sont simulés. Ce n'est pas un scan réel de production, un test RLS live ou un benchmark de facture. Le test de 5 000 tâches vérifie le contrôleur, pas la mémoire WASM de 5 000 offres réelles.

### Activation et travail restant

La route est désactivée par défaut : `BROWSER_SCAN_ENABLED=0`. Pour une validation en preview, définir `BROWSER_SCAN_ENABLED=1` côté serveur, conserver la configuration Supabase actuelle et construire le frontend cloud. Le choix du moteur navigateur apparaît lorsque `/api/scan` annonce `browser_ready`. Aucun déploiement ni secret réel n'a été modifié pendant cette migration.

Cette livraison est une base hybride fonctionnelle, **pas l'intégralité de la cible multi-workers**. Un seul runtime mutable exécute le scan, avec une requête réseau à la fois. Les quatre niveaux de puissance modifient les tailles de lots, budgets de phase et délais; le plafond matériel calculé ne constitue pas un pool multi-CPU actif. Il reste à extraire le parsing en tâches indépendantes, puis agréger leurs résultats sous un orchestrateur unique avant déduplication/persistance.

Avant activation générale : compléter ce pool, regrouper les écritures finales, tester les courses pause/écriture et la concurrence entre appareils (les écritures ordinaires vérifient le bail avant l'appel mais ne sont pas toutes atomiquement liées au bail), valider les règles Supabase réelles, comparer les dépendances sur un corpus représentatif, puis mesurer scans normal/exhaustif réels sur une heure. La RAM des métadonnées SQLite/historique augmente encore avec le nombre d'offres; aucun plafond global de mémoire WASM ni absence de fuite sur longue durée n'est démontré. Les métriques CPU serveur mesurent le process pendant les appels courts, hors imports initiaux et dernières écritures; elles ne remplacent pas les mesures Vercel Fluid. Aucun pourcentage d'économie n'est annoncé.

## Diagnostic du faux état d'initialisation

Signal rapporté en Preview : « Worker Python en cours d'initialisation… » dès l'ouverture de Recherche & Scan, aucune requête Pyodide et aucune erreur Worker. Ce texte provenait de `CloudSearchView`, condition `!workerReady`, et désignait la disponibilité annoncée par `/api/scan`. Il n'était relié ni à la création d'un Worker, ni à une promesse d'initialisation. Ouvrir la vue ne crée aucun Worker : le contrôleur ne lance l'initialisation qu'après lancement/reprise. Un moteur indisponible ou une vérification non terminée était donc présenté comme une initialisation active. L'absence de requêtes Pyodide à ce moment est attendue. Le 503 Google appartient à un effet indépendant et reste inchangé.

Le correctif distingue vérification de disponibilité (10 secondes maximum), indisponibilité/configuration, démarrage réel et échec récupérable. Le démarrage réel affiche son étape, journalise toutes les frontières et confirme READY. Un délai global de 30 secondes couvre session, chargement du job et Worker, y compris import dynamique, WASM, packages et imports Python. Le dépassement annule le transport et termine le Worker; l'UI affiche l'étape bloquée et propose Réessayer. `onerror`, `onmessageerror`, échec du constructeur, erreur de postMessage et erreur Python sont propagés et journalisés. Les accès IndexedDB ont aussi des délais, au lieu d'attendre indéfiniment.

Le Worker est généré par `new Worker(new URL('./scan.worker.js', import.meta.url), {type:'module'})`, transformé par Vite en `/assets/scan.worker-<hash>.js`. Les assets Python utilisent `BASE_URL` Vite plus `scan-runtime/`, pas un chemin relatif à l'URL du bundle `/assets/`. Pyodide, WASM et packages officiels utilisent la racine CDN absolue v0.29.3; micropip récupère les trois paquets Python épinglés. Le manifest doit répondre en JSON; un fallback SPA ou une page d'authentification HTML donne une erreur explicite. Chaque téléchargement des fichiers publics a un délai de 15 secondes; le délai global couvre également les étapes qui ne peuvent pas recevoir d'AbortSignal.

Validation du build cloud de production dans Edge : chemin complet UI → contrôleur → pool → vrai Worker → Pyodide → moteur Python → READY, puis finalisation; faux manifest HTML → erreur visible → Réessayer → READY; moteur indisponible à l'ouverture → message explicite et aucun Worker créé. Tests supplémentaires : session/backend/Worker muets, erreurs Worker, messageerror, postMessage et réponses en erreur. Les stages de démarrage sont contrôlés par assertions. Les assets sont issus de la sortie `dist-cloud`, pas du serveur Vite dev.

Le Preview inspecté via Vercel correspond au commit 68e785c et son état de déploiement est READY. Ses logs serveur montrent les GET `/api/scan` 200. L'accès automatisé aux assets protégés a ensuite redirigé vers Login Vercel; ni la lecture authentifiée des assets de ce déploiement ni une exécution réelle dessus ne sont donc confirmées. Une réponse HTML observée sur ce domaine de login n'est pas une preuve de mauvais routage du Preview. Le test complet du correctif est réalisé sur le build de production local avec un vrai runtime; auth, sources et persistance utilisent des fixtures.

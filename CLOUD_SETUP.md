# Job Hunter web : premier socle multi-utilisateur

Site déployé : https://job-hunter-three-chi.vercel.app/

État du 24 septembre 2026 : le dépôt GitHub est relié à Vercel, le site est
accessible et les quatre tables Supabase sont créées avec RLS. Aucun utilisateur
n'a encore été créé. Le réglage Supabase « Allow new users to sign up » est
encore actif : le désactiver dans Authentication > Settings > General avant de
distribuer l'accès. Configurer aussi l'URL du site dans Authentication > URL
Configuration pour les futurs courriels d'invitation et de récupération.

## Ce qui fonctionne dans ce lot

- Connexion e-mail et mot de passe avec Supabase Auth, sans inscription publique
  dans l'interface.
- Profils et offres isolés par compte grâce aux politiques RLS de PostgreSQL.
- Création et modification de profils, lecture des offres importées, Swiper,
  classement « garder / à revoir / passer » et annulation du dernier choix dans
  la session courante.
- L'application locale actuelle continue de fonctionner si les variables
  `VITE_SUPABASE_*` ne sont pas définies.

## Mise en place du prototype gratuit

1. Le projet Supabase « Job Hunter » contient la migration
   `supabase/migrations/20260924082556_initial_job_hunter_schema.sql`.
2. Dans Supabase Auth, désactiver les inscriptions publiques et créer les
   comptes autorisés. Chaque personne utilise son propre e-mail et mot de passe.
   Le connecteur actuel n'expose pas ces paramètres Auth ; cette étape se fait
   dans le tableau de bord Supabase.
3. Pour tester le mode cloud en local, copier `web/.env.cloud` vers
   `web/.env.local`. Ces deux valeurs sont destinées au navigateur.
   Ne jamais y mettre la clé `service_role`.
4. Lancer `npm run build:cloud` dans `web/` pour vérifier la compilation cloud.
   Le `vercel.json` à la racine construit ce dossier, avec `web/dist-cloud` comme
   sortie. Le build local `npm run build` reste dans `web/dist`.
   Les variables publiques cloud sont dans `web/.env.cloud` ; les
   déplacer ultérieurement vers les variables Vercel reste possible.
5. Pour essayer l'import local d'un profil, récupérer l'UUID du compte dans
   Supabase Auth puis lancer :

   ```powershell
   .\.venv\Scripts\python.exe cloud\import_local.py --profile raphael --user-id UUID_DU_COMPTE
   ```

   Cette commande ne modifie rien. Après vérification, définir `SUPABASE_URL`
   et `SUPABASE_SERVICE_ROLE_KEY` **dans le terminal local uniquement**, puis
   relancer avec `--apply`. L'import conserve les offres actives et retire la
   configuration Google du profil cloud. Il ne touche pas à la base SQLite.

## Travail restant avant un vrai service web complet

Le bouton de lancement des scans est volontairement absent du mode cloud. Le
prochain lot devra connecter une API de lancement autorisée au compte, un job
Cloud Run qui exécute le moteur Python, la remontée des événements et la
sauvegarde des résultats dans Supabase. Les journaux détaillés et la reprise
devront être transférés hors du disque temporaire du job. Les intégrations
Google devront aussi être adaptées à des jetons distincts par utilisateur.

Supabase gratuit peut mettre un projet en pause après une période d'inactivité.
Conserver une sauvegarde régulière des données reste nécessaire.

# Job Hunter web : premier socle multi-utilisateur

Site déployé : https://job-hunter-three-chi.vercel.app/

État du 24 septembre 2026 : le dépôt GitHub est relié à Vercel, le site est
accessible et les tables Supabase sont créées avec RLS. Le compte principal et
le profil web « Raphouw » existent ; les critères et 25 offres actives du
profil local Raphaël y ont été importés, ainsi que le résumé du dernier scan
pour alimenter la page Diagnostic. Le réglage Supabase « Allow new users to sign up » est
encore actif : le désactiver dans Authentication > Settings > General avant de
distribuer l'accès. Configurer aussi l'URL du site dans Authentication > URL
Configuration pour les futurs courriels d'invitation et de récupération.

## Ce qui fonctionne dans ce lot

- Connexion e-mail et mot de passe avec Supabase Auth, sans inscription publique
  dans l'interface.
- Profils et offres isolés par compte grâce aux politiques RLS de PostgreSQL.
- Création, sélection et suppression confirmée de profils, lecture des offres importées, Swiper,
  classement « garder / à revoir / passer » et annulation du dernier choix dans
  la session courante.
- Tableau de bord, résultats avec export CSV, historique des scans et diagnostic
  sur les mêmes composants visuels que la version locale. Les rubriques Google
  et automatisation sont visibles avec leur état réel côté web.
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

## Reprise des scans sur Vercel et Supabase

La migration `20260924085710_resumable_scans.sql` a été appliquée. Elle prépare
une file par profil, des candidats persistants et un verrou temporaire. Un
compte peut demander un job pour son propre profil. Seul le rôle serveur peut
prendre le job, enregistrer un checkpoint ou modifier les candidats. Un seul
scan actif par profil évite les doubles lancements ; plusieurs profils peuvent
ensuite être traités en parallèle.

Le worker `api/scan.py` réutilise `stage_hunter.py` par tranches : quelques
sources ou recherches par exécution, puis cinq candidats à la fois. Les
checkpoints, scores et décisions sont conservés dans Supabase. Le navigateur
peut lancer et annuler un scan. Supabase Cron invoque le worker chaque minute
quand un job est dû, jusqu'à quatre profils différents en parallèle. Un profil
ne peut avoir qu'un scan actif. La base est la seule source d'état durable ; le
SQLite du worker est temporaire. Le moteur local et sa base SQLite restent
indépendants.

### Activation serveur des scans

Sur le projet Vercel, ajouter les variables **Production** :

- `SUPABASE_URL` : URL HTTPS du projet Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` : clé secrète `service_role` Supabase, côté serveur uniquement.
- `CRON_SECRET` : secret aléatoire partagé avec Supabase Vault.

Créer dans Supabase Vault un secret nommé `hunter_worker_cron_secret` avec
**la même valeur** que `CRON_SECRET`. Exemple dans l'éditeur SQL Supabase :

```sql
select vault.create_secret('VALEUR_DU_CRON_SECRET', 'hunter_worker_cron_secret');
```

Ne pas enregistrer ces valeurs dans Git, `VITE_*` ou une capture d'écran. Après
déploiement, vérifier que `GET /api/scan` répond, tester un scan Rapide et sa
reprise, puis définir `SCAN_DISPATCHER_ENABLED=1` en Production et redéployer.
Cette dernière variable active le bouton sur le site. Vercel Hobby limite
chaque tranche à 300 secondes ; le code réserve une marge avant ce délai.
Tester la consommation réelle avant de multiplier les scans quotidiens.

### Connexion Google

Le client OAuth doit être de type **Application Web**. Son URI de redirection
autorisée doit correspondre exactement à
`https://job-hunter-three-chi.vercel.app/api/google?action=callback`.
Activer les API Google Sheets et Gmail et ajouter les comptes de la famille et
des collègues comme utilisateurs de test tant que l'application OAuth est en
mode test. Les autorisations Gmail peuvent nécessiter la vérification de Google
pour une utilisation publique.

Sur Vercel, ajouter `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et
`GOOGLE_TOKEN_ENCRYPTION_KEY` (32 octets aléatoires codés en base64), avec
`SUPABASE_SERVICE_ROLE_KEY` et, si le domaine change, `PUBLIC_APP_URL`.
L'API enregistre les jetons de renouvellement Google chiffrés dans
`hunter_google_connections`, table inaccessible aux comptes navigateur. La
connexion et l'export manuel des offres gardées vers Sheets sont disponibles
après configuration. La lecture Gmail est autorisée par OAuth, mais son
analyse/synchronisation web reste à intégrer au scan ; le moteur local garde
son traitement Gmail actuel.

Supabase gratuit peut mettre un projet en pause après une période d'inactivité.
La migration `20260924092105_heartbeat_probe.sql` crée une ligne publique sans
donnée personnelle. Une tâche Vercel Cron lit cette ligne trois fois par jour à
09:00 UTC via `api/keepalive.js`. Cette activité limite le risque de pause mais
ne garantit pas qu'un projet gratuit reste actif : Supabase évalue l'activité
globale. La sonde ne protège pas contre une suppression volontaire, un incident
ou une perte de données. Conserver une sauvegarde hors de Supabase reste
nécessaire ; le forfait gratuit n'inclut pas de sauvegardes automatiques.

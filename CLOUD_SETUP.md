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
- Création et modification de profils, lecture des offres importées, Swiper,
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

Le moteur local ne change pas. Son `--resume` actuel recharge la liste des
candidats après la découverte, mais ne retient pas la position exacte des
offres en cours d'analyse. Le worker web devra découper la découverte par
source et l'analyse par petits lots, écrire chaque candidat et chaque décision
dans Supabase, puis relâcher son verrou avant les cinq minutes de Vercel. Une
nouvelle exécution reprendra le lot suivant. Les écritures devront être
idempotentes grâce aux clés uniques des candidats et des offres.

Pour reprendre même quand le navigateur est fermé, utiliser **Supabase Cron**
pour appeler un dispatcher sécurisé (Edge Function), qui déclenchera la
fonction Python Vercel. Vercel Cron sur le forfait Hobby ne peut tourner
qu'une fois par jour ; il ne convient donc pas à une reprise minute par minute.
Le déclencheur, le worker Python, la sauvegarde des décisions détaillées et les
secrets serveur ne sont **pas encore branchés**. Le bouton de lancement reste
masqué pour éviter des jobs qui resteraient en attente. Les intégrations Google
demanderont également des jetons distincts par utilisateur.

Avant d'activer les scans web : configurer la clé serveur Supabase uniquement
dans les variables secrètes du worker Vercel, ajouter un secret partagé avec le
dispatcher, vérifier la limite de taille du paquet Python, tester la reprise
après interruption et valider la consommation des quotas gratuits. Ne jamais
mettre ces secrets dans `VITE_*`, `.env.cloud` ou Git.

Supabase gratuit peut mettre un projet en pause après une période d'inactivité.
La migration `20260924092105_heartbeat_probe.sql` crée une ligne publique sans
donnée personnelle. Une tâche Vercel Cron lit cette ligne trois fois par jour à
09:00 UTC via `api/keepalive.js`. Cette activité limite le risque de pause mais
ne garantit pas qu'un projet gratuit reste actif : Supabase évalue l'activité
globale. La sonde ne protège pas contre une suppression volontaire, un incident
ou une perte de données. Conserver une sauvegarde hors de Supabase reste
nécessaire ; le forfait gratuit n'inclut pas de sauvegardes automatiques.

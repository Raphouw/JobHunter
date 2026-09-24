# Job Hunter web : premier socle multi-utilisateur

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

1. Créer un projet Supabase gratuit. Dans SQL Editor, appliquer
   `supabase/migrations/202609230001_initial.sql`.
2. Dans Supabase Auth, désactiver les inscriptions publiques et créer les
   comptes autorisés. Chaque personne utilise son propre e-mail et mot de passe.
3. Dans `web/`, créer `.env.local` à partir de `.env.example` avec l'URL et la
   clé **publishable** du projet. Ces deux valeurs sont destinées au navigateur.
   Ne jamais y mettre la clé `service_role`.
4. Lancer `npm run build` pour vérifier la compilation. Pour Vercel, choisir
   `web/` comme dossier racine, le framework Vite, `npm run build` comme commande
   et `dist` comme dossier de sortie. Définir les mêmes variables publiques dans
   les paramètres Vercel avant le déploiement.
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

# Mes CV

L’onglet **Mes CV** intègre le générateur fourni (`CV_builder/cv-builder_test_save.html`, copie collée par l’utilisateur) dans la navigation React locale et cloud.

- Créer plusieurs CV par profil, choisir leur titre, les rouvrir, les dupliquer et les supprimer.
- **Enregistrer** conserve le document complet en base : textes, mise en page, couleurs, photo, sections et graphiques. Une révision empêche l’écrasement silencieux par deux fenêtres.
- **Télécharger PDF** exporte la version actuellement affichée au format A4 et utilise le titre comme nom du fichier. Il n’est pas nécessaire de sauvegarder pour télécharger.
- Le bouton **Charger** de l’éditeur importe les anciens fichiers JSON. Créer d’abord un CV, importer le JSON puis cliquer **Enregistrer**.
- Les brouillons sont conservés dans `sessionStorage`, par compte/profil/CV, pour pouvoir revenir à un CV après avoir changé d’onglet. Ils ne remplacent pas la sauvegarde en base et disparaissent à la fermeture de la session du navigateur.

## Stockage

Cloud : table `public.hunter_cvs`, migration `supabase/migrations/20260930103906_cv_library.sql`. Les règles RLS limitent les quatre opérations au propriétaire. La clé étrangère composée vérifie que le profil appartient au même compte. La migration a été appliquée au projet Supabase **Job Hunter**. Pour un nouvel environnement, appliquer les migrations avant d’utiliser cet onglet.

Local : table `hunter_cvs` créée automatiquement dans `output/<profil>/stage_hunter.sqlite3`, via `cv_store.py` et `/api/cvs`. Les CV sont indépendants par profil. Taille maximale du document : environ 1,8 Mo ; réduire la photo si nécessaire.

## Éditeur et PDF

L’éditeur vit dans une iframe à origine opaque (`allow-scripts allow-downloads allow-modals`). Il ne reçoit aucun jeton Supabase. Une communication `postMessage` vérifie la fenêtre source des deux côtés. Son ancien stockage global est remplacé par un stockage mémoire ; la bibliothèque React gère les sauvegardes.

Le PDF réutilise la préparation A4 et la pagination du générateur. Le document exporté est purifié puis rendu dans une iframe temporaire dédiée. Une CSP autorise uniquement la bibliothèque PDF locale avec un nonce aléatoire ; les scripts et attributs exécutables du contenu importé sont supprimés. Le téléchargement est déclenché depuis l’application pour fonctionner après le nettoyage de l’iframe.

Les bibliothèques du générateur sont copiées localement avec leurs notices : DOMPurify 3.0.6, html2pdf.js 0.10.1, Sortable 1.15.0, qrcodejs 1.0.0. L’éditeur et le moteur PDF sont chargés à la demande. `scripts/prepare_cv_editor.py <fichier-html-source>` permet de régénérer la copie adaptée.

## Vérification

- `python -m unittest test_cv_store -v` : plusieurs CV, réouverture, révisions concurrentes, séparation des profils et validation des entrées.
- `supabase/tests/cv_library.sql` : CRUD, propriétaire, autre compte, profil d’un autre compte, utilisateur anonyme et incrément de révision. Le test utilise une transaction annulée, sans conserver les données de test.
- `scripts/test_cv_browser.cjs` : parcours React et iframe avec une base SQLite temporaire, import JSON et véritable téléchargement PDF. Utilise Playwright depuis `CODEX_NODE_MODULES` et Python depuis `CODEX_PYTHON`. Compiler d’abord la version locale dans `web/dist-cv-check` avec les trois variables `VITE_SUPABASE_*` vides.

L’intégration ne déploie pas le frontend sur Vercel. Le déploiement habituel compile `web` en mode cloud ; la version locale peut être recompilée pour le lanceur Python.

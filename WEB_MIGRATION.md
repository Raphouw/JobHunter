# Migration web de Job Hunter

Le nouveau socle multi-utilisateur Supabase et Vercel est décrit dans
`CLOUD_SETUP.md`. Les réglages ci-dessous concernent l'ancien serveur Python
dans un usage privé ; ils ne constituent pas l'architecture cloud cible.

## État actuel

L'interface React et l'API Python sont servies ensemble. Le mode local continue à
écouter sur `127.0.0.1:8501`. Le serveur accepte désormais une adresse et un port
configurables ; une écoute sur le réseau exige un identifiant et un mot de passe.
Les requêtes de modification provenant d'une autre origine sont refusées.

## Essai privé sur un serveur

1. Installer les dépendances Python, puis compiler `web/` avec `npm run build`.
2. Copier `.env.example` en `.env`, choisir `STAGE_HUNTER_HOST=0.0.0.0`,
   `STAGE_HUNTER_WEB_USER` et un mot de passe long dans
   `STAGE_HUNTER_WEB_PASSWORD`. Ne pas versionner ce fichier.
3. Placer l'application derrière un proxy HTTPS avec un nom de domaine et ne
   laisser accéder au port Python que le proxy. Le mot de passe HTTP Basic doit
   toujours transiter sous HTTPS.
4. Prévoir un disque persistant pour `output/`, `config/profiles/`, `credentials/`
   et `.env`, ainsi qu'une sauvegarde de ces dossiers. Le processus doit pouvoir
   écrire dans ces emplacements.
5. Démarrer `python stage_hunter_web.py` comme service maintenu actif par la
   plateforme d'hébergement.

## Limites avant une ouverture à plusieurs utilisateurs

- Tous les profils restent accessibles au même compte web. Il n'existe pas
  encore de comptes séparés ni d'isolation des données par utilisateur.
- Un seul scan peut être lancé à la fois. Il s'exécute dans un sous-processus
  lié au serveur web ; une plateforme qui arrête les processus inactifs ou limite
  les requêtes longues ne convient pas sans déplacer les scans dans un worker.
- La planification intégrée utilise le Planificateur Windows et ne fonctionne
  pas sur un serveur Linux.
- SQLite et les fichiers de sortie supposent un stockage persistant local. Un
  hébergement statique du seul frontend ne peut pas exécuter le moteur Python.
- Les identifiants Google et les données de profils ne doivent jamais être
  copiés dans les fichiers publics de `web/dist`.

Cette étape prépare un essai web privé sur une seule instance. Avant une mise
en ligne publique, il faudra choisir l'hébergement, assurer HTTPS, sauvegardes,
séparation des utilisateurs et exécution fiable des scans en arrière-plan.

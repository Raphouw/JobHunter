# Prompt — outil de configuration des sites de listings

Implémente dans Job Hunter un outil de configuration des sites de listings, propre à chaque profil utilisateur.

L’utilisateur doit pouvoir ajouter et modifier un site avec son URL de recherche, les paramètres de mots clés et de localisation, la pagination, les limites de pages et d’offres, ainsi que des sélecteurs CSS pour les cartes et les pages de détail. Les champs à extraire sont le lien de l’offre, le titre, l’entreprise, le lieu, le contrat, la date, la description et le lien de candidature. Le lien et le titre sont obligatoires. L’extracteur générique reste disponible pour les sites sans recette.

Avant activation, propose un test réel sur une page du site. Affiche les offres extraites, leurs champs et les champs manquants. Si la configuration change, demande un nouveau test. Permets d’enregistrer un brouillon et de désactiver un site. Stocke les recettes dans le profil existant, sans écraser ses autres réglages.

Le scanner doit parcourir les pages de listing selon la recette, produire des liens vers les offres individuelles et joindre aux candidats les informations déjà extraites. Les pages de détail seront ensuite téléchargées par le parcours de scan, après vérification de l’historique des URL. Fusionne les données de la recette avec les données structurées de la page de détail, en conservant la meilleure information pour chaque champ.

Protège le test serveur contre les URL internes, les redirections dangereuses, les pages trop grandes et les temps d’attente excessifs. Vérifie l’authentification et la propriété du profil. Ajoute des tests pour la validation, l’extraction, la pagination, le test avant activation et l’intégration au scanner. Documente l’utilisation dans le README.

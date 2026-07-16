# Migration des données historiques

## Principe

Les données de l'ancien Best Friend sont enregistrées dans le navigateur du
propriétaire sous la clé locale `gites_v2`. Elles ne sont donc ni dans GitHub,
ni sur le VPS, ni récupérables à distance.

Le pont préparé dans legacy-bridge/ doit être publié sur **l'ancien domaine**
pour partager exactement la même origine navigateur. Il ne contacte aucun
serveur : il lit les données locales puis télécharge une sauvegarde JSON signée
par SHA-256.

## Garde-fous

- aucun déploiement du pont sans validation explicite d'Emmanuel ;
- aucune donnée historique écrite dans le dépôt ;
- fichier versionné, compté et contrôlé avant import ;
- sauvegarde automatique de l'espace cible avant remplacement ;
- import réservé aux rôles owner et admin ;
- remplacement transactionnel dans une seule organisation ;
- trois états précédents conservés côté serveur pour un retour à un clic ;
- journal d'audit après succès ;
- aucune modification si une ligne ou le contrôle d'intégrité est invalide.

## Préparation

    npm run build:legacy-bridge

Le dossier dist-legacy-bridge/ contient seulement :

- backup.js ;
- migration/index.html.

Une fois copié sur l'ancien site, le propriétaire ouvre `/migration/` et appuie sur
**Télécharger ma sauvegarde**. La restauration dans le nouvel espace affiche les
compteurs avant toute écriture.

## Validation avant bascule

1. conserver le fichier original sans le modifier ;
2. noter les quatre compteurs du pont ;
3. créer/exporter la sauvegarde de la cible ;
4. restaurer dans l'organisation de validation ;
5. comparer les compteurs base/source ;
6. tester avec le propriétaire puis une conciergerie ;
7. ne basculer l'URL définitive qu'après validation écrite.

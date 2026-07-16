# Best Friend — architecture produit v4

## Cap

Best Friend est un cockpit privé propriétaire–conciergerie. Aucun nom, numéro,
logement ou droit spécial ne doit être codé dans le produit.

La promesse de l'interface propriétaire est simple : montrer ce qui réclame une
décision et masquer entièrement les coulisses techniques.

## Deux surfaces

### Application métier

- Aujourd'hui : arrivées, départs, rotations et incidents.
- Locations : état et historique de chaque bien.
- Équipe : invitations et affectations simples.
- Bilan : occupation, revenus, dépenses et qualité d'exécution.

### Cockpit opérateur

- organisations et abonnements ;
- santé des synchronisations ;
- erreurs et reprises automatiques ;
- sauvegardes et migrations ;
- journal d'audit ;
- assistance tracée.

GitHub, Supabase, SQL, API et clés fournisseurs ne sont jamais exposés dans
l'application métier.

## Isolation des données

Chaque ligne métier appartient à une organisation (`org_id`). L'accès est
contrôlé dans PostgreSQL par RLS, indépendamment de l'interface :

- `owner`, `admin`, `manager` : pilotage complet de l'organisation ;
- `concierge` : uniquement les biens qui lui sont affectés ;
- `viewer` : lecture des biens affectés.

L'ancien mécanisme « premier compte créé = administrateur » est interdit. Une
organisation est toujours créée par l'opérateur ; un collaborateur rejoint un
espace uniquement via une invitation liée à l'adresse vérifiée de son compte.

## Secrets et notifications

Les clés WhatsApp, SMS, email et push restent côté serveur. Le navigateur ne
conserve que des préférences non sensibles. Une panne fournisseur est envoyée
au cockpit opérateur ; l'utilisateur métier reçoit seulement un état lisible.

## Migration

Le schéma v4 utilise des tables `bf_*` parallèles. Le prototype v3 reste intact
jusqu'à ce que les étapes suivantes soient terminées :

1. export JSON horodaté ;
2. sauvegarde de la base ;
3. création de l'organisation Best Friend ;
4. import contrôlé avec comptage avant/après ;
5. test propriétaire et concierge ;
6. bascule réversible.

L'import v4 est transactionnel et réservé aux rôles `owner` et `admin`.
Chaque remplacement crée d'abord un instantané serveur immuable ; les trois
derniers états sont conservés et l'interface peut rétablir le plus récent sans
SQL. Un fichier invalide ou incomplet ne modifie aucune ligne.

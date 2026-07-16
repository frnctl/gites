# Provisionnement d’un espace sans manipulation technique

Cette procédure est réservée à l'opérateur. Le propriétaire
ne voit ni Supabase, ni SQL, ni clé : son espace existe déjà lorsqu'il ouvre son
lien de connexion.

## Résultat

Une seule commande confirmée :

1. crée ou réutilise le compte Auth du propriétaire ;
2. crée transactionnellement son organisation et son rôle `owner` ;
3. ne crée aucun doublon si elle est relancée avec la même clé ;
4. envoie, sur demande explicite, le lien de connexion sans mot de passe.

Le provisionnement ne crée aucun bien et n'importe aucune donnée historique.

## Préflight sans effet externe

```bash
BF_TENANT_KEY=espace-validation \
BF_TENANT_OWNER_EMAIL=proprietaire@example.fr \
BF_TENANT_NAME='Locations Validation' \
BF_TENANT_OWNER_NAME='Nom du propriétaire' \
npm run tenant:provision
```

La sortie masque l'adresse et ne contient aucune clé. Sans
`BF_TENANT_CONFIRM=PROVISION`, aucun compte, email ou enregistrement n'est créé.

## Exécution opérateur

Les trois valeurs Supabase doivent provenir de Sanctum. La clé `service_role`
reste exclusivement dans le processus serveur et ne doit jamais être injectée
dans le build Cloudflare.

```bash
BF_TENANT_KEY=espace-validation \
BF_TENANT_OWNER_EMAIL=proprietaire@example.fr \
BF_TENANT_NAME='Locations Validation' \
BF_TENANT_OWNER_NAME='Nom du propriétaire' \
BF_TENANT_CONFIRM=PROVISION \
BF_TENANT_SEND_MAGIC_LINK=YES \
BF_SITE_URL=https://best-friend-app.pages.dev \
BF_SUPABASE_URL="$(sanctum get supabase.best_friend_url)" \
BF_SUPABASE_ANON_KEY="$(sanctum get supabase.best_friend_anon_key)" \
BF_SUPABASE_SERVICE_ROLE_KEY="$(sanctum get supabase.best_friend_service_role)" \
npm run tenant:provision
```

La clé stable `BF_TENANT_KEY` identifie l’espace livré. Une relance conserve la même
organisation. Si la création transactionnelle échoue juste après la création
d'un nouveau compte, la commande supprime automatiquement ce compte orphelin.
Si seul l'envoi d'email échoue, la relance est sûre et renvoie le lien.

## Contrôle après connexion

- le propriétaire arrive directement dans son espace, sans écran de création ;
- le badge affiche `Propriétaire` ;
- aucun autre espace ou bien n'est visible ;
- `/control` est accessible ;
- la création d'un bien puis un rechargement confirme la synchronisation ;
- l'invitation d'une conciergerie reste limitée aux biens cochés.

La documentation Supabase rappelle que les opérations Admin doivent rester côté
serveur et que `shouldCreateUser: false` empêche le lien magique de créer un
compte inattendu :

- https://supabase.com/docs/reference/javascript/auth-admin-listusers
- https://supabase.com/docs/guides/auth/auth-email-passwordless

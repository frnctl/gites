# Provisionnement de la validation hébergée

Ces commandes sont destinées uniquement à l'opérateur.

## État actuel

- projet Supabase isolé `best-friend-validation` actif en `eu-west-3` ;
- référence et accès conservés uniquement dans Sanctum ;
- migrations `20260710_001`, `20260711_002` et `20260715_003` requises ;
- URL, clés et mot de passe rangés uniquement dans Sanctum ;
- application reliée à ce backend sur `https://best-friend-app.pages.dev` ;
- aucune donnée réelle, aucun compte et aucune organisation persistante ;
- anciens projets Supabase, ancien site et données réelles non modifiés.

## Automatisation prête

Une fois le jeton personnel fourni uniquement par variable d'environnement :

    npm run hosted:preflight

Le préflight liste uniquement les organisations, les projets accessibles et un
éventuel projet best-friend-validation. Il ne crée rien.

La commande suivante affiche le projet qui serait créé :

    BF_SUPABASE_ORG_SLUG=organisation npm run hosted:plan

La création exige explicitement :

- BF_SUPABASE_CONFIRM_CREATE=YES ;
- BF_SUPABASE_DB_PASSWORD fourni depuis Sanctum ;
- le jeton SUPABASE_ACCESS_TOKEN fourni depuis Sanctum.

Le schéma utilise lui aussi deux passes :

    bash scripts/apply-hosted-schema.sh

La première exécute seulement db push --dry-run. L'application réelle exige
BF_SUPABASE_CONFIRM_SCHEMA=YES. Aucun seed et aucune donnée historique ne sont
inclus.

Enfin, le mode configure-auth prépare les URL de retour de l'aperçu Cloudflare.
Il conserve par défaut la preview et le labo local, chacun sur `/` et
`/control`. Il exige BF_SUPABASE_CONFIRM_CONFIGURE=YES avant toute modification.
La liste complète peut être remplacée explicitement avec
`BF_SUPABASE_REDIRECT_URLS`, sous forme d'URL séparées par des virgules.

## Ordre opératoire

1. autoriser une fois le compte Supabase de l'opérateur ;
2. ranger le jeton et le mot de passe généré dans Sanctum ;
3. exécuter le préflight ;
4. créer ou réutiliser best-friend-validation ;
5. exécuter le dry-run SQL puis la migration vide ;
6. configurer les URL d'authentification ;
7. injecter uniquement l'URL et la clé publique dans le build Pages ;
8. créer un propriétaire de recette avec `npm run tenant:provision` ;
9. vérifier qu'il arrive directement dans son espace déjà préparé ;
10. refaire les tests owner, concierge, récupération et isolation ;
11. demander une autorisation distincte avant toute reprise des données réelles.

Le détail du provisionnement opérateur est dans
[`PROVISIONNEMENT-ESPACE.md`](PROVISIONNEMENT-ESPACE.md).

## Recette backend jetable

`npm run backend:validate` reste en dry-run tant que
`BF_BACKEND_VALIDATE=RUN` n'est pas fourni. La commande refuse l'environnement
`production` et vérifie que l'hôte Supabase correspond exactement à
`BF_EXPECTED_PROJECT_REF`.

Préflight sans clé :

```bash
BF_BACKEND_ENVIRONMENT=validation \
BF_EXPECTED_PROJECT_REF=reference_du_projet \
BF_SUPABASE_URL=https://reference_du_projet.supabase.co \
npm run backend:validate
```

Recette confirmée, uniquement sur le projet vide de validation :

```bash
BF_BACKEND_ENVIRONMENT=validation \
BF_EXPECTED_PROJECT_REF=reference_du_projet \
BF_BACKEND_VALIDATE=RUN \
BF_SITE_URL=https://best-friend-app.pages.dev \
BF_SUPABASE_URL="$(sanctum get supabase.best_friend_url)" \
BF_SUPABASE_ANON_KEY="$(sanctum get supabase.best_friend_anon_key)" \
BF_SUPABASE_SERVICE_ROLE_KEY="$(sanctum get supabase.best_friend_service_role)" \
npm run backend:validate
```

La recette crée uniquement trois comptes `@best-friend.test` et deux
organisations préfixées `bf-recipe-`. Elle vérifie Auth, le lien magique, les
privilèges opérateur, la RLS par bien, la restauration, deux propriétaires et
une conciergerie partagée. La phase finale supprime ensuite organisations et
comptes, même lorsqu'un contrôle échoue. Le succès exige `cleanup: complete`.

## Recette navigateur hébergée

La recette suivante consomme réellement un lien magique dans Chromium, arrive
sur `/control`, crée un bien depuis l'interface, vérifie sa persistance après
rechargement, puis contrôle la déconnexion et la purge du cache privé :

```bash
BF_BACKEND_ENVIRONMENT=validation \
BF_EXPECTED_PROJECT_REF=reference_du_projet \
BF_FRONTEND_VALIDATE=RUN \
BF_SITE_URL=https://best-friend-app.pages.dev \
BF_SUPABASE_URL="$(sanctum get supabase.best_friend_url)" \
BF_SUPABASE_ANON_KEY="$(sanctum get supabase.best_friend_anon_key)" \
BF_SUPABASE_SERVICE_ROLE_KEY="$(sanctum get supabase.best_friend_service_role)" \
npm run frontend:validate
```

La clé d'administration reste dans le processus Node et n'est jamais injectée
dans la page. Le compte, l'organisation et le bien de recette sont supprimés
dans tous les cas. Le succès exige lui aussi `cleanup: complete`.

# Best Friend

Best Friend est un cockpit propriétaire–conciergerie pour piloter des locations
saisonnières sans exposer la technique aux utilisateurs métier. Le produit est
livré comme un espace privé à accès provisionné, pas comme un service ouvert à
l'inscription publique.

## État de la branche v4

- PWA installable, responsive et consultable hors ligne en lecture seule ;
- connexion Supabase par lien email, sans mot de passe à retenir ;
- auto-inscription désactivée : comptes et espaces préparés par l'opérateur ;
- organisations séparées par `org_id` ;
- rôles propriétaire, administrateur, gestionnaire, concierge et lecture ;
- RLS testée entre plusieurs organisations ;
- clés fournisseurs absentes du navigateur ;
- build reproductible pour Cloudflare Pages ;
- centre de pilotage propriétaire disponible sur /control ;
- client Supabase embarqué dans le build, sans dépendance CDN au démarrage ;
- sauvegardes versionnées avec contrôle SHA-256 et récupération serveur ;
- invitations transmises par le Worker privé, sans clé d'administration dans le navigateur ;
- calendriers iCal récupérés par un proxy authentifié à liste blanche ;
- preuves photo stockées dans un bucket privé, avec URL temporaires ;
- pont historique à un clic préparé séparément, mais non déployé sur l'ancien site ;
- provisionnement opérateur idempotent : compte et espace prêts avant la première connexion ;
- backend Supabase de validation isolé et preview Cloudflare reliée, sans donnée réelle ;
- recette navigateur hébergée : lien magique, écriture cloud, rechargement et déconnexion ;
- ancien prototype et anciennes tables laissés intacts.

Le code est prêt pour une livraison privée. Le déploiement actuellement relié
au backend de validation ne contient aucune donnée réelle ; la bascule de cible
reste une opération séparée et contrôlée.

## Démarrage

```bash
npm install
npm run build
node scripts/serve.mjs
```

Ouvrir ensuite :

- `http://127.0.0.1:4173/` pour la façade non connectée ;
- `http://127.0.0.1:4173/?demo=1` pour des données fictives.
- `http://127.0.0.1:4173/control?demo=1` pour le centre de pilotage fictif.

## Tests

```bash
npm test
```

La suite vérifie la syntaxe, la PWA, les parcours bureau/mobile, la migration
PostgreSQL relançable, les sauvegardes signées, la récupération et l'isolation
RLS. Les tests SQL utilisent uniquement un conteneur PostgreSQL jetable.

Avec le labo Supabase local démarré, les parcours Auth/API et le navigateur
authentifié se testent séparément :

```bash
npm run lab:start
npm run test:supabase-local
npm run test:e2e-auth
npm run lab:stop
```

Le validateur du backend hébergé possède un dry-run, une garde
anti-production et un nettoyage systématique :

```bash
npm run backend:validate
npm run frontend:validate
```

La procédure complète est dans
[`docs/VALIDATION-HEBERGEE.md`](docs/VALIDATION-HEBERGEE.md).

Le démarrage bloque les ports Docker de test depuis l'extérieur. L'arrêt
sauvegarde le volume local puis retire ces règles temporaires.

## Configuration cloud

Le build accepte uniquement les valeurs publiques Supabase :

```bash
BF_ENVIRONMENT=preview \
BF_RELEASE_REVISION=$(git rev-parse --short HEAD) \
BF_SUPABASE_URL=https://example.supabase.co \
BF_SUPABASE_ANON_KEY=public-key \
npm run build
```

Les clés privées de notification, d'administration et de déploiement restent
dans Sanctum ou dans les secrets de la plateforme. Elles ne sont jamais écrites
dans `config.js`. En production, le Worker Pages exige le secret serveur
`BF_SUPABASE_SERVICE_ROLE_KEY` pour envoyer les invitations.

## Base de données

Le schéma courant est défini par :

- [`supabase/migrations/20260710_001_multitenant_foundation.sql`](supabase/migrations/20260710_001_multitenant_foundation.sql)
- [`supabase/migrations/20260711_002_harden_function_privileges.sql`](supabase/migrations/20260711_002_harden_function_privileges.sql)
- [`supabase/migrations/20260715_003_private_delivery_and_proofs.sql`](supabase/migrations/20260715_003_private_delivery_and_proofs.sql)

Ils créent des tables `bf_*` sans toucher aux tables du prototype. Aucune migration
de données réelles ne doit être exécutée sans export, sauvegarde et comptage
avant/après.

La procédure de reprise locale est décrite dans
[`docs/MIGRATION-HISTORIQUE.md`](docs/MIGRATION-HISTORIQUE.md).
Le parcours de création d’un espace sans manipulation technique est décrit dans
[`docs/PROVISIONNEMENT-ESPACE.md`](docs/PROVISIONNEMENT-ESPACE.md).

## Cloudflare Pages

Le dossier `dist/` est directement publiable avec Wrangler :

```bash
CLOUDFLARE_API_TOKEN="$(sanctum get cloudflare.best_friend_pages_token)" \
npx wrangler pages deploy dist \
  --project-name best-friend-app \
  --branch main
```

La cible de validation est un projet Pages distinct du futur domaine de
production. Une URL de branche ou de déploiement est utilisée pour les essais.

Le choix d'hébergement et ses limites sont documentés dans
[`docs/ADR-001-HEBERGEMENT.md`](docs/ADR-001-HEBERGEMENT.md).
La checklist de livraison est dans
[`docs/MISE-EN-PRODUCTION.md`](docs/MISE-EN-PRODUCTION.md).
Le PDF livré dans l’application est généré depuis
[`docs/GUIDE-UTILISATEUR.html`](docs/GUIDE-UTILISATEUR.html) avec
`npm run guide:build`.

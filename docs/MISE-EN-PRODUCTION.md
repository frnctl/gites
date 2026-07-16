# Mise en production privée

## Prérequis bloquants

- les trois migrations Supabase sont appliquées dans l'ordre ;
- l'inscription Auth publique reste désactivée ;
- les URL de redirection Auth contiennent uniquement le domaine livré ;
- un SMTP personnalisé est configuré et un lien de connexion réel est reçu ;
- le secret Pages `BF_SUPABASE_SERVICE_ROLE_KEY` est défini côté Worker ;
- le build contient une révision non locale ;
- `npm test`, `npm run test:supabase-local` et `npm run test:e2e-auth` passent ;
- une sauvegarde exportée et une restauration de recette ont été vérifiées.

## Build

```bash
BF_ENVIRONMENT=production \
BF_RELEASE_REVISION="$(git rev-parse --short HEAD)" \
BF_SUPABASE_URL="$(sanctum get supabase.best_friend_url)" \
BF_SUPABASE_ANON_KEY="$(sanctum get supabase.best_friend_anon_key)" \
npm run build
```

Seules l'URL et la clé publique sont injectées dans `dist/`. La clé
`service_role` doit rester un secret de l'environnement Cloudflare Pages.

## Secret et déploiement Pages

Définir le secret serveur une fois sur le projet, sans l'écrire dans un fichier
ni l'afficher dans le terminal :

```bash
sanctum get supabase.best_friend_service_role | \
  npx wrangler pages secret put BF_SUPABASE_SERVICE_ROLE_KEY \
  --project-name best-friend-app
```

Puis publier uniquement l'artefact contrôlé :

```bash
CLOUDFLARE_API_TOKEN="$(sanctum get cloudflare.best_friend_pages_token)" \
npx wrangler pages deploy dist \
  --project-name best-friend-app \
  --branch main
```

Le déploiement n'est considéré sain qu'après réponse de `/api/health` avec la
révision attendue et réception d'un vrai lien de connexion.

## Contrôle avant ouverture

1. provisionner l'espace propriétaire avec `npm run tenant:provision` ;
2. vérifier le lien magique sur ordinateur et mobile ;
3. créer un bien, recharger la page et confirmer sa persistance ;
4. inviter une concierge, vérifier l'email et l'accès au seul bien affecté ;
5. importer un calendrier autorisé et contrôler son rafraîchissement ;
6. ajouter puis supprimer une preuve photo ;
7. exporter une sauvegarde et tester le retour à l'état précédent ;
8. vérifier `/api/health` et la révision déployée ;
9. seulement ensuite, autoriser la reprise des données réelles et le domaine final.

## Retour arrière

Conserver le dernier déploiement Pages sain et l'export JSON précédant toute
reprise. En cas d'incident de données, utiliser l'instantané serveur créé avant
la restauration. En cas d'incident applicatif, restaurer le déploiement Pages
précédent sans modifier la base.

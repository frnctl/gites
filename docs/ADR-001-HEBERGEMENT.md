# ADR-001 — Hébergement et backend

Statut : retenu pour la livraison privée.

## Décision

- **Cloudflare Pages** héberge la PWA, la démonstration et le centre
  /control.
- **Supabase géré** fournit l'authentification par lien email, PostgreSQL et les
  règles RLS multi-tenant.
- Le propriétaire et les conciergeries ne voient ni Cloudflare, ni Supabase, ni SQL.
- Les secrets d'administration restent exclusivement côté opérateur.

Cette séparation conserve une façade rapide et peu coûteuse sans réécrire un
système d'authentification sensible.

## Pourquoi pas D1 comme backend principal maintenant

Cloudflare D1 est techniquement adapté aux données métier et son quota gratuit
est généreux. En revanche, D1 ne fournit pas l'authentification SaaS des
utilisateurs. Construire nous-mêmes les liens magiques, sessions, révocations et
protections anti-abus ajouterait une surface de sécurité inutile.

Cloudflare Access n'est pas retenu : l'identité Supabase permet de gérer les
rôles et les affectations métier dans l'application privée.

D1 pourra être ajouté plus tard pour un annuaire public ou un index de recherche
séparé, sans contenir les données privées des locations.

## Passage en production

1. Créer un projet Supabase contrôlé par l'opérateur.
2. Appliquer la migration bf_* sur ce projet vide.
3. Tester les invitations et l'isolation avec des comptes de recette.
4. Importer les données historiques uniquement après export, sauvegarde et
   comptage.
5. Activer SMTP personnalisé et sauvegardes adaptées au niveau de disponibilité
   attendu avant d'introduire les données réelles.

## Références vérifiées le 11 juillet 2026

- Cloudflare D1 : 5 millions de lignes lues et 100 000 écrites par jour sur le
  plan gratuit :
  https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare Workers Free : 100 000 requêtes par jour :
  https://developers.cloudflare.com/workers/platform/limits/
- Liaison D1 avec Pages Functions :
  https://developers.cloudflare.com/pages/functions/bindings/
- Supabase Free : 50 000 utilisateurs actifs mensuels et base de 500 Mo :
  https://supabase.com/pricing

# Accès & collaborateurs — mode d'emploi

L'app gère maintenant **Bruno (admin)** + des **concierges** qui ne voient que **leur(s) appartement(s)**.

## 1. Mettre à jour la base (à faire UNE fois)

> ⚠️ Cette étape remet à zéro les tables cloud. C'est sans risque : il n'y a pas
> encore de données réelles. À ne **pas** refaire une fois que Bruno aura saisi
> ses vraies réservations.

1. Ouvre le **SQL Editor** de Supabase :
   https://supabase.com/dashboard/project/rujozrissqjvvhghltix/sql/new
2. Copie **tout** le contenu de [`schema.sql`](schema.sql) → colle → **Run** ▶️
3. Message vert « Success » = c'est bon.
   (Une ligne rouge `already member of publication` = normal, on l'ignore.)

## 2. Devenir admin (automatique)

Le **premier** qui se connecte à l'app devient **admin ultime** automatiquement.
→ Bruno se connecte en premier : il est admin, il voit tout. ✅

## 3. Ajouter une concierge (depuis l'app, sans toucher à Supabase)

1. Bruno ouvre l'onglet **Biens** → panneau **« Collaborateurs & accès »**.
2. Clic **+ Inviter** → saisir l'**email** de la concierge → cocher son/ses
   **appartement(s)** → **Enregistrer**.
3. La concierge **crée son compte** dans l'app avec **ce même email** (+ un mot
   de passe à elle). Dès la connexion, elle ne voit **que** ses appartements.

> Exemple : Maria → Studio · Anabela → Atelier.

## 4. Fermer les inscriptions (quand l'équipe est au complet)

Pour empêcher de nouveaux comptes :
Supabase → **Authentication → Sign In / Providers** → désactive
**« Allow new users to sign up »** → Save.
Pour une future concierge, il suffira de la réactiver le temps qu'elle crée son
compte (après l'avoir invitée à l'étape 3).

## Bon à savoir

- La sécurité est **côté serveur** (RLS Supabase) : même en bidouillant le
  navigateur, une concierge ne peut pas lire les données d'un autre appartement.
- Bruno peut nommer un autre **admin** (rôle « Admin ») depuis le même panneau.
- L'annuaire des intervenants est visible par tous, modifiable par l'admin.

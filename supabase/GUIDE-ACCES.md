# Comptes et accès

L'utilisateur métier ne touche jamais à Supabase, SQL ou GitHub.

## Propriétaire

1. Ouvrir Best Friend.
2. Saisir son email.
3. Appuyer sur le lien reçu.
4. Accéder directement à son organisation.

## Concierge ou prestataire

1. Le propriétaire ouvre **Biens → Collaborateurs & accès**.
2. Il saisit le nom, l'email, le rôle et les biens autorisés.
3. La personne invitée se connecte avec la même adresse email.
4. L'invitation est acceptée automatiquement.

La sécurité est appliquée dans PostgreSQL par RLS. Masquer un bouton dans
l'interface n'est jamais considéré comme une protection suffisante.

## Opérateur

L'opérateur prépare les organisations, surveille les synchronisations, traite
les erreurs et pilote les sauvegardes. Les utilisateurs métier ne reçoivent
aucune procédure technique.

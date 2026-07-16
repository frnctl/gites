-- Best Friend — point d'entrée volontairement non destructif
--
-- L'ancien schéma v3 supprimait les tables avant de les recréer. Il a été
-- neutralisé afin d'empêcher toute perte accidentelle de données.
--
-- Schéma courant :
--   supabase/migrations/20260710_001_multitenant_foundation.sql
--   supabase/migrations/20260711_002_harden_function_privileges.sql
--   supabase/migrations/20260715_003_private_delivery_and_proofs.sql
--
-- Ce fichier ne réalise aucune modification lorsqu'il est exécuté.

select 'Aucune action : utiliser la migration multi-tenant validée.' as message;

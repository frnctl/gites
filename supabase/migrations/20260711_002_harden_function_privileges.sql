-- Best Friend v4 — normalisation des privilèges de fonctions sur Supabase géré
--
-- La plateforme hébergée accorde explicitement EXECUTE aux rôles API lors de
-- la création d'une fonction. Un REVOKE limité à PUBLIC ne retire pas ces ACL.
-- Cette migration fixe les rôles exacts et protège notamment le
-- provisionnement opérateur.

begin;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

revoke all on function public.bf_create_organization(text)
  from public, anon, authenticated, service_role;
revoke all on function public.bf_accept_invitations()
  from public, anon, authenticated, service_role;
revoke all on function public.bf_list_my_organizations()
  from public, anon, authenticated, service_role;
revoke all on function public.bf_invite_member(uuid, text, text, text, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.bf_remove_member(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.bf_replace_snapshot(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.bf_restore_snapshot(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.bf_operator_provision_organization(
  text, uuid, text, text, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.bf_touch_updated_at()
  from public, anon, authenticated, service_role;
revoke all on function public.bf_current_email()
  from public, anon, authenticated, service_role;
revoke all on function public.bf_is_member(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.bf_has_role(uuid, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.bf_can_manage(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.bf_can_access_property(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.bf_create_organization(text) to authenticated;
grant execute on function public.bf_accept_invitations() to authenticated;
grant execute on function public.bf_list_my_organizations() to authenticated;
grant execute on function public.bf_invite_member(uuid, text, text, text, text[])
  to authenticated;
grant execute on function public.bf_remove_member(uuid, text) to authenticated;
grant execute on function public.bf_replace_snapshot(uuid, jsonb, jsonb)
  to authenticated;
grant execute on function public.bf_restore_snapshot(uuid, uuid)
  to authenticated;

grant execute on function public.bf_is_member(uuid) to authenticated;
grant execute on function public.bf_has_role(uuid, text[]) to authenticated;
grant execute on function public.bf_can_manage(uuid) to authenticated;
grant execute on function public.bf_can_access_property(uuid, text)
  to authenticated;

grant execute on function public.bf_operator_provision_organization(
  text, uuid, text, text, text, text, text
) to service_role;

commit;

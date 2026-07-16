-- L'annuaire des intervenants (bf_contacts) devient lisible par tout
-- membre actif de l'organisation (concierges compris), afin qu'ils
-- puissent choisir un intervenant et le contacter depuis l'app.
-- Le document de réglages internes (__bf_settings, qui contient
-- notamment les liens iCal privés) reste réservé aux gestionnaires.
-- L'écriture de l'annuaire reste réservée aux gestionnaires
-- (politique bf_contacts_write inchangée).

drop policy if exists bf_contacts_select on public.bf_contacts;
create policy bf_contacts_select on public.bf_contacts
  for select to authenticated
  using (
    public.bf_can_manage(org_id)
    or (
      id <> '__bf_settings'
      and exists (
        select 1
        from public.bf_members m
        where m.org_id = bf_contacts.org_id
          and m.user_id = auth.uid()
          and m.status = 'active'
      )
    )
  );

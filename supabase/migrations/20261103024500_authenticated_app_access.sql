begin;

revoke execute on function public.search_athlete_profiles(text, integer) from anon;
revoke execute on function public.get_athlete_profile(text) from anon;
revoke execute on function public.list_athlete_connections(text, text, integer) from anon;

grant execute on function public.search_athlete_profiles(text, integer) to authenticated;
grant execute on function public.get_athlete_profile(text) to authenticated;
grant execute on function public.list_athlete_connections(text, text, integer) to authenticated;

revoke execute on function public.get_public_profile_social_proof() from anon;
grant execute on function public.get_public_profile_social_proof() to authenticated;

revoke select on public.tournaments from anon;
grant select on public.tournaments to authenticated;

drop policy if exists "tournaments_public_or_owner_or_master" on public.tournaments;
create policy "tournaments_public_or_owner_or_master"
on public.tournaments for select to authenticated
using (
  is_published
  or organizer_id = (select auth.uid())
  or public.is_current_user_master()
);

commit;

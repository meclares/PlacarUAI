begin;

create extension if not exists pg_trgm with schema extensions;

create index if not exists profiles_public_id_social_search_idx
  on public.profiles using gin (public_id extensions.gin_trgm_ops);

create index if not exists profiles_display_name_social_search_idx
  on public.profiles using gin ((coalesce(display_name, '')) extensions.gin_trgm_ops);

create index if not exists profiles_profile_name_social_search_idx
  on public.profiles using gin ((coalesce(profile_data ->> 'name', '')) extensions.gin_trgm_ops);

create index if not exists tournaments_social_feed_idx
  on public.tournaments (organizer_id, completed_at desc)
  where status = 'completed' and is_published;

create or replace function public.get_public_profile_social_proof()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.profiles
  where account_status = 'active';
$$;

revoke all on function public.get_public_profile_social_proof() from public;
grant execute on function public.get_public_profile_social_proof() to anon, authenticated;

create or replace function public.get_followed_activities(p_limit integer default 50)
returns table (
  match_id uuid,
  athlete_public_id text,
  athlete_name text,
  city text,
  photo_url text,
  played_at timestamptz,
  activity jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    feed.match_id,
    feed.athlete_public_id,
    feed.athlete_name,
    feed.city,
    feed.photo_url,
    feed.played_at,
    feed.activity
  from (
    select
      sm.id as match_id,
      p.public_id as athlete_public_id,
      coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.profile_data ->> 'name'), ''), 'Atleta') as athlete_name,
      coalesce(nullif(btrim(p.profile_data ->> 'city'), ''), '') as city,
      case
        when p.profile_data ->> 'photo' ~* '^https://[^[:space:]]+$'
          then p.profile_data ->> 'photo'
        when length(p.profile_data ->> 'photo') <= 400000
          and p.profile_data ->> 'photo' ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
          then p.profile_data ->> 'photo'
        else null
      end as photo_url,
      sm.played_at,
      sm.activity
    from public.athlete_follows f
    join public.social_match_participants mp
      on mp.user_id = f.followed_id and mp.status = 'accepted'
    join public.social_matches sm
      on sm.id = mp.match_id and sm.status = 'accepted'
    join public.profiles p on p.user_id = mp.user_id
    where f.follower_id = auth.uid()
      and p.account_status = 'active'

    union all

    select
      md5(t.organizer_id::text || ':' || t.id)::uuid as match_id,
      p.public_id as athlete_public_id,
      coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.profile_data ->> 'name'), ''), 'Atleta') as athlete_name,
      coalesce(nullif(btrim(p.profile_data ->> 'city'), ''), '') as city,
      case
        when p.profile_data ->> 'photo' ~* '^https://[^[:space:]]+$'
          then p.profile_data ->> 'photo'
        when length(p.profile_data ->> 'photo') <= 400000
          and p.profile_data ->> 'photo' ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
          then p.profile_data ->> 'photo'
        else null
      end as photo_url,
      coalesce(t.completed_at, t.updated_at, t.created_at) as played_at,
      jsonb_build_object(
        'kind', 'tournament',
        'tournament_name', t.name,
        'sport', coalesce(
          nullif(t.payload ->> 'sportName', ''),
          nullif(t.payload ->> 'sport', ''),
          nullif(t.payload ->> 'modality', ''),
          'Campeonato'
        ),
        'participant_count', t.participant_count
      ) as activity
    from public.athlete_follows f
    join public.tournaments t
      on t.organizer_id = f.followed_id
      and t.status = 'completed'
      and t.is_published
    join public.profiles p on p.user_id = t.organizer_id
    where f.follower_id = auth.uid()
      and p.account_status = 'active'
  ) as feed
  order by feed.played_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.get_followed_activities(integer) from public;
grant execute on function public.get_followed_activities(integer) to authenticated;

commit;

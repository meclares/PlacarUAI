begin;

create or replace function public.get_athlete_profile_social_v2(p_public_id text)
returns table (
  public_id text,
  display_name text,
  city text,
  state_code text,
  sports text[],
  photo_url text,
  games_count bigint,
  following_count bigint,
  followers_count bigint,
  win_percentage integer,
  followers_hidden boolean,
  is_following boolean,
  is_self boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.public_id,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.profile_data ->> 'name'), ''), 'Atleta'),
    coalesce(nullif(btrim(p.profile_data ->> 'city'), ''), ''),
    case
      when upper(p.profile_data ->> 'state') in (
        'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
        'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC',
        'SP','SE','TO'
      ) then upper(p.profile_data ->> 'state')
      else ''
    end,
    case
      when jsonb_typeof(p.profile_data -> 'sports') = 'array'
        then array(select jsonb_array_elements_text(p.profile_data -> 'sports'))
      when nullif(p.profile_data ->> 'favorite', '') is not null
        then array[p.profile_data ->> 'favorite']
      else array[]::text[]
    end,
    case
      when p.profile_data ->> 'photo' ~* '^https://[^[:space:]]+$'
        then p.profile_data ->> 'photo'
      when length(p.profile_data ->> 'photo') <= 400000
        and p.profile_data ->> 'photo' ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
        then p.profile_data ->> 'photo'
      else null
    end,
    (
      select count(*)
      from public.social_match_participants mp
      join public.social_matches sm on sm.id = mp.match_id
      where mp.user_id = p.user_id
        and mp.status = 'accepted'
        and sm.status = 'accepted'
    ),
    (select count(*) from public.athlete_follows f where f.follower_id = p.user_id),
    (select count(*) from public.athlete_follows f where f.followed_id = p.user_id),
    coalesce((
      select round(
        100.0 * count(*) filter (where sm.activity ->> 'result' = 'win') /
        nullif(count(*) filter (where sm.activity ->> 'result' in ('win', 'loss')), 0)
      )::integer
      from public.social_matches sm
      join public.social_match_participants mp on mp.match_id = sm.id
      where mp.user_id = p.user_id
        and mp.is_creator
        and mp.status = 'accepted'
        and sm.status = 'accepted'
    ), 0),
    coalesce(p.profile_data ->> 'hideFollowers' = 'true', false),
    exists (
      select 1 from public.athlete_follows f
      where f.follower_id = auth.uid() and f.followed_id = p.user_id
    ),
    p.user_id = auth.uid()
  from public.profiles p
  where p.public_id = upper(btrim(p_public_id))
    and p.account_status = 'active'
    and auth.uid() is not null;
$$;

create or replace function public.list_athlete_connections_social_v2(
  p_public_id text,
  p_relation text,
  p_limit integer default 50
)
returns table (
  public_id text,
  display_name text,
  city text,
  state_code text,
  sports text[],
  photo_url text,
  win_percentage integer,
  followed_by_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select p.user_id, p.profile_data
    from public.profiles p
    where p.public_id = upper(btrim(p_public_id))
      and p.account_status = 'active'
      and auth.uid() is not null
  ), connections as (
    select f.followed_id as user_id, f.created_at
    from public.athlete_follows f
    join target t on t.user_id = f.follower_id
    where p_relation = 'following'
    union all
    select f.follower_id as user_id, f.created_at
    from public.athlete_follows f
    join target t on t.user_id = f.followed_id
    where p_relation = 'followers'
      and (
        t.user_id = auth.uid()
        or coalesce(t.profile_data ->> 'hideFollowers' = 'true', false) = false
      )
  )
  select
    p.public_id,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.profile_data ->> 'name'), ''), 'Atleta'),
    coalesce(nullif(btrim(p.profile_data ->> 'city'), ''), ''),
    case
      when upper(p.profile_data ->> 'state') in (
        'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
        'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC',
        'SP','SE','TO'
      ) then upper(p.profile_data ->> 'state')
      else ''
    end,
    case
      when jsonb_typeof(p.profile_data -> 'sports') = 'array'
        then array(select jsonb_array_elements_text(p.profile_data -> 'sports'))
      when nullif(p.profile_data ->> 'favorite', '') is not null
        then array[p.profile_data ->> 'favorite']
      else array[]::text[]
    end,
    case
      when p.profile_data ->> 'photo' ~* '^https://[^[:space:]]+$'
        then p.profile_data ->> 'photo'
      when length(p.profile_data ->> 'photo') <= 400000
        and p.profile_data ->> 'photo' ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
        then p.profile_data ->> 'photo'
      else null
    end,
    coalesce((
      select round(
        100.0 * count(*) filter (where sm.activity ->> 'result' = 'win') /
        nullif(count(*) filter (where sm.activity ->> 'result' in ('win', 'loss')), 0)
      )::integer
      from public.social_matches sm
      join public.social_match_participants mp on mp.match_id = sm.id
      where mp.user_id = p.user_id
        and mp.is_creator
        and mp.status = 'accepted'
        and sm.status = 'accepted'
    ), 0),
    exists (
      select 1 from public.athlete_follows mine
      where mine.follower_id = auth.uid() and mine.followed_id = p.user_id
    )
  from connections c
  join public.profiles p on p.user_id = c.user_id
  where p.account_status = 'active'
  order by c.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.get_athlete_profile_social_v2(text) from public, anon;
revoke all on function public.list_athlete_connections_social_v2(text, text, integer) from public, anon;
grant execute on function public.get_athlete_profile_social_v2(text) to authenticated;
grant execute on function public.list_athlete_connections_social_v2(text, text, integer) to authenticated;

commit;

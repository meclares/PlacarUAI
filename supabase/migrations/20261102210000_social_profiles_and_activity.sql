begin;

create table public.athlete_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followed_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

create index athlete_follows_followed_idx
  on public.athlete_follows (followed_id, created_at desc);

create table public.social_matches (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'accepted'
    check (status in ('pending', 'accepted', 'rejected')),
  played_at timestamptz not null default now(),
  activity jsonb not null check (jsonb_typeof(activity) = 'object'),
  created_at timestamptz not null default now()
);

create index social_matches_accepted_played_idx
  on public.social_matches (played_at desc)
  where status = 'accepted';

create table public.social_match_participants (
  match_id uuid not null references public.social_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null check (status in ('pending', 'accepted', 'rejected')),
  is_creator boolean not null default false,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create index social_match_participants_user_idx
  on public.social_match_participants (user_id, status, match_id);

create table public.social_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  notification_type text not null
    check (notification_type in ('follow', 'match_invitation', 'match_activity')),
  match_id uuid references public.social_matches(id) on delete cascade,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index social_notifications_recipient_idx
  on public.social_notifications (recipient_id, created_at desc);

alter table public.athlete_follows enable row level security;
alter table public.social_matches enable row level security;
alter table public.social_match_participants enable row level security;
alter table public.social_notifications enable row level security;

revoke all on public.athlete_follows, public.social_matches,
  public.social_match_participants, public.social_notifications
  from anon, authenticated;

create or replace function public.search_athlete_profiles(
  p_query text,
  p_limit integer default 20
)
returns table (
  public_id text,
  display_name text,
  city text,
  sports text[],
  photo_url text,
  followed_by_me boolean
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
    exists (
      select 1
      from public.athlete_follows f
      where f.follower_id = auth.uid()
        and f.followed_id = p.user_id
    )
  from public.profiles p
  where p.account_status = 'active'
    and auth.uid() is not null
    and nullif(btrim(p_query), '') is not null
    and (
      p.public_id ilike btrim(p_query) || '%'
      or coalesce(p.display_name, '') ilike '%' || btrim(p_query) || '%'
      or coalesce(p.profile_data ->> 'name', '') ilike '%' || btrim(p_query) || '%'
    )
  order by
    case when upper(p.public_id) = upper(btrim(p_query)) then 0 else 1 end,
    lower(coalesce(nullif(p.display_name, ''), p.profile_data ->> 'name', ''))
  limit greatest(1, least(coalesce(p_limit, 20), 30));
$$;

create or replace function public.get_athlete_profile(p_public_id text)
returns table (
  public_id text,
  display_name text,
  city text,
  sports text[],
  photo_url text,
  games_count bigint,
  craques_count bigint,
  arquibancada_count bigint,
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
    (
      select count(*)
      from public.athlete_follows f
      where f.follower_id = p.user_id
    ),
    (
      select count(*)
      from public.athlete_follows f
      where f.followed_id = p.user_id
    ),
    exists (
      select 1
      from public.athlete_follows f
      where f.follower_id = auth.uid()
        and f.followed_id = p.user_id
    ),
    p.user_id = auth.uid()
  from public.profiles p
  where p.public_id = upper(btrim(p_public_id))
    and p.account_status = 'active'
    and auth.uid() is not null;
$$;

create or replace function public.list_athlete_connections(
  p_public_id text,
  p_relation text,
  p_limit integer default 50
)
returns table (
  public_id text,
  display_name text,
  city text,
  sports text[],
  photo_url text,
  followed_by_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select p.user_id
    from public.profiles p
    where p.public_id = upper(btrim(p_public_id))
      and p.account_status = 'active'
      and auth.uid() is not null
  ),
  connections as (
    select f.followed_id as user_id, f.created_at
    from public.athlete_follows f
    join target t on t.user_id = f.follower_id
    where p_relation = 'craques'
    union all
    select f.follower_id as user_id, f.created_at
    from public.athlete_follows f
    join target t on t.user_id = f.followed_id
    where p_relation = 'arquibancada'
  )
  select
    p.public_id,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.profile_data ->> 'name'), ''), 'Atleta'),
    coalesce(nullif(btrim(p.profile_data ->> 'city'), ''), ''),
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
    exists (
      select 1
      from public.athlete_follows mine
      where mine.follower_id = auth.uid()
        and mine.followed_id = p.user_id
    )
  from connections c
  join public.profiles p on p.user_id = c.user_id
  where p.account_status = 'active'
  order by c.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

create or replace function public.set_athlete_follow(
  p_target_public_id text,
  p_following boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_id uuid;
  new_follow boolean := false;
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;
  if p_following is null then
    raise exception 'Follow state is required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.user_id = actor_id and p.account_status = 'active'
  ) then
    raise exception 'Active account required';
  end if;

  select p.user_id into target_id
  from public.profiles p
  where p.public_id = upper(btrim(p_target_public_id))
    and p.account_status = 'active';

  if target_id is null then
    raise exception 'Athlete not found';
  end if;
  if actor_id = target_id then
    raise exception 'You cannot follow your own profile';
  end if;

  if p_following then
    insert into public.athlete_follows (follower_id, followed_id)
    values (actor_id, target_id)
    on conflict (follower_id, followed_id) do nothing;

    new_follow := found;
    if new_follow then
      insert into public.social_notifications (
        recipient_id, actor_id, notification_type, dedupe_key
      )
      values (
        target_id, actor_id, 'follow',
        'follow:' || gen_random_uuid()::text
      );
    end if;
  else
    delete from public.athlete_follows f
    where f.follower_id = actor_id and f.followed_id = target_id;
  end if;

  return p_following;
end;
$$;

create or replace function public.submit_social_match(
  p_activity jsonb,
  p_invitee_public_ids text[] default array[]::text[],
  p_played_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  match_id uuid;
  invitees uuid[];
  requested_count integer;
  resolved_count integer;
  participant_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.user_id = actor_id and p.account_status = 'active'
  ) then
    raise exception 'Active account required';
  end if;
  if p_activity is null or jsonb_typeof(p_activity) <> 'object' then
    raise exception 'Invalid match activity';
  end if;
  if octet_length(p_activity::text) > 10000 then
    raise exception 'Match activity is too large';
  end if;

  select count(distinct upper(btrim(value)))
    into requested_count
  from unnest(coalesce(p_invitee_public_ids, array[]::text[])) as ids(value)
  where nullif(btrim(value), '') is not null;

  if requested_count > 3 then
    raise exception 'A match can invite at most three other athletes';
  end if;

  select array_agg(distinct p.user_id), count(distinct p.user_id)
    into invitees, resolved_count
  from unnest(coalesce(p_invitee_public_ids, array[]::text[])) as ids(value)
  join public.profiles p on p.public_id = upper(btrim(ids.value))
  where nullif(btrim(ids.value), '') is not null
    and p.account_status = 'active'
    and p.user_id <> actor_id;

  if coalesce(resolved_count, 0) <> requested_count then
    raise exception 'One or more athlete IDs are invalid or cannot be invited';
  end if;

  insert into public.social_matches (creator_id, status, played_at, activity)
  values (
    actor_id,
    case when coalesce(cardinality(invitees), 0) > 0 then 'pending' else 'accepted' end,
    coalesce(p_played_at, now()),
    p_activity
  )
  returning id into match_id;

  insert into public.social_match_participants (
    match_id, user_id, status, is_creator, responded_at
  )
  values (match_id, actor_id, 'accepted', true, now());

  foreach participant_id in array coalesce(invitees, array[]::uuid[]) loop
    insert into public.social_match_participants (match_id, user_id, status)
    values (match_id, participant_id, 'pending');

    insert into public.social_notifications (
      recipient_id, actor_id, notification_type, match_id, dedupe_key
    )
    values (
      participant_id, actor_id, 'match_invitation', match_id,
      'match-invitation:' || match_id::text || ':' || participant_id::text
    )
    on conflict (dedupe_key) do nothing;
  end loop;

  if coalesce(cardinality(invitees), 0) = 0 then
    insert into public.match_history (user_id, id, played_at, match_data)
    values (actor_id, match_id::text, coalesce(p_played_at, now()), p_activity)
    on conflict (user_id, id) do nothing;

    insert into public.social_notifications (
      recipient_id, actor_id, notification_type, match_id, dedupe_key
    )
    select distinct on (f.follower_id)
      f.follower_id,
      actor_id,
      'match_activity',
      match_id,
      'match-activity:' || match_id::text || ':' || f.follower_id::text
    from public.athlete_follows f
    where f.followed_id = actor_id
    order by f.follower_id
    on conflict (dedupe_key) do nothing;
  end if;

  return match_id;
end;
$$;

create or replace function public.respond_to_social_match(
  p_match_id uuid,
  p_decision text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  match_status text;
  activity_data jsonb;
  activity_time timestamptz;
  participant_row record;
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.user_id = actor_id and p.account_status = 'active'
  ) then
    raise exception 'Active account required';
  end if;
  if p_decision is null or p_decision not in ('accepted', 'rejected') then
    raise exception 'Decision must be accepted or rejected';
  end if;

  update public.social_match_participants mp
    set status = p_decision, responded_at = now()
  where mp.match_id = p_match_id
    and mp.user_id = actor_id
    and mp.status = 'pending';

  if not found then
    raise exception 'No pending invitation was found for this account';
  end if;

  select sm.status, sm.activity, sm.played_at
    into match_status, activity_data, activity_time
  from public.social_matches sm
  where sm.id = p_match_id
  for update;

  if exists (
    select 1 from public.social_match_participants mp
    where mp.match_id = p_match_id and mp.status = 'pending'
  ) then
    return 'pending';
  end if;

  if match_status = 'pending' and exists (
    select 1
    from public.social_match_participants mp
    where mp.match_id = p_match_id and mp.status = 'rejected'
  ) then
    update public.social_matches
    set status = 'rejected'
    where id = p_match_id;
    return 'rejected';
  end if;

  if match_status = 'pending' then
    update public.social_matches
    set status = 'accepted'
    where id = p_match_id;

    for participant_row in
      select mp.user_id
      from public.social_match_participants mp
      where mp.match_id = p_match_id
        and mp.status = 'accepted'
    loop
      insert into public.match_history (user_id, id, played_at, match_data)
      values (
        participant_row.user_id,
        p_match_id::text,
        activity_time,
        activity_data
      )
      on conflict (user_id, id) do nothing;
    end loop;

    insert into public.social_notifications (
      recipient_id, actor_id, notification_type, match_id, dedupe_key
    )
    select distinct on (f.follower_id)
      f.follower_id,
      mp.user_id,
      'match_activity',
      p_match_id,
      'match-activity:' || p_match_id::text || ':' || f.follower_id::text
    from public.social_match_participants mp
    join public.athlete_follows f on f.followed_id = mp.user_id
    where mp.match_id = p_match_id
      and mp.status = 'accepted'
      and f.follower_id <> mp.user_id
    order by f.follower_id, mp.user_id
    on conflict (dedupe_key) do nothing;

    return 'accepted';
  end if;

  return match_status;
end;
$$;

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
    sm.id,
    p.public_id,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.profile_data ->> 'name'), ''), 'Atleta'),
    coalesce(nullif(btrim(p.profile_data ->> 'city'), ''), ''),
    case
      when p.profile_data ->> 'photo' ~* '^https://[^[:space:]]+$'
        then p.profile_data ->> 'photo'
      when length(p.profile_data ->> 'photo') <= 400000
        and p.profile_data ->> 'photo' ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
        then p.profile_data ->> 'photo'
      else null
    end,
    sm.played_at,
    sm.activity
  from public.athlete_follows f
  join public.social_match_participants mp
    on mp.user_id = f.followed_id and mp.status = 'accepted'
  join public.social_matches sm
    on sm.id = mp.match_id and sm.status = 'accepted'
  join public.profiles p on p.user_id = mp.user_id
  where f.follower_id = auth.uid()
  order by sm.played_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

create or replace function public.get_social_notifications(p_limit integer default 50)
returns table (
  notification_id uuid,
  notification_type text,
  actor_public_id text,
  actor_name text,
  match_id uuid,
  match_activity jsonb,
  invitation_status text,
  created_at timestamptz,
  read_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    n.id,
    n.notification_type,
    p.public_id,
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.profile_data ->> 'name'), ''), 'Atleta'),
    n.match_id,
    sm.activity,
    (
      select mp.status
      from public.social_match_participants mp
      where mp.match_id = n.match_id
        and mp.user_id = n.recipient_id
    ),
    n.created_at,
    n.read_at
  from public.social_notifications n
  join public.profiles p on p.user_id = n.actor_id
  left join public.social_matches sm on sm.id = n.match_id
  where n.recipient_id = auth.uid()
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

create or replace function public.mark_social_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  update public.social_notifications
  set read_at = now()
  where recipient_id = auth.uid()
    and read_at is null;
  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

revoke all on function public.search_athlete_profiles(text, integer) from public;
revoke all on function public.get_athlete_profile(text) from public;
revoke all on function public.list_athlete_connections(text, text, integer) from public;
revoke all on function public.set_athlete_follow(text, boolean) from public;
revoke all on function public.submit_social_match(jsonb, text[], timestamptz) from public;
revoke all on function public.respond_to_social_match(uuid, text) from public;
revoke all on function public.get_followed_activities(integer) from public;
revoke all on function public.get_social_notifications(integer) from public;
revoke all on function public.mark_social_notifications_read() from public;

grant execute on function public.search_athlete_profiles(text, integer) to anon, authenticated;
grant execute on function public.get_athlete_profile(text) to anon, authenticated;
grant execute on function public.list_athlete_connections(text, text, integer) to anon, authenticated;
grant execute on function public.set_athlete_follow(text, boolean) to authenticated;
grant execute on function public.submit_social_match(jsonb, text[], timestamptz) to authenticated;
grant execute on function public.respond_to_social_match(uuid, text) to authenticated;
grant execute on function public.get_followed_activities(integer) to authenticated;
grant execute on function public.get_social_notifications(integer) to authenticated;
grant execute on function public.mark_social_notifications_read() to authenticated;

commit;

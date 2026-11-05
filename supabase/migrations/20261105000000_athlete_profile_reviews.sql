begin;

alter table public.profiles
  add column if not exists reviews_hidden boolean not null default false;

create table if not exists public.athlete_profile_reviews (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null check (length(btrim(comment)) between 1 and 300),
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint athlete_profile_reviews_no_self_review check (author_id <> target_id),
  constraint athlete_profile_reviews_author_target_key unique (author_id, target_id)
);

create index if not exists athlete_profile_reviews_target_idx
  on public.athlete_profile_reviews (target_id, created_at desc);

alter table public.athlete_profile_reviews enable row level security;
revoke all on public.athlete_profile_reviews from public, anon, authenticated;

create or replace function public.get_athlete_profile_reviews(p_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target_id uuid;
  v_hidden boolean;
  v_is_owner boolean;
  v_reviews jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select p.user_id, p.reviews_hidden, p.user_id = auth.uid()
  into v_target_id, v_hidden, v_is_owner
  from public.profiles p
  where p.public_id = upper(btrim(p_public_id))
    and p.account_status = 'active';

  if v_target_id is null then
    raise exception 'Athlete profile not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'author_public_id', a.public_id,
    'author_name', coalesce(nullif(btrim(a.display_name), ''), 'Atleta'),
    'rating', r.rating,
    'comment', r.comment,
    'approved', r.approved,
    'created_at', r.created_at
  ) order by r.created_at desc), '[]'::jsonb)
  into v_reviews
  from public.athlete_profile_reviews r
  join public.profiles a on a.user_id = r.author_id and a.account_status = 'active'
  where r.target_id = v_target_id
    and (v_is_owner or (not v_hidden and r.approved));

  return jsonb_build_object(
    'reviews_hidden', v_hidden,
    'is_owner', v_is_owner,
    'reviews', v_reviews
  );
end;
$$;

create or replace function public.submit_athlete_profile_review(
  p_target_public_id text,
  p_rating integer,
  p_comment text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_id uuid;
  v_review_id uuid;
  v_comment text := btrim(coalesce(p_comment, ''));
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Choose a rating from 1 to 5' using errcode = '22023';
  end if;
  if length(v_comment) < 1 or length(v_comment) > 300 then
    raise exception 'Comment must contain between 1 and 300 characters' using errcode = '22023';
  end if;

  select p.user_id into v_target_id
  from public.profiles p
  where p.public_id = upper(btrim(p_target_public_id))
    and p.account_status = 'active';
  if v_target_id is null then
    raise exception 'Athlete profile not found' using errcode = 'P0002';
  end if;
  if v_target_id = auth.uid() then
    raise exception 'You cannot review your own profile' using errcode = '42501';
  end if;
  insert into public.athlete_profile_reviews (author_id, target_id, rating, comment, approved)
  values (auth.uid(), v_target_id, p_rating, v_comment, false)
  on conflict (author_id, target_id) do update
    set rating = excluded.rating,
        comment = excluded.comment,
        approved = false,
        updated_at = now()
  returning id into v_review_id;
  return v_review_id;
end;
$$;

create or replace function public.moderate_athlete_profile_review(
  p_review_id uuid,
  p_action text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('approve', 'delete') then
    raise exception 'Unsupported review action' using errcode = '22023';
  end if;

  if p_action = 'approve' then
    update public.athlete_profile_reviews
    set approved = true, updated_at = now()
    where id = p_review_id and target_id = auth.uid();
  else
    delete from public.athlete_profile_reviews
    where id = p_review_id and target_id = auth.uid();
  end if;
  return found;
end;
$$;

create or replace function public.set_athlete_profile_reviews_hidden(p_hidden boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  update public.profiles
  set reviews_hidden = coalesce(p_hidden, false)
  where user_id = auth.uid() and account_status = 'active';
  return found;
end;
$$;

revoke all on function public.get_athlete_profile_reviews(text) from public, anon;
revoke all on function public.submit_athlete_profile_review(text, integer, text) from public, anon;
revoke all on function public.moderate_athlete_profile_review(uuid, text) from public, anon;
revoke all on function public.set_athlete_profile_reviews_hidden(boolean) from public, anon;
grant execute on function public.get_athlete_profile_reviews(text) to authenticated;
grant execute on function public.submit_athlete_profile_review(text, integer, text) to authenticated;
grant execute on function public.moderate_athlete_profile_review(uuid, text) to authenticated;
grant execute on function public.set_athlete_profile_reviews_hidden(boolean) to authenticated;

commit;

begin;

create schema if not exists app_private;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  public_id text not null unique default (
    'UA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  email text not null,
  display_name text not null default '',
  account_status text not null default 'active'
    check (account_status in ('active', 'suspended')),
  profile_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(profile_data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tournaments (
  organizer_id uuid not null references auth.users(id) on delete restrict,
  id text not null,
  name text not null,
  status text not null
    check (status in ('registration', 'in_progress', 'completed')),
  is_published boolean not null default false,
  participant_count integer not null default 0 check (participant_count >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (organizer_id, id)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  provider text not null default 'mercado_pago'
    check (provider = 'mercado_pago'),
  plan_id text not null default 'placaruai-monthly',
  amount numeric(10, 2) not null default 49.90 check (amount = 49.90),
  currency text not null default 'BRL' check (currency = 'BRL'),
  status text not null
    check (status in ('pending', 'active', 'cancelled', 'expired', 'failed')),
  provider_status text,
  provider_subscription_id text unique,
  checkout_url text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  last_payment_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index subscriptions_one_pending_per_user
  on public.subscriptions (user_id)
  where status = 'pending';
create index subscriptions_user_period_idx
  on public.subscriptions (user_id, status, current_period_end desc);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  provider text not null default 'mercado_pago'
    check (provider = 'mercado_pago'),
  provider_payment_id text not null unique,
  status text not null
    check (status in ('pending', 'approved', 'rejected', 'refunded', 'cancelled')),
  amount numeric(10, 2) not null check (amount >= 0),
  currency text not null,
  paid_at timestamptz,
  entitlement_period_end timestamptz,
  provider_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_user_paid_idx on public.payments (user_id, paid_at desc);
create index payments_subscription_idx on public.payments (subscription_id, paid_at desc);
create index payments_entitlement_period_idx
  on public.payments (subscription_id, entitlement_period_end desc)
  where status = 'approved' and entitlement_period_end is not null;

create table public.match_history (
  user_id uuid not null references auth.users(id) on delete restrict,
  id text not null,
  played_at timestamptz,
  match_data jsonb not null check (jsonb_typeof(match_data) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table app_private.admin_roles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete restrict,
  reason text not null
);
alter table app_private.admin_roles enable row level security;
revoke all on app_private.admin_roles from public, anon, authenticated;

create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id text,
  reason text,
  outcome text not null check (outcome in ('success', 'failure')),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object')
);
create index admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);

create table public.system_events (
  id bigint generated always as identity primary key,
  source text not null,
  event_type text not null,
  severity text not null check (severity in ('info', 'warning', 'error')),
  message text not null check (length(message) <= 400),
  detected_at timestamptz not null default now(),
  review_status text not null default 'automatic'
    check (review_status in ('automatic', 'reviewed')),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_reason text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object')
);
create index system_events_detected_idx on public.system_events (detected_at desc);
create index system_events_open_idx on public.system_events (review_status, severity);

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function app_private.set_updated_at();
create trigger tournaments_set_updated_at
before update on public.tournaments
for each row execute function app_private.set_updated_at();
create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function app_private.set_updated_at();
create trigger payments_set_updated_at
before update on public.payments
for each row execute function app_private.set_updated_at();

create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (user_id) do update
    set email = excluded.email;
  return new;
end;
$$;

create trigger auth_user_profile_sync
after insert or update of email on auth.users
for each row execute function app_private.handle_new_auth_user();

create or replace function public.is_current_user_master()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.admin_roles r
    where r.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_manage_tournaments()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.subscriptions s on s.user_id = p.user_id
    where p.user_id = (select auth.uid())
      and p.account_status = 'active'
      and s.status in ('active', 'cancelled')
      and s.current_period_end > now()
  );
$$;

create or replace function public.admin_metrics(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_current_user_master() then
    raise exception using errcode = '42501', message = 'Not authorized';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception using errcode = '22023', message = 'Invalid reporting period';
  end if;

  return jsonb_build_object(
    'users', jsonb_build_object(
      'total', (select count(*) from auth.users),
      'active', (select count(*) from auth.users u
        where u.last_sign_in_at >= p_from and u.last_sign_in_at < p_to),
      'new', (select count(*) from auth.users u
        where u.created_at >= p_from and u.created_at < p_to)
    ),
    'tournaments', jsonb_build_object(
      'total', (select count(*) from public.tournaments),
      'created', (select count(*) from public.tournaments t
        where t.created_at >= p_from and t.created_at < p_to),
      'in_progress', (select count(*) from public.tournaments t
        where t.status = 'in_progress'),
      'completed', (select count(*) from public.tournaments t
        where t.status = 'completed')
    ),
    'subscriptions', jsonb_build_object(
      'active', (select count(*) from public.subscriptions s
        where s.status = 'active' and s.current_period_end > now()),
      'expired', (select count(*) from public.subscriptions s
        where s.status = 'expired'
          or (s.status = 'active' and s.current_period_end <= now())),
      'cancelled', (select count(*) from public.subscriptions s
        where s.status = 'cancelled'),
      'pending', (select count(*) from public.subscriptions s
        where s.status = 'pending')
    ),
    'payments', jsonb_build_object(
      'confirmed', (select count(*) from public.payments p
        where p.status in ('approved', 'refunded') and p.paid_at >= p_from and p.paid_at < p_to),
      'pending', (select count(*) from public.payments p
        where p.status = 'pending' and p.created_at >= p_from and p.created_at < p_to),
      'rejected', (select count(*) from public.payments p
        where p.status = 'rejected' and p.created_at >= p_from and p.created_at < p_to),
      'gross_confirmed', (select coalesce(sum(p.amount), 0) from public.payments p
        where p.status in ('approved', 'refunded') and p.paid_at >= p_from and p.paid_at < p_to),
      'refunded', (select coalesce(sum(p.amount), 0) from public.payments p
        where p.status = 'refunded' and p.updated_at >= p_from and p.updated_at < p_to)
    ),
    'integrity', jsonb_build_object(
      'completed_without_classification', (
        select count(*) from public.tournaments t
        where t.status = 'completed'
          and (
            jsonb_typeof(t.payload -> 'placements') is distinct from 'object'
            or t.payload -> 'placements' = '{}'::jsonb
          )
      ),
      'open_technical_events', (
        select count(*) from public.system_events e
        where e.review_status = 'automatic' and e.severity in ('warning', 'error')
      )
    )
  );
end;
$$;

create or replace function public.admin_search_users(
  p_search text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  public_id text,
  email text,
  display_name text,
  account_status text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  search_value text := left(coalesce(p_search, ''), 100);
begin
  if not public.is_current_user_master() then
    raise exception using errcode = '42501', message = 'Not authorized';
  end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 then
    raise exception using errcode = '22023', message = 'Invalid pagination';
  end if;

  return query
  select p.user_id, p.public_id, p.email, p.display_name, p.account_status,
    p.created_at, u.last_sign_in_at
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where search_value = ''
    or p.user_id::text = search_value
    or p.public_id ilike '%' || search_value || '%'
    or p.email ilike '%' || search_value || '%'
    or p.display_name ilike '%' || search_value || '%'
  order by p.created_at desc
  limit p_limit offset p_offset;
end;
$$;

create or replace function app_private.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'Audit records are immutable';
end;
$$;

create trigger admin_audit_immutable
before update or delete on public.admin_audit_logs
for each row execute function app_private.prevent_audit_mutation();

alter table public.profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.match_history enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.system_events enable row level security;

grant select on public.profiles to authenticated;
revoke insert, update on public.profiles from anon, authenticated;
grant update (display_name, profile_data) on public.profiles to authenticated;
grant select on public.tournaments to anon, authenticated;
grant insert, update on public.tournaments to authenticated;
grant select on public.subscriptions, public.payments to authenticated;
grant select, insert, update on public.match_history to authenticated;
grant select on public.admin_audit_logs to authenticated;
grant select on public.system_events to authenticated;
grant select, insert, update on public.profiles, public.tournaments,
  public.subscriptions, public.payments, public.match_history,
  public.admin_audit_logs to service_role;
grant select, insert, update on public.system_events to service_role;
grant usage, select on sequence public.admin_audit_logs_id_seq to service_role;
grant usage, select on sequence public.system_events_id_seq to service_role;

revoke insert, update, delete on public.subscriptions, public.payments from anon, authenticated;
revoke insert, update, delete on public.admin_audit_logs, public.system_events from anon, authenticated;
revoke delete on public.tournaments, public.match_history from anon, authenticated;

create policy "profiles_select_own_or_master"
on public.profiles for select to authenticated
using (user_id = (select auth.uid()) or public.is_current_user_master());

create policy "profiles_update_own"
on public.profiles for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "tournaments_public_or_owner_or_master"
on public.tournaments for select to anon, authenticated
using (
  is_published
  or organizer_id = (select auth.uid())
  or public.is_current_user_master()
);

create policy "tournaments_insert_paid_owner"
on public.tournaments for insert to authenticated
with check (
  organizer_id = (select auth.uid())
  and public.can_manage_tournaments()
);

create policy "tournaments_update_paid_owner"
on public.tournaments for update to authenticated
using (
  organizer_id = (select auth.uid())
  and public.can_manage_tournaments()
)
with check (
  organizer_id = (select auth.uid())
  and public.can_manage_tournaments()
);

create policy "subscriptions_select_owner_or_master"
on public.subscriptions for select to authenticated
using (user_id = (select auth.uid()) or public.is_current_user_master());

create policy "payments_select_owner_or_master"
on public.payments for select to authenticated
using (user_id = (select auth.uid()) or public.is_current_user_master());

create policy "match_history_select_own"
on public.match_history for select to authenticated
using (user_id = (select auth.uid()));

create policy "match_history_insert_own"
on public.match_history for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "match_history_update_own"
on public.match_history for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "admin_audit_select_master"
on public.admin_audit_logs for select to authenticated
using (public.is_current_user_master());

create policy "system_events_select_master"
on public.system_events for select to authenticated
using (public.is_current_user_master());

revoke all on function public.is_current_user_master() from public;
grant execute on function public.is_current_user_master() to anon, authenticated, service_role;
revoke all on function public.can_manage_tournaments() from public;
grant execute on function public.can_manage_tournaments() to authenticated, service_role;
revoke all on function public.admin_metrics(timestamptz, timestamptz) from public;
grant execute on function public.admin_metrics(timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.admin_search_users(text, integer, integer) from public;
grant execute on function public.admin_search_users(text, integer, integer) to authenticated, service_role;

commit;

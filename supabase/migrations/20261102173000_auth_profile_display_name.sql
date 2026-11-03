begin;

create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
begin
  profile_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    ''
  );

  insert into public.profiles (user_id, email, display_name)
  values (new.id, coalesce(new.email, ''), profile_name)
  on conflict (user_id) do update
    set email = excluded.email,
        display_name = case
          when public.profiles.display_name = '' then excluded.display_name
          else public.profiles.display_name
        end;

  return new;
end;
$$;

update public.profiles p
set display_name = coalesce(
  nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
  nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
  nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
  ''
)
from auth.users u
where u.id = p.user_id
  and p.display_name = '';

commit;

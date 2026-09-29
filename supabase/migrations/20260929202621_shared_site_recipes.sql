-- Curated listing recipes are read by every authenticated profile and edited
-- only through the server after an explicit administrator check.
create table public.hunter_site_recipe_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

insert into public.hunter_site_recipe_admins (user_id)
select id from auth.users where lower(email) = 'raph.brassart@gmail.com'
on conflict (user_id) do nothing;

do $$
begin
  if not exists (select 1 from public.hunter_site_recipe_admins) then
    raise exception 'Job Hunter site recipe administrator account was not found';
  end if;
end $$;

alter table public.hunter_site_recipe_admins enable row level security;
revoke all on public.hunter_site_recipe_admins from anon, authenticated;
grant select on public.hunter_site_recipe_admins to service_role;

create table public.hunter_site_recipes (
  id uuid primary key default gen_random_uuid(),
  listing_url text not null unique,
  name text not null,
  config jsonb not null,
  status text not null default 'published' check (status in ('published', 'disabled')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index hunter_site_recipes_status_updated_idx
  on public.hunter_site_recipes(status, updated_at desc);

alter table public.hunter_site_recipes enable row level security;
revoke all on public.hunter_site_recipes from anon, authenticated;
grant select on public.hunter_site_recipes to authenticated;
grant select, insert, update on public.hunter_site_recipes to service_role;

create policy hunter_site_recipes_read on public.hunter_site_recipes
  for select to authenticated using (status = 'published');

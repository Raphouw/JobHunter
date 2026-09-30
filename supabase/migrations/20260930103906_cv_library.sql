create table public.hunter_cvs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 120),
  content jsonb check (content is null or (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 1800000)),
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (profile_id, user_id) references public.hunter_profiles(id, user_id) on delete cascade
);
create index hunter_cvs_profile_user_idx on public.hunter_cvs(profile_id, user_id, updated_at desc);
alter table public.hunter_cvs enable row level security;
revoke all on public.hunter_cvs from anon, authenticated;
grant select, insert, update, delete on public.hunter_cvs to authenticated;
create policy hunter_cvs_select on public.hunter_cvs for select to authenticated using ((select auth.uid()) = user_id);
create policy hunter_cvs_insert on public.hunter_cvs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy hunter_cvs_update on public.hunter_cvs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy hunter_cvs_delete on public.hunter_cvs for delete to authenticated using ((select auth.uid()) = user_id);
create function public.hunter_cvs_touch() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;
revoke all on function public.hunter_cvs_touch() from public, anon, authenticated;
create trigger hunter_cvs_touch before update on public.hunter_cvs for each row execute function public.hunter_cvs_touch();

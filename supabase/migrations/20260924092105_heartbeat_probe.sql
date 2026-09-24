-- Public read-only row used by the external uptime probe. No user data.
create table public.hunter_service_heartbeat (
  id integer primary key check (id = 1)
);

insert into public.hunter_service_heartbeat (id) values (1);

alter table public.hunter_service_heartbeat enable row level security;
revoke all on public.hunter_service_heartbeat from anon, authenticated;
grant select on public.hunter_service_heartbeat to anon, authenticated;

create policy hunter_service_heartbeat_read on public.hunter_service_heartbeat
  for select to anon, authenticated using (true);

-- Refresh tokens are encrypted in the Vercel function before storage. Only the
-- server-side service role can access this table; clients see status via API.
create table public.hunter_google_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_subject text not null,
  google_email text not null,
  encrypted_refresh_token text not null,
  granted_scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hunter_google_connections enable row level security;
revoke all on public.hunter_google_connections from public, anon, authenticated;
grant select, insert, update, delete on public.hunter_google_connections to service_role;

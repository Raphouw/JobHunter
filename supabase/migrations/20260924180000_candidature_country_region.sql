alter table public.hunter_candidatures
  add column if not exists country text not null default 'CH',
  add column if not exists region text not null default '';

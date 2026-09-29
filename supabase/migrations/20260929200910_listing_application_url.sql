alter table public.hunter_offers
  add column if not exists application_url text not null default '',
  add column if not exists contract_type text not null default '',
  add column if not exists posting_date text not null default '';

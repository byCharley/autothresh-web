create table if not exists discount_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  offer text not null check (offer in ('monthly30', 'annual50', 'trial15')),
  code text not null,
  shopify_id text,
  checkout_url text not null,
  percent int not null,
  created_at timestamptz not null default now(),
  unique (email, offer)
);

create index if not exists discount_codes_email_idx on discount_codes (email);

alter table discount_codes enable row level security;

alter table discount_codes drop constraint if exists discount_codes_offer_check;
alter table discount_codes add constraint discount_codes_offer_check
  check (offer in ('monthly30', 'annual50', 'trial15'));

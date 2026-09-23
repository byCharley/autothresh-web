-- Lifetime license key ↔ Shopify account email.
-- After first activation, Sign in with email grants lifetime (no re-entry of the key).

create table if not exists license_bindings (
  license_key text primary key,
  email text not null,
  order_number text,
  bound_at timestamptz not null default now()
);

create unique index if not exists license_bindings_email_uidx on license_bindings (email);

alter table license_bindings enable row level security;

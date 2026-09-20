create table if not exists license_devices (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  license_key text,
  order_number text,
  device_id text not null,
  device_name text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (email, device_id)
);

create index if not exists license_devices_email_idx on license_devices (email);
create index if not exists license_devices_license_idx on license_devices (license_key);

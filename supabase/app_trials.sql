create table if not exists app_trials (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists app_trial_idents (
  trial_id uuid not null references app_trials(id) on delete cascade,
  kind text not null check (kind in ('device', 'ip', 'fp', 'cookie')),
  value text not null,
  created_at timestamptz not null default now(),
  primary key (kind, value)
);

create index if not exists app_trial_idents_trial_idx on app_trial_idents (trial_id);

alter table app_trials enable row level security;
alter table app_trial_idents enable row level security;

-- Paid-through access for cancelled Monthly/Annual Seal subscribers.
CREATE TABLE IF NOT EXISTS plan_access (
  email text PRIMARY KEY,
  access_until timestamptz NOT NULL,
  plan_title text,
  seal_subscription_id bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);

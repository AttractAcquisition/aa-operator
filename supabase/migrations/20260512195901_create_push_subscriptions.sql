create table if not exists push_subscriptions (
  id           uuid        primary key default gen_random_uuid(),
  endpoint     text        not null unique,
  p256dh       text        not null,
  auth         text        not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

alter table push_subscriptions enable row level security;

-- Service role has full access
create policy "service role full access"
  on push_subscriptions
  for all
  to service_role
  using (true)
  with check (true);

-- Anon can subscribe (insert their own subscription)
create policy "anon can subscribe"
  on push_subscriptions
  for insert
  to anon
  with check (true);

-- Anon can unsubscribe by matching endpoint
create policy "anon can unsubscribe by endpoint"
  on push_subscriptions
  for delete
  to anon
  using (endpoint = current_setting('request.jwt.claims', true)::json->>'endpoint');

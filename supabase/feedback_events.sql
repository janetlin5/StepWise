create table if not exists public.feedback_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  category text not null default 'Other',
  message text not null,
  page_url text default '',
  context jsonb not null default '{}'::jsonb,
  browser jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.feedback_events enable row level security;

create policy "Anyone can send feedback"
on public.feedback_events
for insert
with check (true);

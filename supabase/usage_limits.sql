create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free',
  subscription_status text not null default 'inactive',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
add column if not exists plan text not null default 'free';

alter table public.profiles
add column if not exists subscription_status text not null default 'inactive';

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (
    event_type in ('ai_message', 'upload_analysis', 'practice_generation')
  ),
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_type_created_idx
on public.usage_events (user_id, event_type, created_at desc);

alter table public.usage_events enable row level security;

drop policy if exists "Users can read their own usage events"
on public.usage_events;

create policy "Users can read their own usage events"
on public.usage_events
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own usage events"
on public.usage_events;

create policy "Users can insert their own usage events"
on public.usage_events
for insert
with check (auth.uid() = user_id);

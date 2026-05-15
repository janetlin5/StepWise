create table if not exists public.learning_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  preferred_tutoring_style text not null default 'guided hints',
  pacing_preference text not null default 'balanced',
  independence_level text not null default 'guided',
  hint_detail_preference text not null default 'balanced',
  confidence_by_topic jsonb not null default '{}'::jsonb,
  recently_practiced_topics text[] not null default '{}',
  evidence_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.learning_profiles
add column if not exists preferred_tutoring_style text not null default 'guided hints';

alter table public.learning_profiles
add column if not exists pacing_preference text not null default 'balanced';

alter table public.learning_profiles
add column if not exists independence_level text not null default 'guided';

alter table public.learning_profiles
add column if not exists hint_detail_preference text not null default 'balanced';

alter table public.learning_profiles
add column if not exists confidence_by_topic jsonb not null default '{}'::jsonb;

alter table public.learning_profiles
add column if not exists recently_practiced_topics text[] not null default '{}';

alter table public.learning_profiles
add column if not exists evidence_count integer not null default 0;

alter table public.learning_profiles enable row level security;

drop policy if exists "Users can read their learning profile"
on public.learning_profiles;

create policy "Users can read their learning profile"
on public.learning_profiles
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their learning profile"
on public.learning_profiles;

create policy "Users can insert their learning profile"
on public.learning_profiles
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their learning profile"
on public.learning_profiles;

create policy "Users can update their learning profile"
on public.learning_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.learning_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text,
  subtopic text,
  status text not null default 'active',
  current_problem text,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists learning_sessions_user_updated_idx
on public.learning_sessions (user_id, updated_at desc);

alter table public.learning_sessions enable row level security;

alter table public.learning_sessions
add column if not exists last_message_at timestamptz;

alter table public.learning_sessions
add column if not exists pinned_problem text;

alter table public.learning_sessions
add column if not exists uploaded_assets jsonb not null default '[]'::jsonb;

alter table public.learning_sessions
add column if not exists tutor_thread jsonb not null default '{}'::jsonb;

alter table public.learning_sessions
add column if not exists completed_at timestamptz;

drop policy if exists "Users can read their learning sessions"
on public.learning_sessions;

create policy "Users can read their learning sessions"
on public.learning_sessions
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their learning sessions"
on public.learning_sessions;

create policy "Users can insert their learning sessions"
on public.learning_sessions
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their learning sessions"
on public.learning_sessions;

create policy "Users can update their learning sessions"
on public.learning_sessions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.tutoring_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.learning_sessions(id) on delete set null,
  summary text not null,
  structured_summary jsonb not null default '{}'::jsonb,
  topics text[] not null default '{}',
  skills text[] not null default '{}',
  misconceptions text[] not null default '{}',
  strengths text[] not null default '{}',
  confidence_signal text,
  created_at timestamptz not null default now()
);

alter table public.tutoring_summaries
add column if not exists structured_summary jsonb not null default '{}'::jsonb;

create index if not exists tutoring_summaries_user_created_idx
on public.tutoring_summaries (user_id, created_at desc);

alter table public.tutoring_summaries enable row level security;

drop policy if exists "Users can read their tutoring summaries"
on public.tutoring_summaries;

create policy "Users can read their tutoring summaries"
on public.tutoring_summaries
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their tutoring summaries"
on public.tutoring_summaries;

create policy "Users can insert their tutoring summaries"
on public.tutoring_summaries
for insert
with check (auth.uid() = user_id);

create table if not exists public.learning_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.learning_sessions(id) on delete set null,
  signal_type text not null,
  topic text,
  skill text,
  confidence numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists learning_signals_user_created_idx
on public.learning_signals (user_id, created_at desc);

create index if not exists learning_signals_user_topic_idx
on public.learning_signals (user_id, topic);

alter table public.learning_signals enable row level security;

drop policy if exists "Users can read their learning signals"
on public.learning_signals;

create policy "Users can read their learning signals"
on public.learning_signals
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their learning signals"
on public.learning_signals;

create policy "Users can insert their learning signals"
on public.learning_signals
for insert
with check (auth.uid() = user_id);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text,
  problem_text text,
  screenshot_url text,
  hints_used integer not null default 0,
  completion_status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sessions_user_created_idx
on public.sessions (user_id, created_at desc);

create index if not exists sessions_user_status_idx
on public.sessions (user_id, completion_status);

alter table public.sessions enable row level security;

drop policy if exists "Users can read their sessions"
on public.sessions;

create policy "Users can read their sessions"
on public.sessions
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their sessions"
on public.sessions;

create policy "Users can insert their sessions"
on public.sessions
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their sessions"
on public.sessions;

create policy "Users can update their sessions"
on public.sessions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create table if not exists public.learning_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  topic text,
  subtopic text,
  skill text,
  misconception text,
  mistake_pattern text,
  hint_level_needed text,
  tutoring_summary text not null,
  confidence_estimate numeric,
  created_at timestamptz not null default now()
);

create index if not exists learning_memories_user_created_idx
on public.learning_memories (user_id, created_at desc);

create index if not exists learning_memories_user_topic_idx
on public.learning_memories (user_id, topic);

create index if not exists learning_memories_user_skill_idx
on public.learning_memories (user_id, skill);

alter table public.learning_memories enable row level security;

drop policy if exists "Users can read their learning memories"
on public.learning_memories;

create policy "Users can read their learning memories"
on public.learning_memories
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their learning memories"
on public.learning_memories;

create policy "Users can insert their learning memories"
on public.learning_memories
for insert
with check (auth.uid() = user_id);

create table if not exists public.assignment_problems (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  question text not null,
  normalized_question text generated always as (
    regexp_replace(lower(btrim(question)), '\s+', ' ', 'g')
  ) stored,
  attempt text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.assignment_problems
add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.assignment_problems
add column if not exists assignment_id uuid references public.assignments(id) on delete cascade;

alter table public.assignment_problems
add column if not exists question text;

alter table public.assignment_problems
add column if not exists attempt text;

alter table public.assignment_problems
add column if not exists source text not null default 'manual';

alter table public.assignment_problems
add column if not exists created_at timestamptz not null default now();

alter table public.assignment_problems
add column if not exists updated_at timestamptz not null default now();

alter table public.assignment_problems
add column if not exists normalized_question text generated always as (
  regexp_replace(lower(btrim(question)), '\s+', ' ', 'g')
) stored;

create index if not exists assignment_problems_assignment_created_idx
on public.assignment_problems (assignment_id, created_at);

create index if not exists assignment_problems_user_created_idx
on public.assignment_problems (user_id, created_at desc);

create unique index if not exists assignment_problems_user_unique_problem_idx
on public.assignment_problems (user_id, normalized_question);

alter table public.assignment_problems enable row level security;

drop policy if exists "Users can read their assignment problems"
on public.assignment_problems;

create policy "Users can read their assignment problems"
on public.assignment_problems
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their assignment problems"
on public.assignment_problems;

create policy "Users can insert their assignment problems"
on public.assignment_problems
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their assignment problems"
on public.assignment_problems;

create policy "Users can update their assignment problems"
on public.assignment_problems
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete their assignment problems"
on public.assignment_problems;

create policy "Users can delete their assignment problems"
on public.assignment_problems
for delete
using (auth.uid() = user_id);

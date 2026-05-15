create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.learning_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists conversation_messages_user_created_idx
on public.conversation_messages (user_id, created_at desc);

create index if not exists conversation_messages_session_created_idx
on public.conversation_messages (session_id, created_at asc);

alter table public.conversation_messages enable row level security;

drop policy if exists "Users can read their conversation messages"
on public.conversation_messages;

create policy "Users can read their conversation messages"
on public.conversation_messages
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert their conversation messages"
on public.conversation_messages;

create policy "Users can insert their conversation messages"
on public.conversation_messages
for insert
with check (auth.uid() = user_id);


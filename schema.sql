-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Hosts Profiles (synced with auth.users)
create table public.hosts (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

-- 2. Quizzes (reusable templates)
create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  host_id uuid references public.hosts(id) on delete cascade not null,
  title text not null,
  description text,
  cover_image_url text,
  theme jsonb default '{"bgColor": "#0f172a", "textColor": "#ffffff", "primaryColor": "#6366f1"}'::jsonb, -- custom theme styles
  randomize_questions boolean default false,
  randomize_answers boolean default false,
  team_mode boolean default false,
  double_points_rounds jsonb default '[]'::jsonb, -- array of question indices or IDs
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. Questions
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid references public.quizzes(id) on delete cascade not null,
  order_index int not null,
  type text not null, -- 'mcq' | 'true_false' | 'multi_select' | 'type_answer' | 'poll'
  prompt text not null,
  media_url text,
  media_type text, -- 'image' | 'video' | null
  time_limit_seconds int default 20,
  points_base int default 1000, -- max points
  scoring_type text default 'linear' not null, -- 'linear' | 'flat' | 'none'
  answers jsonb not null, -- [{id, text, is_correct, color, shape, image_url?}]
  created_at timestamptz default now()
);

-- 4. Game Sessions
create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid references public.quizzes(id) on delete set null,
  host_id uuid references public.hosts(id) on delete cascade not null,
  pin text unique not null, -- 6-digit join PIN code
  status text default 'lobby' not null, -- 'lobby' | 'question_active' | 'question_reveal' | 'leaderboard' | 'finished'
  current_question_index int default 0 not null,
  question_started_at timestamptz,
  created_at timestamptz default now()
);

-- 5. Players (no auth, joining via PIN + device session client_token)
create table public.players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.game_sessions(id) on delete cascade not null,
  nickname text not null,
  client_token text not null, -- stored in localStorage for reconnects
  score int default 0 not null,
  streak int default 0 not null,
  joined_at timestamptz default now(),
  connected boolean default true not null
);

-- 6. Answers Submitted (scoring & anti-cheat source of truth)
create table public.answers_submitted (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.game_sessions(id) on delete cascade not null,
  question_id uuid references public.questions(id) on delete cascade not null,
  player_id uuid references public.players(id) on delete cascade not null,
  selected_answer_ids jsonb not null, -- array of selected options
  answered_at timestamptz default now(),
  time_taken_ms int not null,
  points_awarded int not null,
  is_correct boolean not null,
  unique(session_id, question_id, player_id)
);

-- Enable Row Level Security (RLS)
alter table public.hosts enable row level security;
alter table public.quizzes enable row level security;
alter table public.questions enable row level security;
alter table public.game_sessions enable row level security;
alter table public.players enable row level security;
alter table public.answers_submitted enable row level security;

-- RLS Policies

-- Hosts profile policies
create policy "Hosts can read own profile" on public.hosts
  for select using (auth.uid() = id);
create policy "Hosts can update own profile" on public.hosts
  for update using (auth.uid() = id);

-- Quizzes policies
create policy "Hosts can manage own quizzes" on public.quizzes
  for all using (auth.uid() = host_id);

-- Questions policies (inherits ownership check from quizzes table)
create policy "Hosts can manage own quiz questions" on public.questions
  for all using (
    exists (
      select 1 from public.quizzes
      where quizzes.id = questions.quiz_id and quizzes.host_id = auth.uid()
    )
  );

-- Game Sessions policies
create policy "Hosts can manage own game sessions" on public.game_sessions
  for all using (auth.uid() = host_id);
create policy "Public can view game sessions" on public.game_sessions
  for select using (true);

-- Players policies
create policy "Hosts can manage players" on public.players
  for all using (
    exists (
      select 1 from public.game_sessions
      where game_sessions.id = players.session_id and game_sessions.host_id = auth.uid()
    )
  );
create policy "Public can view players" on public.players
  for select using (true);
create policy "Public can join games" on public.players
  for insert with check (true);
create policy "Players can update own record" on public.players
  for update using (true);
-- Note: Insert and update of players connection states will be gated/verified through secure server endpoints (Next.js backend) to prevent client-side profile hijacks.

-- Answers Submitted policies
create policy "Hosts can read answers submitted" on public.answers_submitted
  for select using (
    exists (
      select 1 from public.game_sessions
      where game_sessions.id = answers_submitted.session_id and game_sessions.host_id = auth.uid()
    )
  );
-- Note: Insert and update of submissions is strictly handled via Next.js backend API /api/submit-answer using high-privilege client, enforcing timer rules.


create policy "Public can view quizzes" on public.quizzes
  for select using (true);

create policy "Public can view questions" on public.questions
  for select using (true);


-- Triggers

-- Automatically create a host profile row when a user signs up on Supabase Auth
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.hosts (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Enable Supabase Realtime for live multiplayer updates
alter publication supabase_realtime add table public.game_sessions;
alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.answers_submitted;

-- Enable full replica identity on players so DELETE event filters on session_id match successfully
alter table public.players replica identity full;

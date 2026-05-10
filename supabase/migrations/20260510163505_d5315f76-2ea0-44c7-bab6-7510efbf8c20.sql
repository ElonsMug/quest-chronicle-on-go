create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  spirit_name text not null,
  created_at timestamp with time zone not null default now()
);

create table public.game_saves (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade unique,
  class_id text not null,
  gender text,
  game_state jsonb not null,
  updated_at timestamp with time zone not null default now()
);

alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);
create policy "own profile delete" on public.profiles for delete using (auth.uid() = id);

alter table public.game_saves enable row level security;
create policy "own saves select" on public.game_saves for select using (auth.uid() = user_id);
create policy "own saves insert" on public.game_saves for insert with check (auth.uid() = user_id);
create policy "own saves update" on public.game_saves for update using (auth.uid() = user_id);
create policy "own saves delete" on public.game_saves for delete using (auth.uid() = user_id);
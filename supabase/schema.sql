-- Life Manager — Supabase schema
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- One generic table holds every record (classes, assignments, tasks, habits, check-ins, blocks).

create table if not exists public.records (
  user_id           uuid        not null default auth.uid() references auth.users on delete cascade,
  id                text        not null,
  kind              text        not null,
  data              jsonb       not null default '{}'::jsonb,
  deleted           boolean     not null default false,
  updated_at        timestamptz not null,              -- set by the device that made the edit
  server_updated_at timestamptz not null default now(), -- set by the server; used to pull changes
  primary key (user_id, id)
);

create index if not exists records_user_server_updated on public.records (user_id, server_updated_at);

-- Row-level security: you can only ever see and change your own rows.
alter table public.records enable row level security;

drop policy if exists "own rows" on public.records;
create policy "own rows" on public.records
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Last-write-wins: ignore an update that is older than what's already stored
-- (e.g. a phone that was offline for a day pushing a stale edit).
create or replace function public.records_lww() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- skip this row; keep the newer version
  end if;
  new.server_updated_at := now();
  return new;
end $$;

drop trigger if exists records_lww on public.records;
create trigger records_lww
  before insert or update on public.records
  for each row execute function public.records_lww();

-- Realtime: lets the Mac update live when you change something on the iPhone (and vice versa).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records'
  ) then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;

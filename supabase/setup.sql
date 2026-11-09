-- Frolich Cake Tracker – Supabase setup
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It is safe to run more than once.
--
-- ⚠️ BEFORE RUNNING: change the email on the last lines to the staff login email
--    you created under Authentication → Users.

-- ---------- tables ----------
create table if not exists public.items (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 80),
  category     text not null default 'other' check (category in ('cake', 'fruit', 'other')),
  delivered_at timestamptz,
  opened_at    timestamptz,
  defrosted_at timestamptz,
  expires_at   timestamptz not null,
  notes        text not null default '' check (char_length(notes) <= 500),
  logged_by    text not null default '' check (char_length(logged_by) <= 40),
  photo        text,
  status       text not null default 'active' check (status in ('active', 'binned', 'used')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  closed_at    timestamptz,
  closed_by    text not null default '' check (char_length(closed_by) <= 40),
  constraint items_has_start check (delivered_at is not null or opened_at is not null or defrosted_at is not null)
);
-- Projects set up before the defrost date existed get the column here too.
alter table public.items add column if not exists defrosted_at timestamptz;
alter table public.items drop constraint if exists items_has_start;
alter table public.items add constraint items_has_start
  check (delivered_at is not null or opened_at is not null or defrosted_at is not null);
create index if not exists items_status_expires on public.items (status, expires_at);
create index if not exists items_closed_at on public.items (closed_at desc);

create table if not exists public.presets (
  id       uuid primary key default gen_random_uuid(),
  name     text not null check (char_length(name) between 1 and 80),
  category text not null default 'other' check (category in ('cake', 'fruit', 'other')),
  days     int  not null check (days between 1 and 60)
);

-- Who is allowed in. Only logins whose email is listed here can see or change anything,
-- so it stays private even if someone else signs up to your project.
create table if not exists public.staff (
  email text primary key
);

-- ---------- access rules ----------
create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.staff where email = lower(auth.jwt() ->> 'email'));
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

alter table public.items   enable row level security;
alter table public.presets enable row level security;
alter table public.staff   enable row level security; -- no policies: nobody can read it via the API

drop policy if exists "staff only" on public.items;
create policy "staff only" on public.items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff only" on public.presets;
create policy "staff only" on public.presets
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.items, public.presets to authenticated;
revoke all on public.items, public.presets, public.staff from anon;

-- ---------- photos (private storage bucket) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "staff read photos" on storage.objects;
create policy "staff read photos" on storage.objects
  for select to authenticated using (bucket_id = 'photos' and public.is_staff());

drop policy if exists "staff add photos" on storage.objects;
create policy "staff add photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and public.is_staff());

drop policy if exists "staff delete photos" on storage.objects;
create policy "staff delete photos" on storage.objects
  for delete to authenticated using (bucket_id = 'photos' and public.is_staff());

-- ---------- live updates (other phones refresh instantly) ----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'items'
  ) then
    alter publication supabase_realtime add table public.items;
  end if;
end $$;

-- ---------- starting shelf lives (only added if the list is empty) ----------
insert into public.presets (name, category, days)
select * from (values
  ('Victoria sponge', 'cake', 3), ('Carrot cake', 'cake', 3), ('Chocolate cake', 'cake', 3),
  ('Lemon drizzle', 'cake', 3), ('Brownies', 'cake', 4), ('Cheesecake', 'cake', 2),
  ('Bananas', 'fruit', 5), ('Apples', 'fruit', 7), ('Oranges', 'fruit', 7), ('Berries', 'fruit', 2),
  ('Cut fruit / fruit pot', 'fruit', 1), ('Lemons & limes (cut)', 'fruit', 2)
) as v(name, category, days)
where not exists (select 1 from public.presets);

-- ---------- ⚠️ CHANGE THIS to your staff login email (lower case) ----------
insert into public.staff (email) values ('staff@example.com')
on conflict do nothing;

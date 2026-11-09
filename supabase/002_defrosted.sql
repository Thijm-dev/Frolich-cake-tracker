-- Adds the "Defrosted" date. Run once in Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.
alter table public.items add column if not exists defrosted_at timestamptz;
alter table public.items drop constraint if exists items_has_start;
alter table public.items add constraint items_has_start
  check (delivered_at is not null or opened_at is not null or defrosted_at is not null);

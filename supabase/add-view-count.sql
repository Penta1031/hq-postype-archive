alter table public.postype_archive
  add column if not exists view_count bigint,
  add column if not exists view_count_checked_at timestamptz;

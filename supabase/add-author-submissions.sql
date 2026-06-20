create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.postype_authors (
  id uuid primary key default gen_random_uuid(),
  display_name text not null unique,
  postype_channel_url text not null unique,
  key_hash text not null,
  key_value text,
  enabled boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.postype_authors
  add column if not exists key_value text;

create table if not exists public.postype_author_submissions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.postype_authors(id) on delete cascade,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected', 'withdrawn')),
  post_url text not null,
  postype_post_id bigint,
  title text not null,
  published_date date,
  category text not null default '글',
  is_paid boolean not null default false,
  is_adult boolean not null default false,
  genres text,
  keywords text,
  top_tags text,
  bottom_tags text,
  endings text,
  is_series boolean not null default false,
  series_name text,
  series_volume text,
  serialization_status text,
  review_note text,
  reviewed_at timestamptz,
  archived_post_id bigint references public.postype_archive(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.postype_author_submissions
  add column if not exists published_date date;

create index if not exists postype_author_submissions_author_idx
  on public.postype_author_submissions (author_id, created_at desc);
create index if not exists postype_author_submissions_status_idx
  on public.postype_author_submissions (status, created_at desc);

drop trigger if exists set_postype_authors_updated_at on public.postype_authors;
create trigger set_postype_authors_updated_at
before update on public.postype_authors
for each row execute function public.set_updated_at();

drop trigger if exists set_postype_author_submissions_updated_at on public.postype_author_submissions;
create trigger set_postype_author_submissions_updated_at
before update on public.postype_author_submissions
for each row execute function public.set_updated_at();

alter table public.postype_authors enable row level security;
alter table public.postype_author_submissions enable row level security;
revoke all on public.postype_authors from anon, authenticated;
revoke all on public.postype_author_submissions from anon, authenticated;

-- 모든 작가 로그인·신청·수정·삭제는 소유권을 검사하는 postype-admin Edge Function을 통합니다.

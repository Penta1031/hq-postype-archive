-- Run once in Supabase SQL Editor. Existing archive rows are not changed.

create table if not exists public.postype_filter_config (
  group_name text primary key check (group_name in ('장르', '키워드', '공', '수')),
  options jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.postype_filter_config (group_name, options)
values
  ('장르', '["현대물","학원물","캠게","노란장판","리맨물","판타지","오메가버스","가이드버스","회귀물","빙의물","환생물","재회물","첫사랑물","친구연애물","혐관물","시대물","연예계물","스포츠물","군부물","조폭물","피폐물","일상물","리얼물","수인물","종교물","느와르","청게"]'::jsonb),
  ('키워드', '["계약","재회","첫사랑","짝사랑","동거","오해","구원","집착","후회","복수","비밀연애","신분차이","나이차","소꿉친구","친구에서연인","정략결혼","임신","육아","상처","질투","쌍방구원","쌍방짝사랑","혐관","배틀연애","권선징악","달달물","코믹","잔잔물","피폐","외전","궁중물","환생","학원물","사고","일상물","죽음","상실","사내연애","원나잇","기억상실","좀비아포칼립스","스폰서","네임버스","프로게이머"]'::jsonb),
  ('공', '["다정공","헌신공","강공","냉혈공","무심공","까칠공","츤데레공","능글공","초딩공","집착공","광공","개아가공","계략공","후회공","사랑꾼공","순정공","절륜공","존댓말공","대형견공","연하공","연상공","재벌공","능력공","황제공","왕자공","귀족공","군인공","배우공","아이돌공","조폭공","양아치공","인외공","상처공","동정공","헤테로공","짝사랑공"]'::jsonb),
  ('수', '["다정수","단정수","소심수","헌신수","강수","냉혈수","무심수","까칠수","츤데레수","허당수","지랄수","계략수","유혹수","적극수","잔망수","명랑수","순진수","임신수","도망수","굴림수","후회수","능글수","능력수","순정수","떡대수","평범수","연하수","연상수","재벌수","황제수","왕자수","귀족수","군인수","배우수","아이돌수","조폭수","양아치수","인외수","상처수","병약수","동정수","헤테로수","짝사랑수"]'::jsonb)
on conflict (group_name) do nothing;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_postype_filter_config_updated_at on public.postype_filter_config;
create trigger set_postype_filter_config_updated_at
before update on public.postype_filter_config
for each row execute function public.set_updated_at();

alter table public.postype_filter_config enable row level security;
drop policy if exists "postype_filter_config_public_read" on public.postype_filter_config;
create policy "postype_filter_config_public_read"
on public.postype_filter_config
for select
to anon, authenticated
using (true);

revoke all on public.postype_filter_config from anon, authenticated;
grant select on public.postype_filter_config to anon, authenticated;

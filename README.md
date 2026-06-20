# 혚쾌 포타 검색기

포스타입 아카이브를 제목, 작가, 장르, 키워드, 공, 수, 스포일러, 연재상태로 검색하고 필터링하는 정리용 페이지입니다.

## 이용 안내

오류나 문의사항은 디엠 혹은 [큐리어스](https://curious.quizby.me/Penta_1031/m)로 문의 부탁드립니다.

## 데이터 연결

`config.js`에 Supabase 프로젝트 정보를 넣으면 `postype_archive` 테이블에서 데이터를 읽습니다.

```js
SUPABASE_URL: "https://프로젝트ID.supabase.co",
SUPABASE_ANON_KEY: "anon public key",
SUPABASE_TABLE: "postype_archive",
SUPABASE_PUBLIC_VIEW: "postype_archive_public"
```

샘플 포스트만 보이면 Supabase 연결이 실패한 상태입니다. 화면에 표시되는 상태 문구를 확인한 뒤 URL과 anon key를 다시 확인하세요.

## 보안 적용

`supabase/security-hardening.sql`을 Supabase SQL Editor에서 한 번 실행하면 공개 검색기는 검색에 필요한 열만 읽고, 내부 관리 정보는 관리자 로그인 후에만 읽습니다. 기존 데이터는 삭제되지 않습니다.

`supabase/add-filter-config.sql`을 한 번 실행하면 관리자 화면에서 장르·키워드·공·수 필터 단어를 추가하거나 목록에서 삭제할 수 있습니다. 변경한 목록은 검색 화면에 반영됩니다.

작가가 시리즈 글을 등록하거나 수정하면 같은 `series_name`의 장르·키워드·공·수 값이 함께 반영됩니다.

관리자 로그인은 실패 횟수를 제한하며, 성공 후 발급되는 임시 로그인 표는 30분 동안만 브라우저 메모리에 보관됩니다. Vercel 배포에서는 `vercel.json`의 보안 헤더도 자동 적용됩니다.
# 작가 업로드 채널

관리자는 모바일 관리자 모드의 `작가 계정·키 관리`에서 작가별 계정을 만들고 전용 키를 발급·재발급·정지할 수 있습니다. 키 원문은 DB에 저장하지 않고 SHA-256 해시만 저장하므로, 분실한 키는 조회하지 않고 새로 발급합니다.

작가는 `작가 업로드`에서 작가명과 전용 키로 로그인합니다. 등록된 본인 포스타입 채널의 글만 직접 등록할 수 있고, 기존에 관리자가 등록한 같은 작가명의 글까지 한번에 조회·수정·삭제할 수 있습니다. `posty.pe` 축약 링크도 지원합니다.

최초 설치 시 `supabase/add-author-submissions.sql`을 Supabase SQL Editor에서 한 번 실행하고 `postype-admin` Edge Function을 재배포합니다. 추가 Secret은 필요하지 않습니다.

`postype-admin`은 자체 관리자·작가 인증을 사용하므로 `supabase/config.toml`에서 Supabase JWT 사전 검증을 끄도록 고정합니다. 수동 배포 시에는 `supabase.cmd functions deploy postype-admin --no-verify-jwt --project-ref aiuwbwtknaceghkzporx`를 사용합니다.

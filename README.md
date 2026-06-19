# 혚쾌 포타 검색기

포스타입 아카이브를 제목, 작가, 장르, 키워드, 공, 수, 스포일러, 연재상태로 검색하고 필터링하는 정리용 페이지입니다.

## 이용 안내

아카이브 목록과 일부 분류 기능은 자동화되어 있으며, 자료 정리 목적 외에는 사용하지 않습니다.

일부 기능에 AI를 사용하고 있지만, 수집한 자료를 정리하고 검색하기 쉽게 만드는 용도로만 활용합니다.

목록에서 내리고 싶은 글이 있거나 오류, 문의사항이 있다면 디엠, 스핀, 또는 사이트 하단 문의로 편하게 연락해 주세요.

## 데이터 연결

`config.js`에 Supabase 프로젝트 정보를 넣으면 `postype_archive` 테이블에서 데이터를 읽습니다.

```js
SUPABASE_URL: "https://프로젝트ID.supabase.co",
SUPABASE_ANON_KEY: "anon public key",
SUPABASE_TABLE: "postype_archive",
SUPABASE_PUBLIC_VIEW: "postype_archive_public"
```

샘플 포스트만 보이면 Supabase 연결이 실패한 상태입니다. 화면에 표시되는 상태 문구를 확인한 뒤 URL과 anon key를 다시 확인하세요.

## 자동 크롤링 MVP

`supabase/schema.sql`을 Supabase SQL Editor에서 실행한 뒤 `postype_sources`에 크롤링할 포스타입 소스 URL을 넣어 주세요.

GitHub Actions Secret:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` 또는 `GEMINI_API_KEY`
- `POSTYPE_AUTH_STATE`
- `DISCORD_WEBHOOK_URL`

GitHub Actions Variable:

- `ADMIN_PAGE_URL`
- `SEND_DISCORD_WHEN_EMPTY` 기본값 `false`
- `POSTYPE_SOURCE_URLS` DB 소스가 비어 있을 때만 쓰는 쉼표 구분 fallback
- `AI_PROVIDER` 기본값 `openai`, Gemini를 쓰면 `gemini`
- `AI_FALLBACK_PROVIDER` Gemini 실패 시 OpenAI로 재시도하려면 `openai`
- `OPENAI_MODEL` 기본값 `gpt-4.1-mini`
- `GEMINI_MODEL` 기본값 `gemini-3.5-flash`
- `GEMINI_MAX_ATTEMPTS` Gemini 일시 오류 재시도 횟수, 기본값 `4`
- `AI_REVIEW_CONFIDENCE_THRESHOLD` 기본값 `0.72`
- `UPDATE_VIEW_COUNTS` 기존 글의 최신 조회수 갱신 여부, 기본값 `true`
- `VIEW_COUNT_CONCURRENCY` 조회수 확인 동시 실행 수, 기본값 `2`

`POSTYPE_AUTH_STATE`는 Playwright `storageState` JSON 또는 base64 JSON을 넣습니다. 로그인/성인글/구매글은 해당 계정이 정상 열람 가능한 범위에서만 수집되며, 접근 불가 글은 `crawl_status`로 실패 기록만 남깁니다.

관리자 화면의 “수동 크롤링 실행” 버튼은 `config.js`의 `MANUAL_CRAWL_URL` 또는 `GITHUB_REPOSITORY`를 설정하면 GitHub Actions 수동 실행 화면으로 연결됩니다.

관리자 화면에서 “수동 크롤링 실행” 버튼으로 GitHub Actions를 직접 실행하려면 Supabase Edge Function `postype-admin`에 아래 Secret을 추가합니다.

- `GITHUB_WORKFLOW_TOKEN` GitHub fine-grained token 또는 classic PAT. Actions workflow 실행 권한 필요
- `GITHUB_REPOSITORY` 예: `Penta1031/hq-postype-archive`
- `GITHUB_WORKFLOW_ID` 기본값 `postype-sync.yml`
- `GITHUB_WORKFLOW_REF` 기본값 `main`
- `ADMIN_ALLOWED_ORIGIN` 관리자 페이지 주소. 예: `https://hq-postype-archive.vercel.app`
- `ADMIN_SESSION_SECRET` 관리자 임시 로그인 표 서명용 긴 무작위 문자열

## 보안 적용

`supabase/security-hardening.sql`을 Supabase SQL Editor에서 한 번 실행하면 공개 검색기는 검색에 필요한 열만 읽고, AI 원본 응답·크롤링 오류·수집 출처 등은 관리자 로그인 후에만 읽습니다. 기존 데이터는 삭제되지 않습니다.

관리자 로그인은 실패 횟수를 제한하며, 성공 후 발급되는 임시 로그인 표는 30분 동안만 브라우저 메모리에 보관됩니다. Vercel 배포에서는 `vercel.json`의 보안 헤더도 자동 적용됩니다.

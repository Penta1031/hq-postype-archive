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
SUPABASE_TABLE: "postype_archive"
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

`POSTYPE_AUTH_STATE`는 Playwright `storageState` JSON 또는 base64 JSON을 넣습니다. 로그인/성인글/구매글은 해당 계정이 정상 열람 가능한 범위에서만 수집되며, 접근 불가 글은 `crawl_status`로 실패 기록만 남깁니다.

관리자 화면의 “새 글 확인” 버튼은 `config.js`의 `MANUAL_CRAWL_URL` 또는 `GITHUB_REPOSITORY`를 설정하면 GitHub Actions 수동 실행 화면으로 연결됩니다.

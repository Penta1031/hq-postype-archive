import { chromium } from "playwright";

const authFile = "postype-auth-state.json";
const userDataDir = "postype-login-profile";

console.log("포스타입 로그인 창을 Chrome으로 엽니다.");
console.log("1. 열린 브라우저에서 포스타입에 로그인하세요.");
console.log("2. 성인글을 읽을 계정이면 성인 인증/열람 가능 상태까지 확인하세요.");
console.log("3. 로그인 확인 후 이 터미널로 돌아와 Enter를 누르세요.");

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chrome",
  headless: false,
  locale: "ko-KR",
  timezoneId: "Asia/Seoul",
});
const page = await context.newPage();
await page.goto("https://www.postype.com/", { waitUntil: "domcontentloaded" });

await new Promise<void>((resolve) => {
  process.stdin.resume();
  process.stdin.once("data", () => resolve());
});

await context.storageState({ path: authFile });
await context.close();

console.log("");
console.log(`저장 완료: ${authFile}`);
console.log("전체 세션은 너무 클 수 있습니다.");
console.log("이어서 npm run compact-auth 를 실행하고, 거기서 나온 값을 GitHub Secret에 넣으세요.");
console.log("");

import { chromium } from "playwright";

const authFile = "postype-auth-state.json";
const cdpUrl = "http://127.0.0.1:9222";

console.log("이미 열린 일반 Chrome에서 포스타입 로그인 상태를 가져옵니다.");
console.log("Chrome을 --remote-debugging-port=9222 옵션으로 먼저 열어야 합니다.");
console.log("");

const browser = await chromium.connectOverCDP(cdpUrl);
const context = browser.contexts()[0];
if (!context) throw new Error("연결된 Chrome 브라우저 컨텍스트를 찾지 못했습니다.");

const page = context.pages()[0] || await context.newPage();
await page.goto("https://www.postype.com/", { waitUntil: "domcontentloaded" });

console.log("열린 Chrome에서 포스타입에 로그인되어 있는지 확인하세요.");
console.log("성인글까지 확인했다면 이 터미널로 돌아와 Enter를 누르세요.");

await new Promise<void>((resolve) => {
  process.stdin.resume();
  process.stdin.once("data", () => resolve());
});

await context.storageState({ path: authFile });
await browser.close();

console.log("");
console.log(`저장 완료: ${authFile}`);
console.log("전체 세션은 너무 클 수 있습니다.");
console.log("이어서 npm run compact-auth 를 실행하고, 거기서 나온 값을 GitHub Secret에 넣으세요.");
console.log("");

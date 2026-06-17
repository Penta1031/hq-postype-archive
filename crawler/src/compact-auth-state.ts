import { existsSync, readFileSync, writeFileSync } from "node:fs";

const inputFile = "postype-auth-state.json";
const outputFile = "postype-auth-state.compact.json";

if (!existsSync(inputFile)) {
  throw new Error(`${inputFile} 파일을 찾지 못했습니다. 먼저 로그인 세션을 저장해 주세요.`);
}

const state = JSON.parse(readFileSync(inputFile, "utf8"));
const compactState = compactStorageState(state);
const json = JSON.stringify(compactState);

writeFileSync(outputFile, json, "utf8");

console.log("");
console.log(`압축 저장 완료: ${outputFile}`);
console.log("아래 한 줄 전체를 GitHub Secret POSTYPE_AUTH_STATE 값으로 넣으세요.");
console.log("");
console.log(Buffer.from(json, "utf8").toString("base64"));

function compactStorageState(state: {
  cookies?: Array<{ domain?: string; name?: string }>;
  origins?: Array<{ origin?: string; localStorage?: Array<{ name?: string; value?: string }> }>;
}) {
  const cookies = (state.cookies || []).filter((cookie) => {
    const domain = String(cookie.domain || "").toLowerCase();
    return domain.includes("postype.com");
  });

  const origins = (state.origins || [])
    .filter((origin) => {
      const url = String(origin.origin || "").toLowerCase();
      return url.includes("postype.com");
    })
    .map((origin) => ({
      origin: origin.origin,
      localStorage: origin.localStorage || [],
    }));

  return { cookies, origins };
}

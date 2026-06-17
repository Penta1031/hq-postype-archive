import { optionalEnv, truthyEnv } from "./utils.js";
import type { RunSummary } from "./types.js";

export async function sendDiscord(summary: RunSummary) {
  const webhookUrl = optionalEnv("DISCORD_WEBHOOK_URL");
  if (!webhookUrl) return;
  if (!summary.foundCount && !truthyEnv("SEND_DISCORD_WHEN_EMPTY", false)) return;

  const adminUrl = optionalEnv("ADMIN_PAGE_URL");
  const lines = [
    "[혚쾌 포타 검색기] 새벽 크롤링 완료",
    "",
    `상태: ${summary.status === "success" ? "성공" : "실패"}`,
    `신규 발견: ${summary.foundCount}건`,
    `추가 성공: ${summary.insertedCount}건`,
    `AI 검수 필요: ${summary.aiReviewCount}건`,
    `실패: ${summary.failedCount}건`,
  ];

  if (summary.errorMessage) {
    lines.push("", `오류: ${summary.errorMessage.slice(0, 900)}`);
  }

  if (summary.newPosts.length) {
    lines.push("", "신규 글:");
    summary.newPosts.slice(0, 12).forEach((post, index) => {
      lines.push(`${index + 1}. ${post.title || "제목 없음"} / ${post.author || "작가 미상"}`);
    });
    if (summary.newPosts.length > 12) lines.push(`외 ${summary.newPosts.length - 12}건`);
  } else {
    lines.push("", "신규글 없음");
  }

  if (adminUrl) lines.push("", "관리자 확인:", adminUrl);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: lines.join("\n") }),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status} ${await response.text()}`);
  }
}

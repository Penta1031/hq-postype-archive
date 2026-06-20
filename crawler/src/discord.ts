import { optionalEnv } from "./utils.js";
import type { RunSummary } from "./types.js";

export async function sendDiscord(summary: RunSummary) {
  const webhookUrl = optionalEnv("DISCORD_WEBHOOK_URL");
  if (!webhookUrl) return;

  const adminUrl = optionalEnv("ADMIN_PAGE_URL");
  const actionRunUrl = githubActionRunUrl();
  const lines = [
    `[혚쾌 포타 검색기] ${workflowEventLabel()} 크롤링 완료`,
    "",
    `상태: ${statusLabel(summary.status)}`,
    `신규 발견: ${summary.foundCount}건`,
    `추가 성공: ${summary.insertedCount}건`,
    `신규 미노출: ${summary.reviewPendingCount}건`,
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
  if (actionRunUrl) lines.push("", "GitHub Actions 확인:", actionRunUrl);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: lines.join("\n") }),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status} ${await response.text()}`);
  }
}

function statusLabel(status: RunSummary["status"]) {
  if (status === "success") return "성공";
  if (status === "partial_success") return "부분 성공";
  return "실패";
}

function workflowEventLabel() {
  const eventName = optionalEnv("GITHUB_EVENT_NAME");
  if (eventName === "workflow_dispatch") return "수동";
  if (eventName === "schedule") return "새벽";
  return "자동";
}

function githubActionRunUrl() {
  const serverUrl = optionalEnv("GITHUB_SERVER_URL", "https://github.com");
  const repository = optionalEnv("GITHUB_REPOSITORY");
  const runId = optionalEnv("GITHUB_RUN_ID");
  if (!repository || !runId) return "";
  return `${serverUrl}/${repository}/actions/runs/${runId}`;
}

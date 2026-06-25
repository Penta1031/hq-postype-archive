import { sendDiscord } from "./discord.js";
import { collectPostLinks, createPostypeContext, extractPost, isExcludedPost } from "./postype.js";
import { createRun, finishRun, getEnabledSources, getExistingArchive, insertArchiveRow, markSourceChecked } from "./supabase.js";
import type { RunSummary } from "./types.js";
import { normalizePostUrl, optionalEnv, postypePostIdFromUrl, uniqueBy } from "./utils.js";

type ProcessTarget = {
  url: string;
  postypePostId: number | null;
  sourceUrl: string;
};

async function main() {
  const runId = await createRun();
  const summary: RunSummary = {
    status: "success",
    foundCount: 0,
    insertedCount: 0,
    reviewPendingCount: 0,
    failedCount: 0,
    newPosts: [],
  };

  const { browser, context } = await createPostypeContext();
  try {
    const manualPostUrl = optionalEnv("MANUAL_POST_URL");
    const links: ProcessTarget[] = manualPostUrl
      ? [manualPostLink(manualPostUrl)]
      : await collectConfiguredSourceLinks(context);

    const candidates = uniqueBy(links, candidateKey);
    const newLinks: ProcessTarget[] = [];
    const queuedKeys = new Set<string>();
    let excludedCount = 0;

    async function enqueueNewLink(link: ProcessTarget) {
      const key = candidateKey(link);
      if (!key || queuedKeys.has(key)) return false;
      queuedKeys.add(key);
      const existing = await getExistingArchive(link.url, link.postypePostId);
      if (existing) return false;
      newLinks.push(link);
      summary.foundCount = Math.max(0, newLinks.length - excludedCount);
      return true;
    }

    for (const link of candidates) await enqueueNewLink(link);

    for (let index = 0; index < newLinks.length; index += 1) {
      const link = newLinks[index];
      const post = await extractPost(context, link);
      for (const relatedLink of post.relatedLinks || []) {
        await enqueueNewLink(relatedLink);
      }

      try {
        if (isExcludedPost(post)) {
          excludedCount += 1;
          summary.foundCount = Math.max(0, newLinks.length - excludedCount);
          continue;
        }
        if (post.crawlStatus !== "success") {
          await insertArchiveRow(post, {
            ai_status: "skipped",
            ai_note: "AI 분류 미사용",
            admin_reviewed: false,
          });
          summary.failedCount += 1;
          continue;
        }

        const inserted = await insertArchiveRow(post, {
          ai_status: "skipped",
          ai_note: "AI 분류 미사용",
          admin_reviewed: false,
        });
        summary.insertedCount += 1;
        summary.reviewPendingCount += 1;
        summary.newPosts.push({
          title: inserted.title || post.title,
          author: inserted.author || post.author,
          link: inserted.link || post.link,
        });
      } catch (error) {
        summary.failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        await insertArchiveRow(
          { ...post, crawlStatus: "error", crawlError: message },
          { ai_status: "skipped", ai_note: "AI 분류 미사용", admin_reviewed: false },
        ).catch(() => undefined);
      }
    }

    summary.status = summary.failedCount > 0 ? "partial_success" : "success";
    await finishRun(runId, {
      status: summary.status,
      found_count: summary.foundCount,
      inserted_count: summary.insertedCount,
      ai_review_count: summary.reviewPendingCount,
      failed_count: summary.failedCount,
    });
  } catch (error) {
    summary.status = "failed";
    summary.errorMessage = error instanceof Error ? error.message : String(error);
    await finishRun(runId, {
      status: "failed",
      found_count: summary.foundCount,
      inserted_count: summary.insertedCount,
      ai_review_count: summary.reviewPendingCount,
      failed_count: summary.failedCount,
      error_message: summary.errorMessage,
    }).catch(() => undefined);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }

  await sendDiscord(summary);
}

async function collectConfiguredSourceLinks(context: Awaited<ReturnType<typeof createPostypeContext>>["context"]) {
  const sources = await getEnabledSources();
  if (!sources.length) throw new Error("No enabled postype_sources or POSTYPE_SOURCE_URLS configured.");

  const links: ProcessTarget[] = [];
  for (const source of sources) {
    const found = await collectPostLinks(context, source.source_url);
    links.push(...found);
    await markSourceChecked(source.source_url);
  }
  return links;
}

function candidateKey(item: ProcessTarget) {
  return item.postypePostId ? String(item.postypePostId) : item.url;
}

function manualPostLink(rawUrl: string): ProcessTarget {
  const url = normalizePostUrl(rawUrl, "https://www.postype.com");
  if (!url) throw new Error("MANUAL_POST_URL is not a valid URL.");
  const parsed = new URL(url);
  if (!(parsed.hostname === "postype.com" || parsed.hostname.endsWith(".postype.com")) || !/\/post\/\d+/.test(parsed.pathname)) {
    throw new Error("MANUAL_POST_URL must be a Postype post URL.");
  }
  return {
    url,
    postypePostId: postypePostIdFromUrl(url),
    sourceUrl: "manual-admin",
  };
}

main().catch(async (error) => {
  await sendDiscord({
    status: "failed",
    foundCount: 0,
    insertedCount: 0,
    reviewPendingCount: 0,
    failedCount: 1,
    errorMessage: error instanceof Error ? error.message : String(error),
    newPosts: [],
  }).catch(() => undefined);
  console.error(error);
  process.exit(1);
});

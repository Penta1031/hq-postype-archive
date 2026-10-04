import { sendDiscord } from "./discord.js";
import { classificationRow, classifyPost, configureFilterTaxonomy } from "./classify.js";
import { collectPostLinks, createPostypeContext, extractPost, isExcludedPost } from "./postype.js";
import { titleSeriesPatch } from "./series.js";
import { backfillUnreviewedTitleSeries, createRun, finishRun, getEnabledSources, getExistingArchive, getFilterConfig, getUnreviewedAiCandidates, insertArchiveRow, markSourceChecked, updateArchiveRow } from "./supabase.js";
import type { RunSummary } from "./types.js";
import { normalizePostUrl, optionalEnv, postypePostIdFromUrl, truthyEnv, uniqueBy } from "./utils.js";

type ProcessTarget = {
  url: string;
  postypePostId: number | null;
  sourceUrl: string;
  targetEvidence: string;
};

async function main() {
  const runId = await createRun();
  const seriesBackfill = await backfillUnreviewedTitleSeries();
  console.log(`TITLE_SERIES_BACKFILL ${JSON.stringify(seriesBackfill)}`);
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
    configureFilterTaxonomy(await getFilterConfig());
    const runFullAiBackfill = truthyEnv("AI_BACKFILL_UNREVIEWED");
    const retryFailedAi = truthyEnv("RETRY_FAILED_AI", true);
    if (runFullAiBackfill || retryFailedAi) {
      const result = await classifyExistingUnreviewed(context, runFullAiBackfill);
      summary.reviewPendingCount += result.classifiedCount;
      summary.failedCount += result.failedCount;
      console.log(`AI_BACKFILL ${JSON.stringify(result)}`);
    }

    const manualPostUrl = optionalEnv("MANUAL_POST_URL");
    const links: ProcessTarget[] = manualPostUrl
      ? [manualPostLink(manualPostUrl)]
      : await collectConfiguredSourceLinks(context);

    const candidates = uniqueBy(links, (item) => item.postypePostId ? String(item.postypePostId) : item.url);
    const newLinks: ProcessTarget[] = [];
    for (const link of candidates) {
      const existing = await getExistingArchive(link.url, link.postypePostId);
      if (!existing || existing.deleted_at) newLinks.push(link);
    }

    summary.foundCount = newLinks.length;

    for (const link of newLinks) {
      const post = await extractPost(context, link);
      try {
        if (isExcludedPost(post)) {
          summary.foundCount = Math.max(0, summary.foundCount - 1);
          continue;
        }
        if (post.crawlStatus !== "success") {
          await insertArchiveRow(post, {
            ai_status: "skipped",
            ai_note: "본문 접근 불가로 AI 분류 생략",
            admin_reviewed: false,
            ...titleSeriesPatch(post.title),
          });
          summary.failedCount += 1;
          continue;
        }

        let aiPatch: Record<string, unknown>;
        try {
          aiPatch = classificationRow(await classifyPost(post));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          aiPatch = { ai_status: "failed", ai_note: `AI 분류 실패: ${message}`.slice(0, 500) };
          summary.failedCount += 1;
        }
        const inserted = await insertArchiveRow(post, { ...aiPatch, admin_reviewed: false });
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
          { ai_status: "failed", ai_note: `수집 또는 AI 분류 실패: ${message}`.slice(0, 500), admin_reviewed: false, ...titleSeriesPatch(post.title) },
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

async function classifyExistingUnreviewed(
  context: Awaited<ReturnType<typeof createPostypeContext>>["context"],
  includeSkipped: boolean,
) {
  const limit = Number(optionalEnv("AI_BACKFILL_LIMIT", "5000"));
  const delayMs = Math.max(0, Number(optionalEnv("AI_BACKFILL_DELAY_MS", "800")) || 0);
  const candidates = await getUnreviewedAiCandidates(includeSkipped, limit);
  let classifiedCount = 0;
  let failedCount = 0;

  for (const [index, row] of candidates.entries()) {
    const target: ProcessTarget = {
      url: row.link,
      postypePostId: row.postype_post_id,
      sourceUrl: row.source_url || "ai-backfill",
      targetEvidence: "",
    };
    try {
      const post = await extractPost(context, target);
      if (post.crawlStatus !== "success") {
        throw new Error(post.crawlError || `본문 접근 불가: ${post.crawlStatus}`);
      }
      if (isExcludedPost(post)) {
        await updateArchiveRow(row.id, { ai_status: "excluded", ai_note: "제외 대상 글로 AI 분류 생략" });
        continue;
      }
      await updateArchiveRow(row.id, {
        ...classificationRow(await classifyPost(post)),
        crawled_at: new Date().toISOString(),
        crawl_status: "success",
        crawl_error: null,
      });
      classifiedCount += 1;
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : String(error);
      await updateArchiveRow(row.id, {
        ai_status: "failed",
        ai_note: `AI 재분류 실패: ${message}`.slice(0, 500),
      }).catch(() => undefined);
    }
    console.log(`AI_BACKFILL_PROGRESS ${index + 1}/${candidates.length} classified=${classifiedCount} failed=${failedCount}`);
    if (delayMs && index + 1 < candidates.length) await sleep(delayMs);
  }

  return { candidateCount: candidates.length, classifiedCount, failedCount };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    targetEvidence: "",
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

import { classificationRow, classifyPost, reviewRequired } from "./classify.js";
import { sendDiscord } from "./discord.js";
import { collectPostLinks, createPostypeContext, extractPost } from "./postype.js";
import { createRun, finishRun, getEnabledSources, getExistingArchive, insertArchiveRow, markSourceChecked, updateArchiveRow } from "./supabase.js";
import type { RunSummary } from "./types.js";
import { truthyEnv, uniqueBy } from "./utils.js";

type ProcessTarget = {
  url: string;
  postypePostId: number | null;
  sourceUrl: string;
  existingId?: number;
};

async function main() {
  const runId = await createRun();
  const summary: RunSummary = {
    status: "success",
    foundCount: 0,
    insertedCount: 0,
    aiReviewCount: 0,
    failedCount: 0,
    newPosts: [],
  };

  const { browser, context } = await createPostypeContext();
  try {
    const sources = await getEnabledSources();
    if (!sources.length) throw new Error("No enabled postype_sources or POSTYPE_SOURCE_URLS configured.");

    const links = [];
    for (const source of sources) {
      const found = await collectPostLinks(context, source.source_url);
      links.push(...found);
      await markSourceChecked(source.source_url);
    }

    const candidates = uniqueBy(links, (item) => item.postypePostId ? String(item.postypePostId) : item.url);
    const retryFailedAi = truthyEnv("RETRY_FAILED_AI", true);
    const newLinks: ProcessTarget[] = [];
    for (const link of candidates) {
      const existing = await getExistingArchive(link.url, link.postypePostId);
      if (!existing) {
        newLinks.push(link);
        continue;
      }
      const retryableAiStatus = ["failed", "review_required", "pending"];
      if (retryFailedAi && !existing.admin_reviewed && retryableAiStatus.includes(existing.ai_status)) {
        newLinks.push({ ...link, existingId: existing.id });
      }
    }

    summary.foundCount = newLinks.length;

    for (const link of newLinks) {
      const post = await extractPost(context, link);
      try {
        if (post.crawlStatus !== "success") {
          await insertArchiveRow(post, { ai_status: "skipped" });
          summary.failedCount += 1;
          continue;
        }

        const inserted = link.existingId
          ? await updateArchiveRow(link.existingId, {
            ai_status: "pending",
            ai_note: "",
            title: post.title,
            author: post.author,
            published_date: post.publishedDate,
            category: "글",
            is_paid: post.isPaid,
            is_adult: post.isAdult,
            crawl_status: post.crawlStatus,
            crawl_error: post.crawlError,
            crawled_at: new Date().toISOString(),
          })
          : await insertArchiveRow(post, { ai_status: "pending" });

        if (!link.existingId) {
          summary.insertedCount += 1;
          summary.newPosts.push({
            title: inserted.title || post.title,
            author: inserted.author || post.author,
            link: inserted.link || post.link,
          });
        }
        try {
          const classification = await classifyPost(post);
          const row = classificationRow(classification);
          await updateArchiveRow(inserted.id, row);
          if (reviewRequired(classification.confidence)) summary.aiReviewCount += 1;
        } catch (error) {
          summary.failedCount += 1;
          await updateArchiveRow(inserted.id, {
            ai_status: "failed",
            ai_note: error instanceof Error ? error.message : String(error),
          }).catch(() => undefined);
        }
      } catch (error) {
        summary.failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        await insertArchiveRow(
          { ...post, crawlStatus: "error", crawlError: message },
          { ai_status: "failed" },
        ).catch(() => undefined);
      }
    }

    summary.status = summary.failedCount > 0 ? "partial_success" : "success";
    await finishRun(runId, {
      status: summary.status,
      found_count: summary.foundCount,
      inserted_count: summary.insertedCount,
      ai_review_count: summary.aiReviewCount,
      failed_count: summary.failedCount,
    });
  } catch (error) {
    summary.status = "failed";
    summary.errorMessage = error instanceof Error ? error.message : String(error);
    await finishRun(runId, {
      status: "failed",
      found_count: summary.foundCount,
      inserted_count: summary.insertedCount,
      ai_review_count: summary.aiReviewCount,
      failed_count: summary.failedCount,
      error_message: summary.errorMessage,
    }).catch(() => undefined);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }

  await sendDiscord(summary);
}

main().catch(async (error) => {
  await sendDiscord({
    status: "failed",
    foundCount: 0,
    insertedCount: 0,
    aiReviewCount: 0,
    failedCount: 1,
    errorMessage: error instanceof Error ? error.message : String(error),
    newPosts: [],
  }).catch(() => undefined);
  console.error(error);
  process.exit(1);
});

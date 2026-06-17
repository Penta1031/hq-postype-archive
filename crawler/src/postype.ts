import type { BrowserContext, Page } from "playwright";
import { chromium } from "playwright";
import { compactText, normalizePostUrl, parseAuthState, postypePostIdFromUrl, todayIsoDate, uniqueBy } from "./utils.js";
import type { ExtractedPost, PostLink } from "./types.js";

export async function createPostypeContext() {
  const authState = process.env.POSTYPE_AUTH_STATE ? parseAuthState(process.env.POSTYPE_AUTH_STATE) : undefined;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: authState,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  });
  return { browser, context };
}

export async function collectPostLinks(context: BrowserContext, sourceUrl: string) {
  const page = await context.newPage();
  try {
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settleAndScroll(page);
    const hrefs = await page.locator("a[href]").evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).href)
    );
    const postLinks = hrefs
      .map((href) => normalizePostUrl(href, sourceUrl))
      .filter((href) => href && /\/post\/\d+/.test(href))
      .map((url): PostLink => ({ url, postypePostId: postypePostIdFromUrl(url), sourceUrl }));
    return uniqueBy(postLinks, (item) => item.url);
  } finally {
    await page.close();
  }
}

async function settleAndScroll(page: Page) {
  await page.waitForTimeout(1500);
  for (let index = 0; index < 4; index += 1) {
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(900);
  }
}

export async function extractPost(context: BrowserContext, link: PostLink): Promise<ExtractedPost> {
  const page = await context.newPage();
  try {
    const response = await page.goto(link.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1500);
    const status = response?.status() || 0;
    if (status >= 400) return deniedPost(link, "error", `HTTP ${status}`);

    const rawText = compactText(await page.locator("body").innerText({ timeout: 10_000 }).catch(() => ""), 6000);
    const accessStatus = accessProblem(rawText);
    const bodyText = await extractBodyText(page);

    if (accessStatus && bodyText.length < 500) {
      return deniedPost(link, accessStatus, accessStatus === "purchase_required" ? "구매 또는 유료 열람이 필요합니다." : "현재 로그인 세션으로 열람할 수 없습니다.");
    }

    const title = await firstText(page, [
      "meta[property='og:title']",
      "h1",
      "[class*='title']",
    ], "content");
    const author = await firstText(page, [
      "meta[name='author']",
      "[class*='author']",
      "a[href*='/@']",
    ], "content");
    const publishedDate = await firstText(page, ["time[datetime]", "time"], "datetime");
    const tags = await page.locator("a[href*='tag'], [class*='tag']").evaluateAll((nodes) =>
      nodes.map((node) => (node.textContent || "").trim()).filter(Boolean).slice(0, 30)
    ).catch(() => []);

    return {
      postypePostId: link.postypePostId,
      sourceUrl: link.sourceUrl,
      link: link.url,
      title: cleanTitle(title) || `포스타입 글 ${link.postypePostId || ""}`.trim(),
      author: cleanAuthor(author),
      publishedDate: todayIsoDate(publishedDate),
      bodyText,
      preview: "",
      tags: [...new Set(tags)],
      isAdult: /성인|19세|19금|adult/i.test(rawText),
      isPaid: /유료|구매|후원|멤버십|paid/i.test(rawText),
      crawlStatus: "success",
      crawlError: null,
    };
  } catch (error) {
    return deniedPost(link, "error", error instanceof Error ? error.message : String(error));
  } finally {
    await page.close();
  }
}

async function extractBodyText(page: Page) {
  for (const selector of ["article", "main", "[class*='content']", "[class*='post']", "body"]) {
    const text = await page.locator(selector).first().innerText({ timeout: 4000 }).catch(() => "");
    const compacted = compactText(text, 40_000);
    if (compacted.length > 300) return compacted;
  }
  return "";
}

async function firstText(page: Page, selectors: string[], attr?: string) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const value = attr ? await locator.getAttribute(attr).catch(() => "") : "";
    if (value?.trim()) return value.trim();
    const text = await locator.innerText({ timeout: 2000 }).catch(() => "");
    if (text?.trim()) return text.trim();
  }
  return "";
}

function accessProblem(text: string) {
  if (/구매해야|구매 후|유료 글|결제가 필요|판매 중지/.test(text)) return "purchase_required" as const;
  if (/로그인이 필요|열람할 수 없|접근할 수 없|권한이 없|비공개/.test(text)) return "access_denied" as const;
  return null;
}

function deniedPost(link: PostLink, status: ExtractedPost["crawlStatus"], message: string): ExtractedPost {
  return {
    postypePostId: link.postypePostId,
    sourceUrl: link.sourceUrl,
    link: link.url,
    title: `접근 불가 글 ${link.postypePostId || ""}`.trim(),
    author: "",
    publishedDate: null,
    bodyText: "",
    preview: "",
    tags: [],
    isAdult: false,
    isPaid: status === "purchase_required",
    crawlStatus: status,
    crawlError: message,
  };
}

function cleanTitle(value: string) {
  return value.replace(/\s*-\s*Postype.*$/i, "").trim();
}

function cleanAuthor(value: string) {
  return value.replace(/^@/, "").trim();
}

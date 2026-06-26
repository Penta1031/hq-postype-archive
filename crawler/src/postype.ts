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
    const candidates = await page.locator("a[href]").evaluateAll((links) =>
      links.map((link) => {
        const anchor = link as HTMLAnchorElement;
        let cardText = (anchor.innerText || anchor.textContent || "").trim();
        let parent = anchor.parentElement;
        for (let depth = 0; depth < 5 && parent; depth += 1, parent = parent.parentElement) {
          const text = (parent.innerText || "").trim();
          if (text.length >= cardText.length && text.length <= 1600) cardText = text;
          if (parent.matches("article, li")) break;
        }
        const sectionText = (anchor.closest("section")?.textContent || "").trim();
        return {
          href: anchor.href,
          contextText: [cardText, sectionText.length <= 2500 ? sectionText : ""].filter(Boolean).join("\n"),
        };
      })
    );
    const postLinks: PostLink[] = [];
    for (const candidate of candidates) {
      const url = normalizePostUrl(candidate.href, sourceUrl);
      if (!url || !/\/post\/\d+/.test(url) || isPromotionalCandidate(url, candidate.contextText)) continue;
      // A source feed can include recommended or unrelated links. Only keep a
      // link when the card/source context explicitly identifies it as 혚쾌.
      if (!hasHyeopkwaeEvidence(candidate.contextText)) continue;
      postLinks.push({
        url,
        postypePostId: postypePostIdFromUrl(url),
        sourceUrl,
        targetEvidence: compactText(candidate.contextText, 2_500),
      });
    }
    return uniqueBy(postLinks, (item) => item.url);
  } finally {
    await page.close();
  }
}

const PROMOTION_MARKERS = /(?:^|\s)광고(?:\s|$)|프로모션|협찬|제휴|공동\s*구매|공구|굿즈\s*(?:판매|공구|예약|출시)|(?:판매|모집)\s*(?:공지|안내)|포스타입\s*(?:공식|이벤트|프로모션|포인트)|포인트\s*충전|보너스\s*코인|세계관\s*메이커|오픈\s*채널\s*랭킹|공식\s*커뮤니티|재방문\s*많은\s*리퀘스트|좋아서\s*또\s*왔어요|바라바라/iu;
const FEED_SECTION_MARKERS = /이\s*채널(?:의)?\s*(?:글|포스트|인기글|추천)|채널\s*(?:추천|랭킹)|추천\s*(?:글|포스트|작품)|함께\s*보면\s*좋은\s*글|이런\s*글은\s*어때요|지금\s*뜨는\s*글|실시간\s*인기/iu;
const HYEOPKWAE_MARKER = /[혚혜]\s*쾌/iu;
const SEUNGHYUB_MARKER = /이\s*승\s*협/iu;
const HWESEUNG_MARKER = /유\s*회\s*승/iu;

function isPromotionalCandidate(url: string, contextText: string) {
  const pathname = new URL(url).pathname.toLowerCase();
  if (/\/@(?:postype|postype_official|barabara[^/]*)(?:\/|$)/.test(pathname)) return true;
  return PROMOTION_MARKERS.test(contextText) || FEED_SECTION_MARKERS.test(contextText);
}

function hasHyeopkwaeEvidence(value: string) {
  return HYEOPKWAE_MARKER.test(value) || (SEUNGHYUB_MARKER.test(value) && HWESEUNG_MARKER.test(value));
}

export function isExcludedPost(post: ExtractedPost) {
  const pathname = new URL(post.link).pathname.toLowerCase();
  if (/\/@(?:postype|postype_official|barabara[^/]*)(?:\/|$)/.test(pathname)) return true;
  const author = cleanAuthor(post.author).toLowerCase();
  if (["포스타입", "postype"].includes(author) || author.includes("바라바라")) return true;
  const metadata = [post.title, post.author, post.tags.join(" "), post.targetEvidence].join("\n");
  if (PROMOTION_MARKERS.test(metadata)) return true;
  // Re-check after opening the post. The pairing must be explicitly visible
  // either in its own metadata/body or in the source-card evidence.
  return !hasHyeopkwaeEvidence([metadata, post.bodyText].join("\n"));
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

    const structured = await extractStructuredMetadata(page);
    const title = structured.title || await firstText(page, [
      "h1",
      "meta[property='og:title']",
      "meta[name='twitter:title']",
      "[class*='title']",
    ], "content");
    const author = structured.author || await extractAuthor(page, title);
    const publishedDate = structured.publishedDate || await extractPublishedDate(page);
    const tags = await page.locator("a[href*='tag'], a[href*='keyword'], a[href*='search']").evaluateAll((nodes) =>
      nodes
        .map((node) => (node.textContent || "").trim())
        .filter((text) => text && text.length <= 30)
        .slice(0, 30)
    ).catch(() => []);

    return {
      postypePostId: link.postypePostId,
      sourceUrl: link.sourceUrl,
      link: link.url,
      title: cleanTitle(title) || `포스타입 글 ${link.postypePostId || ""}`.trim(),
      author: cleanAuthor(author),
      publishedDate: parsePostypeDate(publishedDate) || todayIsoDate(publishedDate),
      bodyText,
      preview: "",
      tags: [...new Set(tags)],
      targetEvidence: link.targetEvidence,
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

async function extractStructuredMetadata(page: Page) {
  const scripts = await page.locator("script[type='application/ld+json']").allTextContents().catch(() => []);
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const post = items.find((item) => item && ["BlogPosting", "Article"].includes(item["@type"]));
      if (!post) continue;
      return {
        title: String(post.headline || post.name || "").trim(),
        author: String(post.author?.name || "").trim(),
        publishedDate: String(post.datePublished || "").trim(),
      };
    } catch (_) {
      // Ignore unrelated or malformed structured-data blocks.
    }
  }
  return { title: "", author: "", publishedDate: "" };
}

async function extractBodyText(page: Page) {
  const paragraphText = await page.locator("article p, main p").evaluateAll((nodes) =>
    nodes.map((node) => (node.textContent || "").trim()).filter(Boolean).join("\n\n")
  ).catch(() => "");
  const compactedParagraphs = compactText(paragraphText, 40_000);
  if (compactedParagraphs.length > 300) return compactedParagraphs;

  for (const selector of ["article", "main", "[class*='content']", "[class*='post']", "body"]) {
    const text = await page.locator(selector).first().innerText({ timeout: 4000 }).catch(() => "");
    const compacted = compactText(text, 40_000);
    if (compacted.length > 300) return compacted;
  }
  return "";
}

async function extractAuthor(page: Page, title: string) {
  const bodyText = await page.locator("body").innerText({ timeout: 4000 }).catch(() => "");
  const lines = bodyText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const titleLine = cleanTitle(title);
  const titleIndex = lines.findIndex((line) => cleanTitle(line) === titleLine);
  const searchStart = titleIndex >= 0 ? titleIndex + 1 : 0;
  const candidates = lines.slice(searchStart, searchStart + 8);
  const dateIndex = candidates.findIndex((line) => /\d{4}\.\s*\d{1,2}\.\s*\d{1,2}/.test(line));
  const beforeDate = dateIndex >= 0 ? candidates.slice(0, dateIndex) : candidates;
  const author = beforeDate
    .filter((line) => line !== titleLine)
    .filter((line) => !/조회|댓글|좋아요|구독|공유|설정|^\W+$/.test(line))
    .filter((line) => line.length <= 30)
    .at(-1);

  if (author) return author;

  return firstText(page, [
    "meta[name='author']",
    "meta[property='article:author']",
    "meta[name='twitter:creator']",
  ], "content");
}

async function extractPublishedDate(page: Page) {
  const datetime = await firstText(page, ["time[datetime]", "time"], "datetime");
  if (datetime) return datetime;
  const text = await page.locator("body").innerText({ timeout: 4000 }).catch(() => "");
  const match = text.match(/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?/);
  return match ? match[0] : "";
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
    targetEvidence: link.targetEvidence,
    isAdult: false,
    isPaid: status === "purchase_required",
    crawlStatus: status,
    crawlError: message,
  };
}

function cleanTitle(value: string) {
  return value
    .replace(/\s*-\s*Postype.*$/i, "")
    .replace(/\s*[:•|]\s*[^:•|]+$/u, "")
    .trim();
}

function cleanAuthor(value: string) {
  return value.replace(/^@/, "").replace(/^작성자\s*/u, "").trim();
}

function parsePostypeDate(value: string) {
  const match = value.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

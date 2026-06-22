const allowedOrigins = new Set([
  "https://hq-postype-archive.vercel.app",
  "https://penta1031.github.io",
  ...(Deno.env.get("ADMIN_ALLOWED_ORIGINS") || Deno.env.get("ADMIN_ALLOWED_ORIGIN") || "")
    .split(",")
    .map((origin) => origin.trim().replace(/^["']+|["']+$/g, "").replace(/\/+$/, ""))
    .filter(Boolean),
]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};

const tableName = Deno.env.get("POSTYPE_TABLE") || "postype_archive";
const encoder = new TextEncoder();
const failedLogins = new Map<string, { count: number; resetAt: number }>();
const publicSubmissionWindows = new Map<string, { count: number; resetAt: number }>();
const loginWindowMs = 15 * 60 * 1000;
const maxLoginFailures = 5;
const adminSessionMs = 30 * 60 * 1000;
const authorSessionMs = 2 * 60 * 60 * 1000;
const editableFilterGroups = new Set(["장르", "키워드", "공", "수"]);

const K = {
  title: "\uC81C\uBAA9",
  author: "\uC791\uAC00",
  date: "\uB0A0\uC9DC",
  link: "\uB9C1\uD06C",
  paid: "\uC720\uB8CC",
  adult: "\uC131\uC778",
  preview: "\uBBF8\uB9AC\uBCF4\uAE30",
  category: "\uCE74\uD14C\uACE0\uB9AC",
  genres: "\uC7A5\uB974",
  keywords: "\uD0A4\uC6CC\uB4DC",
  top: "\uACF5",
  bottom: "\uC218",
  endings: "\uC5D4\uB529",
  aiGenres: "AI\uC81C\uC548\uC7A5\uB974",
  aiKeywords: "AI\uC81C\uC548\uD0A4\uC6CC\uB4DC",
  aiTop: "AI\uC81C\uC548\uACF5",
  aiBottom: "AI\uC81C\uC548\uC218",
  aiEndings: "AI\uC81C\uC548\uC5D4\uB529",
  summary: "\uC694\uC57D",
  bodyExtract: "\uBCF8\uBB38\uCD94\uCD9C",
  aiRaw: "AI\uC6D0\uBCF8\uC751\uB2F5",
  aiConfidence: "AI\uC2E0\uB8B0\uB3C4",
  aiProcessedAt: "AI\uCC98\uB9AC\uC77C\uC2DC",
  aiStatus: "AI\uC0C1\uD0DC",
  aiNote: "AI\uADFC\uAC70",
  cleanupNote: "\uC815\uB9AC\uBA54\uBAA8",
  isSeries: "\uC2DC\uB9AC\uC988",
  seriesName: "\uC2DC\uB9AC\uC988\uBA85",
  seriesVolume: "\uC2DC\uB9AC\uC988\uD68C\uCC28",
  serializationStatus: "\uC5F0\uC7AC\uC0C1\uD0DC",
  statusReason: "\uC0C1\uD0DC\uADFC\uAC70",
  seriesColumnsUnified: "\uC2DC\uB9AC\uC988\uC5F4\uD1B5\uC77C",
  seriesColumnsUnifiedNote: "\uC2DC\uB9AC\uC988\uC5F4\uD1B5\uC77C\uBA54\uBAA8",
  tagLimitApplied: "\uC7A5\uB974\uD0A4\uC6CC\uB4DC5\uAC1C\uC81C\uD55C",
  tagLimitNote: "\uC7A5\uB974\uD0A4\uC6CC\uB4DC5\uAC1C\uC81C\uD55C\uBA54\uBAA8",
  adminReviewed: "\uAD00\uB9AC\uC790\uAC80\uC218",
  sourceUrl: "\uC218\uC9D1\uCD9C\uCC98",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requestOriginAllowed(request: Request) {
  const origin = (request.headers.get("origin") || "").replace(/\/+$/, "");
  return !origin || allowedOrigins.has(origin);
}

function clientKey(request: Request) {
  return (request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "unknown")
    .split(",")[0]
    .trim();
}

function loginIsBlocked(key: string) {
  const attempt = failedLogins.get(key);
  if (!attempt) return false;
  if (Date.now() >= attempt.resetAt) {
    failedLogins.delete(key);
    return false;
  }
  return attempt.count >= maxLoginFailures;
}

function recordLoginFailure(key: string) {
  const current = failedLogins.get(key);
  if (!current || Date.now() >= current.resetAt) {
    failedLogins.set(key, { count: 1, resetAt: Date.now() + loginWindowMs });
    return;
  }
  current.count += 1;
}

function publicSubmissionRateLimited(key: string) {
  const now = Date.now();
  const current = publicSubmissionWindows.get(key);
  if (!current || now >= current.resetAt) {
    publicSubmissionWindows.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return false;
  }
  current.count += 1;
  return current.count > 50;
}

async function secureTextEqual(left: string, right: string) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sessionSignature(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

async function issueAdminSession(secret: string) {
  const payload = base64Url(encoder.encode(JSON.stringify({ exp: Date.now() + adminSessionMs, role: "admin" })));
  return `${payload}.${await sessionSignature(payload, secret)}`;
}

async function issueAuthorSession(secret: string, authorId: string) {
  const payload = base64Url(encoder.encode(JSON.stringify({
    exp: Date.now() + authorSessionMs,
    role: "author",
    authorId,
  })));
  return `${payload}.${await sessionSignature(payload, secret)}`;
}

async function parseSignedSession(token: string, secret: string) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = await sessionSignature(payload, secret);
  if (!(await secureTextEqual(signature, expected))) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const data = JSON.parse(decoded) as { exp?: number; role?: string; authorId?: string };
    return Number.isFinite(data.exp) && Number(data.exp) > Date.now() ? data : null;
  } catch {
    return null;
  }
}

async function validAdminSession(token: string, secret: string) {
  const data = await parseSignedSession(token, secret);
  return data?.role === "admin";
}

async function validAuthorSession(token: string, secret: string) {
  const data = await parseSignedSession(token, secret);
  return data?.role === "author" && cleanSubmissionId(data.authorId) ? data : null;
}

async function hashAuthorKey(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateAuthorKey() {
  const value = crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
  return `HQ-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function flag(value: unknown) {
  return ["Y", "YES", "TRUE", "1", "O"].includes(text(value).toUpperCase());
}

function cleanDate(value: unknown) {
  const date = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function withoutRps(value: unknown) {
  return text(value)
    .split(/[,，、/|·\n]/)
    .map((item) => item.trim())
    .filter((item) => item && item.toUpperCase() !== "RPS")
    .join(", ");
}

function sourceRowNumber(payload: Record<string, unknown>) {
  const rowNumber = text(payload._rowNumber);
  if (rowNumber && !rowNumber.startsWith("local-")) return rowNumber;
  return `manual-${Date.now()}`;
}

function cleanFilterOptions(group: string, value: unknown) {
  if (!editableFilterGroups.has(group) || !Array.isArray(value)) return null;
  let options = [...new Set(value.map((item) => text(item)).filter((item) => item && item.length <= 40))].slice(0, 120);
  if (group === "장르") options = options.filter((item) => item.toUpperCase() !== "RPS");
  return options;
}

function cleanTagText(value: unknown, limit = 12) {
  return [...new Set(text(value)
    .split(/[,，、/|·\n]/)
    .map((item) => item.trim())
    .filter((item) => item && item.length <= 40))]
    .slice(0, limit)
    .join(", ");
}

function cleanSubmissionId(value: unknown) {
  const id = text(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : "";
}

function postIdFromUrl(value: string) {
  const match = value.match(/\/post\/(\d+)/);
  return match ? Number(match[1]) : null;
}

function cleanArchiveId(value: unknown) {
  const id = Number(text(value));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function authorSubmissionRow(payload: Record<string, unknown>, authorId: string) {
  const postUrl = cleanPostypePostUrl(payload.post_url);
  const title = text(payload.title).slice(0, 200);
  if (!postUrl || !title) throw new Error("포스타입 글 링크와 작품 제목을 입력해 주세요.");
  const isSeries = flag(payload.is_series);
  return {
    author_id: authorId,
    status: "pending_review",
    post_url: postUrl,
    postype_post_id: postIdFromUrl(postUrl),
    title,
    published_date: cleanDate(payload.published_date),
    category: ["글", "그림", "기타"].includes(text(payload.category)) ? text(payload.category) : "글",
    is_paid: flag(payload.is_paid),
    is_adult: flag(payload.is_adult),
    genres: withoutRps(cleanTagText(payload.genres, 8)),
    keywords: cleanTagText(payload.keywords, 12),
    top_tags: cleanTagText(payload.top_tags, 8),
    bottom_tags: cleanTagText(payload.bottom_tags, 8),
    endings: cleanTagText(payload.endings, 4),
    is_series: isSeries,
    series_name: isSeries ? text(payload.series_name).slice(0, 160) : null,
    series_volume: isSeries ? text(payload.series_volume).slice(0, 40) : null,
    serialization_status: isSeries && ["연재중", "완결"].includes(text(payload.serialization_status))
      ? text(payload.serialization_status)
      : isSeries ? "연재중" : "단편",
    review_note: null,
    reviewed_at: null,
  };
}

function authorOwnsPostUrl(channelUrlValue: unknown, postUrlValue: unknown) {
  try {
    const channelUrl = new URL(text(channelUrlValue));
    const postUrl = new URL(text(postUrlValue));
    const channelPath = channelUrl.pathname.replace(/\/$/, "");
    const channelHost = channelUrl.hostname.replace(/^www\./i, "");
    const postHost = postUrl.hostname.replace(/^www\./i, "");
    return channelHost === postHost
      && /^\/@[^/]+$/i.test(channelPath)
      && postUrl.pathname.startsWith(`${channelPath}/post/`);
  } catch {
    return false;
  }
}

function sameAuthorName(left: unknown, right: unknown) {
  return text(left).toLocaleLowerCase("ko-KR") === text(right).toLocaleLowerCase("ko-KR");
}

function archiveOwnedByAuthor(row: Record<string, unknown>, author: Record<string, unknown>) {
  return sameAuthorName(row.author, author.display_name)
    || authorOwnsPostUrl(author.postype_channel_url, row.link);
}

async function resolvePostypePostUrl(value: unknown) {
  const direct = cleanPostypePostUrl(value);
  if (direct) return direct;
  try {
    const shortUrl = new URL(text(value));
    const shortHost = shortUrl.hostname.replace(/^www\./i, "").toLowerCase();
    if (shortHost !== "posty.pe") return "";
    const response = await fetch(shortUrl.toString(), {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 HQ-Postype-Archive" },
    });
    return cleanPostypePostUrl(response.url);
  } catch {
    return "";
  }
}

function authorArchiveRow(
  payload: Record<string, unknown>,
  author: Record<string, unknown>,
  postUrl: string,
  create: boolean,
) {
  const title = text(payload.title).slice(0, 200);
  if (!title) throw new Error("작품 제목을 입력해 주세요.");
  const isSeries = flag(payload.is_series);
  const postId = postIdFromUrl(postUrl);
  return {
    ...(create ? {
      source_row_number: `author-direct-${text(author.id)}-${postId || Date.now()}`,
      discovered_at: new Date().toISOString(),
      admin_reviewed_at: new Date().toISOString(),
      source_url: "author_direct",
    } : {}),
    postype_post_id: postId,
    title,
    author: text(author.display_name),
    published_date: cleanDate(payload.published_date),
    link: postUrl,
    is_paid: flag(payload.is_paid),
    is_adult: flag(payload.is_adult),
    category: ["글", "그림", "기타"].includes(text(payload.category)) ? text(payload.category) : "글",
    genres: withoutRps(cleanTagText(payload.genres, 12)),
    keywords: cleanTagText(payload.keywords, 20),
    top_tags: cleanTagText(payload.top_tags, 12),
    bottom_tags: cleanTagText(payload.bottom_tags, 12),
    endings: cleanTagText(payload.endings, 6),
    is_series: isSeries,
    series_name: isSeries ? text(payload.series_name).slice(0, 160) : null,
    series_volume: isSeries ? text(payload.series_volume).slice(0, 40) : null,
    serialization_status: isSeries && ["연재중", "완결"].includes(text(payload.serialization_status))
      ? text(payload.serialization_status)
      : isSeries ? "연재중" : "단편",
    admin_reviewed: true,
    deleted_at: null,
  };
}

async function findArchivePost(id: number) {
  const rows = await rest(`${encodeURIComponent(tableName)}?select=*&id=eq.${id}&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] as Record<string, unknown> : null;
}

function archivePostForAuthor(row: Record<string, unknown>) {
  return {
    archive_id: row.id,
    status: "published",
    post_url: text(row.link),
    postype_post_id: Number(row.postype_post_id) || null,
    title: text(row.title),
    published_date: cleanDate(row.published_date),
    category: text(row.category) || "글",
    is_paid: flag(row.is_paid),
    is_adult: flag(row.is_adult),
    genres: text(row.genres),
    keywords: text(row.keywords),
    top_tags: text(row.top_tags),
    bottom_tags: text(row.bottom_tags),
    endings: text(row.endings),
    is_series: flag(row.is_series),
    series_name: text(row.series_name),
    series_volume: text(row.series_volume),
    serialization_status: text(row.serialization_status),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function postToRow(payload: Record<string, unknown>, action: string) {
  const reviewSpecified = Object.prototype.hasOwnProperty.call(payload, K.adminReviewed);
  const reviewed = flag(payload[K.adminReviewed]);
  return {
    ...(action === "create" ? { source_row_number: sourceRowNumber(payload) } : {}),
    title: text(payload[K.title]),
    author: text(payload[K.author]),
    published_date: cleanDate(payload[K.date]),
    link: text(payload[K.link]) || null,
    is_paid: flag(payload[K.paid]),
    is_adult: flag(payload[K.adult]),
    category: text(payload[K.category]),
    genres: withoutRps(payload[K.genres]),
    keywords: text(payload[K.keywords]),
    top_tags: text(payload[K.top]),
    bottom_tags: text(payload[K.bottom]),
    endings: text(payload[K.endings]),
    is_series: flag(payload[K.isSeries]),
    series_name: text(payload[K.seriesName]),
    series_volume: text(payload[K.seriesVolume]),
    serialization_status: text(payload[K.serializationStatus]),
    ...(reviewSpecified ? {
      admin_reviewed: reviewed,
      admin_reviewed_at: reviewed ? new Date().toISOString() : null,
    } : {}),
    ...(action === "create" ? {
      admin_reviewed: true,
      admin_reviewed_at: new Date().toISOString(),
      source_url: "admin_manual",
    } : {}),
  };
}

function archiveFilter(payload: Record<string, unknown>) {
  const id = text(payload._supabaseId);
  if (id) return `${encodeURIComponent(tableName)}?id=eq.${encodeURIComponent(id)}`;
  const rowNumber = text(payload._rowNumber);
  if (!rowNumber) return "";
  return `${encodeURIComponent(tableName)}?source_row_number=eq.${encodeURIComponent(rowNumber)}`;
}

function cleanPostypePostUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const isPostype = url.hostname === "postype.com" || url.hostname.endsWith(".postype.com");
    if (!isPostype || !/\/post\/\d+/.test(url.pathname)) return "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function cleanPostypeChannelUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const isPostype = url.hostname === "postype.com" || url.hostname.endsWith(".postype.com");
    const pathname = url.pathname.replace(/\/$/, "");
    if (!isPostype || !/^\/@[^/]+$/i.test(pathname)) return "";
    return `${url.protocol}//${url.host}${pathname}`;
  } catch {
    return "";
  }
}

async function dispatchCrawlerWorkflow(postUrl = "") {
  const token = Deno.env.get("GITHUB_WORKFLOW_TOKEN") || Deno.env.get("GITHUB_ACTIONS_TOKEN");
  const repository = Deno.env.get("GITHUB_REPOSITORY");
  const workflowId = Deno.env.get("GITHUB_WORKFLOW_ID") || "postype-sync.yml";
  const ref = Deno.env.get("GITHUB_WORKFLOW_REF") || "main";

  if (!token || !repository) {
    throw new Error("GITHUB_WORKFLOW_TOKEN and GITHUB_REPOSITORY are required to run the crawler manually.");
  }

  const url = `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "hq-postype-archive-admin",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref,
      ...(postUrl ? { inputs: { post_url: postUrl } } : {}),
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(responseText || `GitHub workflow dispatch failed (${response.status}).`);
  }

  return {
    actionsUrl: `https://github.com/${repository}/actions/workflows/${workflowId}`,
  };
}

async function rest(path: string, init: RequestInit = {}) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("POSTYPE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });

  const responseText = await response.text();
  if (!response.ok) throw new Error(responseText || response.statusText);
  return responseText ? JSON.parse(responseText) : null;
}

async function findAuthorSubmission(id: string) {
  const rows = await rest(`postype_author_submissions?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] as Record<string, unknown> : null;
}

async function findAuthor(id: string) {
  const rows = await rest(`postype_authors?select=id,display_name,postype_channel_url,key_hash,key_value,enabled,last_login_at,created_at,updated_at&id=eq.${encodeURIComponent(id)}&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] as Record<string, unknown> : null;
}

function archiveRowFromSubmission(submission: Record<string, unknown>, authorName: string) {
  const id = text(submission.id);
  return {
    source_row_number: `author-submission-${id}`,
    postype_post_id: Number(submission.postype_post_id) || null,
    title: text(submission.title) || "제목 없음",
    author: authorName,
    published_date: cleanDate(submission.published_date),
    link: text(submission.post_url),
    is_paid: flag(submission.is_paid),
    is_adult: flag(submission.is_adult),
    category: text(submission.category) || "글",
    genres: withoutRps(submission.genres),
    keywords: cleanTagText(submission.keywords, 12),
    top_tags: cleanTagText(submission.top_tags, 8),
    bottom_tags: cleanTagText(submission.bottom_tags, 8),
    endings: cleanTagText(submission.endings, 4),
    is_series: flag(submission.is_series),
    series_name: text(submission.series_name) || null,
    series_volume: text(submission.series_volume) || null,
    serialization_status: text(submission.serialization_status) || (flag(submission.is_series) ? "연재중" : "단편"),
    status_reason: "작가 전용 키 로그인 후 본인 입력",
    discovered_at: new Date().toISOString(),
    crawled_at: new Date().toISOString(),
    crawl_status: "success",
    ai_status: "approved",
    ai_note: "작가 전용 키 신청 후 관리자 승인",
    admin_reviewed: true,
    admin_reviewed_at: new Date().toISOString(),
    source_url: "author_submission",
    deleted_at: null,
  };
}

async function approveAuthorSubmission(id: string) {
  const submission = await findAuthorSubmission(id);
  if (!submission || text(submission.status) !== "pending_review") {
    throw new Error("검수대기 신청만 승인할 수 있습니다.");
  }
  const author = await findAuthor(text(submission.author_id));
  if (!author || !flag(author.enabled)) throw new Error("활성 작가 계정을 찾지 못했습니다.");
  const row = archiveRowFromSubmission(submission, text(author.display_name));
  const existing = await rest(`${encodeURIComponent(tableName)}?select=id&link=eq.${encodeURIComponent(text(row.link))}&limit=1`);
  let archiveRows;
  if (Array.isArray(existing) && existing[0]) {
    archiveRows = await rest(`${encodeURIComponent(tableName)}?id=eq.${encodeURIComponent(text(existing[0].id))}`, {
      method: "PATCH",
      body: JSON.stringify(row),
    });
  } else {
    archiveRows = await rest(encodeURIComponent(tableName), {
      method: "POST",
      body: JSON.stringify(row),
    });
  }
  const archiveId = Array.isArray(archiveRows) && archiveRows[0] ? archiveRows[0].id : null;
  await rest(`postype_author_submissions?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      archived_post_id: archiveId,
      review_note: "관리자 승인 완료",
    }),
  });
  if (flag(submission.is_series) && text(submission.series_name)) {
    await syncSeriesFilters(row);
  }
  return { archiveId };
}

async function syncSeriesFilters(row: Record<string, unknown>, matchSeriesName = "") {
  const seriesName = text(row.series_name);
  const sourceSeriesName = text(matchSeriesName) || seriesName;
  if (!flag(row.is_series) || !seriesName || !sourceSeriesName) return;
  await rest(`${encodeURIComponent(tableName)}?series_name=eq.${encodeURIComponent(sourceSeriesName)}&deleted_at=is.null`, {
    method: "PATCH",
    body: JSON.stringify({
      author: text(row.author),
      is_paid: flag(row.is_paid),
      is_adult: flag(row.is_adult),
      category: text(row.category),
      genres: text(row.genres),
      keywords: text(row.keywords),
      top_tags: text(row.top_tags),
      bottom_tags: text(row.bottom_tags),
      endings: text(row.endings),
      serialization_status: text(row.serialization_status),
      series_name: seriesName,
      series_columns_unified: true,
      series_columns_unified_note: "수정값 기준으로 시리즈 공통 정보 자동 통일",
    }),
  });
}

function mergeSeriesField(rows: Array<Record<string, unknown>>, field: string, limit: number) {
  const values = rows.flatMap((row) => text(row[field]).split(/[,，、\n]/));
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit).join(", ");
}

async function unifyAllSeriesFilters() {
  const rows = await rest(`${encodeURIComponent(tableName)}?select=id,series_name,genres,keywords,top_tags,bottom_tags,admin_reviewed,updated_at&is_series=eq.true&series_name=not.is.null&deleted_at=is.null&order=updated_at.desc`);
  const groups = new Map<string, Array<Record<string, unknown>>>();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const name = text(row.series_name);
    if (!name) return;
    const group = groups.get(name) || [];
    group.push(row);
    groups.set(name, group);
  });

  let updatedRows = 0;
  const entries = [...groups.entries()];
  for (let index = 0; index < entries.length; index += 5) {
    const counts = await Promise.all(entries.slice(index, index + 5).map(async ([seriesName, seriesRows]) => {
      const reviewed = seriesRows.find((row) => flag(row.admin_reviewed));
      const canonical = reviewed ? {
        genres: text(reviewed.genres),
        keywords: text(reviewed.keywords),
        top_tags: text(reviewed.top_tags),
        bottom_tags: text(reviewed.bottom_tags),
      } : {
        genres: mergeSeriesField(seriesRows, "genres", 8),
        keywords: mergeSeriesField(seriesRows, "keywords", 12),
        top_tags: mergeSeriesField(seriesRows, "top_tags", 8),
        bottom_tags: mergeSeriesField(seriesRows, "bottom_tags", 8),
      };
      await rest(`${encodeURIComponent(tableName)}?series_name=eq.${encodeURIComponent(seriesName)}&deleted_at=is.null`, {
        method: "PATCH",
        body: JSON.stringify({
          ...canonical,
          series_columns_unified: true,
          series_columns_unified_note: reviewed
            ? "관리자 검수 회차 기준으로 시리즈 필터 전체 통일"
            : "동일 시리즈 회차의 필터를 자동 통합해 전체 통일",
        }),
      });
      return seriesRows.length;
    }));
    updatedRows += counts.reduce((sum, count) => sum + count, 0);
  }
  return { seriesCount: groups.size, updatedRows };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!requestOriginAllowed(request)) return json({ ok: false, error: "Origin is not allowed." }, 403);
  if (request.method !== "POST") return json({ ok: false, error: "POST only." }, 405);

  try {
    const adminPassword = Deno.env.get("ADMIN_PASSWORD");
    if (!adminPassword) return json({ ok: false, error: "ADMIN_PASSWORD is not configured." }, 500);
    const sessionSecret = Deno.env.get("ADMIN_SESSION_SECRET") || adminPassword;

    const body = await request.json();
    const action = text(body.action);
    const password = text(body.password);
    const token = text(body.token);
    const payload = (body.payload || {}) as Record<string, unknown>;

    if (action === "author_login") {
      const key = `author:${clientKey(request)}`;
      if (loginIsBlocked(key)) return json({ ok: false, error: "로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요." }, 429);
      const displayName = text(payload.display_name).slice(0, 80);
      const authorKey = text(payload.author_key);
      const rows = displayName
        ? await rest(`postype_authors?select=id,display_name,postype_channel_url,key_hash,enabled&display_name=eq.${encodeURIComponent(displayName)}&limit=1`)
        : [];
      const author = Array.isArray(rows) && rows[0] ? rows[0] as Record<string, unknown> : null;
      const keyMatches = author && authorKey
        ? await secureTextEqual(await hashAuthorKey(authorKey), text(author.key_hash))
        : false;
      if (!author || !flag(author.enabled) || !keyMatches) {
        recordLoginFailure(key);
        return json({ ok: false, error: "작가명 또는 작가 키가 올바르지 않습니다." }, 401);
      }
      failedLogins.delete(key);
      await rest(`postype_authors?id=eq.${encodeURIComponent(text(author.id))}`, {
        method: "PATCH",
        body: JSON.stringify({ last_login_at: new Date().toISOString() }),
      });
      return json({
        ok: true,
        token: await issueAuthorSession(sessionSecret, text(author.id)),
        expiresIn: authorSessionMs / 1000,
        author: {
          id: text(author.id),
          displayName: text(author.display_name),
          channelUrl: text(author.postype_channel_url),
        },
      });
    }

    const authorActions = ["author_list_own", "author_submit", "author_update_archive", "author_delete_archive"];
    if (authorActions.includes(action)) {
      const authorSession = await validAuthorSession(token, sessionSecret);
      if (!authorSession?.authorId) return json({ ok: false, error: "작가 로그인이 만료됐습니다. 다시 로그인해 주세요." }, 401);
      const author = await findAuthor(authorSession.authorId);
      if (!author || !flag(author.enabled)) return json({ ok: false, error: "사용할 수 없는 작가 계정입니다." }, 403);

      if (action === "author_list_own") {
        const rows = await rest(`${encodeURIComponent(tableName)}?select=id,postype_post_id,title,author,published_date,link,is_paid,is_adult,category,genres,keywords,top_tags,bottom_tags,endings,is_series,series_name,series_volume,serialization_status,created_at,updated_at&deleted_at=is.null&order=published_date.desc.nullslast,title.asc&limit=2000`);
        const ownRows = (Array.isArray(rows) ? rows : [])
          .filter((row) => archiveOwnedByAuthor(row as Record<string, unknown>, author))
          .map((row) => archivePostForAuthor(row as Record<string, unknown>));
        return json({ ok: true, rows: ownRows, author: { displayName: text(author.display_name), channelUrl: text(author.postype_channel_url) } });
      }

      if (action === "author_submit") {
        if (text(payload.website)) return json({ ok: true, ignored: true });
        if (publicSubmissionRateLimited(clientKey(request))) {
          return json({ ok: false, error: "등록 횟수가 너무 많습니다. 한 시간 뒤 다시 시도해 주세요." }, 429);
        }
        const postUrl = await resolvePostypePostUrl(payload.post_url);
        if (!postUrl) return json({ ok: false, error: "포스타입 글 링크를 확인해 주세요." }, 400);
        if (!authorOwnsPostUrl(author.postype_channel_url, postUrl)) {
          return json({ ok: false, error: "등록된 본인 포스타입 채널의 글만 등록할 수 있습니다." }, 403);
        }
        const existingRows = await rest(`${encodeURIComponent(tableName)}?select=id,author,link&link=eq.${encodeURIComponent(postUrl)}&limit=1`);
        const existing = Array.isArray(existingRows) && existingRows[0] ? existingRows[0] as Record<string, unknown> : null;
        if (existing && !archiveOwnedByAuthor(existing, author)) {
          return json({ ok: false, error: "다른 작가명으로 등록된 글입니다. 관리자에게 문의해 주세요." }, 409);
        }
        const row = authorArchiveRow(payload, author, postUrl, !existing);
        const rows = existing
          ? await rest(`${encodeURIComponent(tableName)}?id=eq.${cleanArchiveId(existing.id)}`, { method: "PATCH", body: JSON.stringify(row) })
          : await rest(encodeURIComponent(tableName), { method: "POST", body: JSON.stringify(row) });
        await syncSeriesFilters(row);
        return json({ ok: true, rows, postUrl });
      }

      const archiveId = cleanArchiveId(payload.archive_id);
      const archivePost = archiveId ? await findArchivePost(archiveId) : null;
      if (!archivePost || !archiveOwnedByAuthor(archivePost, author)) {
        return json({ ok: false, error: "본인 작가명으로 등록된 글만 관리할 수 있습니다." }, 403);
      }

      if (action === "author_update_archive") {
        const postUrl = await resolvePostypePostUrl(payload.post_url);
        if (!postUrl) return json({ ok: false, error: "포스타입 글 링크를 확인해 주세요." }, 400);
        if (!authorOwnsPostUrl(author.postype_channel_url, postUrl)) {
          return json({ ok: false, error: "등록된 본인 포스타입 채널의 글만 수정할 수 있습니다." }, 403);
        }
        const row = authorArchiveRow(payload, author, postUrl, false);
        const rows = await rest(`${encodeURIComponent(tableName)}?id=eq.${archiveId}`, { method: "PATCH", body: JSON.stringify(row) });
        await syncSeriesFilters(row);
        return json({ ok: true, rows, postUrl });
      }

      await rest(`${encodeURIComponent(tableName)}?id=eq.${archiveId}`, {
        method: "PATCH",
        body: JSON.stringify({ deleted_at: new Date().toISOString() }),
      });
      return json({ ok: true });
    }

    if (action === "auth") {
      const key = clientKey(request);
      if (loginIsBlocked(key)) {
        return json({ ok: false, error: "Too many login attempts. Try again in 15 minutes." }, 429);
      }
      if (!password || !(await secureTextEqual(password, adminPassword))) {
        recordLoginFailure(key);
        return json({ ok: false, error: "Wrong password." }, 401);
      }
      failedLogins.delete(key);
      return json({ ok: true, token: await issueAdminSession(sessionSecret), expiresIn: adminSessionMs / 1000 });
    }

    if (!(await validAdminSession(token, sessionSecret))) {
      return json({ ok: false, error: "Admin session is missing or expired." }, 401);
    }

    if (![
      "list", "create", "update", "delete", "approve", "save_filter_options",
      "list_authors", "create_author", "reset_author_key", "toggle_author",
      "list_author_submissions", "approve_author_submission", "reject_author_submission",
      "unify_all_series", "run_crawler", "crawl_status",
    ].includes(action)) {
      return json({ ok: false, error: "Unknown action." }, 400);
    }

    if (action === "list_authors") {
      const rows = await rest("postype_authors?select=id,display_name,postype_channel_url,key_value,enabled,last_login_at,created_at,updated_at&order=display_name.asc");
      return json({ ok: true, rows });
    }

    if (action === "create_author") {
      const displayName = text(payload.display_name).slice(0, 80);
      const channelUrl = cleanPostypeChannelUrl(payload.postype_channel_url);
      if (!displayName || !channelUrl) return json({ ok: false, error: "작가명과 포스타입 채널 주소를 확인해 주세요." }, 400);
      const authorKey = generateAuthorKey();
      const rows = await rest("postype_authors", {
        method: "POST",
        body: JSON.stringify({
          display_name: displayName,
          postype_channel_url: channelUrl,
          key_hash: await hashAuthorKey(authorKey),
          key_value: authorKey,
          enabled: true,
        }),
      });
      return json({ ok: true, rows, authorKey });
    }

    if (action === "reset_author_key") {
      const id = cleanSubmissionId(payload.author_id);
      if (!id || !(await findAuthor(id))) return json({ ok: false, error: "작가 계정을 찾지 못했습니다." }, 404);
      const authorKey = generateAuthorKey();
      await rest(`postype_authors?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ key_hash: await hashAuthorKey(authorKey), key_value: authorKey }),
      });
      return json({ ok: true, authorKey });
    }

    if (action === "toggle_author") {
      const id = cleanSubmissionId(payload.author_id);
      const author = id ? await findAuthor(id) : null;
      if (!author) return json({ ok: false, error: "작가 계정을 찾지 못했습니다." }, 404);
      await rest(`postype_authors?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !flag(author.enabled) }),
      });
      return json({ ok: true, enabled: !flag(author.enabled) });
    }

    if (action === "list_author_submissions") {
      const rows = await rest("postype_author_submissions?select=id,author_id,status,post_url,postype_post_id,title,published_date,category,is_paid,is_adult,genres,keywords,top_tags,bottom_tags,endings,is_series,series_name,series_volume,serialization_status,review_note,reviewed_at,archived_post_id,created_at,updated_at,postype_authors(display_name,postype_channel_url)&order=created_at.desc&limit=100");
      return json({ ok: true, rows });
    }

    if (action === "approve_author_submission") {
      const id = cleanSubmissionId(payload.submission_id);
      if (!id) return json({ ok: false, error: "신청 ID가 올바르지 않습니다." }, 400);
      return json({ ok: true, ...(await approveAuthorSubmission(id)) });
    }

    if (action === "reject_author_submission") {
      const id = cleanSubmissionId(payload.submission_id);
      if (!id) return json({ ok: false, error: "신청 ID가 올바르지 않습니다." }, 400);
      const submission = await findAuthorSubmission(id);
      if (!submission) return json({ ok: false, error: "신청을 찾지 못했습니다." }, 404);
      await rest(`postype_author_submissions?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "rejected",
          reviewed_at: new Date().toISOString(),
          review_note: text(payload.review_note).slice(0, 500) || "관리자 반려",
        }),
      });
      return json({ ok: true });
    }

    if (action === "list") {
      const rows = await rest(`${encodeURIComponent(tableName)}?select=*&deleted_at=is.null&order=published_date.desc.nullslast,title.asc`);
      return json({ ok: true, rows });
    }

    if (action === "crawl_status") {
      const rows = await rest("crawl_runs?select=id,started_at,finished_at,status,found_count,inserted_count,ai_review_count,failed_count,error_message&order=started_at.desc&limit=1");
      return json({ ok: true, run: Array.isArray(rows) && rows[0] ? rows[0] : null });
    }

    if (action === "save_filter_options") {
      const group = text(payload.group);
      const options = cleanFilterOptions(group, payload.options);
      if (!options) return json({ ok: false, error: "Invalid filter group or options." }, 400);
      const rows = await rest("postype_filter_config?on_conflict=group_name", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ group_name: group, options }),
      });
      return json({ ok: true, rows });
    }

    if (action === "unify_all_series") {
      const result = await unifyAllSeriesFilters();
      return json({ ok: true, ...result });
    }

    if (action === "run_crawler") {
      const requestedPostUrl = text(payload.post_url);
      const postUrl = cleanPostypePostUrl(requestedPostUrl);
      if (requestedPostUrl && !postUrl) {
        return json({ ok: false, error: "올바른 포스타입 글 링크를 입력해 주세요." }, 400);
      }
      const result = await dispatchCrawlerWorkflow(postUrl);
      return json({ ok: true, ...result });
    }

    if (action === "create") {
      const row = postToRow(payload, action);
      const rows = await rest(encodeURIComponent(tableName), {
        method: "POST",
        body: JSON.stringify(row),
      });
      await syncSeriesFilters(row);
      return json({ ok: true, rows });
    }

    const filter = archiveFilter(payload);
    if (!filter) return json({ ok: false, error: "Missing row id." }, 400);

    if (action === "update") {
      const row = postToRow(payload, action);
      const rows = await rest(filter, {
        method: "PATCH",
        body: JSON.stringify(row),
      });
      await syncSeriesFilters(row, text(payload._originalSeriesName));
      return json({ ok: true, rows });
    }

    if (action === "approve") {
      const rows = await rest(filter, {
        method: "PATCH",
        body: JSON.stringify({
          admin_reviewed: true,
          admin_reviewed_at: new Date().toISOString(),
          ai_status: "approved",
        }),
      });
      return json({ ok: true, rows });
    }

    const rows = await rest(filter, {
      method: "PATCH",
      body: JSON.stringify({ deleted_at: new Date().toISOString() }),
    });
    return json({ ok: true, rows });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

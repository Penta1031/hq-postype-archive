const allowedOrigin = (Deno.env.get("ADMIN_ALLOWED_ORIGIN") || "https://hq-postype-archive.vercel.app").replace(/\/+$/, "");
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};

const tableName = Deno.env.get("POSTYPE_TABLE") || "postype_archive";
const encoder = new TextEncoder();
const failedLogins = new Map<string, { count: number; resetAt: number }>();
const loginWindowMs = 15 * 60 * 1000;
const maxLoginFailures = 5;
const adminSessionMs = 30 * 60 * 1000;

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
  return !origin || origin === allowedOrigin;
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
  const payload = base64Url(encoder.encode(JSON.stringify({ exp: Date.now() + adminSessionMs })));
  return `${payload}.${await sessionSignature(payload, secret)}`;
}

async function validAdminSession(token: string, secret: string) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  const expected = await sessionSignature(payload, secret);
  if (!(await secureTextEqual(signature, expected))) return false;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const data = JSON.parse(decoded) as { exp?: number };
    return Number.isFinite(data.exp) && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function flag(value: unknown) {
  return ["Y", "YES", "TRUE", "1", "O"].includes(text(value).toUpperCase());
}

function cleanDate(value: unknown) {
  const valueText = text(value);
  return valueText ? valueText.slice(0, 10) : null;
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

function postToRow(payload: Record<string, unknown>, action: string) {
  const reviewed = flag(payload[K.adminReviewed]);
  return {
    ...(action === "create" ? { source_row_number: sourceRowNumber(payload) } : {}),
    title: text(payload[K.title]),
    author: text(payload[K.author]),
    published_date: cleanDate(payload[K.date]),
    link: text(payload[K.link]) || null,
    is_paid: flag(payload[K.paid]),
    is_adult: flag(payload[K.adult]),
    preview: text(payload[K.preview]),
    category: text(payload[K.category]),
    genres: withoutRps(payload[K.genres]),
    keywords: text(payload[K.keywords]),
    top_tags: text(payload[K.top]),
    bottom_tags: text(payload[K.bottom]),
    endings: text(payload[K.endings]),
    ai_suggested_genres: text(payload[K.aiGenres]),
    ai_suggested_keywords: text(payload[K.aiKeywords]),
    ai_suggested_top: text(payload[K.aiTop]),
    ai_suggested_bottom: text(payload[K.aiBottom]),
    ai_suggested_endings: text(payload[K.aiEndings]),
    summary: text(payload[K.summary]),
    body_extract: text(payload[K.bodyExtract]),
    ai_raw_response: text(payload[K.aiRaw]),
    ai_confidence: text(payload[K.aiConfidence]) || null,
    ai_processed_at: text(payload[K.aiProcessedAt]),
    ai_status: text(payload[K.aiStatus]) || (reviewed ? "approved" : "pending"),
    ai_note: text(payload[K.aiNote]),
    admin_reviewed: reviewed,
    admin_reviewed_at: reviewed ? new Date().toISOString() : null,
    cleanup_note: text(payload[K.cleanupNote]),
    is_series: flag(payload[K.isSeries]),
    series_name: text(payload[K.seriesName]),
    series_volume: text(payload[K.seriesVolume]),
    serialization_status: text(payload[K.serializationStatus]),
    status_reason: text(payload[K.statusReason]),
    series_columns_unified: flag(payload[K.seriesColumnsUnified]),
    series_columns_unified_note: text(payload[K.seriesColumnsUnifiedNote]),
    tag_limit_applied: flag(payload[K.tagLimitApplied]),
    tag_limit_note: text(payload[K.tagLimitNote]),
    source_url: text(payload[K.sourceUrl]) || null,
  };
}

function archiveFilter(payload: Record<string, unknown>) {
  const id = text(payload._supabaseId);
  if (id) return `${encodeURIComponent(tableName)}?id=eq.${encodeURIComponent(id)}`;
  const rowNumber = text(payload._rowNumber);
  if (!rowNumber) return "";
  return `${encodeURIComponent(tableName)}?source_row_number=eq.${encodeURIComponent(rowNumber)}`;
}

async function dispatchCrawlerWorkflow() {
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
    body: JSON.stringify({ ref }),
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

Deno.serve(async (request) => {
  if (!requestOriginAllowed(request)) return json({ ok: false, error: "Origin is not allowed." }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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

    if (!["list", "create", "update", "delete", "approve", "run_crawler"].includes(action)) {
      return json({ ok: false, error: "Unknown action." }, 400);
    }

    if (action === "list") {
      const rows = await rest(`${encodeURIComponent(tableName)}?select=*&deleted_at=is.null&order=published_date.desc.nullslast,title.asc`);
      return json({ ok: true, rows });
    }

    if (action === "run_crawler") {
      const result = await dispatchCrawlerWorkflow();
      return json({ ok: true, ...result });
    }

    if (action === "create") {
      const rows = await rest(encodeURIComponent(tableName), {
        method: "POST",
        body: JSON.stringify(postToRow(payload, action)),
      });
      return json({ ok: true, rows });
    }

    const filter = archiveFilter(payload);
    if (!filter) return json({ ok: false, error: "Missing row id." }, 400);

    if (action === "update") {
      const rows = await rest(filter, {
        method: "PATCH",
        body: JSON.stringify(postToRow(payload, action)),
      });
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

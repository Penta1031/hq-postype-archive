import { createClient } from "@supabase/supabase-js";
import { optionalEnv, requiredEnv } from "./utils.js";
import type { ExtractedPost, Source } from "./types.js";

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
export const tableName = optionalEnv("SUPABASE_TABLE", "postype_archive");

export const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

export async function getEnabledSources() {
  const { data, error } = await supabase
    .from("postype_sources")
    .select("id, source_type, source_url, enabled")
    .eq("enabled", true)
    .order("id", { ascending: true });

  if (error) throw error;
  const sources = (data || []) as Source[];
  const fallback = process.env.POSTYPE_SOURCE_URLS?.split(/\s*,\s*/).filter(Boolean) || [];
  return sources.length ? sources : fallback.map((source_url, index) => ({
    id: index + 1,
    source_type: "env",
    source_url,
    enabled: true,
  }));
}

export async function getFilterConfig() {
  const { data, error } = await supabase
    .from("postype_filter_config")
    .select("group_name, options")
    .order("group_name", { ascending: true });
  if (error) {
    console.warn(`Filter config unavailable; using built-in options: ${error.message}`);
    return [];
  }
  return (data || []) as Array<{ group_name: string; options: unknown }>;
}

export async function markSourceChecked(sourceUrl: string) {
  await supabase
    .from("postype_sources")
    .update({ last_checked_at: new Date().toISOString() })
    .eq("source_url", sourceUrl);
}

export async function createRun() {
  const { data, error } = await supabase
    .from("crawl_runs")
    .insert({ status: "running", started_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

export async function finishRun(runId: number, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from("crawl_runs")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) throw error;
}

export async function postAlreadyExists(link: string, postypePostId: number | null) {
  return Boolean(await getExistingArchive(link, postypePostId));
}

export async function getExistingArchive(link: string, postypePostId: number | null) {
  if (postypePostId) {
    const { data, error } = await supabase
      .from(tableName)
      .select("id, title, author, link, ai_status, crawl_status, admin_reviewed")
      .eq("postype_post_id", postypePostId)
      .limit(1);
    if (error) throw error;
    if (data?.length) return data[0];
  }

  const { data, error } = await supabase
    .from(tableName)
    .select("id, title, author, link, ai_status, crawl_status, admin_reviewed")
    .eq("link", link)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

export async function insertArchiveRow(post: ExtractedPost, extra: Record<string, unknown>) {
  const row = {
    source_row_number: post.postypePostId ? `postype-${post.postypePostId}` : `postype-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    postype_post_id: post.postypePostId,
    title: post.title || `포스타입 글 ${post.postypePostId || post.link}`,
    author: post.author || "",
    published_date: post.publishedDate,
    link: post.link,
    source_url: post.sourceUrl,
    category: "글",
    is_paid: post.isPaid,
    is_adult: post.isAdult,
    preview: post.preview,
    crawl_status: post.crawlStatus,
    crawl_error: post.crawlError,
    crawled_at: new Date().toISOString(),
    discovered_at: new Date().toISOString(),
    admin_reviewed: false,
    ...extra,
  };

  const { data, error } = await supabase
    .from(tableName)
    .insert(row)
    .select("id, title, author, link, ai_status")
    .single();

  if (error) throw error;
  return data;
}

export async function updateArchiveRow(id: number, patch: Record<string, unknown>) {
  const { data, error } = await supabase
    .from(tableName)
    .update(patch)
    .eq("id", id)
    .select("id, title, author, link, ai_status")
    .single();

  if (error) throw error;
  return data;
}

type SeriesFilters = {
  genres: string;
  keywords: string;
  top_tags: string;
  bottom_tags: string;
};

type SeriesFilterRow = SeriesFilters & {
  id: number;
  admin_reviewed: boolean;
  updated_at: string;
};

export async function unifySeriesFilters(seriesName: string) {
  const normalizedName = seriesName.trim();
  if (!normalizedName) return null;
  const { data, error } = await supabase
    .from(tableName)
    .select("id, genres, keywords, top_tags, bottom_tags, admin_reviewed, updated_at")
    .eq("series_name", normalizedName)
    .is("deleted_at", null)
    .order("admin_reviewed", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const rows = (data || []) as SeriesFilterRow[];
  if (!rows.length) return null;

  const reviewed = rows.find((row) => row.admin_reviewed);
  const canonical: SeriesFilters = reviewed
    ? {
      genres: String(reviewed.genres || ""),
      keywords: String(reviewed.keywords || ""),
      top_tags: String(reviewed.top_tags || ""),
      bottom_tags: String(reviewed.bottom_tags || ""),
    }
    : {
      genres: mergeSeriesTags(rows, "genres", 8),
      keywords: mergeSeriesTags(rows, "keywords", 12),
      top_tags: mergeSeriesTags(rows, "top_tags", 8),
      bottom_tags: mergeSeriesTags(rows, "bottom_tags", 8),
    };

  const { error: updateError } = await supabase
    .from(tableName)
    .update({
      ...canonical,
      series_columns_unified: true,
      series_columns_unified_note: reviewed
        ? "관리자 검수 회차 기준으로 시리즈 필터 자동 통일"
        : "동일 시리즈 회차의 필터를 자동 통합해 통일",
    })
    .eq("series_name", normalizedName)
    .is("deleted_at", null);
  if (updateError) throw updateError;
  return canonical;
}

function mergeSeriesTags(rows: SeriesFilterRow[], field: keyof SeriesFilters, limit: number) {
  const values = rows.flatMap((row) => String(row[field] || "").split(/[,，、\n]/));
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit).join(", ");
}

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
      .is("deleted_at", null)
      .limit(1);
    if (error) throw error;
    if (data?.length) return data[0];
  }

  const { data, error } = await supabase
    .from(tableName)
    .select("id, title, author, link, ai_status, crawl_status, admin_reviewed")
    .eq("link", link)
    .is("deleted_at", null)
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

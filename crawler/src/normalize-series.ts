import { createClient } from "@supabase/supabase-js";
import { createPostypeContext, extractPost } from "./postype.js";
import { optionalEnv, postypePostIdFromUrl } from "./utils.js";

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const tableName = optionalEnv("SUPABASE_TABLE", "postype_archive");
const referenceUrl = requiredEnv("SERIES_REFERENCE_URL");
const titlePrefix = requiredEnv("SERIES_TITLE_PREFIX");
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: references, error: referenceError } = await supabase
    .from(tableName)
    .select("id,author,genres,keywords,series_name")
    .eq("link", referenceUrl)
    .is("deleted_at", null)
    .limit(1);
  if (referenceError) throw referenceError;
  const reference = references?.[0];
  if (!reference) throw new Error(`Reference post not found: ${referenceUrl}`);
  if (!String(reference.series_name || "").trim()) throw new Error("Reference post has no series_name.");

  const { data: rows, error: rowsError } = await supabase
    .from(tableName)
    .select("id,title,link,source_url,postype_post_id,author")
    .eq("author", reference.author)
    .ilike("title", `${titlePrefix}%`)
    .is("deleted_at", null)
    .order("id", { ascending: true });
  if (rowsError) throw rowsError;
  if (!rows?.length) throw new Error(`No active posts found for prefix: ${titlePrefix}`);

  const { browser, context } = await createPostypeContext();
  const updated: Array<{ id: number; title: string; isAdult: boolean }> = [];
  try {
    for (const row of rows) {
      const post = await extractPost(context, {
        url: row.link,
        postypePostId: row.postype_post_id || postypePostIdFromUrl(row.link),
        sourceUrl: row.source_url || "series-normalization",
        targetEvidence: "혀쾌",
      });
      if (post.crawlStatus !== "success") {
        throw new Error(`${row.title}: ${post.crawlError || post.crawlStatus}`);
      }

      const { error } = await supabase
        .from(tableName)
        .update({
          is_series: true,
          series_name: String(reference.series_name).trim(),
          genres: reference.genres || "",
          keywords: reference.keywords || "",
          serialization_status: "완결",
          is_adult: post.isAdult,
          crawled_at: new Date().toISOString(),
          crawl_status: "success",
          crawl_error: null,
        })
        .eq("id", row.id);
      if (error) throw error;
      updated.push({ id: row.id, title: row.title, isAdult: post.isAdult });
      console.log(`SERIES_NORMALIZE ${updated.length}/${rows.length} ${row.title} adult=${post.isAdult}`);
    }
  } finally {
    await browser.close();
  }

  console.log(`SERIES_NORMALIZE_DONE ${JSON.stringify(updated)}`);
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

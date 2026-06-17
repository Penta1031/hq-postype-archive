import OpenAI from "openai";
import { compactText, joinList, optionalEnv } from "./utils.js";
import type { Classification, ExtractedPost } from "./types.js";

const model = optionalEnv("OPENAI_MODEL", "gpt-4.1-mini");
const reviewThreshold = Number(optionalEnv("AI_REVIEW_CONFIDENCE_THRESHOLD", "0.72"));

export function reviewRequired(confidence: number) {
  return !Number.isFinite(confidence) || confidence < reviewThreshold;
}

export async function classifyPost(post: ExtractedPost): Promise<Classification> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const inputText = compactText([
    `제목: ${post.title}`,
    `작가: ${post.author}`,
    `태그: ${post.tags.join(", ")}`,
    `성인표시: ${post.isAdult ? "Y" : "N"}`,
    `유료표시: ${post.isPaid ? "Y" : "N"}`,
    "",
    post.bodyText,
  ].join("\n"), 24_000);

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [
          "너는 포스타입 아카이브 신규 글을 한국어로 분류하는 관리자 보조자다.",
          "본문 원문을 저장하지 않을 것이므로 결과에는 분류값, 0~1 confidence, 짧은 근거 note만 둔다.",
          "note에는 긴 직접 인용을 넣지 말고 판단 근거를 요약해서 적는다.",
          "확실하지 않은 값은 빈 배열 또는 빈 문자열로 두고 confidence를 낮춘다.",
        ].join("\n"),
      },
      { role: "user", content: inputText },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "postype_classification",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            genres: { type: "array", items: { type: "string" } },
            keywords: { type: "array", items: { type: "string" } },
            top: { type: "array", items: { type: "string" } },
            bottom: { type: "array", items: { type: "string" } },
            isSeries: { type: "boolean" },
            seriesName: { type: "string" },
            seriesVolume: { type: "string" },
            serializationStatus: { type: "string", enum: ["단편", "연재중", "완결"] },
            isAdult: { type: "boolean" },
            isPaid: { type: "boolean" },
            endings: { type: "array", items: { type: "string" } },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            note: { type: "string" },
          },
          required: [
            "genres",
            "keywords",
            "top",
            "bottom",
            "isSeries",
            "seriesName",
            "seriesVolume",
            "serializationStatus",
            "isAdult",
            "isPaid",
            "endings",
            "confidence",
            "note",
          ],
        },
      },
    },
  });

  const parsed = JSON.parse(response.output_text) as Classification;
  return {
    ...parsed,
    genres: parsed.genres.slice(0, 8),
    keywords: parsed.keywords.slice(0, 12),
    top: parsed.top.slice(0, 8),
    bottom: parsed.bottom.slice(0, 8),
    endings: parsed.endings.slice(0, 5),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    note: compactText(parsed.note, 500),
  };
}

export function classificationRow(classification: Classification) {
  const needsReview = reviewRequired(classification.confidence);
  return {
    genres: joinList(classification.genres),
    keywords: joinList(classification.keywords),
    top_tags: joinList(classification.top),
    bottom_tags: joinList(classification.bottom),
    endings: joinList(classification.endings),
    ai_suggested_genres: joinList(classification.genres),
    ai_suggested_keywords: joinList(classification.keywords),
    ai_suggested_top: joinList(classification.top),
    ai_suggested_bottom: joinList(classification.bottom),
    ai_suggested_endings: joinList(classification.endings),
    is_series: classification.isSeries,
    series_name: classification.seriesName,
    series_volume: classification.seriesVolume,
    serialization_status: classification.serializationStatus,
    is_adult: classification.isAdult,
    is_paid: classification.isPaid,
    ai_confidence: classification.confidence,
    ai_note: classification.note,
    ai_status: needsReview ? "review_required" : "classified",
    ai_classified_at: new Date().toISOString(),
  };
}

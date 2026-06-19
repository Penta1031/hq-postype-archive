import OpenAI from "openai";
import { compactText, joinList, optionalEnv } from "./utils.js";
import type { Classification, ExtractedPost } from "./types.js";

const aiProvider = optionalEnv("AI_PROVIDER", "openai").toLowerCase();
const fallbackProvider = optionalEnv("AI_FALLBACK_PROVIDER", "").toLowerCase();
const openaiModel = optionalEnv("OPENAI_MODEL", "gpt-4.1-mini");
const geminiModel = optionalEnv("GEMINI_MODEL", "gemini-3.5-flash");
const reviewThreshold = Number(optionalEnv("AI_REVIEW_CONFIDENCE_THRESHOLD", "0.72"));
const geminiMaxAttempts = Number(optionalEnv("GEMINI_MAX_ATTEMPTS", "4"));

const FILTER_TAXONOMY = {
  genres: ["현대물", "학원물", "리맨물", "판타지", "오메가버스", "가이드버스", "회귀물", "빙의물", "환생물", "재회물", "첫사랑물", "친구연애물", "혐관물", "시대물", "연예계물", "스포츠물", "군부물", "조폭물", "피폐물", "일상물", "리얼물", "수인물", "종교물", "느와르", "청게"],
  keywords: ["계약", "재회", "첫사랑", "짝사랑", "동거", "오해", "구원", "집착", "후회", "복수", "비밀연애", "신분차이", "나이차", "소꿉친구", "친구에서연인", "정략결혼", "임신", "육아", "상처", "질투", "쌍방구원", "쌍방짝사랑", "혐관", "배틀연애", "권선징악", "달달물", "코믹", "잔잔물", "피폐", "외전", "궁중물", "환생", "학원물", "사고", "일상물", "죽음", "상실", "사내연애", "원나잇", "기억상실", "좀비아포칼립스", "스폰서", "네임버스"],
  top: ["다정공", "헌신공", "강공", "냉혈공", "무심공", "까칠공", "츤데레공", "능글공", "초딩공", "집착공", "광공", "개아가공", "계략공", "후회공", "사랑꾼공", "순정공", "절륜공", "존댓말공", "대형견공", "연하공", "연상공", "재벌공", "능력공", "황제공", "왕자공", "귀족공", "군인공", "배우공", "아이돌공", "조폭공", "양아치공", "인외공", "상처공", "동정공", "헤테로공", "짝사랑공"],
  bottom: ["다정수", "단정수", "소심수", "헌신수", "강수", "냉혈수", "무심수", "까칠수", "츤데레수", "허당수", "지랄수", "계략수", "유혹수", "적극수", "잔망수", "명랑수", "순진수", "임신수", "도망수", "굴림수", "후회수", "능글수", "능력수", "순정수", "떡대수", "평범수", "연하수", "연상수", "재벌수", "황제수", "왕자수", "귀족수", "군인수", "배우수", "아이돌수", "조폭수", "양아치수", "인외수", "상처수", "병약수", "동정수", "헤테로수", "짝사랑수"],
  endings: ["해피엔딩", "새드엔딩", "오픈엔딩", "사망"],
} as const;

const classificationSchema = {
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
    statusReason: { type: "string" },
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
    "statusReason",
    "isAdult",
    "isPaid",
    "endings",
    "confidence",
    "note",
  ],
};

export function reviewRequired(confidence: number) {
  return !Number.isFinite(confidence) || confidence < reviewThreshold;
}

export async function classifyPost(post: ExtractedPost): Promise<Classification> {
  const inputText = compactText([
    `제목: ${post.title}`,
    `작가: ${post.author}`,
    `태그: ${post.tags.join(", ")}`,
    `성인표시: ${post.isAdult ? "Y" : "N"}`,
    `유료표시: ${post.isPaid ? "Y" : "N"}`,
    "",
    post.bodyText,
  ].join("\n"), 24_000);

  try {
    if (aiProvider === "gemini") {
      return normalizeClassification(await classifyWithGemini(inputText));
    }

    return normalizeClassification(await classifyWithOpenAI(inputText));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (aiProvider === "gemini" && fallbackProvider === "openai") {
      if (!process.env.OPENAI_API_KEY?.trim()) {
        throw new Error(`Gemini failed and OpenAI fallback is enabled, but OPENAI_API_KEY is missing. Gemini error: ${reason}`);
      }
      let fallback: Classification;
      try {
        fallback = normalizeClassification(await classifyWithOpenAI(inputText));
      } catch (fallbackError) {
        const fallbackReason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`Gemini failed, then OpenAI fallback also failed. Gemini: ${reason} OpenAI: ${fallbackReason}`);
      }
      fallback.note = compactText(`${fallback.note} Gemini 실패 후 OpenAI로 재시도함: ${reason}`, 500);
      return fallback;
    }
    throw error;
  }
}

async function classifyWithOpenAI(inputText: string): Promise<Classification> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: openaiModel,
    input: [
      {
        role: "system",
        content: [
          "너는 포스타입 아카이브 신규 글을 한국어로 분류하는 관리자 보조자다.",
          "본문 원문을 저장하지 않을 것이므로 결과에는 분류값, 0~1 confidence, 짧은 근거 note만 둔다.",
          "note에는 긴 직접 인용을 넣지 말고 판단 근거를 요약해서 적는다.",
          "확실하지 않은 값은 빈 배열 또는 빈 문자열로 두고 confidence를 낮춘다.",
          "제목, 작가명, 블로그명, 시리즈명은 keywords에 넣지 않는다.",
          "RPS는 어떤 경우에도 genres 또는 keywords에 넣지 않는다.",
          "genres는 작품 장르/세계관 계열만 넣고, keywords는 관계성/소재/전개 키워드만 넣는다.",
          "top과 bottom은 공/수 캐릭터 속성만 넣고, 인물 이름이나 제목을 넣지 않는다.",
          "isSeries는 제목/본문에 회차, 상/중/하, 숫자 회차, part/chapter, 시리즈명이 뚜렷할 때만 true로 둔다.",
          taxonomyPrompt(),
        ].join("\n"),
      },
      { role: "user", content: inputText },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "postype_classification",
        strict: true,
        schema: classificationSchema,
      },
    },
  });

  return JSON.parse(response.output_text) as Classification;
}

async function classifyWithGemini(inputText: string): Promise<Classification> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is required when AI_PROVIDER=gemini.");

  const prompt = [
    "너는 포스타입 아카이브 신규 글을 한국어로 분류하는 관리자 보조자다.",
    "본문 원문을 저장하지 않을 것이므로 결과에는 분류값, 0~1 confidence, 짧은 근거 note만 둔다.",
    "note에는 긴 직접 인용을 넣지 말고 판단 근거를 요약해서 적는다.",
    "확실하지 않은 값은 빈 배열 또는 빈 문자열로 두고 confidence를 낮춘다.",
    "제목, 작가명, 블로그명, 시리즈명은 keywords에 넣지 않는다.",
    "RPS는 어떤 경우에도 genres 또는 keywords에 넣지 않는다.",
    "genres는 작품 장르/세계관 계열만 넣고, keywords는 관계성/소재/전개 키워드만 넣는다.",
    "top과 bottom은 공/수 캐릭터 속성만 넣고, 인물 이름이나 제목을 넣지 않는다.",
    "isSeries는 제목/본문에 회차, 상/중/하, 숫자 회차, part/chapter, 시리즈명이 뚜렷할 때만 true로 둔다.",
    taxonomyPrompt(),
    "반드시 JSON 객체만 출력한다. 마크다운 코드블록이나 설명문은 붙이지 않는다.",
    "JSON 키는 genres, keywords, top, bottom, isSeries, seriesName, seriesVolume, serializationStatus, statusReason, isAdult, isPaid, endings, confidence, note만 사용한다.",
    "",
    inputText,
  ].join("\n");

  const requestBody = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  let lastError = "";
  for (let attempt = 1; attempt <= geminiMaxAttempts; attempt += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: requestBody,
    });

    const body = await response.text();
    if (response.ok) {
      const data = JSON.parse(body);
      const text = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("") || "";
      if (!text) throw new Error("Gemini API returned an empty classification.");
      return JSON.parse(text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim()) as Classification;
    }

    lastError = `Gemini API failed (${response.status}) on attempt ${attempt}/${geminiMaxAttempts}: ${body}`;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === geminiMaxAttempts) break;
    await sleep(Math.min(45_000, 2500 * attempt * attempt));
  }

  throw new Error(lastError);
}

function normalizeClassification(parsed: Classification): Classification {
  const raw = parsed as unknown as Record<string, unknown>;
  const rawGenres = asStringArray(raw.genres);
  const rawKeywords = asStringArray(raw.keywords);
  const rawTop = asStringArray(raw.top);
  const rawBottom = asStringArray(raw.bottom);
  const rawEndings = asStringArray(raw.endings);
  const genres = allowedOnly(rawGenres, FILTER_TAXONOMY.genres).slice(0, 8);
  const keywords = allowedOnly(rawKeywords, FILTER_TAXONOMY.keywords).slice(0, 12);
  const top = allowedOnly(rawTop, FILTER_TAXONOMY.top).slice(0, 8);
  const bottom = allowedOnly(rawBottom, FILTER_TAXONOMY.bottom).slice(0, 8);
  const endings = allowedOnly(rawEndings, FILTER_TAXONOMY.endings).slice(0, 5);
  const removedUnknown = [rawGenres.length - genres.length, rawKeywords.length - keywords.length, rawTop.length - top.length, rawBottom.length - bottom.length, rawEndings.length - endings.length]
    .some((count) => count > 0);
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  return {
    ...parsed,
    genres,
    keywords,
    top,
    bottom,
    endings,
    isSeries: Boolean(raw.isSeries),
    seriesName: String(raw.seriesName ?? ""),
    seriesVolume: String(raw.seriesVolume ?? ""),
    serializationStatus: normalizeSerializationStatus(raw.serializationStatus),
    statusReason: compactText(String(raw.statusReason ?? ""), 300),
    isAdult: Boolean(raw.isAdult),
    isPaid: Boolean(raw.isPaid),
    confidence: removedUnknown ? Math.min(confidence, 0.7) : confidence,
    note: compactText(`${String(raw.note ?? "")}${removedUnknown ? " 필터 목록 밖 응답은 제외함." : ""}`, 500),
  };
}

function allowedOnly(values: string[], allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  return values.filter((value) => allowedSet.has(value));
}

function taxonomyPrompt() {
  return [
    `genres 허용값: ${FILTER_TAXONOMY.genres.join(", ")}`,
    `keywords 허용값: ${FILTER_TAXONOMY.keywords.join(", ")}`,
    `top 허용값: ${FILTER_TAXONOMY.top.join(", ")}`,
    `bottom 허용값: ${FILTER_TAXONOMY.bottom.join(", ")}`,
    `endings 허용값: ${FILTER_TAXONOMY.endings.join(", ")}`,
    "허용값에 없는 단어를 새로 만들지 않는다.",
  ].join("\n");
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter((item) => item && item.toUpperCase() !== "RPS");
  }
  return String(value ?? "")
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter((item) => item && item.toUpperCase() !== "RPS");
}

function normalizeSerializationStatus(value: unknown): Classification["serializationStatus"] {
  const text = String(value ?? "").trim();
  if (text === "연재중" || text === "완결") return text;
  return "단편";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    status_reason: classification.statusReason,
    is_adult: classification.isAdult,
    is_paid: classification.isPaid,
    ai_confidence: classification.confidence,
    ai_note: classification.note,
    ai_status: needsReview ? "review_required" : "classified",
    ai_classified_at: new Date().toISOString(),
  };
}

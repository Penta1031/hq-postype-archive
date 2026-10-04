import { compactText } from "./utils.js";

export type TitleSeriesInference = {
  isSeries: true;
  seriesName: string;
  seriesVolume: string;
  serializationStatus: "연재중" | "완결";
  statusReason: string;
};

export function inferSeriesFromTitle(title: string): TitleSeriesInference | null {
  const normalizedTitle = compactText(title).replace(/\s+/g, " ").trim();
  if (!normalizedTitle) return null;

  const completionSuffix = /\s*(?:[\[(]\s*(?:完|완결|final)\s*[\])]|(?:완결|final))\s*$/i;
  const isComplete = completionSuffix.test(normalizedTitle);
  const titleWithoutCompletion = normalizedTitle.replace(completionSuffix, "").trim();
  const markerMatch = titleWithoutCompletion.match(/^(.*?)(?:\s*[-–—_:.,]?\s*)(?:[\[(]\s*)?(上|中|下)(?:\s*[\])])?\s*$/);
  const numberedMatch = titleWithoutCompletion.match(
    /^(.*?)(?:\s*[-–—_:.,]?\s*)(?:(?:ep(?:isode)?|chapter|chap|ch|part)\.?\s*)?(?:[\[(]\s*)?(\d{1,3})(?:\s*[\])])?\s*[-–—]?\s*$/i,
  );
  const match = markerMatch || numberedMatch;
  if (!match) return null;

  const volume = String(match[2] || "").trim();
  let seriesName = String(match[1] || "")
    .replace(/^\s*\[[^\]]{1,20}\]\s*/, "")
    .replace(/[\s\-_–—:.,]+$/, "")
    .trim();
  if (!seriesName || /^(?:ep(?:isode)?|chapter|chap|ch|part)$/i.test(seriesName)) seriesName = "";
  if (numberedMatch && /^\d+$/.test(titleWithoutCompletion)) return null;

  return {
    isSeries: true,
    seriesName,
    seriesVolume: volume,
    serializationStatus: isComplete || volume === "下" ? "완결" : "연재중",
    statusReason: `제목의 회차 표기(${volume})를 기준으로 자동 판정`,
  };
}

export function titleSeriesPatch(title: string) {
  const inferred = inferSeriesFromTitle(title);
  if (!inferred) return {};
  return {
    is_series: true,
    series_name: inferred.seriesName || null,
    series_volume: inferred.seriesVolume,
    serialization_status: inferred.serializationStatus,
    status_reason: inferred.statusReason,
  };
}

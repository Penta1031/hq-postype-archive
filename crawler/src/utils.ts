import { existsSync, readFileSync } from "node:fs";

export function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function optionalEnv(name: string, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

export function truthyEnv(name: string, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value);
}

export function uniqueBy<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function postypePostIdFromUrl(url: string) {
  const match = url.match(/\/post\/(\d+)/);
  return match ? Number(match[1]) : null;
}

export function normalizePostUrl(rawUrl: string, baseUrl: string) {
  try {
    const url = new URL(rawUrl, baseUrl);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function compactText(value: string, maxLength = 1800) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function parseAuthState(value: string) {
  const raw = value.trim();
  if (!raw) return undefined;
  if (existsSync(raw)) return JSON.parse(readFileSync(raw, "utf8"));
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  }
}

export function todayIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function joinList(values: unknown) {
  if (Array.isArray(values)) {
    return values.map((value) => String(value ?? "").trim()).filter(Boolean).join(", ");
  }
  return String(values ?? "")
    .split(/[,，、\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .join(", ");
}

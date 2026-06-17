export type Source = {
  id: number;
  source_type: string | null;
  source_url: string;
  enabled: boolean;
};

export type PostLink = {
  url: string;
  postypePostId: number | null;
  sourceUrl: string;
};

export type CrawlStatus = "success" | "access_denied" | "purchase_required" | "error";

export type ExtractedPost = {
  postypePostId: number | null;
  sourceUrl: string;
  link: string;
  title: string;
  author: string;
  publishedDate: string | null;
  bodyText: string;
  preview: string;
  tags: string[];
  isAdult: boolean;
  isPaid: boolean;
  crawlStatus: CrawlStatus;
  crawlError: string | null;
};

export type Classification = {
  genres: string[];
  keywords: string[];
  top: string[];
  bottom: string[];
  isSeries: boolean;
  seriesName: string;
  seriesVolume: string;
  serializationStatus: "단편" | "연재중" | "완결";
  isAdult: boolean;
  isPaid: boolean;
  endings: string[];
  confidence: number;
  note: string;
};

export type RunSummary = {
  status: "success" | "partial_success" | "failed";
  foundCount: number;
  insertedCount: number;
  aiReviewCount: number;
  failedCount: number;
  errorMessage?: string;
  newPosts: Array<{ title: string; author: string; link: string }>;
};

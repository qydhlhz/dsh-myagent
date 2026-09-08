// src/mime.ts — 纯函数，扩展名 → 展示类型与 content-type。
export const TEXT_MAX_BYTES = 512 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_MAX_BYTES = 100 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 100 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;

const TEXT_EXT = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "markdown", "txt", "css", "scss", "html", "htm", "xml", "yaml", "yml", "py", "r", "sh", "bat", "ps1", "csv", "log", "sql", "toml", "ini", "env", "gitignore", "tsv"]);
const IMAGE_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon" };
const AUDIO_EXT: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", opus: "audio/opus" };
const VIDEO_EXT: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime", m4v: "video/x-m4v", avi: "video/x-msvideo" };
const OFFICE_EXT: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
};
const TEXT_MIME: Record<string, string> = { json: "application/json", html: "text/html", htm: "text/html", svg: "image/svg+xml" };

export type SniffedKind = "text" | "image" | "pdf" | "audio" | "video" | "binary";

export function sniff(name: string): { kind: SniffedKind; mime: string } {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  const imageMime = IMAGE_EXT[ext];
  if (imageMime) return { kind: "image", mime: imageMime };
  if (ext === "pdf") return { kind: "pdf", mime: "application/pdf" };
  const audioMime = AUDIO_EXT[ext];
  if (audioMime) return { kind: "audio", mime: audioMime };
  const videoMime = VIDEO_EXT[ext];
  if (videoMime) return { kind: "video", mime: videoMime };
  // Office 文档（docx/xlsx/pptx/odt/ods/odp/rtf）不再做预览：归为 binary（可下载），
  // 但保留真实 MIME 供下载时使用正确的 content-type。
  const officeMime = OFFICE_EXT[ext];
  if (officeMime) return { kind: "binary", mime: officeMime };
  if (ext !== "" && !TEXT_EXT.has(ext)) return { kind: "binary", mime: "application/octet-stream" };
  return { kind: "text", mime: TEXT_MIME[ext] ?? "text/plain; charset=utf-8" };
}

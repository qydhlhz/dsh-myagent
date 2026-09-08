// src/limits.ts — 结合扩展名与大小给出展示/编辑策略。
import { IMAGE_MAX_BYTES, TEXT_MAX_BYTES, PDF_MAX_BYTES, AUDIO_MAX_BYTES, VIDEO_MAX_BYTES, sniff } from "./mime.ts";

// 供 service.ts 使用：文本截断上限与 classify 一起从 limits 导出。
export { TEXT_MAX_BYTES, PDF_MAX_BYTES, AUDIO_MAX_BYTES, VIDEO_MAX_BYTES };

export interface Classified {
  kind: "text" | "image" | "pdf" | "audio" | "video" | "binary";
  mime: string;
  truncated: boolean;
  /** 仅"未超限文本"可编辑（编辑受 512KB 上限约束）。 */
  editable: boolean;
}

// 分支语义：
// - 原生二进制（zip/Office 文档/...）→ truncated:false：不可预览，占位+下载；
// - 图片/PDF/音视频超限 → 降级为 binary + truncated:true：仅下载；
// - 仅"未超限文本"editable:true（编辑受 512KB 上限约束）。
export function classify(name: string, size: number): Classified {
  const { kind, mime } = sniff(name);
  if (kind === "image" && size <= IMAGE_MAX_BYTES) return { kind, mime, truncated: false, editable: false };
  if (kind === "image") return { kind: "binary", mime, truncated: true, editable: false };
  if (kind === "text" && size <= TEXT_MAX_BYTES) return { kind, mime, truncated: false, editable: true };
  if (kind === "text") return { kind, mime, truncated: true, editable: false };
  if (kind === "pdf" && size <= PDF_MAX_BYTES) return { kind, mime, truncated: false, editable: false };
  if (kind === "pdf") return { kind: "binary", mime, truncated: true, editable: false };
  if (kind === "audio" && size <= AUDIO_MAX_BYTES) return { kind, mime, truncated: false, editable: false };
  if (kind === "audio") return { kind: "binary", mime, truncated: true, editable: false };
  if (kind === "video" && size <= VIDEO_MAX_BYTES) return { kind, mime, truncated: false, editable: false };
  if (kind === "video") return { kind: "binary", mime, truncated: true, editable: false };
  return { kind: "binary", mime, truncated: false, editable: false };
}

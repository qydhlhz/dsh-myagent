// src/path.ts — 纯函数，无 dsh 依赖；windows 与 posix 同时处理。
import { join, resolve, sep } from "node:path";

const WIN_DRIVE = /^[a-zA-Z]:[\\/]/;

/** 相对路径白名单：非空、非 .、无盘符、不以 / 或 \ 开头、无越界 .. 段。 */
export function isSafeRel(rel: string): boolean {
  if (!rel || rel === ".") return false;
  if (WIN_DRIVE.test(rel)) return false;
  if (rel.startsWith("/") || rel.startsWith("\\")) return false;
  const parts = rel.split(/[\\/]+/);
  let depth = 0;
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") { depth -= 1; if (depth < 0) return false; }
    else depth += 1;
  }
  return depth > 0;
}

/** 校验并拼接；不合法返回 null。root 必须是绝对路径。 */
export function safeJoin(root: string, rel: string): string | null {
  if (!isSafeRel(rel)) return null;
  return join(root, ...rel.split(/[\\/]+/).filter((p) => p !== "."));
}

/** 把根内绝对路径转成 API 的 POSIX 相对形式；不在根内返回 null。 */
export function toApiPath(root: string, absolute: string): string | null {
  const r = resolve(root) + sep;
  const a = resolve(absolute);
  if (a !== resolve(root) && !a.startsWith(r)) return null;
  return a.slice(r.length).split(sep).join("/");
}

// src/path.ts — 纯函数，无 dsh 依赖；Windows 与 POSIX 两种路径语义都支持。
//
// 为什么不用 `node:path` 的默认导出：默认导出跟着**运行平台**走 —— 同一份代码在 Linux 上
// 处理 `C:\a\b` 会给出 POSIX 拼接结果，纯函数因此变得不可移植，单测也无法同时钉住两种语义
// （CI 第一次跑就是这么挂的）。这里改成按**输入形态**选语义：
// 盘符 / UNC / 含反斜杠 → win32，其余 → posix。生产路径来自宿主所在平台，行为与从前一致。
import { posix, win32 } from "node:path";

type PathStyle = typeof posix;

const WIN_DRIVE = /^[a-zA-Z]:[\\/]/;

/** 按输入形态选路径语义：只要有一个参数是 Windows 拼写，就用 win32。 */
function styleFor(...paths: Array<string | undefined>): PathStyle {
  for (const p of paths) {
    if (p === undefined) continue;
    if (WIN_DRIVE.test(p) || p.startsWith("\\\\") || p.includes("\\")) return win32;
  }
  return posix;
}

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

/** 校验并拼接；不合法返回 null。root 用 Windows 或 POSIX 拼写都可以。 */
export function safeJoin(root: string, rel: string): string | null {
  if (!isSafeRel(rel)) return null;
  const style = styleFor(root, rel);
  return style.join(root, ...rel.split(/[\\/]+/).filter((p) => p !== "."));
}

/** 把根内绝对路径转成 API 的 POSIX 相对形式；不在根内返回 null。 */
export function toApiPath(root: string, absolute: string): string | null {
  const style = styleFor(root, absolute);
  const base = style.resolve(root);
  const target = style.resolve(absolute);
  if (target !== base && !target.startsWith(base + style.sep)) return null;
  return target.slice((base + style.sep).length).split(style.sep).join("/");
}

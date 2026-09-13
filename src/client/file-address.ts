// src/client/file-address.ts — dsh-resource:// 文件地址构造（纯函数，无运行时依赖）。
//
// 为什么需要它：dsh 0.1.5 起右侧栏是"标签页 + 地址"模型。官方文件预览
// （@deepseek-ai/dsh-client-ui-sidebar-documentpreview，kind "text"）声明的是
// `patterns: ["dsh-resource://file/**"]` + `canOpen: scope === "session"`，也就是说
// **只有会话作用域地址才会被它接管**；绝对作用域（dsh-resource://file/absolute/…）没有
// 任何类型认领，openResource 会直接抛 "no registered tab type claims"。
// 因此 myagent 的左侧文件树必须构造会话作用域地址 —— 这正是本模块存在的唯一理由。
//
// 地址语法（与宿主官方 @deepseek-ai/dsh-util-workspace-path 的 file-address.ts 逐字对齐）：
//   dsh-resource://file/session/<sessionId>/<path>
//     path 相对该会话的工作区根；若调用方给的是根外绝对路径，则绝对路径原样放进 path
//     （官方 fileAddressFor 同款策略，会话信息不丢）。宿主按**地址里的 sessionId** 解析
//     相对路径（官方预览读的是地址里的会话，不是标签页所在会话）。

/** 文件地址的固定 scheme + type 前缀（官方常量同名同值）。 */
export const FILE_ADDRESS_PREFIX = "dsh-resource://file/";

/** 路径是否已是绝对（宿主接受的两种拼写：POSIX `/a/b`、Windows 盘符或 UNC）。 */
export function isAbsoluteWorkspacePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith("\\\\");
}

/** 逐段编码，保留 `:` 字面量（盘符 `C:` 不能被编成 `C%3A`，否则宿主解析回来不是盘符）。 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ":");
}

function encodePath(path: string): string {
  return path.split("/").map(encodeSegment).join("/");
}

/** 构造会话作用域地址（`dsh-resource://file/session/<id>/<path>`）。 */
export function sessionFileAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
}

/**
 * 按调用方手里的路径构造地址（官方 fileAddressFor 同款策略）：
 * 相对路径、或落在会话工作区内的绝对路径 → 削成相对路径进会话地址；
 * 根未知、或文件在根之外的绝对路径 → 绝对路径原样进会话地址。
 *
 * @param sessionId - 该地址归属的会话；宿主按它解析相对路径，必须是"cwd 那个根"所属的会话。
 * @param cwd - 该会话的工作区根（绝对路径）。未知传 undefined。
 * @param path - 工作区相对路径，或任意绝对路径，两种分隔符拼写都接受。
 */
export function fileAddressFor(sessionId: string, cwd: string | undefined, path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized);
  const root = cwd === undefined ? "" : cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (root !== "" && normalized === root) return sessionFileAddress(sessionId, "");
  if (root !== "" && normalized.startsWith(`${root}/`)) {
    return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
  }
  return sessionFileAddress(sessionId, normalized);
}

// src/client/tree-utils.ts — 纯函数与槽位数据形状（浏览器/测试共用，无运行时依赖）。
// 数据形状对齐真实来源（dsh-client-runtime / dsh-client-web-react 的 standardProps）：
//   - workspaces.list 快照（useWorkspaces 的数据源）：{ items, archivedSessionIds, phase, ... }，
//     items 元素是宿主 Workspace view：{ workspaceId, path, title, sessionIds, createdAt }
//     （见 runtime client.js project() / itemViews()，以及 ui-workspace buildGroup 用到的字段）。
//   - sessions.list 快照（useSessions 的数据源）：{ ids, byId, current, phase, ... }，
//     byId[id] 是会话摘要：{ id, title, blank, cwd, ... }。

export function joinRel(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

/**
 * 由工作区根（绝对路径）与条目相对路径拼出绝对路径（"复制项目地址"用）。
 *  - rel 为空（根目录自身）→ 直接返回 root
 *  - root 已带尾部分隔符（/ 或 \）时不重复拼接分隔符
 */
export function resolveAbsPath(root: string, rel: string): string {
  if (rel === "") return root;
  const sep = root.endsWith("/") || root.endsWith("\\") ? "" : "/";
  return `${root}${sep}${rel}`;
}

/**
 * 校验输入对话框的名称/路径输入（PromptModal 的 validate prop 用）。
 * 返回错误文案（非 null）或 null（合法）。
 *  - "name"（新建文件/文件夹、重命名）：拒绝空、含 / 或 \（防 joinRel 透传意外嵌套）、. 或 ..
 *  - "path"（移动目标）：拒绝空、以分隔符开头、含 .. 段
 */
export function validateNameInput(kind: "name" | "path", value: string): string | null {
  if (kind === "name") {
    if (value === "") return "名称不能为空";
    if (/[/\\]/.test(value)) return "名称不能包含 / 或 \\";
    if (value === "." || value === "..") return "名称不能是 . 或 ..";
    return null;
  }
  if (value === "") return "路径不能为空";
  if (/^[/\\]/.test(value)) return "路径不能以分隔符开头";
  if (value.split(/[/\\]/).includes("..")) return "路径不能包含 ..";
  return null;
}

/** HTML 转义（仅 & < >；顺序固定：& 必须先转，否则已转义实体被二次转义）。高亮失败回退等防注入场景用。 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface TreeEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
  size?: number;
}

export function sortEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) =>
    a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : a.name.localeCompare(b.name));
}

export interface WorkspaceView {
  workspaceId: string;
  path: string;
  title: string;
  // 防御：host 投影时序（拖拽重排等刷新）可能暂缺 sessionIds，消费方必须按
  // (w.sessionIds ?? []) 访问（渲染永不抛，见 WorkspaceBrowser / resolveRoot）。
  sessionIds?: string[];
  createdAt?: string;
}

export interface WorkspacesSnapshot {
  items: WorkspaceView[];
  archivedSessionIds: string[];
  phase?: string;
  state?: string;
  error?: unknown;
  baselinesReady?: boolean;
  recentWorkspaceId?: string;
}

/** 会话等待用户交互的状态（host 实时位，官方 dsh-client-runtime 的 PendingInteractionStatus）。 */
export type PendingInteractionStatus = "approval" | "plan-review" | "question";

export interface SessionSummary {
  id: string;
  title?: string;
  blank?: boolean;
  cwd?: string;
  /** 会话当前是否在运行（host 实时位，与官方 ui-workspace sessionNode.running 同源）。 */
  running?: boolean;
  /** 会话是否有待处理的完成提醒（host 实时位，与官方 sessionNode.completed 同源）。 */
  completed?: boolean;
  /** 会话是否有等待用户交互的状态（approval / plan-review / question）。 */
  pendingInteraction?: PendingInteractionStatus;
}

export interface SessionsSnapshot {
  ids?: string[];
  byId: Record<string, SessionSummary>;
  current?: string;
  phase?: string;
}

/** 槽位标准套件里 useSessions/useWorkspaces 的选择器 hook 形状（bindSnapshotSelector）。 */
export type SelectorHook<T> = <S>(selector: (state: T) => S, eq?: (a: S, b: S) => boolean) => S;

/** 路径归一化用于比较：分隔符统一为 /、去掉尾部 /；win32 风格（盘符/UNC）再折大小写。 */
function normForCompare(path: string): string {
  const r = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:/.test(r) || r.startsWith("//") ? r.toLowerCase() : r;
}

/**
 * 找出"工作区根 == root"的一个会话，用于构造会话作用域文件地址。
 *
 * 为什么需要：官方文件预览只接管 `session` 作用域地址，而宿主按**地址里的 sessionId**
 * 解析相对路径（相对该会话的工作区根）。所以打开 api.root 下的文件时，地址里的会话
 * 必须真的属于这个根，否则预览会去读另一个根的同名路径。
 *
 * 优先当前会话（与官方文件树"用标签页所在会话"的行为一致），否则取该区下第一个会话。
 *
 * @returns `{ sessionId, cwd }`；该根下没有任何会话时 null（调用方应放弃打开并提示，而不是乱猜会话）。
 */
export function sessionForRoot(
  sessions: SessionsSnapshot,
  workspaces: WorkspacesSnapshot,
  root: string,
): { sessionId: string; cwd: string } | null {
  const target = normForCompare(root);
  for (const w of workspaces.items) {
    if (typeof w.path !== "string" || normForCompare(w.path) !== target) continue;
    const ids = w.sessionIds ?? [];
    if (sessions.current !== undefined && ids.includes(sessions.current)) {
      return { sessionId: sessions.current, cwd: w.path };
    }
    const first = ids[0];
    if (first !== undefined) return { sessionId: first, cwd: w.path };
  }
  return null;
}

/**
 * 推导区文件树根：优先取"当前会话所属工作区"的 path（currentSessionId 显式参数优先于
 * sessions.current）；取不到则取第一个工作区；都没有返回 null（调用方显示占位，不调 API）。
 */
export function resolveRoot(
  sessions: SessionsSnapshot,
  workspaces: WorkspacesSnapshot,
  currentSessionId?: string,
): string | null {
  const current = currentSessionId ?? sessions.current;
  if (current !== undefined) {
    for (const w of workspaces.items) {
      if ((w.sessionIds ?? []).includes(current)) return w.path;
    }
  }
  const first = workspaces.items[0];
  return first ? first.path : null;
}

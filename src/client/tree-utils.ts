// src/client/tree-utils.ts — 纯函数与槽位数据形状（浏览器/测试共用，无运行时依赖）。
//
// 【dsh 0.2 数据形状（源码实证：安装包 0.2.0-rc.2）】
//   - workspaces.list 快照（useWorkspaces 的数据源，dsh-api-workspace-controller 的
//     WorkspaceSnapshot）：{ items, archivedSessionIds, pinnedSessionIds, state, phase, error }。
//     items 元素是 WorkspaceView：{ workspaceId, path, title, sessionIds, createdAt, updatedAt }。
//     注意 0.2 **没有** recentWorkspaceId / baselinesReady（0.1.5 有）——"最近工作区"的回退
//     已内建在 ctx.uiWorkspace.startSession() 里，插件不再自己算。
//   - sessions.list 快照（useSessions 的数据源，dsh-api-session-controller 的 SessionListState）：
//     { ids, byId, phase, projectionsBySession }。byId[id] 是 SessionSummary：
//     { id, title?, displayTitle, cwd?, parentId?, origin?, running, retainedBy, blank, updatedAt }。
//     ⚠️ 0.2 **没有** `current` 字段（0.1.5 有）：导航归视图所有者（ctx.uiWorkspace），
//     Session Controller 只持有目录与本地引用计数。当前会话必须按官方 ui-workspace 的口径
//     从本地引用来源推导 —— 见 mainSessionId()。
//   - 会话的"等待用户 / 已完成待读 / 运行中"在 0.2 走**统一 UI 状态**通道：
//     全局 hook `useSessionStatus` 返回 ReadonlyMap<SessionId, SessionStatus>，
//     SessionStatus = { running, pendingInteraction, completionUnread }
//     （dsh-client-ui-session 合并进 GlobalStandardProps）。0.1.5 的
//     `useSessionPendingInteraction` 在 0.2 已不存在。

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
  /** 0.2 新增：全局置顶集合（宿主序，最近置顶在前）。插件不消费，留作形状对齐。 */
  pinnedSessionIds?: string[];
  phase?: string;
  state?: string;
  error?: unknown;
}

/** 槽位标准套件里 useSessions/useWorkspaces/useSessionStatus 的选择器 hook 形状（bindSnapshotSelector）。 */
export type SelectorHook<T> = <S>(selector: (state: T) => S, eq?: (a: S, b: S) => boolean) => S;

/** 会话等待用户交互的状态（客户端域发布的 PendingInteractionStatus）。 */
export type PendingInteractionStatus = "approval" | "plan-review" | "question";

/**
 * 一条待交互记录里我们关心的字段（域自己的对象：PendingApproval / PendingQuestion）。
 * 0.2 的 SessionStatus.pendingInteraction 就是这个形状（另有 key / sessionId）。
 */
export interface PendingInteractionLike {
  /** 域判别符：approval / plan-review / question。 */
  readonly kind?: string;
  readonly sessionId?: string;
}

/**
 * 一个会话的统一 UI 状态（dsh-client-ui-session 的 SessionStatus）。
 * 这是 0.2 里"等待用户 / 运行中 / 已完成待读"的唯一真源。
 */
export interface SessionStatus {
  /** 最新已知运行位；基线或事件到达前为 undefined。 */
  readonly running?: boolean;
  /** 当前优先级最高的、等待用户操作的域请求。 */
  readonly pendingInteraction?: PendingInteractionLike;
  /** 在非主视图处观察到的停止是否还需要用户确认。 */
  readonly completionUnread?: boolean;
}

/** `useSessionStatus` 的快照：按会话 id 索引（缺键 = 该会话暂无状态）。 */
export type SessionStatusSnapshot = ReadonlyMap<string, SessionStatus>;

/** 统一 UI 状态选择器 hook（槽位全局标准套件 `useSessionStatus`）。 */
export type SessionStatusHook = SelectorHook<SessionStatusSnapshot>;

export interface SessionSummary {
  id: string;
  title?: string;
  /** 面向人的标签：durable title → 目录名 → 会话 id（0.2 新增，插件未用，留作形状对齐）。 */
  displayTitle?: string;
  blank?: boolean;
  cwd?: string;
  /**
   * 会话当前是否在运行（宿主实时位，与官方 ui-workspace sessionNode.running 同源）。
   * 0.2 里它只是**兜底**：优先读 useSessionStatus 的 running（官方行也是这么做的）。
   */
  running?: boolean;
  /**
   * 本地引用来源计数（0.2 新增，官方 ui-workspace 用它判定"当前会话"）：
   * `retainedBy.mainView > 0` 的就是主视图里打开着的那个会话 —— 见 mainSessionId()。
   */
  retainedBy?: Readonly<Record<string, number>>;
}

export interface SessionsSnapshot {
  ids?: string[];
  byId: Record<string, SessionSummary>;
  phase?: string;
  /** 0.2 的 SessionListState 没有 current；保留可选字段只为兼容测试桩与旧快照。 */
  current?: string;
}

/**
 * 当前（主视图）会话 id —— 官方 ui-workspace 的推导口径，逐字复刻：
 *
 *     Object.values(list.byId).find((s) => (s.retainedBy.mainView ?? 0) > 0)?.id
 *
 * 为什么不是某个 `current` 字段：0.2 起导航归视图所有者，Session Controller 的
 * SessionListState 只有目录与本地引用计数；"哪个会话正开在主视图"这件事由
 * `mainView` 这条引用来源表达（ctx.uiWorkspace.openSession 会 retain(mainView)）。
 *
 * @returns 当前会话 id；没有任何 mainView 引用（例如打开的是全局面板）时 undefined。
 */
export function mainSessionId(sessions: SessionsSnapshot): string | undefined {
  if (sessions.current !== undefined) return sessions.current;
  for (const id of Object.keys(sessions.byId)) {
    const retained = sessions.byId[id]?.retainedBy;
    if (retained !== undefined && (retained.mainView ?? 0) > 0) return id;
  }
  return undefined;
}

/**
 * 只认三个"需要用户动手"的域，其余（含未知 kind 与 undefined）当作没有待交互。
 * 与官方 ui-workspace `visiblePendingKind` 同一口径，避免自造第四种状态。
 */
export function visiblePendingKind(kind: unknown): PendingInteractionStatus | undefined {
  return kind === "approval" || kind === "plan-review" || kind === "question" ? kind : undefined;
}

/** 取某会话的待交互种类（状态缺席 / kind 未知 → undefined）。hook 缺席时也安全返回 undefined。 */
export function pendingKindOf(
  snapshot: SessionStatusSnapshot | undefined,
  sessionId: string,
): PendingInteractionStatus | undefined {
  return visiblePendingKind(snapshot?.get(sessionId)?.pendingInteraction?.kind);
}

/** 会话行状态点的语义（优先级从高到低，与官方 ui-workspace sessionStatuses 对齐）。 */
export type SessionDotKind = PendingInteractionStatus | "running" | "completed" | "blank" | "current" | "idle";

/**
 * 汇总一格会话行的状态点语义。优先级：等待用户（批准/计划确认/问答）> 运行中 >
 * 已完成待读 > 空白新会话 > 当前会话 > 空闲。summary 缺失（列表还没到）返回 undefined
 * —— 调用方据此不渲染点。
 *
 * 为什么待交互排最前：等用户的时候宿主那一侧的回合仍在跑（running 依旧为 true），
 * 若按 running 出蓝色脉冲点，用户就分不清"它在干活"还是"它在等我"。
 *
 * 【dsh 0.2 数据源】待交互 / 已完成待读 读 `useSessionStatus` 的统一状态
 * （SessionStatus.pendingInteraction / completionUnread）；官方 ui-workspace 的会话行
 * 也是这一口径（"活动状态优先使用统一 UI status，缺少时使用 Session 摘要"）。
 * 摘要的 running 只作兜底 —— 某会话尚无状态条目时至少还能显示"在跑"。
 */
export function sessionDotKind(args: {
  id: string;
  summary: SessionSummary | undefined;
  /** 该会话的统一 UI 状态（useSessionStatus 快照按 id 取）；缺席时退回摘要的 running。 */
  status?: SessionStatus | undefined;
  /** 当前主视图会话 id（mainSessionId 的结果），用于"当前会话"标识。 */
  current?: string;
}): SessionDotKind | undefined {
  const { id, summary, status, current } = args;
  if (summary === undefined) return undefined;
  const pending = visiblePendingKind(status?.pendingInteraction?.kind);
  if (pending !== undefined) return pending;
  // 运行中：统一状态在场就以它为准，缺席（该会话还没有状态条目）才退回摘要的 running
  // —— 官方 ui-workspace 的口径是"活动状态优先使用统一 UI status，缺少时使用 Session 摘要"。
  if ((status?.running ?? summary.running) === true) return "running";
  if (status?.completionUnread === true) return "completed";
  if (summary.blank === true) return "blank";
  if (id === current) return "current";
  return "idle";
}

/** 状态点悬停提示（中文，与 rail 任务点共用）。 */
export const SESSION_DOT_LABEL: Record<SessionDotKind, string> = {
  approval: "等待批准",
  "plan-review": "等待计划确认",
  question: "等待回答",
  running: "正在运行",
  completed: "已完成",
  blank: "新会话",
  current: "当前会话",
  idle: "空闲",
};

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
  const current = mainSessionId(sessions);
  for (const w of workspaces.items) {
    if (typeof w.path !== "string" || normForCompare(w.path) !== target) continue;
    const ids = w.sessionIds ?? [];
    if (current !== undefined && ids.includes(current)) {
      return { sessionId: current, cwd: w.path };
    }
    const first = ids[0];
    if (first !== undefined) return { sessionId: first, cwd: w.path };
  }
  return null;
}

/**
 * 推导区文件树根：优先取"当前会话所属工作区"的 path（currentSessionId 显式参数优先于
 * mainSessionId()）；取不到则取第一个工作区；都没有返回 null（调用方显示占位，不调 API）。
 */
export function resolveRoot(
  sessions: SessionsSnapshot,
  workspaces: WorkspacesSnapshot,
  currentSessionId?: string,
): string | null {
  const current = currentSessionId ?? mainSessionId(sessions);
  if (current !== undefined) {
    for (const w of workspaces.items) {
      if ((w.sessionIds ?? []).includes(current)) return w.path;
    }
  }
  const first = workspaces.items[0];
  return first ? first.path : null;
}

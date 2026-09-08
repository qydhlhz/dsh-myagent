// src/client/WorkspaceBrowser.tsx — 工作沙盒区/会话列表（Round 2：与原生 DSH 对齐）。
// props 契约以真实槽位来源为准（参考 @deepseek-ai/dsh-client-ui-workspace/lib/client.js 的
// WorkspaceBrowser 签名，行 1647）：owner share（useSessions/useWorkspaces/wide/expandSidebar）
// + inject actions（client.ts 从 ctx.sessions / ctx.workspaces 提供，镜像 browserInjected 形状）。
// Round 2 对齐原生行为：
//   1) 收起/展开：工作沙盒行点击折叠/展开其会话列表（"A Workspace remembers whether it is
//      closed or showing Sessions"）。展开态用 localStorage 持久化（key fm.workspace.collapsed，
//      只存 collapsed 的 id 集合）；打开新会话时自动展开对应组（原生 onCreate 同款）。与原生
//      差异：原生默认折叠非当前组，我们默认全部展开（v1 显示全部会话，且 spec 只存 collapsed
//      集合——缺省即展开，语义更简单）。
//   2) 拖拽排序：HTML5 drag（draggable + dragstart/dragover/drop），调用注入的
//      insertWorkspaceBefore(workspaceId, beforeWorkspaceId) / insertSessionBefore(workspaceId,
//      sessionId, beforeSessionId)。末尾 = before 传 undefined（runtime client.js insertBefore
//      注释 "omitted appends"，与 ui-workspace commit*Drag 的 anchor 计算一致：after 最后一个
//      行 → 下一行 id 为 undefined）。拖拽中目标行显示插入线（before/after，business-primary），
//      文档级 dragover/drop 拦截防拖出列表时浏览器导航（useNativeDragAcceptance 同款）。
//   3) 图标对齐：统一行结构——固定宽度图标列（16px 槽）+ 名称 + 行内操作按钮组（hover 显示）。
//      工作沙盒行：Folder 图标（展开 IconFolderOpen16 / 收起 IconFolderClose16），hover 时切换
//      为三角箭头（IconTriangleRightFill14，展开态 rotate 90°，与原生 .arrow/.arrowOpen 一致）；
//      会话行：状态小圆点（当前会话实心 business 点）。
// UI polish 轮：rename/delete/archive 用 primitives Modal + Input；行按钮用 primitives Button；
// 色值全部走 --dsw-* token。
import React, { useRef, useState } from "react";
import {
  Button,
  IconArchiveOutline20,
  IconEditOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconListPenOutline16,
  IconNewChatOutline16,
  IconPanelLeftOutline16,
  IconPlusOutline16,
  IconProjectAddOutline16,
  IconTrashOutline16,
  IconTriangleRightFill14,
  Modal,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { SelectorHook, SessionsSnapshot, WorkspacesSnapshot, SessionSummary } from "./tree-utils.ts";
import { validateNameInput } from "./tree-utils.ts";
import { ConfirmModal, PromptModal } from "./ContextMenu.tsx";
import { TopHatIcon } from "./TopHatIcon.tsx";
import { Api, describeApiError } from "./api.ts";
import type { ApiError } from "./api.ts";
import {
  addGroup,
  createGroup,
  replayMutations,
  DEFAULT_GROUP_ID,
  deleteGroup,
  emptyGroups,
  loadGroups,
  renameGroup,
  reorderGroups,
  reorderSessionInGroup,
  saveGroups,
  moveSessionToGroup,
  groupOfSession,
  visibleSessionsForGroup,
  type SessionGroups,
} from "./group-store.ts";
import {
  emptyAnnotations,
  loadAnnotations,
  saveAnnotations,
  setLastOrganizedAt,
  setLastPlan,
  setSessionBrief,
  type AnnotationData,
} from "./annotation-store.ts";
import {
  applyOrganizeActionToGroups,
  applyOrganizeActionsToAnnotations,
  buildOrganizePlan,
  diffOrganize,
  isGroupAction,
  normalizeOrganizePlan,
  organizeActionKey,
  type OrganizeAction,
  type OrganizeDiffItem,
  type OrganizerSnapshot,
  type OrganizerWorkspace,
} from "./organizer.ts";
import { OrganizePanel } from "./OrganizePanel.tsx";

export interface WorkspaceBrowserProps {
  wide?: boolean;
  expandSidebar?: () => void;
  /** 标题栏右侧追加内容（SidebarComposite 注入区级折叠切换按钮）。 */
  headerExtra?: React.ReactNode;
  /** 标题栏按钮组 key（每次展开递增，强制重挂载按钮组以重放 stagger 滑入动画）。 */
  toolbarKey?: number;
  /** 区容器高度过渡期间置 true：列表滚动区临时 hidden（避免滚动条闪现抖动）。 */
  scrollLock?: boolean;
  /** 窄栏（rail）模式下点击顶部展开按钮的回调（宿主 rail / 外部注入；区级折叠不再传）。 */
  onExpand?: () => void;
  /** 当前工作沙盒的文件 API（读取/写入 .myagent/groups.json 用）。 */
  api: Api | null;
  useSessions: SelectorHook<SessionsSnapshot>;
  useWorkspaces: SelectorHook<WorkspacesSnapshot>;
  startSession?: (workspaceId?: string) => void;
  /** 新建工作沙盒（宿主原生目录选择器 + workspace.create）；用户取消时静默。 */
  addWorkspace?: () => void | Promise<void>;
  open?: (sessionId: string) => void;
  renameSession?: (sessionId: string, title: string) => void | Promise<void>;
  renameWorkspace?: (workspaceId: string, title: string) => void | Promise<void>;
  deleteWorkspace?: (workspaceId: string) => void | Promise<void>;
  archiveSession?: (sessionId: string) => void | Promise<void>;
  insertWorkspaceBefore?: (workspaceId: string, beforeWorkspaceId?: string) => void | Promise<void>;
  insertSessionBefore?: (workspaceId: string, sessionId: string, beforeSessionId?: string) => void | Promise<void>;
}

// 展开态持久化：localStorage 只存 collapsed 的 workspaceId 集合（缺省 = 展开）。
const COLLAPSED_KEY = "fm.workspace.collapsed";
// 分组折叠态持久化：localStorage 使用工作沙盒 + 分组复合 key，避免不同沙盒同名分组互相影响。
const GROUP_COLLAPSED_KEY = "fm.group.collapsed";

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (raw === null) return new Set();
    const arr: unknown = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(ids: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage 不可用（隐私模式/配额）时静默降级为会话内记忆。
  }
}

// 行 hover / 拖拽插入线 / 箭头旋转统一走注入样式 + className（与 FileTree 的 TREE_CSS 同模式）。
// 原生行为：行 hover 时显示操作按钮组（rowActions display:none → hover 显示）；工作沙盒行
// hover 时 Folder 图标切换为三角箭头（.projectRow .chevron{display:none} → hover 显示 + folder
// 隐藏）；箭头展开态 rotate(90deg)（.arrow/.arrowOpen）。
const BROWSER_CSS = `
.fm-wb-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.fm-wb-row-actions{display:none}
.fm-wb-row:hover .fm-wb-row-actions{display:inline-flex;align-items:center}
.fm-wb-ws-chevron{display:none}
.fm-wb-ws-row:hover .fm-wb-ws-chevron{display:inline-flex}
.fm-wb-ws-row:hover .fm-wb-ws-folder{display:none}
.fm-wb-arrow{transition:transform .15s var(--ds-ease-in-out, ease)}
.fm-wb-arrow-open{transform:rotate(90deg)}
.fm-wb-drop-before::before,.fm-wb-drop-after::after{
  content:"";position:absolute;left:6px;right:6px;height:2px;border-radius:1px;
  background:var(--dsw-alias-state-business-primary);pointer-events:none;z-index:2
}
.fm-wb-drop-before::before{top:-1px}
.fm-wb-drop-after::after{bottom:-1px}
/* 运行中会话状态点的呼吸脉冲（与官方 StateDot ongoing 的活跃暗示一致）。 */
@keyframes fm-wb-dot-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.fm-wb-dot-running{animation:fm-wb-dot-pulse 1.2s ease-in-out infinite}
/* 只隐藏宿主原生“新会话”大按钮（保留 DeepSeek logo/brand 按钮）。 */
button.hHd-Xa_newSession,
button[class*="newSession"],
[role="button"].hHd-Xa_newSession,
[role="button"][class*="newSession"]{display:none!important}
/* 压缩原生 logo 区，避免遮挡工作沙盒按钮 */
.hHd-Xa_logoRow{height:40px!important;margin-bottom:4px!important;padding:4px 0 4px 4px!important}
/* 顶部侧栏收起键：宽态/收起态都显示双箭头（收起态为右箭头，不再显示鲸鱼） */
button.hHd-Xa_toggle .hHd-Xa_panelIcon,
button.hHd-Xa_toggle .hHd-Xa_railFish{display:none!important}
.hHd-Xa_root:not(.hHd-Xa_collapsed) button.hHd-Xa_toggle{position:relative}
.hHd-Xa_root:not(.hHd-Xa_collapsed) button.hHd-Xa_toggle::before{
  content:"";position:absolute;left:50%;top:50%;width:24px;height:24px;transform:translate(-50%,-50%);
  background-color:currentColor;
  -webkit-mask:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M10 6 L5 12 L10 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M19 6 L14 12 L19 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat center/contain;
  mask:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M10 6 L5 12 L10 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M19 6 L14 12 L19 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat center/contain;
}
.hHd-Xa_root:not(.hHd-Xa_collapsed) button.hHd-Xa_toggle::after{display:none!important}
.hHd-Xa_root.hHd-Xa_collapsed button.hHd-Xa_toggle{position:relative;width:30px!important;height:30px!important;transform:translate(-1px,-2px)}
.hHd-Xa_root.hHd-Xa_collapsed button.hHd-Xa_toggle::before{
  content:"";position:absolute;left:50%;top:50%;width:24px;height:24px;transform:translate(-50%,-50%);
  background-color:currentColor;
  -webkit-mask:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M14 6 L19 12 L14 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M5 6 L10 12 L5 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat center/contain;
  mask:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M14 6 L19 12 L14 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M5 6 L10 12 L5 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat center/contain;
}
.hHd-Xa_root.hHd-Xa_collapsed button.hHd-Xa_toggle::after{display:none!important}
`;

// icon-only 操作按钮统一规格：28px 方按钮、图标绝对居中（宿主 Button 的 leading-icon
// 布局带右侧间距，icon-only 场景会视觉偏左；这里显式覆盖保证三按钮等尺寸对齐）。
export const ICON_BTN_STYLE: React.CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
};

/** 拖拽中的活动行（镜像 ui-workspace 的 drag 状态：over 记录最近一次悬停位置）。 */
interface DragState {
  kind: "workspace" | "session" | "group";
  /** workspace 拖拽 = workspaceId；session 拖拽 = sessionId；group 拖拽 = groupId。 */
  id: string;
  /** session/group 拖拽的所属工作沙盒（跨组拖拽不生效，与原生 sameGroupDrag 一致）。 */
  workspaceId?: string;
  /** session 拖拽所属分组；用于限制同组内排序、跨组时只能 drop 到分组行。 */
  groupId?: string;
  over: { id: string; half: "before" | "after" } | null;
}

/** 指针在行内的上下半区（原生 rowHalf/workspaceGroupHalf 同款）：上半 → 插到行前。 */
function rowHalf(e: React.DragEvent): "before" | "after" {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

export function WorkspaceBrowser(props: WorkspaceBrowserProps) {
  const { useSessions, useWorkspaces } = props;
  // 渲染路径全防御（根因修复）：store 未就绪 / 拖拽重排后投影中间态可能让 items / byId /
  // archivedSessionIds 为 undefined，统一降级为空集合，保证渲染与 commitDrag 永不抛错
  // （原：items undefined → workspaces.length 崩；byId undefined → sessions[id] 崩）。
  const workspaces = useWorkspaces((s) => s.items) ?? [];
  const archived = useWorkspaces((s) => s.archivedSessionIds) ?? [];
  const sessions = useSessions((s) => s.byId) ?? {};
  const current = useSessions((s) => s.current);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed());
  const [groupsByWorkspace, setGroupsByWorkspace] = useState<Record<string, SessionGroups>>({});
  const [groupsVersions, setGroupsVersions] = useState<Record<string, unknown>>({});
  const [groupsErrors, setGroupsErrors] = useState<Record<string, string>>({});
  const [groupsLoaded, setGroupsLoaded] = useState<Record<string, boolean>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  // 长按拖拽：把会话拖到分组标签上移动/组内排序（替代“移动到分组”按钮）
  const [sessionDrag, setSessionDrag] = useState<null | { workspaceId: string; sessionId: string; groupId: string }>(null);
  const [dropGroupId, setDropGroupId] = useState<string | null>(null);
  const [dropSessionId, setDropSessionId] = useState<string | null>(null);
  const [dropSessionHalf, setDropSessionHalf] = useState<"before" | "after" | null>(null);
  const dropGroupIdRef = useRef<string | null>(null);
  const dropSessionIdRef = useRef<string | null>(null);
  const dropSessionHalfRef = useRef<"before" | "after" | null>(null);
  const sessionDragRef = useRef<null | { workspaceId: string; sessionId: string; groupId: string }>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null);
  const longPressElement = useRef<HTMLElement | null>(null);
  const longPressPointerId = useRef<number | null>(null);
  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressOrigin.current = null;
    dropSessionIdRef.current = null;
    dropSessionHalfRef.current = null;
    setDropSessionId(null);
    setDropSessionHalf(null);
    const el = longPressElement.current;
    const pid = longPressPointerId.current;
    longPressElement.current = null;
    longPressPointerId.current = null;
    if (el && pid !== null) {
      try { el.releasePointerCapture(pid); } catch { /* ignore */ }
    }
  };
  const startSessionLongPress = (e: React.PointerEvent, workspaceId: string, sessionId: string) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    clearLongPress();
    sessionDragRef.current = null;
    longPressElement.current = e.currentTarget as HTMLElement;
    longPressPointerId.current = e.pointerId;
    longPressOrigin.current = { x: e.clientX, y: e.clientY };
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      const dragInfo = {
        workspaceId,
        sessionId,
        groupId: groupOfSession(groupsForWorkspace(workspaceId), sessionId),
      };
      sessionDragRef.current = dragInfo;
      setSessionDrag(dragInfo);
      setDropGroupId(null);
      dropGroupIdRef.current = null;
      dropSessionIdRef.current = null;
      dropSessionHalfRef.current = null;
      setDropSessionId(null);
      setDropSessionHalf(null);
      // 捕获指针，保证拖出会话行后仍能收到 move/up 事件
      try {
        longPressElement.current?.setPointerCapture(longPressPointerId.current!);
      } catch { /* ignore */ }
    }, 150);
  };
  const updateSessionLongPress = (e: React.PointerEvent) => {
    const origin = longPressOrigin.current;
    // 长按尚未触发：移动超过阈值就取消（避免误触）
    const activeDrag = sessionDragRef.current;
    if (!activeDrag && origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 8) {
      clearLongPress();
      return;
    }
    // 长按已触发：移动用于拖拽到分组，或在同一分组内拖拽排序
    if (!activeDrag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const groupEl = el?.closest?.("[data-group-id]") as HTMLElement | null;
    const gid = groupEl?.getAttribute("data-group-id") ?? null;
    dropGroupIdRef.current = gid;
    setDropGroupId(gid);

    // 同一分组内：记录当前悬停的会话行和插入位置（上/下半）。
    const sessionEl = el?.closest?.("[data-session-id]") as HTMLElement | null;
    const sid = sessionEl?.getAttribute("data-session-id") ?? null;
    if (sid && sid !== activeDrag.sessionId && gid === activeDrag.groupId && sessionEl) {
      const rect = sessionEl.getBoundingClientRect();
      const half: "before" | "after" = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      dropSessionIdRef.current = sid;
      dropSessionHalfRef.current = half;
      setDropSessionId(sid);
      setDropSessionHalf(half);
    } else {
      dropSessionIdRef.current = null;
      dropSessionHalfRef.current = null;
      setDropSessionId(null);
      setDropSessionHalf(null);
    }
  };
  const endSessionLongPress = () => {
    // 先保存拖拽目标，再 clearLongPress（clear 会清空这些 ref）。
    const targetGroup = dropGroupIdRef.current;
    const targetSession = dropSessionIdRef.current;
    const targetHalf = dropSessionHalfRef.current;
    clearLongPress();
    const activeDrag = sessionDragRef.current ?? sessionDrag;
    if (activeDrag) {
      if (targetGroup && targetGroup !== activeDrag.groupId) {
        moveSessionAndSave(activeDrag.workspaceId, activeDrag.sessionId, targetGroup);
      } else {
        // 同一分组内排序：根据悬停目标行计算 beforeId，再统一交给 reorderSessionInSameGroup。
        if (targetSession && targetSession !== activeDrag.sessionId) {
          const w = workspaces.find((x) => x.workspaceId === activeDrag.workspaceId);
          if (w) {
            const visible = visibleSessionsForGroup(
              groupsForWorkspace(activeDrag.workspaceId),
              activeDrag.groupId,
              (w.sessionIds ?? []).filter((id) => !archived.includes(id)),
            );
            const targetIndex = visible.indexOf(targetSession);
            const sourceIndex = visible.indexOf(activeDrag.sessionId);
            if (targetIndex !== -1 && sourceIndex !== -1) {
              const beforeId = targetHalf === "before"
                ? targetSession
                : visible[targetIndex + 1];
              if (beforeId !== activeDrag.sessionId) {
                reorderSessionInSameGroup(activeDrag.workspaceId, activeDrag.sessionId, activeDrag.groupId, beforeId);
              }
            }
          }
        }
      }
      sessionDragRef.current = null;
      setSessionDrag(null);
      setDropGroupId(null);
      dropGroupIdRef.current = null;
      dropSessionIdRef.current = null;
      dropSessionHalfRef.current = null;
    }
  };
  const groupsVersionsRef = useRef<Record<string, unknown>>({});
  const pendingMutations = useRef<Record<string, Array<{ mutate: (data: SessionGroups) => SessionGroups; onSuccess?: () => void }>>>({});
  const groupsDiskRef = useRef<Record<string, SessionGroups>>({});
  const flushing = useRef<Record<string, boolean>>({});
  // 用于识别“真正的新会话”：首次渲染只记录，后续出现的新 sessionId 才自动归入当前选中分组。
  const knownSessionIds = useRef<Record<string, Set<string>>>({});
  // 一句话标注（annotations.json）状态：每个工作沙盒独立读写，权威副本始终在磁盘。
  const [annotationsByWorkspace, setAnnotationsByWorkspace] = useState<Record<string, AnnotationData>>({});
  const [annotationsVersions, setAnnotationsVersions] = useState<Record<string, unknown>>({});
  const [annotationsErrors, setAnnotationsErrors] = useState<Record<string, string>>({});
  const [annotationsLoaded, setAnnotationsLoaded] = useState<Record<string, boolean>>({});
  const annotationsVersionsRef = useRef<Record<string, unknown>>({});
  const annotationsDiskRef = useRef<Record<string, AnnotationData>>({});
  const annotationsPending = useRef<Record<string, Array<{ mutate: (data: AnnotationData) => AnnotationData }>>>({});
  const annotationsFlushing = useRef<Record<string, boolean>>({});
  // 已自动生成过简述的会话（避免反复写盘）。
  const autoBriefedRef = useRef<Set<string>>(new Set());
  // 统计每个会话的完成轮次（running true→false 记一次交互），用于“四次交互后生成简介”。
  const interactionCounts = useRef<Record<string, number>>({});
  const lastRunning = useRef<Record<string, boolean>>({});
  const summaryRequested = useRef<Set<string>>(new Set());
  // 沙盒管家交互状态。
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [organizeLoading, setOrganizeLoading] = useState(false);
  const [organizeApplying, setOrganizeApplying] = useState(false);
  const [organizeError, setOrganizeError] = useState<string | null>(null);
  const [organizeItems, setOrganizeItems] = useState<OrganizeDiffItem[]>([]);
  const [resummarizingAll, setResummarizingAll] = useState(false);

  const workspaceById = (id: string) => workspaces.find((x) => x.workspaceId === id);
  const apiForWorkspace = (id: string) => {
    const w = workspaceById(id);
    return w ? new Api(w.path) : null;
  };
  const groupsForWorkspace = (id: string) => groupsByWorkspace[id] ?? emptyGroups();
  const annotationsForWorkspace = (id: string) => annotationsByWorkspace[id] ?? emptyAnnotations();
  // 更新 annotations.json：立即乐观更新本地状态，再串行写盘（按工作沙盒排队）。
  // 首次写入前会重读磁盘，避免覆盖已存在的 annotations.json。
  const flushAnnotations = async (workspaceId: string) => {
    const api = apiForWorkspace(workspaceId);
    if (!api) return;
    while ((annotationsPending.current[workspaceId]?.length ?? 0) > 0) {
      const batch = annotationsPending.current[workspaceId] ?? [];
      annotationsPending.current[workspaceId] = [];
      const base = annotationsDiskRef.current[workspaceId] ?? emptyAnnotations();
      const desired = batch.reduce((acc, item) => item.mutate(acc), base);
      setAnnotationsByWorkspace((m) => ({ ...m, [workspaceId]: desired }));
      try {
        let version = annotationsVersionsRef.current[workspaceId];
        if (version === undefined) {
          // 首次写入前先重读，避免覆盖已有文件
          const loaded = await loadAnnotations(api);
          version = loaded.version;
          annotationsDiskRef.current[workspaceId] = loaded.data;
          annotationsVersionsRef.current[workspaceId] = version;
          setAnnotationsVersions((m) => ({ ...m, [workspaceId]: version }));
          const merged = batch.reduce((acc, item) => item.mutate(acc), loaded.data);
          setAnnotationsByWorkspace((m) => ({ ...m, [workspaceId]: merged }));
          const saved = await saveAnnotations(api, merged, version);
          annotationsDiskRef.current[workspaceId] = merged;
          annotationsVersionsRef.current[workspaceId] = saved;
          setAnnotationsVersions((m) => ({ ...m, [workspaceId]: saved }));
          continue;
        }
        const saved = await saveAnnotations(api, desired, version);
        annotationsDiskRef.current[workspaceId] = desired;
        annotationsVersionsRef.current[workspaceId] = saved;
        setAnnotationsVersions((m) => ({ ...m, [workspaceId]: saved }));
        setAnnotationsErrors((m) => {
          const next = { ...m };
          delete next[workspaceId];
          return next;
        });
      } catch (e: unknown) {
        const isConflict =
          (e as { status?: number; code?: string })?.status === 409 ||
          (e as { code?: string })?.code === "FS_STALE_VERSION" ||
          (e as { code?: string })?.code === "CONFLICT";
        setAnnotationsErrors((m) => ({ ...m, [workspaceId]: describeApiError(e as unknown as ApiError) }));
        try {
          const loaded = await loadAnnotations(api);
          annotationsDiskRef.current[workspaceId] = loaded.data;
          annotationsVersionsRef.current[workspaceId] = loaded.version;
          setAnnotationsVersions((m) => ({ ...m, [workspaceId]: loaded.version }));
          if (isConflict) {
            const merged = batch.reduce((acc, item) => item.mutate(acc), loaded.data);
            setAnnotationsByWorkspace((m) => ({ ...m, [workspaceId]: merged }));
            const saved = await saveAnnotations(api, merged, loaded.version);
            annotationsDiskRef.current[workspaceId] = merged;
            annotationsVersionsRef.current[workspaceId] = saved;
            setAnnotationsVersions((m) => ({ ...m, [workspaceId]: saved }));
          } else {
            setAnnotationsByWorkspace((m) => ({ ...m, [workspaceId]: loaded.data }));
          }
        } catch {
          // 保持本地乐观值，下次编辑再尝试写盘。
        }
      }
    }
  };
  const updateAnnotations = (workspaceId: string, mutate: (data: AnnotationData) => AnnotationData) => {
    const api = apiForWorkspace(workspaceId);
    if (!api) return;
    const base = annotationsDiskRef.current[workspaceId] ?? annotationsForWorkspace(workspaceId);
    const next = mutate(base);
    annotationsDiskRef.current[workspaceId] = next;
    setAnnotationsByWorkspace((m) => ({ ...m, [workspaceId]: next }));
    (annotationsPending.current[workspaceId] ??= []).push({ mutate });
    if (!annotationsFlushing.current[workspaceId]) {
      annotationsFlushing.current[workspaceId] = true;
      void flushAnnotations(workspaceId).finally(() => { annotationsFlushing.current[workspaceId] = false; }).catch(() => {});
    }
  };
  const workspaceKey = workspaces.map((w) => `${w.workspaceId}:${w.path}`).join("|");
  // 当前选中的分组：新会话默认进入该分组；默认分组 id 作为兜底。
  const [selectedGroupByWorkspace, setSelectedGroupByWorkspace] = useState<Record<string, string>>({});
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const selectedGroupForWorkspace = (workspaceId: string) =>
    selectedGroupByWorkspace[workspaceId] ?? DEFAULT_GROUP_ID;
  const selectGroup = (workspaceId: string, groupId: string) => {
    setActiveWorkspaceId(workspaceId);
    setSelectedGroupByWorkspace((m) => ({ ...m, [workspaceId]: groupId }));
  };
  const activeWorkspaceForNewChat = () => {
    if (activeWorkspaceId) return activeWorkspaceId;
    const currentWorkspace = workspaces.find((w) => (w.sessionIds ?? []).includes(current ?? ""));
    return currentWorkspace?.workspaceId ?? workspaces[0]?.workspaceId;
  };

  const flushWorkspace = async (workspaceId: string) => {
    const api = apiForWorkspace(workspaceId);
    if (!api) return;
    while ((pendingMutations.current[workspaceId]?.length ?? 0) > 0) {
      const batch = pendingMutations.current[workspaceId] ?? [];
      pendingMutations.current[workspaceId] = [];
      const base = groupsDiskRef.current[workspaceId] ?? groupsForWorkspace(workspaceId);
      const desired = replayMutations(base, batch.map((x) => x.mutate));
      setGroupsByWorkspace((m) => ({ ...m, [workspaceId]: desired }));
      try {
        let version = groupsVersionsRef.current[workspaceId];
        if (version === undefined) {
          // 首次写入前先重读，避免覆盖已存在的文件
          const loaded = await loadGroups(api);
          version = loaded.version;
          groupsDiskRef.current[workspaceId] = loaded.data;
          groupsVersionsRef.current[workspaceId] = version;
          setGroupsVersions((m) => ({ ...m, [workspaceId]: version }));
          const merged = replayMutations(loaded.data, batch.map((x) => x.mutate));
          setGroupsByWorkspace((m) => ({ ...m, [workspaceId]: merged }));
          const saved = await saveGroups(api, merged, version);
          groupsDiskRef.current[workspaceId] = merged;
          groupsVersionsRef.current[workspaceId] = saved;
          setGroupsVersions((m) => ({ ...m, [workspaceId]: saved }));
          for (const item of batch) item.onSuccess?.();
          continue;
        }
        const saved = await saveGroups(api, desired, version);
        groupsDiskRef.current[workspaceId] = desired;
        groupsVersionsRef.current[workspaceId] = saved;
        setGroupsVersions((m) => ({ ...m, [workspaceId]: saved }));
        for (const item of batch) item.onSuccess?.();
      } catch (e: any) {
        const isConflict = e?.status === 409 || e?.code === "FS_STALE_VERSION" || e?.code === "CONFLICT";
        try {
          const loaded = await loadGroups(api);
          groupsDiskRef.current[workspaceId] = loaded.data;
          groupsVersionsRef.current[workspaceId] = loaded.version;
          setGroupsVersions((m) => ({ ...m, [workspaceId]: loaded.version }));
          if (isConflict) {
            const merged = replayMutations(loaded.data, batch.map((x) => x.mutate));
            setGroupsByWorkspace((m) => ({ ...m, [workspaceId]: merged }));
            const saved = await saveGroups(api, merged, loaded.version);
            groupsDiskRef.current[workspaceId] = merged;
            groupsVersionsRef.current[workspaceId] = saved;
            setGroupsVersions((m) => ({ ...m, [workspaceId]: saved }));
            for (const item of batch) item.onSuccess?.();
            continue;
          }
          setGroupsByWorkspace((m) => ({ ...m, [workspaceId]: loaded.data }));
        } catch {
          setGroupsByWorkspace((m) => ({ ...m, [workspaceId]: groupsDiskRef.current[workspaceId] ?? groupsForWorkspace(workspaceId) }));
        }
        window.alert(`保存分组失败：${describeApiError(e as unknown as ApiError)}`);
      }
    }
  };

  const enqueueGroupSave = (
    workspaceId: string,
    mutate: (data: SessionGroups) => SessionGroups,
    onSuccess?: () => void,
  ) => {
    const api = apiForWorkspace(workspaceId);
    if (!api) { window.alert("无法定位工作沙盒"); return false; }
    if (!groupsLoaded[workspaceId]) { window.alert("分组尚未加载完成，请稍后重试"); return false; }
    (pendingMutations.current[workspaceId] ??= []).push({ mutate, onSuccess });
    if (!flushing.current[workspaceId]) {
      flushing.current[workspaceId] = true;
      void flushWorkspace(workspaceId).finally(() => { flushing.current[workspaceId] = false; }).catch(() => {});
    }
    return true;
  };

  React.useEffect(() => {
    let cancelled = false;
    for (const w of workspaces) {
      const api = new Api(w.path);
      loadGroups(api)
        .then(({ data, version }) => {
          if (cancelled) return;
          groupsVersionsRef.current[w.workspaceId] = version;
          groupsDiskRef.current[w.workspaceId] = data;
          setGroupsByWorkspace((m) => ({ ...m, [w.workspaceId]: data }));
          setGroupsVersions((m) => ({ ...m, [w.workspaceId]: version }));
          setGroupsLoaded((m) => ({ ...m, [w.workspaceId]: true }));
          setGroupsErrors((m) => {
            const next = { ...m };
            delete next[w.workspaceId];
            return next;
          });
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setGroupsErrors((m) => ({ ...m, [w.workspaceId]: describeApiError(e as unknown as ApiError) }));
          groupsDiskRef.current[w.workspaceId] = emptyGroups();
          setGroupsByWorkspace((m) => ({ ...m, [w.workspaceId]: emptyGroups() }));
          setGroupsLoaded((m) => ({ ...m, [w.workspaceId]: true }));
        });
    }
    return () => { cancelled = true; };
  }, [workspaceKey]);

  // 一句话标注加载：每个工作沙盒独立读 .myagent/annotations.json；损坏/缺失按空标注初始化。
  React.useEffect(() => {
    let cancelled = false;
    for (const w of workspaces) {
      const api = new Api(w.path);
      loadAnnotations(api)
        .then(({ data, version }) => {
          if (cancelled) return;
          annotationsVersionsRef.current[w.workspaceId] = version;
          annotationsDiskRef.current[w.workspaceId] = data;
          setAnnotationsByWorkspace((m) => ({ ...m, [w.workspaceId]: data }));
          setAnnotationsVersions((m) => ({ ...m, [w.workspaceId]: version }));
          setAnnotationsLoaded((m) => ({ ...m, [w.workspaceId]: true }));
          setAnnotationsErrors((m) => {
            const next = { ...m };
            delete next[w.workspaceId];
            return next;
          });
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setAnnotationsErrors((m) => ({ ...m, [w.workspaceId]: describeApiError(e as unknown as ApiError) }));
          annotationsDiskRef.current[w.workspaceId] = emptyAnnotations();
          setAnnotationsByWorkspace((m) => ({ ...m, [w.workspaceId]: emptyAnnotations() }));
          setAnnotationsLoaded((m) => ({ ...m, [w.workspaceId]: true }));
        });
    }
    return () => { cancelled = true; };
  }, [workspaceKey]);

  // 新会话自动归入当前选中的分组（仅对“首次出现”的 sessionId 生效，避免把手动移回默认分组的会话再拉走）。
  const workspaceSessionsKey = workspaces
    .map((w) => `${w.workspaceId}:${(w.sessionIds ?? []).join(",")}`)
    .join("|");
  React.useEffect(() => {
    for (const w of workspaces) {
      const visible = (w.sessionIds ?? []).filter((id) => !archived.includes(id));
      const known = knownSessionIds.current[w.workspaceId];
      if (!known) {
        knownSessionIds.current[w.workspaceId] = new Set(visible);
        continue;
      }
      const nextKnown = new Set(known);
      for (const id of visible) nextKnown.add(id);
      const targetGroupId = selectedGroupForWorkspace(w.workspaceId);
      if (targetGroupId !== DEFAULT_GROUP_ID && groupsLoaded[w.workspaceId]) {
        const data = groupsForWorkspace(w.workspaceId);
        for (const id of visible) {
          if (!known.has(id) && groupOfSession(data, id) === DEFAULT_GROUP_ID) {
            enqueueGroupSave(w.workspaceId, (d) => moveSessionToGroup(d, id, targetGroupId));
          }
        }
      }
      knownSessionIds.current[w.workspaceId] = nextKnown;
    }
  }, [workspaceSessionsKey, selectedGroupByWorkspace, groupsLoaded]);

  // 统计真实交互次数：每次 running true→false 视为完成一轮交互。
  React.useEffect(() => {
    for (const [id, s] of Object.entries(sessions)) {
      const running = !!s?.running;
      const prev = lastRunning.current[id];
      if (prev === true && !running) {
        interactionCounts.current[id] = (interactionCounts.current[id] ?? 0) + 1;
      }
      lastRunning.current[id] = running;
    }
  }, [sessions]);

  // 新对话达到 4 次交互后，调用宿主生成真实一句话简介（不再用标题占位）。
  React.useEffect(() => {
    for (const w of workspaces) {
      if (!annotationsLoaded[w.workspaceId]) continue;
      const ann = annotationsForWorkspace(w.workspaceId);
      for (const id of (w.sessionIds ?? [])) {
        const s = sessions[id];
        const title = s?.title;
        if (!title) continue;
        const key = `${w.workspaceId}:${id}`;
        const rec = ann.sessions[id];
        if (rec && rec.brief.trim()) {
          autoBriefedRef.current.add(key);
          continue;
        }
        if (autoBriefedRef.current.has(key) || summaryRequested.current.has(key)) continue;
        const count = interactionCounts.current[id] ?? 0;
        if (count < 4) continue;
        autoBriefedRef.current.add(key);
        summaryRequested.current.add(key);
        void (async () => {
          try {
            const res = await new Api("").sessionSummary(id);
            if (res.ok && res.data?.ready && res.data.brief) {
              updateAnnotations(w.workspaceId, (d) => setSessionBrief(d, id, title, res.data.brief!));
            }
          } catch {
            // 失败不阻塞；下次刷新可再尝试（已加入 summaryRequested 则本会话内不重试）。
          }
        })();
      }
    }
  }, [workspaceSessionsKey, annotationsLoaded, sessions]);

  React.useEffect(() => {
    const ids = new Set(workspaces.map((w) => w.workspaceId));
    setGroupsErrors((m) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    setGroupsByWorkspace((m) => {
      const next: Record<string, SessionGroups> = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    setGroupsVersions((m) => {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    setGroupsLoaded((m) => {
      const next: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    for (const k of Object.keys(groupsVersionsRef.current)) if (!ids.has(k)) delete groupsVersionsRef.current[k];
    for (const k of Object.keys(pendingMutations.current)) if (!ids.has(k)) delete pendingMutations.current[k];
    for (const k of Object.keys(groupsDiskRef.current)) if (!ids.has(k)) delete groupsDiskRef.current[k];
    for (const k of Object.keys(flushing.current)) if (!ids.has(k)) delete flushing.current[k];
    for (const k of Object.keys(knownSessionIds.current)) if (!ids.has(k)) delete knownSessionIds.current[k];
    setAnnotationsErrors((m) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    setAnnotationsByWorkspace((m) => {
      const next: Record<string, AnnotationData> = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    setAnnotationsVersions((m) => {
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    setAnnotationsLoaded((m) => {
      const next: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    for (const k of Object.keys(annotationsVersionsRef.current)) if (!ids.has(k)) delete annotationsVersionsRef.current[k];
    for (const k of Object.keys(annotationsDiskRef.current)) if (!ids.has(k)) delete annotationsDiskRef.current[k];
    for (const k of Object.keys(annotationsPending.current)) if (!ids.has(k)) delete annotationsPending.current[k];
    for (const k of Object.keys(annotationsFlushing.current)) if (!ids.has(k)) delete annotationsFlushing.current[k];
    for (const k of Array.from(autoBriefedRef.current)) {
      const wsId = k.split(":")[0];
      if (!ids.has(wsId)) autoBriefedRef.current.delete(k);
    }
    for (const k of Array.from(summaryRequested.current)) {
      const wsId = k.split(":")[0];
      if (!ids.has(wsId)) summaryRequested.current.delete(k);
    }
  }, [workspaceKey]);
  const [groupAction, setGroupAction] = useState<
    | { kind: "create"; workspaceId: string }
    | { kind: "rename"; workspaceId: string; groupId: string; name: string; brief?: string }
    | { kind: "delete"; workspaceId: string; groupId: string; name: string }
    | null
  >(null);
  const [renameTarget, setRenameTarget] = useState<null | { kind: "workspace" | "session"; id: string; title: string; brief?: string; workspaceId: string }>(null);
  const [resummarizingTitle, setResummarizingTitle] = useState(false);
  const [resummarizingBrief, setResummarizingBrief] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<null | { kind: "workspace" | "session"; id: string; title: string }>(null);
  const [groupCollapsed, setGroupCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(GROUP_COLLAPSED_KEY);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  });
  const toggleGroup = (workspaceId: string, groupId: string) => {
    const key = `${workspaceId}:${groupId}`;
    setGroupCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const expandGroup = (workspaceId: string, groupId: string) => {
    const key = `${workspaceId}:${groupId}`;
    setGroupCollapsed((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };
  const handleNewChat = () => {
    const wsId = activeWorkspaceForNewChat();
    if (!wsId) {
      void Promise.resolve().then(() => props.startSession?.()).catch((e) => window.alert(`操作失败：${e?.message ?? String(e)}`));
      return;
    }
    const gid = selectedGroupForWorkspace(wsId);
    if (gid !== DEFAULT_GROUP_ID) expandGroup(wsId, gid);
    void Promise.resolve().then(() => props.startSession?.(wsId)).catch((e) => window.alert(`操作失败：${e?.message ?? String(e)}`));
  };

  // 沙盒管家：收集当前全部工作沙盒树 + 标注，生成建议并切换到差异交互框。
  const collectSnapshot = (): OrganizerSnapshot => ({
    workspaces: workspaces.map((w) => {
      // 优先读磁盘 ref（重新整理前会 reload），确保拿到最新简介/标题/分组。
      const wsGroups = groupsDiskRef.current[w.workspaceId] ?? groupsForWorkspace(w.workspaceId);
      const ann = annotationsDiskRef.current[w.workspaceId] ?? annotationsForWorkspace(w.workspaceId);
      // 默认只整理未归档、未删除的可见会话；归档/删除的会话不进快照。
      const visible = (w.sessionIds ?? []).filter((id) => !archived.includes(id));
      const groups: OrganizerWorkspace["groups"] = [
        {
          id: DEFAULT_GROUP_ID,
          name: wsGroups.defaultGroup.name,
          brief: ann.groups[DEFAULT_GROUP_ID]?.brief ?? "",
          sessionIds: visibleSessionsForGroup(wsGroups, DEFAULT_GROUP_ID, visible),
        },
        ...wsGroups.groups.map((g) => ({
          id: g.id,
          name: g.name,
          brief: ann.groups[g.id]?.brief ?? "",
          sessionIds: visibleSessionsForGroup(wsGroups, g.id, visible),
        })),
      ];
      return {
        id: w.workspaceId,
        title: w.title ?? w.path ?? w.workspaceId,
        brief: ann.workspaces[w.workspaceId]?.brief ?? "",
        defaultGroupName: wsGroups.defaultGroup.name,
        groups,
        sessions: visible.map((id) => {
          const s = sessions[id];
          return {
            id,
            title: ann.sessions[id]?.title || s?.title || id,
            brief: ann.sessions[id]?.brief ?? "",
          };
        }),
      };
    }),
  });

  // 等待指定工作沙盒的分组写入队列排空（最多 5 秒）。
  const waitForGroupFlush = async (workspaceIds: string[]) => {
    for (let i = 0; i < 100; i++) {
      if (workspaceIds.every((id) => !flushing.current[id])) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  // 整理应用后重新从磁盘加载分组与标注，确保工作沙盒空间立即反映最新结果。
  const reloadGroupsAndAnnotations = async () => {
    await Promise.all(workspaces.map(async (w) => {
      const api = new Api(w.path);
      try {
        const [groups, annotations] = await Promise.all([
          loadGroups(api),
          loadAnnotations(api),
        ]);
        groupsVersionsRef.current[w.workspaceId] = groups.version;
        groupsDiskRef.current[w.workspaceId] = groups.data;
        setGroupsByWorkspace((m) => ({ ...m, [w.workspaceId]: groups.data }));
        setGroupsVersions((m) => ({ ...m, [w.workspaceId]: groups.version }));
        annotationsVersionsRef.current[w.workspaceId] = annotations.version;
        annotationsDiskRef.current[w.workspaceId] = annotations.data;
        setAnnotationsByWorkspace((m) => ({ ...m, [w.workspaceId]: annotations.data }));
        setAnnotationsVersions((m) => ({ ...m, [w.workspaceId]: annotations.version }));
        setGroupsErrors((m) => {
          const next = { ...m };
          delete next[w.workspaceId];
          return next;
        });
        setAnnotationsErrors((m) => {
          const next = { ...m };
          delete next[w.workspaceId];
          return next;
        });
      } catch {
        // 单个工作沙盒刷新失败不阻塞其它沙盒。
      }
    }));
  };

  const handleResummarizeAll = async () => {
    setResummarizingAll(true);
    try {
      const sessionToWs = new Map<string, string>();
      const sessions: Array<{ id: string }> = [];
      for (const w of workspaces) {
        const visible = (w.sessionIds ?? []).filter((id) => !archived.includes(id));
        for (const id of visible) {
          if (!sessionToWs.has(id)) sessionToWs.set(id, w.workspaceId);
          sessions.push({ id });
        }
      }
      if (sessions.length === 0) return;
      const res = await new Api("").resummarizeAll(sessions);
      if (res.ok && res.data?.updates) {
        for (const u of res.data.updates) {
          if (!u.title && !u.brief) continue;
          const wsId = sessionToWs.get(u.sessionId);
          if (!wsId) continue;
          if (u.title) props.renameSession?.(u.sessionId, u.title);
          const current = annotationsForWorkspace(wsId).sessions[u.sessionId];
          const nextTitle = u.title ?? current?.title ?? u.sessionId;
          const nextBrief = u.brief ?? current?.brief ?? "";
          if (u.title || u.brief) {
            updateAnnotations(wsId, (d) => setSessionBrief(d, u.sessionId, nextTitle, nextBrief));
          }
        }
        await reloadGroupsAndAnnotations();
      } else if (!res.ok) {
        window.alert(`重新总结失败：${res.message}`);
      } else {
        window.alert("重新总结失败：返回数据为空");
      }
    } catch (e) {
      window.alert(`重新总结失败：${(e as Error)?.message ?? String(e)}`);
    } finally {
      setResummarizingAll(false);
    }
  };

  const handleOrganize = async () => {
    // 先切到差异交互框并显示“整理中”，避免请求 agent 期间看起来像“点了没反应”。
    setOrganizeOpen(true);
    setOrganizeLoading(true);
    setOrganizeError(null);
    try {
      // 重新整理前先从磁盘重新读取当前分组与简介/标题，确保发给独立 agent 的是最新快照。
      await reloadGroupsAndAnnotations();
      const snapshot = collectSnapshot();
      const localPlan = buildOrganizePlan(snapshot);
      let plan = localPlan;
      // 优先请求宿主侧的常驻整理员 agent；不可用时使用本地确定性整理器。
      try {
        const res = await new Api("").organizePlan(snapshot);
        if (res.ok && res.data?.plan && Array.isArray(res.data.plan.actions)) {
          const agentPlan = normalizeOrganizePlan(res.data.plan);
          // 合并 agent 建议与本地修正（如纠正旧版错误简介产生的无意义分组名），
          // 确保即使 agent 没发现“的对”这类问题，本地修正仍会出现在建议里。
          const seen = new Set(agentPlan.actions.map((a) => organizeActionKey(a)));
          const merged = [...agentPlan.actions];
          // 补充本地“安全修正”（重命名无意义分组/删除空组/合并重名）
          // 以及“拆分宽泛分组”（g_split_ 前缀的建组/移入），
          // 不把本地粗粒度“按单个关键词建组”混进 agent 的细分结果。
          const correctiveKinds = new Set(["renameGroup", "deleteGroup", "mergeGroup"]);
          const isSplitAction = (action: OrganizeAction) =>
            (action.kind === "createGroup" && action.groupId.startsWith("g_split_")) ||
            (action.kind === "moveSession" && action.toGroupId.startsWith("g_split_"));
          for (const action of localPlan.actions) {
            if (!correctiveKinds.has(action.kind) && !isSplitAction(action)) continue;
            const key = organizeActionKey(action);
            if (!seen.has(key)) {
              merged.push(action);
              seen.add(key);
            }
          }
          plan = { actions: merged };
        }
      } catch {
        // 宿主端点不可用/网络失败：保持本地 plan。
      }
      const items = diffOrganize(snapshot, plan);
      setOrganizeItems(items);
    } catch (e: unknown) {
      setOrganizeError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrganizeLoading(false);
    }
  };

  const handleApplyOrganize = async (actions: OrganizeAction[]) => {
    setOrganizeApplying(true);
    try {
      const groupMutations: Record<string, Array<(d: SessionGroups) => SessionGroups>> = {};
      const hostMoves: Array<{ workspaceId: string; sessionId: string }> = [];
      const affected = new Set<string>();
      for (const action of actions) {
        if (!action.workspaceId) continue;
        affected.add(action.workspaceId);
        if (isGroupAction(action)) {
          (groupMutations[action.workspaceId] ??= []).push((d) => applyOrganizeActionToGroups(d, action));
          if (action.kind === "moveSession" && action.toGroupId !== DEFAULT_GROUP_ID) {
            hostMoves.push({ workspaceId: action.workspaceId, sessionId: action.sessionId });
          }
        }
      }
      for (const [workspaceId, muts] of Object.entries(groupMutations)) {
        const moves = hostMoves.filter((m) => m.workspaceId === workspaceId);
        enqueueGroupSave(workspaceId, (d) => replayMutations(d, muts), () => {
          for (const m of moves) run(() => props.insertSessionBefore?.(m.workspaceId, m.sessionId, undefined));
        });
      }
      for (const workspaceId of affected) {
        const planForWs = actions.filter((a) => a.workspaceId === workspaceId);
        updateAnnotations(workspaceId, (d) => {
          let next = applyOrganizeActionsToAnnotations(d, planForWs);
          next = setLastPlan(next, { actions: planForWs });
          next = setLastOrganizedAt(next, new Date().toISOString());
          return next;
        });
      }
      // 等待分组写入队列排空，再重新从磁盘加载分组/标注，刷新工作沙盒空间。
      await waitForGroupFlush([...affected]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await reloadGroupsAndAnnotations();
    } finally {
      setOrganizeApplying(false);
      setOrganizeOpen(false);
      setOrganizeItems([]);
    }
  };

  React.useEffect(() => {
    try { localStorage.setItem(GROUP_COLLAPSED_KEY, JSON.stringify([...groupCollapsed])); } catch { /* ignore */ }
  }, [groupCollapsed]);
  // drop 与 dragend 都会触发提交（原生 dropCommitted ref 同款防双提交）。
  const dropCommitted = useRef(false);

  // 动作统一兜底：同步抛错与 Promise 拒绝都转 alert（覆盖 Rpc 冲突如 workspace-name-conflict、
  // renameSession 的 !result.ok 抛错）。action 可选（undefined 时静默跳过）。
  const run = (action: (() => void | Promise<void>) | undefined) => {
    Promise.resolve()
      .then(() => action?.())
      .catch((e) => window.alert(`操作失败：${e?.message ?? String(e)}`));
  };

  // 统一移动会话：菜单确认与拖拽跨组 drop 共用；返回是否真正入队。
  const moveSessionAndSave = (workspaceId: string, sessionId: string, groupId: string): boolean => {
    const data = groupsForWorkspace(workspaceId);
    const currentGroup = groupOfSession(data, sessionId);
    if (currentGroup === groupId) return false;
    return enqueueGroupSave(workspaceId, (data) => moveSessionToGroup(data, sessionId, groupId), () => {
      if (groupId !== DEFAULT_GROUP_ID) {
        run(() => props.insertSessionBefore?.(workspaceId, sessionId, undefined));
      }
    });
  };

  // 在同一个分组内通过长按拖拽调整顺序：更新 groups.json 的 sessionIds 顺序，并同步宿主 flat list。
  const reorderSessionInSameGroup = (workspaceId: string, sessionId: string, groupId: string, beforeId?: string) => {
    if (groupId === DEFAULT_GROUP_ID) {
      run(() => props.insertSessionBefore?.(workspaceId, sessionId, beforeId));
      return;
    }
    enqueueGroupSave(workspaceId, (d) => reorderSessionInGroup(d, groupId, sessionId, beforeId), () => {
      run(() => props.insertSessionBefore?.(workspaceId, sessionId, beforeId));
    });
  };

  // 重新总结当前重命名会话的标题或简介。
  const handleResummarizeSession = async (mode: "title" | "brief") => {
    if (!renameTarget || renameTarget.kind !== "session") return;
    const sessionId = renameTarget.id;
    const workspaceId = renameTarget.workspaceId;
    if (mode === "title") setResummarizingTitle(true);
    else setResummarizingBrief(true);
    try {
      const res = await new Api("").sessionResummarize(sessionId, mode);
      if (res.ok) {
        const data = res.data;
        if (mode === "title" && data.title) {
          props.renameSession?.(sessionId, data.title);
          setRenameTarget((prev) => prev ? { ...prev, title: data.title! } : prev);
          updateAnnotations(workspaceId, (d) => setSessionBrief(d, sessionId, data.title!, renameTarget.brief ?? ""));
        }
        if (mode === "brief" && data.brief) {
          const nextTitle = renameTarget.title;
          updateAnnotations(workspaceId, (d) => setSessionBrief(d, sessionId, nextTitle, data.brief!));
          setRenameTarget((prev) => prev ? { ...prev, brief: data.brief! } : prev);
        }
      } else {
        window.alert(`重新总结失败：${res.message}`);
      }
    } catch (e) {
      window.alert(`重新总结失败：${(e as Error)?.message ?? String(e)}`);
    } finally {
      if (mode === "title") setResummarizingTitle(false);
      else setResummarizingBrief(false);
    }
  };

  const setCollapsedIds = (next: Set<string>) => {
    setCollapsed(next);
    writeCollapsed(next);
  };

  const expand = (workspaceId: string) => {
    if (!collapsed.has(workspaceId)) return;
    const next = new Set(collapsed);
    next.delete(workspaceId);
    setCollapsedIds(next);
  };

  const collapse = (workspaceId: string) => {
    if (collapsed.has(workspaceId)) return;
    const next = new Set(collapsed);
    next.add(workspaceId);
    setCollapsedIds(next);
  };

  // 拖拽提交：anchor 计算与原生 commitSessionDrag/commitWorkspaceDrag 一致
  // （after 最后一行 → anchor undefined → runtime "omitted appends" 追加到末尾），
  // 并带原生同款 no-op 守卫（源与目标相邻/相同不提交）。drop 与 dragend 都会触发
  // 提交，dropCommitted ref 防双提交（原生 commit*Drag 顶部同款守卫）。
  const commitDrag = (active: DragState) => {
    if (active.kind === "group") {
      setDrag(null);
      dropCommitted.current = false;
      return;
    }
    if (dropCommitted.current) return;
    dropCommitted.current = true;
    // 字段防御（根因修复）：拖拽重排刷新时 host 投影可能暂缺 sessionIds（时序问题），
    // 缺失按空列表处理，保证渲染/拖拽提交永不抛错（原：w.sessionIds.filter 直接崩溃 →
    // slots abdicate → 左栏回退原版）。
    const visibleSessionIds = (w: { sessionIds?: string[] }) => (w.sessionIds ?? []).filter((id) => !archived.includes(id));
    if (active.kind === "workspace") {
      const ids = workspaces.map((w) => w.workspaceId);
      const targetIndex = ids.indexOf(active.over?.id ?? "");
      if (targetIndex === -1) return;
      const anchor = active.over!.half === "before" ? active.over!.id : ids[targetIndex + 1];
      if (anchor === active.id) return;
      const sourceIndex = ids.indexOf(active.id);
      const anchorIndex = anchor === undefined ? ids.length : ids.indexOf(anchor);
      if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return;
      run(() => props.insertWorkspaceBefore?.(active.id, anchor));
      return;
    }
    const w = workspaces.find((x) => x.workspaceId === active.workspaceId);
    if (w === undefined) return;
    const ids = visibleSessionIds(w);
    const targetIndex = ids.indexOf(active.over?.id ?? "");
    if (targetIndex === -1) return;
    const anchor = active.over!.half === "before" ? active.over!.id : ids[targetIndex + 1];
    if (anchor === active.id) return;
    const sourceIndex = ids.indexOf(active.id);
    const anchorIndex = anchor === undefined ? ids.length : ids.indexOf(anchor);
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return;
    run(() => props.insertSessionBefore?.(active.workspaceId!, active.id, anchor));
  };

  const endDrag = (active: DragState) => {
    // 原生 dragend 语义：最后一次悬停位置（over 非空）也提交；否则只清空。
    if (active.over !== null) commitDrag(active);
    setDrag(null);
    dropCommitted.current = false;
  };

  // 拖拽期间文档级拦截：dragover/drop preventDefault，防止拖出列表时浏览器打开/导航
  // （ui-workspace useNativeDragAcceptance 同款）。
  React.useEffect(() => {
    if (drag === null) return;
    const acceptDrag = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = "move";
    };
    const acceptDrop = (e: DragEvent) => {
      e.preventDefault();
    };
    document.addEventListener("dragover", acceptDrag);
    document.addEventListener("drop", acceptDrop);
    return () => {
      document.removeEventListener("dragover", acceptDrag);
      document.removeEventListener("drop", acceptDrop);
    };
  }, [drag !== null]);

  // 窄栏（rail）模式（宿主整体 rail 用；区级折叠不再走此分支）：只渲染图标列，
  // 点击即"在该工作沙盒新建会话"。
  // onExpand 存在（外部注入）时顶部加展开按钮，折叠后仍可展开本区。
  if (!props.wide) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, paddingTop: 8 }}>
        <style>{BROWSER_CSS}</style>
        {props.onExpand ? (
          <Button size="sm" variant="ghost" icon={<IconPanelLeftOutline16 size={16} />} style={ICON_BTN_STYLE} title="展开工作沙盒" aria-label="展开工作沙盒" onClick={() => props.onExpand?.()} />
        ) : null}
        <Button size="sm" variant="ghost" icon={<IconNewChatOutline16 size={16} />} title="新对话（当前选中分组）" aria-label="新对话（当前选中分组）" data-myagent-new-chat onClick={() => handleNewChat()} />
        {workspaces.map((w) => (
          <Button key={w.workspaceId} size="sm" variant="ghost" icon={<IconFolderOpen16 size={16} />} title={w.title ?? w.path} aria-label={w.title ?? w.path} onClick={() => props.startSession?.(w.workspaceId)} />
        ))}
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div style={{ fontSize: 13, padding: 8, color: "var(--dsw-alias-label-secondary)" }}>
        暂无工作沙盒（请在宿主侧添加）
      </div>
    );
  }

  // 会话行状态点（对齐官方 ui-workspace 的状态语义，优先级从高到低）：
  //   1) 等待用户确认（pendingInteraction）：
  //        approval / plan-review → 琥珀实心点；
  //        question（问答框就绪，如 superpowers/brainstorming 提问）→ 亮黄色实心点；
  //   2) 正在运行（running）→ 蓝色实心点 + 呼吸脉冲动画；
  //   3) 已完成待读（completed，host 完成提醒位）→ 绿色实心点；
  //   4) 初始/空白（blank，provisional 新会话）→ 空心点；
  //   5) 当前会话（无其他状态）→ 蓝色实心点（选中标识，保留原视觉）；
  //   6) 其余（普通跑完/空闲）→ 灰色实心点。
  // 固定 16px 槽位保持图标列对齐；每个点带 title 提示（状态可读）。
  const statusDot = (id: string, s: SessionSummary | undefined) => {
    const dot: React.CSSProperties = {
      width: 8,
      height: 8,
      borderRadius: "50%",
      boxSizing: "border-box",
      display: "inline-block",
      flex: "none",
    };
    if (s === undefined) return null;
    if (s.pendingInteraction !== undefined) {
      const label =
        s.pendingInteraction === "approval"
          ? "等待批准"
          : s.pendingInteraction === "plan-review"
            ? "等待计划确认"
            : "等待回答";
      // 问答框（question）就绪时用醒目的黄色圆点，与批准/计划确认的琥珀色区分
      // （主题无纯黄 token，用固定亮黄 #FACC15，暗色/亮色主题下均清晰可见）。
      const color = s.pendingInteraction === "question" ? "#FACC15" : "var(--dsw-alias-state-warn-primary)";
      return <span style={{ ...dot, background: color }} title={label} />;
    }
    if (s.running) {
      return <span className="fm-wb-dot-running" style={{ ...dot, background: "var(--dsw-alias-state-business-primary)" }} title="正在运行" />;
    }
    if (s.completed) {
      return <span style={{ ...dot, background: "var(--dsw-alias-state-success-primary)" }} title="已完成" />;
    }
    if (s.blank) {
      return <span style={{ ...dot, border: "1px solid var(--dsw-alias-label-tertiary)" }} title="新会话" />;
    }
    if (id === current) {
      return <span style={{ ...dot, background: "var(--dsw-alias-state-business-primary)" }} title="当前会话" />;
    }
    return <span style={{ ...dot, background: "var(--dsw-alias-label-tertiary)" }} title="空闲" />;
  };

  const renderGroupSection = (arg: {
    workspaceId: string;
    groupId: string;
    name: string;
    sessions: string[];
  }) => {
    const wsGroups = groupsForWorkspace(arg.workspaceId);
    const isCollapsedGroup = groupCollapsed.has(`${arg.workspaceId}:${arg.groupId}`);
    const isSessionDropTarget =
      sessionDrag !== null &&
      sessionDrag.workspaceId === arg.workspaceId &&
      sessionDrag.groupId !== arg.groupId &&
      dropGroupId === arg.groupId;
    return (
      <div
        key={arg.groupId}
        data-group-id={arg.groupId}
        onPointerMove={updateSessionLongPress}
        onPointerUp={endSessionLongPress}
        onPointerCancel={endSessionLongPress}
        style={{
          position: "relative",
          ...(drag?.kind === "group" && drag.over?.id === arg.groupId
            ? { outline: "1px solid var(--dsw-alias-state-business-primary)" }
            : {}),
        }}
        onDragOver={(e) => {
          if (drag?.kind !== "group" || drag.workspaceId !== arg.workspaceId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDrag((d) => (d && d.kind === "group" ? { ...d, over: { id: arg.groupId, half: "before" } } : d));
        }}
        onDrop={(e) => {
          if (drag?.kind !== "group" || drag.workspaceId !== arg.workspaceId) return;
          e.preventDefault();
          const fromId = drag.id;
          const toId = arg.groupId;
          if (fromId === toId) return;
          enqueueGroupSave(arg.workspaceId, (data) => reorderGroups(data, fromId, toId));
          setDrag(null);
        }}
      >
        <GroupHeader
          draggable={arg.groupId !== DEFAULT_GROUP_ID}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", arg.groupId);
            setDrag({ kind: "group", id: arg.groupId, workspaceId: arg.workspaceId, over: null });
          }}
          onDragEnd={() => {
            if (drag?.kind === "group" && drag.id === arg.groupId) endDrag(drag);
          }}
          name={arg.name}
          count={arg.sessions.length}
          collapsed={isCollapsedGroup}
          selected={selectedGroupForWorkspace(arg.workspaceId) === arg.groupId}
          onToggle={() => {
            selectGroup(arg.workspaceId, arg.groupId);
            toggleGroup(arg.workspaceId, arg.groupId);
          }}
          onRename={() => setGroupAction({ kind: "rename", workspaceId: arg.workspaceId, groupId: arg.groupId, name: arg.name, brief: annotationsForWorkspace(arg.workspaceId).groups[arg.groupId]?.brief ?? "" })}
          onDelete={arg.groupId === DEFAULT_GROUP_ID ? undefined : () => setGroupAction({ kind: "delete", workspaceId: arg.workspaceId, groupId: arg.groupId, name: arg.name })}
          highlight={isSessionDropTarget}
          onSessionDragOver={(e) => {
            if (drag?.kind !== "session" || drag.workspaceId !== arg.workspaceId || drag.groupId === arg.groupId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDrag((d) => (d && d.kind === "session" ? { ...d, over: { id: arg.groupId, half: "before" } } : d));
          }}
          onSessionDrop={(e) => {
            if (drag?.kind !== "session" || drag.workspaceId !== arg.workspaceId || drag.groupId === arg.groupId) return;
            e.preventDefault();
            dropCommitted.current = true;
            moveSessionAndSave(arg.workspaceId, drag.id, arg.groupId);
            setDrag(null);
          }}
        />
        {!isCollapsedGroup
          ? arg.sessions.map((id) => {
              const s = sessions[id];
              const rec = annotationsForWorkspace(arg.workspaceId).sessions[id];
              const label = rec?.title || s?.title || (s?.blank ? "新会话" : id);
              const isDragging = sessionDrag?.sessionId === id;
              const isDropTarget = dropSessionId === id;
              const dropLine = isDropTarget && dropSessionHalf ? (dropSessionHalf === "before" ? "top" : "bottom") : null;
              return (
                <div
                  key={id}
                  role="treeitem"
                  data-session-id={id}
                  aria-selected={id === current}
                  className="fm-wb-row"
                  onPointerDown={(e) => startSessionLongPress(e, arg.workspaceId, id)}
                  style={{
                    padding: "3px 4px 3px 20px",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    position: "relative",
                    background: id === current ? "var(--dsw-alias-interactive-bg-hover)" : undefined,
                    borderRadius: 6,
                    ...(isDragging
                      ? {
                          opacity: 0.55,
                          transform: "scale(1.02)",
                          boxShadow: "0 2px 10px rgba(0,0,0,.18)",
                          willChange: "transform, opacity",
                          transition: "opacity .25s ease, transform .25s ease, box-shadow .25s ease",
                        }
                      : { transition: "opacity .25s ease" }),
                  }}
                  onClick={() => {
                    selectGroup(arg.workspaceId, groupOfSession(groupsForWorkspace(arg.workspaceId), id));
                    props.open?.(id);
                  }}
                >
                  {dropLine ? (
                    <div style={{
                      position: "absolute",
                      left: 8,
                      right: 8,
                      height: 2,
                      borderRadius: 2,
                      background: "var(--dsw-alias-state-business-primary)",
                      pointerEvents: "none",
                      zIndex: 1,
                      ...(dropLine === "top" ? { top: -2 } : { bottom: -2 }),
                      transition: "top .15s ease, bottom .15s ease, opacity .15s ease",
                    }} />
                  ) : null}
                  <span style={{ flex: "none", width: 16, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-tertiary)" }}>
                    {statusDot(id, s)}
                  </span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{label}</span>
                  <span className="fm-wb-row-actions" style={{ display: "inline-flex", gap: 2, flex: "none" }}>
                    <Button size="sm" variant="ghost" icon={<IconListPenOutline16 size={16} />} style={ICON_BTN_STYLE} title="重命名会话" aria-label="重命名会话" onClick={(e) => { e.stopPropagation(); setRenameTarget({ kind: "session", id, title: label, brief: annotationsForWorkspace(arg.workspaceId).sessions[id]?.brief ?? "", workspaceId: arg.workspaceId }); }} />
                    <Button size="sm" variant="ghost" icon={<IconArchiveOutline20 size={16} />} style={ICON_BTN_STYLE} title="归档会话" aria-label="归档会话" onClick={(e) => { e.stopPropagation(); setConfirmTarget({ kind: "session", id, title: label }); }} />
                  </span>
                </div>
              );
            })
          : null}
      </div>
    );
  };

  return (
    <div style={{ fontSize: 13, userSelect: "none", color: "var(--dsw-alias-label-primary)", height: "100%", display: "flex", flexDirection: "column" }}>
      <style>{BROWSER_CSS}</style>
      {/* 标题栏行保持侧栏黑色底，底部一条黑灰边界线与内容区区分（内容区不铺色）。
          padding-right 34：按钮组右端贴近右上角固定折叠键（fm-fold-btn，左缘距容器右 30px，
          留 4px 间隙；坐标恒定不动）。 */}
      <div style={{ flex: "none", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 34px 4px 4px", background: "var(--dsw-specific-sidebar-fill)", borderBottom: "1px solid var(--dsw-alias-border-l1)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <IconFolderOpen16 size={16} />
          工作沙盒
        </span>
        {/* 标题栏右侧按钮组：key=toolbarKey（每次展开递增 → 重挂载 → stagger 滑入动画重放，
            与区容器展开过渡同时进行）。 */}
        <span key={props.toolbarKey ?? 0} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {/* 展开过渡动画：按钮依次滑入（fm-tb-btn，延迟内联显式指定）。 */}
          {/* 沙盒管家：隐藏内容区，展示差异交互框 */}
          <Button
            className="fm-tb-btn"
            style={{ ...ICON_BTN_STYLE, animationDelay: "0ms" }}
            size="sm"
            variant="ghost"
            icon={<TopHatIcon size={16} />}
            title="沙盒管家"
            aria-label="沙盒管家"
            onClick={() => handleOrganize()}
          />
          {/* 新对话：在当前选中分组所在工作沙盒内新建，并自动归入该分组 */}
          <Button
            className="fm-tb-btn"
            style={{ ...ICON_BTN_STYLE, animationDelay: "40ms" }}
            size="sm"
            variant="ghost"
            icon={<IconNewChatOutline16 size={16} />}
            title="新对话（当前选中分组）"
            aria-label="新对话（当前选中分组）"
            data-myagent-new-chat
            onClick={() => handleNewChat()}
          />
          <Button className="fm-tb-btn" style={{ ...ICON_BTN_STYLE, animationDelay: "80ms" }} size="sm" variant="ghost" icon={<IconProjectAddOutline16 size={16} />} title="新工作沙盒" aria-label="新工作沙盒" onClick={() => run(() => props.addWorkspace?.())} />
        </span>
      </div>
      {/* 列表滚动区：滚动条上界在标题栏下方（标题栏不参与滚动）；scrollLock（区容器过渡期间）
          置 hidden 避免滚动条闪现抖动；fm-scroll 提供渐变滚动条样式。 */}
      <div
        className="fm-scroll"
        role="tree"
        aria-label="工作沙盒与会话"
        style={{ flex: 1, minHeight: 0, overflowY: props.scrollLock ? "hidden" : "auto", overflowX: "hidden", scrollbarGutter: "stable" }}
      >
        {organizeOpen ? (
          <OrganizePanel
            loading={organizeLoading}
            applying={organizeApplying}
            error={organizeError}
            items={organizeItems}
            onApply={handleApplyOrganize}
            onClose={() => setOrganizeOpen(false)}
            onRetry={handleOrganize}
            onResummarizeAll={handleResummarizeAll}
            resummarizingAll={resummarizingAll}
          />
        ) : (
          <>
        {workspaces[0] && groupsErrors[workspaces[0].workspaceId] ? (
          <div style={{ padding: "4px 8px", fontSize: 12, color: "var(--dsw-alias-state-error-primary)" }}>
            分组加载失败：{groupsErrors[workspaces[0].workspaceId]}
          </div>
        ) : null}
        {workspaces.map((w, i) => {
          const isCollapsed = collapsed.has(w.workspaceId);
          const visible = (w.sessionIds ?? []).filter((id) => !archived.includes(id));
          const wsGroups = groupsForWorkspace(w.workspaceId);
          // 工作沙盒拖拽目标 = 整组（行 + 会话区，与原生 groupSection 作为 drop 目标一致）。
          const wsMarker = drag?.kind === "workspace" && drag.over?.id === w.workspaceId ? drag.over.half : null;
          return (
            <div
              key={w.workspaceId}
              role="group"
              style={{
                position: "relative",
                marginBottom: 6,
                // 工作沙盒之间加灰色分割线；子聊天框（会话行）不加。
                ...(i > 0 ? { borderTop: "1px solid var(--dsw-alias-border-l2)" } : {}),
              }}
              className={wsMarker === "before" ? "fm-wb-drop-before" : wsMarker === "after" ? "fm-wb-drop-after" : undefined}
              onDragOver={
                drag?.kind === "workspace"
                  ? (e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      // 同步取 half：setDrag 的 updater 延迟到事件处理结束后才执行，
                      // 彼时 e.currentTarget 已被 React 清为 null（getBoundingClientRect 崩溃根因）。
                      const half = rowHalf(e);
                      setDrag((d) => (d === null || d.kind !== "workspace" ? d : { ...d, over: { id: w.workspaceId, half } }));
                    }
                  : undefined
              }
              onDrop={
                drag?.kind === "workspace"
                  ? (e) => {
                      e.preventDefault();
                      const half = rowHalf(e);
                      setDrag((d) => (d === null ? d : { ...d, over: { id: w.workspaceId, half } }));
                      commitDrag({ ...drag, over: { id: w.workspaceId, half } });
                    }
                  : undefined
              }
            >
              {/* 工作沙盒行：图标列（Folder，hover 换三角箭头）+ 标题 + hover 操作组。
                  点击整行折叠/展开；拖拽排序。 */}
              <div
                role="treeitem"
                aria-expanded={!isCollapsed}
                className="fm-wb-row fm-wb-ws-row"
                draggable
                title={w.path ?? w.workspaceId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 4px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
                onClick={() => (isCollapsed ? expand(w.workspaceId) : collapse(w.workspaceId))}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", w.workspaceId);
                  dropCommitted.current = false;
                  setDrag({ kind: "workspace", id: w.workspaceId, over: null });
                }}
                onDragEnd={() => {
                  if (drag?.kind === "workspace" && drag.id === w.workspaceId) endDrag(drag);
                }}
              >
                {/* 固定宽度图标列：Folder（展开/收起），hover 时被三角箭头替换（原生同款）。 */}
                <span className="fm-wb-ws-folder" style={{ flex: "none", width: 16, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-secondary)" }}>
                  {isCollapsed ? <IconFolderClose16 size={16} /> : <IconFolderOpen16 size={16} />}
                </span>
                <span className="fm-wb-ws-chevron" style={{ flex: "none", width: 16, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-caption)" }}>
                  <IconTriangleRightFill14 size={14} className={`fm-wb-arrow${isCollapsed ? "" : " fm-wb-arrow-open"}`} />
                </span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{w.title ?? w.path}</span>
                <span className="fm-wb-row-actions" style={{ display: "inline-flex", gap: 2, flex: "none" }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<IconPlusOutline16 size={16} />}
                    style={ICON_BTN_STYLE}
                    title="新建分组"
                    aria-label="新建分组"
                    onClick={(e) => {
                      e.stopPropagation();
                      setGroupAction({ kind: "create", workspaceId: w.workspaceId });
                    }}
                  />
                  <Button size="sm" variant="ghost" icon={<IconEditOutline16 size={16} />} style={ICON_BTN_STYLE} title="重命名工作沙盒" aria-label="重命名工作沙盒" onClick={(e) => { e.stopPropagation(); setRenameTarget({ kind: "workspace", id: w.workspaceId, title: w.title ?? w.path, brief: annotationsForWorkspace(w.workspaceId).workspaces[w.workspaceId]?.brief ?? "", workspaceId: w.workspaceId }); }} />
                  <Button size="sm" variant="ghost" icon={<IconTrashOutline16 size={16} />} style={{ ...ICON_BTN_STYLE, color: "var(--dsw-alias-state-error-primary)" }} title="删除工作沙盒" aria-label="删除工作沙盒" onClick={(e) => { e.stopPropagation(); setConfirmTarget({ kind: "workspace", id: w.workspaceId, title: w.title ?? w.path }); }} />
                </span>
              </div>
              {!isCollapsed ? (
                <>
                  {renderGroupSection({
                    workspaceId: w.workspaceId,
                    groupId: DEFAULT_GROUP_ID,
                    name: wsGroups.defaultGroup.name,
                    sessions: visibleSessionsForGroup(wsGroups, DEFAULT_GROUP_ID, visible),
                  })}
                  {wsGroups.groups.map((g) =>
                    renderGroupSection({
                      workspaceId: w.workspaceId,
                      groupId: g.id,
                      name: g.name,
                      sessions: visibleSessionsForGroup(wsGroups, g.id, visible),
                    }),
                  )}
                </>
              ) : null}
            </div>
          );
        })}
          </>
        )}
      </div>

      {renameTarget ? (
        <PromptModal
          open
          title={renameTarget.kind === "workspace" ? "重命名工作沙盒" : "重命名会话"}
          initialValue={renameTarget.title}
          placeholder={renameTarget.kind === "workspace" ? "工作沙盒名称" : "会话标题"}
          validate={(v) => validateNameInput("name", v)}
          brief={renameTarget.brief ?? ""}
          {...(renameTarget.kind === "session"
            ? {
                onResummarizeTitle: () => handleResummarizeSession("title"),
                onResummarizeBrief: () => handleResummarizeSession("brief"),
                resummarizingTitle,
                resummarizingBrief,
              }
            : {})}
          onSubmit={(t) => {
            const target = renameTarget;
            run(() => {
              if (target.kind === "session") {
                props.renameSession?.(target.id, t);
                updateAnnotations(target.workspaceId, (d) => setSessionBrief(d, target.id, t, annotationsForWorkspace(target.workspaceId).sessions[target.id]?.brief ?? ""));
              } else {
                props.renameWorkspace?.(target.id, t);
              }
            });
            setRenameTarget(null);
          }}
          onClose={() => setRenameTarget(null)}
        />
      ) : null}

      {groupAction?.kind === "create" ? (
        <PromptModal
          open
          title="新建分组"
          description="输入分组名称，例如：工作、项目A"
          placeholder="分组名称"
          initialValue=""
          validate={(v) => validateNameInput("name", v)}
          onSubmit={(name) => {
            const newGroup = createGroup(emptyGroups(), name).groups[0];
            enqueueGroupSave(groupAction.workspaceId, (data) => addGroup(data, newGroup));
            setGroupAction(null);
          }}
          onClose={() => setGroupAction(null)}
        />
      ) : null}

      {groupAction?.kind === "rename" ? (
        <PromptModal
          open
          title="重命名分组"
          description="输入新的分组名称"
          placeholder="分组名称"
          initialValue={groupAction.name}
          validate={(v) => validateNameInput("name", v)}
          brief={groupAction.brief ?? ""}
          onSubmit={(name) => {
            enqueueGroupSave(groupAction.workspaceId, (data) => renameGroup(data, groupAction.groupId, name));
            setGroupAction(null);
          }}
          onClose={() => setGroupAction(null)}
        />
      ) : null}

      {groupAction?.kind === "delete" ? (
        <GroupDeleteDialog
          groupName={groupAction.name}
          destinationOptions={groupsForWorkspace(groupAction.workspaceId).groups.filter((g) => g.id !== groupAction.groupId).map((g) => ({ id: g.id, name: g.name }))}
          onCancel={() => setGroupAction(null)}
          onConfirm={(dest) => {
            const workspaceId = groupAction.workspaceId;
            let sessionsToArchive: string[] = [];
            enqueueGroupSave(workspaceId, (data) => {
              const res = deleteGroup(data, groupAction.groupId, dest);
              sessionsToArchive = res.sessionsToArchive;
              return res.data;
            }, () => {
              for (const id of sessionsToArchive) {
                Promise.resolve()
                  .then(() => props.archiveSession?.(id))
                  .catch((err: Error) => {
                    window.alert(`分组已删除，但会话 ${id} 归档失败，请手动处理：${describeApiError(err as unknown as ApiError)}`);
                  });
              }
            });
            setGroupAction(null);
          }}
        />
      ) : null}

      {confirmTarget ? (
        <ConfirmModal
          open
          title={confirmTarget.kind === "workspace" ? `删除工作沙盒 ${confirmTarget.title}？` : `归档会话 ${confirmTarget.title}？`}
          description={confirmTarget.kind === "workspace" ? "该工作沙盒下的会话将被一并删除，此操作不可恢复。" : "归档后的会话将从当前列表中隐藏。"}
          confirmLabel={confirmTarget.kind === "workspace" ? "删除" : "归档"}
          onConfirm={() => {
            const target = confirmTarget;
            run(() => (target.kind === "workspace" ? props.deleteWorkspace?.(target.id) : props.archiveSession?.(target.id)));
            setConfirmTarget(null);
          }}
          onClose={() => setConfirmTarget(null)}
        />
      ) : null}
    </div>
  );
}

function GroupDeleteDialog(props: {
  groupName: string;
  destinationOptions: { id: string; name: string }[];
  onCancel: () => void;
  onConfirm: (destination: "default" | "archive" | string) => void;
}) {
  const [dest, setDest] = useState<"default" | "archive" | string>("default");
  return (
    <Modal
      open
      onClose={props.onCancel}
      title={`删除分组“${props.groupName}”`}
      description="组内聊天框要如何处理？"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={props.onCancel}>取消</Button>
          <Button size="sm" variant="primary" onClick={() => props.onConfirm(dest)}>确认</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="radio" checked={dest === "default"} onChange={() => setDest("default")} />
          移回默认分组
        </label>
        {props.destinationOptions.map((g) => (
          <label key={g.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="radio" checked={dest === g.id} onChange={() => setDest(g.id)} />
            移到 {g.name}
          </label>
        ))}
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="radio" checked={dest === "archive"} onChange={() => setDest("archive")} />
          归档会话
        </label>
      </div>
    </Modal>
  );
}

function GroupHeader(props: {
  name: string;
  count: number;
  collapsed: boolean;
  selected?: boolean;
  onToggle: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  highlight?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onSessionDragOver?: (e: React.DragEvent) => void;
  onSessionDrop?: (e: React.DragEvent) => void;
}) {
  return (
    <div
      role="treeitem"
      aria-expanded={!props.collapsed}
      className="fm-wb-row fm-wb-group-row"
      draggable={props.draggable}
      onClick={props.onToggle}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDragOver={props.onSessionDragOver}
      onDrop={props.onSessionDrop}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 4px 3px 12px",
        borderRadius: 6,
        cursor: "pointer",
        fontWeight: 600,
        ...(props.selected ? { background: "var(--dsw-alias-interactive-bg-hover)" } : {}),
        ...(props.highlight ? { outline: "1px solid var(--dsw-alias-state-business-primary)" } : {}),
      }}
    >
      <span style={{ flex: "none", width: 16, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-secondary)" }}>
        {props.collapsed ? <IconFolderClose16 size={16} /> : <IconFolderOpen16 size={16} />}
      </span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
        {props.name} ({props.count})
      </span>
      {props.onRename || props.onDelete ? (
        <span className="fm-wb-row-actions" style={{ display: "inline-flex", gap: 2, flex: "none" }}>
          {props.onRename ? (
            <Button size="sm" variant="ghost" icon={<IconEditOutline16 size={16} />} style={ICON_BTN_STYLE} title="重命名分组" aria-label="重命名分组" onClick={(e) => { e.stopPropagation(); props.onRename?.(); }} />
          ) : null}
          {props.onDelete ? (
            <Button size="sm" variant="ghost" icon={<IconTrashOutline16 size={16} />} style={{ ...ICON_BTN_STYLE, color: "var(--dsw-alias-state-error-primary)" }} title="删除分组" aria-label="删除分组" onClick={(e) => { e.stopPropagation(); props.onDelete?.(); }} />
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

// src/client/WorkspaceBrowser.tsx — 工作区区/会话列表（Round 2：与原生 DSH 对齐）。
// props 契约以真实槽位来源为准（参考 @deepseek-ai/dsh-client-ui-workspace/lib/client.js 的
// WorkspaceBrowser 签名，行 1647）：owner share（useSessions/useWorkspaces/wide/expandSidebar）
// + inject actions（client.ts 从 ctx.sessions / ctx.workspaces 提供，镜像 browserInjected 形状）。
// Round 2 对齐原生行为：
//   1) 收起/展开：工作区行点击折叠/展开其会话列表（"A Workspace remembers whether it is
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
//      工作区行：Folder 图标（展开 IconFolderOpen16 / 收起 IconFolderClose16），hover 时切换
//      为三角箭头（IconTriangleRightFill14，展开态 rotate 90°，与原生 .arrow/.arrowOpen 一致）；
//      会话行：状态小圆点（当前会话实心 business 点）。
// UI polish 轮：rename/delete/archive 用 primitives Modal + Input；行按钮用 primitives Button；
// 色值全部走 --dsw-* token。
import React, { useRef, useState } from "react";
import {
  Button,
  IconArchiveOutline20,
  IconChevronDownOutline14,
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
import { setActiveRoot } from "./active-root-store.ts";
import { ConfirmModal, PromptModal } from "./ContextMenu.tsx";
import { TopHatIcon } from "./TopHatIcon.tsx";
import { Api, describeApiError } from "./api.ts";
import type { ApiError, OrganizerAgentInfo, OrganizerRunSummary, OrganizerUsage } from "./api.ts";
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
  setSessionMarker,
  type AnnotationData,
} from "./annotation-store.ts";
import {
  applyOrganizeActionToGroups,
  applyOrganizeActionsToAnnotations,
  diffOrganize,
  isGroupAction,
  normalizeOrganizePlan,
  type OrganizeAction,
  type OrganizerSnapshot,
  type OrganizerWorkspace,
} from "./organizer.ts";
import { OrganizePanel } from "./OrganizePanel.tsx";
import {
  FONT_SECONDARY,
  HEADER_BORDER,
  ICON_BUTTON_STYLE,
  ICON_GLYPH_SIZE,
  ICON_HIT_EXPAND,
  RADIUS,
  ROW_ACTION_BUTTON_STYLE,
  ROW_ACTION_GAP,
  ROW_ACTION_HIT_INSET,
  ROW_MIN_HEIGHT,
} from "./ui-kit.ts";

export interface WorkspaceBrowserProps {
  wide?: boolean;
  expandSidebar?: () => void;
  /** 标题栏右侧追加内容（SidebarComposite 注入区级折叠切换按钮）。 */
  headerExtra?: React.ReactNode;
  /** 标题栏按钮组 key（每次展开递增，强制重挂载按钮组以重放 stagger 滑入动画）。 */
  toolbarKey?: number;
  /** 区容器高度过渡期间置 true：列表滚动区临时 hidden（避免滚动条闪现抖动）。 */
  scrollLock?: boolean;
  /**
   * 收起态（rail）点「工作区」区标后要定位的工作区 id：侧栏展开时由 SidebarComposite 传入，
   * 本组件消费（展开该工作区的会话列表 + 滚动到可见）后调 onRevealed 清空。
   */
  revealWorkspaceId?: string | null;
  onRevealed?: () => void;
  /** 窄栏（rail）模式下点击顶部展开按钮的回调（宿主 rail / 外部注入；区级折叠不再传）。 */
  onExpand?: () => void;
  /** 当前工作区的文件 API（读取/写入 .myagent/groups.json 用）。 */
  api: Api | null;
  useSessions: SelectorHook<SessionsSnapshot>;
  useWorkspaces: SelectorHook<WorkspacesSnapshot>;
  startSession?: (workspaceId?: string) => void;
  /** 新建工作区（宿主原生目录选择器 + workspace.create）；用户取消时静默。 */
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
// 分组折叠态持久化：localStorage 使用工作区 + 分组复合 key，避免不同区同名分组互相影响。
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
// 原生行为：行 hover 时显示操作按钮组（rowActions display:none → hover 显示）；工作区行
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
/* ── 方案 B · 导轨树（用户 2026 选定，视觉对照页 .superpowers/brainstorm/workspace-ui）──
   三级不再"只差缩进"，改成分工明确的三档：
     一级 工作区 13px/600/主色   · 二级 分组 12px/600/次色（小节标签）· 三级 会话 13px/400/主色
   再给分组容器画一条 1px 淡导轨，会话挂在导轨右侧 —— 从属关系不用读字。
   导轨取 border-l2（官方最淡的分隔色），够淡、不抢内容；空分组/已收起分组里
   top > bottom，伪元素高度为负、不绘制，不会留一条孤线。 */
.fm-wb-grp{position:relative;margin-bottom:4px}
.fm-wb-grp::before{
  content:"";position:absolute;left:24px;top:36px;bottom:4px;width:1px;
  background:var(--dsw-alias-border-l2);pointer-events:none
}
/* 二级的计数：从「名称 (1)」文本改成独立胶囊，帮它和一级划清界限。
   底色用 interactive-bg-hover（亮/暗主题都自适应，不写死 rgba）。 */
.fm-wb-cnt{
  flex:none;font-size:11px;line-height:16px;height:16px;padding:0 6px;
  border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-label-tertiary)
}
/* ── 图标按钮：字形收小 + 有效点击范围放大（用户反馈"有点拥挤"）──────────────
   官方 .tool / .iconButton 是 28px 方框 + CSS 里把 svg 定成 15px（不看调用点传的 size）；
   这里沿用同一接线并把字形再收一档到 14px，同时用伪元素把命中区向四周各扩 2px
   （28 → 32，面积 +31%）。伪元素画在按钮盒外仍能命中、点击目标就是按钮本身，
   所以命中区变大而布局与行高完全不变（行高仍由 28px 按钮托底）。
   ⚠️ 相邻按钮 gap 必须 ≥ 2×2=4px，否则两个命中区重叠、点中谁看 DOM 顺序
   —— 行内操作组原来是 gap:2，已同步改成 4。 */
.fm-tb-btn svg,
.fm-fold-btn svg,
.fm-icon-btn svg,
.fm-wb-row-actions > button svg{width:${ICON_GLYPH_SIZE}px;height:${ICON_GLYPH_SIZE}px}
.fm-tb-btn,
.fm-icon-btn,
.fm-wb-row-actions > button{position:relative}
/* 常规图标按钮（标题栏 / rail / 关闭键）：相邻 gap ≥ 4，各扩 2px → 32×32，边界正好相接。 */
.fm-tb-btn::after,
.fm-fold-btn::after,
.fm-icon-btn::after{
  content:"";position:absolute;inset:-${ICON_HIT_EXPAND}px;border-radius:999px
}
/* 行内操作按钮（紧凑 20px）：命中区横竖分开扩 —— 横向铺满 22px 节距（相邻严丝合缝，
   既不重叠也不留死区），纵向白送 6px（20 → 32px 高，行内上下没有邻居）。 */
.fm-wb-row-actions > button::after{
  content:"";position:absolute;inset:${ROW_ACTION_HIT_INSET};border-radius:999px
}
.fm-wb-drop-before::before,.fm-wb-drop-after::after{
  content:"";position:absolute;left:6px;right:6px;height:2px;border-radius:${RADIUS.pill}px;
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
/* 压缩原生 logo 区，避免遮挡工作区按钮 */
.hHd-Xa_logoRow{height:40px!important;margin-bottom:4px!important;padding:4px 0 4px 4px!important}
/* 顶部侧栏收起键：宽态/收起态都显示双箭头（收起态为右箭头，不再显示鲸鱼）。
   根因（2026 实测）：官方收起态按钮内部渲染的是 <span class="hHd-Xa_railMark"> 里的
   DeepSeek 鲸鱼 svg（24×18），本插件又用 ::before 在同一颗 30×30 按钮上画 24×24 双箭头
   ——两者同框叠在一起（用户报的"logo 和展开箭头重合"）。
   此前只隐藏 .hHd-Xa_panelIcon / .hHd-Xa_railFish，而本版 dsh 的真实类名是
   .hHd-Xa_railMark（railFish 是旧版名），所以鲸鱼一直没被隐藏掉。
   三个类名一起隐藏：railMark 覆盖当前版本，railFish / panelIcon 覆盖旧版本。 */
button.hHd-Xa_toggle .hHd-Xa_panelIcon,
button.hHd-Xa_toggle .hHd-Xa_railMark,
button.hHd-Xa_toggle .hHd-Xa_railFish{display:none!important}
/* 官方在收起态 hover 时会把 railMark 改回 display:inline、把 panelIcon 显示出来
   （.hHd-Xa_collapsed .hHd-Xa_toggle:hover ...）——上一条 !important 已覆盖，
   这里再钉一次收起态，避免 hover 时鲸鱼闪回来压住双箭头。 */
.hHd-Xa_collapsed button.hHd-Xa_toggle:hover .hHd-Xa_railMark,
.hHd-Xa_collapsed button.hHd-Xa_toggle:hover .hHd-Xa_panelIcon{display:none!important}
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
// 圆角对齐官方图标按钮：官方 .tool / .iconButton 都是 28px 方框 + 全圆（正圆），
// 此前没覆盖圆角，落到宿主 Button 的 14/18px 圆角，比官方方一些。
export const ICON_BTN_STYLE: React.CSSProperties = ICON_BUTTON_STYLE;

/** 拖拽中的活动行（镜像 ui-workspace 的 drag 状态：over 记录最近一次悬停位置）。 */
interface DragState {
  kind: "workspace" | "session" | "group";
  /** workspace 拖拽 = workspaceId；session 拖拽 = sessionId；group 拖拽 = groupId。 */
  id: string;
  /** session/group 拖拽的所属工作区（跨组拖拽不生效，与原生 sameGroupDrag 一致）。 */
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
  // 一句话标注（annotations.json）状态：每个工作区独立读写，权威副本始终在磁盘。
  const [annotationsByWorkspace, setAnnotationsByWorkspace] = useState<Record<string, AnnotationData>>({});
  const [annotationsVersions, setAnnotationsVersions] = useState<Record<string, unknown>>({});
  const [annotationsErrors, setAnnotationsErrors] = useState<Record<string, string>>({});
  const [annotationsLoaded, setAnnotationsLoaded] = useState<Record<string, boolean>>({});
  const annotationsVersionsRef = useRef<Record<string, unknown>>({});
  const annotationsDiskRef = useRef<Record<string, AnnotationData>>({});
  const annotationsPending = useRef<Record<string, Array<{ mutate: (data: AnnotationData) => AnnotationData }>>>({});
  const annotationsFlushing = useRef<Record<string, boolean>>({});
  // 当前正在跑的写盘 promise：`reloadGroupsAndAnnotations()` 会把 diskRef 换成磁盘内容，
  // 若写盘还没落地就会读到**旧文件**（marker 丢失 → 区管家把刚更新过的会话又算成"有新对话"）。
  // 所以重载前要先 await 它。
  const annotationsFlushPromise = useRef<Record<string, Promise<void> | undefined>>({});
  // 已自动生成过简述的会话（避免反复写盘）。
  const autoBriefedRef = useRef<Set<string>>(new Set());
  // 统计每个会话的完成轮次（running true→false 记一次交互），用于“四次交互后生成简介”。
  const interactionCounts = useRef<Record<string, number>>({});
  const lastRunning = useRef<Record<string, boolean>>({});
  const summaryRequested = useRef<Set<string>>(new Set());
  // 区管家交互状态。
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [organizeApplying, setOrganizeApplying] = useState(false);
  const [organizeError, setOrganizeError] = useState<string | null>(null);
  // 区管家「一键更新全部对话」。
  const [updateRunning, setUpdateRunning] = useState(false);
  const [updateSummary, setUpdateSummary] = useState<OrganizerRunSummary | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateDetails, setUpdateDetails] = useState<Array<{ sessionId: string; title?: string; brief?: string }>>([]);
  const [updateProgress, setUpdateProgress] = useState<{ done: number; total: number } | null>(null);
  // 区管家「一键整理分组」。
  const [organizing, setOrganizing] = useState(false);
  const [organizeSummary, setOrganizeSummary] = useState<{ created: number; moved: number; renamed: number; deleted: number; updated: number } | null>(null);
  const [organizeDetails, setOrganizeDetails] = useState<Array<{ key: string; primary: string; secondary?: string }>>([]);
  const [canUndoOrganize, setCanUndoOrganize] = useState(false);
  const organizeUndoRef = useRef<Array<{ workspaceId: string; groups: SessionGroups; annotations: AnnotationData }> | null>(null);
  // 有变化的会话数（null = 还没统计出来）与用量。
  const [changedCount, setChangedCount] = useState<number | null>(null);
  const [agentInfo, setAgentInfo] = useState<OrganizerAgentInfo | null>(null);
  const [agentUsage, setAgentUsage] = useState<OrganizerUsage | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);

  const workspaceById = (id: string) => workspaces.find((x) => x.workspaceId === id);
  const apiForWorkspace = (id: string) => {
    const w = workspaceById(id);
    return w ? new Api(w.path) : null;
  };
  const groupsForWorkspace = (id: string) => groupsByWorkspace[id] ?? emptyGroups();
  const annotationsForWorkspace = (id: string) => annotationsByWorkspace[id] ?? emptyAnnotations();
  // 更新 annotations.json：立即乐观更新本地状态，再串行写盘（按工作区排队）。
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
      annotationsFlushPromise.current[workspaceId] = flushAnnotations(workspaceId)
        .catch(() => {})
        .finally(() => {
          annotationsFlushing.current[workspaceId] = false;
        });
    }
  };

  /** 等所有挂起/在飞的标注写盘落地（重载前调用，避免读到旧文件）。 */
  const awaitAnnotationsFlushed = async () => {
    const pending = Object.values(annotationsFlushPromise.current).filter(Boolean) as Promise<void>[];
    if (pending.length > 0) await Promise.all(pending);
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
    if (!api) { window.alert("无法定位工作区"); return false; }
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

  // 一句话标注加载：每个工作区独立读 .myagent/annotations.json；损坏/缺失按空标注初始化。
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

  /**
   * 在**指定分组的标题行**上点"新对话"：把新对话建在该分组下。
   *
   * 归组机制复用既有那条 effect（新出现的 sessionId 自动移入该工作区"当前选中分组"），
   * 所以这里只需先把"当前选中分组"切到本分组、并确保它展开，再新建会话即可 ——
   * 与工具栏那颗按钮走的是同一条路，不额外造一套归组逻辑。
   */
  const handleNewChatInGroup = (workspaceId: string, groupId: string) => {
    selectGroup(workspaceId, groupId);
    expandGroup(workspaceId, groupId);
    void Promise.resolve()
      .then(() => props.startSession?.(workspaceId))
      .catch((e) => window.alert(`操作失败：${e?.message ?? String(e)}`));
  };

  // 区管家：收集当前全部工作区树 + 标注，生成建议并切换到差异交互框。
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

  // 等待指定工作区的分组写入队列排空（最多 5 秒）。
  const waitForGroupFlush = async (workspaceIds: string[]) => {
    for (let i = 0; i < 100; i++) {
      if (workspaceIds.every((id) => !flushing.current[id])) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  // 整理应用后重新从磁盘加载分组与标注，确保工作区空间立即反映最新结果。
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
        // 单个工作区刷新失败不阻塞其它区。
      }
    }));
  };

  /**
   * 收集「可见会话 + 上次总结时的 marker」。
   *
   * marker 存在各工作区 `.myagent/annotations.json` 的 session 条目里：它是宿主上次总结时
   * 给的持久化标记（`ev:<事件数>`）。宿主拿它和当前值比较 → 相等就是"这个对话自上次总结后
   * 没有任何新内容"，区管家直接跳过（不调模型）。
   */
  const collectSummarizeTargets = () => {
    const sessionToWs = new Map<string, string>();
    const sessions: Array<{ id: string; marker?: string | null }> = [];
    for (const w of workspaces) {
      const ann = annotationsDiskRef.current[w.workspaceId] ?? annotationsForWorkspace(w.workspaceId);
      const visible = (w.sessionIds ?? []).filter((id) => !archived.includes(id));
      for (const id of visible) {
        if (sessionToWs.has(id)) continue;
        sessionToWs.set(id, w.workspaceId);
        sessions.push({ id, marker: ann.sessions[id]?.marker ?? null });
      }
    }
    return { sessionToWs, sessions };
  };

  /** 问宿主：哪些会话有新对话（marker 变了）+ 管家是谁 + 真实消耗用量。 */
  const refreshOrganizerStatus = async () => {
    setLoadingInfo(true);
    try {
      const { sessions } = collectSummarizeTargets();
      const res = await new Api("").organizerStatus(sessions.map((s) => ({ id: s.id })));
      if (!res.ok) return;
      setAgentInfo(res.data.agent);
      setAgentUsage(res.data.usage ?? null);
      const markerById = new Map(res.data.sessions.map((s) => [s.id, s.marker]));
      let changed = 0;
      for (const s of sessions) {
        const current = markerById.get(s.id) ?? null;
        // marker 拿不到（stat 不可用）时保守算作"有变化"，宁可多总结也不要漏掉新对话。
        if (current === null || s.marker == null || s.marker !== current) changed += 1;
      }
      setChangedCount(changed);
    } catch {
      // 状态查询失败不影响其它功能，面板沿用上一次的数字。
    } finally {
      setLoadingInfo(false);
    }
  };

  /** 把一条会话的更新结果落到界面与磁盘（**先简介、后标题**，再记 marker）。 */
  const applySessionUpdate = (
    wsId: string,
    u: { sessionId: string; title?: string; brief?: string; marker?: string },
  ) => {
    // ① 先写简介。
    if (u.brief) updateAnnotations(wsId, (d) => setSessionBrief(d, u.sessionId, undefined, u.brief!));
    // ② 再写标题（宿主给的就是 `主题：进度`）。
    if (u.title) {
      props.renameSession?.(u.sessionId, u.title);
      const briefNow = u.brief ?? annotationsForWorkspace(wsId).sessions[u.sessionId]?.brief ?? "";
      updateAnnotations(wsId, (d) => setSessionBrief(d, u.sessionId, u.title!, briefNow));
    }
    // ③ 记 marker：下次只更新"又聊过"的会话。
    if (u.marker) updateAnnotations(wsId, (d) => setSessionMarker(d, u.sessionId, u.marker!));
  };

  /**
   * 区管家「一键更新全部对话」。
   *
   * **分块循环**是关键：用户真实工作区有上百条会话，逐个走模型远超单个 HTTP 请求的预算
   * （路由 60s 硬超时），一次性发过去只会得到"跑了半天、大半没更新"。
   * 所以每块 6 条、每块单独一次请求，边跑边把进度与结果打到面板上；
   * 每块结束后立刻落盘并用宿主复核 marker（改名会写日志、让 marker 立刻过期）。
   */
  const handleUpdateChanged = async () => {
    setUpdateRunning(true);
    setUpdateError(null);
    setUpdateProgress(null);
    const CHUNK = 6;
    try {
      // 先取一次状态：拿到"有新对话"的会话 + 各自 marker（跳过没聊过的）。
      const { sessionToWs, sessions } = collectSummarizeTargets();
      if (sessions.length === 0) {
        setUpdateError("没有可见会话可更新。");
        return;
      }
      const status = await new Api("").organizerStatus(sessions.map((s) => ({ id: s.id })));
      if (!status.ok) {
        setUpdateError(`无法获取会话状态：${status.message}`);
        return;
      }
      setAgentInfo(status.data.agent);
      setAgentUsage(status.data.usage ?? null);
      const markerById = new Map(status.data.sessions.map((s) => [s.id, s.marker]));
      let changed = 0;
      const targets = sessions.filter((s) => {
        const current = markerById.get(s.id) ?? null;
        const isChanged = current === null || s.marker == null || s.marker !== current;
        if (isChanged) changed += 1;
        return isChanged;
      });
      setChangedCount(changed);
      if (targets.length === 0) {
        setUpdateSummary({ checked: sessions.length, updated: 0, unchanged: sessions.length, skipped: 0, agent: 0, local: 0, elapsedMs: 0 });
        setUpdateDetails([]);
        return;
      }

      const details: Array<{ sessionId: string; title?: string; brief?: string }> = [];
      const totals = { checked: 0, updated: 0, unchanged: 0, skipped: 0, agent: 0, local: 0 };
      const startedAt = Date.now();
      for (let i = 0; i < targets.length; i += CHUNK) {
        const chunk = targets.slice(i, i + CHUNK);
        setUpdateProgress({ done: i, total: targets.length });
        const res = await new Api("").resummarizeAll(chunk);
        if (!res.ok) {
          setUpdateError(`更新中断（已完成 ${i} / ${targets.length}）：${res.message}`);
          break;
        }
        for (const u of res.data.updates ?? []) {
          const wsId = sessionToWs.get(u.sessionId);
          if (!wsId) continue;
          // 跳过的会话（没有实质内容）：只记 marker，不动标题/简介 ——
          // 这样它下次不会再被算成"有新对话"，直到它真的聊出内容来。
          if (u.skipped || u.unchanged) {
            if (u.marker) updateAnnotations(wsId, (d) => setSessionMarker(d, u.sessionId, u.marker!));
            continue;
          }
          applySessionUpdate(wsId, u);
          details.push({ sessionId: u.sessionId, title: u.title, brief: u.brief });
        }
        const s = res.data.summary;
        if (s) {
          totals.checked += s.checked;
          totals.updated += s.updated;
          totals.unchanged += s.unchanged;
          totals.skipped += s.skipped;
          totals.agent += s.agent;
          totals.local += s.local;
        }
        if (res.data.agent) setAgentInfo(res.data.agent);
        setUpdateDetails([...details]);
        setUpdateProgress({ done: Math.min(i + CHUNK, targets.length), total: targets.length });
        // 边跑边落盘，并把 marker 用宿主的当前值复核一遍（改名会写日志、立刻让 marker 过期）。
        await awaitAnnotationsFlushed();
        await reseedMarkers(sessionToWs, (res.data.updates ?? []).map((u) => u.sessionId));
      }
      setUpdateSummary({ ...totals, elapsedMs: Date.now() - startedAt });
      // 收尾再补一次 marker（覆盖最后一块的改名写入），然后才刷新状态与工作区。
      await reseedMarkers(sessionToWs, details.map((d) => d.sessionId));
      await reloadGroupsAndAnnotations();
      await refreshOrganizerStatus();
      console.log("[dsh-myagent] 区管家一键更新完成", totals);
    } catch (e) {
      setUpdateError(`更新失败：${(e as Error)?.message ?? String(e)}`);
    } finally {
      setUpdateProgress(null);
      setUpdateRunning(false);
    }
  };

  /**
   * 用宿主的**当前** marker 复核这批会话。
   *
   * `props.renameSession` 会往会话日志写一条 title 事件 → 刚记的 `sz:` 立刻过期；
   * 不补的话下一次一键更新又会把它们当"有新对话"重新总结（改名 → 过期 → 无限改下去）。
   * 只对本次真的处理过的会话补，绝不顺手给没处理过的会话写 marker
   * （那等于宣布它们"已经是最新"，会永远漏掉）。
   */
  const reseedMarkers = async (sessionToWs: Map<string, string>, ids: string[]) => {
    if (ids.length === 0) return;
    try {
      // 等一拍再读：`renameSession` 是异步 RPC，标题事件落进会话日志需要一点时间；
      // 读得太早会拿到**改名之前**的大小，marker 立刻又过期（实测第二轮一键更新
      // 会把刚更新过的会话再改一遍）。
      await new Promise((resolve) => setTimeout(resolve, 700));
      const fresh = await new Api("").organizerStatus(ids.map((id) => ({ id })));
      if (!fresh.ok) return;
      const freshById = new Map(fresh.data.sessions.map((s) => [s.id, s.marker]));
      for (const id of ids) {
        const wsId = sessionToWs.get(id);
        const m = freshById.get(id);
        if (wsId && m) updateAnnotations(wsId, (d) => setSessionMarker(d, id, m));
      }
      await awaitAnnotationsFlushed();
    } catch {
      // 补 marker 失败不影响本次结果，下次最多多总结一次。
    }
  };

  /**
   * 区管家「一键整理分组」：算一次计划并**直接应用**（不再让用户逐条勾选），
   * 结果以计数摘要呈现，并保留一份可撤销快照。
   *
   * 为什么敢直接应用：整理前的 groups/annotations 会整份留档（`organizeUndoRef`），
   * 面板上出现「撤销这次整理」；比起"先给 26 条差异让用户做功课"，这才是"一键"。
   */
  const handleOrganizeGroups = async () => {
    setOrganizing(true);
    setOrganizeError(null);
    try {
      await reloadGroupsAndAnnotations();
      const snapshot = collectSnapshot();
      // 分区策略**只由模型产出**（用户定案："分区策略也得是模型思考后的"）。
      // 旧实现在这里先跑一遍本地确定性规则（buildOrganizePlan）当底稿，再把模型计划与本地的
      // "修正项"（renameGroup / deleteGroup / mergeGroup / 拆分宽泛分组）**合并**；模型失败时
      // 更是整份退回本地计划。于是最终应用的"分区建议"里混着本地规则、失败时完全没有模型参与。
      // 现在：模型拿不出计划就如实报错，**不产出任何建议**，本地规则不再参与。
      const res = await new Api("").organizePlan(snapshot);
      // 错误必须带**真实原因**：describeApiError 对未知 code 只会给"操作失败（INTERNAL）"，
      // 而这里"为什么没有建议"恰恰是用户唯一能拿到的信息（本地不再兜底了）。
      if (!res.ok) throw new Error(`模型未给出整理建议：${res.message || res.code || res.status}`);
      if (!res.data?.plan) throw new Error("模型未返回整理建议");
      const plan = normalizeOrganizePlan(res.data.plan);
      const actions = plan.actions;
      const summary = {
        created: actions.filter((a) => a.kind === "createGroup").length,
        moved: actions.filter((a) => a.kind === "moveSession").length,
        renamed: actions.filter((a) => a.kind === "renameGroup" || a.kind === "mergeGroup").length,
        deleted: actions.filter((a) => a.kind === "deleteGroup").length,
        updated: actions.filter((a) => a.kind === "updateBrief").length,
      };
      setOrganizeDetails(
        diffOrganize(snapshot, plan).map((item) => ({ key: item.id, primary: item.title, secondary: item.description })),
      );
      if (actions.length === 0) {
        setOrganizeSummary({ created: 0, moved: 0, renamed: 0, deleted: 0, updated: 0 });
        return;
      }
      // 留档（整份 groups + annotations），供"撤销这次整理"。
      organizeUndoRef.current = workspaces.map((w) => ({
        workspaceId: w.workspaceId,
        groups: groupsDiskRef.current[w.workspaceId] ?? groupsForWorkspace(w.workspaceId),
        annotations: annotationsDiskRef.current[w.workspaceId] ?? annotationsForWorkspace(w.workspaceId),
      }));
      setCanUndoOrganize(true);
      await handleApplyOrganize(actions, { keepOpen: true, extraSummary: summary });
      await refreshOrganizerStatus();
    } catch (e) {
      // 失败也要刷新管家状态：planner agent 在报错前**已经建出来了**，不刷新的话
      // 「分区建议」那行还停在"未启动"，看起来像根本没走模型。
      void refreshOrganizerStatus();
      setOrganizeError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrganizing(false);
    }
  };

  /** 撤销上一次「一键整理分组」：把当时留档的 groups / annotations 整份写回。 */
  const handleUndoOrganize = async () => {
    const backup = organizeUndoRef.current;
    if (!backup || backup.length === 0) return;
    setOrganizing(true);
    try {
      for (const item of backup) {
        const api = apiForWorkspace(item.workspaceId);
        if (!api) continue;
        try {
          const savedGroups = await saveGroups(api, item.groups, groupsVersionsRef.current[item.workspaceId]);
          groupsVersionsRef.current[item.workspaceId] = savedGroups;
          groupsDiskRef.current[item.workspaceId] = item.groups;
        } catch (e) {
          setOrganizeError(`撤销分组失败：${describeApiError(e as unknown as ApiError)}`);
        }
        try {
          const savedAnn = await saveAnnotations(api, item.annotations, annotationsVersionsRef.current[item.workspaceId]);
          annotationsVersionsRef.current[item.workspaceId] = savedAnn;
          annotationsDiskRef.current[item.workspaceId] = item.annotations;
        } catch (e) {
          setOrganizeError(`撤销标注失败：${describeApiError(e as unknown as ApiError)}`);
        }
      }
      organizeUndoRef.current = null;
      setCanUndoOrganize(false);
      setOrganizeSummary(null);
      setOrganizeDetails([]);
      await reloadGroupsAndAnnotations();
    } finally {
      setOrganizing(false);
    }
  };

  const handleApplyOrganize = async (
    actions: OrganizeAction[],
    options: { keepOpen?: boolean; extraSummary?: { created: number; moved: number; renamed: number; deleted: number; updated: number } } = {},
  ) => {
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
      // 等待分组写入队列排空，再重新从磁盘加载分组/标注，刷新工作区空间。
      await waitForGroupFlush([...affected]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await reloadGroupsAndAnnotations();
      if (options.extraSummary) setOrganizeSummary(options.extraSummary);
    } finally {
      setOrganizeApplying(false);
      // 「一键整理分组」保持面板打开（要显示结果与撤销）；旧的勾选流程仍然应用后关闭。
      if (!options.keepOpen) setOrganizeOpen(false);
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

  // 重新总结当前重命名会话：**先写简介，再写标题**（用户定的顺序）。
  //
  // 两个按钮都走完整的两步更新：宿主会先产出简介、再依据简介产出 `主题：进度` 标题，
  // 这里先把简介落到界面上、再落标题 —— 所以任何时刻看到的标题都对应着已经写入的简介。
  // 区别只在按钮的措辞与 loading 态，不再出现"两个按钮给出同一段文本"。
  const handleResummarizeSession = async (mode: "title" | "brief") => {
    if (!renameTarget || renameTarget.kind !== "session") return;
    const sessionId = renameTarget.id;
    const workspaceId = renameTarget.workspaceId;
    if (mode === "title") setResummarizingTitle(true);
    else setResummarizingBrief(true);
    try {
      // 必须把 mode 传下去：服务端 `resummarizeSession` 按 mode **过滤返回字段**
      // （brief 只回 brief、title 只回 title）。v0.3.0 那轮这里被写死成 "both"，
      // 于是点「重新总结简介」也会带回 title、下面两段都执行 → 标题被一起改掉。
      const res = await new Api("").sessionResummarize(sessionId, mode);
      if (res.ok) {
        const data = res.data;
        // ① 先简介。
        if (data.brief) {
          const titleForBrief = data.title ?? renameTarget.title;
          updateAnnotations(workspaceId, (d) => setSessionBrief(d, sessionId, titleForBrief, data.brief!));
          setRenameTarget((prev) => (prev ? { ...prev, brief: data.brief! } : prev));
        }
        // ② 再标题（`主题：进度`）。
        if (data.title) {
          props.renameSession?.(sessionId, data.title);
          updateAnnotations(workspaceId, (d) => setSessionBrief(d, sessionId, data.title!, data.brief ?? renameTarget.brief ?? ""));
          setRenameTarget((prev) => (prev ? { ...prev, title: data.title! } : prev));
        }
        // ③ 记 marker：这次总结覆盖到的会话版本，区管家下次据此判断"有没有新对话"。
        void refreshOrganizerStatus();
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

  // 列表滚动区 ref：收起态点「工作区」区标后需要把目标工作区滚到可见。
  const scrollRef = useRef<HTMLDivElement>(null);

  // 收起态点「工作区」区标 → 展开后定位：确保该工作区是展开的（会话列表可见），
  // 再滚动到可见。只依赖 revealWorkspaceId —— 消费一次就回调清空（上层置 null），
  // 否则每次渲染都会重新滚动一次。故意不把 expand/onRevealed 放进依赖。
  React.useEffect(() => {
    const id = props.revealWorkspaceId;
    if (id === null || id === undefined) return;
    expand(id);
    const nodes = scrollRef.current?.querySelectorAll("[data-workspace-id]");
    const el = nodes === undefined ? undefined : Array.from(nodes).find((n) => n.getAttribute("data-workspace-id") === id);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    props.onRevealed?.();
  }, [props.revealWorkspaceId]);

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

  // 收起态（rail）不再由本组件渲染：整块 rail 交给 RailPanel（两颗区标 + 进行中任务点列）。
  // 旧分支是"每个工作区一颗文件夹图标、点击 = startSession(workspaceId)"，也就是用户报的
  // "点文件夹图标会新建对话"，已随本次重设计删除。

  if (workspaces.length === 0) {
    return (
      <div style={{ fontSize: FONT_SECONDARY, padding: 8, color: "var(--dsw-alias-label-secondary)" }}>
        暂无工作区（请在宿主侧添加）
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
        className="fm-wb-grp"
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
          onNewChat={() => handleNewChatInGroup(arg.workspaceId, arg.groupId)}
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
                    padding: "3px 8px 3px 34px",
                    // 行高显式钉住：20px 紧凑按钮撑不到 34px，不钉就会塌掉。
                    // box-sizing:border-box 见工作区行同款注释（否则 minHeight 不含 padding）。
                    boxSizing: "border-box",
                    minHeight: ROW_MIN_HEIGHT.session,
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    position: "relative",
                    background: id === current ? "var(--dsw-alias-interactive-bg-hover)" : undefined,
                    borderRadius: RADIUS.navRow,
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
                      borderRadius: RADIUS.pill,
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
                  <span className="fm-wb-row-actions" style={{ display: "inline-flex", gap: ROW_ACTION_GAP, flex: "none" }}>
                    <Button size="sm" variant="ghost" icon={<IconListPenOutline16 size={16} />} style={ROW_ACTION_BUTTON_STYLE} title="重命名会话" aria-label="重命名会话" onClick={(e) => { e.stopPropagation(); setRenameTarget({ kind: "session", id, title: label, brief: annotationsForWorkspace(arg.workspaceId).sessions[id]?.brief ?? "", workspaceId: arg.workspaceId }); }} />
                    <Button size="sm" variant="ghost" icon={<IconArchiveOutline20 size={16} />} style={ROW_ACTION_BUTTON_STYLE} title="归档会话" aria-label="归档会话" onClick={(e) => { e.stopPropagation(); setConfirmTarget({ kind: "session", id, title: label }); }} />
                  </span>
                </div>
              );
            })
          : null}
      </div>
    );
  };

  return (
    <div style={{ fontSize: FONT_SECONDARY, lineHeight: 1.5, userSelect: "none", color: "var(--dsw-alias-label-primary)", height: "100%", display: "flex", flexDirection: "column" }}>
      <style>{BROWSER_CSS}</style>
      {/* 标题栏行保持侧栏黑色底，底部一条黑灰边界线与内容区区分（内容区不铺色）。
          padding-right 34：按钮组右端贴近右上角固定折叠键（fm-fold-btn，左缘距容器右 30px，
          留 4px 间隙；坐标恒定不动）。 */}
      <div style={{ flex: "none", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 34px 4px 4px", background: "var(--dsw-specific-sidebar-fill)", borderBottom: HEADER_BORDER }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <IconFolderOpen16 size={16} />
          工作区
        </span>
        {/* 标题栏右侧按钮组：key=toolbarKey（每次展开递增 → 重挂载 → stagger 滑入动画重放，
            与区容器展开过渡同时进行）。 */}
        <span key={props.toolbarKey ?? 0} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {/* 展开过渡动画：按钮依次滑入（fm-tb-btn，延迟内联显式指定）。 */}
          {/* 区管家：隐藏内容区，展示差异交互框 */}
          <Button
            className="fm-tb-btn"
            style={{ ...ICON_BTN_STYLE, animationDelay: "0ms" }}
            size="sm"
            variant="ghost"
            icon={<TopHatIcon size={16} />}
            title="区管家"
            aria-label="区管家"
            onClick={() => {
              // 打开面板即可：面板自带"这是什么 / 两条命令 / 消耗用量"，
              // 不再像以前那样一进来就跑去算一份几十条的分组差异。
              setOrganizeOpen(true);
              void refreshOrganizerStatus();
            }}
          />
          {/* 新对话：在当前选中分组所在工作区内新建，并自动归入该分组 */}
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
          <Button className="fm-tb-btn" style={{ ...ICON_BTN_STYLE, animationDelay: "80ms" }} size="sm" variant="ghost" icon={<IconProjectAddOutline16 size={16} />} title="新工作区" aria-label="新工作区" onClick={() => run(() => props.addWorkspace?.())} />
        </span>
      </div>
      {/* 列表滚动区：滚动条上界在标题栏下方（标题栏不参与滚动）；scrollLock（区容器过渡期间）
          置 hidden 避免滚动条闪现抖动；fm-scroll 提供渐变滚动条样式。 */}
      <div
        ref={scrollRef}
        className="fm-scroll"
        role="tree"
        aria-label="工作区与会话"
        style={{ flex: 1, minHeight: 0, overflowY: props.scrollLock ? "hidden" : "auto", overflowX: "hidden", scrollbarGutter: "stable" }}
      >
        {organizeOpen ? (
          <OrganizePanel
            onClose={() => setOrganizeOpen(false)}
            onUpdateAll={handleUpdateChanged}
            updating={updateRunning}
            updateProgress={updateProgress}
            updateSummary={updateSummary}
            updateDetails={updateDetails}
            updateError={updateError}
            onOrganizeGroups={handleOrganizeGroups}
            organizing={organizing || organizeApplying}
            organizeSummary={organizeSummary}
            organizeDetails={organizeDetails}
            organizeError={organizeError}
            onUndoOrganize={handleUndoOrganize}
            canUndoOrganize={canUndoOrganize}
            agent={agentInfo}
            usage={agentUsage}
            changedCount={changedCount}
            loadingInfo={loadingInfo}
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
          // 工作区拖拽目标 = 整组（行 + 会话区，与原生 groupSection 作为 drop 目标一致）。
          const wsMarker = drag?.kind === "workspace" && drag.over?.id === w.workspaceId ? drag.over.half : null;
          return (
            <div
              key={w.workspaceId}
              role="group"
              data-workspace-id={w.workspaceId}
              style={{
                position: "relative",
                marginBottom: 6,
                // 工作区之间加灰色分割线；子聊天框（会话行）不加。
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
              {/* 工作区行：图标列（Folder，hover 换三角箭头）+ 标题 + hover 操作组。
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
                  gap: 6,
                  padding: "6px 8px",
                  // 行高显式钉住：20px 紧凑按钮撑不到 40px，不钉就会塌掉。
                  // 必须配 box-sizing:border-box —— min-height 默认只作用于 content box，
                  // 否则行高会变成 minHeight + 2×padding（实测 52 而不是 40）。
                  boxSizing: "border-box",
                  minHeight: ROW_MIN_HEIGHT.workspace,
                  borderRadius: RADIUS.navRow,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
                onClick={() => {
                  // 点"区"标签：原有的展开/收起照旧，**并把文件树切到这个区**。
                  // 每次点击都切（不只是展开那一下）—— 心智模型就一句"点哪个区，文件树就是哪个区"。
                  if (typeof w.path === "string" && w.path !== "") setActiveRoot(w.path);
                  if (isCollapsed) expand(w.workspaceId);
                  else collapse(w.workspaceId);
                }}
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
                <span className="fm-wb-row-actions" style={{ display: "inline-flex", gap: ROW_ACTION_GAP, flex: "none" }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<IconPlusOutline16 size={16} />}
                    style={ROW_ACTION_BUTTON_STYLE}
                    title="新建分组"
                    aria-label="新建分组"
                    onClick={(e) => {
                      e.stopPropagation();
                      setGroupAction({ kind: "create", workspaceId: w.workspaceId });
                    }}
                  />
                  <Button size="sm" variant="ghost" icon={<IconEditOutline16 size={16} />} style={ROW_ACTION_BUTTON_STYLE} title="重命名工作区" aria-label="重命名工作区" onClick={(e) => { e.stopPropagation(); setRenameTarget({ kind: "workspace", id: w.workspaceId, title: w.title ?? w.path, brief: annotationsForWorkspace(w.workspaceId).workspaces[w.workspaceId]?.brief ?? "", workspaceId: w.workspaceId }); }} />
                  <Button size="sm" variant="ghost" icon={<IconTrashOutline16 size={16} />} style={{ ...ROW_ACTION_BUTTON_STYLE, color: "var(--dsw-alias-state-error-primary)" }} title="删除工作区" aria-label="删除工作区" onClick={(e) => { e.stopPropagation(); setConfirmTarget({ kind: "workspace", id: w.workspaceId, title: w.title ?? w.path }); }} />
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
          title={renameTarget.kind === "workspace" ? "重命名工作区" : "重命名会话"}
          initialValue={renameTarget.title}
          placeholder={renameTarget.kind === "workspace" ? "工作区名称" : "会话标题"}
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
          title={confirmTarget.kind === "workspace" ? `删除工作区 ${confirmTarget.title}？` : `归档会话 ${confirmTarget.title}？`}
          description={confirmTarget.kind === "workspace" ? "该工作区下的会话将被一并删除，此操作不可恢复。" : "归档后的会话将从当前列表中隐藏。"}
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
  /** 在该分组下新建对话（工具栏"新对话（当前选中分组）"的同款按钮，放在重命名左边）。 */
  onNewChat?: () => void;
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
        gap: 6,
        padding: "4px 8px 4px 16px",
        // 行高显式钉住：20px 紧凑按钮撑不到 36px，不钉就会塌掉。
        // box-sizing:border-box 见工作区行同款注释（否则 minHeight 不含 padding）。
        boxSizing: "border-box",
        minHeight: ROW_MIN_HEIGHT.group,
        borderRadius: RADIUS.navRow,
        cursor: "pointer",
        fontWeight: 600,
        // 方案 B：二级 = 小节标签。字号降到 12、颜色转次色，与一级（13px/主色）分层；
        // 配合下面的 chevron（不再是 folder）与计数胶囊，一眼区分"这是分组，不是另一个工作区"。
        fontSize: 12,
        color: "var(--dsw-alias-label-secondary)",
        ...(props.selected ? { background: "var(--dsw-alias-interactive-bg-hover)" } : {}),
        ...(props.highlight ? { outline: "1px solid var(--dsw-alias-state-business-primary)" } : {}),
      }}
    >
      {/* 图标由 folder 改为展开/收起 chevron：分组是可折叠小节，不是"另一层文件夹"。
          chevron 中心 = 16(padding-left) + 8(16px 图标槽一半) = 24px，导轨 ::before 正对这条线。 */}
      <span style={{ flex: "none", width: 16, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-tertiary)" }}>
        {props.collapsed ? <IconTriangleRightFill14 size={14} /> : <IconChevronDownOutline14 size={14} />}
      </span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
        {props.name}
      </span>
      <span className="fm-wb-cnt" title={`${props.count} 个会话`}>{props.count}</span>
      {props.onRename || props.onDelete || props.onNewChat ? (
        <span className="fm-wb-row-actions" style={{ display: "inline-flex", gap: ROW_ACTION_GAP, flex: "none" }}>
          {/* 新对话（本分组）：与工具栏那颗同款同标签，放在"重命名分组"左边。 */}
          {props.onNewChat ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<IconNewChatOutline16 size={16} />}
              style={ROW_ACTION_BUTTON_STYLE}
              title="新对话（当前选中分组）"
              aria-label="新对话（当前选中分组）"
              data-myagent-new-chat-group
              onClick={(e) => {
                e.stopPropagation();
                props.onNewChat?.();
              }}
            />
          ) : null}
          {props.onRename ? (
            <Button size="sm" variant="ghost" icon={<IconEditOutline16 size={16} />} style={ROW_ACTION_BUTTON_STYLE} title="重命名分组" aria-label="重命名分组" onClick={(e) => { e.stopPropagation(); props.onRename?.(); }} />
          ) : null}
          {props.onDelete ? (
            <Button size="sm" variant="ghost" icon={<IconTrashOutline16 size={16} />} style={{ ...ROW_ACTION_BUTTON_STYLE, color: "var(--dsw-alias-state-error-primary)" }} title="删除分组" aria-label="删除分组" onClick={(e) => { e.stopPropagation(); props.onDelete?.(); }} />
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

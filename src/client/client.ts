// src/client/client.ts — 浏览器半区正式入口（Branch A：shadow sidebar.workspaces + details）。
// 挂载姿势（spike 实测，官方 ui-workspace 同款）：ctx.slots.inject 声明感知后 register——
// sidebar.workspaces 是 single 槽、最低优先级渲染，priority: -100 把 ui-workspace（priority 0）
// shadow 掉，所以这里必须自渲染工作沙盒区/会话列表（WorkspaceBrowser）。
//
// Round 2：查看器从覆盖式抽屉改为 details 列并行分割（替代覆盖式抽屉）：
//   - 平台事实（已核实）：布局三栏 sidebar | conversation | details；details 右栏默认关闭
//     （0px），ctx.layout.openDetails() 打开为 360px，AppFrame 渲染右侧 DragHandle 可拖宽。
//     details 槽为 single/scope:session，被 ui-conversation 的 DetailsPanel（priority 0）占用；
//     single 槽最低优先级渲染 → 这里以 priority: -100 注册 details，把右栏内容替换为我们的
//     查看器（DetailsComposite + FileViewerPanel），列宽/关闭拖拽免费获得。
//   - 取舍记录：ui-conversation 的 DetailsPanel（工具调用检查面板）被 shadow 掉——工具调用的
//     JSON 详情不再出现在右栏；轨迹视图 conversation.view 走会话内渲染，不受影响。
//     打开文件状态（root/path）从 Composed 提升到模块级 viewer-store（src/client/viewer-store.ts），
//     sidebar（Composed）与 details（DetailsComposite）两处消费。
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { SidebarComposite } from "./SidebarComposite.tsx";
import { FileViewerPanel } from "./FileViewerPanel.tsx";
import { Api } from "./api.ts";
import { resolveRoot, type SessionsSnapshot, type WorkspacesSnapshot } from "./tree-utils.ts";
import { closeViewer, openViewer, useViewerState } from "./viewer-store.ts";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { ModeKeyButton } from "./ModeKeyButton.tsx";
import { IconOnlySettingsTrigger } from "./IconOnlySettingsTrigger.tsx";
import { ensureSettingsCompactCss } from "./settings-compact.ts";
import { getMode, subscribeMode } from "./mode-store.ts";

// 客户端插件服务依赖（镜像 ui-workspace 的 inject 声明）：slots 在 apply 期使用；
// sessions/workspaces 在动作工厂（点击时）使用；layout（LayoutController：
// toggleSidebar/openDetails/closeDetails）由 ui-layout 提供，打开/关闭右栏用（ui-sidebar
// 同样 inject "layout" 调 ctx.layout.toggleSidebar）。
const inject = ["slots", "layout", "sessions", "workspaces"] as const;

// v0.2.0：增强层注册 disposer 管理——原始模式注销、MyAgent 模式注册。
let enhancementDisposers: Array<() => void> = [];
let appliedCtx: any = null;

function buildActions(ctx: any) {
  return () => ({
    startSession: async (workspaceId?: string) => {
      // 强制新建独立空白会话，不复用已有空白会话（否则连续点“新对话”会没反应）。
      let target = workspaceId;
      if (target === undefined) {
        const ws = ctx.workspaces.list.getSnapshot();
        const sessions = ctx.sessions.list.getSnapshot();
        const currentWorkspaceId =
          sessions.current === undefined
            ? undefined
            : ws.items.find((item: any) => (item.sessionIds ?? []).includes(sessions.current))?.workspaceId;
        target = currentWorkspaceId ?? ws.recentWorkspaceId;
      }
      if (target === undefined) {
        ctx.workspaces.startSession();
        return;
      }
      const sessionId = await ctx.sessions.create({ workspaceId: target });
      ctx.sessions.open(sessionId);
    },
    // 新建工作沙盒（Round 3）：宿主原生目录选择器选一个已存在目录 → workspace.create 注册。
    // wire payload 已核实（dsh-host-apiproxy lib/types/api/workspace.schema.d.ts）：
    // workspace.create 请求只有 { path: string }（title 缺省，由 registry 用路径 basename 命名）。
    // pickDirectory() 用户取消返回 null（dsh-client-runtime client.js 注释），静默跳过。
    addWorkspace: async () => {
      const path = await ctx.workspaces.pickDirectory();
      if (path === null) return; // 用户取消，静默
      await ctx.workspaces.create({ path });
    },
    open: (sessionId: string) => {
      ctx.sessions.open(sessionId);
    },
    renameSession: async (sessionId: string, title: string) => {
      const session = ctx.sessions.binding(sessionId)?.session;
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`);
      const result = await session.rename(title);
      if (!result.ok) throw new Error(result.error.message);
    },
    renameWorkspace: async (workspaceId: string, title: string) => {
      await ctx.workspaces.rename(workspaceId, title);
    },
    deleteWorkspace: async (workspaceId: string) => {
      await ctx.workspaces.delete(workspaceId);
    },
    archiveSession: async (sessionId: string) => {
      await ctx.workspaces.archiveSession(sessionId);
    },
    // 拖拽排序（Round 2）：与 ui-workspace 语义一致——beforeWorkspaceId/beforeSessionId
    // 省略（undefined）时追加到末尾（runtime client.js insertBefore 注释：omitted appends）。
    insertWorkspaceBefore: async (workspaceId: string, beforeWorkspaceId?: string) => {
      await ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId);
    },
    insertSessionBefore: async (workspaceId: string, sessionId: string, beforeSessionId?: string) => {
      await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId);
    },
    // 右栏（details）开合：FileTree onOpenFile → openDetails；面板关闭 → closeDetails。
    openDetails: () => {
      ctx.layout.openDetails();
    },
    closeDetails: () => {
      ctx.layout.closeDetails();
    },
    // v1 未提供 UI 入口的动作（留注释，后续补齐）：
    // forkSession / searchSessions / searchResultLimit —— v1 精简，未实现。
  });
}

function registerEnhancements(ctx: any) {
  if (enhancementDisposers.length > 0) return;
  const actions = buildActions(ctx);
  enhancementDisposers.push(
    ctx.slots.register({ name: "sidebar.workspaces", priority: -100, inject: actions }, Composed),
  );
  enhancementDisposers.push(
    ctx.slots.register(
      { name: "details", priority: -100, inject: () => ({ closeDetails: () => ctx.layout.closeDetails() }) },
      DetailsComposite,
    ),
  );
}

function unregisterEnhancements() {
  for (const d of enhancementDisposers) d();
  enhancementDisposers = [];
}

function syncEnhancements() {
  if (appliedCtx === null) return;
  if (getMode() === "myagent") registerEnhancements(appliedCtx);
  else unregisterEnhancements();
}


function apply(ctx: any) {
  appliedCtx = ctx;
  // 增强层（沙盒文件树/查看器）：按模式注册；启动默认 MyAgent。
  syncEnhancements();
  subscribeMode(syncEnhancements);

  // 底栏：模式键（list 槽，常驻两种模式）。
  ctx.slots.inject("sidebar.footer.action", () =>
    ctx.slots.register({ name: "sidebar.footer.action", id: "dsh-myagent-mode", order: 0 }, ModeKeyButton),
  );

  // 设置键：顶掉官方 settings.trigger 的文字（single 槽 p-100，点击仍由官方外层持有）。
  ctx.slots.inject("settings.trigger", () =>
    ctx.slots.register({ name: "settings.trigger", priority: -100 }, IconOnlySettingsTrigger),
  );
  // 设置键外观：28x28 小图标 + 与模式键并排（官方宽条覆写，见 settings-compact.ts）。
  ensureSettingsCompactCss();
}

// 槽位组件（模块级 function 声明：互相引用靠提升；放在 register 实参里的命名函数表达式
// 不提升、名字对外不可见，无法让 Composed 引用 ComposedInner）。

// 组合组件：槽位标准套件（useSessions/useWorkspaces/wide/expandSidebar）与 inject 动作
// 会作为 props 展开进来。root/api 提升到这一层：inject 工厂不建 api（api 依赖 root，
// root 从会话/工作沙盒推导，只能组件层算）。打开文件改走 viewer-store（模块级）：
// openViewer(api.root, path) + props.openDetails()，details 槽的 DetailsComposite 消费
// 同一状态渲染 FileViewerPanel（同一 root → 同一 Api 语义，read 拿到的版本号才能用于
// write 的防覆盖守卫）。
// 错误边界（根因修复配套）：边界包在 hooks 之上，ComposedInner 里任何渲染错误（含
// resolveRoot 对投影字段的访问）都只降级为局部占位 + 重试，不再让 slots supervisor
// abdicate 整个 sidebar.workspaces 注册（原：渲染抛错 → 左栏回退原版）。
function Composed(props: any) {
  return React.createElement(
    ErrorBoundary,
    { label: "工作沙盒列表" },
    React.createElement(ComposedInner, props),
  );
}

function ComposedInner(props: any) {
  const sessions = props.useSessions((s: SessionsSnapshot) => s);
  const workspaces = props.useWorkspaces((s: WorkspacesSnapshot) => s);
  const root = useMemo(() => resolveRoot(sessions, workspaces), [sessions, workspaces]);
  // root 变化（切换工作沙盒）时关闭查看器，防止上一个工作沙盒的查看器残留。
  useEffect(() => {
    closeViewer();
  }, [root]);
  const api = useMemo(() => (root === null ? null : new Api(root)), [root]);
  const onOpenFile = useCallback(
    (p: string) => {
      if (api === null) return;
      openViewer(api.root, p);
      props.openDetails?.();
    },
    [api, props],
  );
  return React.createElement(SidebarComposite, { ...props, api, onOpenFile });
}

// details 槽（Round 2）：以 priority: -100 覆盖 ui-conversation 的 DetailsPanel（priority 0）。
// DetailsComposite 读 viewer-store：有 path → FileViewerPanel；无 → 空态（details 列保持
// 打开显示占位，与原生 DetailsPanel 空态一致）。inject 提供 closeDetails（面板关闭按钮）。
// 错误边界同上：任何渲染错误只降级局部占位。
// details 槽（Round 2）：以 priority: -100 覆盖 ui-conversation 的 DetailsPanel（priority 0）。
// DetailsComposite 读 viewer-store：有 path → FileViewerPanel；无 → 空态（details 列保持
// 打开显示占位，与原生 DetailsPanel 空态一致）。inject 提供 closeDetails（面板关闭按钮）。
// 错误边界同上：任何渲染错误只降级局部占位。
//
// 打开文件时把 details 列加宽（用户反馈：右侧查看栏默认/最大宽度太小）：
// 宿主三栏是 grid（非 flex），直接在挂载后改写 grid-template-columns，
// 让查看器获得比默认 360px / 上限 520px 更宽的可视区域。
function applyHalfSplit(panelEl: HTMLElement | null) {
  if (!panelEl) return;
  let el: HTMLElement | null = panelEl;
  while (el) {
    const parent: HTMLElement | null = el.parentElement;
    if (!parent) break;
    const parentStyle = getComputedStyle(parent);
    if (parentStyle.display === "grid") {
      const viewport = parent.clientWidth || window.innerWidth;
      const cols = parentStyle.gridTemplateColumns.trim().split(/\s+/);
      const sidebar = parseFloat(cols[0] ?? "") || 280;
      const minCenter = 360;
      const maxDetails = Math.max(360, viewport - sidebar - minCenter);
      const preferred = Math.min(880, Math.max(560, Math.round(viewport * 0.45)));
      const details = Math.min(preferred, maxDetails);
      const center = Math.max(minCenter, viewport - sidebar - details);
      parent.style.gridTemplateColumns = `${sidebar}px ${center}px ${details}px`;
      parent.removeAttribute("data-details-collapsed");
      break;
    }
    if (
      parentStyle.display.includes("flex") &&
      parent.children.length > 1 &&
      el.offsetWidth < parent.clientWidth - 1
    ) {
      // 旧版布局为 flex 时的兼容分支，保持原来的 1:1 对分。
      el.style.flex = "1 1 0%";
      el.style.width = "auto";
      el.style.maxWidth = "none";
      el.style.minWidth = "0";
      const prev = el.previousElementSibling as HTMLElement | null;
      if (prev && prev.parentElement === parent) {
        const prevStyle = getComputedStyle(prev);
        // 不覆盖固定宽度侧栏；只把看起来是弹性列的相邻列也设为均分。
        if (prevStyle.flexGrow !== "0" || prevStyle.flexShrink !== "0") {
          prev.style.flex = "1 1 0%";
          prev.style.minWidth = "0";
        }
      }
      break;
    }
    el = parent;
  }
}

function DetailsComposite(props: any) {
  return React.createElement(
    ErrorBoundary,
    { label: "沙盒文件查看器" },
    React.createElement(DetailsCompositeInner, props),
  );
}

function DetailsCompositeInner(props: any) {
  const { root, path } = useViewerState();
  // 稳定 api 实例：details 槽常驻挂载，AppFrame 在布局变更（details 分割条拖拽、
  // sidebar 拖拽、resize）时整体重渲染，若内联 new Api(root) 每次渲染重建实例，
  // FileViewerPanel 的 reload effect 会把 api 当作依赖重放 → 拖拽中重载文件、
  // 清掉未保存草稿。useMemo 让 api 只在 root 变化时重建。
  const api = useMemo(() => (root === null ? null : new Api(root)), [root]);
  const rootRef = useRef<HTMLDivElement>(null);
  // 打开文件时（path 非空且挂载后）把右栏调整为与对话 1:1。
  useLayoutEffect(() => {
    if (path !== null) applyHalfSplit(rootRef.current);
  }, [path]);
  const empty = React.createElement(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontSize: 13,
        textAlign: "center",
        color: "var(--dsw-alias-label-secondary)",
        background: "var(--dsw-alias-bg-layer-1)",
        borderLeft: "1px solid var(--dsw-alias-border-l2)",
        boxSizing: "border-box",
      },
    },
    "从左侧沙盒文件树打开文件",
  );
  const viewer = root === null || path === null
    ? empty
    : React.createElement(FileViewerPanel, {
        // key=path：path 变化强制重挂载，在途 reload/save 完成回调落在已卸载实例上
        // （React 18 无害 no-op），根除"旧文件内容串到新文件"的竞态。
        key: path,
        // 上面空态早退已保证 root !== null → api 非空；! 仅收窄联合类型，
        // 传的仍是 useMemo 缓存的同一实例（不是每渲染新建）。
        api: api!,
        path,
        onClose: () => {
          closeViewer();
          props.closeDetails?.();
        },
      });
  return React.createElement(
    "div",
    { ref: rootRef, style: { width: "100%", height: "100%", minWidth: 0 } },
    viewer,
  );
}

export { apply, inject };

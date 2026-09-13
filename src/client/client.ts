// src/client/client.ts — 浏览器半区正式入口（dsh 0.1.5 槽位契约版）。
//
// 【0.1.5 迁移要点（本次更新的根因）】
// dsh 0.1.5-rc 把"平铺槽位表"换成了**声明账本树**：一个槽位只有被某个父条目的
// children 表声明过才存在，`ctx.slots.register` 对未声明的槽位**直接抛错**
// （"slot X is not declared (a parent entry's children table must declare it)"），
// 而注册进"已被声明"的槽位必须走 `ctx.slots.inject(key, () => register(...))`——
// inject 会在声明已存在时同步执行、否则挂到声明提交后再执行，并在声明塌陷时自动撤销。
// 因此：**任何 slots.register 都必须嵌在 slots.inject 里**，直连注册会在插件加载期炸掉
// 整个 loader 条目（本插件此前的报错）。
//
// 槽位归属（源码实证，安装包 0.1.5-rc.2）：
//   - ui-sidebar 的 `sidebar` 条目声明 sidebar.workspaces / sidebar.settings /
//     sidebar.footer.action / sidebar.brand.* / sidebar.panellist。
//   - ui-settings-general 的 `sidebar.settings` 条目声明 settings.trigger 等。
//
// 【左上角 logo 块 = MYAGENT 字样的落点】0.1.5-rc 起 ui-sidebar 把 logo 行拆成
// sidebar.brand.mark（官方 ui-brand-official 填鲸鱼 FishLogo）与 sidebar.brand.name
// （填 BrandWordmark 字标）两个 single 子槽。本插件在 **name** 槽上用 priority -100 顶掉
// 官方字标，自己渲染「官方字标（17px）+ 竖线 + MYAGENT」，鲸鱼不动（见 MyAgentBrand.tsx）。
//
// 【布局：文件树留在左栏，预览交给官方右栏】
// 0.1.5 删掉了 `details` 槽与 ctx.layout.openDetails/closeDetails，右栏改由 ui-sidebar-right
// 的标签页系统接管（ctx.sidebarRight 导航控制器 + ctx.sidebarRightTabs 类型注册表），并自带
// 官方文件预览（@deepseek-ai/dsh-client-ui-sidebar-documentpreview，Markdown/代码/图片/PDF/
// HTML/纯文本渲染器）。
// 本插件**不再自带查看器**（旧 FileViewerPanel/CsvTable 已删）：左侧树点击文件 →
// ctx.sidebarRight.openResource(会话作用域 file 地址) → 官方预览标签页接管渲染。
// 官方预览只认 session 作用域地址（canOpen: scope === "session"），故地址必须带会话，
// 见 file-address.ts 与 tree-utils.ts 的 sessionForRoot。
//
// 左侧栏维持 myagent 原布局：priority -100 压掉官方 ui-workspace 的 sidebar.workspaces，
// 自渲染 WorkspaceBrowser + FileTree（上下分区 + 拖拽分割 + 独立折叠）。
//
// 【取消官方右栏文件树】
// MyAgent 模式下用 extension 档**接管 kind "files"**（官方 ui-sidebar-files 是 builtin 档），
// 使官方文件树从 guide capsule 与标签类型表里消失（文件浏览统一由左栏承担）。
// 只有类型定义被接管，**文件预览是另一个 kind（"text"），照旧工作**。退出 MyAgent 模式即恢复。
// 详见 filesShadowDefinition 的注释。
//
// 【图片预览：拖动平移 + 滚轮缩放】
// 官方预览把"渲染器"做成了公开注册表 ctx.documentPreviews，extension 档优先于内建实现。
// 本插件只注册**图片扩展名**的渲染器（详见 image-panzoom.tsx），其余渲染器全归官方。
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { SidebarComposite } from "./SidebarComposite.tsx";
import { Api } from "./api.ts";
import {
  resolveRoot,
  resolveAbsPath,
  sessionForRoot,
  type SessionsSnapshot,
  type WorkspacesSnapshot,
} from "./tree-utils.ts";
import { fileAddressFor } from "./file-address.ts";
import { IMAGE_PANZOOM_ID, imagePanZoomDefinition } from "./image-document.ts";
import { ImagePanZoom } from "./image-panzoom.tsx";
import { clearActiveRoot, useActiveRoot } from "./active-root-store.ts";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { ModeKeyButton } from "./ModeKeyButton.tsx";
import { MyAgentBrandName } from "./MyAgentBrand.tsx";
import { IconOnlySettingsTrigger } from "./IconOnlySettingsTrigger.tsx";
import { ensureSettingsCompactCss } from "./settings-compact.ts";
import { getMode, subscribeMode } from "./mode-store.ts";
import { FONT_SECONDARY } from "./ui-kit.ts";

// 客户端插件服务依赖：slots 注册槽位；sessions/workspaces 推导工作区根与会话；
// sidebarRight 打开右栏预览标签页（导航控制器）；sidebarRightTabs 用于接管官方文件树类型
// （见 registerEnhancements 里"取消官方文件树"一段）。
// layout 已不需要：details 槽在 0.1.5 中删除。
const inject = ["slots", "sessions", "workspaces", "sidebarRight", "sidebarRightTabs"] as const;

/**
 * 官方右栏文件树的 kind（@deepseek-ai/dsh-client-ui-sidebar-files 注册的**页面**类型）。
 * 它带一个 guide capsule，是"工作区文件"页的唯一入口。
 */
const OFFICIAL_FILES_KIND = "files";
/** 接管官方文件树所用的类型 id（类型系统里全局唯一，用包名风格）。 */
const FILES_SHADOW_ID = "dsh-myagent/files-removed";

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
    // 新建工作区：宿主原生目录选择器选一个已存在目录 → workspace.create 注册。
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
    // 拖拽排序：beforeWorkspaceId/beforeSessionId 省略（undefined）时追加到末尾
    // （runtime client.js insertBefore 注释：omitted appends）。
    insertWorkspaceBefore: async (workspaceId: string, beforeWorkspaceId?: string) => {
      await ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId);
    },
    insertSessionBefore: async (workspaceId: string, sessionId: string, beforeSessionId?: string) => {
      await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId);
    },
  });
}

/**
 * 在右侧栏用**官方预览**打开一个工作区内的文件（FileTree onOpenFile 的落点）。
 *
 * 不带 options.kind：让类型注册表按 patterns 排名认领 → 官方文件预览（fallback 档）接管。
 * 同一地址第二次打开只是聚焦原标签页（资源标签页按 (kind, contentId) 去重）。
 *
 * @param sessionId - 地址归属会话；宿主按地址里的会话解析相对路径，必须与 cwd 同属一个根。
 * @param cwd - 该会话的工作区根。
 * @param absPath - 待打开的绝对路径。
 */
function openFileInPreview(ctx: any, sessionId: string, cwd: string, absPath: string): void {
  try {
    ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, absPath));
  } catch (err) {
    // 没有挂载中的会话面板时 openResource 会抛（"no seat mounted"）；点击不应炸掉左栏。
    console.warn("[dsh-myagent] cannot open preview tab", err);
  }
}

/**
 * 接管官方右栏文件树用的类型定义（MyAgent 模式下才注册）。
 *
 * 机制：类型注册表规定"一个 kind 至多一个 builtin + 一个 extension，extension 在档"，
 * 所以用 extension 档注册**同 kind** 就能把官方文件树（builtin）压下去——
 * 注册表的 cached / guideEntries 都取自 `active()`（只有在档类型），于是
 *   - guide 页不再出现"工作区文件"capsule（唯一入口消失）；
 *   - 标签类型表（标签栏 "+" 用）里也不再列出它。
 * 注意**故意不给 patterns**：这是页面类型，不认领任何地址 —— 官方文件预览
 * （kind "text"、fallback 档、认领 dsh-resource://file/**）与它不同 kind，完全不受影响。
 * 退出 MyAgent 模式时本注册被 dispose，官方文件树原样恢复。
 */
function filesShadowDefinition() {
  return {
    id: FILES_SHADOW_ID,
    kind: OFFICIAL_FILES_KIND,
    priority: "extension",
    // title 只在 placeTab 打开该页时用到；该页已无入口，给个可读名字即可。
    title: () => "工作区文件",
    // 没有 guide 字段 = 不上 guide 页；没有 patterns = 不参与任何地址认领。
  };
}

function registerEnhancements(ctx: any) {
  if (enhancementDisposers.length > 0) return;
  const actions = buildActions(ctx);

  // 左上角 logo 块：官方把这块拆成了两个子槽位（sidebar.brand.mark = 鲸鱼，
  // sidebar.brand.name = DeepSeek Harness 字标，由 ui-brand-official 填）。这里只顶掉
  // **name** 槽（priority -100 压官方条目的 0），在槽内渲染「官方字标 + 竖线 + MYAGENT」；
  // 鲸鱼标记不动。挂在增强层上 → 切回标准模式即撤销、官方字标原样恢复。详见 MyAgentBrand.tsx。
  enhancementDisposers.push(
    ctx.slots.inject("sidebar.brand.name", () =>
      ctx.slots.register({ name: "sidebar.brand.name", priority: -100 }, MyAgentBrandName),
    ),
  );

  // 左栏：等 sidebar.workspaces 被 ui-sidebar 的 sidebar 条目声明后再注册。
  // priority -100 压掉官方 ui-workspace（priority 0）；single 槽"最低优先级渲染"。
  enhancementDisposers.push(
    ctx.slots.inject("sidebar.workspaces", () =>
      ctx.slots.register({ name: "sidebar.workspaces", priority: -100, inject: actions }, Composed),
    ),
  );

  // 取消官方右栏文件树：extension 档接管 kind "files"（MyAgent 模式下）。
  enhancementDisposers.push(
    ctx.effect(() => ctx.sidebarRightTabs.register(filesShadowDefinition()), "dsh-myagent: hide official files type"),
  );
  // 接管后 body 按"在档类型的 id"派发（TabSlot 用 definition.id 作 entryKey）。
  // 老会话里可能已经开着官方文件树标签页，这里给它一个说明性占位，而不是让右栏显示
  // "这类内容还没有可用的查看方式"（那会让人以为坏了）。
  enhancementDisposers.push(
    ctx.slots.inject("sidebar.right.pane.tab", () =>
      ctx.slots.register({ name: "sidebar.right.pane.tab", key: FILES_SHADOW_ID }, FilesRemovedBody),
    ),
  );

  // 图片预览：只接管图片扩展名的**文档渲染器**，加鼠标拖动平移 + 滚轮缩放。
  //
  // 两段注册，分别挂在自己的生命周期上：
  //  1) body 挂 sidebar.right.tab.document（keyed，key = 渲染器 id）。该槽由官方预览的标签
  //     条目声明，所以"槽位存在"本身就说明官方预览在场；其余渲染器一个都不碰。
  //  2) 渲染器定义要写进官方的 ctx.documentPreviews 注册表。**不能**用 ctx.get() 取——cordis
  //     里未在 inject 声明的服务取不到（实测返回 undefined）；也**不能**把 documentPreviews
  //     写进本插件的 inject 数组——那样官方预览一旦被禁用，服务永不出现，本插件（包括左栏
  //     文件树）就整个不激活了。正确姿势是动态注入 `ctx.inject([...], scope => ...)`：
  //     服务出现时才回调，缺席则本段永不执行，插件其余部分照常。
  enhancementDisposers.push(
    ctx.slots.inject("sidebar.right.tab.document", () =>
      ctx.slots.register({ name: "sidebar.right.tab.document", key: IMAGE_PANZOOM_ID }, ImagePanZoom),
    ),
  );
  const imageRendererHandle = ctx.inject(["documentPreviews"], (scope: any) => {
    scope.effect(
      () => scope.documentPreviews.register(imagePanZoomDefinition()),
      "dsh-myagent: image pan/zoom renderer",
    );
  });
  // ctx.inject 的返回值在 cordis 里是 fiber（可 dispose），不是普通函数；两种形态都兜住，
  // 否则模式切换时 unregisterEnhancements 会在它上面抛错。
  enhancementDisposers.push(
    typeof imageRendererHandle === "function"
      ? imageRendererHandle
      : () => imageRendererHandle?.dispose?.(),
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
  // 增强层（区文件树）：按模式注册；启动默认 MyAgent。
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
// root 从会话/工作区推导，只能组件层算）。
// 错误边界（根因修复配套）：边界包在 hooks 之上，ComposedInner 里任何渲染错误都只降级为
// 局部占位 + 重试，不再让 slots supervisor abdicate 整个 sidebar.workspaces 注册。
function Composed(props: any) {
  return React.createElement(
    ErrorBoundary,
    { label: "工作区列表" },
    React.createElement(ComposedInner, props),
  );
}

function ComposedInner(props: any) {
  const sessions: SessionsSnapshot = props.useSessions((s: SessionsSnapshot) => s);
  const workspaces: WorkspacesSnapshot = props.useWorkspaces((s: WorkspacesSnapshot) => s);
  // 文件树根：用户点"区"标签显式指定的优先；没指定时才回落到"当前会话所属工作区"。
  // 显式选择还要校验该区仍存在（工作区可能被删），否则同样回落到推导值。
  const manualRoot = useActiveRoot();
  const root = useMemo(() => {
    const derived = resolveRoot(sessions, workspaces);
    if (manualRoot !== null && workspaces.items.some((w) => w.path === manualRoot)) return manualRoot;
    return derived;
  }, [manualRoot, sessions, workspaces]);
  const api = useMemo(() => (root === null ? null : new Api(root)), [root]);
  const ctx = appliedCtx;

  // 切换会话时放弃显式选择：让文件树重新跟着会话走（点区标签的意图只属于"当前这一次"）。
  const currentSession = sessions.current;
  const lastSession = useRef<string | undefined>(currentSession);
  useEffect(() => {
    if (lastSession.current === currentSession) return;
    lastSession.current = currentSession;
    clearActiveRoot();
  }, [currentSession]);

  // 打开文件 → 官方右栏预览标签页。地址里的会话必须与 api.root 同属一个根，
  // 否则宿主会按另一个会话的根去解析相对路径（读错文件）。
  const onOpenFile = useCallback(
    (p: string) => {
      if (api === null || ctx === null) return;
      const target = sessionForRoot(sessions, workspaces, api.root);
      if (target === null) {
        console.warn("[dsh-myagent] no session belongs to workspace", api.root);
        return;
      }
      openFileInPreview(ctx, target.sessionId, target.cwd, resolveAbsPath(api.root, p));
    },
    [api, ctx, sessions, workspaces],
  );
  return React.createElement(SidebarComposite, { ...props, api, onOpenFile });
}

/**
 * 被接管的官方文件树标签页的占位内容。
 *
 * 只在"老会话里已经开着官方文件树标签页"时可见（新会话里该页已无入口）。
 * 一句话说明去哪儿找文件树，避免右栏出现语义错误的"无法查看此类内容"提示。
 */
function FilesRemovedBody() {
  return React.createElement(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: 16,
        fontSize: FONT_SECONDARY,
        lineHeight: 1.6,
        textAlign: "center",
        color: "var(--dsw-alias-label-secondary)",
      },
    },
    "官方文件树已在 MyAgent 模式中隐藏，请使用左侧的「区文件树」浏览文件。",
  );
}

export { apply, inject };

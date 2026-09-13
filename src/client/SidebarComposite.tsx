// src/client/SidebarComposite.tsx — 上下分区复合组件（Branch A；UI polish 轮升级）：
// 上：WorkspaceBrowser；下：FileTree。两区之间加可拖拽分割线（ratio state，初始 0.55，
// clamp 0.2–0.8；Pointer Capture + touch-action:none，触屏/鼠标皆可拖）。
// root/api 由 client.ts（Composed）推导后传入；点击文件由 client.ts 的 onOpenFile 转成
// 会话作用域 file 地址，在右侧栏用**官方预览**标签页打开（0.1.5 起 myagent 不再自带查看器）。
// api 为 null（无工作区）时 FileTree 显示占位（不调用 API）。
// 颜色走 --dsw-* token（sidebar 填充用 --dsw-specific-sidebar-fill，与宿主侧栏一致）。
//
// 两区独立折叠（UI 轮新增"边缘窄条 + 让位"；区文件树本轮恢复收起按钮，改为"向上收起"：
// 区文件树收起后窄条渲染在容器顶部、工作区区占满）。wsCollapsed / fsCollapsed 各自独立、
// localStorage 持久化（fm.ws-collapsed / fm.fs-collapsed）。折叠切换按钮经 headerExtra prop
// 注入各区标题栏右侧（icon-only，IconPanelLeftOutline16）。折叠态布局：
//   - 收起工作区区 → 顶部 32px 边缘窄条，区文件树占满（向下让位）。
//   - 收起区文件树 → 窄条在容器最顶部（向上收起），工作区区占满。
//   - 两区都收起：文件窄条 + 工作区窄条 + 中间留空。分割线仅两区都展开时显示。
//   - 宿主整体 rail 模式（props.wide === false）：不渲染区级折叠按钮与窄条逻辑（rail 里没
//     空间），直接返回 **RailPanel** —— 两颗区标（工作区 / 文件树）+ 正在进行的任务点列，
//     不再渲染工作区图标列表（旧的"点文件夹 = 新建对话"由此消失）。
import React, { useRef, useState } from "react";
import { IconFolderClose16, IconPanelLeftOutline16 } from "@deepseek-ai/dsh-client-ui-primitives";
import { WorkspaceBrowser, type WorkspaceBrowserProps } from "./WorkspaceBrowser.tsx";
import { FileTree } from "./FileTree.tsx";
import { FileBadgeFrame } from "./FileBadge.tsx";
import { RailPanel } from "./RailPanel.tsx";
import { clearActiveRoot } from "./active-root-store.ts";
import { FONT_SECONDARY, HEADER_BORDER, RADIUS, SCROLLBAR_CSS } from "./ui-kit.ts";

export interface SidebarCompositeProps extends WorkspaceBrowserProps {
  onOpenFile: (path: string) => void;
}

const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

// 工作区/区文件树折叠态持久化（布尔；风格与 WorkspaceBrowser 的 COLLAPSED_KEY 一致：
// try/catch 读写，localStorage 不可用时静默降级为会话内记忆）。
const WS_COLLAPSED_KEY = "fm.ws-collapsed";
const FS_COLLAPSED_KEY = "fm.fs-collapsed";

function readCollapsed(key: string): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === "true";
  } catch {
    return false;
  }
}

function writeCollapsed(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // localStorage 不可用（隐私模式/配额）时静默降级为会话内记忆。
  }
}

// 手柄 hover / 键盘 focus-visible / 拖拽高亮统一走注入样式 + className。分割线常态就要
// 明显：2px 亮色条（border-l2），hover/聚焦/拖拽 3px + 更亮（label-secondary）。
const SPLITTER_CSS = `
.fm-splitter-handle:hover,
.fm-splitter-handle:focus-visible,
.fm-splitter-handle.fm-splitter-dragging {
  background: var(--dsw-alias-interactive-bg-hover);
}
.fm-splitter-handle:hover .fm-splitter-bar,
.fm-splitter-handle:focus-visible .fm-splitter-bar,
.fm-splitter-handle.fm-splitter-dragging .fm-splitter-bar {
  height: 3px;
  background: var(--dsw-alias-label-secondary);
}
.fm-splitter-bar {
  height: 2px;
  background: var(--dsw-alias-border-l2);
}
`;

// 边缘窄条 hover 高亮（纯 CSS，类名 fm-edge-strip）：基础背景也放 CSS 而非内联——
// 内联 style 优先级高于类选择器，会把 :hover 规则盖掉。
const EDGE_STRIP_CSS = `
.fm-edge-strip{background:var(--dsw-alias-bg-layer-1)}
.fm-edge-strip:hover{background:var(--dsw-alias-interactive-bg-hover)}
`;

// 展开过渡动画：标题栏按钮依次向左滑出（stagger）。最右侧的"收起"键（headerExtra，无
// fm-tb-btn 类）不参与动画、保持原位；其余按钮在每次展开（重新挂载）时按 nth-child 延迟
// 依次滑入。收起方向的动画不做（收起时按钮随条件渲染直接消失，观感自然）。
const BTN_ANIM_CSS = `
@keyframes fm-btn-in {
  from { opacity: 0; transform: translateX(14px); }
  to { opacity: 1; transform: none; }
}
.fm-tb-btn { animation: fm-btn-in 0.22s ease backwards; }
`;

// 渐变滚动条（区内容滚动区，上界在标题栏下方）：thumb 常态半透明、hover 加深（渐显感）；
// Firefox 用 scrollbar-width/scrollbar-color。scrollbar-gutter: stable 由各滚动区内联设置。
// 本轮改为官方 token（--dsw-alias-scrollbar-bg-l2 / -hover-l2，官方 ui-sidebar 同款接线），
// 不再是硬编码 rgba —— 暗/亮主题都跟随官方配色。实现见 ui-kit.ts 的 SCROLLBAR_CSS。

// 折叠/展开按钮：绝对定位在区容器右上角——展开与收起两种状态下坐标完全一致（不随动画
// 移动）。收起态图标由 foldButton 提供（原 path 反色：黑线条 + 白内部）；按钮背景保持
// 深色不变，仅 hover 保留淡色交互反馈。
const FOLD_BTN_CSS = `
.fm-fold-btn {
  position: absolute;
  top: 4px;
  right: 2px;
  z-index: 5;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: ${RADIUS.icon}px;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: none;
  transition: background .15s ease;
}
.fm-fold-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.fm-fold-btn-active,
.fm-fold-btn-active:hover {
  background: transparent;
}
`;

/** 收起态的"边缘窄条"：区标识图标 + 标题文字 + 展开按钮，点击整条展开（让位给另一区）。
 *  常驻在区容器底层（内容层覆盖其上）；hidden = 展开态（透明 + 不可点，过渡隐藏）。 */
function EdgeStrip(props: {
  icon: React.ReactNode;
  title: string;
  label: string;
  onClick: () => void;
  border: "bottom" | "top";
  hidden?: boolean;
}) {
  const { icon, title, label, onClick, border, hidden } = props;
  return (
    <div
      className="fm-edge-strip"
      title={label}
      onClick={onClick}
      style={{
        flex: "none",
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        padding: "0 4px 0 4px",
        cursor: "pointer",
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? "none" : "auto",
        transition: "opacity .15s ease",
        ...(border === "bottom"
          ? { borderBottom: HEADER_BORDER }
          : { borderTop: HEADER_BORDER }),
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--dsw-alias-label-secondary)", fontSize: FONT_SECONDARY }}>
        {icon}
        {title}
      </span>
    </div>
  );
}

/** 折叠/展开按钮：绝对定位在区容器右上角——展开与收起两种状态下坐标完全一致（不随动画
 *  移动）。图标收起/展开保持一致（用户定案：不做反色变化）。 */
function foldButton(label: string, collapsed: boolean, onClick: () => void) {
  return (
    <button
      type="button"
      className={`fm-fold-btn${collapsed ? " fm-fold-btn-active" : ""}`}
      title={label}
      aria-label={label}
      aria-expanded={!collapsed}
      onClick={onClick}
    >
      <IconPanelLeftOutline16 size={16} />
    </button>
  );
}

export function SidebarComposite(props: SidebarCompositeProps) {
  const { api, onOpenFile } = props;
  const [ratio, setRatio] = useState(0.55);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ kind: "ratio"; startY: number; startRatio: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // 两区独立折叠（各自持久化 fm.ws-collapsed / fm.fs-collapsed）。展开/收起带平滑过渡
  // （区容器 height/flex-basis 过渡 + 内容层淡入淡出，内容保持挂载）。标题栏按钮的 stagger
  // 滑入动画依赖重挂载重放：内容保持挂载后按钮不重挂载，故每次"收起→展开"递增展开序号，
  // 作为按钮组 key（toolbarKey）强制按钮组重挂载——按钮动画与容器过渡同时进行、互不吞并。
  const [wsCollapsed, setWsCollapsed] = useState(() => readCollapsed(WS_COLLAPSED_KEY));
  const [fsCollapsed, setFsCollapsed] = useState(() => readCollapsed(FS_COLLAPSED_KEY));
  // 收起态点「工作区」区标 → 记下要定位的工作区，侧栏展开后由 WorkspaceBrowser 消费
  // （展开该工作区 + 滚动到可见）并回调清空。放在这一层是因为 rail 与宽态是同一组件的
  // 两次渲染，state 跨这一次切换得以保留。
  const [revealWorkspaceId, setRevealWorkspaceId] = useState<string | null>(null);
  const [wsExpandSeq, setWsExpandSeq] = useState(0);
  const [fsExpandSeq, setFsExpandSeq] = useState(0);
  // 过渡期间内容层 overflow 置 hidden（裁剪而非滚动）：容器高度过渡时内容层被压缩，
  // 若保持滚动会出现滚动条闪现/跳动（条目多的区文件树尤其明显）——过渡结束后恢复 auto。
  const [wsAnimating, setWsAnimating] = useState(false);
  const [fsAnimating, setFsAnimating] = useState(false);
  const wsTimer = useRef<number | null>(null);
  const fsTimer = useRef<number | null>(null);

  const toggleWs = () => {
    if (wsCollapsed) setWsExpandSeq((s) => s + 1);
    setWsAnimating(true);
    if (wsTimer.current !== null) window.clearTimeout(wsTimer.current);
    wsTimer.current = window.setTimeout(() => setWsAnimating(false), 260);
    setWsCollapsed((v) => {
      const next = !v;
      writeCollapsed(WS_COLLAPSED_KEY, next);
      return next;
    });
  };

  const toggleFs = () => {
    if (fsCollapsed) setFsExpandSeq((s) => s + 1);
    setFsAnimating(true);
    if (fsTimer.current !== null) window.clearTimeout(fsTimer.current);
    fsTimer.current = window.setTimeout(() => setFsAnimating(false), 260);
    setFsCollapsed((v) => {
      const next = !v;
      writeCollapsed(FS_COLLAPSED_KEY, next);
      return next;
    });
  };

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    dragRef.current = { kind: "ratio", startY: e.clientY, startRatio: ratio, height: rect.height };
    setDragging(true);
    // Pointer Capture：拖拽期间所有 pointer 事件路由到手柄元素，移出窗口也能持续跟踪。
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "ratio") {
      const next = d.startRatio + (e.clientY - d.startY) / d.height;
      setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, next)));
    }
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const onHandleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // 与指针拖拽方向一致：拖拽时手柄跟随指针（指针下移 → 上区变高 → ratio 增大），
    // 故键盘 ↑ = ratio 减小（手柄上移）、↓ = ratio 增大（手柄下移）。
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setRatio((r) => Math.max(MIN_RATIO, r - 0.05));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setRatio((r) => Math.min(MAX_RATIO, r + 0.05));
    } else if (e.key === "Home") {
      e.preventDefault();
      setRatio(MIN_RATIO);
    } else if (e.key === "End") {
      e.preventDefault();
      setRatio(MAX_RATIO);
    }
  };

  // 宿主整体 rail 模式（整栏 narrow）：渲染 RailPanel —— 两颗区标（工作区 / 文件树）
  // + 正在进行的任务点列。**不再**渲染工作区图标列表，也不再包 `overflow:auto` 的包装层
  // （那两层是 rail 里多余滑动条的来源：宿主 regionArea 可用宽只有 35px，旧按钮 36px 宽
  // 左右各溢出 1px，再叠 overflow:auto 就成了可见滚动条）。
  if (props.wide === false) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--dsw-specific-sidebar-fill)" }}>
        <RailPanel
          useSessions={props.useSessions}
          useWorkspaces={props.useWorkspaces}
          expandSidebar={props.expandSidebar}
          onRevealWorkspace={(workspaceId) => setRevealWorkspaceId(workspaceId ?? null)}
          // 文件树切回"跟着当前会话走"：清掉手动选的区标签，root 即回到当前主对话的根。
          onRevealFileTree={() => clearActiveRoot()}
          hasFileTree={api !== null}
          open={props.open}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--dsw-specific-sidebar-fill)" }}
    >
      <style>{SPLITTER_CSS}</style>
      <style>{EDGE_STRIP_CSS}</style>
      <style>{BTN_ANIM_CSS}</style>
      <style>{FOLD_BTN_CSS}</style>
      <style>{SCROLLBAR_CSS}</style>
      {/* 布局顺序恒定：工作区区在上、区文件树在下；收起 = 原位窄条（不换顺序）。
          展开/收起平滑过渡：区容器 height/flex-basis 过渡（220ms ease）+ 内容层淡入淡出
          （150ms）。内容层保持挂载（列表状态不因收起丢失），窄条常驻底层、被内容层覆盖。 */}
      {/* 工作区区容器：展开高 = ratio%，收起高 = 32px。拖拽分割线时禁用过渡（即时跟随）。
          内容层时序（两区统一）：收起 = 先淡出（0.15s 无延迟）再收缩；展开 = 容器先长高、
          内容延迟 0.15s 再淡入——避免内容在"收起高度小窗口"里先渲染（条目多时滚动条抖动）。 */}
      <div
        style={{
          position: "relative",
          height: wsCollapsed ? 32 : `${ratio * 100}%`,
          flex: "0 0 auto",
          minHeight: 0,
          transition: dragging ? "none" : "height .22s ease",
          overflow: "hidden",
        }}
      >
        {/* 内容层：展开可见（absolute 铺满），收起淡出并让位给底层窄条。
            滚动在组件内部滚动区；右缘贴容器右缘（滚动条靠右；折叠键在标题栏高度内、
            滚动条上界在标题栏下方，垂直不重叠）。 */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: wsCollapsed ? 0 : 1,
            transition: "opacity .15s ease",
            pointerEvents: wsCollapsed ? "none" : "auto",
            overflow: "hidden",
          }}
        >
          <WorkspaceBrowser
            {...props}
            wide
            toolbarKey={wsExpandSeq}
            scrollLock={wsAnimating}
            revealWorkspaceId={revealWorkspaceId}
            onRevealed={() => setRevealWorkspaceId(null)}
          />
        </div>
        {/* 工作区区标：展开 = 打开的文件夹（标题栏 IconFolderOpen16）；收起 = 原版关闭的文件夹 */}
        <EdgeStrip icon={<IconFolderClose16 size={16} />} title="工作区" label="展开工作区" onClick={toggleWs} border="bottom" hidden={!wsCollapsed} />
        {foldButton(wsCollapsed ? "展开工作区" : "收起工作区", wsCollapsed, toggleWs)}
      </div>
      {/* 分割线：工作区区（上方）展开即可拖（区文件树收起也不影响）；工作区区收起时隐藏。 */}
      {!wsCollapsed ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整区文件树与工作区区高度"
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={MIN_RATIO * 100}
          aria-valuemax={MAX_RATIO * 100}
          tabIndex={0}
          title="拖拽调整分区（↑/↓ 微调）"
          className={`fm-splitter-handle${dragging ? " fm-splitter-dragging" : ""}`}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={onHandleKeyDown}
          style={{
            flex: "none",
            height: 6,
            cursor: "row-resize",
            touchAction: "none", // 触屏拖拽不被滚动吞掉
            display: "flex",
            alignItems: "center",
            outline: "none", // 焦点指示由 :focus-visible 样式提供（背景/指示条变亮）
          }}
        >
          {/* 视觉指示条：常态 2px 亮条，hover/聚焦/拖拽时 3px 更亮（样式见 SPLITTER_CSS）。 */}
          <div className="fm-splitter-bar" style={{ width: "100%", borderRadius: RADIUS.pill }} />
        </div>
      ) : null}
      {/* 区文件树容器：flex 弹性填充——展开时 flex:1 吃掉工作区区（自适应高度）
          之间的全部剩余空间；收起 = 32px。 */}
      <div
        style={{
          position: "relative",
          flex: fsCollapsed ? "0 0 auto" : "1 1 0%",
          height: fsCollapsed ? 32 : undefined,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* 内容层：展开可见（absolute 铺满），收起淡出并让位给底层窄条。
            右缘贴容器右缘（滚动条靠右，与工作区区一致）。 */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: fsCollapsed ? 0 : 1,
            transition: "opacity .15s ease",
            pointerEvents: fsCollapsed ? "none" : "auto",
            overflow: "hidden",
          }}
        >
          {api === null ? (
            <div style={{ padding: 8, fontSize: FONT_SECONDARY, color: "var(--dsw-alias-label-secondary)" }}>无工作区</div>
          ) : (
            <FileTree key={api.root} api={api} onOpenFile={onOpenFile} toolbarKey={fsExpandSeq} scrollLock={fsAnimating} />
          )}
        </div>
        {/* 区文件树标：展开 = 带两条横线（标题栏 FileBadge）；收起 = 横线消失、无内部灰色（原版外框） */}
        <EdgeStrip
          icon={<FileBadgeFrame />}
          title="区文件树"
          label="展开区文件树"
          onClick={toggleFs}
          border="top"
          hidden={!fsCollapsed}
        />
        {foldButton(fsCollapsed ? "展开区文件树" : "收起区文件树", fsCollapsed, toggleFs)}
      </div>

    </div>
  );
}

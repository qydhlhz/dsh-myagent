// src/client/RailPanel.tsx — 左侧栏收起态（rail）面板（用户 2026 重设计，A 方案）。
//
// 背景（实测的现状问题）：
//   ① rail 里冒出**多余滑动条**：宿主 `.hHd-Xa_regionArea` 可用宽只有 35px，而旧 rail 按钮
//      36px 宽、x=6，左右各溢出 1px → `scrollWidth 34 > clientWidth 27`，再叠上包装层的
//      `overflow:auto` 就成了可见滚动条。
//   ② **交互是错的**：旧 rail 为每个工作区渲染一颗文件夹图标，点击走 `startSession(workspaceId)`
//      —— 也就是"点文件夹 = 新建对话"，而用户要的是"展开并定位到那个工作区"。
//   ③ 图标不好看：三个按钮宽度不一致（36/36/28），一列排下来参差。
//
// 新设计（用户定案）：
//   - 不再渲染工作区图标列表，也不再有「新对话」键；
//   - 只留两颗区标：**工作区文件夹**（展开 + 定位到当前主对话所在的工作区）与
//     **文件树**（展开 + 把文件树切回"跟着当前会话走"，即当前主对话对应的根）；
//     两者都取与宽态区标题**同款**的图标，视觉上直接对应它们要展开的那一区；
//   - 下面显示**正在进行的任务**：`running` ∪ `pendingInteraction`（等待批准 / 计划确认 / 问答），
//     每个任务一颗状态点，悬停出「标题 · 状态」，点击打开该会话；
//   - 全部按钮统一 32×32 正圆、字形 15px（官方 .tool / .iconButton 的字形档），不再溢出。
import React, { useMemo } from "react";
import { IconFolderOpenMedium } from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  SelectorHook,
  SessionDotKind,
  SessionStatus,
  SessionStatusHook,
  SessionsSnapshot,
  WorkspacesSnapshot,
} from "./tree-utils.ts";
import { mainSessionId, sessionDotKind, SESSION_DOT_LABEL } from "./tree-utils.ts";
import { FileBadge } from "./FileBadge.tsx";
import { dotPresentation, RAIL_BUTTON_SIZE, RAIL_DOT_SIZE, RAIL_MAX_TASKS, STATUS_DOT_CSS } from "./ui-kit.ts";

/** rail 只列"正在进行"的四种状态：运行中 + 三种等待用户（空闲/已完成/空白/当前都不算）。 */
function isActiveKind(kind: SessionDotKind): boolean {
  return kind === "running" || kind === "approval" || kind === "plan-review" || kind === "question";
}

const RAIL_CSS = `
.fm-rail{display:flex;flex-direction:column;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:2px 0 0}
.fm-rail-btn{
  width:${RAIL_BUTTON_SIZE}px;height:${RAIL_BUTTON_SIZE}px;flex:none;
  display:inline-flex;align-items:center;justify-content:center;
  padding:0;border:none;border-radius:999px;background:transparent;cursor:pointer;
  color:var(--dsw-alias-label-tertiary);
}
.fm-rail-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.fm-rail-btn:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
/* 字形统一 15px：官方 .tool / .iconButton 就是 28px 方框配 15px 字形（CSS 定尺寸）。 */
.fm-rail-btn svg{width:15px;height:15px}
.fm-rail-sep{width:20px;height:1px;background:var(--dsw-alias-border-l3);margin:1px 0;flex:none}
.fm-rail-more{font-size:10px;line-height:12px;color:var(--dsw-alias-label-tertiary);flex:none}
`;
// 任务点（.fm-dot / .fm-dot-pulse / .fm-dot-attention）来自 ui-kit 的 STATUS_DOT_CSS：
// 与宽态会话行共用同一套配色与动效（运行 = 蓝·呼吸，等待用户 = 琥珀/亮黄·双闪 + 光环）。

export interface RailPanelProps {
  useSessions: SelectorHook<SessionsSnapshot>;
  useWorkspaces: SelectorHook<WorkspacesSnapshot>;
  /**
   * 槽位全局标准套件给的统一 UI 状态选择器（dsh-client-ui-session 的 useSessionStatus）。
   * 等待批准 / 计划确认 / 回答 / 已完成待读都只看这里——会话摘要（useSessions）没有这些位，
   * 只读摘要会把"在等你"显示成"在跑"。可选：缺席时降级为只读摘要的 running。
   */
  useSessionStatus?: SessionStatusHook;
  /** 宿主槽位套件给的回调：把侧栏从收起切回展开。 */
  expandSidebar?: () => void;
  /** 点击「工作区」区标：展开后定位到该工作区（展开其会话列表并滚动到可见）。 */
  onRevealWorkspace: (workspaceId: string | undefined) => void;
  /** 点击「文件树」区标：展开后把文件树切回"跟着当前会话走"。 */
  onRevealFileTree: () => void;
  /** 当前是否有可显示的文件树（无工作区根时不渲染该键）。 */
  hasFileTree: boolean;
  /** 打开会话。 */
  open?: (sessionId: string) => void;
}

export function RailPanel(props: RailPanelProps) {
  const sessions = props.useSessions((s) => s);
  const workspaces = props.useWorkspaces((s) => s);
  const statuses = props.useSessionStatus?.((s) => s);

  // 当前主对话（0.2：按 mainView 引用来源推导，官方 ui-workspace 同款口径）。
  const current = mainSessionId(sessions);

  // 当前主对话所在的工作区（用于「工作区」区标的定位目标）。
  const currentWorkspaceId = useMemo(() => {
    if (current === undefined) return undefined;
    return workspaces.items.find((w) => (w.sessionIds ?? []).includes(current))?.workspaceId;
  }, [current, workspaces.items]);

  // 正在进行的任务：running ∪ 等待批准/计划确认/问答。空闲与已完成不算。
  // 按 workspace 顺序、workspace 内 sessionIds 顺序列出（与宽态列表顺序一致），并去重。
  // 状态判定与宽态会话行**同源**（tree-utils.sessionDotKind）：待交互优先于 running。
  const active = useMemo(() => {
    const archived = new Set(workspaces.archivedSessionIds ?? []);
    const seen = new Set<string>();
    const out: Array<{ id: string; title: string; label: string; kind: SessionDotKind }> = [];
    for (const w of workspaces.items) {
      for (const id of w.sessionIds ?? []) {
        if (seen.has(id) || archived.has(id)) continue;
        seen.add(id);
        const s = sessions.byId[id];
        const kind = sessionDotKind({
          id,
          summary: s,
          status: statuses?.get(id) as SessionStatus | undefined,
          current,
        });
        if (kind === undefined || !isActiveKind(kind)) continue;
        out.push({ id, title: s?.title ?? "未命名会话", label: SESSION_DOT_LABEL[kind], kind });
      }
    }
    return out;
  }, [sessions.byId, current, workspaces.items, workspaces.archivedSessionIds, statuses]);

  const shown = active.slice(0, RAIL_MAX_TASKS);
  const hidden = active.length - shown.length;

  return (
    <div className="fm-rail">
      <style>{RAIL_CSS}</style>
      <style>{STATUS_DOT_CSS}</style>

      {/* 工作区区标：展开 + 定位到当前主对话所在的工作区。 */}
      <button
        type="button"
        className="fm-rail-btn"
        title="展开并定位到当前对话所在的工作区"
        aria-label="展开并定位到当前对话所在的工作区"
        data-myagent-rail="workspace"
        onClick={() => {
          props.onRevealWorkspace(currentWorkspaceId);
          props.expandSidebar?.();
        }}
      >
        <IconFolderOpenMedium size={15} />
      </button>

      {/* 文件树区标：展开 + 文件树切回当前主对话对应的根。无工作区时不渲染。 */}
      {props.hasFileTree ? (
        <button
          type="button"
          className="fm-rail-btn"
          title="展开并显示当前对话的文件树"
          aria-label="展开并显示当前对话的文件树"
          data-myagent-rail="files"
          onClick={() => {
            props.onRevealFileTree();
            props.expandSidebar?.();
          }}
        >
          <FileBadge lines size={15} />
        </button>
      ) : null}

      {/* 正在进行的任务：一颗状态点一个任务，悬停出「标题 · 状态」。
          点的配色/动效与宽态会话行同源（dotPresentation）：运行 = 蓝·呼吸，
          等待用户 = 琥珀/亮黄·双闪 + 光环 —— 收起侧栏时也能一眼看出哪个在等自己。 */}
      {shown.length > 0 ? <div className="fm-rail-sep" /> : null}
      {shown.map((t) => {
        const { style, className } = dotPresentation(t.kind, RAIL_DOT_SIZE);
        return (
          <button
            key={t.id}
            type="button"
            className="fm-rail-btn"
            data-myagent-rail="task"
            data-session-id={t.id}
            title={`${t.title} · ${t.label}`}
            aria-label={`${t.title} · ${t.label}`}
            onClick={() => props.open?.(t.id)}
          >
            <span className={className} style={style} />
          </button>
        );
      })}
      {hidden > 0 ? <div className="fm-rail-more">+{hidden}</div> : null}
    </div>
  );
}

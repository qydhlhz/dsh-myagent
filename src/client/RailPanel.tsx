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
import { IconFolderOpen16 } from "@deepseek-ai/dsh-client-ui-primitives";
import type { PendingInteractionStatus, SelectorHook, SessionsSnapshot, WorkspacesSnapshot } from "./tree-utils.ts";
import { FileBadge } from "./FileBadge.tsx";
import { RAIL_BUTTON_SIZE, RAIL_DOT_SIZE, RAIL_MAX_TASKS } from "./ui-kit.ts";

/** 任务状态（正在进行的四种）。 */
type ActiveKind = "running" | PendingInteractionStatus;

const STATUS_LABEL: Record<ActiveKind, string> = {
  running: "正在运行",
  approval: "等待批准",
  "plan-review": "等待计划确认",
  question: "等待回答",
};

/** 状态点颜色：与宽态会话行的状态点语义完全一致（问答用亮黄——主题无纯黄 token）。 */
function dotColor(kind: ActiveKind): string {
  if (kind === "running") return "var(--dsw-alias-state-business-primary)";
  if (kind === "question") return "#FACC15";
  return "var(--dsw-alias-state-warn-primary)";
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
.fm-rail-btn .fm-rail-dot{width:${RAIL_DOT_SIZE}px;height:${RAIL_DOT_SIZE}px}
.fm-rail-sep{width:20px;height:1px;background:var(--dsw-alias-border-l3);margin:1px 0;flex:none}
.fm-rail-dot{display:block;border-radius:50%;box-sizing:border-box}
/* 运行中的呼吸脉冲，与宽态状态点同款暗示。 */
@keyframes fm-rail-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.fm-rail-dot-running{animation:fm-rail-pulse 1.2s ease-in-out infinite}
.fm-rail-more{font-size:10px;line-height:12px;color:var(--dsw-alias-label-tertiary);flex:none}
`;

export interface RailPanelProps {
  useSessions: SelectorHook<SessionsSnapshot>;
  useWorkspaces: SelectorHook<WorkspacesSnapshot>;
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

  // 当前主对话所在的工作区（用于「工作区」区标的定位目标）。
  const currentWorkspaceId = useMemo(() => {
    const cur = sessions.current;
    if (cur === undefined) return undefined;
    return workspaces.items.find((w) => (w.sessionIds ?? []).includes(cur))?.workspaceId;
  }, [sessions.current, workspaces.items]);

  // 正在进行的任务：running ∪ 等待批准/计划确认/问答。空闲与已完成不算。
  // 按 workspace 顺序、workspace 内 sessionIds 顺序列出（与宽态列表顺序一致），并去重。
  const active = useMemo(() => {
    const archived = new Set(workspaces.archivedSessionIds ?? []);
    const seen = new Set<string>();
    const out: Array<{ id: string; title: string; label: string; kind: ActiveKind }> = [];
    for (const w of workspaces.items) {
      for (const id of w.sessionIds ?? []) {
        if (seen.has(id) || archived.has(id)) continue;
        seen.add(id);
        const s = sessions.byId[id];
        if (s === undefined) continue;
        const kind: ActiveKind | undefined = s.pendingInteraction ?? (s.running ? "running" : undefined);
        if (kind === undefined) continue;
        out.push({ id, title: s.title ?? "未命名会话", label: STATUS_LABEL[kind], kind });
      }
    }
    return out;
  }, [sessions.byId, workspaces.items, workspaces.archivedSessionIds]);

  const shown = active.slice(0, RAIL_MAX_TASKS);
  const hidden = active.length - shown.length;

  return (
    <div className="fm-rail">
      <style>{RAIL_CSS}</style>

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
        <IconFolderOpen16 size={15} />
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

      {/* 正在进行的任务：一颗状态点一个任务，悬停出「标题 · 状态」。 */}
      {shown.length > 0 ? <div className="fm-rail-sep" /> : null}
      {shown.map((t) => (
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
          <span
            className={`fm-rail-dot${t.kind === "running" ? " fm-rail-dot-running" : ""}`}
            style={{ background: dotColor(t.kind) }}
          />
        </button>
      ))}
      {hidden > 0 ? <div className="fm-rail-more">+{hidden}</div> : null}
    </div>
  );
}

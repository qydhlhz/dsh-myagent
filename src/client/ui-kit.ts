// src/client/ui-kit.ts — UI 对齐常量（"圆润化 + 与官方统一"轮）。
//
// 背景：myagent 左栏此前各处自绘圆角写的都是 6px（行）/ 4px（小徽标）/ 2px（指示条），
// 而官方 DSH 的圆角语言明显更圆。本轮只改 UI、不动行为，把每个元素的圆角与几何
// 逐项对齐到官方同名元素（数值直接从官方客户端 bundle 的编译产 CSS 里取得，来源见下）。
//
// 官方取值出处（官方 npm 包 lib/*.js 内联 CSS）：
//   - ui-sidebar-files  .row      → border-radius:10px; gap:6px; padding:5px 10px
//                                   每级缩进 padding-left:18px；.body padding:8px 0 8px 8px
//                                   .header border-bottom:.5px solid border-l3
//                                   .icon color:label-tertiary
//   - ui-sidebar        导航项行   → border-radius:8px; gap:8px; padding:7px 8px
//                       .iconButton → 28px×28px + border-radius:50%
//   - ui-sidebar-files  .tool     → 28px×28px + border-radius:28px（正圆）
//   - 宿主 Button                 → border-radius:18px；size="sm" → 14px
//   - 宿主 Modal / 菜单            → 24px / 20px（均由 primitives 自带，本插件不覆盖）
//   - 卡片 / pill / tab           → 12px；tag → 999px
//
// 颜色一律继续走 --dsw-* token（宿主主题注入），本文件不引入任何硬编码色值。
// 例外：状态点等待态的**柔光环**与问答亮黄（#FACC15）——主题 token 里没有这两档
// （详见下方 DOT_VISUAL 注释）。

import type { CSSProperties } from "react";
import type { SessionDotKind } from "./tree-utils.ts";

/** 官方圆角词汇表（数值单位 px；999 = 全圆，用于正圆按钮与胶囊指示条）。 */
export const RADIUS = {
  /** 官方文件树行（ui-sidebar-files .row）：10px。 */
  treeRow: 10,
  /** 官方侧栏导航项行（ui-sidebar）：8px。 */
  navRow: 8,
  /** 官方卡片 / pill / tab：12px。 */
  card: 12,
  /** 官方 Button size="sm"：14px。 */
  control: 14,
  /** 官方图标按钮：28px 方框 + 全圆 = 正圆（官方 .tool / .iconButton）。 */
  icon: 999,
  /** 官方 tag / 细指示条：全圆。 */
  pill: 999,
} as const;

/** 官方正文次级字号（宿主 layout 注入；缺省 13px，与官方同款回退写法）。 */
export const FONT_SECONDARY = "var(--dsh-content-font-size-secondary, 13px)";

/** 官方正文行高（ui-sidebar-files .root 与官方列表一致）。 */
export const LINE_HEIGHT_BODY = 1.5;

/** 官方文件树行几何（ui-sidebar-files）：行内边距 5px 10px、图标间距 6px、每级缩进 18px。 */
export const TREE_ROW = {
  paddingY: 5,
  paddingX: 10,
  gap: 6,
  /** 子级相对父级的缩进量。 */
  indent: 18,
} as const;

/** 官方区头/标题栏下边界：.5px 的 border-l3（比原先的 1px border-l1 更细更贴合官方）。 */
export const HEADER_BORDER = "0.5px solid var(--dsw-alias-border-l3)" as const;

/** 官方图标按钮规格：28px 方框 + 正圆 + 图标居中（对应官方 .tool / .iconButton）。 */
export const ICON_BUTTON_STYLE = {
  width: 28,
  height: 28,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  borderRadius: RADIUS.icon,
} as const;

/**
 * 图标按钮的字形尺寸。官方 .tool / .iconButton 的做法是「28px 方框 + CSS 里把 svg 定成
 * 15px」（不靠调用点传 size），本插件沿用同样的接线并再收一档到 14px —— 用户反馈
 * 「按钮图标可以小一点，但是有效点击范围可以大一点。是有点拥挤」。
 * 14 也是官方图标集自带的尺寸档（IconChevronDownOutlineMedium / IconTriangleRightFillMedium）。
 */
export const ICON_GLYPH_SIZE = 14;

/**
 * 图标按钮**有效点击范围**相对视觉框向外扩的像素数：28 → 32（面积 +31%）。
 * 用伪元素 `inset: -Npx` 实现 —— 伪元素画在按钮盒之外仍能命中，且点击目标就是按钮本身，
 * 所以命中区变大而布局/行高完全不变。
 * ⚠️ 前提：相邻按钮的 gap 必须 ≥ 2×N，否则两个命中区重叠、点中谁取决于 DOM 顺序。
 * 行内操作组原来的 gap 是 2，已同步改成 4。
 */
export const ICON_HIT_EXPAND = 2;

/**
 * 行内操作按钮的紧凑规格：20×20 正圆（比标题栏按钮小一号 —— 行内操作本来就不该和
 * 工具栏一样大）。用户约束：「图标之间的间隔有点大了，加起来的横向长度占不要超过
 * 1/4 的标签宽度」：侧栏行宽实测 258px，1/4 = 64.5px；3 颗 × 20px + 2 × 2px = **64px
 * （24.8%）** 刚好达标，而 28px 方框光 3 颗就要 92px（35.7%），怎么排都超。
 */
export const ROW_ACTION_BUTTON_STYLE = {
  width: 20,
  height: 20,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  borderRadius: RADIUS.icon,
} as const;

/** 行内操作按钮之间的 gap。与 20px 方框合成 22px 节距，正好被命中区铺满。 */
export const ROW_ACTION_GAP = 2;

/**
 * 行内操作按钮的命中区扩展量（横竖分开）：
 *  - 横向 1px：按钮节距 = 20 + 2 = 22px，左右各扩 1px 正好铺满节距 —— 相邻命中区
 *    **严丝合缝，既不重叠也不留死区**（比"扩 2px + 留 4px gap"更省横向空间且更好点）。
 *  - 纵向 6px：行内上下没有邻居，等于白送（20 → 32px 高），实测行高足够容纳、不会串到邻行。
 */
export const ROW_ACTION_HIT_INSET = "-6px -1px";

/**
 * 三级行的最小高度。原先行高是被 28px 操作按钮"顺带"撑出来的；换成 20px 紧凑按钮后
 * 必须显式钉住，否则行高会塌成 32/28/26，方案 B 的高度层级（40/36/34）就没了。
 */
export const ROW_MIN_HEIGHT = { workspace: 40, group: 36, session: 34 } as const;

/**
 * 收起态（rail）按钮：32×32 正圆。
 * 宿主 `.hHd-Xa_regionArea` 实测可用宽只有 **35px**（rail 55 − 左右各 10 padding），
 * 之前的 rail 按钮是 36px 宽、x=6，左右各溢出 1px —— 这正是 rail 里冒出多余滑动条的根因
 * （实测 `scrollWidth 34 > clientWidth 27`）。32px 稳稳落在 35px 内，不再溢出。
 */
export const RAIL_BUTTON_SIZE = 32;

/** 状态点直径（宽态会话行与 rail 任务点同尺寸；16px 图标槽内居中对齐，光环后 12px 仍不挤）。 */
export const STATUS_DOT_SIZE = 8;

/** rail 里「正在进行」任务的状态点直径（与宽态会话行的状态点同尺寸）。 */
export const RAIL_DOT_SIZE = STATUS_DOT_SIZE;

/** rail 竖排最多渲染多少个任务点，超出折成「+N」（避免任务多时把 rail 撑得过长）。 */
export const RAIL_MAX_TASKS = 12;

// ── 会话/任务状态点：一套视觉语言，宽态会话行与 rail 任务点共用 ─────────────────────
//
// 语义（优先级见 tree-utils 的 sessionDotKind）：等待用户 > 运行中 > 已完成 > 空白 > 当前 > 空闲。
// 关键区分（用户报的问题）：**等待用户**与**运行中**必须一眼分得开，而宿主在等审批/等回答时
// 回合仍在跑（running 依旧 true）——所以等待态在语义上压过运行态，视觉上给三重区分：
//   ① 颜色：运行 = 蓝（business-primary，deepseek-400/500）；等待 = 琥珀（warn-primary，
//      amber-500 #f59e0b）或亮黄（#FACC15，主题无纯黄 token，问答专用，与琥珀再分一层）；
//   ② 动效：运行 = 1.2s 平滑呼吸（ambient，"它在干活"）；等待 = 1.6s **双闪**
//      （attention，"它在等你"）——节奏不同，余光就能分辨；
//   ③ 光环：等待态带 2px 同色柔光环（8px 点 + 2px 环 = 12px，仍在 16px 图标槽内），
//      在一列灰点里主动跳出来。
//
// 动效一律走 opacity + box-shadow（不触发布局），并尊重 prefers-reduced-motion。
/** 状态点的动效档（none = 静态）。 */
export type DotAnimation = "pulse" | "attention" | "none";

/** 一个状态点的视觉：填充色 / 描边（空白会话用空心点）/ 光环色 / 动效档。 */
export interface DotVisual {
  /** 填充色（缺省 = 透明，配合 border 画空心点）。 */
  color?: string;
  /** 描边（仅空白新会话用空心点）。 */
  border?: string;
  /** 等待态的光环色（写进 --fm-dot-halo，供 CSS box-shadow 使用）。 */
  halo?: string;
  animation: DotAnimation;
}

/**
 * 状态点视觉表。颜色优先取主题 token（--dsw-alias-state-*），光环是同一色的低透明度
 * rgba（主题 token 里没有"同色 40% 透明"这一档，写死 rgba 与 #FACC15 同类处理，
 * 亮/暗主题下都能看清）。
 */
export const DOT_VISUAL: Record<SessionDotKind, DotVisual> = {
  approval: { color: "var(--dsw-alias-state-warn-primary)", halo: "rgba(245, 158, 11, 0.38)", animation: "attention" },
  "plan-review": { color: "var(--dsw-alias-state-warn-primary)", halo: "rgba(245, 158, 11, 0.38)", animation: "attention" },
  question: { color: "#FACC15", halo: "rgba(250, 204, 21, 0.38)", animation: "attention" },
  running: { color: "var(--dsw-alias-state-business-primary)", animation: "pulse" },
  completed: { color: "var(--dsw-alias-state-success-primary)", animation: "none" },
  blank: { border: "1px solid var(--dsw-alias-label-tertiary)", animation: "none" },
  current: { color: "var(--dsw-alias-state-business-primary)", animation: "none" },
  idle: { color: "var(--dsw-alias-label-tertiary)", animation: "none" },
};

/** 状态点公共样式（尺寸由调用点定：宽态会话行与 rail 都是 8px）。 */
export const STATUS_DOT_CSS = `
.fm-dot{display:block;border-radius:50%;box-sizing:border-box;flex:none}
/* 运行中：平滑呼吸——"它在干活"。 */
@keyframes fm-dot-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.fm-dot-pulse{animation:fm-dot-pulse 1.2s ease-in-out infinite}
/* 等待用户：双闪 + 同色柔光环——"它在等你"。 */
@keyframes fm-dot-attention{0%,100%{opacity:1}22%{opacity:.25}44%{opacity:1}66%{opacity:.25}}
.fm-dot-attention{
  animation:fm-dot-attention 1.6s ease-in-out infinite;
  box-shadow:0 0 0 2px var(--fm-dot-halo,transparent);
}
@media (prefers-reduced-motion: reduce){
  .fm-dot-pulse,.fm-dot-attention{animation:none}
}
`;

/**
 * 状态点的内联样式：在官方 CSSProperties 之上补一个自定义属性
 * （等待态柔光环色，CSS 里由 .fm-dot-attention 的 box-shadow 读取）。
 */
export interface DotStyle extends CSSProperties {
  "--fm-dot-halo"?: string;
}

/**
 * 组装一个状态点的内联样式 + 类名（宽态会话行 / rail 任务点共用，保证两处不会走样）。
 * @param kind - 状态点语义。
 * @param size - 点直径（px）。
 * @returns 内联 style（含 --fm-dot-halo 自定义属性）与动效类名。
 */
export function dotPresentation(kind: SessionDotKind, size: number): { style: DotStyle; className: string } {
  const visual = DOT_VISUAL[kind];
  const style: DotStyle = { width: size, height: size };
  if (visual.color !== undefined) style.background = visual.color;
  if (visual.border !== undefined) style.border = visual.border;
  if (visual.halo !== undefined) style["--fm-dot-halo"] = visual.halo;
  return { style, className: visual.animation === "none" ? "fm-dot" : `fm-dot fm-dot-${visual.animation}` };
}

/**
 * 官方侧栏滚动条样式（官方 ui-sidebar 把 --dsh-scrollbar-thumb 接到
 * --dsw-alias-scrollbar-bg-l2 / -hover-l2）：细滚动条 + 透明轨道 + 圆角滑块。
 * 取代此前硬编码的 rgba(127,127,127,…)（暗/亮主题下都不跟随官方配色）。
 */
export const SCROLLBAR_CSS = `
.fm-scroll {
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l2) transparent;
}
.fm-scroll::-webkit-scrollbar {
  width: 8px;
}
.fm-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.fm-scroll::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l2);
  border-radius: ${RADIUS.pill}px;
}
.fm-scroll:hover::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-hover-l2);
}
`;

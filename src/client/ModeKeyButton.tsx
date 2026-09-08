// src/client/ModeKeyButton.tsx — 底栏模式键（sidebar.footer.action）：一键切换
// 原始模式（官方界面回归）/ MyAgent 模式。图标为 MA logo（用户素材
// 2026-08-15_ma-logo-design/黑字白底MA.svg + 白字白底MA.svg）：
//   标准模式 → 黑字白底（白方块 + 黑 MA，素材原样）
//   MyAgent 模式 → 反色（黑方块 + 白 MA，取白字白底版字形 + 黑底）
// 点击切换即黑白反色。
import React from "react";
import { getMode, setMode, useMode } from "./mode-store.ts";

const MODE_CSS = `
.fm-mk-btn{box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border:none;border-radius:6px;background:transparent;cursor:pointer;padding:0}
.fm-mk-btn:hover{background:var(--dsw-alias-bg-layer-1)}
// 2026-08-15 协调性调整 v2（用户反馈）：chip 22→18px（与左右 18px 线条图标同尺寸）、
// 圆角 7→6px；MyAgent 态的黑底不再用纯黑——深色主题下改为侧栏背景色
// （--dsw-specific-sidebar-fill = bluish-900），黑方块融入侧栏，只浮现白色 MA 字母，
// 与左右白色线条图标同重量；浅色主题保持纯黑方块（反色效果保留）。
// v3（用户反馈）：chip 18→16px，继续缩小左下角 MA 图标。
// v4（用户反馈）：chip 16→12px；圆角 6→4px，保持圆角方块比例（避免 12px/6px 变成正圆）。
// v5（用户反馈）：chip 12→6px；圆角 4→2px，保持圆角方块比例。
// v6（调试）：6px 仅用于确认缓存问题；确认后先改回 12px。
// v7（最终，用户确认）：chip 回到 18px，圆角 6px（与 v2 一致）。
.fm-mk-chip{width:18px;height:18px;border-radius:6px;overflow:hidden;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,.08)}
.fm-mk-bg{fill:#ffffff}
.fm-mk-bg.fm-mk-bg-dark{fill:#000000}
body[data-ds-dark-theme] .fm-mk-bg.fm-mk-bg-dark{fill:var(--dsw-specific-sidebar-fill)}
`;

// —— MA logo 矢量数据（viewBox 0 0 278.58 278.58；坐标原样取自用户素材 SVG，未改动）——
// 背景为复合路径（方块 + M/A 镂空子路径）：nonzero 填充下字母区为洞，再由字母路径
// 覆盖；即使镂空失效，字母路径也恰好盖住同一区域，两种情形视觉一致。
const MA_BG =
  "M0,278.58V0h278.58v278.58H0ZM57.32,154.21l-.03-40.63-.04-24.55,2.58,5.15,3.58,7.34,12.17,26.29,10,21.42,5.94,12.63,6.16,13.11,14.37-32.22,6.18-14.47,9.83-23.15,18.12-42.47,8.94-21.05-26.96.07-13.52,30.96-12.42,28.39-5.41,11.94-10.69-23.09-8.78-18.76-9.75-20.84c-1.35-2.89-2.66-5.49-3.97-8.6l-35.1.04.12,21.38-.04,134.78v39.84s28.73.01,28.73.01l-.04-41.64.02-41.87ZM225.72,211.87l8.82,25.89,11.57-.1,23.8.08-4.9-13.8-5.99-17.44-13.98-40.13-14-40.71-7.93-22.54-6.19-17.77-9.4-26.72-2.9-8.26-3.13-8.68-31.81.06-21.17,52.06-7.25,17.98-7.46,18.61-15.18,37.66-5.51,13.78-10.18,25.15-12.87,30.75,36.54-.06,12.65-32.16,2.87-7.4,21.25-.1,42.92.04,14.6.1,4.83,13.71Z";
const MA_M =
  "M226.1,211.91l-4.83-13.71-14.6-.1-42.92-.04-21.25.1-2.87,7.4-12.65,32.16-36.54.06,12.87-30.75,10.18-25.15,5.51-13.78,15.18-37.66,7.46-18.61,7.25-17.98,21.17-52.06,31.81-.06,3.13,8.68,2.9,8.26,9.4,26.72,6.19,17.77,7.93,22.54,14,40.71,13.98,40.13,5.99,17.44,4.9,13.8-23.8-.08-11.57.1-8.82-25.89ZM152.98,166.4h33.69s26.23.16,26.23.16l-3.46-10.37-10.04-29.89-14.97-43.36-1.83,4.97-12.97,34.33-3.28,8.68-4,10.74-2.92,7.61-6.43,17.14Z";
const MA_A =
  "M57.7,154.26l-.02,41.87.04,41.64h-28.74s0-39.85,0-39.85l.04-134.78-.12-21.38,35.1-.04c1.31,3.11,2.61,5.71,3.97,8.6l9.75,20.84,8.78,18.76,10.69,23.09,5.41-11.94,12.42-28.39,13.52-30.96,26.96-.07-8.94,21.05-18.12,42.47-9.83,23.15-6.18,14.47-14.37,32.22-6.16-13.11-5.94-12.63-10-21.42-12.17-26.29-3.58-7.34-2.58-5.15.04,24.55.03,40.63Z";
const MA_NOTCH = "152.98,166.4 159.41,149.26 162.33,141.65 166.34,130.91 169.62,122.22 182.59,87.9 184.43,82.93 199.4,126.29 209.44,156.18 212.9,166.55 186.68,166.41 152.98,166.4";

function ensureCss() {
  if (typeof document === "undefined") return;
  const existing = document.querySelector("style[data-fm-mk]");
  if (existing) {
    // HMR 热替换只清 data-plugin 样式，不清 data-fm-*；这里既覆盖文本，
    // 也补上 data-plugin，让后续 HMR 能彻底移除旧 style。
    existing.setAttribute("data-plugin", "dsh-myagent");
    existing.textContent = MODE_CSS;
    return;
  }
  const tag = document.createElement("style");
  tag.dataset.fmMk = "1";
  tag.dataset.plugin = "dsh-myagent";
  tag.textContent = MODE_CSS;
  document.head.appendChild(tag);
}

// MA logo 图标：dark=false 白底黑字（黑字白底）；dark=true 黑底白字（反色）。
// 注意白字白底素材本身为全白填充，单独显示不可见——反色态必须带黑方块底；
// 黑底色经 CSS 跟随主题（深色 = 侧栏背景色，方块融入侧栏只浮现白字）。
function MaLogoIcon({ dark }: { dark: boolean }) {
  const fg = dark ? "#ffffff" : "#000000";
  const bgCls = dark ? "fm-mk-bg fm-mk-bg-dark" : "fm-mk-bg";
  return React.createElement(
    "div",
    {
      className: "fm-mk-chip",
      // 内联尺寸兜底：即使外部 style 因 HMR/缓存残留未更新，也能强制最终尺寸。
      style: {
        width: 18,
        height: 18,
        borderRadius: 6,
        overflow: "hidden",
        flex: "none",
        boxShadow: "0 0 0 1px rgba(0,0,0,.08)",
      },
    },
    React.createElement(
      "svg",
      { viewBox: "0 0 278.58 278.58", width: "100%", height: "100%", display: "block", "aria-hidden": true },
      React.createElement("path", { className: bgCls, d: MA_BG }),
      React.createElement("path", { fill: fg, d: MA_M }),
      React.createElement("path", { fill: fg, d: MA_A }),
      React.createElement("polygon", { className: bgCls, points: MA_NOTCH }),
    ),
  );
}

export function ModeKeyButton() {
  ensureCss();
  const mode = useMode();
  const on = mode === "myagent";
  return React.createElement("button", {
    className: "fm-mk-btn",
    title: on ? "MyAgent 模式（点击切换标准模式）" : "标准模式（点击切换 MyAgent 模式）",
    "data-active": on ? "true" : undefined,
    onClick: () => setMode(on ? "original" : "myagent"),
  }, React.createElement(MaLogoIcon, { dark: on }));
}

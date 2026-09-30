// src/client/settings-compact.ts — 官方设置键"变小 + 与模式键并排"（用户 2026-08-15 定案，v4）。
//
// 官方结构（0.2.0-rc.2 产物实测；0.1.x 至今未变）：
//   .<hash>_footArea (flex column, position:static)
//     ├─ .<hash>_footerActions        → renderSlot("sidebar.footer.action")  ← 模式键在这行
//     └─ .<hash>_settingsArea         → renderSlot("sidebar.settings")       ← 官方 SettingsRoot
//                                           └─ .<hash>_triggerRow
//                                                 └─ button.<hash>_trigger（0.2 宽条：
//                                                    width:auto; flex:1; height:42px；
//                                                    0.1 是 calc(100%+8px)/34px）
//   rail（侧栏收起）时 root 带 .<hash>_collapsed，trigger 另带 .<hash>_rail（36x36 圆钮）。
//
// ── 0.2 迁移要点：类名哈希**跨构建不稳定** ──────────────────────────────────
// 官方类名是 CSS Modules 哈希，前缀由**构建机的源码绝对路径**决定，因此同一个版本号
// （0.2.0-rc.2-04f392c）在两处产物里哈希不同（已逐字节核对，CSS 本体除哈希外完全一致）：
//   · npm 包（@deepseek-ai/dsh-client-ui-sidebar / -settings-general）：
//       hHd-Xa_footArea / hHd-Xa_footerActions / hHd-Xa_settingsArea / hHd-Xa_collapsed
//       VOzbGW_trigger  / VOzbGW_triggerRow    / VOzbGW_overlay
//   · 桌面端 app.asar 内自带的那份（**用户在跑的 GUI 用的就是这份**）：
//       _2H3hWW_footArea / _2H3hWW_footerActions / _2H3hWW_settingsArea / _2H3hWW_collapsed
//       wCInkW_trigger   / wCInkW_triggerRow     / wCInkW_overlay
// 所以这里**不再写死任何一个哈希前缀**，一律用 `[class*="<key>"]` 子串匹配 —— 两套哈希
// 都命中，下次官方换构建机也不用改。
//
// ── 0.2 官方新增、与本段 CSS 有交互的两条规则（务必别"修"坏） ──────────────
// 1) `[data-windows-titlebar] .<hash>_collapsed .<hash>_footArea{display:none}`
//    特异性 (0,3,0)，**高于**本文件 `.collapsed .footArea{display:flex}` 的 (0,2,0)。
//    这是有意的：Windows 桌面端收起侧栏时整条栏宽为 0（不是 56px 轨道），脚部自然应当
//    隐藏。**不要**给本文件的收起态规则加 !important 去抢回 display —— 那会在 Windows
//    桌面端把脚部强行画到 0 宽度的栏里。web（56px 轨道）下没有该属性，收起态规则照常生效。
// 2) 官方 0.2 的 settingsArea **没有** position/z-index（不创建层叠上下文），所以旧版
//    给 overlay 打 `z-index:1200 !important` 的补丁不再必要 —— 本文件改为在 settingsArea
//    上显式 `z-index:auto`，从根上保证设置弹窗（portal 到 body 的 fixed 层）不会被困住。
//
// 类名 key（footArea / footerActions / settingsArea）在官方产物里只以哈希形式出现在
// className 上，没有任何 data-* 锚点，故只能用子串选择器；这三/四个 key 足够独特
// （`footerActions` 不含 `footArea` 子串，不会互相误伤）。
//
// v4 布局（用户逐轮反馈定稿）：
//   - 已移除插件管理功能，底栏只剩 设置键 + MA 模式键。
//   - wide（展开）：设置键最左、与模式键 32x32 同尺寸同行、行高紧凑、按钮区上缘浅灰分隔线。
//     settingsArea 的 top 必须与 footArea 的 padding-top 同步（8px），否则 absolute 相对
//     padding box 外沿定位会使设置键与模式键行错位。footerActions 右移 36px 给设置键让位
//     （32px 键宽 + 4px 间距）。
//   - collapsed（整栏收起）：MA 键在上、设置键在最下边，竖直居中排列，两个都是 36x36。

const CSS = `
[class*="footArea"]{position:relative;padding:8px 0 3px;border-top:1px solid var(--dsw-alias-border-l1)}
[class*="settingsArea"]{position:absolute;top:8px;left:0;width:32px;height:32px;display:flex;align-items:center;justify-content:center;z-index:auto}
/* z-index:auto 是刻意的：官方设置弹窗是 portal 到 body 的 fixed 层，只要这条祖先链上
   没有层叠上下文，它就不会被侧栏的 z-index:1 困住（旧版靠给 overlay 打 1200 补丁，
   0.2 官方 settingsArea 本身不创建层叠上下文，故此处从根上解决）。 */
/* triggerRow 官方给的是 width:calc(100% + 4px); margin:4px -2px（比 32px 的 settingsArea
   宽出 4px），会把里面的按钮撑到 36px。这里把它收回成恰好铺满 settingsArea。 */
[class*="settingsArea"] [class*="triggerRow"]{width:100%;margin:0;gap:0;justify-content:center}
[class*="settingsArea"] [class*="trigger"]:not([class*="triggerRow"]){box-sizing:border-box;flex:none;width:32px;height:32px;min-width:0;margin:0;padding:0;border-radius:6px;justify-content:center;gap:0;display:flex;align-items:center;background:transparent}
[class*="settingsArea"] [class*="trigger"]:not([class*="triggerRow"]):hover{background:var(--dsw-alias-bg-layer-1)}
[class*="footerActions"]{padding-left:36px;align-items:center}
[class*="collapsed"] [class*="footArea"]{padding:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:0}
[class*="collapsed"] [class*="settingsArea"]{position:static;order:2;width:auto;height:auto;min-height:0;margin:0;padding:0;display:flex;justify-content:center}
[class*="collapsed"] [class*="settingsArea"] [class*="triggerRow"]{width:36px;margin:8px 0 10px}
[class*="collapsed"] [class*="settingsArea"] [class*="trigger"]:not([class*="triggerRow"]){width:36px;height:36px;margin:0;padding:0;border-radius:50%;justify-content:center}
[class*="collapsed"] [class*="footerActions"]{order:-1;padding-left:0;width:auto;margin:0;display:flex;justify-content:center}
[class*="collapsed"] [class*="footerActions"] .fm-mk-btn{width:36px;height:36px;margin:10px 0 0}
`;

export function ensureSettingsCompactCss() {
  if (typeof document === "undefined") return;
  const existing = document.querySelector("style[data-fm-settings-compact]");
  if (existing) {
    // 与 ModeKeyButton 同理：HMR 只清 data-plugin，必须覆盖文本并补 data-plugin。
    existing.setAttribute("data-plugin", "dsh-myagent");
    existing.textContent = CSS;
    return;
  }
  const tag = document.createElement("style");
  tag.dataset.fmSettingsCompact = "1";
  tag.dataset.plugin = "dsh-myagent";
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

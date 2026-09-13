// src/client/settings-compact.ts — 官方设置键"变小 + 与模式键并排"（用户 2026-08-15 定案，v4）。
//
// 官方结构（dsh-client-ui-sidebar / ui-settings-general 0.1.0-rc.6 产物实测）：
//   .hHd-Xa_footArea (flex column)
//     ├─ .hHd-Xa_footerActions        → renderSlot("sidebar.footer.action")  ← 模式键在这行
//     └─ .hHd-Xa_settingsArea         → renderSlot("sidebar.settings")       ← 官方 SettingsRoot
//                                           └─ button.VOzbGW_trigger（宽条：width calc(100%+8px)
//                                              height 34px，hover 一整条浅灰；点击 setOpen(true)
//                                              打开设置模态——点击动作保留，只改外观与位置）
//   rail（侧栏收起）时 root 带 .hHd-Xa_collapsed 类，trigger 有 .VOzbGW_rail（36x36 圆钮）。
//
// v4 布局（用户逐轮反馈定稿）：
//   - 已移除插件管理功能，底栏只剩 设置键 + MA 模式键。
//   - wide（展开）：设置键最左、与模式键 32x32 同尺寸同行、行高紧凑、按钮区上缘浅灰分隔线。
//     settingsArea 的 top 必须与 footArea 的 padding-top 同步（8px），否则 absolute 相对
//     padding box 外沿定位会使设置键与模式键行错位。footerActions 右移 36px 给设置键让位
//     （32px 键宽 + 4px 间距）。
//   - collapsed（整栏收起）：MA 键在上、设置键在最下边，竖直居中排列，两个都是 36x36。
// 类名是 CSS Modules 哈希（hHd-Xa_*/VOzbGW_*），随 dsh 版本升级可能变化——升级时核对产物。

const CSS = `
.hHd-Xa_footArea{position:relative;padding:8px 0 3px;border-top:1px solid var(--dsw-alias-border-l1)}
.hHd-Xa_settingsArea{position:absolute;top:8px;left:0;width:32px;height:32px;display:flex;align-items:center;justify-content:center;z-index:auto}
/* 官方设置弹窗 overlay 虽然是 z-index:1000，但若 settingsArea 创建局部层叠上下文，
   弹窗会被困在 sidebar 的 z-index:1 层里，被右侧查看器/主区里更高的 z-index 内容盖住。
   这里去掉 settingsArea 的层叠上下文（上面 z-index:auto），并把 overlay 提到 1200，
   确保设置弹窗始终在所有普通 UI / 菜单（z-index ≤1100）之上。 */
.VOzbGW_overlay{z-index:1200 !important}
.hHd-Xa_settingsArea .VOzbGW_trigger{box-sizing:border-box;width:32px;height:32px;min-width:0;margin:0;padding:0;border-radius:6px;justify-content:center;gap:0;display:flex;align-items:center;background:transparent}
.hHd-Xa_settingsArea .VOzbGW_trigger:hover{background:var(--dsw-alias-bg-layer-1)}
.hHd-Xa_footerActions{padding-left:36px;align-items:center}
.hHd-Xa_collapsed .hHd-Xa_footArea{padding:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:0}
.hHd-Xa_collapsed .hHd-Xa_settingsArea{position:static;order:2;width:auto;height:auto;min-height:0;margin:0;padding:0;display:flex;justify-content:center}
.hHd-Xa_collapsed .hHd-Xa_settingsArea .VOzbGW_trigger{width:36px;height:36px;margin:0 0 10px;padding:0;border-radius:50%;justify-content:center}
.hHd-Xa_collapsed .hHd-Xa_footerActions{order:-1;padding-left:0;width:auto;margin:0;display:flex;justify-content:center}
.hHd-Xa_collapsed .hHd-Xa_footerActions .fm-mk-btn{width:36px;height:36px;margin:10px 0 0}
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

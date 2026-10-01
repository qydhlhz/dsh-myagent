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
// ── 0.2 官方新增、与本段 CSS 有交互的三条规则（务必别"修"坏） ──────────────
// 1) `[data-windows-titlebar] .<hash>_collapsed .<hash>_footArea{display:none}`
//    特异性 (0,3,0)，**高于**本文件 `.collapsed .footArea{display:flex}` 的 (0,2,0)。
//    这是有意的：Windows 桌面端收起侧栏时整条栏宽为 0（不是 56px 轨道），脚部自然应当
//    隐藏。**不要**给本文件的收起态规则加 !important 去抢回 display —— 那会在 Windows
//    桌面端把脚部强行画到 0 宽度的栏里。web（56px 轨道）下没有该属性，收起态规则照常生效。
// 2) 官方 0.2 的 settingsArea **没有** position/z-index（不创建层叠上下文），所以旧版
//    给 overlay 打 `z-index:1200 !important` 的补丁不再必要 —— settingsArea 上显式
//    `z-index:auto`，从根上保证设置弹窗（portal 到 body 的 fixed 层）不会被困住。
// 3) **settings.launcher 会整体顶掉 settings.trigger**（桌面端官方账号插件就这么干，且仅在
//    `"dshDesktop" in globalThis` 时注册）。席位一旦被别人的 launcher 占用，本插件的
//    32×32 紧凑布局必须整体让位，否则会把「头像 + 用户名」整行压扁并与模式键重合 ——
//    所以下面所有紧凑规则都挂在 `:has([data-fm-settings-trigger])` 这个**本插件自有标记**
//    之下（见 IconOnlySettingsTrigger.tsx），不做任何官方哈希的猜测。
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
/* ── 底栏高度压缩（用户 2026-10 定案）────────────────────────────────────────
   诉求：把纵向空间尽可能留给「工作区」与「区文件树」两棵树；底栏那一条（用户头像所在
   的区域）行高压到最小。
   原来 64px = padding 8+3 + settingsArea 52 + 里面的 triggerRow 44。
   压到 26px = padding 1+1 + settingsArea/triggerRow 24。
   24px 是**物理下限**：官方账号头像本身就是 24px，行高再小就会裁到头像 ——
   而按本项目既有原则，官方账号控件的**内部**一律不碰（只动席位盒模型）。
   为此底栏里的 MA 模式键也同步从 32 缩到 24（见下方 footerActions 规则），
   与「插件」入口同尺寸。 */
/* justify-content:center 是官方本来就有的 flex column（文件头实测）之上补的一条：
   把席位在底栏里**纵向居中**，这样以后调 padding 也不必再手动配平上下。
   padding 3.5px（27→32px）后又调到 5.5px（32→36px）：用户两轮反馈"再高 5px"、
   "再提高一点，现在不太协调" —— 24px 的内容行配 3.5px 留白显得太挤。
   官方 footArea 的 display:flex;flex-direction:column 保持不变，这里只补居中。 */
[class*="footArea"]{position:relative;padding:5.5px 0;border-top:1px solid var(--dsw-alias-border-l1);justify-content:center}
/* 行高压缩**必须带门**：席位被第三方 launcher 占用时（既不是本插件的单图标 trigger，
   也不是官方账号行）我们一概不碰 —— 那条规则原本就是为了防"压扁别人的控件"而立的，
   这里同样遵守。两个门各写一遍，方向与下面各自的紧凑布局一致。 */
[class*="footArea"]:has([data-fm-settings-trigger]) [class*="settingsArea"],
[class*="footArea"]:has([data-fm-settings-trigger]) [class*="triggerRow"],
[class*="footArea"]:not(:has([data-fm-settings-trigger])) [class*="settingsArea"],
[class*="footArea"]:not(:has([data-fm-settings-trigger])) [class*="triggerRow"]{height:24px;min-height:0}
[class*="footArea"]:has([data-fm-settings-trigger]) [class*="trigger"]:not([class*="triggerRow"]),
[class*="footArea"]:not(:has([data-fm-settings-trigger])) [class*="trigger"]:not([class*="triggerRow"]){height:24px;min-height:0}
/* 只收**纵向**外边距：官方 triggerRow 的 margin:4px -2px 里，左右那 -2px 是它的横向
   几何（账号行靠它铺满），一律留着；上下的 4px 是纯留白，收掉。 */
[class*="footArea"]:has([data-fm-settings-trigger]) [class*="triggerRow"],
[class*="footArea"]:not(:has([data-fm-settings-trigger])) [class*="triggerRow"]{margin-top:0;margin-bottom:0}
/* 底栏里的 MA 模式键：24x24，与「插件」入口同尺寸。这是我们自己的按钮，不需要门。
   收起态（轨道）另有更高特异性的 36x36 规则在后，不受影响。 */
[class*="footArea"] [class*="footerActions"] .fm-mk-btn{width:24px;height:24px}

/* ── 把官方「插件」面板入口搬到底栏、紧挨 MA 左侧（用户 2026-10 定案）─────────
   实测结构（0.2.0-rc.2 桌面产物）：
     div.<root>                                ← 侧栏列，280x900
       ├─ div                                  （空占位）
       ├─ nav.<hash>panelList                  ← 「插件」入口，[14,70 252x36]
       │    └─ button.<hash>panelRow > span.panelGlyph + span.panelTitle
       ├─ div.<hash>regionArea                 ← 工作区 + 区文件树
       └─ div.<hash>footArea                   ← 底栏
   panelList 与 footArea 是**兄弟**：把 root 变成定位上下文，就能把「插件」这一行
   绝对定位到底栏那一行里去。官方按钮**原样留在 DOM 里**，因此点它照旧切到插件面板，
   行为一点没变 —— 这里只改它画在哪，不接管它的任何逻辑。
   顺带的好处：panelList 脱离文档流后，regionArea 自动吃掉它让出的整行（约 44px）。

   为什么用 :has() 找 root：root 自己不创建定位上下文，而它的类名哈希跨构建不稳定
   （见文件头说明），只能按"同时拥有 panelList 和 footArea 两个子元素"来精确锁定它。
   两个定位数值都是**相对 root 的右/下边**算的，因此侧栏拖宽拖窄都不会错位：
     · 底栏 [12, y, 256, 36] → 右缘距 root 右 12px、下缘距 root 下 6px
     · MA 24x24 贴底栏右缘并被纵向居中 → 再往左留 4px 间距放「插件」→ 其右缘距 root 右 40px
     · 两者垂直居中对齐 → 「插件」下缘距 root 下 11.5px
       （不是整数：底栏内容盒从 864.5px 起 —— 1px 上边框 + 5.5px padding ——
        席位行居中后落在 864.5..888.5，所以「插件」的下缘也必须落在 888.5 才对齐。
        实测写整数会让「插件」比 MA 错开 1px，正是用户要消掉的那种不居中。
        底栏高度每改一次，这个值必须跟着重算：bottom = 900 −（底栏下缘 − padding − 24）。） */
div:has(> nav[class*="panelList"]):has(> [class*="footArea"]){position:relative}
nav[class*="panelList"]{position:absolute;right:40px;bottom:11.5px;width:auto;height:auto;margin:0;padding:0;z-index:2}
/* min-height:0 必须写：官方 panelRow 带 min-height（36px），只写 height 压不下去
   —— 实测 nav 仍是 24x36，图标因此比 MA 低 6px，两者对不齐。 */
nav[class*="panelList"] [class*="panelRow"]{box-sizing:border-box;width:24px;height:24px;min-width:0;min-height:0;margin:0;padding:0;gap:0;justify-content:center;border-radius:6px}
nav[class*="panelList"] [class*="panelTitle"]{display:none}

/* ── 以下紧凑同行布局**只在**"设置席位里坐的是本插件那颗单图标 trigger"时生效 ────────
   判据是本插件自己渲染的稳定标记 data-fm-settings-trigger（见 IconOnlySettingsTrigger），
   **不是**任何官方哈希。

   为什么必须加这个门（用户 2026-09 报的"设置 / MA / 用户图标重合"）：
   桌面端的官方账号插件（dsh-client-ui-settings-account，仅在 globalThis 上有 dshDesktop
   这个键时才注册）会占用 **settings.launcher**；而 settings.launcher 一旦有占位者，官方
   就不再渲染 settings.trigger（ui-settings-general 的 renderSlot fallback），席位里换成
   「24px 头像 + 用户名」的**整行**控件（AccountMenu：root{flex:1} + trigger{width:100%;
   height:44px;padding:6px;gap:8px}）。
   若仍按 32×32 绝对定位压扁这一行，头像会被裁切，44px 的行又与 8px 偏移处的 32px
   MA 键在视觉上叠在一起 —— 就是"重合"。加门之后，席位被别人的 launcher 占用时本插件
   **完全不碰**底栏内部布局，官方上下两行布局原样生效。
   浏览器不支持 :has() 时整段不生效 → 同样退回官方布局，属于安全的降级方向。 */
[class*="footArea"]:has([data-fm-settings-trigger]) [class*="settingsArea"]{position:absolute;top:1px;left:0;width:24px;height:24px;display:flex;align-items:center;justify-content:center;z-index:auto}
/* z-index:auto 是刻意的：官方设置弹窗是 portal 到 body 的 fixed 层，只要这条祖先链上
   没有层叠上下文，它就不会被侧栏的 z-index:1 困住（旧版靠给 overlay 打 1200 补丁，
   0.2 官方 settingsArea 本身不创建层叠上下文，故此处从根上解决）。 */
/* triggerRow 官方给的是 width:calc(100% + 4px); margin:4px -2px（比 24px 的 settingsArea
   宽出 4px），会把里面的按钮撑大。这里把它收回成恰好铺满 settingsArea。 */
[class*="footArea"]:has([data-fm-settings-trigger]) [class*="settingsArea"] [class*="triggerRow"]{width:100%;margin:0;gap:0;justify-content:center}
[class*="footArea"]:has([data-fm-settings-trigger]) [class*="settingsArea"] [class*="trigger"]:not([class*="triggerRow"]){box-sizing:border-box;flex:none;width:24px;height:24px;min-width:0;margin:0;padding:0;border-radius:6px;justify-content:center;gap:0;display:flex;align-items:center;background:transparent}
[class*="footArea"]:has([data-fm-settings-trigger]) [class*="settingsArea"] [class*="trigger"]:not([class*="triggerRow"]):hover{background:var(--dsw-alias-bg-layer-1)}
[class*="footArea"]:has([data-fm-settings-trigger]) [class*="footerActions"]{padding-left:28px;align-items:center}

/* ── 账号 launcher 在场时（桌面端）：账号行**保持官方原样**，只把 MA 模式键移到它右侧 ──
   判据同样是"标记不在场"——即席位被官方账号插件占用。
   用户定案（2026-09）：「只把 MA 图标右对齐，用户图标原位置不动」。
   所以这里**不碰**账号行自己的盒模型与内部结构：它仍是官方那条整行控件（头像在最左、
   后面跟用户名），我们只是把它右侧让出 28px 给 MA，再把 MA 从文档流里摘出来、
   绝对定位到同一行的最右侧并垂直居中。
   官方给 footerActions/settingsArea 的都是 width:100%，accounts 行的 triggerRow 也仍是
   官方那套（width:calc(100% + 4px); margin:4px -2px）—— 保持不动，只有行高按上面的
   全局规则压到 24px。right:0 是相对 footArea 的 padding box，正好落在底栏右缘。 */
/* 让出的宽度必须覆盖**底栏右侧所有键**，不只是 MA：
     MA 24 + 间距 4 + 「插件」24 + 间距 6 = 58 → 取 60px。
   实测漏算的后果（用户 2026-10 报"用户名的实际点击触发区和插件的重合了"）：
   triggerRow 官方是 width:calc(100% + 4px)、margin 左右 -2px，所以它的右缘 =
   内容盒右缘 + 2。只让 28px 时内容盒右缘 240 → triggerRow 右缘 242，
   而「插件」在 216..240 —— 用户名的**点击区与 hover 底色都压在插件图标下面**。
   让 60px 后：内容盒右缘 208、triggerRow 右缘 210、「插件」左缘 216，留 6px 净空。 */
[class*="footArea"]:not(:has([data-fm-settings-trigger])) [class*="settingsArea"]{box-sizing:border-box;padding-right:60px}
[class*="footArea"]:not(:has([data-fm-settings-trigger])) [class*="footerActions"]{position:absolute;right:0;top:50%;transform:translateY(-50%);width:auto;min-width:0;padding-left:0;align-items:center}

/* 收起态（web 的 56px 轨道）：MA 键在上、设置键在下，竖直居中。同样只在标记在场时生效。
   此时整栏只有 56px，「插件」入口搬进底栏会挤成一团 —— 直接隐藏它（面板本身仍可通过
   快捷键/展开侧栏进入）。
   ⚠️ 前面挂 html:not([data-windows-titlebar]) 是**必须**的：Windows 桌面端收起时整栏 0 宽，
   官方有一条 [data-windows-titlebar] + 折叠类 + footArea 的 display:none。加了 :has() 之后
   本组选择器的特异性升到 (0,3,0)，与官方那条**打平**，而本文件在官方样式表之后注入 →
   会反过来把官方隐藏的脚部强行显示在 0 宽栏里（实测复现过）。这里显式声明"该属性在场时
   整组不适用"，不去赌特异性。
   注意本段 CSS 是模板字符串：注释里**不能出现反引号**（会提前结束模板），测试亦已锁定。 */
html:not([data-windows-titlebar]) [class*="collapsed"] nav[class*="panelList"]{display:none}
html:not([data-windows-titlebar]) [class*="collapsed"] [class*="footArea"]:has([data-fm-settings-trigger]){padding:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:0}
html:not([data-windows-titlebar]) [class*="collapsed"] [class*="footArea"]:has([data-fm-settings-trigger]) [class*="settingsArea"]{position:static;order:2;width:auto;height:auto;min-height:0;margin:0;padding:0;display:flex;justify-content:center}
html:not([data-windows-titlebar]) [class*="collapsed"] [class*="footArea"]:has([data-fm-settings-trigger]) [class*="settingsArea"] [class*="triggerRow"]{width:36px;margin:8px 0 10px}
html:not([data-windows-titlebar]) [class*="collapsed"] [class*="footArea"]:has([data-fm-settings-trigger]) [class*="settingsArea"] [class*="trigger"]:not([class*="triggerRow"]){width:36px;height:36px;margin:0;padding:0;border-radius:50%;justify-content:center}
html:not([data-windows-titlebar]) [class*="collapsed"] [class*="footArea"]:has([data-fm-settings-trigger]) [class*="footerActions"]{order:-1;padding-left:0;width:auto;margin:0;display:flex;justify-content:center}
html:not([data-windows-titlebar]) [class*="collapsed"] [class*="footArea"]:has([data-fm-settings-trigger]) [class*="footerActions"] .fm-mk-btn{width:36px;height:36px;margin:10px 0 0}
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

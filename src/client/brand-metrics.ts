// src/client/brand-metrics.ts — 左上角 logo 块（sidebar.brand.name 槽）的**纯数值**约定。
//
// 单独放一个 .ts 的理由与 image-view.ts 同：组件在 .tsx 里，而本项目的测试是
// `node --test` 直接跑 TypeScript —— Node 的类型剥离认 .ts、**不认 .tsx**（JSX 不会被剥），
// 所以"能被单测断言的宽度账"必须留在 .ts 里。
//
// 全部数字都是**量出来的**（无头 Chrome 实测 + 宿主源码实证），不是审美拍脑袋。
export const WORDMARK_ASPECT = 156 / 24;

/**
 * 官方字标让位后的字号（px）。
 *
 * 官方字标宽度 = size × 156/24（源码实证：BrandWordmark 的 viewBox 是 `26 0 156 24`）。
 * 24px 时 156px —— 侧栏能到的**最窄档**都放不下（见下面的 HOST_MIN_BRAND_WIDTH），
 * 所以字标必须让位：16px → 104px。
 */
export const WORDMARK_SIZE = 16;

/** 锁型内部间距（字标 ↔ 竖线 ↔ 字样）。3px 是"能在最窄侧栏下整条放下"的最大值。 */
export const LOCKUP_GAP = 3;

/** 竖线宽度（px）。 */
export const SEP_WIDTH = 1;

/** MYAGENT 字样的字号（px）。 */
export const TAG_FONT_SIZE = 10;

/** MYAGENT 字样在 10px/700/letter-spacing .08em 下的实测宽度（px，无头 Chrome 量的）。 */
export const TAG_WIDTH = 54;

/** 品牌键里被官方占掉的部分：鲸鱼 24px（sidebar.brand.mark）+ 槽间距 6px。 */
export const MARK_AND_GAP = 24 + 6;

/** 整条锁型的实测宽度：字标 + gap + 竖线 + gap + 字样 = 104 + 3 + 1 + 3 + 54 = 165。 */
export const LOCKUP_WIDTH = WORDMARK_SIZE * WORDMARK_ASPECT + LOCKUP_GAP + SEP_WIDTH + LOCKUP_GAP + TAG_WIDTH;

// —— 宿主侧栏的宽度档位（源码实证：dsh-client-ui-layout 的 clampWidth(px, 264, 420)）——
// 侧栏要么收起（56px rail），要么落在 [264, 420]。
export const HOST_SIDEBAR_MIN = 264;
export const HOST_SIDEBAR_MAX = 420;

/** 侧栏根容器的左右内边距（`--dsh-sidebar-inline-padding: 12px`，左右各一份）。 */
const SIDEBAR_INLINE_PADDING = 12;
/** logo 行的固定开销：左内边距 4 + 折叠键 28 + 行内 gap 8。 */
const LOGO_ROW_OVERHEAD = 4 + 28 + 8;

/** 某个侧栏宽度下，品牌键（`.hHd-Xa_brand`，flex:1）能拿到的宽度。 */
export function brandWidthFor(sidebarWidth: number): number {
  return sidebarWidth - 2 * SIDEBAR_INLINE_PADDING - LOGO_ROW_OVERHEAD;
}

/** 宿主允许的**最窄**品牌键宽度（264px 侧栏 → 200px，实测吻合）。 */
export const HOST_MIN_BRAND_WIDTH = brandWidthFor(HOST_SIDEBAR_MIN);

/** 宿主允许的最宽品牌键宽度（420px 侧栏 → 356px）。 */
export const HOST_MAX_BRAND_WIDTH = brandWidthFor(HOST_SIDEBAR_MAX);

/**
 * 显示 MYAGENT 字样所需的最小品牌键宽度（px）：鲸鱼 + 槽间距 + 整条锁型，再留 2px 余量。
 *
 * **这个阈值必须 ≤ 宿主最窄档（200px）** —— 否则用户把侧栏拖到最窄时字样会消失
 * （2026-09-13 实测报过的现象）。单测把这条不等式钉死了。
 * 正常情况下它永远不触发：锁型在宿主允许的整个宽度区间内都放得下（见 HOST_MIN/MAX_SLOT_BUDGET）。
 * 它只是"宿主哪天把最窄档调小"时的兜底 —— 宁可整条收起，也不要露出半个 `MYAGEN`。
 */
export const TAG_VISIBLE_MIN_BRAND_WIDTH = MARK_AND_GAP + LOCKUP_WIDTH + 2;

/** 最窄档下 name 槽可用的宽度（品牌键 − 鲸鱼 − 槽间距）。 */
export const MIN_NAME_SLOT_BUDGET = HOST_MIN_BRAND_WIDTH - MARK_AND_GAP;

/** 默认侧栏（280px）下 name 槽可用的宽度。 */
export const NAME_SLOT_BUDGET = brandWidthFor(280) - MARK_AND_GAP;

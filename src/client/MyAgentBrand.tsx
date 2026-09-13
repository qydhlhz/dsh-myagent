// src/client/MyAgentBrand.tsx — 左上角 logo 块的 MYAGENT 字样（sidebar.brand.name 槽）。
//
// 【落点：官方已经把 logo 行拆成了两个子槽位】宿主 0.1.5-rc 的 ui-sidebar 在 logo 行里
// renderSlot 两个**子槽位**，官方 ui-brand-official 填它们：
//   sidebar.brand.mark → FishLogo（DeepSeek 鲸鱼，24px，本插件**完全不碰**）
//   sidebar.brand.name → BrandWordmark（DeepSeek Harness 字标 svg，156×24）
// 本插件注册 **sidebar.brand.name**（single 槽，priority -100 压掉官方条目的 0），在槽内
// 自己渲染「官方字标（缩到 17px 让位）+ 竖线 + MYAGENT 字样」。不新建 DOM 层级、不改官方
// 标记、不动折叠键；注册挂在增强层生命周期上 —— **切回标准模式即撤销，官方字标原样回来**。
//
// 【宽度账（实测，改前量的）】宿主侧栏被 `clampWidth(px, 264, 420)` 夹在 **264–420px**
// （源码实证 dsh-client-ui-layout），要么就是 56px 收起态（那时 logo 行整块不渲染）。
//   品牌键（`.hHd-Xa_brand`，flex:1）宽度 = 侧栏宽 − 左右内边距 24 − （左内边距 4 + 折叠键 28 + gap 8）
//   → **最窄档 264px → 200px**（实测吻合），默认 280px → 216px，最宽 420px → 356px。
//   name 槽可用 = 品牌键 − 鲸鱼 24 − 槽间距 6 → 最窄 **170px**、默认 186px。
// 官方字标宽度 = size × 156/24（源码实证：BrandWordmark 的 viewBox 是 "26 0 156 24"）；
// 24px 时 156px —— 连最窄档的 170px 都放不下，故让位到 **16px = 104px**。
// 锁型 = 104 + 3 + 1 + 3 + 53 = **164px ≤ 170px**：**宿主允许的整个宽度区间内都放得下**，
// 所以 MYAGENT 字样在侧栏合法宽度下**永远不消失**（用户 2026-09-13 明确要求）。
// 余下的 `TAG_VISIBLE_MIN_BRAND_WIDTH` 只是宿主哪天把最窄档调小时的兜底。
import React from "react";
import { BrandWordmark } from "@deepseek-ai/dsh-client-ui-primitives";
import { TAG_VISIBLE_MIN_BRAND_WIDTH, WORDMARK_SIZE } from "./brand-metrics.ts";

// —— 官方字标：签名本地声明，绕开过时的 devDependency 存根 ——
// 本项目 devDependencies 里的 primitives 存根是 0.1.0-rc.6：`BrandWordmark({size, className})`
// **没有** `includeMark`（0.1.5 才新增，官方 ui-brand-official 正是用 includeMark:false 只要字形、
// 不要重复的鲸鱼）。运行时该成员由**宿主**模块表提供（primitives 在 esbuild external 列表里）。
//
// 这里用**具名 import**而不是 file-icon.tsx 的 `import * as primitives`：命名导入在打包产物里
// 保持"用到时再取属性"（`import_x.BrandWordmark`），而 `import * as` 会被 esbuild 的
// __toESM 包一层**快照拷贝**（把 require 结果当时已有的可枚举属性拷到新对象上）。
// 快照在真实宿主上没问题（宿主模块表是完整的冻结命名空间），但会让测试里的 Proxy 桩
// "按需生成任意具名导出"的能力失效 —— 实测就是字标在 SSR 断言里凭空消失。
interface WordmarkProps {
  size?: number;
  className?: string;
  /** 是否连同鲸鱼标记一起画（官方 0.1.5 新增；本插件要 false，标记由 mark 槽单独渲染）。 */
  includeMark?: boolean;
}
type WordmarkComponent = (props: WordmarkProps) => React.ReactElement | null;
/** 宿主没提供这个导出时不画字标（有 brand 槽位的宿主一定有它）——不白屏、不抛错。 */
const HostWordmark = BrandWordmark as unknown as WordmarkComponent | undefined;

const BRAND_CSS = `
/* 左上角 logo 块的 MYAGENT 字样（sidebar.brand.name 槽内）。
   全用宿主既有排版属性：color:inherit 跟随 .hHd-Xa_brandName 的 label-primary，
   竖线用 currentColor + 透明度，深浅主题都不需要额外分支。
   尺寸见 brand-metrics.ts：锁型 164px，宿主最窄档的 name 槽是 170px → 整条放得下。 */
.fm-bn-root{display:flex;align-items:center;gap:3px;min-width:0;flex:none}
.fm-bn-wordmark{display:inline-flex;align-items:center;flex:none}
.fm-bn-sep{flex:none;width:1px;height:11px;background:currentColor;opacity:.28}
.fm-bn-tag{flex:none;font-size:10px;font-weight:700;letter-spacing:.08em;line-height:1;color:inherit;white-space:nowrap}
`;

function ensureCss() {
  if (typeof document === "undefined") return;
  const existing = document.querySelector("style[data-fm-bn]");
  if (existing) {
    // 与 ModeKeyButton 同一套 HMR 约定：热替换只清 data-plugin 样式，所以要补 data-plugin。
    existing.setAttribute("data-plugin", "dsh-myagent");
    existing.textContent = BRAND_CSS;
    return;
  }
  const tag = document.createElement("style");
  tag.dataset.fmBn = "1";
  tag.dataset.plugin = "dsh-myagent";
  tag.textContent = BRAND_CSS;
  document.head.appendChild(tag);
}

/**
 * logo 行右半：官方 DeepSeek Harness 字标 + 竖线 + MYAGENT 字样。
 *
 * 宿主调 `renderSlot("sidebar.brand.name", {})`，不带业务 props；整段在
 * `.hHd-Xa_brandIdentity`（`aria-hidden="true"`）内部，是纯装饰，不参与可访问名。
 *
 * `roomy` 这层判定正常情况下**永不触发**（锁型在宿主允许的整个侧栏宽度区间内都放得下，
 * 见 brand-metrics.ts）；它只是宿主把最窄档调小时的兜底：宁可整条收起竖线与字样，
 * 也不要被品牌键的 overflow:hidden 裁成半个 `MYAGEN`。
 */
export function MyAgentBrandName() {
  ensureCss();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [roomy, setRoomy] = React.useState(true);

  React.useEffect(() => {
    const root = rootRef.current;
    // ⚠️ 必须量**品牌键按钮本身**（`closest("button")`，它是 `flex:1`，宽度只由侧栏几何决定）。
    // 2026-09-13 实测踩过的坑：原来按结构写 `parentElement × 3`，但槽内容外面还套了一层
    // `<div data-slot="sidebar.brand.name" style="display:contents">`，于是三级父节点实际是
    // **`.hHd-Xa_brandIdentity`** —— 那是 shrink-to-fit 的盒子，宽度由**内容**决定：
    // 收起字样 → 内容变窄 → 它跟着变窄 → 判定"放不下" → 永远回不来（用户报的正是这个：
    // 拖窄后字样消失，再拖宽也不恢复）。量按钮则与内容无关，不存在这个正反馈。
    const brandButton = root?.closest("button") ?? null;
    if (!brandButton || typeof ResizeObserver === "undefined") return;
    const measure = () => setRoomy(brandButton.clientWidth >= TAG_VISIBLE_MIN_BRAND_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(brandButton);
    return () => observer.disconnect();
  }, []);

  return React.createElement(
    "div",
    { ref: rootRef, className: "fm-bn-root", "data-fm-brand-myagent": "1" },
    HostWordmark
      ? React.createElement(
          "span",
          { className: "fm-bn-wordmark" },
          React.createElement(HostWordmark, { size: WORDMARK_SIZE, includeMark: false }),
        )
      : null,
    roomy
      ? [
          React.createElement("span", { key: "sep", className: "fm-bn-sep", "aria-hidden": "true" }),
          React.createElement("span", { key: "tag", className: "fm-bn-tag" }, "MYAGENT"),
        ]
      : null,
  );
}

// test/settings-compact.test.ts — 设置键/模式键底栏布局的 CSS 回归锁（dsh 0.2 迁移）。
//
// 为什么锁**源码文本**而不是渲染结果：这段 CSS 的作用对象是官方侧栏的 DOM（footArea /
// settingsArea / footerActions），本仓库的 SSR 套件（react-dom/server）里没有官方侧栏，
// 量不到真实几何。真实几何由 .cache/fixture/check.mjs 在真 Chrome 里用**桌面端构建的
// 真实类名与官方规则**实测量过（宽态：设置键 32x32 与模式键同一行 y=49；无插件对照组
// 分处 y=40/y=76 两行）。这里锁的是那份 CSS 必须保持"可移植"的三条硬性质。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(projectRoot, "src", "client", "settings-compact.ts"), "utf8");
const CSS_WITH_COMMENTS = SRC.match(/const CSS = `([\s\S]*?)`;/)?.[1] ?? "";
/** 去掉 CSS 注释后的选择器正文：断言只该看规则，别被解释性注释误伤。 */
const CSS = CSS_WITH_COMMENTS.replace(/\/\*[\s\S]*?\*\//g, "");

test("能从源码里取出 CSS 块（取不到说明这段测试失去意义）", () => {
  assert.ok(CSS.length > 300, "CSS 块应被取出且非空");
});

test("CSS 不含任何写死的 CSS Modules 哈希前缀（桌面端与 npm 构建的哈希不同）", () => {
  // 同一个 0.2.0-rc.2 在两处产物里哈希不同（构建机源码绝对路径决定）：
  //   npm    → hHd-Xa_ / VOzbGW_
  //   桌面端 → _2H3hWW_ / wCInkW_
  // 一旦有人把某个前缀写回选择器，另一半平台就会静默失效。
  for (const prefix of ["hHd-Xa_", "_2H3hWW_", "VOzbGW_", "wCInkW_"]) {
    assert.equal(CSS.includes(prefix), false, `CSS 里不应出现写死的哈希前缀 ${prefix}`);
  }
});

test("用类名子串选择器命中官方三个承重区（两套哈希都能中）", () => {
  for (const key of ["footArea", "settingsArea", "footerActions"]) {
    assert.ok(CSS.includes(`[class*="${key}"]`), `应使用 [class*="${key}"] 子串选择器`);
  }
});

test("子串选择器不会互相误伤：footerActions 不含 footArea", () => {
  // 这是子串匹配法唯一的自伤风险，锁死前提。
  assert.equal("footerActions".includes("footArea"), false);
});

test("设置键本体被收敛到 32x32（并收回官方 triggerRow 的 +4px 宽度）", () => {
  assert.match(CSS, /\[class\*="triggerRow"\]\{width:100%;margin:0/, "应收回 triggerRow 的 width:calc(100% + 4px)");
  assert.match(CSS, /width:32px;height:32px/, "设置键应为 32x32");
  assert.match(CSS, /flex:none/, "应清掉官方 trigger 的 flex:1，否则会被撑到 36px");
});

test("不夺回 Windows 桌面端收起态被官方隐藏的底栏（加 !important 会在 0 宽栏里强行作画）", () => {
  // 官方规则：[data-windows-titlebar] .<hash>_collapsed .<hash>_footArea{display:none}
  // 特异性 (0,3,0) 高于本文件的 (0,2,0)，是**有意**胜出：Windows 桌面端收起时整栏 0 宽。
  // 真 Chrome 实测：该场景 footDisplay === "none"（.cache/fixture/check.mjs）。
  const collapsedFoot = CSS.match(/\[class\*="collapsed"\] \[class\*="footArea"\]\{[^}]*\}/)?.[0] ?? "";
  assert.ok(collapsedFoot.length > 0, "应有收起态的 footArea 规则（web 的 56px 轨道靠它）");
  assert.equal(collapsedFoot.includes("!important"), false, "收起态 footArea 规则不得使用 !important");
});

test("settingsArea 不创建层叠上下文（z-index:auto），设置弹窗才不会被困在侧栏里", () => {
  const rule = CSS.match(/\[class\*="settingsArea"\]\{[^}]*\}/)?.[0] ?? "";
  assert.ok(rule.includes("z-index:auto"), "settingsArea 应显式 z-index:auto");
  // 旧版靠给官方 overlay 打 z-index:1200 补丁（需要写死哈希）；0.2 改为从根上避免层叠上下文。
  assert.equal(CSS.includes("overlay"), false, "不应再给 overlay 写 z-index 补丁");
});

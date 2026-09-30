// test/settings-compact.test.ts — 设置键/模式键底栏布局的 CSS 回归锁（dsh 0.2 迁移）。
//
// 为什么锁**源码文本**而不是渲染结果：这段 CSS 的作用对象是官方侧栏的 DOM（footArea /
// settingsArea / footerActions），本仓库的 SSR 套件（react-dom/server）里没有官方侧栏，
// 量不到真实几何。真实几何由 .cache/fixture/check.mjs 在真 Chrome 里用**桌面端构建的
// 真实类名与官方规则**实测量过，六个场景（官方 trigger / 桌面端账号 launcher /
// 收起态 web / 收起态 Windows、各带无插件对照组）都断言了"是否与模式键重叠"。
// 这里锁的是那份 CSS 必须保持的几条硬性质。
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
/** 拆成单条规则，供逐条检查。 */
const RULES = CSS.split("}").map((r) => r.trim()).filter((r) => r.includes("{"));

const GATE = ":has([data-fm-settings-trigger])";
const TRIGGER_SRC = readFileSync(join(projectRoot, "src", "client", "IconOnlySettingsTrigger.tsx"), "utf8");

test("CSS 里不得出现反引号（它是模板字符串，会提前结束字面量）", () => {
  // 踩过一次：在 CSS 注释里写 markdown 行内代码（反引号）直接截断了 const CSS = `…`，
  // 表现为 tsc 一片语法错、而本文件的提取型断言却仍然"通过"（因为取到的是一段更短的 CSS）。
  assert.equal(CSS_WITH_COMMENTS.includes("`"), false, "CSS 块内不得出现反引号");
});

test("CSS 里不得出现 ${（同样是模板字符串插值陷阱）", () => {
  assert.equal(CSS_WITH_COMMENTS.includes("${"), false, "CSS 块内不得出现模板插值");
});

test("能从源码里取出 CSS 块（取不到说明这段测试失去意义）", () => {
  assert.ok(CSS.length > 300, "CSS 块应被取出且非空");
  assert.ok(RULES.length >= 8, `规则条数偏少（${RULES.length}），提取逻辑可能失效`);
});

test("CSS 不含任何写死的 CSS Modules 哈希前缀（桌面端与 npm 构建的哈希不同）", () => {
  // 同一个 0.2.0-rc.2 在两处产物里哈希不同（构建机源码绝对路径决定）：
  //   npm    → hHd-Xa_ / VOzbGW_
  //   桌面端 → _2H3hWW_ / wCInkW_
  // 一旦有人把某个前缀写回选择器，另一半平台就会静默失效。
  for (const prefix of ["hHd-Xa_", "_2H3hWW_", "VOzbGW_", "wCInkW_", "ET65mq_"]) {
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

test("所有收缩设置席位的规则都必须挂在 :has([data-fm-settings-trigger]) 门下", () => {
  // 桌面端官方账号插件会占用 settings.launcher，官方随即不再渲染 settings.trigger，
  // 席位里换成「头像 + 用户名」的整行控件。若照旧把它压成 32×32 绝对定位盒子，
  // 头像被裁切且整行与模式键叠在一起 —— 用户报的"设置 / MA / 用户图标重合"。
  // 因此凡是要动 settingsArea / triggerRow / trigger / footerActions 几何的规则，
  // 一律必须带这个门（判据是本插件自有标记，不猜官方哈希）。
  const seatShrinking = RULES.filter(
    (r) => /\[class\*="(settingsArea|triggerRow|footerActions)"\]/.test(r) ||
           /\[class\*="trigger"\]:not/.test(r),
  );
  assert.ok(seatShrinking.length >= 5, `应有多条收缩规则，实际 ${seatShrinking.length}`);
  for (const rule of seatShrinking) {
    assert.ok(rule.includes(GATE), `收缩规则缺少 ${GATE} 门：${rule.slice(0, 90)}`);
  }
});

test("标记确实由 IconOnlySettingsTrigger 渲染（否则门永远为假、紧凑布局整体失效）", () => {
  assert.ok(TRIGGER_SRC.includes('"data-fm-settings-trigger"'), "trigger 组件应渲染 data-fm-settings-trigger");
});

test("设置键本体被收敛到 32x32（并收回官方 triggerRow 的 +4px 宽度）", () => {
  assert.ok(
    RULES.some((r) => r.includes(GATE) && /\[class\*="triggerRow"\]\{width:100%;margin:0/.test(r)),
    "应收回 triggerRow 的 width:calc(100% + 4px)",
  );
  assert.ok(RULES.some((r) => r.includes(GATE) && /width:32px;height:32px/.test(r)), "设置键应为 32x32");
  assert.ok(RULES.some((r) => r.includes(GATE) && r.includes("flex:none")), "应清掉官方 trigger 的 flex:1，否则会被撑到 36px");
});

test("收起态规则显式排除 Windows 桌面端（不靠特异性赌博）", () => {
  // 官方 `[data-windows-titlebar] .<hash>_collapsed .<hash>_footArea{display:none}` 是 (0,3,0)；
  // 加了 :has() 之后本文件的收起态规则也是 (0,3,0)，又因注入更晚而反超 —— 实测会把官方
  // 隐藏的脚部显示在 0 宽栏里。故必须显式写 `html:not([data-windows-titlebar])`。
  const collapsed = RULES.filter((r) => r.includes('[class*="collapsed"]'));
  assert.ok(collapsed.length >= 5, `应有收起态规则，实际 ${collapsed.length}`);
  for (const rule of collapsed) {
    assert.ok(
      rule.startsWith("html:not([data-windows-titlebar])"),
      `收起态规则缺少 Windows 桌面端排除：${rule.slice(0, 90)}`,
    );
    assert.equal(rule.includes("!important"), false, "收起态规则不得使用 !important");
  }
});

test("settingsArea 不创建层叠上下文（z-index:auto），设置弹窗才不会被困在侧栏里", () => {
  const rule = RULES.find((r) => /\[class\*="settingsArea"\]\{[^}]*z-index:auto/.test(r));
  assert.ok(rule, "settingsArea 应显式 z-index:auto");
  // 旧版靠给官方 overlay 打 z-index:1200 补丁（需要写死哈希）；0.2 改为从根上避免层叠上下文。
  assert.equal(CSS.includes("overlay"), false, "不应再给 overlay 写 z-index 补丁");
});

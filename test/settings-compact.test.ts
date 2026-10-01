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
const NEGATIVE_GATE = ":not(:has([data-fm-settings-trigger]))";
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

test("凡是要动设置席位的规则都必须带门，且门的方向要和布局模式一致", () => {
  // 桌面端官方账号插件会占用 settings.launcher，官方随即不再渲染 settings.trigger，
  // 席位里换成「头像 + 用户名」的整行控件。若照旧把它压成 32×32 绝对定位盒子，
  // 头像被裁切且整行与模式键叠在一起 —— 用户报的"设置 / MA / 用户图标重合"。
  // 因此凡是要动 settingsArea / triggerRow / trigger / footerActions 几何的规则，
  // 一律必须带门（判据是本插件自有标记，不猜官方哈希），且**只能**是两种方向之一：
  //   · 肯定门 :has(...)        → 席位里是插件自己的单图标 trigger（web）→ 紧凑同行
  //   · 否定门 :not(:has(...))  → 席位被官方账号 launcher 占用（桌面端）→ 并成一行右对齐
  // 关键点：否定门里也含有 ":has([data-fm-settings-trigger])" 这个**子串**，所以只查
  // includes(GATE) 会被它蒙混过关 —— 必须显式区分两种方向。
  // 判定"这条规则动的是不是席位"，要看**选择器的主语**（最后一个复合选择器），
  // 而不是整条文本里出现过什么 —— 否则 `... [class*="footerActions"] .fm-mk-btn`
  // 这种"以我们自己的按钮为主语"的规则会被误判成席位规则。
  const subjectOf = (rule: string): string =>
    rule
      .slice(0, rule.indexOf("{"))
      .split(",")
      .map((sel) => sel.trim().split(/\s+/).pop() ?? "")
      .join(" ");
  const isSeatSubject = (s: string): boolean =>
    /\[class\*="(settingsArea|triggerRow|footerActions)"\]/.test(s) || /\[class\*="trigger"\]:not/.test(s);
  const seatRules = RULES.filter((r) => isSeatSubject(subjectOf(r)));
  assert.ok(seatRules.length >= 8, `应有多条席位规则，实际 ${seatRules.length}`);
  for (const rule of seatRules) {
    const positive = rule.includes(GATE) && !rule.includes(NEGATIVE_GATE);
    const negative = rule.includes(NEGATIVE_GATE);
    assert.ok(positive || negative, `席位规则缺少门（肯定或否定）：${rule.slice(0, 90)}`);
    assert.ok(!(positive && negative), `席位规则的门方向矛盾：${rule.slice(0, 90)}`);
  }
});

test("账号 launcher 在场时：账号行保持官方原样，只把 MA 绝对定位到该行最右（用户 2026-09 定案）", () => {
  const actionsRule = RULES.find((r) => r.includes(NEGATIVE_GATE) && r.includes('[class*="footerActions"]{'));
  assert.ok(actionsRule, "应有否定门下的 footerActions 规则");
  assert.ok(actionsRule.includes("position:absolute"), "MA 应从文档流摘出，才能与账号行同行而不占位");
  assert.ok(actionsRule.includes("right:0"), "MA 应对齐到最右");
  assert.ok(actionsRule.includes("translateY(-50%)"), "MA 应在账号行内垂直居中");
  assert.ok(actionsRule.includes("padding-left:0"), "否定门下不应再给模式键留 36px 让位");
  // 「用户图标原位置不动」：账号席位自己**不得**被改盒模型，只让出右侧给 MA。
  const areaRule = RULES.find((r) => r.includes(NEGATIVE_GATE) && r.includes('[class*="settingsArea"]{'));
  assert.ok(areaRule, "应有否定门下的 settingsArea 规则");
  // 让出的宽度必须覆盖底栏右侧**所有**键（MA + 「插件」），只算 MA 会让用户名的
  // 点击区/hover 底色压到「插件」下面 —— 用户 2026-10 报的正是这个重合。
  assert.ok(areaRule.includes("padding-right:60px"), "账号行右侧要让出 60px（MA 24 + 间距 4 + 插件 24 + 净空 6）");
  assert.equal(areaRule.includes("width:auto"), false, "账号席位应保持官方 width:100%");
  assert.equal(areaRule.includes("position:absolute"), false, "账号席位不得被绝对定位");
  // 也不得再把 footArea 改成行方向（那会把账号行一起推右）
  const footRule = RULES.find((r) => r.includes(NEGATIVE_GATE) && r.includes('[class*="footArea"]{'));
  assert.equal(footRule, undefined, "否定门下不应再动 footArea 的排布（账号行保持官方位置）");
  // 账号行 triggerRow：**纵向**高度/留白按底栏压缩统一收掉（见下一条测试），但横向官方
  // 几何（width / 左右 margin）一律不得被带门的规则覆盖 —— 那才是"保持原样"的实质。
  const gatedRowRules = RULES.filter((r) => r.includes(NEGATIVE_GATE) && r.includes('[class*="triggerRow"]'));
  for (const rule of gatedRowRules) {
    assert.equal(/\bwidth:/.test(rule), false, `不得改账号行 triggerRow 的宽度：${rule.slice(0, 90)}`);
    assert.equal(/\bmargin(-left|-right)?:/.test(rule), false, `不得改账号行 triggerRow 的横向 margin：${rule.slice(0, 90)}`);
  }
});

test("账号行让出的宽度必须覆盖底栏右侧所有键（从 CSS 里取实际键宽算，防漏算）", () => {
  // 这条测试的由来：v0.2.5 把「插件」搬进底栏后，账号行只让了 MA 的 28px，
  // 结果用户名的点击区与 hover 底色压在「插件」图标下面（用户 2026-10 报的重合）。
  // 所以让位宽度不能写死，必须按"右侧所有键的实际宽度 + 间距"来校验。
  const px = (rule: string, prop: string): number => {
    const m = rule.match(new RegExp(prop + ":(\\d+(?:\\.\\d+)?)px"));
    assert.ok(m, `规则里应有 ${prop}：${rule.slice(0, 80)}`);
    return Number(m![1]);
  };
  const maRule = RULES.find((r) => r.includes('[class*="footerActions"] .fm-mk-btn'))!;
  const pluginRule = RULES.find((r) => r.startsWith('nav[class*="panelList"] [class*="panelRow"]'))!;
  const areaRule = RULES.find((r) => r.includes(NEGATIVE_GATE) && r.includes('[class*="settingsArea"]{'))!;

  const maWidth = px(maRule, "width");
  const pluginWidth = px(pluginRule, "width");
  const reserved = px(areaRule, "padding-right");
  // triggerRow 官方是 width:calc(100% + 4px) + 左右 margin -2px → 右缘比内容盒右缘多 2px
  const TRIGGER_OVERHANG = 2;
  const MIN_CLEARANCE = 4; // 用户名区域与「插件」之间至少要有的净空

  const needed = maWidth + pluginWidth + MIN_CLEARANCE + TRIGGER_OVERHANG;
  assert.ok(
    reserved >= needed,
    `让位 ${reserved}px 不够：右侧有 MA(${maWidth}) + 插件(${pluginWidth})，` +
      `还要算上 triggerRow 右侧外溢 ${TRIGGER_OVERHANG}px 与净空 ${MIN_CLEARANCE}px = ${needed}px`,
  );
});

test("底栏整体压缩：行高压到 24px（头像下限），且只收纵向留白不动横向几何", () => {
  const heightRules = RULES.filter((r) => r.includes("height:24px"));
  assert.ok(
    heightRules.some((r) => r.includes(GATE) && r.includes('[class*="settingsArea"]')),
    "肯定门下的 settingsArea 行高应压到 24px",
  );
  assert.ok(
    heightRules.some((r) => r.includes(NEGATIVE_GATE) && r.includes('[class*="settingsArea"]')),
    "否定门下的 settingsArea 行高应压到 24px",
  );
  assert.equal(
    heightRules.some((r) => r.includes('[class*="settingsArea"]') && !r.includes(":has(")),
    false,
    "行高压缩不得出现无门的席位规则（会压扁第三方 launcher 的控件）",
  );
  assert.ok(
    RULES.some((r) => r.includes("margin-top:0") && r.includes('[class*="triggerRow"]')),
    "只收纵向 margin-top/bottom，横向保持官方",
  );
  const maRule = RULES.find((r) => r.includes('[class*="footerActions"] .fm-mk-btn'));
  assert.ok(maRule && maRule.includes("width:24px;height:24px"), "底栏 MA 键应缩到 24x24，与「插件」入口同尺寸");
});

test("官方「插件」入口被搬进底栏（绝对定位，不改官方行为）", () => {
  const ctxRule = RULES.find((r) => r.includes(':has(> nav[class*="panelList"])'));
  assert.ok(ctxRule, "应把同时含 panelList 与 footArea 的 root 变成定位上下文");
  assert.ok(ctxRule.includes("position:relative"), "root 需为 relative 才能给 panelList 定位");
  const navRule = RULES.find((r) => r.startsWith('nav[class*="panelList"]{'));
  assert.ok(navRule, "应有 panelList 的搬移规则");
  assert.ok(navRule.includes("position:absolute"), "panelList 必须脱离文档流（顺带把它让出的整行还给 regionArea）");
  // 允许小数：为了让「插件」与 MA 在同一像素行上，bottom 落在 9.5px（底栏内容盒从 x.5 起）。
  assert.ok(/right:\d+(\.\d+)?px/.test(navRule) && /bottom:\d+(\.\d+)?px/.test(navRule), "应按右/下边偏移定位，侧栏拖宽拖窄都不错位");
  assert.ok(navRule.includes("z-index:2"), "要压在底栏之上才点得到");
  const rowRule = RULES.find((r) => r.startsWith('nav[class*="panelList"] [class*="panelRow"]'));
  assert.ok(rowRule && rowRule.includes("width:24px;height:24px"), "「插件」按钮应与底栏 MA 同尺寸（24x24）");
  const titleRule = RULES.find((r) => r.startsWith('nav[class*="panelList"] [class*="panelTitle"]'));
  assert.ok(titleRule && titleRule.includes("display:none"), "只留图标，文字标题隐藏（否则放不进底栏）");
  // 收起轨道里隐藏它 —— 56px 的轨道塞不下第三个键
  assert.ok(
    RULES.some((r) => r.includes('[class*="collapsed"]') && r.startsWith('html:not([data-windows-titlebar])') && r.includes('nav[class*="panelList"]') && r.includes("display:none")),
    "收起态轨道里应隐藏「插件」入口",
  );
});

test("标记确实由 IconOnlySettingsTrigger 渲染（否则两个门的方向都会判错）", () => {
  assert.ok(TRIGGER_SRC.includes('"data-fm-settings-trigger"'), "trigger 组件应渲染 data-fm-settings-trigger");
});

test("设置键本体被收敛到 32x32（并收回官方 triggerRow 的 +4px 宽度）", () => {
  assert.ok(
    RULES.some((r) => r.includes(GATE) && /\[class\*="triggerRow"\]\{width:100%;margin:0/.test(r)),
    "应收回 triggerRow 的 width:calc(100% + 4px)",
  );
  assert.ok(RULES.some((r) => r.includes(GATE) && /width:24px;height:24px/.test(r)), "设置键应为 24x24（与底栏其余键同尺寸）");
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

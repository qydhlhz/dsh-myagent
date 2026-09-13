// test/client-bundle.test.ts — 客户端半区回归测试：直接加载**打好的 lib/client.js**，
// 用"声明账本"契约的槽位注册表桩跑 apply()，锁死 0.1.5 那次加载期崩溃。
//
// 为什么必须有这一层：宿主 0.1.5-rc 的槽位系统要求
//   (1) 槽位必须先被某个父条目的 children 表**声明**，否则 register 抛
//       `slot X is not declared (a parent entry's children table must declare it)`；
//   (2) 注册必须包在 `slots.inject(key, cb)` 里（声明已存在→同步跑；否则挂到声明提交后；
//       声明塌陷→自动撤销）。
// 旧版插件对 sidebar.workspaces / details 直接 register，于是加载期抛错、整个 loader 条目
// 挂掉（用户看到的 "Failed to load plugins" 横幅）。这里用桩复刻这两条规则：
// 插件若再退化回直连注册，本测试立刻失败。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HOST_MAX_BRAND_WIDTH,
  HOST_MIN_BRAND_WIDTH,
  HOST_SIDEBAR_MAX,
  HOST_SIDEBAR_MIN,
  LOCKUP_WIDTH,
  MARK_AND_GAP,
  MIN_NAME_SLOT_BUDGET,
  NAME_SLOT_BUDGET,
  TAG_VISIBLE_MIN_BRAND_WIDTH,
  WORDMARK_ASPECT,
  WORDMARK_SIZE,
  brandWidthFor,
} from "../src/client/brand-metrics.ts";

const require_ = createRequire(import.meta.url);
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// ——— 宿主 primitives 桩 ————————————————————————————————————————————————
// 真实 primitives 会 require katex 的 .css（Node 载不了），且它的 CSS/图标由宿主编译期注入。
// 这里用 Proxy 给任意具名导出返回一个能渲染的假组件，图标/组件/样式对象都不再需要逐个列。
const primitivesTarget: Record<string, unknown> = { classifyFileType: () => "file" };
const primitivesStub = new Proxy(primitivesTarget, {
  get(target, prop) {
    if (typeof prop !== "string") return undefined;
    if (prop === "__esModule") return true;
    if (!(prop in target)) {
      // 转发**标量** props（data-* / aria-label / title / className 等）到 span 上：
      // 只渲染 data-prim 会把按钮的身份属性全丢掉，测试就无从断言"哪个按钮、在哪儿"。
      // 对象/函数类 props（icon 是 React 元素、style 是对象）不适合落到 DOM 属性上，丢弃。
      target[prop] = (props: Record<string, unknown>) => {
        const { children, ...rest } = props ?? {};
        const forwarded: Record<string, unknown> = { "data-prim": prop };
        for (const [key, value] of Object.entries(rest)) {
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            forwarded[key] = value;
          }
        }
        return React.createElement("span", forwarded, (children ?? null) as React.ReactNode);
      };
    }
    return target[prop];
  },
});

// ——— 浏览器全局桩 ——————————————————————————————————————————————————————
// mode-store 在模块加载期读 localStorage：读不到就退化为 "original"（不注册增强层），
// 那样所有断言都会空转。这里给出"用户已切到 MyAgent 模式"的持久化状态。
const localStorageStub = {
  store: new Map<string, string>([["dsh-myagent.mode", "myagent"]]),
  getItem(key: string) {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  },
  setItem(key: string, value: string) {
    this.store.set(key, value);
  },
  removeItem(key: string) {
    this.store.delete(key);
  },
};
(globalThis as unknown as { localStorage: unknown }).localStorage = localStorageStub;

// ——— 槽位注册表桩（复刻 SlotCore 的声明账本 + 优先级 + 塌陷） ————————————————
interface SlotRecord {
  spec?: { kind: string; scope: string };
  entries: Array<{ options: Record<string, unknown>; component: unknown }>;
  declarationListeners: Set<() => void>;
  epoch: number;
}

class SlotLedgerStub {
  records = new Map<string, SlotRecord>();

  constructor() {
    // 宿主内置根槽位（SlotCore 构造时 record("root") 并给 spec）。
    this.records.set("root", {
      spec: { kind: "single", scope: "root" },
      entries: [],
      declarationListeners: new Set(),
      epoch: 1,
    });
  }

  private record(name: string): SlotRecord {
    let r = this.records.get(name);
    if (!r) {
      r = { entries: [], declarationListeners: new Set(), epoch: 0 };
      this.records.set(name, r);
    }
    return r;
  }

  /** 模拟某个父条目注册时把 children 表写进账本（ui-sidebar / ui-settings-general 的角色）。 */
  declare(name: string, spec: { kind: string; scope: string }): void {
    const r = this.record(name);
    r.spec = spec;
    r.epoch += 1;
    for (const listener of [...r.declarationListeners]) listener();
  }

  /** 模拟声明塌陷（父条目注销）：spec 清掉并通知等待者。 */
  collapse(name: string): void {
    const r = this.record(name);
    r.spec = undefined;
    r.epoch += 1;
    r.entries = [];
    for (const listener of [...r.declarationListeners]) listener();
  }

  register(options: Record<string, any>, component: unknown): () => void {
    const r = this.record(options.name);
    if (!r?.spec) {
      throw new Error(
        `slot "${options.name}" is not declared (a parent entry's children table must declare it)`,
      );
    }
    if (r.spec.kind === "single") {
      const p = options.priority ?? 0;
      if (r.entries.some((e) => (e.options.priority ?? 0) === p)) {
        throw new Error(`single slot "${options.name}" already has a registration at priority ${p}`);
      }
    }
    const entry = { options, component };
    r.entries.push(entry);
    // single/list：按 priority 升序；single 槽"最低优先级渲染"→ 取 entries[0]。
    r.entries.sort((a, b) => ((a.options.priority as number) ?? 0) - ((b.options.priority as number) ?? 0));
    return () => {
      r.entries = r.entries.filter((e) => e !== entry);
    };
  }

  /** 模拟 SlotRegistry.inject：声明已存在则同步执行，否则等声明提交；塌陷时撤销。 */
  inject(key: string, callback: () => (() => void) | void): () => void {
    const r = this.record(key);
    let disposal: (() => void) | undefined;
    let stopped = false;
    const reconcile = () => {
      if (stopped) return;
      if (r.spec !== undefined && disposal === undefined) {
        disposal = callback() ?? undefined;
      } else if (r.spec === undefined && disposal !== undefined) {
        disposal();
        disposal = undefined;
      }
    };
    r.declarationListeners.add(reconcile);
    reconcile();
    return () => {
      stopped = true;
      r.declarationListeners.delete(reconcile);
      disposal?.();
      disposal = undefined;
    };
  }
}

// ——— 加载打好的客户端 bundle ————————————————————————————————————————————
interface LoadedPlugin {
  apply: (ctx: unknown) => void;
  inject: string[];
}

function loadClientBundle(): LoadedPlugin {
  const source = readFileSync(join(projectRoot, "lib", "client.js"), "utf8");
  let loaded: { id: string; factory: (req: (spec: string) => unknown) => LoadedPlugin } | undefined;
  const g = globalThis as unknown as { window?: unknown };
  const previousWindow = g.window;
  g.window = {
    __ModuleLoader__: {
      load: (descriptor: { id: string; factory: (req: (spec: string) => unknown) => LoadedPlugin }) => {
        loaded = descriptor;
      },
    },
  };
  try {
    // bundle 自带 `window.__ModuleLoader__.load(...)` 的调用；这里直接求值即可。
    new Function(source)();
  } finally {
    g.window = previousWindow;
  }
  assert.ok(loaded, "lib/client.js 未调用 window.__ModuleLoader__.load（构建产物形态不对）");
  assert.equal(loaded!.id, "dsh-myagent");
  return loaded!.factory((spec: string) => {
    if (spec === "react") return React;
    // esbuild 把 external 包的所有子路径一并外置（react/jsx-runtime 走自动 JSX 运行时）。
    if (spec === "react/jsx-runtime") return require_("react/jsx-runtime");
    if (spec === "react-dom") return require_("react-dom");
    if (spec === "react-dom/client") return require_("react-dom/client");
    if (spec === "@deepseek-ai/dsh-client-ui-primitives") return primitivesStub;
    throw new Error(`bundle 请求了未在模块表里的依赖: ${spec}`);
  });
}

function makeCtx(ledger: SlotLedgerStub, options: { registryAvailable?: boolean } = {}) {
  const openResourceCalls: Array<{ address: string; options: unknown }> = [];
  const tabTypes: Array<Record<string, any>> = [];
  // documentPreviews：官方预览的渲染器注册表（此处用桩记录注册内容）。
  const documentPreviews: Array<Record<string, any>> = [];
  // 官方预览是否存在：false 时 ctx.inject(["documentPreviews"]) 永不回调。
  const registryAvailable = options.registryAvailable !== false;
  const registry = {
    register: (definition: Record<string, any>) => {
      documentPreviews.push(definition);
      return () => {
        const i = documentPreviews.indexOf(definition);
        if (i >= 0) documentPreviews.splice(i, 1);
      };
    },
  };
  // 所有"注销时要执行的" disposer（ctx.effect 与 slots.inject 两路都收）：
  // 模式切换时 enhancementDisposers 里两者都有，测试要能一次全执行。
  const disposers: Array<() => void> = [];
  const ctx = {
    slots: {
      register: (options: Record<string, any>, component: unknown) => ledger.register(options, component),
      inject: (key: string, cb: () => unknown) => {
        // 真实现支持回调返回「单个 disposer 或 disposer 可迭代」，这里一并复刻。
        const stop = ledger.inject(key, () => {
          const result = cb();
          if (typeof result === "function") return result as () => void;
          if (Array.isArray(result)) {
            return () => {
              for (const dispose of [...result].reverse()) {
                if (typeof dispose === "function") dispose();
              }
            };
          }
          return () => {};
        });
        disposers.push(stop);
        return stop;
      },
    },
    // cordis 的动态注入（ctx.inject(deps, cb)）：服务出现时才回调，回调拿到可用的子 scope；
    // 服务缺席则回调永不执行 —— 这正是"官方预览被禁用时本插件其余部分照常激活"的语义。
    inject: (deps: string[], cb: (scope: any) => void) => {
      if (!deps.includes("documentPreviews") || !registryAvailable) return () => {};
      cb({
        documentPreviews: registry,
        effect: (fn: () => unknown) => {
          const result = fn();
          const dispose = typeof result === "function" ? (result as () => void) : () => {};
          disposers.push(dispose);
          return dispose;
        },
      });
      // 真实返回的是 fiber（可 dispose）而非函数；返回一个函数即可被 disposers 调用。
      return () => {
        registry.register = () => () => {};
      };
    },
    effect: (fn: () => unknown) => {
      const result = fn();
      const dispose = typeof result === "function" ? (result as () => void) : () => {};
      disposers.push(dispose);
      return dispose;
    },
    // 标签类型注册表：记录注册内容并像真注册表那样返回 disposer。
    sidebarRightTabs: {
      register: (definition: Record<string, any>) => {
        tabTypes.push(definition);
        return () => {
          const i = tabTypes.indexOf(definition);
          if (i >= 0) tabTypes.splice(i, 1);
        };
      },
    },
    // openResource 由 apply 期间捕获、点击时调用；没有挂载会话面板时宿主会抛错。
    sidebarRight: {
      openResource: (address: string, options?: unknown) => {
        openResourceCalls.push({ address, options });
      },
    },
    sessions: { list: { getSnapshot: () => ({ items: [], byId: {}, current: undefined }) } },
    workspaces: { list: { getSnapshot: () => ({ items: [], archivedSessionIds: [] }) } },
  };
  return { ctx, openResourceCalls, tabTypes, disposers, documentPreviews };
}

const WORKSPACES = {
  items: [{ workspaceId: "w1", path: "D:/ws", title: "ws", sessionIds: ["s1"] }],
  archivedSessionIds: [],
};
const SESSIONS = { byId: { s1: { id: "s1", title: "会话一" } }, current: "s1" };

test("apply() 在槽位尚未声明时不抛错（旧版直连注册会在此崩掉整个 loader 条目）", () => {
  const ledger = new SlotLedgerStub();
  const { ctx } = makeCtx(ledger);
  const plugin = loadClientBundle();
  // 关键回归点：宿主条目注册顺序不保证，myagent 可能先 apply。直连 register 必抛。
  assert.doesNotThrow(() => plugin.apply(ctx));
  // 此时三个槽位都还没声明 → 一个贡献都不该落账（靠 inject 等待，而不是硬注册）。
  assert.equal(ledger.records.get("sidebar.workspaces")?.entries.length ?? 0, 0);
});

test("顺序无关：先 apply 后声明，贡献在声明提交时补上", () => {
  const ledger = new SlotLedgerStub();
  const { ctx } = makeCtx(ledger);
  const plugin = loadClientBundle();
  plugin.apply(ctx);

  // ui-sidebar 的 sidebar 条目声明它那一批子槽位（含 sidebar.workspaces / footer.action）。
  ledger.declare("sidebar.workspaces", { kind: "single", scope: "root" });
  ledger.declare("sidebar.footer.action", { kind: "list", scope: "root" });
  // ui-settings-general 的 sidebar.settings 条目声明 settings.trigger。
  ledger.declare("settings.trigger", { kind: "single", scope: "root" });

  const wsEntries = ledger.records.get("sidebar.workspaces")!.entries;
  assert.equal(wsEntries.length, 1);
  assert.equal(wsEntries[0].options.priority, -100, "必须以 -100 压掉官方 ui-workspace 的 0");
  assert.equal(typeof wsEntries[0].component, "function");

  const footer = ledger.records.get("sidebar.footer.action")!.entries;
  assert.equal(footer.length, 1);
  assert.equal(footer[0].options.id, "dsh-myagent-mode");

  assert.equal(ledger.records.get("settings.trigger")!.entries.length, 1);
  assert.equal(ledger.records.get("settings.trigger")!.entries[0].options.priority, -100);
});

test("顺序无关：槽位先声明后 apply，贡献立即落账", () => {
  const ledger = new SlotLedgerStub();
  ledger.declare("sidebar.workspaces", { kind: "single", scope: "root" });
  ledger.declare("sidebar.footer.action", { kind: "list", scope: "root" });
  ledger.declare("settings.trigger", { kind: "single", scope: "root" });
  const { ctx } = makeCtx(ledger);
  loadClientBundle().apply(ctx);
  assert.equal(ledger.records.get("sidebar.workspaces")!.entries.length, 1);
  assert.equal(ledger.records.get("sidebar.footer.action")!.entries.length, 1);
  assert.equal(ledger.records.get("settings.trigger")!.entries.length, 1);
});

test("桩的保真度：直连注册未声明槽位必须抛（否则上面的测试是空转）", () => {
  const ledger = new SlotLedgerStub();
  assert.throws(
    () => ledger.register({ name: "sidebar.workspaces", priority: -100 }, () => null),
    /is not declared \(a parent entry's children table must declare it\)/,
  );
});

test("槽位塌陷后再声明：贡献被撤销并重新补上（不残留、不重复注册）", () => {
  const ledger = new SlotLedgerStub();
  ledger.declare("sidebar.workspaces", { kind: "single", scope: "root" });
  const { ctx } = makeCtx(ledger);
  loadClientBundle().apply(ctx);
  assert.equal(ledger.records.get("sidebar.workspaces")!.entries.length, 1);

  ledger.collapse("sidebar.workspaces");
  assert.equal(ledger.records.get("sidebar.workspaces")!.entries.length, 0);

  ledger.declare("sidebar.workspaces", { kind: "single", scope: "root" });
  assert.equal(ledger.records.get("sidebar.workspaces")!.entries.length, 1, "重新声明后应恰好一个贡献");
});

test("左栏组件能真实渲染出工作区 + 区文件树（且未走错误边界降级）", () => {
  const ledger = new SlotLedgerStub();
  ledger.declare("sidebar.workspaces", { kind: "single", scope: "root" });
  const { ctx } = makeCtx(ledger);
  loadClientBundle().apply(ctx);

  const entry = ledger.records.get("sidebar.workspaces")!.entries[0];
  const injectFace = (entry.options.inject as () => Record<string, unknown>)?.() ?? {};
  const html = renderToStaticMarkup(
    React.createElement(entry.component as React.ComponentType<Record<string, unknown>>, {
      // 槽位标准套件（宿主 renderSlot 注入）+ 本条目 inject 的动作。
      useSessions: (sel: (s: unknown) => unknown) => sel(SESSIONS),
      useWorkspaces: (sel: (s: unknown) => unknown) => sel(WORKSPACES),
      wide: true,
      expandSidebar: () => {},
      ...injectFace,
    }),
  );
  assert.match(html, /工作区/, "左栏复合应渲染工作区（区标签名）");
  assert.match(html, /区文件树/, "左栏复合应渲染区文件树（区标签名）");
  // 改名彻底：旧文案不该再出现。
  assert.doesNotMatch(html, /沙盒/, "旧「沙盒」字样应已全部改名为「区」");
  // ErrorBoundary 兜底文案出现即说明 ComposedInner 渲染抛错被降级。
  assert.doesNotMatch(html, /重试/, "渲染不应落到错误边界占位");
  assert.match(html, /D:\/ws/, "文件树应使用 resolveRoot 推出的工作区根");
});

test("分组标题行有「新对话（当前选中分组）」按钮，且排在「重命名分组」左边", () => {
  const ledger = new SlotLedgerStub();
  ledger.declare("sidebar.workspaces", { kind: "single", scope: "root" });
  const { ctx } = makeCtx(ledger);
  loadClientBundle().apply(ctx);

  const entry = ledger.records.get("sidebar.workspaces")!.entries[0];
  const injectFace = (entry.options.inject as () => Record<string, unknown>)?.() ?? {};
  const html = renderToStaticMarkup(
    React.createElement(entry.component as React.ComponentType<Record<string, unknown>>, {
      useSessions: (sel: (s: unknown) => unknown) => sel(SESSIONS),
      useWorkspaces: (sel: (s: unknown) => unknown) => sel(WORKSPACES),
      wide: true,
      expandSidebar: () => {},
      ...injectFace,
    }),
  );
  // 默认分组那一行是同步渲染的（命名分组要等 groups.json 读盘），所以这里就能断言到。
  const newChat = html.indexOf("data-myagent-new-chat-group");
  const rename = html.indexOf('aria-label="重命名分组"');
  assert.ok(newChat >= 0, "分组标题行应有新对话按钮");
  assert.ok(rename >= 0, "分组标题行应有重命名按钮");
  assert.ok(newChat < rename, "新对话按钮必须在「重命名分组」左边");
  // 与工具栏那颗同款：同标签、同图标。
  assert.match(html.slice(newChat - 400, newChat + 400), /新对话（当前选中分组）/);
});

test("插件不再注册已删除的 details 槽", () => {
  const ledger = new SlotLedgerStub();
  // 宿主 0.1.5 已无 details 槽；若插件还注册它，inject 会永远等不到、且这里能查出来。
  const { ctx } = makeCtx(ledger);
  loadClientBundle().apply(ctx);
  assert.equal(ledger.records.get("details")?.entries.length ?? 0, 0);
});

test('取消官方文件树：extension 档接管 kind "files"，且不带 guide 条目', () => {
  const ledger = new SlotLedgerStub();
  const { ctx, tabTypes } = makeCtx(ledger);
  loadClientBundle().apply(ctx);

  const shadow = tabTypes.find((d) => d.kind === "files");
  assert.ok(shadow, '应注册一个 kind "files" 的类型来接管官方文件树');
  assert.equal(shadow.priority, "extension", "必须用 extension 档才能压掉官方的 builtin 档");
  // guide 条目是官方文件树的唯一入口；不给 guide 字段 = 它从 guide 页与标签类型表里消失。
  assert.equal(shadow.guide, undefined, "接管类型不能带 guide 条目，否则入口还在");
  // 类型 id 必须与官方不同（官方是包名），否则注册表按 id 去重会抛。
  assert.notEqual(shadow.id, "@deepseek-ai/dsh-client-ui-sidebar-files");
});

test("不碰文件预览：接管类型不认领任何地址，插件也不注册 text 模式", () => {
  const ledger = new SlotLedgerStub();
  const { ctx, tabTypes } = makeCtx(ledger);
  loadClientBundle().apply(ctx);

  // 预览是 kind "text" 的 fallback 档、靠 patterns 认领 dsh-resource://file/**。
  // 只要没有"标签类型"声明 patterns，claim() 的候选排名就不会被改变。
  for (const definition of tabTypes) {
    assert.equal(definition.patterns, undefined, `${definition.id} 不应声明 patterns（会抢地址认领）`);
  }
  assert.ok(!tabTypes.some((d) => d.kind === "text"), '不应注册 kind "text"（那是官方预览）');
  assert.ok(loadClientBundle().inject.includes("sidebarRight"), "打开官方预览标签页需要 sidebarRight");
});

test("接管类型注册了说明性 body，老会话里已开的文件树标签页不会显示“无法查看”", () => {
  const ledger = new SlotLedgerStub();
  ledger.declare("sidebar.right.pane.tab", { kind: "keyed", scope: "session" });
  const { ctx, tabTypes } = makeCtx(ledger);
  loadClientBundle().apply(ctx);

  const shadow = tabTypes.find((d) => d.kind === "files");
  assert.ok(shadow);
  // 座席按"在档类型的 id"派发 body（TabSlot 用 definition.id 作 entryKey）。
  const body = ledger.records.get("sidebar.right.pane.tab")!.entries.find(
    (e) => e.options.key === shadow.id,
  );
  assert.ok(body, "应注册与接管类型 id 同 key 的 body");
  const html = renderToStaticMarkup(
    React.createElement(body!.component as React.ComponentType<Record<string, unknown>>, {}),
  );
  assert.match(html, /区文件树/, "占位应指向左侧区文件树");
});

test("退出 MyAgent 模式后接管被撤销，官方文件树恢复", () => {
  const ledger = new SlotLedgerStub();
  ledger.declare("sidebar.workspaces", { kind: "single", scope: "root" });
  const { ctx, tabTypes, disposers } = makeCtx(ledger);
  loadClientBundle().apply(ctx);

  assert.ok(tabTypes.some((d) => d.kind === "files"), "MyAgent 模式下应接管文件树");
  assert.equal(ledger.records.get("sidebar.workspaces")!.entries.length, 1);

  // 模式切换（以及插件卸载）走的就是这些 disposer（ctx.effect 与 slots.inject 两路）：
  // unregisterEnhancements 逐个执行它们。这里直接执行，等价于切回 official 模式。
  assert.ok(disposers.length > 0, "注册必须挂在可撤销的 effect/inject 上");
  for (const dispose of disposers.splice(0)) dispose();

  assert.equal(tabTypes.filter((d) => d.kind === "files").length, 0, "接管必须可撤销（官方文件树恢复）");
});

test("图片渲染器：extension 档只接管图片扩展名，body 与其 id 同 key", () => {
  const ledger = new SlotLedgerStub();
  // 该槽由官方预览的标签条目声明 —— 声明了才说明官方预览在场、注册表可用。
  ledger.declare("sidebar.right.tab.document", { kind: "keyed", scope: "session" });
  const { ctx, documentPreviews } = makeCtx(ledger);
  loadClientBundle().apply(ctx);

  const definition = documentPreviews[0];
  assert.ok(definition, "应向 documentPreviews 注册一个渲染器");
  assert.equal(definition.id, "dsh-myagent/image-panzoom");
  assert.equal(definition.priority, "extension", "必须压过内建图片渲染器");
  assert.equal(definition.loading, "bytes-complete", "图片要完整字节");
  // 关键约束：**只**认领图片扩展名 —— 否则会把 Markdown/代码等也抢过来（用户明确要求别动别的）。
  assert.deepEqual([...definition.extensions], ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"]);
  for (const notImage of ["md", "ts", "tsx", "json", "pdf", "html", "txt", "csv"]) {
    assert.ok(!definition.extensions.includes(notImage), `不应认领非图片扩展名 ${notImage}`);
  }
  assert.equal(definition.wrap, undefined, "图片不使用换行偏好");

  // body 按渲染器 id 派发（TextPreview 用 selected.id 作 entryKey）。
  const body = ledger.records
    .get("sidebar.right.tab.document")!
    .entries.find((e) => e.options.key === definition.id);
  assert.ok(body, "应注册与渲染器 id 同 key 的 body");
});

test("图片 body 能真实渲染出拖动/缩放交互的骨架", () => {
  const ledger = new SlotLedgerStub();
  ledger.declare("sidebar.right.tab.document", { kind: "keyed", scope: "session" });
  const { ctx, documentPreviews } = makeCtx(ledger);
  loadClientBundle().apply(ctx);
  const definition = documentPreviews[0];
  const body = ledger.records
    .get("sidebar.right.tab.document")!
    .entries.find((e) => e.options.key === definition.id);

  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const html = renderToStaticMarkup(
    React.createElement(body!.component as React.ComponentType<Record<string, unknown>>, {
      resourceAddress: "dsh-resource://file/absolute/C:/pics/photo.png",
      content: { kind: "bytes", data: pngBytes },
      wrap: false,
      scrollportRef: () => {},
    }),
  );
  // 注意：`<img>` 需要 object URL，而 object URL 在 useEffect 里创建 —— 服务端渲染不跑
  // effect，所以这里断言的是 SSR 该有的骨架；真正的图片上屏由 CDP 实跑验证。
  assert.match(html, /fm-zoom-host/, "应有拖动/缩放的宿主容器");
  assert.match(html, /role="img"/, "应有 img 语义");
  assert.match(html, /aria-label="图片预览/, "应有可访问名");
  assert.match(html, /touch-action:none/, "触屏拖动不应被页面滚动吞掉");
  assert.match(html, /100%/, "应显示当前缩放比例");
  assert.match(html, /拖动平移/, "应显示操作提示");
});

test("图片渲染器可撤销（切回标准模式后官方图片渲染器恢复）", () => {
  const ledger = new SlotLedgerStub();
  ledger.declare("sidebar.right.tab.document", { kind: "keyed", scope: "session" });
  const { ctx, documentPreviews, disposers } = makeCtx(ledger);
  loadClientBundle().apply(ctx);
  assert.equal(documentPreviews.length, 1);

  for (const dispose of disposers.splice(0)) dispose();
  assert.equal(documentPreviews.length, 0, "渲染器注册必须可撤销");
});

test("官方预览缺席时不炸：documentPreviews 服务不出现就跳过图片渲染器", () => {
  const ledger = new SlotLedgerStub();
  // 槽位不会存在（官方预览没加载），动态注入也永不回调 —— 两种情况都不该抛。
  const { ctx, tabTypes, documentPreviews } = makeCtx(ledger, { registryAvailable: false });
  assert.doesNotThrow(() => loadClientBundle().apply(ctx));
  assert.equal(documentPreviews.length, 0, "服务缺席时不应注册渲染器");
  // 而且本插件其余部分照常注册（左栏/compat 增强不受影响）。
  ledger.declare("sidebar.workspaces", { kind: "single", scope: "root" });
  assert.equal(ledger.records.get("sidebar.workspaces")!.entries.length, 1, "官方预览缺席不该拖垮本插件");
  assert.ok(tabTypes.some((d) => d.kind === "files"), "文件树接管也应照常");
});

/**
 * 源码级守卫：客户端「重新总结简介 / 重新总结命名」必须把按钮自己的 mode 透传给接口。
 *
 * 为什么用源码断言而不是行为断言：这个处理函数挂在组件内部、靠 DOM 点击触发，
 * 而本套件只有 `react-dom/server`（SSR 不跑事件处理器），够不到这条路径。
 * 回归代价却是实测过的：v0.3.0 那轮把 `sessionResummarize(sessionId, mode)` 写成
 * `(sessionId, "both")`，于是**点「重新总结简介」会把标题一起改掉**
 * （服务端按 mode 过滤返回字段，both 会带回 title，客户端两段都执行）。
 */
test("「重新总结简介 / 命名」必须透传 mode，不能写死 both", () => {
  const src = readFileSync(join(projectRoot, "src", "client", "WorkspaceBrowser.tsx"), "utf8");
  assert.match(src, /sessionResummarize\(sessionId,\s*mode\)/, "必须把按钮的 mode 透传给 /session/resummarize");
  assert.doesNotMatch(
    src,
    /sessionResummarize\(sessionId,\s*"both"\)/,
    '不能写死 "both" —— 那会让「重新总结简介」连标题一起改掉',
  );
});

// ——— 收起态（rail）重设计回归 ————————————————————————————————————————————
// 锁两件事：① 交互 bug —— 旧 rail 为每个工作区渲染一颗文件夹图标，点击走
// startSession(workspaceId)，也就是"点文件夹 = 新建对话"；现在 rail 只有两颗区标，
// 工作区图标列表与「新对话」键都必须消失。② 「正在进行的任务」的筛选口径 ——
// running ∪ pendingInteraction，空闲与已完成都不能混进来。
const RAIL_WORKSPACES = {
  items: [{ workspaceId: "w1", path: "D:/ws", title: "工作区一", sessionIds: ["s-run", "s-wait", "s-idle", "s-done"] }],
  archivedSessionIds: [],
};
const RAIL_SESSIONS = {
  byId: {
    "s-run": { id: "s-run", title: "正在跑的活", running: true },
    "s-wait": { id: "s-wait", title: "等批准的活", pendingInteraction: "approval" },
    "s-idle": { id: "s-idle", title: "闲着的活" },
    "s-done": { id: "s-done", title: "已完成的活", completed: true },
  },
  current: "s-run",
};

function renderRail(): string {
  const ledger = new SlotLedgerStub();
  ledger.declare("sidebar.workspaces", { kind: "single", scope: "root" });
  const { ctx } = makeCtx(ledger);
  loadClientBundle().apply(ctx);
  const entry = ledger.records.get("sidebar.workspaces")!.entries[0];
  const injectFace = (entry.options.inject as () => Record<string, unknown>)?.() ?? {};
  return renderToStaticMarkup(
    React.createElement(entry.component as React.ComponentType<Record<string, unknown>>, {
      useSessions: (sel: (s: unknown) => unknown) => sel(RAIL_SESSIONS),
      useWorkspaces: (sel: (s: unknown) => unknown) => sel(RAIL_WORKSPACES),
      wide: false,
      expandSidebar: () => {},
      ...injectFace,
    }),
  );
}

test("收起态只留两颗区标：工作区 + 文件树，没有工作区图标列表、也没有「新对话」键", () => {
  const html = renderRail();
  assert.match(html, /data-myagent-rail="workspace"/, "应有「工作区」区标");
  assert.match(html, /data-myagent-rail="files"/, "应有「文件树」区标");
  // 旧的错误交互载体（每个工作区一颗文件夹图标 + 「新对话」键）必须彻底消失。
  assert.doesNotMatch(html, /data-myagent-new-chat/, "rail 不应再有「新对话」键");
  const railTags = html.match(/data-myagent-rail="/g) ?? [];
  assert.equal(railTags.length, 4, "rail 上应恰好 4 个条目：2 颗区标 + 2 个进行中任务");
});

test("收起态修掉「点文件夹图标 = 新建对话」：区标点击只展开，不带 startSession", () => {
  const html = renderRail();
  // 区标的可访问名说明它做的是"展开并定位/显示"，而不是"新建会话"。
  assert.match(html, /aria-label="展开并定位到当前对话所在的工作区"/);
  assert.match(html, /aria-label="展开并显示当前对话的文件树"/);
  // 旧实现的按钮标题是工作区标题本身（点了就 startSession），这里不该再出现。
  assert.doesNotMatch(html, /aria-label="工作区一"/, "不应再为工作区渲染「点它就是新建会话」的图标");
});

test("收起态「正在进行」= running ∪ 等待交互；空闲与已完成不显示", () => {
  const html = renderRail();
  const tasks = html.match(/data-myagent-rail="task"/g) ?? [];
  assert.equal(tasks.length, 2, "只有 running 与 pendingInteraction 两条算进行中");
  assert.match(html, /title="正在跑的活 · 正在运行"/, "运行中的任务应带状态名");
  assert.match(html, /title="等批准的活 · 等待批准"/, "等待批准的任务应带状态名");
  assert.doesNotMatch(html, /闲着的活/, "空闲会话不算进行中");
  assert.doesNotMatch(html, /已完成的活/, "已完成会话不算进行中");
});

// ——— 区管家面板细节（用户定案第 N 轮） ——————————————————————————————————
// 这一轮改的全是"看得见、但 SSR 够不到"的东西：面板只在展开态渲染，而本套件只有
// react-dom/server（没有事件、没有布局），量不到按钮在右上角、也量不到图标在转。
// 所以照 `sessionResummarize` 那条守卫的先例，锁**源码结构**；几何与动画由
// .cache/panel-harness/check.mjs（真 Chrome 量 getBoundingClientRect / 计算样式）实跑验证。
const ORGANIZE_PANEL_SRC = () => readFileSync(join(projectRoot, "src", "client", "OrganizePanel.tsx"), "utf8");

/**
 * 构建产物里的中文形态取决于 esbuild 的 charset：模板字符串（如面板 CSS）保留原文，
 * 而 JSX 文本子节点会被转成 `\uXXXX`（实测是**大写**十六进制）。三种形态都认，
 * 免得把断言绑死在打包器的编码选择上。
 */
function bundleHas(bundle: string, text: string): boolean {
  if (bundle.includes(text)) return true;
  for (const upper of [false, true]) {
    const escaped = [...text]
      .map((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        if (code <= 127) return ch;
        const hex = code.toString(16).padStart(4, "0");
        return "\\u" + (upper ? hex.toUpperCase() : hex);
      })
      .join("");
    if (bundle.includes(escaped)) return true;
  }
  return false;
}

test("区管家面板：更新中的图标是**在转的**（挂 fm-op-spin + CSS 真有 keyframes）", () => {
  const src = ORGANIZE_PANEL_SRC();
  // 官方 IconLoadingOutline16 只是一段静态缺口弧，不自带动画 —— 必须由本插件补 keyframes。
  assert.match(src, /@keyframes fm-op-spin\{from\{transform:rotate\(0deg\)\}to\{transform:rotate\(360deg\)\}\}/);
  assert.match(src, /\.fm-op-spin\{animation:fm-op-spin 1s linear infinite/);
  const spinning = src.match(/<IconLoadingOutline16[^>]*className="fm-op-spin"/g) ?? [];
  assert.equal(spinning.length, 2, "「更新中」与「整理中」两颗图标都要转");
  assert.match(src, /props\.updating \? \(/, "更新态才换成转圈图标");
  assert.match(src, /props\.organizing \? \(/, "整理态才换成转圈图标");
  // 打到**构建产物**上：旧版出现过"改了源码、面板还是老样子"（stale lib/client.js）。
  const bundle = readFileSync(join(projectRoot, "lib", "client.js"), "utf8");
  assert.ok(
    bundle.includes("@keyframes fm-op-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}"),
    "lib/client.js 里必须有转圈的 keyframes（否则是产物没重建）",
  );
  const mounted = bundle.match(/className: "fm-op-spin"/g) ?? [];
  assert.equal(mounted.length, 2, "产物里应有且只有两颗图标挂 fm-op-spin（更新中 / 整理中）");
});

test("区管家面板：明细按钮在本块右上角，展开后底部再给一个「收起明细」", () => {
  const src = ORGANIZE_PANEL_SRC();
  const block = src.slice(src.indexOf("function ResultBlock"), src.indexOf("export function OrganizePanel"));
  assert.ok(block.length > 0, "应能切出 ResultBlock 源码");
  // 右上角 = 与标题同一行（flex 行 + 标题 flex:1 + 按钮 flex:none），且排在摘要正文**之前**。
  assert.match(block, /display: "flex", alignItems: "center", gap: 6/, "标题行应是 flex 行");
  assert.match(block, /flex: 1, minWidth: 0, fontWeight: 600/, "标题占满剩余宽度，把按钮挤到最右");
  assert.match(block, /flex: "none",\s+height: 22,/, "明细按钮不参与伸缩（贴右缘）");
  const buttonAt = block.indexOf("查看明细");
  const summaryAt = block.indexOf("{props.summary}");
  assert.ok(buttonAt >= 0 && summaryAt >= 0 && buttonAt < summaryAt, "明细按钮必须在摘要正文之前（即块的右上角，而不是正文末尾）");
  // 展开后：顶部按钮文案变「收起明细」，列表末尾再补一个「收起明细」（长列表不必滚回顶部）。
  const collapses = block.match(/收起明细/g) ?? [];
  assert.ok(collapses.length >= 3, `顶部切换 + 底部按钮都应存在（实际 ${collapses.length} 处）`);
  assert.match(block, /justifyContent: "flex-end"/, "底部「收起明细」右对齐");
});

test("区管家面板：简介更短，并写明会消耗 token + 每条大致花费", () => {
  const src = ORGANIZE_PANEL_SRC();
  const desc = src.slice(src.indexOf("这是什么"), src.indexOf("<Head>命令</Head>"));
  assert.match(desc, /消耗 token/, "简介必须说明要消耗 token");
  assert.match(desc, /1–2 分钱\/条/, "简介必须给出每条的大致花费（用户实测 1–2 分钱）");
  // 「简短一点」的可执行口径：最多 4 行，且删掉那段超长举例。
  const brs = (desc.match(/<br \/>/g) ?? []).length;
  assert.ok(brs <= 3, `简介最多 4 行（实际 ${brs + 1} 行）`);
  assert.doesNotMatch(desc, /例：meta分析：已检索完文献/, "旧的超长举例应已删除");
  // 同样打到构建产物上（中文可能是原文，也可能是 \uXXXX）。
  const bundle = readFileSync(join(projectRoot, "lib", "client.js"), "utf8");
  assert.ok(bundleHas(bundle, "消耗 token，约 1–2 分钱/条"), "产物里应有新的花费说明");
  assert.ok(!bundleHas(bundle, "例：meta分析"), "产物里不该再有旧的超长举例");
});

// ——— 左上角 logo 块的 MYAGENT 字样 ————————————————————————————————————————
// 落点是宿主 ui-sidebar 在 logo 行里声明的 `sidebar.brand.name`（single 子槽），官方
// ui-brand-official 用 priority 0 填的是 BrandWordmark 字标。本插件在同一槽上用 -100 顶掉它，
// 自己渲染「官方字标（缩到 17px 让位）+ 竖线 + MYAGENT」。鲸鱼所在的 `sidebar.brand.mark`
// 槽**完全不碰**。这一组锁三件事：顶槽优先级、SSR 真渲染出的内容、以及随增强层撤销。
const BUNDLE_SRC = () => readFileSync(join(projectRoot, "lib", "client.js"), "utf8");

/** 声明 brand.name 槽、先放官方条目（priority 0），再跑 apply()。 */
function setupBrandSlot() {
  const ledger = new SlotLedgerStub();
  ledger.declare("sidebar.brand.name", { kind: "single", scope: "root" });
  // 模拟 ui-brand-official：官方字标先用默认优先级（0）落账。
  ledger.register({ name: "sidebar.brand.name" }, () => null);
  const made = makeCtx(ledger);
  loadClientBundle().apply(made.ctx);
  return { ledger, ...made };
}

test("左上角 logo 块：在 sidebar.brand.name 上用 -100 顶掉官方字标条目", () => {
  const { ledger } = setupBrandSlot();
  const entries = ledger.records.get("sidebar.brand.name")!.entries;
  assert.equal(entries.length, 2, "官方条目 + 本插件条目");
  assert.equal(entries[0].options.priority, -100, "single 槽取最低优先级渲染，必须 -100 压掉官方的 0");
  assert.equal(typeof entries[0].component, "function");
  // 鲸鱼所在的 mark 槽必须一点没碰（碰了就会和官方重复画一个标记）。
  assert.equal(ledger.records.get("sidebar.brand.mark")?.entries.length ?? 0, 0, "不应注册 sidebar.brand.mark");
});

test("左上角 logo 块：渲染出 MYAGENT 字样，且官方字标仍在（缩到 16px 让位）", () => {
  const { ledger } = setupBrandSlot();
  const entry = ledger.records.get("sidebar.brand.name")!.entries[0];
  const html = renderToStaticMarkup(
    React.createElement(entry.component as React.ComponentType<Record<string, unknown>>, {}),
  );
  assert.match(html, /MYAGENT/, "字样必须真的渲染出来");
  assert.match(html, /data-fm-brand-myagent/, "应带可被量测的选择器（CDP 脚本靠它定位）");
  // 官方字标仍在：SSR 桩把 primitives 的任意具名导出渲染成 data-prim=名字 的 span。
  assert.match(html, /data-prim="BrandWordmark"/, "仍要画官方 DeepSeek 字标（不是拿掉，是让位）");
  assert.match(
    html,
    new RegExp(`size="${WORDMARK_SIZE}"`),
    `字标必须让位到 ${WORDMARK_SIZE}px —— 24px 时宽 156px，连最窄档的 170px 都放不下`,
  );
  // MYAGENT 必须在字标**之后**（左字标、右字样）。
  assert.ok(html.indexOf("BrandWordmark") < html.indexOf("MYAGENT"), "MYAGENT 字样应排在官方字标右边");
  // 宽度账：字标宽 = size × 156/24，侧栏默认 280px 时品牌键 216px（name 槽 186px）。
  assert.equal(WORDMARK_ASPECT, 6.5);
  const wordmarkWidth = WORDMARK_SIZE * WORDMARK_ASPECT;
  assert.equal(wordmarkWidth, 104);
  // 字标 + 两个 3px 间距 + 1px 竖线 + 实测 54px 的 MYAGENT 字样。
  assert.equal(LOCKUP_WIDTH, wordmarkWidth + 3 + 1 + 3 + 54);
  assert.ok(LOCKUP_WIDTH <= NAME_SLOT_BUDGET, `整条锁型 ${LOCKUP_WIDTH}px 必须落在默认档 ${NAME_SLOT_BUDGET}px 内`);
  assert.ok(NAME_SLOT_BUDGET < 216, "预算必须小于品牌键宽度（鲸鱼 24 + 槽间距 6 已被占掉）");
});

test("左上角 logo 块：宿主合法宽度区间内字样都放得下（拖到最窄也不许消失）", () => {
  // 宿主源码实证：dsh-client-ui-layout 对侧栏宽度做 clampWidth(px, 264, 420)（要么 56px 收起态，
  // 那时 logo 行整块不渲染）。品牌键（flex:1）= 侧栏宽 − 左右内边距 24 − (左内边距 4 + 折叠键 28 + gap 8)。
  assert.equal(HOST_SIDEBAR_MIN, 264);
  assert.equal(HOST_SIDEBAR_MAX, 420);
  assert.equal(brandWidthFor(264), 200, "最窄档的品牌键宽度（实测吻合）");
  assert.equal(brandWidthFor(280), 216, "默认档的品牌键宽度（实测吻合）");
  assert.equal(HOST_MIN_BRAND_WIDTH, 200);
  assert.equal(HOST_MAX_BRAND_WIDTH, 356);
  assert.equal(MIN_NAME_SLOT_BUDGET, 170, "最窄档的 name 槽可用宽度");
  assert.equal(NAME_SLOT_BUDGET, 186, "默认档的 name 槽可用宽度");
  // 用户 2026-09-13 报的回归：侧栏拖太窄 MYAGENT 就消失了 —— 锁型必须在**最窄档**也放得下。
  assert.ok(
    LOCKUP_WIDTH <= MIN_NAME_SLOT_BUDGET,
    `锁型 ${LOCKUP_WIDTH}px 必须 ≤ 最窄档可用 ${MIN_NAME_SLOT_BUDGET}px，否则拖到最窄字样就没了`,
  );
});

test("左上角 logo 块：兜底阈值——既不误伤最窄档，又不会让字样被裁成半个", () => {
  // 阈值 = 鲸鱼 + 槽间距 + 锁型 + 2px 余量。它只在"宿主把最窄档调小"时才触发。
  assert.equal(TAG_VISIBLE_MIN_BRAND_WIDTH, MARK_AND_GAP + LOCKUP_WIDTH + 2);
  assert.equal(TAG_VISIBLE_MIN_BRAND_WIDTH, 197);
  // ⚠️ 必须 ≤ 宿主最窄档的品牌键宽度（200）—— 否则用户拖到最窄时字样会消失（实测报过这个 bug）。
  assert.ok(
    TAG_VISIBLE_MIN_BRAND_WIDTH <= HOST_MIN_BRAND_WIDTH,
    `阈值 ${TAG_VISIBLE_MIN_BRAND_WIDTH} 必须 ≤ 宿主最窄档品牌键宽 ${HOST_MIN_BRAND_WIDTH}px`,
  );
  // 触发阈值时必须真的放不下（否则就是"明明放得下却收起"）。
  assert.ok(
    TAG_VISIBLE_MIN_BRAND_WIDTH - 2 >= MARK_AND_GAP + LOCKUP_WIDTH,
    "阈值不能低于锁型的真实占宽，否则最窄档会被裁",
  );
  // 判定必须量**品牌键按钮**（flex:1，宽度只由侧栏几何决定），不能量 shrink-to-fit 的 identity：
  // 后者宽度由内容决定 → 收起字样 → 它跟着变窄 → 永远判定"放不下" → 拖宽也不恢复（用户报的正是这个）。
  const src = readFileSync(join(projectRoot, "src", "client", "MyAgentBrand.tsx"), "utf8");
  assert.match(src, /ResizeObserver/, "拖分割线改变宽度必须能被观察到");
  assert.match(src, /root\?\.closest\("button"\)/, "必须量品牌键按钮本身（closest(\"button\")），不能按结构层级取父节点");
  assert.doesNotMatch(src, /parentElement\?\.parentElement/, "不许再用 parentElement 链定位品牌键（槽内容外面还套了一层 data-slot 包装）");
  assert.match(src, /brandButton\.clientWidth >= TAG_VISIBLE_MIN_BRAND_WIDTH/, "必须拿品牌键可用宽度与阈值比");
  // 竖线与字样收在**同一条**分支里：要么都在（够宽），要么都不在（宿主异常窄），不出现"只有竖线没字样"。
  assert.match(src, /roomy\s*\n?\s*\?\s*\[/, "竖线与字样应收在同一条条件分支里");
});

test("左上角 logo 块：切回标准模式即撤销，官方字标原样恢复", () => {
  const { ledger, disposers } = setupBrandSlot();
  assert.equal(ledger.records.get("sidebar.brand.name")!.entries.length, 2);
  // 模式切换走的就是这些 disposer（ctx.effect 与 slots.inject 两路）。
  assert.ok(disposers.length > 0, "品牌槽注册必须挂在可撤销的 inject 上");
  for (const dispose of disposers.splice(0)) dispose();
  const left = ledger.records.get("sidebar.brand.name")!.entries;
  assert.equal(left.length, 1, "本插件条目应被撤销，只剩官方字标");
  assert.equal(left[0].options.priority ?? 0, 0, "剩下的必须是官方条目（priority 0）");
});

test("左上角 logo 块：构建产物里真的有这段（防「改了源码没重建」）", () => {
  const bundle = BUNDLE_SRC();
  assert.ok(bundle.includes("MYAGENT"), "lib/client.js 里必须有 MYAGENT 字样");
  assert.ok(bundle.includes("fm-bn-tag"), "产物里应有字样的样式钩子");
  assert.ok(bundle.includes("sidebar.brand.name"), "产物里应注册 sidebar.brand.name 槽");
  assert.ok(!bundle.includes("sidebar.brand.mark"), "不应触碰鲸鱼所在的 mark 槽");
});


// test/session-meta.test.ts — 「总结标题 / 总结简介 / 区管家批量更新」的回归测试。
//
// 这两个按钮与区管家先后错过三次，这里逐条钉死：
//   ① 回落到"第一条用户消息"（常是 preset 注入的 `你是谁`）→ 两个按钮文本一样；
//   ② 改成读项目记忆 md 的最后一个 `##` 小节 → 同项目下**所有会话得到同一句话**，
//      而且 20 字硬切把括号切成半截（实测 `总结的数据源改为"最后一次记忆"（两个按`）；
//   ③ 标题没有固定格式、简介没有先于标题产出。
// 定案：主料 = 会话自身内容；**先出简介，再依据简介出标题**；
// 标题固定 `主题：进度`（如"meta分析：已检索完文献"）；
// 区管家只更新"有新对话"（marker 变了）的会话，并把管家上下文/token 用量一并回报。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  cleanLine,
  coerceTitle,
  collectDigest,
  localMetaFromConversation,
  normalizeTitle,
  resummarizeSession,
  summarizeSessionMeta,
  TITLE_PATTERN,
} from "../src/session-summary.ts";
import { resummarizeAllSessions, sessionMarker } from "../src/resummarize-all.ts";
import { organizerInfo } from "../src/organizer-agent.ts";

const MEMORY = `# 项目记忆

## 2026-09-01 初始化
初始化项目骨架。

## 2026-09-10 适配 dsh 0.1.5-rc 槽位契约
改写插件注册流程，把所有 slots.register 包进 slots.inject。
`;

let projects: Map<string, string>;

function makeProject(name: string, memory: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `myagent-${name}-`));
  if (memory !== null) fs.writeFileSync(path.join(dir, "Claude_memory.md"), memory, "utf8");
  projects.set(name, dir);
  return dir;
}

/** 造一个 ctx：`sessions.get(id)` 返回带 cwd 与会话消息的 live session。 */
function ctxFor(sessions: Record<string, { cwd: string | null; messages: Array<{ role: string; text: string }> }>) {
  return {
    sessions: {
      get: (id: string) => {
        const s = sessions[id];
        if (!s) return undefined;
        return {
          session: s.cwd ? { cwd: s.cwd } : {},
          deriveMessages: () =>
            s.messages.map((m) => ({ role: m.role, content: [{ type: "text", text: m.text }] })),
        };
      },
    },
  };
}

/** 带 stat 的 ctx（区管家的"有新对话"判定用它）。 */
function withStat(ctx: any, counts: Record<string, number>) {
  return {
    ...ctx,
    sessionPersistence: {
      stat: async (id: string) =>
        typeof counts[id] === "number" ? { eventCount: counts[id], revision: `r${counts[id]}` } : undefined,
    },
  };
}

/**
 * 假常驻管家：按顺序返回预设的助手正文，并把每次收到的提示词记下来。
 * 传数组 → 按调用次序取；传字符串 → 每次都回同一段。
 */
function fakeAgents(replies: string | string[]) {
  const queue = Array.isArray(replies) ? [...replies] : null;
  const prompts: string[] = [];
  let messages: any[] = [];
  const agent = {
    session: { deriveMessages: () => messages },
    followup(msg: any) {
      prompts.push(msg?.content?.[0]?.text ?? "");
      const reply = queue ? (queue.length > 1 ? queue.shift()! : queue[0]) : (replies as string);
      messages = [...messages, msg, { role: "assistant", content: [{ type: "text", text: reply }] }];
    },
    whenIdle: () => Promise.resolve(),
  };
  return { agents: { create: async () => ({ agent }) }, prompts };
}

/** 让 agentDefaultModel 解析得到 provider/model（否则管家不建、直接本地兜底）。 */
const withModel = { get: (name: string) => (name === "agentDefaultModel" ? { currentSelection: () => ({ provider: "p", model: "m" }) } : undefined) };

/**
 * 区管家的两个槽位（butler / planner）分别拿到什么 `agentOptions`。
 *
 * 为什么要这条测试：`reasoningEffort` 是 **Agent 级**的（dsh 的 `ModelSelection` 注释写明
 * "Agent-scoped"，不在单次请求上传），所以"只让分区建议思考"只能靠**两个 agent**实现 ——
 * 这是用户定案「分区策略也得是模型思考后的」在代码里的落点，一旦退化（比如有人图省事把两个
 * 槽位合并、或者把 reasoningEffort 硬编码进去）就会静默失效。
 * 这条测试**不需要 API key、也不发真实模型请求**，直接断言建 agent 时传了什么。
 */
function recordingCtx(reasoningEffort?: string) {
  const created: Array<{ sessionId: string; agentOptions: Record<string, unknown> }> = [];
  const ctx = {
    get(name: string) {
      if (name === "agentDefaultModel") {
        return {
          currentSelection: () => ({ provider: "p", model: "m", ...(reasoningEffort ? { reasoningEffort } : {}) }),
        };
      }
      if (name === "agents") {
        return {
          create: async (opts: any) => {
            created.push({ sessionId: opts.sessionId, agentOptions: opts.agentOptions });
            // 每个会话一个独立 agent（两个槽位不能共用消息流，否则 before 快照互相污染）。
            let messages: any[] = [];
            return {
              agent: {
                session: { deriveMessages: () => messages },
                followup(msg: any) {
                  messages = [...messages, msg, { role: "assistant", content: [{ type: "text", text: '{"actions":[]}' }] }];
                },
                whenIdle: () => Promise.resolve(),
              },
            };
          },
        };
      }
      return undefined;
    },
  };
  return { ctx, created };
}

test("区管家：planner 固定 low，butler 不拿推理档（分区要思考、命名要快）", async () => {
  const { requestOrganizerPlan, requestConversationBrief, disposeOrganizerAgent } = await import(
    "../src/organizer-agent.ts"
  );
  await disposeOrganizerAgent();
  // 部署支持 thinking（默认选择里带档位）；planner 应**无视**这个档位、固定用 low。
  const { ctx, created } = recordingCtx("max");

  // planner：分区建议
  await requestOrganizerPlan(ctx, { workspaces: [] } as any);
  // butler：一句话简介
  await requestConversationBrief(ctx, { projectName: "proj", transcript: "用户：做点事" });

  const planner = created.find((c) => c.sessionId === "dsh-myagent-sandbox-organizer-plan");
  const butler = created.find((c) => c.sessionId === "dsh-myagent-sandbox-organizer");
  assert.ok(planner, "应建出分区建议专用 agent（独立会话 id）");
  assert.ok(butler, "应建出命名用的管家 agent");
  assert.equal(planner.agentOptions.reasoningEffort, "low", "planner 必须固定 low，而不是跟随用户默认档");
  assert.ok(!("reasoningEffort" in butler.agentOptions), "butler 不能带推理档（命名是高频小活，要快）");
  assert.equal(planner.agentOptions.model, "m");
  assert.equal(butler.agentOptions.model, "m");
});

test("区管家：部署没开 thinking 时不能硬编码 —— planner 也不传 reasoningEffort", async () => {
  const { requestOrganizerPlan, disposeOrganizerAgent } = await import("../src/organizer-agent.ts");
  await disposeOrganizerAgent();
  // 默认选择里没有档位 = 该部署 thinking 被关掉。
  const { ctx, created } = recordingCtx(undefined);

  await requestOrganizerPlan(ctx, { workspaces: [] } as any);

  const planner = created.find((c) => c.sessionId === "dsh-myagent-sandbox-organizer-plan");
  assert.ok(planner, "planner 仍应建出来");
  // DeepSeek 适配器对 thinking 关闭的部署会拒绝**任何** effort（UNSUPPORTED_REASONING_EFFORT），
  // 所以固定 low 也只能在支持 thinking 时才传，否则分区建议会直接不可用。
  assert.ok(!("reasoningEffort" in planner.agentOptions), "部署不支持 thinking 时必须省略该字段");
});

test.before(() => {
  projects = new Map();
});

test.after(() => {
  for (const dir of projects.values()) fs.rmSync(dir, { recursive: true, force: true });
});

// —— 文本与格式 ——

test("cleanLine 不在半个括号/引号里硬切", () => {
  const out = cleanLine('总结的数据源改为"最后一次记忆"（两个按钮不再雷同）', 20);
  assert.ok(!out.includes("（两个按"), `不能切在半个括号里：${out}`);
  assert.ok(out.startsWith('总结的数据源改为"最后一次记忆"'), out);
});

test("cleanLine 去掉代码块、链接与 URL", () => {
  const out = cleanLine("看 https://example.com/a?b=1 和 `npm run build` 以及 [文档](http://x.y)", 80);
  assert.ok(!out.includes("example.com"));
  assert.ok(out.includes("npm run build"));
  assert.ok(out.includes("文档"));
});

test("normalizeTitle 统一成全角冒号并限长", () => {
  assert.equal(normalizeTitle("meta分析: 已检索完文献"), "meta分析：已检索完文献");
  assert.equal(normalizeTitle("  插件适配 ： 修槽位报错 "), "插件适配：修槽位报错");
  assert.ok(TITLE_PATTERN.test(normalizeTitle("meta分析：已检索完文献")));
});

test("coerceTitle 把任意标题修成「主题：进度」", () => {
  assert.equal(coerceTitle("插件槽位适配", "适配新版槽位声明并整合官方预览区"), "插件槽位适配：进行中");
  assert.equal(coerceTitle("meta分析：已检索完文献", "检索"), "meta分析：已检索完文献");
  // 截断就保留 `…`（不装成完整句子），并去掉尾部悬挂的助词。
  assert.equal(coerceTitle("", "修复图片预览的拖动与缩放交互"), "修复图片预览的拖动与缩放…：进行中");
});

test("localMetaFromConversation：标题为「主题：进度」，简介写「从…到…」", () => {
  const meta = localMetaFromConversation({
    firstUser: "帮我给这个插件补上取消官方文件树的逻辑",
    lastUser: "现在两个按钮的结果一样，改成读会话自己的内容",
  });
  assert.ok(TITLE_PATTERN.test(meta.title), `标题应为 主题：进度：${meta.title}`);
  assert.ok(meta.title.includes("进行中"));
  assert.ok(meta.brief.startsWith("从「"));
  assert.notEqual(meta.title, meta.brief);
});

// —— 会话内容 → 摘要 ——

test("collectDigest：首末发言取实质消息，跳过 preset 注入的「你是谁」", async () => {
  const dir = makeProject("digest", MEMORY);
  const ctx = ctxFor({
    s1: {
      cwd: dir,
      messages: [
        { role: "user", text: "你是谁" },
        { role: "user", text: "给文件树加彩色图标" },
        { role: "assistant", text: "好的，我用 FileTypeIcon 接宿主 primitives。" },
        { role: "user", text: "再让区标签点击时把文件树切过去" },
      ],
    },
  });
  const digest = await collectDigest(ctx, "s1");
  assert.equal(digest.firstUser, "给文件树加彩色图标");
  assert.equal(digest.lastUser, "再让区标签点击时把文件树切过去");
  assert.equal(digest.hasUserText, true);
  assert.ok(digest.transcript.includes("助手："));
  assert.ok(!digest.transcript.includes("你是谁"));
  assert.equal(path.basename(dir), digest.projectName);
  // 记忆文件不再进提示词（实测会让模型把项目记忆的小节标题当成对话标题）。
  assert.equal("memory" in digest, false);
});

test("summarizeSessionMeta：以会话自身内容为准，标题为「主题：进度」，不返回记忆小节标题", async () => {
  const dir = makeProject("convo", MEMORY);
  const ctx = ctxFor({
    s1: {
      cwd: dir,
      messages: [
        { role: "user", text: "给文件树加彩色图标" },
        { role: "user", text: "再让区标签点击时把文件树切过去" },
      ],
    },
  });
  const meta = await summarizeSessionMeta(ctx, "s1", { useModel: true });
  assert.equal(meta.source, "local");
  assert.ok(TITLE_PATTERN.test(meta.title), meta.title);
  assert.ok(!meta.title.includes("槽位契约"), "不能退回项目记忆小节标题");
  assert.notEqual(meta.title, meta.brief);
});

test("两个按钮各取各的字段（title / brief 模式结果不同）", async () => {
  const dir = makeProject("buttons", MEMORY);
  const ctx = ctxFor({
    s2: {
      cwd: dir,
      messages: [
        { role: "user", text: "拖动分割线时图片要一直顶满宽度" },
        { role: "user", text: "分组标题行左边加一个新对话按钮" },
      ],
    },
  });
  const t = await resummarizeSession(ctx, "s2", "title");
  const b = await resummarizeSession(ctx, "s2", "brief");
  const both = await resummarizeSession(ctx, "s2", "both");
  assert.ok(t.title && !t.brief);
  assert.ok(b.brief && !b.title);
  assert.notEqual(t.title, b.brief);
  assert.equal(both.title, t.title);
  assert.equal(both.brief, b.brief);
});

test("单会话按钮走**两步**：先请求简介，再带着那句简介请求标题；只点简介时不多发一次", async () => {
  const { disposeOrganizerAgent } = await import("../src/organizer-agent.ts");
  const dir = makeProject("twostep", MEMORY);
  const fake = fakeAgents(["把左栏圆角对齐官方 token", "圆角对齐：已完成"]);
  const ctx = {
    ...fake,
    ...ctxFor({ s9: { cwd: dir, messages: [{ role: "user", text: "把左栏圆角对齐官方" }] } }),
    ...withModel,
  };
  try {
    const r = await resummarizeSession(ctx, "s9", "title");
    assert.equal(r.title, "圆角对齐：已完成");
    assert.ok(!r.brief, "title 模式不该回 brief");
    assert.equal(fake.prompts.length, 2, "两步版必须发两次请求");
    assert.ok(fake.prompts[0].startsWith("写简介"), `第一次应是简介，实际：${fake.prompts[0].slice(0, 20)}`);
    assert.ok(fake.prompts[1].startsWith("写标题"), `第二次应是标题，实际：${fake.prompts[1].slice(0, 20)}`);
    assert.ok(
      fake.prompts[1].includes("把左栏圆角对齐官方 token"),
      "标题请求必须带上**刚产出的那句简介**（这正是两步版的意义：标题基于已落定的简介再写）",
    );

    // 只点「重新总结简介」时不该为一个马上被丢弃的标题白花一次调用。
    fake.prompts.length = 0;
    const b = await resummarizeSession(ctx, "s9", "brief");
    assert.ok(b.brief, "brief 模式应回 brief");
    assert.ok(!b.title, "brief 模式不该回 title");
    assert.equal(fake.prompts.length, 1, "brief 模式只发一次请求");
    assert.ok(fake.prompts[0].startsWith("写简介"));
  } finally {
    await disposeOrganizerAgent();
  }
});

test("分区建议：首次发全量，之后只发「索引 + 变化」；没变的明细不再重发", async () => {
  const { requestOrganizerPlan, disposeOrganizerAgent } = await import("../src/organizer-agent.ts");
  await disposeOrganizerAgent();
  const fake = fakeAgents('{"actions":[]}');
  const ctx = { ...fake, ...withModel };

  const snap = (s1Title: string) => ({
    workspaces: [
      {
        id: "ws1",
        title: "dsh-myagent",
        brief: "",
        defaultGroupName: "默认分组",
        groups: [
          { id: "default", name: "默认分组", brief: "", sessionIds: ["s1"] },
          { id: "g1", name: "MYAGENT", brief: "", sessionIds: ["s2"] },
        ],
        sessions: [
          { id: "s1", title: s1Title, brief: "会话一的简介正文" },
          { id: "s2", title: "改分区建议", brief: "会话二的简介正文" },
        ],
      },
    ],
  });

  try {
    // ① 首次：上下文还是空的 → 必须发全量。
    await requestOrganizerPlan(ctx, snap("圆角对齐") as any);
    assert.match(fake.prompts[0], /首次，完整/, "首次必须发全量快照");
    assert.match(fake.prompts[0], /会话一的简介正文/, "全量里应包含明细");

    // ② 没有任何变化：只发索引 + 「没有任何变化」，**不再重发明细**。
    await requestOrganizerPlan(ctx, snap("圆角对齐") as any);
    const p2 = fake.prompts[1];
    assert.match(p2, /当前索引（真值）/, "第二次应发紧凑索引");
    assert.match(p2, /没有任何变化/);
    assert.doesNotMatch(p2, /首次，完整/, "第二次不该再发全量");
    assert.doesNotMatch(p2, /会话一的简介正文/, "未变化会话的明细不应重发（这就是省 token 的地方）");

    // ③ 有一条变了：只把变的那条作为明细发出去。
    await requestOrganizerPlan(ctx, snap("圆角对齐：已完成") as any);
    const p3 = fake.prompts[2];
    assert.match(p3, /~ 会话 s1 标题「圆角对齐：已完成」/, "应给出变化明细");
    assert.match(p3, /未列出的实体与你记忆中一致/, "必须声明未列出的一律没变，模型不得改动");
    assert.doesNotMatch(p3, /会话二的简介正文/, "没变的会话明细仍不重发");
  } finally {
    await disposeOrganizerAgent();
  }
});

test("分区建议：上一次失败后必须整份重发（不能拿残缺底稿去分组）", async () => {
  const { requestOrganizerPlan, disposeOrganizerAgent } = await import("../src/organizer-agent.ts");
  await disposeOrganizerAgent();

  const prompts: string[] = [];
  let messages: any[] = [];
  let replyMode: "ok" | "silent" = "ok";
  const agent = {
    session: { deriveMessages: () => messages },
    followup(msg: any) {
      prompts.push(msg?.content?.[0]?.text ?? "");
      messages =
        replyMode === "ok"
          ? [...messages, msg, { role: "assistant", content: [{ type: "text", text: '{"actions":[]}' }] }]
          : [...messages, msg]; // 静默：不产出助手正文 → askSlot 抛错
    },
    whenIdle: () => Promise.resolve(),
  };
  const ctx = {
    get: (name: string) =>
      name === "agentDefaultModel"
        ? { currentSelection: () => ({ provider: "p", model: "m" }) }
        : name === "agents"
          ? { create: async () => ({ agent }) }
          : undefined,
  };
  const snap = (title: string) => ({
    workspaces: [
      {
        id: "ws1",
        title: "ws",
        brief: "",
        defaultGroupName: "默认分组",
        groups: [{ id: "default", name: "默认分组", brief: "", sessionIds: ["s1"] }],
        sessions: [{ id: "s1", title, brief: "简介" }],
      },
    ],
  });

  try {
    await requestOrganizerPlan(ctx, snap("A") as any);
    assert.match(prompts[0], /首次，完整/, "第一次全量");

    replyMode = "silent";
    await assert.rejects(() => requestOrganizerPlan(ctx, snap("B") as any), /returned no/, "静默时应如实报错");

    replyMode = "ok";
    await requestOrganizerPlan(ctx, snap("B") as any);
    assert.match(
      prompts[2],
      /首次，完整/,
      "上次失败后无法确认模型记住了什么 → 必须整份重发，而不是发增量",
    );
  } finally {
    await disposeOrganizerAgent();
  }
});

test("同一项目下的两个会话得到**不同**的标题（记忆源做不到这点）", async () => {
  const dir = makeProject("two", MEMORY);
  const ctx = ctxFor({
    a: { cwd: dir, messages: [{ role: "user", text: "修图片预览的拖动缩放" }] },
    b: { cwd: dir, messages: [{ role: "user", text: "给分组加新对话按钮" }] },
  });
  const metaA = await summarizeSessionMeta(ctx, "a", { useModel: false });
  const metaB = await summarizeSessionMeta(ctx, "b", { useModel: false });
  assert.notEqual(metaA.title, metaB.title);
  assert.ok(metaA.title.includes("图片"));
  assert.ok(metaB.title.includes("新对话") || metaB.title.includes("分组"));
});

test("空会话（只有 preset 的「你是谁」）**被跳过**，不拿项目记忆标题顶替", async () => {
  const dir = makeProject("empty", MEMORY);
  const ctx = ctxFor({ s3: { cwd: dir, messages: [{ role: "user", text: "你是谁" }] } });
  await assert.rejects(
    () => summarizeSessionMeta(ctx, "s3", { useModel: true }),
    /no summarizable content/,
    "空会话不该被改名成项目记忆的小节标题",
  );
});

test("批量里空会话标 skipped，有内容的照常更新", async () => {
  const dir = makeProject("mixed", MEMORY);
  const ctx = withStat(
    ctxFor({
      empty: { cwd: dir, messages: [{ role: "user", text: "你是谁" }] },
      real: { cwd: dir, messages: [{ role: "user", text: "把总结改成主题加进度" }] },
    }),
    { empty: 2, real: 5 },
  );
  const res = await resummarizeAllSessions(ctx, [{ id: "empty" }, { id: "real" }], undefined, { budgetMs: 0 });
  assert.equal(res.updates.find((u) => u.sessionId === "empty")!.skipped, true);
  const real = res.updates.find((u) => u.sessionId === "real")!;
  assert.equal(real.skipped, undefined);
  assert.ok(TITLE_PATTERN.test(real.title ?? ""), real.title);
  assert.equal(res.summary.skipped, 1);
  assert.equal(res.summary.updated, 1);
});

test("既没有会话内容也没有记忆文件时**报错**（不拿会话 id 当标题）", async () => {
  const dir = makeProject("nothing", null);
  const ctx = ctxFor({ s4: { cwd: dir, messages: [] } });
  await assert.rejects(() => summarizeSessionMeta(ctx, "s4", { useModel: true }), /no summarizable content/);
});

// —— 模型路径：一次请求里"先简介、后标题" ——

test("模型路径只发一次请求；规则绑在系统提示词里，调用时只发固定短命令", async () => {
  const { disposeOrganizerAgent } = await import("../src/organizer-agent.ts");
  const dir = makeProject("onestep-order", MEMORY);
  const fake = fakeAgents(['{"brief":"把插件适配到新版槽位声明并跑通注册","title":"插件适配：改完槽位声明"}']);
  // 捕获 setup() 拿到的系统提示词：规则现在**绑死**在这里（只设一次），
  // 而不是每次调用随提示词重发（那部分占旧提示词的 60–76%，批量时还会重发 N 次）。
  let systemText = "";
  const origCreate = (fake.agents as { create: (opts: any) => Promise<unknown> }).create;
  const agents = {
    create: async (opts: any) => {
      opts.setup?.({
        systemPrompt: {
          section: (s: { text: string }) => {
            systemText = s.text;
          },
          suppressRuntimeContext: () => {},
        },
        tools: { restrict: () => {} },
      });
      return origCreate(opts);
    },
  };
  const ctx = {
    ...fake,
    agents,
    ...ctxFor({ s5: { cwd: dir, messages: [{ role: "user", text: "适配新版插槽" }] } }),
    ...withModel,
  };
  try {
    const meta = await summarizeSessionMeta(ctx, "s5", { useModel: true });
    assert.equal(meta.source, "agent");
    assert.equal(meta.brief, "把插件适配到新版槽位声明并跑通注册");
    assert.equal(meta.title, "插件适配：改完槽位声明");
    assert.equal(fake.prompts.length, 1, "只应发一次请求（两次会把延迟与失败面翻倍）");

    // ① 调用时只发固定短命令 + 数据，规则不再重发。
    const p = fake.prompts[0];
    assert.ok(p.startsWith("写简介和标题"), `应只发固定短命令，实际开头：${p.slice(0, 30)}`);
    assert.doesNotMatch(p, /主题：进度/, "格式规则不应再随每次调用重发（已绑进系统提示词）");

    // ② 规则确实绑在系统提示词里，且顺序要求仍在。
    assert.match(systemText, /主题：进度/, "系统提示词必须给出 主题：进度 的格式与示例");
    assert.ok(
      systemText.indexOf('"brief"') !== -1 && systemText.indexOf('"brief"') < systemText.indexOf('"title"'),
      "系统提示词里 brief 必须排在 title 之前（字段顺序就是产出顺序）",
    );
    assert.match(systemText, /依据简介/, "标题必须声明为依据简介产出");
  } finally {
    await disposeOrganizerAgent();
  }
});

test("模型给的标题不合格式时被校正成「主题：进度」", async () => {
  const { disposeOrganizerAgent } = await import("../src/organizer-agent.ts");
  const dir = makeProject("badformat", MEMORY);
  const ctx = {
    // 标题没有冒号 → 应被本地校正成 `主题：进行中`。
    ...fakeAgents(['{"brief":"完成文献检索并整理成表","title":"文献整理"}']),
    ...ctxFor({ s6: { cwd: dir, messages: [{ role: "user", text: "整理文献" }] } }),
    ...withModel,
  };
  try {
    const meta = await summarizeSessionMeta(ctx, "s6", { useModel: true });
    assert.ok(TITLE_PATTERN.test(meta.title), `应被校正为 主题：进度：${meta.title}`);
    assert.equal(meta.title, "文献整理：进行中");
  } finally {
    await disposeOrganizerAgent();
  }
});

test("一步路径（批量）：一次请求同时产出简介与标题", async () => {
  const { disposeOrganizerAgent } = await import("../src/organizer-agent.ts");
  const dir = makeProject("onestep", MEMORY);
  const fake = fakeAgents(['{"brief":"适配新版槽位声明并整合预览区","title":"插件适配：槽位改完"}']);
  const ctx = {
    ...fake,
    ...ctxFor({ s7: { cwd: dir, messages: [{ role: "user", text: "适配插槽" }] } }),
    ...withModel,
  };
  try {
    const meta = await summarizeSessionMeta(ctx, "s7", { useModel: true, });
    assert.equal(meta.source, "agent");
    assert.equal(meta.title, "插件适配：槽位改完");
    assert.equal(fake.prompts.length, 1, "一步路径只发一次请求");
  } finally {
    await disposeOrganizerAgent();
  }
});

test("拿不到默认模型时不建 agent，直接走会话本地兜底", async () => {
  const { disposeOrganizerAgent } = await import("../src/organizer-agent.ts");
  const dir = makeProject("nomodel", MEMORY);
  const ctx = {
    ...fakeAgents("不该被用到"),
    ...ctxFor({ s8: { cwd: dir, messages: [{ role: "user", text: "给文件树加彩色图标" }] } }),
    get: () => undefined,
  };
  try {
    const meta = await summarizeSessionMeta(ctx, "s8", { useModel: true });
    assert.equal(meta.source, "local");
    assert.ok(meta.title.includes("图标"));
  } finally {
    await disposeOrganizerAgent();
  }
});

// —— 区管家批量 ——

test("resummarizeAllSessions：只更新 marker 变了的会话，未变的原样返回 unchanged", async () => {
  const { disposeOrganizerAgent } = await import("../src/organizer-agent.ts");
  const dir = makeProject("all", MEMORY);
  const base = ctxFor({
    a: { cwd: dir, messages: [{ role: "user", text: "修图片预览" }] },
    b: { cwd: dir, messages: [{ role: "user", text: "加分组按钮" }] },
  });
  const ctx = { ...fakeAgents(['{"brief":"修图片预览的交互","title":"图片预览：修交互"}']), ...withStat(base, { a: 10, b: 7 }), ...withModel };
  try {
    // b 的 marker 与上次一致（ev:7）→ 跳过；a 变了（上次 ev:9，现在 ev:10）→ 重新总结。
    const res = await resummarizeAllSessions(
      ctx,
      [
        { id: "a", marker: "ev:9" },
        { id: "b", marker: "ev:7" },
        { id: "gone" },
      ],
      undefined,
      { budgetMs: 45000 },
    );
    const a = res.updates.find((u) => u.sessionId === "a")!;
    const b = res.updates.find((u) => u.sessionId === "b")!;
    const gone = res.updates.find((u) => u.sessionId === "gone")!;
    assert.equal(a.source, "agent");
    assert.equal(a.marker, "ev:10", "要把新 marker 回报给客户端存起来");
    assert.equal(b.unchanged, true);
    assert.equal(b.title, undefined, "没新对话就不该改标题");
    assert.equal(gone.skipped, true);
    assert.deepEqual(
      { checked: res.summary.checked, updated: res.summary.updated, unchanged: res.summary.unchanged, skipped: res.summary.skipped },
      { checked: 3, updated: 1, unchanged: 1, skipped: 1 },
    );
    assert.equal(res.summary.agent, 1);
  } finally {
    await disposeOrganizerAgent();
  }
});

test("未变的会话**不发模型请求**（省时省 token）", async () => {
  const { disposeOrganizerAgent } = await import("../src/organizer-agent.ts");
  const dir = makeProject("unchanged", MEMORY);
  const fake = fakeAgents(['{"brief":"x","title":"y：z"}']);
  const ctx = { ...fake, ...withStat(ctxFor({ a: { cwd: dir, messages: [{ role: "user", text: "随便" }] } }), { a: 3 }), ...withModel };
  try {
    const res = await resummarizeAllSessions(ctx, [{ id: "a", marker: "ev:3" }], undefined, { budgetMs: 45000 });
    assert.equal(res.summary.unchanged, 1);
    assert.equal(fake.prompts.length, 0, "marker 未变时不应有任何模型往返");
  } finally {
    await disposeOrganizerAgent();
  }
});

test("批量预算用完后退化为本地（不再逐条等模型）", async () => {
  const dir = makeProject("budget", MEMORY);
  const ctx = withStat(
    ctxFor({
      a: { cwd: dir, messages: [{ role: "user", text: "修图片预览" }] },
      b: { cwd: dir, messages: [{ role: "user", text: "加分组按钮" }] },
    }),
    { a: 1, b: 1 },
  );
  const res = await resummarizeAllSessions(ctx, [{ id: "a" }, { id: "b" }], undefined, { budgetMs: 0 });
  assert.ok(res.updates.every((u) => u.source === "local"));
  assert.equal(res.summary.local, 2);
});

test("sessionMarker：优先事件数，退化到字节数，拿不到时返回 null", async () => {
  assert.equal(await sessionMarker({ sessionPersistence: { stat: async () => ({ eventCount: 42, sizeBytes: 9 }) } }, "x"), "ev:42");
  assert.equal(await sessionMarker({ sessionPersistence: { stat: async () => ({ sizeBytes: 9 }) } }, "x"), "sz:9");
  assert.equal(await sessionMarker({ sessionPersistence: { stat: async () => undefined } }, "x"), null);
  assert.equal(await sessionMarker({}, "x"), null);
});

test("organizerInfo：无 agent 时也是完整可序列化的统计形状", () => {
  const info = organizerInfo();
  for (const key of ["ready", "provider", "model", "sessionId", "requests", "contextTokens", "totalInputTokens", "totalOutputTokens", "totalCacheReadTokens", "rotations", "contextBudgetTokens"]) {
    assert.ok(key in info, `缺少统计字段 ${key}`);
  }
  assert.ok(info.contextBudgetTokens > 0);
});

test("提示词里**不含**项目记忆内容（防止模型拿记忆小节当对话标题）", async () => {
  const { disposeOrganizerAgent } = await import("../src/organizer-agent.ts");
  const dir = makeProject("nomemory", MEMORY);
  const fake = fakeAgents([JSON.stringify({ brief: "把总结改成主题加进度", title: "总结改造：已定位两处缺陷" })]);
  const ctx = {
    ...fake,
    ...ctxFor({ s9: { cwd: dir, messages: [{ role: "user", text: "把总结改成主题加进度" }] } }),
    ...withModel,
  };
  try {
    const meta = await summarizeSessionMeta(ctx, "s9", { useModel: true });
    assert.equal(meta.source, "agent");
    assert.ok(fake.prompts.length >= 1);
    for (const p of fake.prompts) {
      assert.ok(!p.includes("slots.inject"), "提示词不该包含记忆文件正文");
      assert.ok(!p.includes("项目最近记忆"), "提示词不该包含记忆小节");
    }
  } finally {
    await disposeOrganizerAgent();
  }
});

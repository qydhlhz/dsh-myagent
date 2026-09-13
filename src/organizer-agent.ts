// src/organizer-agent.ts — 宿主半区的“工作沙盒整理员”常驻子 agent。
// 优先使用 dsh 的 AgentRegistry（ctx.agents）创建一个干净、无工具的常驻会话 agent；
// 若宿主未提供 agents 服务，则调用方降级到本地确定性整理器（client/organizer.ts）。
import {
  normalizeOrganizePlan,
  type OrganizePlan,
  type OrganizerSnapshot,
  type OrganizerWorkspace,
} from "./client/organizer.ts";

/**
 * 管家会话的上下文预算。
 *
 * 【历史】原为 `40_000`：超预算就换一个新会话 id（轮换）。理由见下 —— 每次请求的提示词
 * 都是**自包含**的（会话内容/快照全在提示词里），历史消息对结果毫无贡献却会被整段重发；
 * 实测涨到 `inputTokens + cacheReadTokens ≈ 19.4 万` 时，单次耗时从 1.7s 涨到 4s+。
 * 同一个 id 无法清空（会话已存在 → create 撞 SessionAlreadyExists → 只能 resume 回放全部历史），
 * 所以轮换只能靠"换一个新会话 id"，旧会话文件留在 sessions 目录里（不在任何工作区
 * 的 sessionIds 中，GUI 列表看不到）。
 *
 * 【2026 用户定案：改成 1M】管家要当"记得住上下文、能持续思考分区策略"的常驻角色，
 * 40k 会让它每隔几次就失忆一次。代价是**明确知道并且接受**的：阈值抬到 1M 之后同一个
 * 会话会长期累积、历史每次全量重发，请求会越来越慢越来越贵 —— 这是用成本换"管家有连续
 * 记忆"的有意取舍，不是疏漏。
 */
const ORGANIZER_CONTEXT_BUDGET_TOKENS = 1_000_000;

/** 管家自身的运行统计（区管家的「上下文已用 / token 消耗 / 常规信息」面板用它）。 */
interface OrganizerStats {
  ready: boolean;
  provider: string;
  model: string;
  sessionId: string;
  /** 本轮（本会话）已发出的请求数。 */
  requests: number;
  /** 最近一次请求的提示词规模 = inputTokens + cacheReadTokens。 */
  contextTokens: number;
  /** 累计 token：所有请求的 input + cacheRead + output 之和。 */
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalReasoningTokens: number;
  /** 最近一次请求结束的时刻（ISO）。 */
  lastRequestAt: string | null;
  /** 累计轮换次数（上下文超预算换过几次会话）。 */
  rotations: number;
  contextBudgetTokens: number;
}

/**
 * 一个常驻管家 agent 槽位。
 *
 * 【为什么需要两个槽位】`reasoningEffort` 是 **Agent 级**的 —— dsh 的 `ModelSelection`
 * 注释写明 "Agent-scoped model selection"，它不在单次请求上传，所以"只让分区建议思考"
 * 只能靠**两个 agent** 实现：
 *   - `butler` ：不传 reasoningEffort —— 命名/简介是高频小活，要快；
 *   - `planner`：固定 `low` —— 分区策略要模型真的想过（用户定案，不用默认档）。
 * 两者各自持有会话 id / 上下文计数 / 统计，互不影响。
 */
interface AgentSlot {
  /** 诊断用名字。 */
  key: string;
  /** 会话 id 基名；轮换时追加时间戳后缀。 */
  base: string;
  /**
   * 这个槽位的**固定推理档**（用户定案：分区建议固定 `low`）。
   * undefined = 不传，跟随模型默认。
   * 注意：只在**该部署支持 thinking** 时才真的传 —— 见 ensureSlot 里的说明。
   */
  fixedReasoningEffort?: string;
  /** 实际生效的推理档（ensure 时解析并记录，供诊断/面板）。 */
  reasoningEffort?: string;
  handle: any;
  agent: any;
  ready: Promise<void> | null;
  sessionId: string;
  /** 最近一次请求的提示词规模，用于判断是否轮换。 */
  contextTokens: number;
  /**
   * 上一次**成功**发给这个会话的完整快照（planner 用它算下一次的增量）。
   *
   * 用户定案："全部存在于同一个上下文内，很多东西每次轮转的时候就不用再读了，
   * 只需要核对一不一样"。所以首次发全量、之后只发「当前索引 + 变化」。
   *
   * 任何"上下文可能对不上"的情况都清空它 → 下次整份重发：
   *   - agent 刚建出来 / 被轮换（上下文是空的）
   *   - 上一次调用失败（模型没答，无法确认它到底记住了什么）
   * **宁可多发一份全量，也不发一份可能对不上的增量** —— 增量对不上会拿残缺底稿去分组。
   */
  lastPlanSnapshot?: OrganizerSnapshot;
  stats: OrganizerStats;
}

function makeSlot(key: string, base: string, fixedReasoningEffort?: string): AgentSlot {
  return {
    key,
    base,
    fixedReasoningEffort,
    handle: null,
    agent: null,
    ready: null,
    sessionId: base,
    contextTokens: 0,
    stats: {
      ready: false,
      provider: "",
      model: "",
      sessionId: base,
      requests: 0,
      contextTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalReasoningTokens: 0,
      lastRequestAt: null,
      rotations: 0,
      contextBudgetTokens: ORGANIZER_CONTEXT_BUDGET_TOKENS,
    },
  };
}

/** 命名/简介用（不传推理档，要快）。 */
const butlerSlot = makeSlot("butler", "dsh-myagent-sandbox-organizer");
/** 分区建议专用（固定 `low`）。 */
const plannerSlot = makeSlot("planner", "dsh-myagent-sandbox-organizer-plan", "low");

/**
 * 系统提示词 = **绑死的规则**（用户定案："把这个流程直接绑死设定好，而不是真的每次发送
 * 自然语言说明给它"）。
 *
 * 为什么必须搬到这里：实测每次调用的提示词里「固定规则」占 60–76%（`plan` 2214 B /
 * `meta` 775 B / `brief` 384 B），而批量跑 N 条会话时规则会被**重发 N 次**。搬进系统提示词后
 * 只在建会话时发一次，之后每次命中 prompt cache（`cacheReadTokens` 计费远低于新增输入）——
 * 单条命名从 613 B 降到 229 B（省 63%）。
 *
 * 调用方（`requestConversationBrief` / `requestTitleFromBrief` / `requestConversationMeta` /
 * `requestOrganizerPlan`）因此只发**固定短命令 + 数据**，不再复述规则。
 */
const BUTLER_SYSTEM_PROMPT =
  "你是区管家里负责「三级命名」的角色：给一个对话写一句话简介，并给它起标题。" +
  "你不读文件、不调用工具、不寒暄、不解释，只输出被要求的内容。\n" +
  "输出形态由命令指定，严格只输出对应内容：\n" +
  "· 「写简介」→ 只输出那一句话简介，不要 JSON、不要引号。\n" +
  "· 「写标题」→ 只输出标题本身。\n" +
  '· 「写简介和标题」→ 只输出 JSON：{"brief":"...","title":"..."}，brief 必须写在 title 之前。\n' +
  "固定规则（不可更改）：\n" +
  "· 简介：一句话说明**这个对话在做什么工作**。动宾结构，说清对象与当前进展，25～40 字。\n" +
  "  不要用引号、不要用“关于”开头、不要写项目名、不要写成项目层面的进展综述。\n" +
  "· 标题：依据简介起。固定格式 **主题：进度**，中文全角“：”只出现一次。\n" +
  "  例：meta分析：已检索完文献 / 插件适配：修槽位报错 / 论文写作：改讨论部分\n" +
  "  主题 2～10 字，进度 2～12 字，总长不超过 20 字。不要照抄简介整句，不要写项目名。\n" +
  "· 内容一律以用户给的对话内容为准。项目记忆、项目层面的历史都不是这个对话的事，" +
  "不要拿它们当标题 —— 那样同一项目下所有对话会得到同一个名字。";

const PLANNER_SYSTEM_PROMPT =
  "你是区管家里负责「二级分组」的角色：按下面的固定规则输出一份整理建议 JSON。" +
  "你不读文件、不调用工具、不解释，只输出 JSON。\n" +
  "固定规则（不可更改）：\n" +
  '- JSON 结构：{"actions":[...]}\n' +
  "- action 的 kind 只能是：createGroup、renameGroup、deleteGroup、mergeGroup、moveSession、updateBrief。\n" +
  "- 每个 action 必须包含 workspaceId，以及该类型所需的字段（groupId/name/sessionId/toGroupId/entity/newBrief 等）。\n" +
  "- 分组第一优先按项目名，例如“MYAGENT”“dsh-file-manager”；不要把不同项目的同一用途/阶段混到同一组。\n" +
  "- 只处理输入里出现的会话；不要为已归档、已删除或未出现在输入里的会话生成任何建议。\n" +
  "- 项目分组内的会话标题写成“主题+阶段”（如“登录讨论”“配置执行”），简介一句话说明该对话具体在做什么。\n" +
  '- 对会话的 updateBrief：entity 为 "session"，entityName 填整理后的中文标题，newBrief 填一句话中文简介；' +
  "不要用“关于”开头，长度控制在 40 字以内。\n" +
  "- 如果会话/分组标题是旧版占位（如“关于…”“你是谁”“未命名会话”）或过于宽泛，应同时通过 updateBrief 修正标题和简介。\n" +
  "- 建议要保守：只建议明确合理的改动，不要臆造不存在的实体。\n" +
  "- 如果默认分组中有多个会话，应新建有意义的命名分组并移入对应会话。\n" +
  "- 分组要尽量细分，不要只根据一个宽泛关键词（如“插件”“dsh”“项目”）把所有会话归为一组。\n" +
  "- 在一个项目分组内，用会话标题/简介区分目的和阶段（如“登录讨论”“配置执行”），但不要把这些不同阶段建成跨项目的分组。\n" +
  "- 不要按“配置/开发/讨论”等环节把不同项目合并到同一组；同一项目下的不同环节用会话标题体现。\n" +
  "- 分组名使用中文；除非是 GitHub、MCP、API 等专有名词，否则不要用英文单词作分组名。\n" +
  "- 如果当前只有默认分组，优先考虑新建 2-5 个具体、细分的命名分组，让整理后不再只有默认分组。\n" +
  // 上下文常驻 + 增量：用户定案"全部存在于同一个上下文内……只需要核对一不一样"。
  "你的上下文**跨调用保留**：首次会收到完整快照，之后只会收到「当前索引（真值）」+ 自上次以来的变化。\n" +
  "· 请把变化合并进你已经掌握的状态，**不要要求重发未变化的内容**。\n" +
  "· 索引是当前真值：发现它与你记忆不一致时，以索引为准并自行校正。\n" +
  "· 与上次的判断**保持一致** —— 除非变化本身要求调整，否则不要反复改动同一批分组。";

/** 取一个槽位绑定的系统提示词。 */
function systemPromptFor(slot: AgentSlot): string {
  return slot.key === "planner" ? PLANNER_SYSTEM_PROMPT : BUTLER_SYSTEM_PROMPT;
}

/**
 * 紧凑索引：分组一行、会话一行，只含**核对与产出 action 所必需**的字段
 * （实体的完整 id + 现名 + 归属）。每次调用都发它，作为"当前真值"供模型对照记忆。
 *
 * 为什么 id 不能截短：模型要靠它产出 `moveSession` / `renameGroup` 等的 groupId / sessionId，
 * 截短后对不上真实实体。所以这里用完整 id —— 索引因此比"纯展示用"的版本大一些，
 * 但仍远小于全量快照（实测 50 会话：索引约 3.9 KB vs 全量 15.3 KB）。
 */
function snapshotIndex(snapshot: OrganizerSnapshot): string {
  const ownerName = (ws: OrganizerWorkspace, sessionId: string): string => {
    const g = ws.groups.find((x) => x.sessionIds.includes(sessionId));
    return g === undefined ? "（未分组）" : `「${g.name}」`;
  };
  const lines: string[] = [];
  for (const ws of snapshot.workspaces) {
    lines.push(`工作区 ${ws.id}「${ws.title}」默认分组「${ws.defaultGroupName}」`);
    for (const g of ws.groups) lines.push(`  组 ${g.id}「${g.name}」`);
    for (const s of ws.sessions) lines.push(`  会话 ${s.id}「${s.title}」→ ${ownerName(ws, s.id)}`);
  }
  return lines.join("\n");
}

/**
 * 算出「自上次成功发送以来有什么变化」。返回 null = 没有任何变化。
 * 未列出的实体一律视为"与模型记忆中一致"，模型不需要、也不应该改动它们。
 */
function snapshotDelta(prev: OrganizerSnapshot, next: OrganizerSnapshot): string | null {
  const out: string[] = [];
  const prevWs = new Map(prev.workspaces.map((w) => [w.id, w]));
  const ownerName = (ws: OrganizerWorkspace, sessionId: string): string =>
    ws.groups.find((g) => g.sessionIds.includes(sessionId))?.name ?? "（未分组）";

  for (const ws of next.workspaces) {
    const p = prevWs.get(ws.id);
    if (p === undefined) {
      out.push(`+ 新增工作区 ${ws.id}「${ws.title}」`);
      continue;
    }
    if (p.title !== ws.title) out.push(`~ 工作区改名 ${ws.id}：「${p.title}」→「${ws.title}」`);
    if (p.brief !== ws.brief) out.push(`~ 工作区简介 ${ws.id}：「${ws.brief}」`);

    const pg = new Map(p.groups.map((g) => [g.id, g]));
    const ng = new Set(ws.groups.map((g) => g.id));
    for (const g of ws.groups) {
      const old = pg.get(g.id);
      if (old === undefined) out.push(`+ 新增分组 ${g.id}「${g.name}」`);
      else if (old.name !== g.name) out.push(`~ 分组改名 ${g.id}：「${old.name}」→「${g.name}」`);
      else if (old.brief !== g.brief) out.push(`~ 分组简介 ${g.id}：「${g.brief}」`);
    }
    for (const g of p.groups) if (!ng.has(g.id)) out.push(`- 已删除分组 ${g.id}「${g.name}」`);

    const ps = new Map(p.sessions.map((s) => [s.id, s]));
    const ns = new Set(ws.sessions.map((s) => s.id));
    for (const s of ws.sessions) {
      const old = ps.get(s.id);
      if (old === undefined) {
        out.push(`+ 新增会话 ${s.id}「${s.title}」简介「${s.brief}」→ ${ownerName(ws, s.id)}`);
        continue;
      }
      if (old.title !== s.title || old.brief !== s.brief) {
        out.push(`~ 会话 ${s.id} 标题「${s.title}」简介「${s.brief}」`);
      }
      const from = ownerName(p, s.id);
      const to = ownerName(ws, s.id);
      if (from !== to) out.push(`~ 会话 ${s.id} 归属：「${from}」→「${to}」`);
    }
    for (const s of p.sessions) if (!ns.has(s.id)) out.push(`- 已删除会话 ${s.id}「${s.title}」`);
  }
  for (const w of prev.workspaces) {
    if (!next.workspaces.some((n) => n.id === w.id)) out.push(`- 已删除工作区 ${w.id}「${w.title}」`);
  }
  return out.length > 0 ? out.join("\n") : null;
}

/** 分区建议槽位（planner）的对外摘要 —— 让面板能显示"它确实开了推理"。 */
export interface PlannerInfo {
  ready: boolean;
  /** 实际生效的推理档；null = 用户默认模型选择里没有档位（跟随模型默认，不额外思考）。 */
  reasoningEffort: string | null;
  sessionId: string;
  requests: number;
  contextTokens: number;
  totalReasoningTokens: number;
  contextBudgetTokens: number;
}

/**
 * 读一份统计快照（浅拷贝，调用方可以安全序列化）。
 * 主体是命名用的 butler 槽位（面板的「管家信息」沿用原语义），另附 planner 摘要。
 */
export function organizerInfo(): OrganizerStats & { planner: PlannerInfo } {
  const p = plannerSlot;
  return {
    ...butlerSlot.stats,
    sessionId: butlerSlot.sessionId,
    planner: {
      ready: p.stats.ready,
      reasoningEffort: p.reasoningEffort ?? null,
      sessionId: p.sessionId,
      requests: p.stats.requests,
      contextTokens: p.stats.contextTokens,
      totalReasoningTokens: p.stats.totalReasoningTokens,
      contextBudgetTokens: ORGANIZER_CONTEXT_BUDGET_TOKENS,
    },
  };
}

/**
 * 让管家 agent 就绪（区管家面板打开时也调一次）。
 *
 * 面板需要"我是什么模型"这类常规信息：不预热的话，用户没点过任何命令时面板只能显示
 * "尚未启动"，看起来就是"消耗显示不好使"。预热**不发模型请求**，只建会话 + 解析 provider/model。
 */
export async function prepareOrganizer(ctx: any): Promise<OrganizerStats> {
  try {
    await ensureSlot(ctx, butlerSlot);
  } catch (err) {
    console.warn("[dsh-myagent] organizer agent not ready", err);
  }
  return organizerInfo();
}

/**
 * 从**当前管家会话日志**里汇总真实用量。
 *
 * 为什么要读日志而不是只用内存计数：内存计数随 dsh 重启清零，用户重启一次 GUI 就看到
 * "累计 0 token"，自然觉得"消耗显示不好使"。管家会话是持久化的，日志里的
 * `assistant/message.usage` 才是可跨重启的真相。读一次 ~350KB 的多帧 zstd，
 * 只在打开面板 / 每次命令后调用，开销可接受。
 */
export async function readOrganizerUsage(ctx: any): Promise<{
  requests: number;
  contextTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  sessionBytes: number | null;
} | null> {
  try {
    const persistence = ctx?.sessionPersistence;
    if (!persistence?.open) return null;
    const handle = await persistence.open(butlerSlot.sessionId, "read");
    try {
      const { events } = await handle.read();
      let requests = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let reasoningTokens = 0;
      let contextTokens = 0;
      for (const e of events as any[]) {
        if (e?.type !== "assistant/message") continue;
        const u = e?.data?.usage;
        if (!u) continue;
        requests += 1;
        inputTokens += Number(u.inputTokens ?? 0);
        outputTokens += Number(u.outputTokens ?? 0);
        cacheReadTokens += Number(u.cacheReadTokens ?? 0);
        reasoningTokens += Number(u.reasoningTokens ?? 0);
        // "上下文已用" = 最近一次请求实际处理的提示词规模。
        contextTokens = Number(u.inputTokens ?? 0) + Number(u.cacheReadTokens ?? 0);
      }
      let sessionBytes: number | null = null;
      try {
        const snapshot = await persistence.stat(butlerSlot.sessionId);
        sessionBytes = typeof snapshot?.sizeBytes === "number" ? snapshot.sizeBytes : null;
      } catch {
        // stat 失败不影响用量汇总。
      }
      return { requests, contextTokens, inputTokens, outputTokens, cacheReadTokens, reasoningTokens, sessionBytes };
    } finally {
      await handle.close?.();
    }
  } catch (err) {
    // 会话还没落盘（第一次请求之前）→ 返回 null，面板退化成内存计数。
    if (!/not found/i.test(String((err as Error)?.message ?? err))) {
      console.warn("[dsh-myagent] cannot read organizer usage", err);
    }
    return null;
  }
}

/**
 * 累计用量并判断是否该轮换会话。
 * `usage.totalTokens` 在 dsh 里 = input + cacheRead + output，即**这次请求处理的上下文**，
 * 直接当"上下文已用"最直观。
 */
function noteUsage(slot: AgentSlot, usage: any): void {
  if (!usage || typeof usage !== "object") return;
  const input = Number(usage.inputTokens ?? 0);
  const output = Number(usage.outputTokens ?? 0);
  const cacheRead = Number(usage.cacheReadTokens ?? 0);
  const reasoning = Number(usage.reasoningTokens ?? 0);
  slot.stats.requests += 1;
  slot.stats.totalInputTokens += input;
  slot.stats.totalOutputTokens += output;
  slot.stats.totalCacheReadTokens += cacheRead;
  slot.stats.totalReasoningTokens += reasoning;
  slot.stats.contextTokens = input + cacheRead;
  slot.stats.lastRequestAt = new Date().toISOString();
  slot.contextTokens = slot.stats.contextTokens;
}

/** 上下文超预算 → 换一个新会话 id（下一次 ensure 会 create 出干净上下文）。 */
async function rotateIfNeeded(slot: AgentSlot): Promise<void> {
  if (slot.contextTokens < ORGANIZER_CONTEXT_BUDGET_TOKENS) return;
  const previous = slot.sessionId;
  await disposeSlot(slot);
  slot.sessionId = `${slot.base}-${Date.now().toString(36)}`;
  slot.contextTokens = 0;
  // 新会话的上下文是空的 → 缓存的"已发快照"作废，下次整份重发。
  slot.lastPlanSnapshot = undefined;
  slot.stats.contextTokens = 0;
  slot.stats.rotations += 1;
  console.log(`[dsh-myagent] organizer context rotated (${slot.key}): ${previous} → ${slot.sessionId}`);
}

/**
 * 解析"默认模型"选择（provider/model）的回调，由 `src/index.ts` 在
 * `agentDefaultModel` 服务就绪时通过 `ctx.inject` 注入。
 *
 * 【为什么必须有它（2026-09-12 找到的真根因）】
 * `agents.create({ agentOptions: {} })` 建的 agent **没有 provider/model**，于是
 * dsh-agent-loop 的 `prepareRequest()` 在每次 turn 一开始就抛：
 *   `agent "…" has no provider/model: set AgentOptions.provider and AgentOptions.model
 *    or supply both via the agent/request waterfall`
 * 也就是说 `followup()` 是**通的**（turn/step 都建起来了），但模型调用根本没发生，
 * 所以 `deriveMessages()` 永远不增长、管家永远"没有输出"。
 * 上一轮把它归因成"followup 不驱动 agent 循环"是**误判** —— 会话日志里的 40 条 turn/end
 * 全是这条错误。
 *
 * 官方 dsh-api-session-controller 的写法就是
 * `const { provider, model } = ctx.agentDefaultModel.currentSelection()`，
 * 这里照抄 provider/model。`reasoningEffort` 也一并取出来，但**只有 planner 槽位用它**
 * （"分区策略也得是模型思考后的"）；命名用的 butler 槽位仍然不传，保持快。
 * 见 `AgentSlot.useDefaultReasoning`。
 */
type DefaultModelSelection = { provider?: string; model?: string; reasoningEffort?: string };

let resolveDefaultModel: (() => DefaultModelSelection | null) | null = null;

/** 由 apply() 注入默认模型解析器（agentDefaultModel 服务就绪时调用）。 */
export function setDefaultModelResolver(fn: (() => DefaultModelSelection | null) | null): void {
  resolveDefaultModel = fn;
}

/** 取当前默认模型选择；服务缺失/异常一律返回 null（调用方据此提前失败）。 */
function currentDefaultModel(ctx: any): DefaultModelSelection | null {
  try {
    // 两条路都试：直接 get（同 fiber 链上可见时最快），否则用 apply() 里动态 inject 注入的回调。
    const direct = ctx?.get?.("agentDefaultModel");
    if (direct?.currentSelection) return direct.currentSelection();
  } catch {
    // 未声明/未就绪 → 走注入回调。
  }
  try {
    return resolveDefaultModel?.() ?? null;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      reject(new Error("organizer agent timeout"));
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("organizer request aborted"));
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new Error("organizer request aborted"));
      return;
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", onAbort);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", onAbort);
        reject(err);
      },
    );
  });
}

async function ensureSlot(ctx: any, slot: AgentSlot, signal?: AbortSignal): Promise<void> {
  if (slot.agent) return;
  if (slot.ready) return slot.ready;
  slot.ready = (async () => {
    // agents 已在宿主 inject 里声明（见 src/index.ts），正常路径直接取 ctx.agents；
    // ctx?.get?.() 是更宽松的探测（某些版本上 get 不存在或返回 undefined），
    // 两条路任一拿到即可 —— 都拿不到就抛，调用方按"不产出"处理。
    const agents = ctx?.get?.("agents") ?? ctx?.agents;
    if (!agents?.create) throw new Error("agents service unavailable");

    // provider/model 是**必需**的：缺了模型调用根本不发生（每个 turn 直接报错）。
    // 宁可在这里带着原因提前失败，也不要建一个永远不出话的 agent。
    const selection = currentDefaultModel(ctx);
    const provider = selection?.provider ?? "";
    const model = selection?.model ?? "";
    if (!provider || !model) {
      throw new Error(
        `default model unavailable (provider=${provider || "?"} model=${model || "?"}); ` +
          `agentDefaultModel service not resolved — see settings key "agent-default-model"`,
      );
    }
    // 推理档：planner 固定 `low`（用户定案）；butler 不传（命名是高频小活，要快）。
    //
    // 只在**该部署支持 thinking** 时才真的传：`currentSelection()` 里带 `reasoningEffort`
    // 就说明这个部署开着 thinking；没带就说明被关掉了，而 DeepSeek 适配器对 thinking 关闭的
    // 部署会拒绝**任何** effort（抛 UNSUPPORTED_REASONING_EFFORT），所以这时必须省略 ——
    // 硬编码 "low" 会让分区建议在这类部署上直接不可用。
    const deploymentSupportsThinking = selection?.reasoningEffort !== undefined;
    const reasoningEffort = deploymentSupportsThinking ? slot.fixedReasoningEffort : undefined;
    slot.reasoningEffort = reasoningEffort;

    const setup = (agentCtx: any) => {
      try {
        // 干净 agent：不挂载任何全局工具。
        agentCtx?.tools?.restrict?.({ allow: [] });
      } catch {
        // 工具服务缺失时忽略；agent 仍可纯文本整理。
      }
      try {
        // 不继承任何已有全局规则：用 complete section 覆盖整套 system prompt。
        // 内容 = 这个槽位**绑死的规则**（见 BUTLER_SYSTEM_PROMPT / PLANNER_SYSTEM_PROMPT），
        // 于是后续每次调用只需发「固定短命令 + 数据」。
        agentCtx?.systemPrompt?.section?.({
          name: `dsh-myagent-organizer-${slot.key}`,
          order: -1000,
          complete: true,
          text: systemPromptFor(slot),
        });
      } catch {
        // systemPrompt 服务缺失时忽略。
      }
      try {
        agentCtx?.systemPrompt?.suppressRuntimeContext?.();
      } catch {
        // ignore
      }
    };
    try {
      const handle = await openSlotAgent(agents, slot, { provider, model, reasoningEffort, setup, signal });
      slot.handle = handle;
      slot.agent = handle?.agent;
      // 刚建/刚 resume 出来的会话，上下文里有什么无从确认 → 让下次整份重发（安全侧）。
      slot.lastPlanSnapshot = undefined;
    } catch (err) {
      slot.handle = null;
      slot.agent = null;
      throw err;
    }
    slot.stats.ready = true;
    slot.stats.provider = provider;
    slot.stats.model = model;
    slot.stats.sessionId = slot.sessionId;
    console.log(
      `[dsh-myagent] organizer agent ready (${slot.key}: ${provider}/${model}` +
        `${reasoningEffort === undefined ? "" : ` reasoning=${reasoningEffort}`}) session=${slot.sessionId}`,
    );
  })().finally(() => {
    slot.ready = null;
  });
  return slot.ready;
}

/**
 * 打开常驻管家会话，**保证拿到一个能用的 agent**。
 *
 * 三级退让（2026-09-12 实测踩到第 3 级）：
 *  1. `create(主 id)`；
 *  2. 会话已存在（热重载/重复启动）→ `resume(主 id)`；
 *  3. **主 id 被别的 dsh 实例占着**（同一个 DSH_HOME 被两个 `dsh web` 打开时必然发生，
 *     实测报 `SessionAlreadyOwnedError: session "…" is already owned by an active write handle`）
 *     → 换一个**本次进程专属**的新会话 id 重建。
 * 没有第 3 级时，第二个实例的管家永远起不来，所有总结会静默退化成本地提取
 * （表面"功能正常"，实际标题全是"主题：进行中"）。
 */
async function openSlotAgent(
  agents: any,
  slot: AgentSlot,
  options: { provider: string; model: string; reasoningEffort?: string; setup: (ctx: any) => void; signal?: AbortSignal },
): Promise<any> {
  const { provider, model, reasoningEffort, setup, signal } = options;
  // reasoningEffort 只在有值时出现 —— DeepSeek 适配器对 thinking 关闭的部署会拒绝任何档位。
  const agentOptions =
    reasoningEffort === undefined ? { provider, model } : { provider, model, reasoningEffort };
  const attempts: Array<{ id: string; via: "create" | "resume" }> = [
    { id: slot.sessionId, via: "create" },
    { id: slot.sessionId, via: "resume" },
    { id: `${slot.base}-${process.pid.toString(36)}`, via: "create" },
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      if (attempt.via === "create") {
        const handle = await agents.create({ sessionId: attempt.id, meta: { cwd: process.cwd() }, agentOptions, setup, signal });
        if (attempt.id !== slot.sessionId) {
          console.log(`[dsh-myagent] organizer session "${slot.sessionId}" is taken; using "${attempt.id}"`);
          slot.sessionId = attempt.id;
          slot.stats.sessionId = attempt.id;
        }
        return handle;
      }
      if (!agents.resume) throw new Error("agents.resume unavailable");
      return await agents.resume({ resumeSessionId: attempt.id, agentOptions, setup, signal });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("cannot open organizer agent");
}

/** 释放一个槽位的常驻 agent。 */
async function disposeSlot(slot: AgentSlot): Promise<void> {
  const handle = slot.handle;
  slot.handle = null;
  slot.agent = null;
  await handle?.dispose?.();
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // ignore
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      // ignore
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // ignore
    }
  }
  throw new Error("organizer agent returned invalid JSON");
}

function lastAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "assistant") continue;
    const text = (m.content ?? [])
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b?.text ?? "")
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

/**
 * 向**分区建议专用槽位**（planner，开推理）发送一次整理请求，返回规范化后的建议 JSON。
 *
 * 【为什么不再有本地兜底】用户定案："分区策略也得是模型思考后的" —— 旧的 `localOrganizerPlan`
 * 是一套确定性规则（补简介 / 合并重名分组 / 删空分组 / 按名称归类），**没有语义分区能力**，
 * 一旦触发，返回的"整理建议"就不是模型想的了。现在模型拿不出计划就**如实报错**，
 * 绝不用本地规则冒充。
 */
export async function requestOrganizerPlan(
  ctx: any,
  snapshot: OrganizerSnapshot,
  signal?: AbortSignal,
): Promise<{ plan: OrganizePlan; source: "agent" }> {
  // 150s：planner 固定开 `low` 推理，比命名慢；路由超时（180s）留出余量，让这里的超时
  // 先生效、报出干净的错误，而不是被路由拦腰掐断。
  const timeoutMs = 150_000;
  // 固定短命令 + 数据：规则全在 PLANNER_SYSTEM_PROMPT 里（绑死设定），这里不再复述。
  //
  // 首次（或上下文可能失效后）发**全量快照**；之后只发「当前索引 + 自上次以来的变化」——
  // 用户定案："全部存在于同一个上下文内，很多东西每次轮转的时候就不用再读了，
  // 只需要核对一不一样"。索引每次都给，是让模型能发现自己记忆与真值不一致并自行校正。
  // 先把槽位准备好再读缓存：`ensureSlot` 在**新建/resume** 时会把 lastPlanSnapshot 清空
  // （上下文里有什么无从确认 → 安全侧整份重发）。若先读缓存、再让 askSlot 内部去 ensure，
  // 读到的就是上一个 agent 留下的旧值，新会话会错误地只收到一份增量。
  await ensureSlot(ctx, plannerSlot, signal);
  const prev = plannerSlot.lastPlanSnapshot;
  const detail = prev === undefined ? null : snapshotDelta(prev, snapshot);
  const prompt =
    prev === undefined
      ? `整理全部。工作区快照（首次，完整）：

${JSON.stringify(snapshot, null, 2)}`
      : detail === null
        ? `核对。工作区当前索引（真值）：
${snapshotIndex(snapshot)}

自上次以来**没有任何变化**。若你上次的判断仍然成立，只输出 {"actions":[]}。`
        : `核对并整理。工作区当前索引（真值）：
${snapshotIndex(snapshot)}

自上次以来有这些变化（**未列出的实体与你记忆中一致，不要改动它们**）：
${detail}`;

  let text: string;
  try {
    text = await askSlot(ctx, plannerSlot, `org-${Date.now()}`, prompt, timeoutMs, signal);
  } catch (err) {
    // 失败时模型可能根本没答 → 无法确认它记住了什么，作废"已发快照"缓存，
    // 让下一次整份重发（宁可多发全量，也不发可能对不上的增量）。
    plannerSlot.lastPlanSnapshot = undefined;
    throw err;
  }
  const parsed = extractJson(text);
  const plan = normalizeOrganizePlan(parsed);
  if (plan.actions.length === 0 && !Array.isArray((parsed as any)?.actions)) {
    plannerSlot.lastPlanSnapshot = undefined;
    throw new Error("organizer agent returned invalid plan");
  }
  // 只有**成功往返**才记下"这次发出去的是这份"，作为下次算增量的基线。
  plannerSlot.lastPlanSnapshot = snapshot;
  return { plan, source: "agent" };
}

/**
 * 从会话日志尾部找最近一条**模型层**错误。
 *
 * 为什么需要：模型调用失败时（没 API key、超时、限流…）agent 循环会把原因写进
 * `turn/end.data.reason.error`，但 `followup()` **不抛异常**、`deriveMessages()` 也拿不到它，
 * 于是 askSlot 只能报"没有产出"。而按用户定案本地不再兜底，"为什么没有建议"就是用户
 * 唯一能拿到的信息 —— 必须把真实原因带出来，否则只剩一句无从下手的诊断。
 */
async function lastSessionError(ctx: any, sessionId: string): Promise<string | null> {
  try {
    const persistence = ctx?.sessionPersistence;
    if (!persistence?.open) return null;
    const handle = await persistence.open(sessionId, "read");
    try {
      const { events } = await handle.read();
      for (let i = events.length - 1; i >= 0; i--) {
        const e: any = events[i];
        if (e?.type !== "turn/end") continue;
        const err = e?.data?.reason?.error;
        if (err?.message) return String(err.message);
      }
      return null;
    } finally {
      await handle.close?.();
    }
  } catch {
    return null;
  }
}

/**
 * 向指定槽位投喂一段提示词并取回助手正文（含用量统计与上下文轮换）。
 *
 * 三个 request* 原本各自复制了一遍 followup / whenIdle / deriveMessages / 取正文，
 * 现在收敛成这一处：before 快照 → followup → 等 idle → 取新增消息里最后一条助手正文
 * → 记用量 → 超预算则轮换会话。
 * 失败信息带上诊断（新增消息条数/角色/status/before），因为"模型没答"和"回答为空"
 * 以前长得一模一样，极难排查。
 */
async function askSlot(
  ctx: any,
  slot: AgentSlot,
  kind: string,
  prompt: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  await ensureSlot(ctx, slot, signal);
  const organizerAgent = slot.agent;
  if (!organizerAgent) throw new Error("organizer agent not ready");
  const before = organizerAgent.session?.deriveMessages?.().length ?? 0;
  organizerAgent.followup({
    id: `${kind}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content: [{ type: "text", text: prompt }],
    source: { kind: "plugin", plugin: "dsh-myagent" },
  });
  const idlePromise = organizerAgent.whenIdle?.();
  if (idlePromise) {
    await withTimeout(Promise.resolve(idlePromise), timeoutMs, signal);
  }
  const fresh = (organizerAgent.session?.deriveMessages?.() ?? []).slice(before);
  const text = lastAssistantText(fresh);
  if (!text) {
    const a: any = organizerAgent;
    // 模型层失败（没 key / 超时 / 限流）不会从 followup 抛出来，只写在会话日志里 ——
    // 本地不再兜底之后，这是用户唯一能知道"为什么没有建议"的来源，必须带上。
    const modelError = await lastSessionError(ctx, slot.sessionId);
    throw new Error(
      `organizer agent returned no ${kind}` +
        (modelError ? `: ${modelError}` : "") +
        ` (新增消息 ${fresh.length} 条: ` +
        `${fresh.map((m: any) => m?.role).join(",") || "无"}; status=${a?.status ?? "?"}; before=${before})`,
    );
  }
  // 用量取自最后一条助手消息（dsh 的 assistant/message 上带 usage）。
  const lastAssistant = [...fresh].reverse().find((m: any) => m?.role === "assistant");
  noteUsage(slot, (lastAssistant as any)?.usage);
  await rotateIfNeeded(slot);
  return text.replace(/\s+/g, " ").trim();
}

/** 一次总结请求的输入：会话自身内容 + 项目背景。 */
export interface ConversationMetaInput {
  /** 项目名（工作目录的末段），仅用于让模型理解术语，标题里不要带它。 */
  projectName: string;
  /** 会话自身内容的"首尾采样"文本（尾部权重更高）。 */
  transcript: string;
}

/**
 * 对话内容的公共上下文段（brief 与 title 两次请求共用，保证口径一致）。
 *
 * 【为什么**不**再把项目记忆 md 塞进提示词】实测踩过：会话本身几乎没有内容时
 * （比如只有一句"1"），模型会直接抓项目记忆的最后一个 `##` 小节当标题 ——
 * 于是这条会话被命名成「总结修复：定位缺少模型配置」（那是**项目**最近做的事，
 * 不是**这个对话**做的事）。项目记忆按项目存，天然区分不了对话，只能当噪音。
 */
function conversationContext(input: ConversationMetaInput): string {
  return `项目：${input.projectName}

对话内容（首尾采样，中间可能省略）：
${input.transcript}`;
}

/**
 * 第一步：概括**这个对话在做什么工作**（一句话简介）。
 *
 * 【为什么以"会话自身内容"为主料】
 * 简介/标题的用途是"简短的说明这个对话在做什么工作"。项目记忆 md 是**按项目**存的，
 * 同一项目下所有会话读到的都是同一个小节 —— 实测按钮曾返回
 * `总结的数据源改为"最后一次记忆"（两个按` 这种"记忆小节标题被硬截断"的结果，
 * 而且同一项目的每个会话都会得到同一句话。所以记忆只能当**背景**。
 */
export async function requestConversationBrief(
  ctx: any,
  input: ConversationMetaInput,
  signal?: AbortSignal,
): Promise<string> {
  // 固定短命令 + 数据：规则全在 BUTLER_SYSTEM_PROMPT 里（绑死设定），这里不再复述。
  const prompt = `写简介：

${conversationContext(input)}`;
  const text = await askSlot(ctx, butlerSlot, "brief", prompt, 15000, signal);
  // 只取第一行/第一句，避免模型多嘴。
  const brief = text.split(/\n/)[0].replace(/^["“]|["”]$/g, "").trim();
  if (!brief) throw new Error("organizer agent returned empty brief");
  return brief.slice(0, 80);
}

/**
 * 第二步：**依据简介**产出标题，固定格式 `主题：进度`（例：`meta分析：已检索完文献`）。
 *
 * 用户要求「先总结简介，再更新标题」，所以标题是**在简介之后**单独请求的：
 * 冒号前 = 稳定的工作主题（同一件事的多轮对话应保持不变），冒号后 = 当前进度。
 */
export async function requestTitleFromBrief(
  ctx: any,
  brief: string,
  signal?: AbortSignal,
): Promise<string> {
  const prompt = `写标题：

简介：${brief}`;
  const text = await askSlot(ctx, butlerSlot, "title", prompt, 12000, signal);
  const title = text.split(/\n/)[0].replace(/^["“]|["”]$/g, "").trim();
  if (!title) throw new Error("organizer agent returned empty title");
  return title.slice(0, 40);
}

/**
 * 一步到位版（批量整理用）：一次请求同时给出简介与标题，**字段顺序就是产出顺序**
 * （模型先写 brief 再写 title，等于在简介之后才定标题）。
 * 单会话的两个按钮走两步版（brief → title），批量为了控制耗时走这一步版。
 */
export async function requestConversationMeta(
  ctx: any,
  input: ConversationMetaInput,
  signal?: AbortSignal,
): Promise<{ title: string; brief: string }> {
  const prompt = `写简介和标题：

${conversationContext(input)}`;
  // 15s：路由给的预算是 30s，留出本地兜底与写回的时间。
  const text = await askSlot(ctx, butlerSlot, "meta", prompt, 15000, signal);
  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== "object") throw new Error("organizer agent returned invalid meta");
  const title = typeof (parsed as any).title === "string" ? (parsed as any).title.trim() : "";
  const brief = typeof (parsed as any).brief === "string" ? (parsed as any).brief.trim() : "";
  // 只答了一半（例如只给 title）不算失败：缺的字段留空，交给调用方用本地提取补齐。
  if (!title && !brief) throw new Error("organizer agent returned empty meta");
  return { title, brief };
}

/**
 * 插件卸载时释放两个槽位的常驻 agent。
 *
 * 旧的 `localOrganizerPlan`（本地确定性整理器）已按用户定案**删除**：
 * 分区策略必须由模型产出，本地规则不得再冒充。`client/organizer.ts` 里的
 * `buildOrganizePlan` 保留（仍被 test/organizer.test.ts 覆盖），但已不在任何生产路径上。
 */
export async function disposeOrganizerAgent(): Promise<void> {
  await Promise.all([disposeSlot(butlerSlot), disposeSlot(plannerSlot)]);
}

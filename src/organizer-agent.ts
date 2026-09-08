// src/organizer-agent.ts — 宿主半区的“工作沙盒整理员”常驻子 agent。
// 优先使用 dsh 的 AgentRegistry（ctx.agents）创建一个干净、无工具的常驻会话 agent；
// 若宿主未提供 agents 服务，则调用方降级到本地确定性整理器（client/organizer.ts）。
import { buildOrganizePlan, normalizeOrganizePlan, type OrganizePlan, type OrganizerSnapshot } from "./client/organizer.ts";

let organizerHandle: any = null;
let organizerAgent: any = null;
let organizerReady: Promise<void> | null = null;

const ORGANIZER_SESSION_ID = "dsh-myagent-sandbox-organizer";

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

async function ensureOrganizerAgent(ctx: any, signal?: AbortSignal): Promise<void> {
  if (organizerAgent) return;
  if (organizerReady) return organizerReady;
  organizerReady = (async () => {
    const agents = ctx?.get?.("agents") ?? ctx?.agents;
    if (!agents?.create) throw new Error("agents service unavailable");
    const setup = (agentCtx: any) => {
      try {
        // 干净 agent：不挂载任何全局工具。
        agentCtx?.tools?.restrict?.({ allow: [] });
      } catch {
        // 工具服务缺失时忽略；agent 仍可纯文本整理。
      }
      try {
        // 不继承任何已有全局规则：用 complete section 覆盖整套 system prompt。
        agentCtx?.systemPrompt?.section?.({
          name: "dsh-myagent-sandbox-organizer",
          order: -1000,
          complete: true,
          text: "你是管家。你只根据用户提供的 JSON 快照输出整理建议 JSON；快照只包含未归档、未删除的可见会话。快照中的 title 和 brief 是你整理的核心原料。分组时先按项目名归类，例如“MYAGENT”“dsh-file-manager”，不要按用途/阶段把不同项目混到同一组；项目分组内的会话标题写成“主题+阶段”（如“登录讨论”“配置执行”）。你不读取文件、不调用工具、不解释、不输出 JSON 以外的内容。",
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
      const handle = await agents.create({
        sessionId: ORGANIZER_SESSION_ID,
        meta: { cwd: process.cwd() },
        agentOptions: {},
        setup,
        signal,
      });
      organizerHandle = handle;
      organizerAgent = handle?.agent;
    } catch (err) {
      // 会话已存在（例如热重载/重复启动）时尝试恢复。
      if (agents.resume) {
        const handle = await agents.resume({
          resumeSessionId: ORGANIZER_SESSION_ID,
          agentOptions: {},
          setup,
          signal,
        });
        organizerHandle = handle;
        organizerAgent = handle?.agent;
      } else {
        throw err;
      }
    }
  })().finally(() => {
    organizerReady = null;
  });
  return organizerReady;
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

/** 向常驻整理员发送一次整理请求，返回规范化后的建议 JSON。 */
export async function requestOrganizerPlan(
  ctx: any,
  snapshot: OrganizerSnapshot,
  signal?: AbortSignal,
): Promise<{ plan: OrganizePlan; source: "agent" }> {
  await ensureOrganizerAgent(ctx, signal);
  if (!organizerAgent) throw new Error("organizer agent not ready");
  const prompt = `你是管家。请根据下面的工作沙盒树、分组名、会话标题（title）与一句话简介（brief），输出一份整理建议 JSON。
要求：
- 只输出 JSON，不要解释。
- JSON 结构：{"actions":[...]}
- action 的 kind 只能是：createGroup、renameGroup、deleteGroup、mergeGroup、moveSession、updateBrief。
- 每个 action 必须包含 workspaceId，以及该类型所需的字段（groupId/name/sessionId/toGroupId/entity/newBrief 等）。
- 分组第一优先按项目名，例如“MYAGENT”“dsh-file-manager”；不要把不同项目的同一用途/阶段混到同一组。
- 只处理快照中出现的会话；不要为已归档、已删除或未出现在快照中的会话生成任何建议。
- 项目分组内的会话标题写成“主题+阶段”（如“登录讨论”“配置执行”），简介一句话说明该对话具体在做什么。
- 对会话的 updateBrief：entity 为 "session"，entityName 填整理后的中文标题，newBrief 填一句话中文简介；不要用“关于”开头，长度控制在 40 字以内。
- 如果会话/分组标题是旧版占位（如“关于…”“你是谁”“未命名会话”）或过于宽泛，应同时通过 updateBrief 修正标题和简介。
- 建议要保守：只建议明确合理的改动，不要臆造不存在的实体。
- 如果默认分组中有多个会话，应新建有意义的命名分组并移入对应会话。
- 分组要尽量细分，不要只根据一个宽泛关键词（如“插件”“dsh”“项目”）把所有会话归为一组。
- 在一个项目分组内，用会话标题/简介区分目的和阶段（如“登录讨论”“配置执行”），但不要把这些不同阶段建成跨项目的分组。
- 不要按“配置/开发/讨论”等环节把不同项目合并到同一组；同一项目下的不同环节用会话标题体现，而不是拆成跨项目分组。
- 分组名使用中文；除非是 GitHub、MCP、API 等专有名词，否则不要用英文单词作分组名。
- 如果当前只有默认分组，优先考虑新建 2-5 个具体、细分的命名分组，让整理后不再只有默认分组。
- 不要调用任何工具。

快照：
${JSON.stringify(snapshot, null, 2)}`;
  const before = organizerAgent.session?.deriveMessages?.().length ?? 0;
  organizerAgent.followup({
    id: `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content: [{ type: "text", text: prompt }],
    source: { kind: "plugin", plugin: "dsh-myagent" },
  });
  const idlePromise = organizerAgent.whenIdle?.();
  if (idlePromise) {
    await withTimeout(Promise.resolve(idlePromise), 60000, signal);
  }
  const messages = organizerAgent.session?.deriveMessages?.() ?? [];
  const assistantText = lastAssistantText(messages.slice(before));
  if (!assistantText) throw new Error("organizer agent returned no output");
  const parsed = extractJson(assistantText);
  const plan = normalizeOrganizePlan(parsed);
  if (plan.actions.length === 0 && !Array.isArray((parsed as any)?.actions)) {
    throw new Error("organizer agent returned invalid plan");
  }
  return { plan, source: "agent" };
}

/** 让常驻整理员把一段会话内容总结为一句话简介。 */
export async function requestSessionSummary(
  ctx: any,
  _sessionId: string,
  messages: Array<{ role: string; text: string }>,
  signal?: AbortSignal,
): Promise<string> {
  await ensureOrganizerAgent(ctx, signal);
  if (!organizerAgent) throw new Error("organizer agent not ready");
  const transcript = messages
    .slice(0, 20)
    .map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.text}`)
    .join("\n");
  const prompt = `请根据下面的对话内容，用一句中文概括这个对话的用途或主题。
要求：
- 只输出这一句概括，不要解释，不要用“关于”开头。
- 优先写成“做什么/解决什么”的动宾结构，而不是“关于什么”。
- 如果对话属于某个项目（如 MYAGENT、dsh-file-manager），在概括中带上项目名。
- 用“主题+阶段”的语感（如“登录讨论”“配置执行”）。
- 长度控制在 40 字以内。

对话内容：
${transcript}`;
  const before = organizerAgent.session?.deriveMessages?.().length ?? 0;
  organizerAgent.followup({
    id: `sum-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content: [{ type: "text", text: prompt }],
    source: { kind: "plugin", plugin: "dsh-myagent" },
  });
  const idlePromise = organizerAgent.whenIdle?.();
  if (idlePromise) {
    await withTimeout(Promise.resolve(idlePromise), 30000, signal);
  }
  const messagesAfter = organizerAgent.session?.deriveMessages?.() ?? [];
  const summary = lastAssistantText(messagesAfter.slice(before));
  if (!summary) throw new Error("organizer agent returned no summary");
  return summary.replace(/\s+/g, " ").trim();
}

/** 让常驻整理员把一段会话内容重新总结为一个标题。 */
export async function requestSessionTitle(
  ctx: any,
  _sessionId: string,
  messages: Array<{ role: string; text: string }>,
  signal?: AbortSignal,
): Promise<string> {
  await ensureOrganizerAgent(ctx, signal);
  if (!organizerAgent) throw new Error("organizer agent not ready");
  const transcript = messages
    .slice(0, 20)
    .map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.text}`)
    .join("\n");
  const prompt = `请根据下面的对话内容，用一句中文给这个对话起一个标题。
要求：
- 只输出标题，不要解释，不要用“关于”开头。
- 使用“主题+阶段”的语感，例如“登录讨论”“配置执行”。
- 长度控制在 20 字以内。

对话内容：
${transcript}`;
  const before = organizerAgent.session?.deriveMessages?.().length ?? 0;
  organizerAgent.followup({
    id: `title-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content: [{ type: "text", text: prompt }],
    source: { kind: "plugin", plugin: "dsh-myagent" },
  });
  const idlePromise = organizerAgent.whenIdle?.();
  if (idlePromise) {
    await withTimeout(Promise.resolve(idlePromise), 30000, signal);
  }
  const messagesAfter = organizerAgent.session?.deriveMessages?.() ?? [];
  const title = lastAssistantText(messagesAfter.slice(before));
  if (!title) throw new Error("organizer agent returned no title");
  return title.replace(/\s+/g, " ").trim();
}

/** 让常驻整理员根据“最后一次记忆 md”内容，输出对话标题和简介。 */
export async function requestMemoryMeta(
  ctx: any,
  memoryText: string,
  signal?: AbortSignal,
): Promise<{ title: string; brief: string }> {
  await ensureOrganizerAgent(ctx, signal);
  if (!organizerAgent) throw new Error("organizer agent not ready");
  const prompt = `请根据下面的“最后一次记忆”内容，输出这个对话的标题和一句话简介。
要求：
- 只输出 JSON，不要解释，不要用“关于”开头。
- JSON 结构：{"title":"...","brief":"..."}
- title 使用“主题+阶段”语感，长度控制在 20 字以内。
- brief 使用“做什么/解决什么”的动宾结构，长度控制在 40 字以内。

最后一次记忆：
${memoryText.slice(0, 3000)}`;
  const before = organizerAgent.session?.deriveMessages?.().length ?? 0;
  organizerAgent.followup({
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    content: [{ type: "text", text: prompt }],
    source: { kind: "plugin", plugin: "dsh-myagent" },
  });
  const idlePromise = organizerAgent.whenIdle?.();
  if (idlePromise) {
    await withTimeout(Promise.resolve(idlePromise), 30000, signal);
  }
  const messagesAfter = organizerAgent.session?.deriveMessages?.() ?? [];
  const text = lastAssistantText(messagesAfter.slice(before));
  if (!text) throw new Error("organizer agent returned no memory summary");
  const parsed = extractJson(text);
  if (!parsed || typeof parsed !== "object") throw new Error("organizer agent returned invalid memory summary");
  const title = typeof (parsed as any).title === "string" ? (parsed as any).title.trim() : "";
  const brief = typeof (parsed as any).brief === "string" ? (parsed as any).brief.trim() : "";
  if (!title || !brief) throw new Error("organizer agent returned incomplete memory summary");
  return { title, brief };
}

/** 本地确定性整理器（无 agent 或 agent 失败时降级）。 */
export function localOrganizerPlan(snapshot: OrganizerSnapshot): OrganizePlan {
  return buildOrganizePlan(snapshot);
}

/** 插件卸载时释放常驻 agent。 */
export function disposeOrganizerAgent(): Promise<void> | void {
  const handle = organizerHandle;
  organizerHandle = null;
  organizerAgent = null;
  return handle?.dispose?.();
}

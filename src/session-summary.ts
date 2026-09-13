// src/session-summary.ts — 宿主半区：读取会话内容，统计真实用户交互次数，并生成标题/简介。
//
// 【数据源与格式定案（2026-09-12，第三版）】
// 标题与简介的用途是"简短的说明**这个对话**在做什么工作"：
//   1) 主料是**会话自身内容**（首条=目标、末尾=当前阶段）；项目记忆 md 只当模型背景。
//      （前两版分别错在"回落到第一条用户消息"和"读项目记忆小节 → 同项目所有会话同一句话"。）
//   2) 标题格式固定为 `主题：进度`（如"meta分析：已检索完文献"）：
//      **先产出简介，再依据简介产出标题**，冒号前是稳定主题、冒号后是当前进度。
import { requestConversationBrief, requestConversationMeta, requestTitleFromBrief } from "./organizer-agent.ts";
import path from "node:path";

export interface ChatMessage {
  role: string;
  text: string;
}

function textFromContent(content: any[] | undefined): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b?.text ?? "")
    .join(" ")
    .trim();
}

/**
 * 只作为"锚定/寒暄"存在、不含任何需求的用户发言。
 *
 * 典型来源是 preset 的 anchor 轮（本机 `anchor-turn` 就是 `你是谁`）。这些文本
 * 出现在会话第一条，若被当成"真实用户需求"，标题就永远是"你是谁" ——
 * 这正是用户报的"两个按钮给出同一段没信息量的文本"的根因之一。
 * 判定前先去掉空白与标点，避免"你是谁？"漏网。
 */
const ANCHOR_ONLY =
  /^(你是谁|你叫什么|你是什么模型|你是什么ai|你好|您好|哈喽|在吗|hi|hello|hey|测试|测试一下|test|继续|continue|goon|ok|okay|好的|好|行|嗯|谢谢|thanks)$/i;

function isRealUserText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return false;
  if (/Workspace instruction files exist|AGENTS\.md|<system-reminder>|Current runtime context|The approval policy changed/.test(trimmed)) {
    return false;
  }
  return !ANCHOR_ONLY.test(trimmed.replace(/[\s，。！？、~,.!?;；:：]+/g, ""));
}

/**
 * 清洗一行文本供标题/简介使用：去代码块/行内代码/Markdown 链接/URL/HTML 标签，
 * 压空白，再按 max 截断。
 *
 * 截断必须"不切在半个括号里"：实测过一次难看的输出
 * `总结的数据源改为"最后一次记忆"（两个按` —— 20 字硬切把 `（两个按钮…）` 切成了半截。
 * 所以截断后把尾部**未闭合**的括号/引号连同其后内容一起去掉，再补 `…`。
 */
export function cleanLine(text: string, max: number): string {
  let t = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > max) {
    t = t.slice(0, max);
    // 尾部未闭合的开括号/引号：从它开始整段丢掉。
    t = t.replace(/[（(\[【《“"‘'][^（）()\[\]【】《》“”‘’"]*$/, "").trim();
    t = t.replace(/[，。、；：,.;:!?！？…\-—\s]+$/, "").trim();
    if (t.length > 0) t += "…";
  }
  return t;
}

/** 标题优先取"首个短句"，例如 `帮我修一下 X（顺便加个按钮）` → `帮我修一下 X`。 */
function titleLine(text: string, max: number): string {
  const cleaned = cleanLine(text, Math.max(max * 3, 60));
  const head = cleaned.split(/[。！？!?；;\n]|，然后|，另外/)[0]?.trim() ?? "";
  const base = head.length >= 6 ? head : cleaned;
  return cleanLine(base, max);
}

/** 会话摘要的原料：**只有会话自身内容**（首尾采样）。 */
export interface ConversationDigest {
  projectName: string;
  transcript: string;
  /** 第一条实质用户发言（对话的目标）。 */
  firstUser: string;
  /** 最后一条实质用户发言（对话当前阶段）。 */
  lastUser: string;
  hasUserText: boolean;
}

/** 从若干条消息里挑出"首尾采样"文本：≤14 条全取，否则 首3 + 尾9。 */
function sampleMessages(messages: ChatMessage[]): ChatMessage[] {
  const substantive = messages.filter((m) =>
    m.role === "user" ? isRealUserText(m.text) : m.text.trim() !== "",
  );
  if (substantive.length <= 14) return substantive;
  return [...substantive.slice(0, 3), { role: "note", text: "……（中间省略）……" }, ...substantive.slice(-9)];
}

/** 组装一次摘要所需的全部原料。 */
export async function collectDigest(ctx: any, sessionId: string): Promise<ConversationDigest> {
  const messages = await getSessionMessages(ctx, sessionId);
  const realUser = messages.filter((m) => m.role === "user" && isRealUserText(m.text));
  const cwd = await getSessionCwd(ctx, sessionId);
  const projectName = cwd ? path.basename(cwd) || cwd : "（未知项目）";
  const transcript = sampleMessages(messages)
    .map((m) => {
      // 用户的原始需求留长一点，助手回复只留摘要（省 token、也避免复述整段代码）。
      const label = m.role === "user" ? "用户" : m.role === "assistant" ? "助手" : "";
      const text = m.role === "user" ? cleanLine(m.text, 700) : cleanLine(m.text, 300);
      return label ? `${label}：${text}` : text;
    })
    .join("\n")
    .slice(-6500);
  return {
    projectName,
    transcript,
    firstUser: realUser[0]?.text ?? "",
    lastUser: realUser[realUser.length - 1]?.text ?? "",
    hasUserText: realUser.length > 0,
  };
}

/** 标题固定格式：`主题：进度`（中文全角冒号，只一个，两侧都非空且不过长）。 */
export const TITLE_PATTERN = /^(.{2,14})：(.{2,16})$/;

/**
 * 截断主题但**不制造半截话**：保留 `…`，并把尾部悬挂的助词（的/和/还/也…）一起去掉。
 *
 * 反例（实测）：本地兜底把 `区管家的更新和消耗显示还是不太好使` 硬切 12 字、
 * 又剥掉省略号 → 标题成了 `区管家的更新和消耗显示还：进行中`，读起来就是断的。
 */
function clipTopic(raw: string, max: number): string {
  const clipped = cleanLine(raw, max);
  if (!clipped.endsWith("…")) return clipped;
  const trimmed = clipped.replace(/[的了和与或是在为对把被还也再又]+…$/, "…");
  return trimmed === "…" ? clipped : trimmed;
}

/** 只保留冒号前后的合理长度，并统一成全角冒号（模型偶尔会写半角 `:`）。 */
export function normalizeTitle(raw: string): string {
  const t = String(raw ?? "")
    .replace(/\s+/g, "")
    .replace(/^["“「]|["”」]$/g, "")
    .replace(/[:﹕]/g, "：")
    .trim();
  const m = t.match(/^(.+?)：(.+)$/);
  if (!m) return clipTopic(t, 18);
  const topic = clipTopic(m[1], 12);
  const progress = cleanLine(m[2], 14);
  return `${topic}：${progress}`;
}

/** 标题是否已是 `主题：进度` 形状。 */
export function isFormattedTitle(title: string): boolean {
  return TITLE_PATTERN.test(normalizeTitle(title));
}

/**
 * 不依赖模型的兜底：直接用会话自己的首末发言描述"这个对话在做什么"。
 *
 *  - brief = 首末不同则 `从「目标」到「当前」`（≤56 字），否则就是最后这一条；
 *  - title = `主题：进度` 形状 —— 主题取最后一条实质发言的首个短句（≤12 字），
 *    进度在无模型时没有可靠信息，统一写「进行中」（**不编造**）。
 * 宁可粗糙，也要**每个会话各不相同**；不再退回"你是谁"或项目记忆小节标题。
 */
export function localMetaFromConversation(digest: {
  firstUser: string;
  lastUser: string;
}): { title: string; brief: string } {
  const first = cleanLine(digest.firstUser, 26);
  const last = cleanLine(digest.lastUser, 26);
  let brief: string;
  if (first && last && first !== last) brief = `从「${first}」到「${last}」`;
  else brief = cleanLine(digest.lastUser || digest.firstUser, 56);
  // 主题保留 `…`（截断就是截断，别装成完整句子），并去掉尾部悬挂的助词。
  const topic = clipTopic(titleLine(digest.lastUser || digest.firstUser, 12), 12);
  const title = normalizeTitle(`${topic || "对话"}：进行中`);
  return { title, brief };
}

/** 把不带格式的标题（如本地兜底或模型跑偏）修成 `主题：进度`。 */
export function coerceTitle(title: string, brief: string): string {
  const normalized = normalizeTitle(title);
  if (TITLE_PATTERN.test(normalized)) return normalized;
  // 主题优先取标题本身（截断），否则取简介的首个短句。
  const topic = clipTopic(normalized || titleLine(brief, 12), 12);
  return normalizeTitle(`${topic || "对话"}：进行中`);
}

/**
 * 从 live session 或持久化日志中读取会话消息。
 *
 * 两条路：
 *  1) 宿主内存里的 live session（`ctx.sessions.get(id)`）——GUI 正在用的那份，最快；
 *  2) 持久化日志——走 `ctx.sessionPersistence.open(id, "read")` → `handle.read()`。
 *     ⚠️ 旧代码用的是 `persistence.inspect(id)`，**这个方法在 dsh 0.1.5 里根本不存在**
 *     （SessionPersistence 的 API 是 create/open/stat/list + SessionHandle），
 *     于是 `if (persistence?.inspect)` 静默跳过、永远读到空消息 ——
 *     "重新总结"因此一直回落到"第一条用户消息或会话 id"这种占位值。
 *
 * 服务访问与读日志都包 try/catch：cordis 的 ctx 是 Proxy，未在 inject 声明的服务属性访问
 * 会直接抛 `cannot get property "X" without inject`（宿主 inject 已声明，这里再兜一层，
 * 保证按钮不会因为服务解析问题变成 500 报错）。
 */
export async function getSessionMessages(ctx: any, sessionId: string): Promise<ChatMessage[]> {
  try {
    const live = ctx?.sessions?.get?.(sessionId);
    if (live?.deriveMessages) {
      return live
        .deriveMessages()
        .map((m: any) => ({ role: m.role, text: textFromContent(m.content) }));
    }
    const persistence = ctx?.sessionPersistence;
    if (persistence?.open) {
      const handle = await persistence.open(sessionId, "read");
      try {
        const { events } = await handle.read();
        return events
          .filter((e: any) => e.type === "user/message" || e.type === "assistant/message")
          .map((e: any) => ({
            role: e.data?.role ?? (e.type === "user/message" ? "user" : "assistant"),
            text: textFromContent(e.data?.content),
          }));
      } finally {
        await handle.close?.();
      }
    }
  } catch (err) {
    console.warn("[dsh-myagent] cannot read session messages", err);
  }
  return [];
}

/**
 * 从 live session 或持久化日志中读取会话的工作目录（用于定位项目记忆 md）。
 * 持久化路径直接用 `handle.header.cwd`（比翻 `session` 事件更直接）。
 */
export async function getSessionCwd(ctx: any, sessionId: string): Promise<string | null> {
  try {
    const live = ctx?.sessions?.get?.(sessionId);
    if (live?.session?.cwd && typeof live.session.cwd === "string") return live.session.cwd;
    const persistence = ctx?.sessionPersistence;
    if (persistence?.open) {
      const handle = await persistence.open(sessionId, "read");
      try {
        if (typeof handle.header?.cwd === "string" && handle.header.cwd !== "") return handle.header.cwd;
        const { events } = await handle.read();
        const sessionEvent = events.find((e: any) => e.type === "session");
        if (sessionEvent?.data?.cwd && typeof sessionEvent.data.cwd === "string") return sessionEvent.data.cwd;
      } finally {
        await handle.close?.();
      }
    }
  } catch (err) {
    console.warn("[dsh-myagent] cannot read session cwd", err);
  }
  return null;
}

/**
 * 一次会话摘要的结果与来源。`source` 只用于排查（按钮 UI 不显示它）。
 */
export interface SessionMeta {
  /** 固定格式 `主题：进度`。 */
  title: string;
  brief: string;
  /** `agent`：模型概括（首选）；`local`：模型不可用时用会话首末发言本地兜底。 */
  source: "agent" | "local";
}

/**
 * 概括"这个对话在做什么工作"，返回 `{title: "主题：进度", brief}`。
 *
 * 这是「重新总结命名」「重新总结简介」「一键更新全部对话」三个入口的**唯一**实现：
 *  - 主料 = 会话自身内容（首尾采样）→ 模型概括（两种策略见 `strategy`）；
 *  - 模型不可用/超时/答非所问 → `localMetaFromConversation` 兜底（标题仍是 `主题：进度`）；
 *  - 会话里没有任何实质用户发言（空会话）→ 报错让调用方跳过。
 *
 * 无论走哪条路，标题都会被 `coerceTitle` 校正成 `主题：进度` 形状。
 */
export async function summarizeSessionMeta(
  ctx: any,
  sessionId: string,
  options: {
    useModel?: boolean;
    signal?: AbortSignal;
    /**
     * `"one-step"`（默认）：一次请求同时产出 brief 与 title（JSON 里 **brief 在前、title 在后**，
     * 靠提示词约束模型"先写简介、再依据简介写标题"）。「一键更新全部对话」批量走这条 ——
     * 条数多，翻倍请求的延迟与失败面不可接受。
     *
     * `"two-step"`：先**单独**请求简介，再**带着那句已经落定的简介**请求标题。
     * 单会话的两个按钮走这条（用户定案）：标题基于一个已产出的简介再写，质量更稳，
     * 代价是多一次请求。
     */
    strategy?: "one-step" | "two-step";
    /**
     * two-step 下需要哪些字段。`"brief"` 会**省掉标题那一次请求** ——
     * 点了「重新总结简介」不该为一个马上会被丢弃的字段白花一次调用。
     */
    want?: "brief" | "title" | "both";
  } = {},
): Promise<SessionMeta> {
  const { useModel = true, signal, strategy = "one-step", want = "both" } = options;
  const digest = await collectDigest(ctx, sessionId);
  const local = digest.hasUserText ? localMetaFromConversation(digest) : null;

  if (useModel && digest.hasUserText) {
    const input = { projectName: digest.projectName, transcript: digest.transcript };
    try {
      let meta: { title?: string; brief?: string };
      if (strategy === "two-step") {
        const brief = await requestConversationBrief(ctx, input, signal);
        let title = "";
        if (want !== "brief") {
          try {
            title = await requestTitleFromBrief(ctx, brief, signal);
          } catch (err) {
            // 标题那一步失败**不能**把已经拿到的简介一起丢掉 —— 一步版当年的注释里就记过这个坑
            // （标题步超时 → 整条退化成没信息量的标题）。这里让简介活下来，标题走本地兜底。
            console.warn("[dsh-myagent] title step failed; keeping the brief, falling back on title", err);
          }
        }
        meta = { brief, title };
      } else {
        meta = await requestConversationMeta(ctx, input, signal);
      }
      // 模型只答一半时，缺的字段用本地提取补齐（而不是整条丢弃）。
      const brief = meta.brief || local?.brief || "";
      const title = coerceTitle(meta.title || local?.title || "", brief);
      if (title || brief) return { title, brief, source: "agent" };
      console.warn("[dsh-myagent] conversation summarizer returned nothing; using local meta");
    } catch (err) {
      // 静默回落很难排查（"总结没生效"与"模型没答"看起来一样），至少留一条告警。
      console.warn("[dsh-myagent] conversation summarizer failed; using local meta", err);
    }
  }

  if (local) return { ...local, source: "local" };

  // 会话里**没有任何实质用户发言**（刚建的空会话、或只有 preset 注入的"你是谁"）：
  // 报错让调用方跳过它，**不要**拿项目记忆的小节标题去顶 ——
  // 那是"项目最近做了什么"，不是"这个对话在做什么"，实测会把空会话改名成
  // `（续）总结第二修：真根因是管家没有pr`（记忆标题被 24 字硬切）这种噪音。
  throw new Error(`session ${sessionId} has no summarizable content (没有实质用户发言 / 读不到消息)`);
}

/**
 * 重新总结单个会话的标题和/或简介（「重新总结命名」/「重新总结简介」两个按钮）。
 *
 * 走**两步版**（用户定案）：先单独请求简介，再带着那句已落定的简介请求标题 ——
 * `主题：进度` 的"进度"只能从简介里得到，先让简介定下来标题质量更稳，代价是多一次请求。
 * 只点「重新总结简介」时 `want="brief"`，会省掉标题那一次请求（不白花一次调用）。
 *
 * ⚠️ 时间预算不变量：两步是**串行**的，两次请求各自的超时是 15s（简介）+ 12s（标题）= 27s，
 * 必须留在 `/api/myagent/session/resummarize` 路由的 30s 之内。改任一处超时都要一起核对。
 */
export async function resummarizeSession(
  ctx: any,
  sessionId: string,
  mode: "title" | "brief" | "both",
  signal?: AbortSignal,
): Promise<{ title?: string; brief?: string }> {
  const meta = await summarizeSessionMeta(ctx, sessionId, {
    useModel: true,
    signal,
    strategy: "two-step",
    want: mode,
  });
  const result: { title?: string; brief?: string } = {};
  if ((mode === "title" || mode === "both") && meta.title) result.title = meta.title;
  if ((mode === "brief" || mode === "both") && meta.brief) result.brief = meta.brief;
  return result;
}

/**
 * 统计真实用户消息数；达到 4 次后生成简介（新会话自动简介）。
 *
 * 门槛（4 次真实交互）仍按会话流水统计——那衡量的是"这个会话聊得够不够多"；
 * 简介本身与两个按钮同源（会话内容 → 模型 → 本地兜底）。
 */
export async function summarizeSession(
  ctx: any,
  sessionId: string,
  signal?: AbortSignal,
): Promise<{ ready: boolean; brief?: string; count: number }> {
  const messages = await getSessionMessages(ctx, sessionId);
  const realUser = messages.filter((m) => m.role === "user" && isRealUserText(m.text));
  if (realUser.length < 4) return { ready: false, count: realUser.length };
  const meta = await summarizeSessionMeta(ctx, sessionId, { useModel: true, signal });
  return meta.brief
    ? { ready: true, brief: meta.brief, count: realUser.length }
    : { ready: false, count: realUser.length };
}

// src/resummarize-all.ts — 区管家：一次性更新「有新对话的会话」。
//
// 语义（用户定案）：区管家的作用是**一次性更新全部有新对话的对话框** ——
// 即只重算"自上次总结之后又聊过"的会话，没动过的不碰（省时间也省 token）。
//
// "有没有新对话"由宿主用 `sessionPersistence.stat()` 的稳定标记判定：
//   marker = `ev:<事件数>`（首选；JSONL 后端能廉价给出）→ `sz:<字节数>` → `rev:<不透明版本>`
// 客户端把上次总结时拿到的 marker 存进 annotations.json，下次带来比较，
// 不相等（或从未总结过、拿不到 marker）就算"有新对话"。ev/sz 跨 dsh 重启依然可比。
//
// 另外多一层**时间预算**：客户端一次把所有可见会话发过来、一个请求里等全部结果，
// 路由预算是 60s。实测单次模型概括 ≈1.7s（deepseek-flash、不带 reasoningEffort），
// 一旦累计超过预算（默认 45s），剩下的会话立刻降级为本地提取。
import { summarizeSessionMeta } from "./session-summary.ts";
import { organizerInfo } from "./organizer-agent.ts";

export interface ResummarizeAllUpdate {
  sessionId: string;
  title?: string;
  brief?: string;
  skipped?: boolean;
  /** 本次会话"没有新对话"（marker 未变）→ 未重新总结。 */
  unchanged?: boolean;
  /** 这次标题/简介是模型给的还是本地提取的（排查用；一次批量里可能两种都有）。 */
  source?: "agent" | "local" | "memory";
  /** 本次快照的 marker，客户端存回去，作为下次"有没有新对话"的判据。 */
  marker?: string;
}

/** 一次批量的整体统计（区管家面板直接显示）。 */
export interface ResummarizeAllSummary {
  checked: number;
  updated: number;
  unchanged: number;
  skipped: number;
  agent: number;
  local: number;
  elapsedMs: number;
}

/** 单个会话至少要有这么多剩余预算才值得再发一次模型请求。 */
const MIN_MODEL_BUDGET_MS = 1500;

/**
 * 会话的持久化标记：优先事件数（跨重启稳定、语义清楚），其次字节数。
 * 拿不到时返回 null（调用方当作"无法判定"→ 保守地认为有变化）。
 */
export async function sessionMarker(ctx: any, sessionId: string): Promise<string | null> {
  try {
    const persistence = ctx?.sessionPersistence;
    if (!persistence?.stat) return null;
    const snapshot = await persistence.stat(sessionId);
    if (!snapshot) return null;
    if (typeof snapshot.eventCount === "number") return `ev:${snapshot.eventCount}`;
    if (typeof snapshot.sizeBytes === "number") return `sz:${snapshot.sizeBytes}`;
    if (snapshot.revision !== undefined && snapshot.revision !== null) return `rev:${String(snapshot.revision)}`;
  } catch (err) {
    console.warn("[dsh-myagent] session stat failed", sessionId, err);
  }
  return null;
}

export async function resummarizeAllSessions(
  ctx: any,
  sessions: Array<{ id: string; marker?: string | null }>,
  signal?: AbortSignal,
  options: { useModel?: boolean; budgetMs?: number; onlyChanged?: boolean } = {},
): Promise<{
  updates: ResummarizeAllUpdate[];
  summary: ResummarizeAllSummary;
  agent: ReturnType<typeof organizerInfo>;
}> {
  const useModel = options.useModel ?? true;
  const onlyChanged = options.onlyChanged ?? true;
  const budgetMs = options.budgetMs ?? 45000;
  const startedAt = Date.now();
  const updates: ResummarizeAllUpdate[] = [];
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let agentCount = 0;
  let localCount = 0;

  for (const session of sessions) {
    // marker 在 catch 里也要用（跳过时同样要回报它），所以在 try 外面声明。
    let marker: string | null = null;
    try {
      marker = await sessionMarker(ctx, session.id);
      // marker 拿不到（stat 不可用）时按"有变化"处理，宁可多总结一次也不要漏掉新对话。
      const isUnchanged =
        onlyChanged && marker !== null && session.marker != null && session.marker === marker;
      if (isUnchanged) {
        unchanged += 1;
        updates.push({ sessionId: session.id, unchanged: true, marker: marker ?? undefined });
        continue;
      }
      const remaining = budgetMs - (Date.now() - startedAt);
      // 预算用完（或调用方显式关掉模型）→ 本地提取，快且确定。
      const wantsModel = useModel && remaining > MIN_MODEL_BUDGET_MS && !signal?.aborted;
      // 批量走"一步版"（一次请求同时给简介与标题），把每会话的往返压到 1 次。
      const meta = await summarizeSessionMeta(ctx, session.id, {
        useModel: wantsModel,
        signal,
      });
      if (meta.source === "agent") agentCount += 1;
      else localCount += 1;
      updated += 1;
      updates.push({
        sessionId: session.id,
        title: meta.title,
        brief: meta.brief,
        source: meta.source,
        marker: marker ?? undefined,
      });
    } catch (err) {
      // "没有可总结的内容"是**预期**情况（空会话 / 只有 preset 注入的"你是谁"），静默跳过；
      // 其他异常才值得留一条告警。
      if (!/no summarizable content/.test(String((err as Error)?.message ?? err))) {
        console.warn("[dsh-myagent] resummarize-all skipped a session", session.id, err);
      }
      skipped += 1;
      // **跳过的会话也要回报 marker**：它记的是"这个版本已经看过、不用再总结"，
      // 客户端存下来之后，这条会话在下次一键更新里就不会再被算成"有新对话"——
      // 否则空会话永远没有 marker，面板会一直显示"N 条有新对话"、按钮一直可点。
      updates.push({ sessionId: session.id, skipped: true, marker: marker ?? undefined });
    }
  }

  return {
    updates,
    summary: {
      checked: sessions.length,
      updated,
      unchanged,
      skipped,
      agent: agentCount,
      local: localCount,
      elapsedMs: Date.now() - startedAt,
    },
    agent: organizerInfo(),
  };
}

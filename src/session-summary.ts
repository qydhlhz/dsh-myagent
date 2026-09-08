// src/session-summary.ts — 宿主半区：读取会话内容，统计真实用户交互次数，并生成一句话简介。
import { requestSessionSummary, requestSessionTitle } from "./organizer-agent.js";

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

function isRealUserText(text: string): boolean {
  return !/Workspace instruction files exist|AGENTS\.md|<system-reminder>|Current runtime context|The approval policy changed/.test(text);
}

/** 从 live session 或持久化存储中读取会话消息。 */
export async function getSessionMessages(ctx: any, sessionId: string): Promise<ChatMessage[]> {
  const live = ctx?.sessions?.get?.(sessionId);
  if (live?.deriveMessages) {
    return live
      .deriveMessages()
      .map((m: any) => ({ role: m.role, text: textFromContent(m.content) }));
  }
  const persistence = ctx?.sessionPersistence;
  if (persistence?.inspect) {
    const { events } = await persistence.inspect(sessionId);
    return events
      .filter((e: any) => e.type === "user/message" || e.type === "assistant/message")
      .map((e: any) => ({
        role: e.data?.role ?? (e.type === "user/message" ? "user" : "assistant"),
        text: textFromContent(e.data?.content),
      }));
  }
  return [];
}

/** 从 live session 或持久化存储中读取会话的工作目录（用于定位项目记忆 md）。 */
export async function getSessionCwd(ctx: any, sessionId: string): Promise<string | null> {
  const live = ctx?.sessions?.get?.(sessionId);
  if (live?.session?.cwd && typeof live.session.cwd === "string") return live.session.cwd;
  const persistence = ctx?.sessionPersistence;
  if (persistence?.inspect) {
    const { events } = await persistence.inspect(sessionId);
    const sessionEvent = events.find((e: any) => e.type === "session");
    if (sessionEvent?.data?.cwd && typeof sessionEvent.data.cwd === "string") return sessionEvent.data.cwd;
  }
  return null;
}

/** 重新总结单个会话的标题和/或简介（基于会话内容，不读记忆 md）。 */
export async function resummarizeSession(
  ctx: any,
  sessionId: string,
  mode: "title" | "brief" | "both",
  signal?: AbortSignal,
): Promise<{ title?: string; brief?: string }> {
  const messages = await getSessionMessages(ctx, sessionId);
  const realUser = messages.filter((m) => m.role === "user" && isRealUserText(m.text));
  const result: { title?: string; brief?: string } = {};
  if (mode === "title" || mode === "both") {
    try {
      const title = await requestSessionTitle(ctx, sessionId, messages, signal);
      if (title) result.title = title;
    } catch {
      const first = realUser[0]?.text.replace(/\s+/g, " ").trim() ?? sessionId;
      result.title = first.length > 20 ? `${first.slice(0, 20)}…` : first;
    }
  }
  if (mode === "brief" || mode === "both") {
    try {
      const brief = await requestSessionSummary(ctx, sessionId, messages, signal);
      if (brief) result.brief = brief;
    } catch {
      const first = realUser[0]?.text.replace(/\s+/g, " ").trim() ?? "";
      result.brief = first.length > 60 ? `${first.slice(0, 60)}…` : first;
    }
  }
  return result;
}

/**
 * 统计真实用户消息数；达到 4 次后生成简介。
 * 优先用常驻整理员 agent 总结，失败时降级为第一条真实用户消息。
 */
export async function summarizeSession(
  ctx: any,
  sessionId: string,
  signal?: AbortSignal,
): Promise<{ ready: boolean; brief?: string; count: number }> {
  const messages = await getSessionMessages(ctx, sessionId);
  const realUser = messages.filter((m) => m.role === "user" && isRealUserText(m.text));
  if (realUser.length < 4) return { ready: false, count: realUser.length };
  try {
    const brief = await requestSessionSummary(ctx, sessionId, messages, signal);
    if (brief) return { ready: true, brief, count: realUser.length };
  } catch {
    // fall through to local fallback
  }
  const first = realUser[0].text.replace(/\s+/g, " ").trim();
  const brief = first.length > 60 ? `${first.slice(0, 60)}…` : first;
  return { ready: true, brief, count: realUser.length };
}

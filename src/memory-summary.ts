// src/memory-summary.ts — 沙盒管家“重新总结所有对话记录”：读取每个会话项目里的最后一次记忆 md。
import fs from "node:fs";
import path from "node:path";
import { requestMemoryMeta } from "./organizer-agent.js";
import { getSessionCwd } from "./session-summary.js";

function findMemoryMd(cwd: string): string | null {
  const candidates = [
    path.join(cwd, "Claude_memory.md"),
    path.join(cwd, "CLAUDE.md"),
    path.join(cwd, "memory.md"),
    path.join(cwd, "记忆.md"),
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    } catch {
      // ignore
    }
  }
  return null;
}

/** 读取项目记忆 md 的最后一个 `## ` 小节，作为“最后一次记忆”。 */
export function readLastMemorySection(cwd: string): string | null {
  const file = findMemoryMd(cwd);
  if (!file) return null;
  try {
    const text = fs.readFileSync(file, "utf8");
    const parts = text.split(/\n(?=## )/);
    const last = parts[parts.length - 1]?.trim() ?? "";
    return last.length > 0 ? last.slice(0, 3000) : null;
  } catch {
    return null;
  }
}

export interface MemoryResummarizeUpdate {
  sessionId: string;
  title?: string;
  brief?: string;
  skipped?: boolean;
}

/** 批量读取每个会话项目里的最后一次记忆 md，并让“管家”生成新的标题和简介。 */
export async function resummarizeAllFromMemory(
  ctx: any,
  sessions: Array<{ id: string }>,
  signal?: AbortSignal,
): Promise<MemoryResummarizeUpdate[]> {
  const updates: MemoryResummarizeUpdate[] = [];
  for (const session of sessions) {
    try {
      const cwd = await getSessionCwd(ctx, session.id);
      if (!cwd) {
        updates.push({ sessionId: session.id, skipped: true });
        continue;
      }
      const memory = readLastMemorySection(cwd);
      if (!memory) {
        updates.push({ sessionId: session.id, skipped: true });
        continue;
      }
      const meta = await requestMemoryMeta(ctx, memory, signal);
      updates.push({ sessionId: session.id, title: meta.title, brief: meta.brief });
    } catch {
      updates.push({ sessionId: session.id, skipped: true });
    }
  }
  return updates;
}

// src/client/api.ts — fetch 封装 + 错误归一化。root（工作区绝对路径）由调用方从
// 会话工作区取得（SidebarComposite 用 resolveRoot 推导）；宿主侧路由见 src/routes.ts。
import type { TreeEntry } from "./tree-utils.ts";

export interface ApiError {
  status: number;
  code: string;
  message: string;
}
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

const BASE = "/api/myagent";

export function describeApiError(e: ApiError): string {
  if (e.status === 404) return "文件或目录不存在";
  // 修正9：403 的两种来源文案区分——FS_SANDBOX_DENIED 是沙箱按 per-call policy 拒绝
  // （此前误导性显示"超出工作区范围"）；其余 403 才是白名单/根范围拒绝。
  if (e.status === 403 && e.code === "FS_SANDBOX_DENIED") return "当前会话沙箱不允许写入该位置";
  if (e.status === 403) return "超出工作区范围";
  if (e.status === 409 && (e.code === "FS_STALE_VERSION" || e.code === "CONFLICT")) return "文件已被修改，请重新加载后再保存";
  if (e.status === 409) return "目标已存在，请换个名字";
  if (e.status === 413) return "文件过大，仅提供下载";
  return `操作失败（${e.code ?? e.status}）`;
}

export interface TreeResult {
  name: string;
  path: string;
  entries: TreeEntry[];
}

export type PreviewKind = "text" | "image" | "pdf" | "audio" | "video" | "binary";

export interface ReadResult {
  path: string;
  kind: PreviewKind;
  mime: string;
  size: number;
  truncated: boolean;
  editable: boolean;
  content?: string;
  /** 读时的文件版本（dsh-fs 版本号，read 响应透传）；保存时回传做 CAS 防覆盖。 */
  version?: unknown;
}

export interface WriteResult {
  version: unknown;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: string;
  timedOut: boolean;
}

export class Api {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  private async req<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, init);
    } catch {
      return { ok: false, status: 0, code: "NETWORK", message: "网络错误" };
    }
    try {
      const text = await res.text();
      let body: any;
      try {
        body = JSON.parse(text);
      } catch {
        return {
          ok: false,
          status: res.status,
          code: "NOT_JSON",
          message: `响应不是 JSON：${text.slice(0, 200) || res.statusText}`,
        };
      }
      if (res.ok && body?.ok) return { ok: true, data: body.data as T };
      return {
        ok: false,
        status: body?.status ?? res.status,
        code: body?.code ?? "UNKNOWN",
        message: body?.message ?? res.statusText,
      };
    } catch {
      return { ok: false, status: res.status, code: "NOT_JSON", message: "响应不是 JSON" };
    }
  }

  tree(path: string): Promise<ApiResult<TreeResult>> {
    return this.req<TreeResult>(
      `/tree?root=${encodeURIComponent(this.root)}&path=${encodeURIComponent(path)}`);
  }

  read(path: string): Promise<ApiResult<ReadResult>> {
    return this.req<ReadResult>(
      `/read?root=${encodeURIComponent(this.root)}&path=${encodeURIComponent(path)}`);
  }

  /** 生成原始字节内联地址（仅用于 PDF/音视频等安全类型）。 */
  inlineHref(path: string): string {
    return `${BASE}/read?raw=1&inline=1&root=${encodeURIComponent(this.root)}&path=${encodeURIComponent(path)}`;
  }

  write(path: string, content: string, expectedVersion?: unknown): Promise<ApiResult<WriteResult>> {
    return this.req<WriteResult>("/write", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        root: this.root,
        path,
        content,
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      }),
    });
  }

  op(
    op: "mkdir" | "rename" | "remove" | "move",
    path: string,
    to?: string,
  ): Promise<ApiResult<Record<string, never>>> {
    return this.req<Record<string, never>>("/op", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: this.root, op, path, ...(to ? { to } : {}) }),
    });
  }

  /** 请求宿主侧“工作区整理员”生成整理建议；宿主不可用/失败时由调用方降级本地整理。 */
  /** 运行代码文件（当前文件必须已保存到磁盘）。 */
  run(path: string): Promise<ApiResult<RunResult>> {
    return this.req<RunResult>("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: this.root, path }),
    });
  }

  organizePlan(snapshot: unknown): Promise<ApiResult<{ plan: { actions: unknown[] }; source: string }>> {
    return this.req<{ plan: { actions: unknown[] }; source: string }>("/organize/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot }),
    });
  }

  /** 请求宿主根据会话内容生成一句话简介；未达到 4 次交互时返回 ready=false。 */
  sessionSummary(sessionId: string): Promise<ApiResult<{ ready: boolean; brief?: string; count: number }>> {
    return this.req<{ ready: boolean; brief?: string; count: number }>("/session/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
  }

  /** 重新总结单个会话的标题/简介。 */
  sessionResummarize(
    sessionId: string,
    mode: "title" | "brief" | "both",
  ): Promise<ApiResult<{ title?: string; brief?: string }>> {
    return this.req<{ title?: string; brief?: string }>("/session/resummarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, mode }),
    });
  }

  /**
   * 区管家：一次性更新「有新对话的会话」。
   *
   * 每项带 `marker`（上次总结时宿主给的持久化标记）：宿主只重新总结 marker 变了的会话，
   * 没新内容的原样返回 `unchanged: true`。响应里还有 `summary`（检查/更新/未变/跳过计数）
   * 与 `agent`（管家上下文与 token 用量）。
   *
   * ⚠️ 客户端**按小块**反复调用它（见 WorkspaceBrowser 的 CHUNK 逻辑）：几十条会话
   * 逐个走模型远超单个请求的预算，分块才能既看到进度又不撞路由超时。
   */
  resummarizeAll(sessions: Array<{ id: string; marker?: string | null }>): Promise<
    ApiResult<{
      updates: Array<{
        sessionId: string;
        title?: string;
        brief?: string;
        skipped?: boolean;
        unchanged?: boolean;
        source?: string;
        marker?: string;
      }>;
      summary?: OrganizerRunSummary;
      agent?: OrganizerAgentInfo;
    }>
  > {
    return this.req("/organize/resummarize-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions }),
    });
  }

  /** 区管家面板：管家是谁（模型/会话）+ 消耗用量 + 各会话当前 marker。 */
  organizerStatus(sessions: Array<{ id: string }>): Promise<
    ApiResult<{ agent: OrganizerAgentInfo; usage: OrganizerUsage | null; sessions: Array<{ id: string; marker: string | null }> }>
  > {
    return this.req("/organizer/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions }),
    });
  }
}

/** 一次区管家批量更新的计数（面板直接显示）。 */
export interface OrganizerRunSummary {
  checked: number;
  updated: number;
  unchanged: number;
  skipped: number;
  agent: number;
  local: number;
  elapsedMs: number;
}

/**
 * 管家的**真实**用量（宿主从管家会话日志里汇总，跨 dsh 重启依然有效）。
 * `contextTokens` = 最近一次请求实际处理的提示词规模（input + cacheRead）。
 */
export interface OrganizerUsage {
  requests: number;
  contextTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  sessionBytes: number | null;
}

/** 管家 agent 的运行信息：模型 / 会话 / 上下文预算 / 本次启动的计数。 */
export interface OrganizerAgentInfo {
  ready: boolean;
  provider: string;
  model: string;
  sessionId: string;
  requests: number;
  contextTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalReasoningTokens: number;
  lastRequestAt: string | null;
  rotations: number;
  contextBudgetTokens: number;
  /**
   * 分区建议专用 agent（planner）。管家被拆成两个 agent：命名/简介用 butler（不额外思考，
   * 要快），分区建议用 planner（开推理 —— 用户定案「分区策略也得是模型思考后的」）。
   * 两者是两个会话，各占自己的上下文。
   */
  planner?: {
    ready: boolean;
    /** 实际生效的推理档；null = 用户默认模型选择里没有档位。 */
    reasoningEffort: string | null;
    sessionId: string;
    requests: number;
    contextTokens: number;
    totalReasoningTokens: number;
    contextBudgetTokens: number;
  };
}


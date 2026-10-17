// src/llm-api.ts — 区管家的**独立 API 通道**（不走 dsh 的 agent / 不占用户默认模型额度）。
//
// 用户定案（2026-10-03）：「用这个独立的 api 吧」—— 管家用自己的 key 直连 DeepSeek 官方 API，
// 与主对话所用模型、额度、provider 配置完全解耦。
//
// 【实测得来的两条硬事实（.cache/probe-deepseek*.mjs）】
//  1. `deepseek-flash` 在官方 API 上是**推理模型**：默认 effort=high，
//     `max_tokens` 给小了（如 200）会把额度全烧在 reasoning 上、`content` 直接是空字符串。
//     实测 `max_tokens=1024` → 正常给出正文（reasoning ≈ 830～920 tokens）。
//     因此默认 max_tokens=2048，并在"正文为空且额度用尽"时**自动加倍重试一次**。
//  2. 单次调用 ≈4.2s（含推理）。管家用它做逐条命名是够的：客户端按 6 条一块发送。
//
// 【为什么直连而不是配一个 dsh provider】直连与 dsh 的 provider/模型配置、agent 会话、
// 上下文轮换全部无关 —— 管家是个无状态的后台工具，越少依赖越不容易坏。
// 没配 key 时仍回退到原来的 agent 通道（见 organizer-agent.ts 的 askSlot）。
export interface OrganizerApiConfig {
  /** 形如 `https://api.deepseek.com`（末尾斜杠会被去掉）。 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 单次生成的 token 上限（含推理）；太小会导致正文为空。 */
  maxTokens: number;
  timeoutMs: number;
}

/** 只放 key 的最小配置：写进 `$DSH_HOME/.env`，不进仓库、不进 profile。 */
export const ORGANIZER_API_KEY_ENV = "DSH_MYAGENT_ORGANIZER_API_KEY";
export const ORGANIZER_API_BASE_ENV = "DSH_MYAGENT_ORGANIZER_API_URL";
export const ORGANIZER_API_MODEL_ENV = "DSH_MYAGENT_ORGANIZER_API_MODEL";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-flash";
/** ≥1024：低于这个数推理模型会把额度烧在思维链上、正文为空（实测）。 */
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * 解析独立 API 配置。优先级：插件行 config.organizerApi > 环境变量。
 * 没有 key 时返回 null（调用方回退到 dsh agent 通道）。
 */
export function resolveOrganizerApi(config: any, env: Record<string, string | undefined> = process.env): OrganizerApiConfig | null {
  const c = (config?.organizerApi ?? {}) as Record<string, unknown>;
  const pick = (fromConfig: unknown, envKey: string): string | undefined => {
    const value = typeof fromConfig === "string" && fromConfig.trim() !== "" ? fromConfig.trim() : undefined;
    const fromEnv = env[envKey];
    return value ?? (typeof fromEnv === "string" && fromEnv.trim() !== "" ? fromEnv.trim() : undefined);
  };
  const apiKey = pick(c.apiKey, ORGANIZER_API_KEY_ENV);
  if (!apiKey) return null;
  const num = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    baseUrl: (pick(c.baseUrl, ORGANIZER_API_BASE_ENV) ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    apiKey,
    model: pick(c.model, ORGANIZER_API_MODEL_ENV) ?? DEFAULT_MODEL,
    maxTokens: num(c.maxTokens, DEFAULT_MAX_TOKENS),
    timeoutMs: num(c.timeoutMs, DEFAULT_TIMEOUT_MS),
  };
}

/** 与 dsh 的 usage 同形状，`noteUsage` 可以直接吃。 */
export interface ApiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}

export interface ApiReply {
  text: string;
  usage: ApiUsage;
  model: string;
  elapsedMs: number;
  /** 是否因"正文为空"而加倍 max_tokens 重试过。 */
  retried: boolean;
}

function emptyUsage(): ApiUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0 };
}

function addUsage(into: ApiUsage, raw: any): void {
  if (!raw || typeof raw !== "object") return;
  into.inputTokens += Number(raw.prompt_tokens ?? 0);
  into.outputTokens += Number(raw.completion_tokens ?? 0);
  into.cacheReadTokens += Number(raw.prompt_cache_hit_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? 0);
  into.reasoningTokens += Number(raw.completion_tokens_details?.reasoning_tokens ?? 0);
}

/** 单次 HTTP 调用；返回原始响应体（非 200 时抛错，错误里带上 body 片段便于排查）。 */
async function postChat(
  cfg: OrganizerApiConfig,
  prompt: string,
  maxTokens: number,
  options: { system?: string; json?: boolean; signal?: AbortSignal } = {},
): Promise<any> {
  const signal = options.signal;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`独立 API 超时（${cfg.timeoutMs}ms）`));
  }, cfg.timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const messages: Array<{ role: string; content: string }> = [];
    // **必须带上 system**：agent 通道里 system prompt 是单独一段；直连时如果只发 user，
    // 模型会跑偏 —— 实测被明确要求"只输出 JSON"却回了一整段带 `**` 的项目介绍。
    if (options.system) messages.push({ role: "system", content: options.system });
    messages.push({ role: "user", content: prompt });
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        max_tokens: maxTokens,
        // JSON 模式：要求 JSON 的提示词都开，省掉"模型多写一段解释"的解析风险。
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // 注意：不要把 key 写进任何错误信息。
      throw new Error(`独立 API 返回 ${res.status}：${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`独立 API 返回的不是 JSON：${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

/**
 * 用独立 API 跑一段提示词，返回正文与用量。
 *
 * @param cfg 独立 API 配置（见 `resolveOrganizerApi`）
 * @param prompt 完整提示词（管家所有请求都是自包含的）
 * @param options `system` = 角色约定（与 agent 通道共用同一份）；`json` = 打开 JSON 模式
 */
export async function chatCompletion(
  cfg: OrganizerApiConfig,
  prompt: string,
  options: { system?: string; json?: boolean; signal?: AbortSignal } = {},
): Promise<ApiReply> {
  const startedAt = Date.now();
  const usage = emptyUsage();
  let maxTokens = cfg.maxTokens;
  let retried = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = await postChat(cfg, prompt, maxTokens, options);
    addUsage(usage, body?.usage);
    const message = body?.choices?.[0]?.message ?? {};
    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (content !== "") {
      return { text: content, usage, model: String(body?.model ?? cfg.model), elapsedMs: Date.now() - startedAt, retried };
    }
    // 正文为空：推理模型把额度全花在思维链上了 → 加倍额度重试一次（再多就不礼貌了）。
    if (attempt === 0 && maxTokens < 8192) {
      retried = true;
      maxTokens = Math.min(maxTokens * 2, 8192);
      continue;
    }
    const hint = usage.reasoningTokens > 0 ? `（推理 tokens ${usage.reasoningTokens}，额度 ${maxTokens}）` : "";
    throw new Error(`独立 API 返回了空正文${hint}：请提高 organizerApi.maxTokens`);
  }
  throw new Error("独立 API 两次都没有返回正文");
}

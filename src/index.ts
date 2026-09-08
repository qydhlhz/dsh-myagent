// src/index.ts — 宿主半区入口。根白名单：workspaceRegistry 动态解析的已注册工作沙盒路径
// ∪ config.allowedRoots ∪ dsh 启动目录。workspaceRegistry 的 init 是重异步，apply 时可能
// 尚未激活——若只探测一次，白名单会静默退化为静态集合，浏览器半区传入的已注册工作沙盒根
// 会被 403。因此改为动态解析：liveWorkspaceRoots 带 5s TTL 缓存，缓存为空时每请求重探，
// 服务一旦激活，下一次请求即能放行新注册的工作沙盒根。白名单在 createHandlers 层集中执行
// （query 与 body 的 root 都过 allowed 判定），这里不再包一层。
import { FileService } from "./service.js";
import { createHandlers, readBody, sendError, sendJson } from "./routes.js";
import { disposeOrganizerAgent, localOrganizerPlan, requestOrganizerPlan } from "./organizer-agent.js";
import { resummarizeSession, summarizeSession } from "./session-summary.js";
import { resummarizeAllFromMemory } from "./memory-summary.js";

const name = "myagent";
// 宿主侧没有 "workspaces" 服务（该服务名只存在于浏览器半区，dsh-client-runtime
// 提供）；宿主的工作沙盒服务叫 "workspaceRegistry"（dsh-workspace 提供）。两者都
// 不注入：liveWorkspaceRoots 用 lenient 探测 + try/catch 降级，保证激活不因该服务缺失而失败。
const inject = ["webServer", "fs"];

/** 根路径归一化：win32 大小写不敏感（toLowerCase）+ 去掉尾部 / 与 \。加入与判定都过同一 norm。 */
function norm(root: string): string {
  let r = root.replace(/[\\/]+$/, "");
  if (process.platform === "win32") r = r.toLowerCase();
  return r;
}

/** 静态集合：config.allowedRoots（Array.isArray 守卫，非数组按 [] 处理）∪ 启动目录；apply 时重建。 */
let staticRoots: Set<string> = new Set();

// liveWorkspaceRoots 的模块级缓存。TTL 5 秒；缓存为空（服务未激活 / 首次探测）时每次重探，
// 因此 workspaceRegistry 一旦激活，下一次请求即可命中新注册的工作沙盒根。
let lastProbe = 0;
let cached: Set<string> = new Set();
let warnShown = false;
let activeCtx: any = null;
const PROBE_TTL = 5000;

/** 动态解析 workspaceRegistry 的已注册工作沙盒根（只收 typeof w.path === "string" 的 path）。
 *  全程 try/catch：异常返回空集合（仅静态集合生效），console.warn 限频（同一错误只 warn 一次）。 */
function liveWorkspaceRoots(): Set<string> {
  const now = Date.now();
  if (cached.size > 0 && now - lastProbe < PROBE_TTL) return cached;
  try {
    const ws: any = activeCtx?.get?.("workspaceRegistry");
    const next = new Set<string>();
    for (const w of ws?.list?.() ?? []) {
      if (typeof w?.path === "string") next.add(norm(w.path));
    }
    cached = next;
    lastProbe = now;
    warnShown = false; // 探测恢复成功 → 允许下一次异常再次 warn（同一错误仍只 warn 一次）
  } catch (err) {
    if (!warnShown) {
      warnShown = true;
      console.warn("[dsh-myagent] workspaceRegistry unavailable; static roots only", err);
    }
    cached = new Set(); // 保持空 → 下次调用按"缓存为空"重探
  }
  return cached;
}

/** 白名单判定：静态集合或动态 workspace 根命中即放行（两侧元素都已过 norm）。 */
function allowed(root: string): boolean {
  const n = norm(root);
  return staticRoots.has(n) || liveWorkspaceRoots().has(n);
}

function apply(ctx: any, config: any) {
  activeCtx = ctx;
  staticRoots = new Set<string>();
  if (Array.isArray(config.allowedRoots)) {
    for (const r of config.allowedRoots) {
      if (typeof r === "string") staticRoots.add(norm(r));
    }
  }
  staticRoots.add(norm(process.cwd()));

  const service = new FileService(ctx.fs, undefined, {
    pythonPath: typeof config.pythonPath === "string" ? config.pythonPath : undefined,
    rscriptPath: typeof config.rscriptPath === "string" ? config.rscriptPath : undefined,
    nodePath: typeof config.nodePath === "string" ? config.nodePath : undefined,
    timeoutMs: typeof config.timeoutMs === "number" ? config.timeoutMs : undefined,
  });
  const handlers = createHandlers(service, config.trustedHosts ?? [], allowed);

  // ctx.effect 把注册挂到当前 fiber，fiber dispose 时自动注销（dsh 官方插件同款模式，
  // 见 dsh-client-connection / dsh-client-modules；比 ctx.on("dispose") 更稳）。
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: "/api/myagent/tree", handler: handlers.tree }));
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: "/api/myagent/read", handler: handlers.read }));
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: "/api/myagent/write", handler: handlers.write }));
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: "/api/myagent/op", handler: handlers.op }));
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: "/api/myagent/run", handler: handlers.run }));
  // 沙盒管家：客户端提交工作沙盒树+标注快照，宿主优先让常驻整理员 agent 生成建议，
  // agent 不可用时降级为本地确定性整理器。
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "prefix",
      path: "/api/myagent/organize/plan",
      handler: async (req: any, res: any) => {
        if (req.method !== "POST") {
          sendError(res, Object.assign(new Error("method not allowed"), { code: "METHOD_NOT_ALLOWED" }));
          return;
        }
        try {
          const body = await readBody(req);
          const snapshot = body?.snapshot;
          if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
            sendError(res, Object.assign(new Error("bad snapshot"), { code: "BAD_REQUEST" }));
            return;
          }
          try {
            // 整个 agent 请求加 15s 超时，避免 agents.create / whenIdle 悬挂导致前端一直“整理中”。
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            try {
              const result = await requestOrganizerPlan(ctx, snapshot as any, controller.signal);
              sendJson(res, 200, { ok: true, data: { plan: result.plan, source: result.source } });
            } finally {
              clearTimeout(timer);
            }
          } catch (err) {
            const plan = localOrganizerPlan(snapshot as any);
            sendJson(res, 200, { ok: true, data: { plan, source: "local" } });
          }
        } catch (err) {
          sendError(res, err);
        }
      },
    }),
  );

  // 新对话达到 4 次真实交互后，生成一句话简介。
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "prefix",
      path: "/api/myagent/session/summary",
      handler: async (req: any, res: any) => {
        if (req.method !== "POST") {
          sendError(res, Object.assign(new Error("method not allowed"), { code: "METHOD_NOT_ALLOWED" }));
          return;
        }
        try {
          const body = await readBody(req);
          const sessionId = body?.sessionId;
          if (typeof sessionId !== "string" || !sessionId) {
            sendError(res, Object.assign(new Error("bad sessionId"), { code: "BAD_REQUEST" }));
            return;
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          try {
            const result = await summarizeSession(ctx, sessionId, controller.signal);
            sendJson(res, 200, { ok: true, data: result });
          } finally {
            clearTimeout(timer);
          }
        } catch (err) {
          sendError(res, err);
        }
      },
    }),
  );

  // 重新总结单个会话的标题/简介。
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "prefix",
      path: "/api/myagent/session/resummarize",
      handler: async (req: any, res: any) => {
        if (req.method !== "POST") {
          sendError(res, Object.assign(new Error("method not allowed"), { code: "METHOD_NOT_ALLOWED" }));
          return;
        }
        try {
          const body = await readBody(req);
          const sessionId = body?.sessionId;
          const mode = body?.mode;
          if (typeof sessionId !== "string" || !sessionId || (mode !== "title" && mode !== "brief" && mode !== "both")) {
            sendError(res, Object.assign(new Error("bad sessionId/mode"), { code: "BAD_REQUEST" }));
            return;
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 20000);
          try {
            const result = await resummarizeSession(ctx, sessionId, mode, controller.signal);
            sendJson(res, 200, { ok: true, data: result });
          } finally {
            clearTimeout(timer);
          }
        } catch (err) {
          sendError(res, err);
        }
      },
    }),
  );

  // 重新总结所有对话记录：读取每个会话项目里的最后一次记忆 md，批量生成标题/简介。
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "prefix",
      path: "/api/myagent/organize/resummarize-all",
      handler: async (req: any, res: any) => {
        if (req.method !== "POST") {
          sendError(res, Object.assign(new Error("method not allowed"), { code: "METHOD_NOT_ALLOWED" }));
          return;
        }
        try {
          const body = await readBody(req);
          const sessions = body?.sessions;
          if (!Array.isArray(sessions) || sessions.some((s: any) => !s || typeof s.id !== "string")) {
            sendError(res, Object.assign(new Error("bad sessions"), { code: "BAD_REQUEST" }));
            return;
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60000);
          try {
            const updates = await resummarizeAllFromMemory(ctx, sessions, controller.signal);
            sendJson(res, 200, { ok: true, data: { updates } });
          } finally {
            clearTimeout(timer);
          }
        } catch (err) {
          sendError(res, err);
        }
      },
    }),
  );

  // 插件卸载时释放常驻整理员 agent。
  ctx.effect(() => () => {
    void disposeOrganizerAgent();
  });

  console.log("[dsh-myagent] host half loaded");
}
export { apply, inject, name };

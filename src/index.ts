// src/index.ts — 宿主半区入口。根白名单：workspaceRegistry 动态解析的已注册工作沙盒路径
// ∪ config.allowedRoots ∪ dsh 启动目录。workspaceRegistry 的 init 是重异步，apply 时可能
// 尚未激活——若只探测一次，白名单会静默退化为静态集合，浏览器半区传入的已注册工作沙盒根
// 会被 403。因此改为动态解析：liveWorkspaceRoots 带 5s TTL 缓存，缓存为空时每请求重探，
// 服务一旦激活，下一次请求即能放行新注册的工作沙盒根。白名单在 createHandlers 层集中执行
// （query 与 body 的 root 都过 allowed 判定），这里不再包一层。
import { FileService } from "./service.js";
import { createHandlers, readBody, sendError, sendJson } from "./routes.js";
import {
  disposeOrganizerAgent,
  prepareOrganizer,
  readOrganizerUsage,
  requestOrganizerPlan,
  setDefaultModelResolver,
} from "./organizer-agent.js";
import { resummarizeSession, summarizeSession } from "./session-summary.js";
import { resummarizeAllSessions, sessionMarker } from "./resummarize-all.js";

const name = "myagent";
// 宿主侧没有 "workspaces" 服务（该服务名只存在于浏览器半区，dsh-client-runtime
// 提供）；宿主的工作沙盒服务叫 "workspaceRegistry"（dsh-workspace 提供）。两者都
// 不注入：liveWorkspaceRoots 用 lenient 探测 + try/catch 降级，保证激活不因该服务缺失而失败。
//
// 【为什么必须声明 sessions / sessionPersistence / agents（2026-09-10 修复）】
// cordis 4 的 ctx 是 Proxy：**未在 inject 里声明的服务，属性访问会直接抛**
// `cannot get property "X" without inject`（cordis/lib/index.js 的 ReflectService.handler.get）。
// 代理只沿 fiber 链向上找服务，而 sessions 注册在兄弟 fiber（dsh-session 自己的 ctx）上，
// 不声明就永远解析不到 —— 于是「重新总结命名 / 重新总结简介」两个按钮报
// "重新总结失败：cannot get property "sessions" without inject"。
// 三个服务都来自 dsh-base 的核心行（session / session-persistence-jsonl / agent），
// 任何 profile 都在场，声明是安全的；插件也会等它们就绪后才激活。
const inject = ["webServer", "fs", "sessions", "sessionPersistence", "agents"];

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

  // 常驻整理员 agent 需要 provider/model —— 不传的话 dsh-agent-loop 每个 turn 直接抛
  // `agent "…" has no provider/model`，模型调用根本不发生（2026-09-12 找到的真根因）。
  // 用动态 inject 取 `agentDefaultModel`（官方 dsh-api-session-controller 同款用法），
  // **不写进本插件 inject**：该服务若缺席，本插件（含左栏文件树）会整个不激活。
  ctx.inject(["agentDefaultModel"], (scope: any) => {
    setDefaultModelResolver(() => scope.agentDefaultModel.currentSelection());
  });

  // ctx.effect 把注册挂到当前 fiber，fiber dispose 时自动注销（dsh 官方插件同款模式，
  // 见 dsh-client-connection / dsh-client-modules；比 ctx.on("dispose") 更稳）。
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: "/api/myagent/tree", handler: handlers.tree }));
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: "/api/myagent/read", handler: handlers.read }));
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: "/api/myagent/write", handler: handlers.write }));
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: "/api/myagent/op", handler: handlers.op }));
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: "/api/myagent/run", handler: handlers.run }));
  // 沙盒管家：客户端提交工作沙盒树+标注快照，**只由模型**产出整理建议。
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
          // 用户定案：「分区策略也得是模型思考后的」。所以这里**没有本地兜底** ——
          // 旧实现在模型失败/超时时回退 `localOrganizerPlan`（一套确定性规则，没有语义
          // 分区能力），返回的"整理建议"根本不是模型想的。现在模型拿不出计划就如实报错。
          //
          // 180s：planner 槽位开了推理（分区建议专用 agent），比命名慢得多；比它自己的
          // 150s 超时更长，好让那边先报出干净的错，而不是被这里拦腰掐断。
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 180000);
          try {
            const result = await requestOrganizerPlan(ctx, snapshot as any, controller.signal);
            sendJson(res, 200, { ok: true, data: { plan: result.plan, source: result.source } });
          } finally {
            clearTimeout(timer);
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
          const timer = setTimeout(() => controller.abort(), 30000);
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

  // 区管家：一次性更新「有新对话的会话」。
  //
  // 请求体的 sessions 每项形如 `{id, marker}`：marker 是**上次总结时**宿主给的持久化标记
  // （`ev:<事件数>` / `sz:<字节数>`），宿主比较当前 marker 判定"自上次之后有没有新对话"；
  // 只对变了的会话重新总结，没动过的原样返回 `unchanged: true`。
  // 响应同时带回 `summary`（检查/更新/未变/跳过计数）与 `agent`（管家上下文与 token 用量），
  // 供区管家面板显示 —— 面板永远有内容可显示，不会"点了没反应"。
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
          const onlyChanged = body?.onlyChanged !== false;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60000);
          try {
            const result = await resummarizeAllSessions(ctx, sessions, controller.signal, { onlyChanged });
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

  // 区管家面板需要的全部信息：管家是谁（模型/会话）、消耗了多少（token/上下文）、
  // 以及每个会话当前"有没有新对话"（marker 比较）。
  // 打开面板就调它 —— 面板一打开就有内容，不会显示"尚未启动 / 累计 0"这种空面板。
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "prefix",
      path: "/api/myagent/organizer/status",
      handler: async (req: any, res: any) => {
        if (req.method !== "POST") {
          sendError(res, Object.assign(new Error("method not allowed"), { code: "METHOD_NOT_ALLOWED" }));
          return;
        }
        try {
          const body = await readBody(req);
          const sessions = Array.isArray(body?.sessions) ? body.sessions : [];
          // 预热管家（只建会话 + 解析 provider/model，不发模型请求）。
          const agent = await prepareOrganizer(ctx);
          // 用量以**会话日志**为准（跨 dsh 重启仍然有效），日志还没有内容时退回内存计数。
          const usage = await readOrganizerUsage(ctx);
          const markers: Array<{ id: string; marker: string | null }> = [];
          for (const s of sessions) {
            if (!s || typeof s.id !== "string") continue;
            markers.push({ id: s.id, marker: await sessionMarker(ctx, s.id) });
          }
          sendJson(res, 200, { ok: true, data: { agent, usage, sessions: markers } });
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

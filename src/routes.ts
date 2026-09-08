// src/routes.ts — 纯 handler 工厂；错误码→HTTP 状态映射。
// 修正3：映射表补 ctx.fs 的结构化错误码（FS_*）——FS_STALE_VERSION→409 CONFLICT
// （编辑防覆盖守卫）、FS_TOO_LARGE→413、FS_PERMISSION_DENIED→403、FS_NOT_DIRECTORY→404。
// 修正5：FS_SANDBOX_DENIED→403；FS_NOT_TEXT / FS_NOT_REGULAR_FILE→422（语义错误
// 输入，422 比 500 正确）。
// 修正8（安全）+ 修正2（缺失/越权区分）：根白名单集中到 createHandlers —— tree/read 取
// query root，write/op 取 body root，都在 route() 派发前校验。顺序固定：root 缺失（query
// 无 root / body 无 root / body 非对象）→ 400 BAD_REQUEST（与 tree/read 缺失 root 的既有
// 语义一致）；root 存在但不在白名单 → 403 OUT_OF_ROOT。两种失败下 service 都不被调用。
// 白名单判定用 allowed(root) 谓词（index.ts 传入：静态集合 ∪ workspaceRegistry 动态根，
// 判定前先过 norm 归一化）。allowed 未传时跳过校验，行为与旧版完全一致。另补 node:fs
// 原生错误码 ENOENT→404 / EACCES→403（remove-on-missing 等此前裸 ENOENT 落成 500）。
// 注（类型）：createHandlers 参数用结构类型 ServiceLike（FileService 的方法子集）而非
// FileService 类本身——FileService 含 private fs（名义类型），测试注入的 FakeService
// 无法赋值；真实 FileService 结构上满足 ServiceLike，Task 5 组装时直接传入。
// 审查修复（下载端点/守卫）：read 的 raw=1 绕过 JSON 信封直接写回文件字节（precheck 门禁
// 复用，错误仍走 sendError）；route() 加方法白名单（405 METHOD_NOT_ALLOWED）；readBody
// 1MB 上限（413 TOO_LARGE）；EEXIST/ENOTEMPTY/EISDIR→409、EPERM→403（rename/move 撞已
// 存在目标不再 500）。
import { URL } from "node:url";
import { PDF_MAX_BYTES, AUDIO_MAX_BYTES, VIDEO_MAX_BYTES, sniff } from "./mime.ts";

export interface Handler {
  tree(req: any, res: any): Promise<void>;
  read(req: any, res: any): Promise<void>;
  write(req: any, res: any): Promise<void>;
  op(req: any, res: any): Promise<void>;
  run(req: any, res: any): Promise<void>;
}

/** FileService 的结构子集；remove 可选（FakeService 无 remove，走 service.op 退化）。 */
export interface ServiceLike {
  tree(root: string, rel: string): Promise<any>;
  read(root: string, rel: string): Promise<any>;
  /** 审查修复：raw 下载读——返回原始字节 + sniff 出的 mime，路由层直接写回响应。 */
  readRaw(root: string, rel: string, maxBytes?: number): Promise<{ mime: string; bytes: Uint8Array }>;
  write(root: string, rel: string, content: string, expectedVersion?: unknown): Promise<any>;
  op(root: string, op: string, rel: string, to?: string): Promise<any>;
  /** 运行代码文件：返回 { stdout, stderr, exitCode, signal?, timedOut }。 */
  run(root: string, rel: string): Promise<any>;
  remove?(root: string, rel: string): Promise<any>;
}

const CODE_STATUS: Record<string, number> = {
  OUT_OF_ROOT: 403,
  NOT_FOUND: 404,
  EXISTS: 409,
  CONFLICT: 409,
  TOO_LARGE: 413,
  BAD_REQUEST: 400,
  ROW_NOT_FOUND: 404,
  TOGGLE_LOCKED: 403,
  SELF_LOCKED: 403,
  UNTRUSTED_HOST: 403,
  // 审查修复：方法白名单——不匹配的方法 405。
  METHOD_NOT_ALLOWED: 405,
  // node:fs 原生错误码：remove-on-missing / mkdir 目标缺失等（此前裸 ENOENT 落成 500）。
  ENOENT: 404,
  EACCES: 403,
  // 审查修复：node:fs 其余常见错误码映射——权限（EPERM→403，与 EACCES 同级）；
  // rename/move 撞已存在目标（EEXIST/ENOTEMPTY/EISDIR→409，不再 500）。
  EPERM: 403,
  EEXIST: 409,
  ENOTEMPTY: 409,
  EISDIR: 409,
  FS_NOT_FOUND: 404,
  FS_NOT_DIRECTORY: 404,
  FS_TOO_LARGE: 413,
  FS_STALE_VERSION: 409,
  FS_PERMISSION_DENIED: 403,
  FS_SANDBOX_DENIED: 403,
  FS_NOT_TEXT: 422,
  FS_NOT_REGULAR_FILE: 422,
};

// 路由层自己校验 op 白名单：测试注入的 FakeService.op 不拒绝未知 op，
// 而 400 BAD_REQUEST 是 HTTP 契约的一部分（与 FileService.op 的 OP_ALLOW 一致，remove 除外）。
const OP_ALLOW = new Set(["mkdir", "rename", "move", "remove"]);

export function sendJson(res: any, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}
export function sendError(res: any, err: unknown) {
  const e = err as { code?: string; message?: string };
  const code = e.code ?? "INTERNAL";
  sendJson(res, CODE_STATUS[code] ?? 500, { ok: false, status: CODE_STATUS[code] ?? 500, code, message: e.message ?? String(err) });
}

// 审查修复：请求体上限 1MB——累计长度超限即拒绝（413 TOO_LARGE），超大 body 不再
// 整读进内存（此前无上限，恶意/误用 body 可打满内存）。
const BODY_MAX_BYTES = 1024 * 1024;

export async function readBody(req: any): Promise<any> {
  return req._body ?? new Promise((resolve, reject) => {
    let raw = "";
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > BODY_MAX_BYTES) {
        // 超限即拒绝；后续 data 不再累积（reject 幂等，promise 只 settle 一次）。
        req.removeAllListeners?.("data");
        reject(Object.assign(new Error("body too large"), { code: "TOO_LARGE" }));
        return;
      }
      raw += c.toString();
    });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

export function createHandlers(service: ServiceLike, trustedHosts?: string[], allowed?: (root: string) => boolean): Handler {
  const trust = trustedHosts && trustedHosts.length > 0 ? trustedHosts : null;

  function guard(req: any): boolean {
    if (!trust) return true;
    const host = req.headers?.host ?? "";
    return trust.some((t) => host === t || host.startsWith(t + ":"));
  }

  const q = (req: any) => new URL(req.url!, "http://x").searchParams;

  // 取本次请求的 root：kind === "query"（tree/read）从 URL 参数取；kind === "body"
  // （write/op）从已解析 body 取。body 只读一次并缓存到 req._body，handler 内复用
  // 同一份——流式 body 只消费一次，避免二次 readBody 挂起。
  async function rootFor(req: any, kind: "query" | "body"): Promise<string | null> {
    if (kind === "query") return q(req).get("root");
    const body = await readBody(req);
    req._body = body;
    return typeof body?.root === "string" ? body.root : null;
  }

  // 审查修复：抽出 route() 的前置校验（untrusted host / root 白名单）——raw 下载分支
  // 不套 sendJson 信封，但门禁必须与其余端点一致（root 缺失→400、越权→403，均错误信封）。
  async function precheck(req: any, res: any, kind: "query" | "body"): Promise<boolean> {
    if (!guard(req)) {
      sendError(res, Object.assign(new Error("untrusted host"), { code: "UNTRUSTED_HOST" }));
      return false;
    }
    try {
      // 白名单集中在此校验：query 与 body 的 root 都过这里。先判缺失（400 BAD_REQUEST），
      // 再判白名单（403 OUT_OF_ROOT）——service 在两种失败下都不会被调用。allowed 未传
      // 时跳过，行为与旧版完全一致（缺失字段由各 handler 自身按 BAD_REQUEST 兜底）。
      if (allowed) {
        const root = await rootFor(req, kind);
        if (!root) {
          sendError(res, Object.assign(new Error("missing root"), { code: "BAD_REQUEST" }));
          return false;
        }
        if (!allowed(root)) {
          sendError(res, Object.assign(new Error("root not allowed"), { code: "OUT_OF_ROOT" }));
          return false;
        }
      }
    } catch (err) {
      sendError(res, err);
      return false;
    }
    return true;
  }

  // 审查修复：methods 白名单——树/读只放行 GET、写只放行 PUT、op 只放行 POST；
  // 不匹配（含 method 缺失）→ 405 METHOD_NOT_ALLOWED，且不触发 service 调用。
  // 独立成函数：raw 下载分支绕过 route() 的 sendJson 包装，但方法白名单同样适用。
  function methodAllowed(req: any, methods?: string[]): boolean {
    return !methods || (!!req.method && methods.includes(req.method));
  }

  async function route(req: any, res: any, kind: "query" | "body", fn: () => Promise<unknown>, methods?: string[]) {
    if (!methodAllowed(req, methods))
      return sendError(res, Object.assign(new Error("method not allowed"), { code: "METHOD_NOT_ALLOWED" }));
    if (!(await precheck(req, res, kind))) return;
    try {
      sendJson(res, 200, { ok: true, data: await fn() });
    } catch (err) {
      sendError(res, err);
    }
  }

  return {
    async tree(req, res) {
      await route(req, res, "query", async () => {
        const root = q(req).get("root");
        const path = q(req).get("path");
        if (!root || path === null) throw Object.assign(new Error("missing root/path"), { code: "BAD_REQUEST" });
        return service.tree(root, path);
      }, ["GET"]);
    },
    async read(req, res) {
      // 审查修复（下载端点）：raw=1 时绕过 route() 的 sendJson 包装——service.readRaw
      // 返回原始字节，成功即直接写回响应（Content-Disposition 默认 attachment；
      // inline=1 且 sniff 为 pdf/audio/video 时 inline，浏览器导航即预览真实文件）；错误仍走
      // sendError 错误信封，不双写。方法白名单（GET-only）
      // 与门禁在此显式复检，与 route() 语义一致。
      if (q(req).get("raw") === "1") {
        if (!methodAllowed(req, ["GET"]))
          return sendError(res, Object.assign(new Error("method not allowed"), { code: "METHOD_NOT_ALLOWED" }));
        if (!(await precheck(req, res, "query"))) return;
        try {
          const root = q(req).get("root");
          const path = q(req).get("path");
          if (!root || path === null) throw Object.assign(new Error("missing root/path"), { code: "BAD_REQUEST" });
          const fileName = path.split("/").pop() ?? "file";
          const inline = q(req).get("inline") === "1";
          const { kind } = sniff(fileName);
          const inlineMax = inline
            ? kind === "pdf" ? PDF_MAX_BYTES
            : kind === "audio" ? AUDIO_MAX_BYTES
            : kind === "video" ? VIDEO_MAX_BYTES
            : undefined
            : undefined;
          const { mime, bytes } = await service.readRaw(root, path, inlineMax);
          res.statusCode = 200;
          res.setHeader("Content-Type", mime);
          res.setHeader("X-Content-Type-Options", "nosniff");
          const disposition = inline && (kind === "pdf" || kind === "audio" || kind === "video")
            ? "inline"
            : `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
          res.setHeader("Content-Disposition", disposition);
          res.end(Buffer.from(bytes));
        } catch (err) {
          sendError(res, err);
        }
        return;
      }
      await route(req, res, "query", async () => {
        const root = q(req).get("root");
        const path = q(req).get("path");
        if (!root || path === null) throw Object.assign(new Error("missing root/path"), { code: "BAD_REQUEST" });
        return service.read(root, path);
      }, ["GET"]);
    },
    async write(req, res) {
      await route(req, res, "body", async () => {
        const body = await readBody(req);
        // BAD_REQUEST 校验顺序不变：root/path/content 必须字符串；expectedVersion 可选。
        if (typeof body?.root !== "string" || typeof body?.path !== "string" || typeof body?.content !== "string")
          throw Object.assign(new Error("bad body"), { code: "BAD_REQUEST" });
        // Task 8 评审：body 可选 expectedVersion（string/number 才透传，缺失/其他类型→undefined
        // 走 service 无条件分支）；有则 service 以客户端读到的版本做 CAS（版本过期→409）。
        const expectedVersion =
          typeof body.expectedVersion === "string" || typeof body.expectedVersion === "number"
            ? body.expectedVersion
            : undefined;
        return service.write(body.root, body.path, body.content, expectedVersion);
      }, ["PUT"]);
    },
    async op(req, res) {
      await route(req, res, "body", async () => {
        const body = await readBody(req);
        if (typeof body?.root !== "string" || typeof body?.op !== "string" || typeof body?.path !== "string")
          throw Object.assign(new Error("bad body"), { code: "BAD_REQUEST" });
        if (!OP_ALLOW.has(body.op)) throw Object.assign(new Error("bad op"), { code: "BAD_REQUEST" });
        // 修正6：仅需要目的地的 op（rename/move）要求字符串 to——缺失与类型错误（如数字）
        // 都 400，避免非字符串 to 一路漏到 service/renameSync 变成 500。
        // （mkdir 无 to；remove 走 remove 分支。注意不能写成 body.op !== "remove"，
        // 那会把无 to 的 mkdir 也误拒成 400。）
        if ((body.op === "rename" || body.op === "move") && typeof body.to !== "string")
          throw Object.assign(new Error("bad to"), { code: "BAD_REQUEST" });
        if (body.op === "remove") {
          // 真实 FileService 有 remove 方法；测试注入的 FakeService 没有 → 退化为 service.op
          // （FakeService.op 对 missing 路径抛 NOT_FOUND，契约不变：404）。
          if (service.remove) return service.remove(body.root, body.path);
          return service.op(body.root, body.op, body.path, body.to);
        }
        return service.op(body.root, body.op, body.path, body.to);
      }, ["POST"]);
    },
    async run(req, res) {
      await route(req, res, "body", async () => {
        const body = await readBody(req);
        if (typeof body?.root !== "string" || typeof body?.path !== "string")
          throw Object.assign(new Error("bad body"), { code: "BAD_REQUEST" });
        return service.run(body.root, body.path);
      }, ["POST"]);
    },
  };
}

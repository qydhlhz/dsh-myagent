// test/routes.test.ts — HTTP handler 工厂（注入假 FileService，不触真实 ctx.fs）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandlers } from "../src/routes.ts";
import { PDF_MAX_BYTES } from "../src/mime.ts";

function fakeReq(method: string, url: string, body: unknown = undefined): any {
  return { method, url, headers: { host: "localhost:3080" }, _body: body };
}
function fakeRes() {
  const res: any = { statusCode: 200, _body: "", ended: false, headers: {} };
  res.setHeader = (k: string, v: string) => { res.headers[k] = v; };
  res.end = (chunk: string | Buffer) => { res._body += chunk?.toString() ?? ""; res.ended = true; };
  return res;
}
async function bodyOf(res: any): Promise<any> {
  return JSON.parse(res._body);
}

class FakeService {
  root: string;
  /** 记录 service 方法被调用的次数——白名单拦截后不应有任何调用。 */
  calls = 0;
  /** write 收到的 expectedVersion（断言透传用）。 */
  lastExpectedVersion: unknown = undefined;
  /** readRaw 收到的 maxBytes（断言内联预览上限透传用）。 */
  lastMaxBytes: number | undefined = undefined;
  constructor(root: string) { this.root = root; }
  assertRoot(root: string) { if (root !== this.root) throw Object.assign(new Error("out of root"), { code: "OUT_OF_ROOT" }); }
  async tree(root: string, _path: string) {
    this.calls++;
    this.assertRoot(root);
    return { name: "root", path: "", entries: [{ name: "a.txt", path: "a.txt", kind: "file" }] };
  }
  async read(root: string, _path: string) {
    this.calls++;
    this.assertRoot(root);
    return { path: "a.txt", kind: "text", mime: "text/plain; charset=utf-8", size: 3, truncated: false, editable: true, content: "abc" };
  }
  async readRaw(root: string, _path: string, maxBytes?: number) {
    this.calls++;
    this.lastMaxBytes = maxBytes;
    this.assertRoot(root);
    if (_path === "missing") throw Object.assign(new Error("not found"), { code: "NOT_FOUND" });
    return { mime: "text/plain; charset=utf-8", bytes: new TextEncoder().encode("abc") };
  }
  async write(root: string, _path: string, _content: string, expectedVersion?: unknown) {
    this.calls++;
    this.assertRoot(root);
    this.lastExpectedVersion = expectedVersion;
    return { version: "v1" };
  }
  async op(root: string, op: string, _path: string, _to?: string) {
    this.calls++;
    this.assertRoot(root);
    if (op === "mkdir" && _path === "b") throw Object.assign(new Error("exists"), { code: "EXISTS" });
    if (_path === "missing") throw Object.assign(new Error("not found"), { code: "NOT_FOUND" });
    if (_path === "stale") throw Object.assign(new Error("stale"), { code: "FS_STALE_VERSION" });
    if (_path === "enoent") throw Object.assign(new Error("no such file or directory"), { code: "ENOENT" });
    if (_path === "eacces") throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    if (_path === "eexist") throw Object.assign(new Error("EEXIST: file already exists"), { code: "EEXIST" });
    return {};
  }
  async run(root: string, _path: string) {
    this.calls++;
    this.assertRoot(root);
    if (_path === "missing") throw Object.assign(new Error("not found"), { code: "NOT_FOUND" });
    return { stdout: "hello\n", stderr: "", exitCode: 0, signal: undefined, timedOut: false };
  }
}

test("tree 正常返回", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.tree(fakeReq("GET", "/tree?root=R&path="), res);
  assert.equal(res.statusCode, 200);
  assert.equal((await bodyOf(res)).data.entries[0].name, "a.txt");
});
test("root 不合法 → 403 OUT_OF_ROOT", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?root=EVIL&path=a.txt"), res);
  assert.equal(res.statusCode, 403);
  assert.equal((await bodyOf(res)).code, "OUT_OF_ROOT");
});
test("mkdir 目标已存在 → 409 EXISTS", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.op(fakeReq("POST", "/op", { root: "R", op: "mkdir", path: "b" }), res);
  assert.equal(res.statusCode, 409);
  assert.equal((await bodyOf(res)).code, "EXISTS");
});
test("不存在的路径 → 404 NOT_FOUND", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.op(fakeReq("POST", "/op", { root: "R", op: "remove", path: "missing" }), res);
  assert.equal(res.statusCode, 404);
});
test("未知 op → 400 BAD_REQUEST", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.op(fakeReq("POST", "/op", { root: "R", op: "nope", path: "a" }), res);
  assert.equal(res.statusCode, 400);
});
test("Host 不在白名单 → 403（白名单启用时）", async () => {
  const h = createHandlers(new FakeService("R"), ["trusted.example"]);
  const res = fakeRes();
  await h.tree(fakeReq("GET", "/tree?root=R&path="), res);
  assert.equal(res.statusCode, 403);
  assert.equal((await bodyOf(res)).code, "UNTRUSTED_HOST");
});
test("空 body（{}）→ 400 BAD_REQUEST", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.write(fakeReq("PUT", "/write", {}), res);
  assert.equal(res.statusCode, 400);
});
test("write body 带 expectedVersion（string）→ 透传给 service", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc);
  const res = fakeRes();
  await h.write(fakeReq("PUT", "/write", { root: "R", path: "a.txt", content: "x", expectedVersion: "v9" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(svc.lastExpectedVersion, "v9");
});
test("write body 带 expectedVersion（number）→ 透传给 service", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc);
  const res = fakeRes();
  await h.write(fakeReq("PUT", "/write", { root: "R", path: "a.txt", content: "x", expectedVersion: 42 }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(svc.lastExpectedVersion, 42);
});
test("write body 缺 expectedVersion → service 收到 undefined（无条件分支）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc);
  const res = fakeRes();
  await h.write(fakeReq("PUT", "/write", { root: "R", path: "a.txt", content: "x" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(svc.lastExpectedVersion, undefined);
});
test("write body 有 expectedVersion 但缺 root → 仍 400（BAD_REQUEST 校验顺序不变）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc);
  const res = fakeRes();
  await h.write(fakeReq("PUT", "/write", { path: "a.txt", content: "x", expectedVersion: "v9" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(svc.calls, 0);
});
test("畸形 JSON 流式 body（{\"bad）→ 400 BAD_REQUEST（readBody 流式分支）", async () => {
  // fakeReq 带 _body 时走 readBody 快路径；这里用 on/emit 收集器模拟 data/end 流。
  // 真实 HTTP 的 body 分片是异步到达的（handler 先挂监听，data 事件后到），所以 emit
  // 放 setImmediate 里——同步 emit 会早于 handler 挂上监听而丢失。
  const listeners: Record<string, Array<(c?: any) => void>> = {};
  const req: any = { method: "PUT", url: "/write", headers: { host: "localhost:3080" } };
  req.on = (ev: string, cb: (c?: any) => void) => { (listeners[ev] ??= []).push(cb); return req; };
  req.emit = (ev: string, chunk?: any) => { for (const cb of listeners[ev] ?? []) cb(chunk); };
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  const p = h.write(req, res);
  setImmediate(() => {
    req.emit("data", Buffer.from('{"bad'));
    req.emit("end");
  });
  await p;
  assert.equal(res.statusCode, 400);
  assert.equal((await bodyOf(res)).code, "BAD_REQUEST");
});
test("FS_STALE_VERSION → 409 CONFLICT", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.op(fakeReq("POST", "/op", { root: "R", op: "remove", path: "stale" }), res);
  assert.equal(res.statusCode, 409);
  assert.equal((await bodyOf(res)).code, "FS_STALE_VERSION");
});
test("非字符串 to（to: 123）→ 400 BAD_REQUEST", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.op(fakeReq("POST", "/op", { root: "R", op: "rename", path: "a", to: 123 }), res);
  assert.equal(res.statusCode, 400);
});
test("op body root 不在白名单 → 403 OUT_OF_ROOT（service 不应被调用）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc, undefined, (r: string) => r === "R");
  const res = fakeRes();
  await h.op(fakeReq("POST", "/op", { root: "EVIL", op: "mkdir", path: "x" }), res);
  assert.equal(res.statusCode, 403);
  assert.equal((await bodyOf(res)).code, "OUT_OF_ROOT");
  assert.equal(svc.calls, 0);
});
test("write body root 不在白名单 → 403 OUT_OF_ROOT（service 不应被调用）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc, undefined, (r: string) => r === "R");
  const res = fakeRes();
  await h.write(fakeReq("PUT", "/write", { root: "EVIL", path: "a", content: "x" }), res);
  assert.equal(res.statusCode, 403);
  assert.equal((await bodyOf(res)).code, "OUT_OF_ROOT");
  assert.equal(svc.calls, 0);
});
test("tree query root 不在白名单 → 403 OUT_OF_ROOT（service 不应被调用）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc, undefined, (r: string) => r === "R");
  const res = fakeRes();
  await h.tree(fakeReq("GET", "/tree?root=EVIL&path="), res);
  assert.equal(res.statusCode, 403);
  assert.equal((await bodyOf(res)).code, "OUT_OF_ROOT");
  assert.equal(svc.calls, 0);
});
test("白名单内的 root 正常放行（op body）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc, undefined, (r: string) => r === "R");
  const res = fakeRes();
  await h.op(fakeReq("POST", "/op", { root: "R", op: "mkdir", path: "x" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal((await bodyOf(res)).ok, true);
  assert.equal(svc.calls, 1);
});
test("ENOENT → 404（remove-on-missing 不再 500）", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.op(fakeReq("POST", "/op", { root: "R", op: "mkdir", path: "enoent" }), res);
  assert.equal(res.statusCode, 404);
  assert.equal((await bodyOf(res)).code, "ENOENT");
});
test("read query root 不在白名单 → 403 OUT_OF_ROOT（service 不应被调用，与 tree 对称）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc, undefined, (r: string) => r === "R");
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?root=EVIL&path=a.txt"), res);
  assert.equal(res.statusCode, 403);
  assert.equal((await bodyOf(res)).code, "OUT_OF_ROOT");
  assert.equal(svc.calls, 0);
});
test("EACCES → 403（node:fs 原生权限错误映射）", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.op(fakeReq("POST", "/op", { root: "R", op: "remove", path: "eacces" }), res);
  assert.equal(res.statusCode, 403);
  assert.equal((await bodyOf(res)).code, "EACCES");
});
test("allowlist 启用 + query 无 root → 400 BAD_REQUEST（缺失先于白名单判定）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc, undefined, (r: string) => r === "R");
  const res = fakeRes();
  await h.tree(fakeReq("GET", "/tree?path="), res);
  assert.equal(res.statusCode, 400);
  assert.equal((await bodyOf(res)).code, "BAD_REQUEST");
  assert.equal(svc.calls, 0);
});
test("allowlist 启用 + body 无 root → 400 BAD_REQUEST（缺失先于白名单判定）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc, undefined, (r: string) => r === "R");
  const res = fakeRes();
  await h.op(fakeReq("POST", "/op", { op: "mkdir", path: "a" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal((await bodyOf(res)).code, "BAD_REQUEST");
  assert.equal(svc.calls, 0);
});
test("read raw=1 → 直接写回文件字节（Content-Type / Content-Disposition / Buffer 内容）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc);
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?raw=1&root=R&path=a.txt"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "text/plain; charset=utf-8");
  assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(res.headers["Content-Disposition"], "attachment; filename*=UTF-8''a.txt");
  assert.equal(res._body, "abc");
  assert.equal(svc.calls, 1);
});
test("read raw=1 嵌套路径 → Content-Disposition 取 basename", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?raw=1&root=R&path=sub%2Fa.txt"), res);
  assert.equal(res.headers["Content-Disposition"], "attachment; filename*=UTF-8''a.txt");
});
test("read raw=1 越权 root → 403 OUT_OF_ROOT（仍为错误信封，service 不被调用）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc, undefined, (r: string) => r === "R");
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?raw=1&root=EVIL&path=a.txt"), res);
  assert.equal(res.statusCode, 403);
  assert.equal((await bodyOf(res)).code, "OUT_OF_ROOT");
  assert.equal(svc.calls, 0);
});
test("read raw=1 文件不存在 → 404 NOT_FOUND（错误信封）", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?raw=1&root=R&path=missing"), res);
  assert.equal(res.statusCode, 404);
  assert.equal((await bodyOf(res)).code, "NOT_FOUND");
});
test("GET /write → 405 METHOD_NOT_ALLOWED（方法白名单，service 不被调用）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc);
  const res = fakeRes();
  await h.write(fakeReq("GET", "/write", { root: "R", path: "a.txt", content: "x" }), res);
  assert.equal(res.statusCode, 405);
  assert.equal((await bodyOf(res)).code, "METHOD_NOT_ALLOWED");
  assert.equal(svc.calls, 0);
});
test("POST /read?raw=1 → 405 METHOD_NOT_ALLOWED（raw 分支同样过方法白名单）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc);
  const res = fakeRes();
  await h.read(fakeReq("POST", "/read?raw=1&root=R&path=a.txt"), res);
  assert.equal(res.statusCode, 405);
  assert.equal((await bodyOf(res)).code, "METHOD_NOT_ALLOWED");
  assert.equal(svc.calls, 0);
});
test("EEXIST → 409（rename 撞已存在目标不再 500）", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.op(fakeReq("POST", "/op", { root: "R", op: "rename", path: "eexist", to: "b" }), res);
  assert.equal(res.statusCode, 409);
  assert.equal((await bodyOf(res)).code, "EEXIST");
});
test("流式 body 超 1MB → 413 TOO_LARGE", async () => {
  const listeners: Record<string, Array<(c?: any) => void>> = {};
  const req: any = { method: "PUT", url: "/write", headers: { host: "localhost:3080" } };
  req.on = (ev: string, cb: (c?: any) => void) => { (listeners[ev] ??= []).push(cb); return req; };
  req.emit = (ev: string, chunk?: any) => { for (const cb of listeners[ev] ?? []) cb(chunk); };
  const svc = new FakeService("R");
  const h = createHandlers(svc);
  const res = fakeRes();
  const p = h.write(req, res);
  setImmediate(() => {
    req.emit("data", Buffer.alloc(1024 * 1024 + 1, 120));
    req.emit("end");
  });
  await p;
  assert.equal(res.statusCode, 413);
  assert.equal((await bodyOf(res)).code, "TOO_LARGE");
  assert.equal(svc.calls, 0);
});
test("read raw=1&inline=1 对 pdf 返回 inline 而非 attachment", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?raw=1&inline=1&root=R&path=a.pdf"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Disposition"], "inline");
  assert.equal(res.headers["Content-Type"], "text/plain; charset=utf-8");
});

test("read raw=1&inline=1 对超大 pdf 传入 PDF_MAX_BYTES", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc);
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?raw=1&inline=1&root=R&path=a.pdf"), res);
  assert.equal(svc.lastMaxBytes, PDF_MAX_BYTES);
});

test("read raw=1 下载不传 maxBytes", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc);
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?raw=1&root=R&path=a.pdf"), res);
  assert.equal(svc.lastMaxBytes, undefined);
});

test("read raw=1（无 inline）仍返回 attachment", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?raw=1&root=R&path=a.txt"), res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers["Content-Disposition"].startsWith("attachment"));
});
test("read raw=1&inline=1 对 txt 仍返回 attachment（不在 pdf/audio/video 白名单）", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?raw=1&inline=1&root=R&path=a.txt"), res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers["Content-Disposition"].startsWith("attachment"));
});
test("read raw=1&inline=1 对 docx 仍返回 attachment（不在 pdf/audio/video 白名单）", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?raw=1&inline=1&root=R&path=a.docx"), res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers["Content-Disposition"].startsWith("attachment"));
});
test("read raw=1&inline=1 对 svg 仍返回 attachment（sniff 为 image 不在 pdf/audio/video 白名单）", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?raw=1&inline=1&root=R&path=a.svg"), res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers["Content-Disposition"].startsWith("attachment"));
});
test("run 正常返回执行结果", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.run(fakeReq("POST", "/run", { root: "R", path: "a.py" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal((await bodyOf(res)).data.stdout, "hello\n");
});
test("run 方法不对 → 405 METHOD_NOT_ALLOWED（service 不应被调用）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc, undefined, (r: string) => r === "R");
  const res = fakeRes();
  await h.run(fakeReq("GET", "/run", { root: "R", path: "a.py" }), res);
  assert.equal(res.statusCode, 405);
  assert.equal((await bodyOf(res)).code, "METHOD_NOT_ALLOWED");
  assert.equal(svc.calls, 0);
});
test("run 缺 path → 400 BAD_REQUEST（service 不应被调用）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc, undefined, (r: string) => r === "R");
  const res = fakeRes();
  await h.run(fakeReq("POST", "/run", { root: "R" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal((await bodyOf(res)).code, "BAD_REQUEST");
  assert.equal(svc.calls, 0);
});
test("run root 不在白名单 → 403 OUT_OF_ROOT（service 不应被调用）", async () => {
  const svc = new FakeService("R");
  const h = createHandlers(svc, undefined, (r: string) => r === "R");
  const res = fakeRes();
  await h.run(fakeReq("POST", "/run", { root: "EVIL", path: "a.py" }), res);
  assert.equal(res.statusCode, 403);
  assert.equal((await bodyOf(res)).code, "OUT_OF_ROOT");
  assert.equal(svc.calls, 0);
});

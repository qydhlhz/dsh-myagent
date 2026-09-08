// src/service.ts — 全部内容 I/O 走沙箱化 ctx.fs；目录结构操作（mkdir/rename/move/remove）
// 走 node:fs（ctx.fs 十二原语无目录操作），对象是 processPath() 返回的、已通过
// safeJoin 门禁的根内绝对路径。
// 修正1：ESM 下不能 require()，node:fs 用顶层 import。
// 修正4：safeJoin 只是词法门禁；resolve 会 realpath 跟随符号链接，processPath 返回
// 真实落点——op()/remove() 在触碰 node:fs 前用 fs.contains 校验真实路径仍在根内，
// 防止根内 link → 根外的目录结构操作（remove 等）打到根外。
// 修正9（沙箱拒绝根因）：ctx.fs 是 SandboxedFileSystem（dsh-fs-sandbox），每次写按
// per-call policy 判定：会话内调用用会话的 workspace root，无会话归属的调用（宿主 API）
// fallback 到部署策略（启动 cwd 的 writableRoots）。宿主平面无会话，用户启动目录可能
// 不是任何请求根 → 写被 FS_SANDBOX_DENIED（读全放行）。因此 write() 显式传第 5 参
// sandboxPolicy = { mode: "workspace-write", workspaceRoot: root }，沙箱即按请求根判定
// （writableRoots(policy) 用 policy.workspaceRoot）。安全论证：root 已过路由白名单
// （allowed(root)）+ safeJoin（词法门禁）+ fs.contains（真实落点仍在根内）三重验证，
// 显式策略只是把"已获授权的根"告知沙箱，不扩大任何权限面；目录结构操作仍走 node:fs，
// 不经沙箱判定（受白名单 + safeJoin + contains 约束）。
import { mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { safeJoin } from "./path.ts";
import { classify, TEXT_MAX_BYTES } from "./limits.ts";
import { sniff } from "./mime.ts";
import { resolveRunPlan, runProcess, type ProcessRunner, type RuntimeConfig } from "./runner.ts";

export interface FsLike {
  resolve(path: string, opts: { cwd: string }): Promise<any>;
  stat(target: any): Promise<{ version: unknown; type: string; size?: number } | undefined>;
  listDir(target: any): Promise<Array<{ name: string; type: string; size?: number }>>;
  readText(target: any): Promise<string>;
  readBytes(target: any, signal: undefined, maxBytes: number): Promise<Uint8Array>;
  /** 写意图是 dsh-fs 的判别联合 FsWriteIntent：{kind:"replaceIfVersion", version}。
   *  sandboxPolicy（dsh-fs-sandbox 的 per-call 政策 {mode, workspaceRoot}）：宿主平面
   *  的写调用无会话归属，显式传政策让沙箱按请求工作沙盒根判定；缺省时 fallback 到
   *  部署策略（启动 cwd 的 writableRoots），可能拒绝非启动目录的写。 */
  writeText(
    target: any,
    content: string,
    expected?: { kind: "replaceIfVersion"; version: unknown },
    signal?: undefined,
    sandboxPolicy?: { mode: string; workspaceRoot: string }
  ): Promise<{ version: unknown }>;
  processPath(target: any): string;
  /** 规范包含性检查：child 是 parent 或其后代（两端均为本 provider 的 target）。 */
  contains(parent: any, child: any): boolean;
}

const OP_ALLOW = new Set(["mkdir", "rename", "move"]);

export class FileService {
  private fs: FsLike;
  private runner: ProcessRunner;
  private runtime: RuntimeConfig;
  // 不用参数属性（constructor(private fs)）：node --test 的 strip-only TS 模式不支持。
  constructor(fs: FsLike, runner: ProcessRunner = runProcess, runtime: RuntimeConfig = {}) {
    this.fs = fs;
    this.runner = runner;
    this.runtime = runtime;
  }

  private async target(root: string, rel: string) {
    const joined = safeJoin(root, rel);
    if (!joined) throw Object.assign(new Error("path out of root"), { code: "OUT_OF_ROOT" });
    return this.fs.resolve(joined, { cwd: root });
  }

  async tree(root: string, rel: string) {
    // 根列取：safeJoin 拒绝空串（isSafeRel("")=false），rel === "" 时直接解析 root 本身；
    // 其余路径仍走 target 的词法门禁（read(root,"") 依旧 403/OUT_OF_ROOT）。
    const t = rel === "" ? await this.fs.resolve(root, { cwd: root }) : await this.target(root, rel);
    const entries = (await this.fs.listDir(t))
      .filter((e) => !(rel === "" && e.name === ".myagent"))
      .map((e) => ({
        name: e.name,
        path: rel === "" ? e.name : `${rel}/${e.name}`,
        // 修正7：真实 dsh-fs（dsh-fs-local probe）的 type 词汇是 "directory"/"file"，
        // 测试注入的 FakeFs 用 "dir"/"file"——两种都接受，避免真实启动时目录被当成文件。
        kind: e.type === "dir" || e.type === "directory" ? "dir" : "file",
        ...(e.size !== undefined ? { size: e.size } : {}),
      }));
    return { name: rel === "" ? "(root)" : rel.split("/").pop()!, path: rel, entries };
  }

  async read(root: string, rel: string) {
    const t = await this.target(root, rel);
    const meta = await this.fs.stat(t);
    if (!meta) throw Object.assign(new Error("not found"), { code: "NOT_FOUND" });
    const c = classify(rel.split("/").pop() ?? "", meta.size ?? 0);
    // version 透传（Task 8 评审）：客户端保存时把它回传作 CAS 守卫（expectedVersion），
    // 缺了它 409 冲突分支永远不可达。
    if (c.kind === "image") {
      const bytes = await this.fs.readBytes(t, undefined, meta.size ?? 1);
      return { ...c, path: rel, size: meta.size, version: meta.version, content: Buffer.from(bytes).toString("base64") };
    }
    const kind = c.kind as string;
    if (kind === "binary" || kind === "pdf" || kind === "audio" || kind === "video")
      return { ...c, path: rel, size: meta.size, version: meta.version };
    // 审查修复：超限文本不再整读（readText 会把整个大文件读进内存）——改走有界 readBytes
    // （上限 +1 字节用于探测截断边界；不足上限时 bytes 即全文）。截断时 slice 掉探测字节，
    // 与旧 text.slice 语义一致；FS_TOO_LARGE 等失败由路由映射兜底。
    const bytes = await this.fs.readBytes(t, undefined, TEXT_MAX_BYTES + 1);
    const content = Buffer.from(bytes).toString("utf8");
    return { ...c, path: rel, size: meta.size, version: meta.version, content: c.truncated ? content.slice(0, TEXT_MAX_BYTES) : content };
  }

  // 审查修复（下载端点）：raw 读——复用 target() 的词法门禁 + stat（404 若不存在）→
  // 有界 readBytes → sniff 出的 mime。返回原始字节，供路由层直接写回响应，不套 JSON 信封。
  async readRaw(root: string, rel: string, maxBytes?: number) {
    const t = await this.target(root, rel);
    const meta = await this.fs.stat(t);
    if (!meta) throw Object.assign(new Error("not found"), { code: "NOT_FOUND" });
    const bytes = await this.fs.readBytes(t, undefined, maxBytes ?? (meta.size ?? 0));
    return { mime: sniff(rel.split("/").pop() ?? "").mime, bytes };
  }

  /** 运行可执行代码文件：先经过 target 门禁，再按扩展名解析解释器并执行。 */
  async run(root: string, rel: string) {
    const t = await this.target(root, rel);
    const meta = await this.fs.stat(t);
    if (!meta) throw Object.assign(new Error("not found"), { code: "NOT_FOUND" });
    const abs = this.fs.processPath(t);
    const plan = resolveRunPlan(rel, abs, this.runtime);
    if (!plan) throw Object.assign(new Error("unsupported language"), { code: "UNSUPPORTED_LANGUAGE" });
    const dir = path.dirname(abs);
    return this.runner(plan.command, plan.args, {
      cwd: dir,
      timeoutMs: this.runtime.timeoutMs ?? 15_000,
    });
  }

  async write(root: string, rel: string, content: string, expectedVersion?: unknown) {
    const t = await this.target(root, rel);
    // 审查修复：大小守卫必须在 expectedVersion 分支之前——否则带版本（浏览器常态）的写入
    // 可绕过 >512KB 检查直接覆盖大文件。新文件（meta undefined）无法查大小："新建任意大小
    // 文件"通道由 fs-sandbox 政策兜底，保持现状。
    const meta = await this.fs.stat(t);
    if (meta && (meta.size ?? 0) > TEXT_MAX_BYTES) throw Object.assign(new Error("too large to edit"), { code: "TOO_LARGE" });
    // Task 8 评审：有 expectedVersion 时直接以客户端读到的版本做 CAS——不再用内部 stat 的
    // 版本（stat 与客户端 read 之间存在窗口，内部版本可能已前进，会让过期写入静默通过）。
    // 版本不匹配由 dsh-fs 抛 FS_STALE_VERSION（路由映射 409）。
    if (expectedVersion !== undefined) {
      // 修正9：宿主平面无会话归属——显式传 per-call sandboxPolicy，沙箱按请求根判定
      // （root 已被路由白名单 / safeJoin / contains 验证），否则 fallback 到部署策略
      // （启动 cwd）会拒绝非启动目录的写。
      const out = await this.fs.writeText(t, content, { kind: "replaceIfVersion", version: expectedVersion }, undefined, {
        mode: "workspace-write",
        workspaceRoot: root,
      });
      return { version: out.version };
    }
    // 无 expectedVersion（旧调用/直连兼容）：stat 后以其 version 守卫，无则无条件。
    const version = meta?.version;
    // 修正1：ctx.fs 的写守卫是判别联合 FsWriteIntent（{kind:"replaceIfVersion", version}），
    // 不是裸 {replaceIfVersion}——后者 kind===undefined 守卫静默失效（无条件覆盖）。
    // 修正3：返回写入结果里的新版本，而不是 stat 的旧版本（否则下一次保存必然 409）。
    const out = await this.fs.writeText(t, content, version !== undefined ? { kind: "replaceIfVersion", version } : undefined, undefined, {
      mode: "workspace-write",
      workspaceRoot: root,
    });
    return { version: out.version };
  }

  async op(root: string, op: string, rel: string, to?: string) {
    if (!OP_ALLOW.has(op)) throw Object.assign(new Error("bad op"), { code: "BAD_REQUEST" });
    const t = await this.target(root, rel);
    // 修正4：任何 node:fs 调用前校验真实落点（resolve 已 realpath 跟随符号链接）；
    // 根内 link → 根外时，t 已解析到根外，contains 拒绝。
    const rootT = await this.fs.resolve(root, { cwd: root });
    if (!this.fs.contains(rootT, t)) throw Object.assign(new Error("out of root"), { code: "OUT_OF_ROOT" });
    const from = this.fs.processPath(t);
    if (op === "mkdir") {
      const meta = await this.fs.stat(t);
      if (meta) throw Object.assign(new Error("exists"), { code: "EXISTS" });
      mkdirSync(from, { recursive: false });
      return {};
    }
    if (!to) throw Object.assign(new Error("missing to"), { code: "BAD_REQUEST" });
    const joined = safeJoin(root, to);
    if (!joined) throw Object.assign(new Error("path out of root"), { code: "OUT_OF_ROOT" });
    const toTarget = await this.fs.resolve(joined, { cwd: root });
    // rename/move 的目标落点同样校验（to 指向的符号链接不能逃出根外）。
    if (!this.fs.contains(rootT, toTarget)) throw Object.assign(new Error("out of root"), { code: "OUT_OF_ROOT" });
    renameSync(from, this.fs.processPath(toTarget));
    return {};
  }

  async remove(root: string, rel: string) {
    const t = await this.target(root, rel);
    // 修正4：remove 是最危险的目录结构操作——根内 link → 根外时 rmSync 会删到根外。
    const rootT = await this.fs.resolve(root, { cwd: root });
    if (!this.fs.contains(rootT, t)) throw Object.assign(new Error("out of root"), { code: "OUT_OF_ROOT" });
    rmSync(this.fs.processPath(t), { recursive: true, force: false });
    return {};
  }
}

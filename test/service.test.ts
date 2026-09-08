// test/service.test.ts — FileService 行为级测试：真实临时目录 + FakeFs（实现 FsLike
// 全部方法，委托 node:fs）。覆盖 Task 4 评审修复：根列取、写守卫判别联合、写入后版本、
// 符号链接落点校验（最重要：根外目录必须原样存活）、越界 rel、超限拒绝、读分类行为。
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileService, type FsLike } from "../src/service.ts";
import { TEXT_MAX_BYTES } from "../src/limits.ts";
import { type ProcessRunner } from "../src/runner.ts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 1x1 透明 PNG。 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * FakeFs：行为对齐 dsh-fs 的本地后端——
 * - resolve 跟随符号链接（realpath；目标尚不存在时词法回退，mkdir/新建写需要）；
 * - writeText 的 replaceIfVersion 守卫：当前版本不等于 expected.version 时抛
 *   FS_STALE_VERSION（absent + 守卫同样拒绝，与 FsWriteIntent 文档一致）。
 */
class FakeFs implements FsLike {
  /** 最近一次 writeText 收到的 sandboxPolicy（修正9：验证 write 显式传 per-call 策略）。 */
  lastPolicy: { mode: string; workspaceRoot: string } | undefined;
  async resolve(p: string, opts: { cwd: string }) {
    const abs = path.resolve(opts.cwd, p);
    let key = abs;
    try {
      key = fs.realpathSync(abs);
    } catch {
      // 目标尚不存在（mkdir / 新建写）：词法回退
    }
    return { key };
  }
  processPath(t: any) {
    return t.key;
  }
  contains(parent: any, child: any) {
    return child.key === parent.key || child.key.startsWith(parent.key + path.sep);
  }
  async stat(t: any) {
    let st: fs.Stats;
    try {
      st = fs.statSync(t.key);
    } catch {
      return undefined;
    }
    return { version: String(st.mtimeMs), type: st.isDirectory() ? "dir" : "file", size: st.size };
  }
  async listDir(t: any) {
    return fs.readdirSync(t.key, { withFileTypes: true }).map((d) => ({
      name: d.name,
      type: d.isDirectory() ? "dir" : "file",
      size: undefined,
    }));
  }
  async readText(t: any) {
    return fs.readFileSync(t.key, "utf8");
  }
  async readBytes(t: any, _signal: undefined, maxBytes: number) {
    const buf = fs.readFileSync(t.key);
    // 行为对齐 dsh-fs：受 maxBytes 上限约束（超限截断），service 的有界读取依赖此语义。
    return buf.length <= maxBytes ? buf : buf.subarray(0, maxBytes);
  }
  async writeText(
    t: any,
    content: string,
    expected?: { kind: "replaceIfVersion"; version: unknown },
    _signal?: undefined,
    sandboxPolicy?: { mode: string; workspaceRoot: string }
  ) {
    this.lastPolicy = sandboxPolicy;
    const exists = fs.existsSync(t.key);
    if (expected?.kind === "replaceIfVersion") {
      const cur = exists ? String(fs.statSync(t.key).mtimeMs) : null;
      if (cur === null || cur !== expected.version)
        throw Object.assign(new Error("stale"), { code: "FS_STALE_VERSION" });
    }
    fs.writeFileSync(t.key, content, "utf8");
    return { version: String(Date.now()) };
  }
}

let root: string;
let fake: FakeFs;
let svc: FileService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dfm-"));
  fake = new FakeFs();
  svc = new FileService(fake);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("tree(root, \"\") 返回根目录 entries（不再 403）", async () => {
  fs.writeFileSync(path.join(root, "a.txt"), "hello");
  fs.mkdirSync(path.join(root, "sub"));
  const r = await svc.tree(root, "");
  assert.equal(r.name, "(root)");
  assert.equal(r.path, "");
  const names = r.entries.map((e: any) => e.name).sort();
  assert.deepEqual(names, ["a.txt", "sub"]);
  assert.equal(r.entries.find((e: any) => e.name === "a.txt")!.kind, "file");
  assert.equal(r.entries.find((e: any) => e.name === "sub")!.kind, "dir");
});

test("tree 子目录（非空 rel）仍走词法门禁", async () => {
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(path.join(root, "sub", "b.txt"), "x");
  const r = await svc.tree(root, "sub");
  assert.equal(r.name, "sub");
  assert.equal(r.path, "sub");
  assert.deepEqual(r.entries.map((e: any) => e.name), ["b.txt"]);
});

test("read(root, \"\") 仍被拒（tree 的根列取旁路不泄漏到 read）", async () => {
  await assert.rejects(svc.read(root, ""), (e: any) => e.code === "OUT_OF_ROOT");
});

test("write 新文件返回 version；再次 write 成功且返回新 version", async () => {
  const r1 = await svc.write(root, "a.txt", "one");
  assert.ok(typeof r1.version === "string");
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "one");
  await delay(20);
  // 服务层第二次写：内部 stat 取当前 version 作 replaceIfVersion 守卫，必然通过、返回新版本
  const r2 = await svc.write(root, "a.txt", "two");
  assert.ok(typeof r2.version === "string");
  assert.notEqual(r1.version, r2.version);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "two");
});

test("write 带过期 version 抛 FS_STALE_VERSION（守卫拒绝，内容不被覆盖）", async () => {
  const t = await fake.resolve(path.join(root, "a.txt"), { cwd: root });
  await fake.writeText(t, "one");
  await assert.rejects(
    fake.writeText(t, "two", { kind: "replaceIfVersion", version: "outdated-version" }),
    (e: any) => e.code === "FS_STALE_VERSION"
  );
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "one");
  // absent + replaceIfVersion 守卫同样拒绝（FsWriteIntent 语义）
  const absent = await fake.resolve(path.join(root, "absent.txt"), { cwd: root });
  await assert.rejects(
    fake.writeText(absent, "x", { kind: "replaceIfVersion", version: "v" }),
    (e: any) => e.code === "FS_STALE_VERSION"
  );
  assert.equal(fs.existsSync(path.join(root, "absent.txt")), false);
});

test("write 直接传 expectedVersion=过期值 → FS_STALE_VERSION 且内容不变", async () => {
  await svc.write(root, "a.txt", "one");
  // 与"stat 后守卫"不同：这里直接以客户端读到的过期版本做 CAS，绕过内部 stat。
  await assert.rejects(
    svc.write(root, "a.txt", "two", "outdated-version"),
    (e: any) => e.code === "FS_STALE_VERSION"
  );
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "one");
});

test("write 直接传 expectedVersion=当前值 → 写入成功并返回新版本", async () => {
  await svc.write(root, "a.txt", "one");
  const t = await fake.resolve(path.join(root, "a.txt"), { cwd: root });
  const meta = await fake.stat(t);
  const r = await svc.write(root, "a.txt", "two", meta!.version);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "two");
  assert.ok(typeof r.version === "string");
});

test("write 携带沙箱策略（workspace-write + 请求根）", async () => {
  // 修正9：宿主平面无会话归属，写必须显式传 per-call sandboxPolicy，沙箱按请求根判定
  // ——否则 fallback 到部署策略（启动 cwd 的 writableRoots），非启动目录的写会被拒。
  await svc.write(root, "a.txt", "x");
  assert.deepEqual(fake.lastPolicy, { mode: "workspace-write", workspaceRoot: root });
});

test("write 带 expectedVersion 同样携带沙箱策略（两个分支都传 policy）", async () => {
  await svc.write(root, "a.txt", "one");
  const t = await fake.resolve(path.join(root, "a.txt"), { cwd: root });
  const meta = await fake.stat(t);
  // expectedVersion 分支（浏览器保存常态）：策略必须同样显式传递
  await svc.write(root, "a.txt", "two", meta!.version);
  assert.deepEqual(fake.lastPolicy, { mode: "workspace-write", workspaceRoot: root });
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "two");
});

test("越界 rel（../x）→ OUT_OF_ROOT", async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "dfm-out-"));
  try {
    fs.writeFileSync(path.join(outside, "x"), "secret");
    await assert.rejects(svc.read(root, "../x"), (e: any) => e.code === "OUT_OF_ROOT");
    await assert.rejects(svc.tree(root, "../x"), (e: any) => e.code === "OUT_OF_ROOT");
    await assert.rejects(svc.remove(root, "../x"), (e: any) => e.code === "OUT_OF_ROOT");
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("符号链接逃逸：remove(link → 根外) 抛 OUT_OF_ROOT 且根外目录仍然存在", async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "dfm-outside-"));
  try {
    fs.writeFileSync(path.join(outside, "secret.txt"), "s");
    const link = path.join(root, "link");
    // Windows 用 junction（目标必须是绝对路径）；非 Windows 用 dir symlink
    const type = process.platform === "win32" ? "junction" : "dir";
    try {
      fs.symlinkSync(outside, link, type);
    } catch {
      fs.symlinkSync(outside, link, "dir");
    }
    await assert.rejects(svc.remove(root, "link"), (e: any) => e.code === "OUT_OF_ROOT");
    // 安全断言（最重要）：根外目录未被删除，链接本身也未被删除
    assert.ok(fs.existsSync(path.join(outside, "secret.txt")), "根外文件必须原样存在");
    assert.ok(fs.existsSync(link), "链接本身不应被删除");
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("write 超 512KB 的已存在文件 → TOO_LARGE", async () => {
  fs.writeFileSync(path.join(root, "big.txt"), Buffer.alloc(TEXT_MAX_BYTES + 1, 97));
  await assert.rejects(svc.write(root, "big.txt", "small"), (e: any) => e.code === "TOO_LARGE");
});

test("write 带 expectedVersion 的 >512KB 文件 → TOO_LARGE（大小守卫先于 CAS 分支）", async () => {
  fs.writeFileSync(path.join(root, "big.txt"), Buffer.alloc(TEXT_MAX_BYTES + 1, 97));
  // 浏览器常态带 expectedVersion 保存——守卫必须在版本分支之前，否则可绕过直接覆盖大文件。
  await assert.rejects(svc.write(root, "big.txt", "small", "any-version"), (e: any) => e.code === "TOO_LARGE");
  // 内容未被覆盖（守卫在写之前触发）
  assert.equal(fs.statSync(path.join(root, "big.txt")).size, TEXT_MAX_BYTES + 1);
});

test("readRaw 文本文件 → 原始字节 + sniff 出的 mime", async () => {
  fs.writeFileSync(path.join(root, "a.txt"), "hello world");
  const r: any = await svc.readRaw(root, "a.txt");
  assert.equal(r.mime, "text/plain; charset=utf-8");
  assert.equal(Buffer.from(r.bytes).toString("utf8"), "hello world");
});

test("readRaw 传入 maxBytes 上限 → 有界读取并截断", async () => {
  fs.writeFileSync(path.join(root, "a.pdf"), "0123456789abcdef");
  const r: any = await svc.readRaw(root, "a.pdf", 10);
  assert.equal(r.mime, "application/pdf");
  assert.equal(Buffer.from(r.bytes).toString("utf8"), "0123456789");
});

test("readRaw 不存在的文件 → NOT_FOUND", async () => {
  await assert.rejects(svc.readRaw(root, "nope.txt"), (e: any) => e.code === "NOT_FOUND");
});

test("read 超 512KB 文本 → 有界读取，content 恰为前 512KB", async () => {
  fs.writeFileSync(path.join(root, "big.txt"), Buffer.alloc(TEXT_MAX_BYTES + 100, 97));
  const r: any = await svc.read(root, "big.txt");
  assert.equal(r.kind, "text");
  assert.equal(r.truncated, true);
  assert.equal(r.editable, false);
  assert.equal(r.content.length, TEXT_MAX_BYTES);
});

test("read 恰 512KB 文本 → 内容完整（不足上限时 bytes 即全文）", async () => {
  fs.writeFileSync(path.join(root, "edge.txt"), Buffer.alloc(TEXT_MAX_BYTES, 97));
  const r: any = await svc.read(root, "edge.txt");
  assert.equal(r.truncated, false);
  assert.equal(r.editable, true);
  assert.equal(r.content.length, TEXT_MAX_BYTES);
});

test("read 文本 / 图片（base64 内容）基本行为", async () => {
  fs.writeFileSync(path.join(root, "a.txt"), "hello world");
  const txt: any = await svc.read(root, "a.txt");
  assert.equal(txt.kind, "text");
  assert.equal(txt.content, "hello world");
  assert.equal(txt.editable, true);

  fs.writeFileSync(path.join(root, "img.png"), PNG_1X1);
  const img: any = await svc.read(root, "img.png");
  assert.equal(img.kind, "image");
  assert.equal(img.mime, "image/png");
  assert.equal(Buffer.from(img.content, "base64").equals(PNG_1X1), true);
});

test("tree 根目录隐藏 .myagent 元数据目录", async () => {
  fs.mkdirSync(path.join(root, ".myagent"));
  fs.writeFileSync(path.join(root, ".myagent", "groups.json"), "{}");
  fs.writeFileSync(path.join(root, "visible.txt"), "x");
  const r = await svc.tree(root, "");
  const names = r.entries.map((e: any) => e.name);
  assert.ok(!names.includes(".myagent"));
  assert.ok(names.includes("visible.txt"));
});

test("read 对 pdf/audio/video/binary 只返回元数据不读内容", async () => {
  fs.writeFileSync(path.join(root, "a.pdf"), "fake-pdf");
  fs.writeFileSync(path.join(root, "a.mp3"), "fake-mp3");
  fs.writeFileSync(path.join(root, "a.mp4"), "fake-mp4");
  fs.writeFileSync(path.join(root, "a.docx"), "fake-docx-bytes");

  const pdf: any = await svc.read(root, "a.pdf");
  assert.equal(pdf.kind, "pdf");
  assert.equal(pdf.content, undefined);

  const audio: any = await svc.read(root, "a.mp3");
  assert.equal(audio.kind, "audio");
  assert.equal(audio.content, undefined);

  const video: any = await svc.read(root, "a.mp4");
  assert.equal(video.kind, "video");
  assert.equal(video.content, undefined);

  const office: any = await svc.read(root, "a.docx");
  assert.equal(office.kind, "binary");
  assert.equal(office.mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(office.content, undefined);
});

test("run 对 Python 文件调用 runner（工作目录为文件所在目录）", async () => {
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(path.join(root, "sub", "a.py"), "print('hi')");
  let captured: any = null;
  const runner: ProcessRunner = async (command, args, options) => {
    captured = { command, args, options };
    return { stdout: "hi\n", stderr: "", exitCode: 0, signal: undefined, timedOut: false };
  };
  const svc = new FileService(fake, runner);
  const r = await svc.run(root, "sub/a.py");
  assert.equal(r.stdout, "hi\n");
  assert.equal(captured.command, "python");
  assert.equal(captured.args[0], path.join(root, "sub", "a.py"));
  assert.equal(captured.options.cwd, path.join(root, "sub"));
  assert.equal(captured.options.timeoutMs, 15000);
});

test("run 对 R 文件使用配置的 rscriptPath", async () => {
  fs.writeFileSync(path.join(root, "a.R"), "print('hi')");
  let captured: any = null;
  const runner: ProcessRunner = async (command, args) => {
    captured = { command, args };
    return { stdout: "hi\n", stderr: "", exitCode: 0, signal: undefined, timedOut: false };
  };
  const svc = new FileService(fake, runner, { rscriptPath: "C:\Custom\Rscript.exe" });
  await svc.run(root, "a.R");
  assert.equal(captured.command, "C:\Custom\Rscript.exe");
  assert.equal(captured.args[0], path.join(root, "a.R"));
});

test("run 对不支持的扩展名抛 UNSUPPORTED_LANGUAGE", async () => {
  fs.writeFileSync(path.join(root, "a.txt"), "hello");
  const svc = new FileService(fake);
  await assert.rejects(svc.run(root, "a.txt"), (e: any) => e.code === "UNSUPPORTED_LANGUAGE");
});

test("run 对不存在的文件抛 NOT_FOUND", async () => {
  const svc = new FileService(fake);
  await assert.rejects(svc.run(root, "missing.py"), (e: any) => e.code === "NOT_FOUND");
});

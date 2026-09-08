# 沙盒文件区二进制预览（Binary Preview）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让沙盒文件区的大部分二进制文件可以直接预览（只读，不实现编辑），覆盖浏览器原生格式（PDF/音视频）和 Office 文档（docx/xlsx/pptx/odt/ods/odp/rtf）。

**Architecture:** 扩展 `mime.ts` / `limits.ts` 的格式分类；新增后端 `inline` 原始预览接口（PDF/音视频）与 Office 预览接口（宿主侧用 `officeparser` 转为 HTML/文本）；前端 `FileViewerPanel` 按新分类渲染 `<iframe>`、`<audio>`、`<video>` 或 Office 预览。

**Tech Stack:** Node.js 22、TypeScript、dsh-fs、React、`officeparser`（宿主侧 Office 解析，保持 external 不打包进 `lib/index.js`）。

---

## 文件结构

- `src/mime.ts` — 扩展格式识别：新增 `pdf` / `audio` / `video` / `office` 分类与 MIME。
- `src/limits.ts` — 扩展分类策略：新增各类型大小上限与降级规则。
- `src/service.ts` — `read()` 对新分类只返回元数据；新增 `previewOffice()`。
- `src/routes.ts` — 新增 `/preview`；`read?raw=1&inline=1` 支持安全内联。
- `src/client/api.ts` — 扩展 `ReadResult` 类型；新增 `preview()` / `inlineHref()`。
- `src/client/FileViewerPanel.tsx` — 按类型渲染 PDF/音视频/Office 预览。
- `package.json` / `tsdown.config.ts` — 新增 `officeparser` 依赖并保持 external。
- 测试：`test/mime.test.ts`、`test/limits.test.ts`、`test/service.test.ts`、`test/routes.test.ts`、`test/api.test.ts`。
- 文档：`README.md`、`Claude_memory.md`。

---

## Task 0: 引入 officeparser 依赖并保持宿主 external

**Files:**
- Modify: `dsh-myagent/package.json`
- Modify: `dsh-myagent/tsdown.config.ts`
- Modify: `dsh-myagent/package-lock.json`（由 npm install 自动更新）

- [ ] **Step 1: 修改 package.json 的 dependencies**

在 `dsh-myagent/package.json` 的 `dependencies` 中新增：

```json
"officeparser": "^7.6.2"
```

- [ ] **Step 2: 修改 tsdown.config.ts，把 officeparser 保持 external**

将：

```ts
deps: {
  // react 是 peerDependency；保持 external（取代已废弃的 `external`）。
  neverBundle: ["react"],
},
```

改为：

```ts
deps: {
  // react 是 peerDependency；保持 external。
  // officeparser 体量大（含 pdfjs/tesseract），不打包进 lib/index.js，运行时从依赖解析。
  neverBundle: ["react", "officeparser"],
},
```

- [ ] **Step 3: 安装依赖**

运行：

```bash
cd dsh-myagent
npm install
```

预期：`npm ls officeparser` 输出 `officeparser@7.6.2`。

- [ ] **Step 4: 提交**

```bash
cd dsh-myagent
git add package.json package-lock.json tsdown.config.ts
git commit -m "chore(dsh-myagent): 引入 officeparser 依赖并保持宿主 external"
```

---

## Task 1: 扩展 mime.ts 格式识别

**Files:**
- Modify: `dsh-myagent/src/mime.ts`
- Test: `dsh-myagent/test/mime.test.ts`

- [ ] **Step 1: 写失败测试**

在 `dsh-myagent/test/mime.test.ts` 末尾追加：

```ts
test("pdf/audio/video/office 扩展名归类", () => {
  assert.equal(sniff("a.pdf").kind, "pdf");
  assert.equal(sniff("a.PDF").kind, "pdf");
  assert.equal(sniff("a.mp3").kind, "audio");
  assert.equal(sniff("a.wav").kind, "audio");
  assert.equal(sniff("a.mp4").kind, "video");
  assert.equal(sniff("a.webm").kind, "video");
  assert.equal(sniff("a.docx").kind, "office");
  assert.equal(sniff("a.xlsx").kind, "office");
  assert.equal(sniff("a.pptx").kind, "office");
  assert.equal(sniff("a.odt").kind, "office");
});

test("常见二进制仍为 binary", () => {
  for (const f of ["a.zip", "d.exe", "e.bin", "f.woff2"]) {
    assert.equal(sniff(f).kind, "binary", f);
  }
});

test("新格式 MIME 正确", () => {
  assert.equal(sniff("a.pdf").mime, "application/pdf");
  assert.equal(sniff("a.mp3").mime, "audio/mpeg");
  assert.equal(sniff("a.mp4").mime, "video/mp4");
  assert.equal(sniff("a.docx").mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd dsh-myagent
node --test --test-isolation=none test/mime.test.ts
```

预期：新增测试失败，`a.pdf` 仍返回 `binary`。

- [ ] **Step 3: 实现 mime.ts**

将 `dsh-myagent/src/mime.ts` 整体替换为：

```ts
// src/mime.ts — 纯函数，扩展名 → 展示类型与 content-type。
export const TEXT_MAX_BYTES = 512 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_MAX_BYTES = 100 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 100 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const OFFICE_MAX_BYTES = 50 * 1024 * 1024;

const TEXT_EXT = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "markdown", "txt", "css", "scss", "html", "htm", "xml", "yaml", "yml", "py", "r", "sh", "bat", "ps1", "csv", "log", "sql", "toml", "ini", "env", "gitignore", "tsv"]);
const IMAGE_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon" };
const AUDIO_EXT: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", opus: "audio/opus" };
const VIDEO_EXT: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime", m4v: "video/x-m4v", avi: "video/x-msvideo" };
const OFFICE_EXT: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
};
const TEXT_MIME: Record<string, string> = { json: "application/json", html: "text/html", htm: "text/html", svg: "image/svg+xml" };

export type SniffedKind = "text" | "image" | "pdf" | "audio" | "video" | "office" | "binary";

export function sniff(name: string): { kind: SniffedKind; mime: string } {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  const imageMime = IMAGE_EXT[ext];
  if (imageMime) return { kind: "image", mime: imageMime };
  if (ext === "pdf") return { kind: "pdf", mime: "application/pdf" };
  const audioMime = AUDIO_EXT[ext];
  if (audioMime) return { kind: "audio", mime: audioMime };
  const videoMime = VIDEO_EXT[ext];
  if (videoMime) return { kind: "video", mime: videoMime };
  const officeMime = OFFICE_EXT[ext];
  if (officeMime) return { kind: "office", mime: officeMime };
  if (ext !== "" && !TEXT_EXT.has(ext)) return { kind: "binary", mime: "application/octet-stream" };
  return { kind: "text", mime: TEXT_MIME[ext] ?? "text/plain; charset=utf-8" };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd dsh-myagent
node --test --test-isolation=none test/mime.test.ts
```

预期：全部通过。

- [ ] **Step 5: 提交**

```bash
cd dsh-myagent
git add src/mime.ts test/mime.test.ts
git commit -m "feat(dsh-myagent): 扩展 mime 识别 PDF/音视频/Office"
```

---

## Task 2: 扩展 limits.ts 分类策略

**Files:**
- Modify: `dsh-myagent/src/limits.ts`
- Test: `dsh-myagent/test/limits.test.ts`

- [ ] **Step 1: 写失败测试**

在 `dsh-myagent/test/limits.test.ts` 中，把现有“二进制始终不可预览”测试改为：

```ts
test("pdf 未超限可预览", () => {
  assert.deepEqual(classify("a.pdf", 1024), { kind: "pdf", mime: "application/pdf", truncated: false, editable: false });
});
test("pdf 超限降级 binary", () => {
  assert.deepEqual(classify("a.pdf", 100 * 1024 * 1024 + 1), { kind: "binary", mime: "application/pdf", truncated: true, editable: false });
});
test("audio 未超限可预览", () => {
  assert.deepEqual(classify("a.mp3", 1024), { kind: "audio", mime: "audio/mpeg", truncated: false, editable: false });
});
test("video 未超限可预览", () => {
  assert.deepEqual(classify("a.mp4", 1024), { kind: "video", mime: "video/mp4", truncated: false, editable: false });
});
test("office 未超限可预览", () => {
  assert.deepEqual(classify("a.docx", 1024), { kind: "office", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", truncated: false, editable: false });
});
test("office 超限降级 binary", () => {
  assert.deepEqual(classify("a.docx", 50 * 1024 * 1024 + 1), { kind: "binary", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", truncated: true, editable: false });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd dsh-myagent
node --test --test-isolation=none test/limits.test.ts
```

预期：新增测试失败。

- [ ] **Step 3: 实现 limits.ts**

将 `dsh-myagent/src/limits.ts` 整体替换为：

```ts
// src/limits.ts — 结合扩展名与大小给出展示/编辑策略。
import { IMAGE_MAX_BYTES, TEXT_MAX_BYTES, PDF_MAX_BYTES, AUDIO_MAX_BYTES, VIDEO_MAX_BYTES, OFFICE_MAX_BYTES, sniff } from "./mime.ts";

// 供 service.ts 使用（Task 4）：文本截断上限与 classify 一起从 limits 导出。
export { TEXT_MAX_BYTES, PDF_MAX_BYTES, AUDIO_MAX_BYTES, VIDEO_MAX_BYTES, OFFICE_MAX_BYTES };

export interface Classified {
  kind: "text" | "image" | "pdf" | "audio" | "video" | "office" | "binary";
  mime: string;
  truncated: boolean;
  /** 仅"未超限文本"可编辑（编辑受 512KB 上限约束）。 */
  editable: boolean;
}

// 分支语义：
// - 原生二进制（zip/...）→ truncated:false：不可预览，占位+下载；
// - 图片/PDF/音视频/Office 超限 → 降级为 binary + truncated:true：仅下载；
// - 仅"未超限文本"editable:true（编辑受 512KB 上限约束）。
export function classify(name: string, size: number): Classified {
  const { kind, mime } = sniff(name);
  if (kind === "image" && size <= IMAGE_MAX_BYTES) return { kind, mime, truncated: false, editable: false };
  if (kind === "image") return { kind: "binary", mime, truncated: true, editable: false };
  if (kind === "text" && size <= TEXT_MAX_BYTES) return { kind, mime, truncated: false, editable: true };
  if (kind === "text") return { kind, mime, truncated: true, editable: false };
  if (kind === "pdf" && size <= PDF_MAX_BYTES) return { kind, mime, truncated: false, editable: false };
  if (kind === "pdf") return { kind: "binary", mime, truncated: true, editable: false };
  if (kind === "audio" && size <= AUDIO_MAX_BYTES) return { kind, mime, truncated: false, editable: false };
  if (kind === "audio") return { kind: "binary", mime, truncated: true, editable: false };
  if (kind === "video" && size <= VIDEO_MAX_BYTES) return { kind, mime, truncated: false, editable: false };
  if (kind === "video") return { kind: "binary", mime, truncated: true, editable: false };
  if (kind === "office" && size <= OFFICE_MAX_BYTES) return { kind, mime, truncated: false, editable: false };
  if (kind === "office") return { kind: "binary", mime, truncated: true, editable: false };
  return { kind: "binary", mime, truncated: false, editable: false };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd dsh-myagent
node --test --test-isolation=none test/limits.test.ts
```

预期：全部通过。

- [ ] **Step 5: 提交**

```bash
cd dsh-myagent
git add src/limits.ts test/limits.test.ts
git commit -m "feat(dsh-myagent): 扩展预览分类与大小上限"
```

---

## Task 3: service 支持新分类与 Office 预览

**Files:**
- Modify: `dsh-myagent/src/service.ts`
- Test: `dsh-myagent/test/service.test.ts`

- [ ] **Step 1: 写失败测试**

在 `dsh-myagent/test/service.test.ts` 末尾追加：

```ts
const DOCX_1X1 = Buffer.from(
  "UEsDBBQAAAAIAKebEF3JTxqw6wAAAK4BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QvU7DMBDeeQrLK4odGBBCSTrwMwJDeYCTfUks7LPlc0v79jht6YAK4933q69b7YIXW8zsIvXyRrVSIJloHU29/Fi/NPdScAGy4CNhL/fIcjVcdet9QhZVTNzLuZT0oDWbGQOwigmpImPMAUo986QTmE+YUN+27Z02kQpSacriIYfuCUfY+CKed/V9LJLRsxSPR+KS1UtIyTsDpeJ6S/ZXSnNKUFV54PDsEl9XgtQXExbk74CT7q0uk51F8Q65vEKoLP0Vs9U2mk2oSvW/zYWecRydwbN+cUs5GmSukwevzkgARz/99WHu4RtQSwMEFAAAAAgAp5sQXbmBRHGwAAAAKgEAAAsAAABfcmVscy8ucmVsc43POw7CMAwG4J1TRN5pWgaEUJMuCKkrKgeIEjeNaB5KwqO3JwMDIAZG278/y233sDO5YUzGOwZNVQNBJ70yTjM4D8f1DkjKwikxe4cMFkzQ8VV7wlnkspMmExIpiEsMppzDntIkJ7QiVT6gK5PRRytyKaOmQciL0Eg3db2l8d0A/mGSXjGIvWqADEvAf2w/jkbiwcurRZd/nPhKFFlEjZnB3UdF1atdFRYob+nHi/wJUEsDBBQAAAAIAKebEF1esRnRpgAAANwAAAARAAAAd29yZC9kb2N1bWVudC54bWxFjk0OwiAQhfeegrC3VBfGNKXdGQ+gB0AY2yYwQwD7c3uhLtx8LzOT9960/eosmyHEiVDyU1VzBqjJTDhI/nzcjlfOYlJolCUEyTeIvO8O7dIY0h8HmFhOwNgsko8p+UaIqEdwKlbkAfPtTcGplMcwiIWC8YE0xJgLnBXnur4IpybkXY58kdmK+oJQkLo7WEssl63MB5gnWFpR9oVhp9/584r/X90XUEsBAhQAFAAAAAgAp5sQXclPGrDrAAAArgEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAUAAAACACnmxBduYFEcbAAAAAqAQAACwAAAAAAAAAAAAAAgAEcAQAAX3JlbHMvLnJlbHNQSwECFAAUAAAACACnmxBdXrEZ0aYAAADcAAAAEQAAAAAAAAAAAAAAgAH1AQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAAygIAAAAA",
  "base64"
);

test("read 对 pdf/audio/video/office 只返回元数据不读内容", async () => {
  fs.writeFileSync(path.join(root, "a.pdf"), "fake-pdf");
  fs.writeFileSync(path.join(root, "a.mp3"), "fake-mp3");
  fs.writeFileSync(path.join(root, "a.docx"), DOCX_1X1);

  const pdf: any = await svc.read(root, "a.pdf");
  assert.equal(pdf.kind, "pdf");
  assert.equal(pdf.content, undefined);

  const audio: any = await svc.read(root, "a.mp3");
  assert.equal(audio.kind, "audio");
  assert.equal(audio.content, undefined);

  const office: any = await svc.read(root, "a.docx");
  assert.equal(office.kind, "office");
  assert.equal(office.content, undefined);
});

test("previewOffice 把最小 docx 转为 HTML", async () => {
  fs.writeFileSync(path.join(root, "a.docx"), DOCX_1X1);
  const r: any = await svc.previewOffice(root, "a.docx");
  assert.equal(r.kind, "office");
  assert.equal(r.truncated, false);
  assert.ok(r.html.includes("Hello docx preview"));
});

test("previewOffice 对非 Office 文件返回原分类", async () => {
  fs.writeFileSync(path.join(root, "a.pdf"), "fake-pdf");
  const r: any = await svc.previewOffice(root, "a.pdf");
  assert.equal(r.kind, "pdf");
  assert.equal(r.html, undefined);
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd dsh-myagent
node --test --test-isolation=none test/service.test.ts
```

预期：`previewOffice` 相关测试报 `TypeError: svc.previewOffice is not a function`，`read` 的 pdf/office 测试报错（pdf 被当文本读）。

- [ ] **Step 3: 实现 service.ts**

修改 `dsh-myagent/src/service.ts`：

1. 顶部 import 增加：

```ts
import { OfficeConverter } from "officeparser";
import { classify, TEXT_MAX_BYTES, OFFICE_MAX_BYTES } from "./limits.ts";
```

2. 将 `read()` 中：

```ts
    if (c.kind === "binary") return { ...c, path: rel, size: meta.size, version: meta.version };
```

替换为：

```ts
    if (c.kind === "binary" || c.kind === "pdf" || c.kind === "audio" || c.kind === "video" || c.kind === "office")
      return { ...c, path: rel, size: meta.size, version: meta.version };
```

3. 在 `readRaw()` 方法之后新增：

```ts
  async previewOffice(root: string, rel: string) {
    const t = await this.target(root, rel);
    const meta = await this.fs.stat(t);
    if (!meta) throw Object.assign(new Error("not found"), { code: "NOT_FOUND" });
    const name = rel.split("/").pop() ?? "";
    const c = classify(name, meta.size ?? 0);
    // 非 Office 或超过 Office 上限：不尝试解析，直接返回分类元数据（前端降级为下载/占位）。
    if (c.kind !== "office" || c.truncated) {
      return { ...c, path: rel, size: meta.size, version: meta.version };
    }
    const bytes = await this.fs.readBytes(t, undefined, Math.min(meta.size ?? 0, OFFICE_MAX_BYTES));
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    try {
      const { value } = await OfficeConverter.convert(bytes, "html", {
        parseConfig: { fileType: ext as any },
        generatorConfig: { htmlConfig: { standalone: false, containerWidth: "100%" } },
      });
      return { ...c, path: rel, size: meta.size, version: meta.version, html: String(value), truncated: false };
    } catch {
      try {
        const { value } = await OfficeConverter.convert(bytes, "text", {
          parseConfig: { fileType: ext as any },
        });
        return { ...c, path: rel, size: meta.size, version: meta.version, text: String(value), truncated: false };
      } catch {
        return { ...c, path: rel, size: meta.size, version: meta.version, truncated: true };
      }
    }
  }
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd dsh-myagent
node --test --test-isolation=none test/service.test.ts
```

预期：全部通过。

- [ ] **Step 5: 提交**

```bash
cd dsh-myagent
git add src/service.ts test/service.test.ts
git commit -m "feat(dsh-myagent): service 支持新分类与 Office 预览解析"
```

---

## Task 4: routes 新增 preview 与 inline 安全内联

**Files:**
- Modify: `dsh-myagent/src/routes.ts`
- Test: `dsh-myagent/test/routes.test.ts`

- [ ] **Step 1: 写失败测试**

在 `dsh-myagent/test/routes.test.ts` 中给 `FakeService` 增加方法：

```ts
  async previewOffice(root: string, _path: string) {
    this.calls++;
    this.assertRoot(root);
    return { path: _path, kind: "office", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 1, truncated: false, html: "<p>hello</p>" };
  }
```

在文件末尾追加：

```ts
test("read raw=1&inline=1 对 pdf 返回 inline 而非 attachment", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?raw=1&inline=1&root=R&path=a.pdf"), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Disposition"], "inline");
  assert.equal(res.headers["Content-Type"], "text/plain; charset=utf-8");
});

test("read raw=1（无 inline）仍返回 attachment", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.read(fakeReq("GET", "/read?raw=1&root=R&path=a.txt"), res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers["Content-Disposition"].startsWith("attachment"));
});

test("preview 调用 service.previewOffice 并返回 JSON", async () => {
  const h = createHandlers(new FakeService("R"));
  const res = fakeRes();
  await h.preview(fakeReq("GET", "/preview?root=R&path=a.docx"), res);
  assert.equal(res.statusCode, 200);
  const body = await bodyOf(res);
  assert.equal(body.data.kind, "office");
  assert.ok(body.data.html.includes("hello"));
});
```

注意：`FakeService.readRaw` 目前对任意路径返回 `text/plain`，所以第一个测试的 Content-Type 是 text/plain；本测试只验证 disposition 逻辑。

- [ ] **Step 2: 运行测试确认失败**

```bash
cd dsh-myagent
node --test --test-isolation=none test/routes.test.ts
```

预期：`h.preview is not a function`，且 inline 测试返回 attachment。

- [ ] **Step 3: 实现 routes.ts**

修改 `dsh-myagent/src/routes.ts`：

1. 顶部 import 增加：

```ts
import { sniff } from "./mime.ts";
```

2. `Handler` interface 增加：

```ts
  preview(req: any, res: any): Promise<void>;
```

3. `ServiceLike` interface 增加：

```ts
  previewOffice(root: string, rel: string): Promise<any>;
```

4. 在 `read` 的 raw 分支中，把：

```ts
          res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(path.split("/").pop() ?? "file")}`);
```

替换为：

```ts
          const fileName = path.split("/").pop() ?? "file";
          const inline = q(req).get("inline") === "1";
          const { kind } = sniff(fileName);
          const disposition = inline && (kind === "pdf" || kind === "audio" || kind === "video")
            ? "inline"
            : `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
          res.setHeader("Content-Disposition", disposition);
```

5. 在 `read` handler 后新增：

```ts
    async preview(req, res) {
      await route(req, res, "query", async () => {
        const root = q(req).get("root");
        const path = q(req).get("path");
        if (!root || path === null) throw Object.assign(new Error("missing root/path"), { code: "BAD_REQUEST" });
        return service.previewOffice(root, path);
      }, ["GET"]);
    },
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd dsh-myagent
node --test --test-isolation=none test/routes.test.ts
```

预期：全部通过。

- [ ] **Step 5: 提交**

```bash
cd dsh-myagent
git add src/routes.ts test/routes.test.ts
git commit -m "feat(dsh-myagent): 新增 preview 路由与 inline 安全内联"
```

---

## Task 5: client api 扩展

**Files:**
- Modify: `dsh-myagent/src/client/api.ts`
- Test: `dsh-myagent/test/api.test.ts`

- [ ] **Step 1: 写失败测试**

在 `dsh-myagent/test/api.test.ts` 末尾追加：

```ts
import { Api } from "../src/client/api.ts";

test("Api.inlineHref 生成 inline 原始地址", () => {
  const api = new Api("C:\\proj");
  assert.equal(
    api.inlineHref("a.pdf"),
    "/api/myagent/read?raw=1&inline=1&root=C%3A%5Cproj&path=a.pdf"
  );
});

test("Api.preview 路径拼接正确", () => {
  const api = new Api("C:\\proj");
  // 不真正 fetch，只验证方法存在且返回类型正确（node 环境无 fetch 时由调用方处理）。
  assert.equal(typeof api.preview, "function");
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd dsh-myagent
node --test --test-isolation=none test/api.test.ts
```

预期：`Api.inlineHref is not a function`。

- [ ] **Step 3: 实现 api.ts**

修改 `dsh-myagent/src/client/api.ts`：

1. 将：

```ts
export interface ReadResult {
  path: string;
  kind: "text" | "image" | "binary";
```

替换为：

```ts
export type PreviewKind = "text" | "image" | "pdf" | "audio" | "video" | "office" | "binary";

export interface ReadResult {
  path: string;
  kind: PreviewKind;
```

并在 `version?: unknown;` 后增加：

```ts
  /** Office 预览 HTML 片段（服务端已生成，前端放在 sandbox iframe 中展示）。 */
  html?: string;
  /** Office 预览纯文本（HTML 生成失败时的兜底）。 */
  text?: string;
```

2. 在 `read()` 方法后新增：

```ts
  /** 获取 Office 文档预览（docx/xlsx/pptx/odt/ods/odp/rtf）。 */
  preview(path: string): Promise<ApiResult<ReadResult>> {
    return this.req<ReadResult>(
      `/preview?root=${encodeURIComponent(this.root)}&path=${encodeURIComponent(path)}`);
  }

  /** 生成原始字节内联地址（仅用于 PDF/音视频等安全类型）。 */
  inlineHref(path: string): string {
    return `${BASE}/read?raw=1&inline=1&root=${encodeURIComponent(this.root)}&path=${encodeURIComponent(path)}`;
  }
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd dsh-myagent
node --test --test-isolation=none test/api.test.ts
```

预期：全部通过。

- [ ] **Step 5: 提交**

```bash
cd dsh-myagent
git add src/client/api.ts test/api.test.ts
git commit -m "feat(dsh-myagent): client api 支持 preview 与 inlineHref"
```

---

## Task 6: FileViewerPanel 渲染新预览

**Files:**
- Modify: `dsh-myagent/src/client/FileViewerPanel.tsx`

- [ ] **Step 1: 增加 office 预览状态**

在 `FileViewerPanel` 组件内，把：

```ts
  const [loaded, setLoaded] = useState<ReadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
```

改为：

```ts
  const [loaded, setLoaded] = useState<ReadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [office, setOffice] = useState<ReadResult | null>(null);
  const [officeError, setOfficeError] = useState<string | null>(null);
```

- [ ] **Step 2: reload 中重置并加载 office 预览**

将 `reload` 改为：

```ts
  const reload = useCallback(async () => {
    setError(null);
    setLoaded(null);
    setDraft(null);
    setOffice(null);
    setOfficeError(null);
    const res = await api.read(path);
    if (res.ok) {
      setLoaded(res.data);
      if (res.data.kind === "text") setDraft(res.data.content ?? "");
      if (res.data.kind === "office") {
        const p = await api.preview(path);
        if (p.ok) setOffice(p.data);
        else setOfficeError(describeApiError(p));
      }
    } else {
      setError(describeApiError(res));
    }
  }, [api, path]);
```

- [ ] **Step 3: 增加 PDF/音视频/Office 渲染分支**

在现有 `{loaded?.kind === "image" && loaded.content ? (...)}` 之后、`{loaded?.kind === "binary" ? (...)}` 之前插入：

```tsx
        {loaded?.kind === "pdf" ? (
          <iframe
            title={path}
            src={api.inlineHref(path)}
            style={{ width: "100%", height: "100%", border: 0 }}
          />
        ) : null}
        {loaded?.kind === "audio" ? (
          <div style={{ padding: 24 }}>
            <audio controls src={api.inlineHref(path)} style={{ width: "100%" }} />
          </div>
        ) : null}
        {loaded?.kind === "video" ? (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#000" }}>
            <video controls src={api.inlineHref(path)} style={{ maxWidth: "100%", maxHeight: "100%" }} />
          </div>
        ) : null}
        {loaded?.kind === "office" ? (
          office?.html ? (
            <iframe
              title={path}
              sandbox
              srcDoc={office.html}
              style={{ width: "100%", height: "100%", border: 0 }}
            />
          ) : office?.text ? (
            <pre style={{ padding: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{office.text}</pre>
          ) : officeError ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--dsw-alias-state-error-primary)" }}>
              {officeError}
            </div>
          ) : (
            <div style={{ padding: 12, color: "var(--dsw-alias-label-secondary)" }}>正在解析 Office 文件…</div>
          )
        ) : null}
```

- [ ] **Step 4: 构建客户端并验证语法**

```bash
cd dsh-myagent
npm run build:client
```

预期：构建成功，`node --check lib/client.js` 通过。

- [ ] **Step 5: 手动验证清单（需 dsh web 运行）**

- 打开 `.pdf`：右侧 details 出现 PDF 内嵌预览。
- 打开 `.mp3` / `.mp4`：出现可播放控件。
- 打开 `.docx` / `.xlsx` / `.pptx`：出现 Office 解析后的 HTML 预览。
- 打开 `.zip`：仍显示“二进制文件，无法预览 + 下载”。

- [ ] **Step 6: 提交**

```bash
cd dsh-myagent
git add src/client/FileViewerPanel.tsx
git commit -m "feat(dsh-myagent): 文件查看器支持 PDF/音视频/Office 预览"
```

---

## Task 6.5: UI 美化与 MYAGENT 风格统一

**Files:**
- Modify: `dsh-myagent/src/client/FileViewerPanel.tsx`
- Modify: `dsh-myagent/src/client/FileTree.tsx`（如需要统一滚动条/间距，仅做小范围一致性调整）

**目标：** 新预览区域与现有 MYAGENT 侧栏/查看器风格一致：使用 `--dsw-*` token、统一间距、深色主题、无突兀色块，保持现有标题栏和滚动条观感。

- [ ] **Step 1: 统一预览容器背景与内边距**

在 `FileViewerPanel.tsx` 中，为 PDF/音视频/Office 预览容器统一使用：

```tsx
<div style={{ width: "100%", height: "100%", background: "var(--dsw-alias-bg-base)", overflow: "auto" }}>
```

PDF/Office iframe 直接铺满该容器；音视频在容器内居中并保留合理 padding（`padding: 24px`）。

- [ ] **Step 2: 使用主题 token 替代硬编码颜色**

- 音视频黑色背景若保留，用 `var(--dsw-alias-bg-base)` 代替 `#000`，与深色主题一致。
- 错误/加载文案颜色使用现有 `var(--dsw-alias-state-error-primary)` / `var(--dsw-alias-label-secondary)`。
- 按钮、下载、关闭等沿用现有 `Button` 组件，不新增自定义样式。

- [ ] **Step 3: Office iframe 视觉降级**

为 Office 预览的 iframe 增加与查看器一致的背景：

```tsx
<iframe
  title={path}
  sandbox
  srcDoc={office.html}
  style={{ width: "100%", height: "100%", border: 0, background: "var(--dsw-alias-bg-base)" }}
/>
```

- [ ] **Step 4: 构建并人工检查**

```bash
cd dsh-myagent
npm run build:client
```

人工检查项：
- PDF 预览无额外边框、贴合 details 列。
- 音视频控件在深色背景上可辨识。
- Office 预览内容区与侧栏整体风格一致，无白色块/突兀样式。
- 滚动条仍为 `fm-scroll` 风格（如 iframe 内无法继承，可接受，但外层容器不出现默认粗滚动条闪烁）。

- [ ] **Step 5: 提交**

```bash
cd dsh-myagent
git add src/client/FileViewerPanel.tsx src/client/FileTree.tsx
git commit -m "style(dsh-myagent): 二进制预览界面统一 MYAGENT 风格"
```

---

## Task 7: 文档与全量验证

**Files:**
- Modify: `dsh-myagent/README.md`
- Modify: `dsh-myagent/Claude_memory.md`

- [ ] **Step 1: 更新 README 功能列表**

在 `dsh-myagent/README.md` 的功能列表“文件查看与编辑”后补充：

```md
- 二进制预览：PDF / 音频 / 视频 / Office（docx/xlsx/pptx/odt/ods/odp/rtf）只读预览
```

- [ ] **Step 2: 更新 Claude_memory.md**

在 `dsh-myagent/Claude_memory.md` 末尾追加本次实现记录：

```md
## 2026-08-16 沙盒文件区二进制预览

- 扩展 mime/limits：新增 pdf/audio/video/office 分类与大小上限。
- 新增 `/api/myagent/preview`：宿主侧 officeparser 将 Office 转为 HTML/文本。
- `read?raw=1&inline=1`：PDF/音视频安全内联，其它仍强制下载。
- `FileViewerPanel` 支持 iframe PDF、audio/video 控件、Office HTML 预览。
- 只读预览，不实现编辑。
```

- [ ] **Step 3: 全量检查**

```bash
cd dsh-myagent
npm run check
npm run build
node smoke.mjs
```

预期：全部通过。

- [ ] **Step 4: 提交**

```bash
cd dsh-myagent
# Claude_memory.md 被 .gitignore 排除，仅本地维护，不提交。
git add README.md
git commit -m "docs(dsh-myagent): 记录二进制预览能力"
```

---

## Self-Review

- **Spec 覆盖**：优先级 1（PDF/音视频）在 Task 1/2/4/6 实现；优先级 2（Office）在 Task 0/3/4/5/6 实现；UI 美化在 Task 6.5 实现；优先级 3（压缩包等）明确不做。
- **无占位符**：所有代码块均为可直接落地的实现。
- **类型一致**：展示类型分类在 `mime.ts`（`SniffedKind`）、`limits.ts`（`Classified.kind`）、`api.ts`（`PreviewKind`）、`service.ts`（返回值）之间保持一致；`previewOffice` 在 `ServiceLike` 与 `FakeService` 中同步添加。
- **安全**：inline 仅对 `pdf/audio/video` 放行；Office HTML 放在 `sandbox` iframe 中展示，避免脚本执行。

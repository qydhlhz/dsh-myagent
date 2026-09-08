import { test } from "node:test";
import assert from "node:assert/strict";
import { TEXT_MAX_BYTES, IMAGE_MAX_BYTES, sniff } from "../src/mime.ts";

test("常见代码/文档扩展名归为 text", () => {
  for (const f of ["a.ts", "b.js", "c.json", "d.md", "e.css", "f.html", "g.py", "h.yml"])
    assert.equal(sniff(f).kind, "text", f);
});
test("图片扩展名", () => {
  for (const f of ["a.png", "b.jpg", "c.gif", "d.svg", "e.webp"])
    assert.equal(sniff(f).kind, "image", f);
});
test("二进制扩展名", () => {
  for (const f of ["c.zip", "d.exe", "e.bin", "f.woff2"])
    assert.equal(sniff(f).kind, "binary", f);
});
test("无扩展名默认为 text", () => assert.equal(sniff("Makefile").kind, "text"));
test("svg mime 是 image/svg+xml", () => assert.equal(sniff("a.svg").mime, "image/svg+xml"));
test("上限常量", () => {
  assert.equal(TEXT_MAX_BYTES, 512 * 1024);
  assert.equal(IMAGE_MAX_BYTES, 5 * 1024 * 1024);
});

test("pdf/audio/video 扩展名归类", () => {
  assert.equal(sniff("a.pdf").kind, "pdf");
  assert.equal(sniff("a.PDF").kind, "pdf");
  assert.equal(sniff("a.mp3").kind, "audio");
  assert.equal(sniff("a.wav").kind, "audio");
  assert.equal(sniff("a.mp4").kind, "video");
  assert.equal(sniff("a.webm").kind, "video");
});

test("Office 文档扩展名归为 binary（不再预览，仅下载）", () => {
  for (const f of ["a.docx", "a.xlsx", "a.pptx", "a.odt", "a.ods", "a.odp", "a.rtf"])
    assert.equal(sniff(f).kind, "binary", f);
});

test("新格式 MIME 正确", () => {
  assert.equal(sniff("a.pdf").mime, "application/pdf");
  assert.equal(sniff("a.mp3").mime, "audio/mpeg");
  assert.equal(sniff("a.mp4").mime, "video/mp4");
  assert.equal(sniff("a.docx").mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
});

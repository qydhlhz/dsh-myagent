import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/limits.ts";

test("小文本可读可编辑", () => {
  assert.deepEqual(classify("a.ts", 100), { kind: "text", mime: "text/plain; charset=utf-8", truncated: false, editable: true });
});
test("超限文本截断且不可编辑", () => {
  assert.deepEqual(classify("a.ts", 512 * 1024 + 1), { kind: "text", mime: "text/plain; charset=utf-8", truncated: true, editable: false });
});
test("小图片直出", () => {
  assert.deepEqual(classify("a.png", 1024), { kind: "image", mime: "image/png", truncated: false, editable: false });
});
test("大图片不可预览", () => {
  assert.deepEqual(classify("a.png", 5 * 1024 * 1024 + 1), { kind: "binary", mime: "image/png", truncated: true, editable: false });
});
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
test("Office 文档归为 binary（不可预览、可下载）", () => {
  assert.deepEqual(classify("a.docx", 1024), { kind: "binary", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", truncated: false, editable: false });
});
test("边界：512KB 整可编辑", () => {
  assert.deepEqual(classify("a.ts", 512 * 1024), { kind: "text", mime: "text/plain; charset=utf-8", truncated: false, editable: true });
});
test("边界：5MB 整仍可预览", () => {
  assert.deepEqual(classify("a.png", 5 * 1024 * 1024), { kind: "image", mime: "image/png", truncated: false, editable: false });
});
test("audio 超限降级 binary", () => {
  assert.deepEqual(classify("a.mp3", 100 * 1024 * 1024 + 1), { kind: "binary", mime: "audio/mpeg", truncated: true, editable: false });
});
test("video 超限降级 binary", () => {
  assert.deepEqual(classify("a.mp4", 200 * 1024 * 1024 + 1), { kind: "binary", mime: "video/mp4", truncated: true, editable: false });
});
test("未知二进制始终不可预览", () => {
  assert.deepEqual(classify("a.zip", 10), { kind: "binary", mime: "application/octet-stream", truncated: false, editable: false });
});
test("边界：PDF 上限整仍可预览", () => {
  assert.equal(classify("a.pdf", 100 * 1024 * 1024).kind, "pdf");
});
test("边界：audio 上限整仍可预览", () => {
  assert.equal(classify("a.mp3", 100 * 1024 * 1024).kind, "audio");
});
test("边界：video 上限整仍可预览", () => {
  assert.equal(classify("a.mp4", 200 * 1024 * 1024).kind, "video");
});

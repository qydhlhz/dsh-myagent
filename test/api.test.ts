// test/api.test.ts — api.ts 纯函数测试（describeApiError；Api 类依赖 fetch，浏览器侧验证）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeApiError } from "../src/client/api.ts";

test("错误码翻译为可读中文", () => {
  assert.equal(describeApiError({ status: 404, code: "NOT_FOUND", message: "x" }), "文件或目录不存在");
  assert.equal(describeApiError({ status: 403, code: "OUT_OF_ROOT", message: "x" }), "超出工作区范围");
  assert.equal(describeApiError({ status: 409, code: "FS_STALE_VERSION", message: "x" }), "文件已被修改，请重新加载后再保存");
  assert.equal(describeApiError({ status: 409, code: "CONFLICT", message: "x" }), "文件已被修改，请重新加载后再保存");
  assert.equal(describeApiError({ status: 409, code: "EXISTS", message: "x" }), "目标已存在，请换个名字");
  assert.equal(describeApiError({ status: 413, code: "TOO_LARGE", message: "x" }), "文件过大，仅提供下载");
  assert.equal(describeApiError({ status: 500, code: "INTERNAL", message: "x" }), "操作失败（INTERNAL）");
});

import { Api } from "../src/client/api.ts";

test("Api.inlineHref 生成 inline 原始地址", () => {
  const api = new Api("C:\\proj");
  assert.equal(
    api.inlineHref("a.pdf"),
    "/api/myagent/read?raw=1&inline=1&root=C%3A%5Cproj&path=a.pdf"
  );
});


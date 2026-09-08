import { test } from "node:test";
import assert from "node:assert/strict";
import { safeJoin, toApiPath } from "../src/path.ts";

const ROOT = "C:\\work\\root";

test("safeJoin 拼接普通相对路径", () => {
  assert.equal(safeJoin(ROOT, "src/a.txt"), "C:\\work\\root\\src\\a.txt");
});
test("safeJoin 拒绝绝对路径", () => {
  assert.equal(safeJoin(ROOT, "C:\\evil\\x"), null);
  assert.equal(safeJoin(ROOT, "/etc/passwd"), null);
});
test("safeJoin 拒绝越界 ..", () => {
  assert.equal(safeJoin(ROOT, "../evil"), null);
  assert.equal(safeJoin(ROOT, "a/../../evil"), null);
});
test("safeJoin 拒绝空与 .", () => {
  assert.equal(safeJoin(ROOT, ""), null);
  assert.equal(safeJoin(ROOT, "."), null);
});
test("toApiPath 把 windows 反斜杠转成 API 的 POSIX 相对路径", () => {
  assert.equal(toApiPath(ROOT, "C:\\work\\root\\a\\b.txt"), "a/b.txt");
});
test("toApiPath 路径不在根内返回 null", () => {
  assert.equal(toApiPath(ROOT, "C:\\work\\other\\b.txt"), null);
});
test("toApiPath 前缀碰撞：root2 不在 root 内", () => {
  assert.equal(toApiPath(ROOT, "C:\\work\\root2\\b.txt"), null);
});
test("safeJoin 放行根内 a/../b", () => {
  assert.equal(safeJoin(ROOT, "a/../b"), "C:\\work\\root\\b");
});

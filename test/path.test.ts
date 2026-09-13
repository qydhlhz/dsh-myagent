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

// 同一批纯函数在 Linux/macOS 上必须给出 POSIX 结果 —— 语义按**输入形态**选，
// 不跟运行平台走（CI 在 ubuntu 上跑这一组）。
const POSIX_ROOT = "/work/root";

test("POSIX：safeJoin 拼接/拒绝", () => {
  assert.equal(safeJoin(POSIX_ROOT, "src/a.txt"), "/work/root/src/a.txt");
  assert.equal(safeJoin(POSIX_ROOT, "a/../b"), "/work/root/b");
  assert.equal(safeJoin(POSIX_ROOT, "../evil"), null);
  assert.equal(safeJoin(POSIX_ROOT, "/etc/passwd"), null);
  assert.equal(safeJoin(POSIX_ROOT, ""), null);
});

test("POSIX：toApiPath 相对化与逃逸判断", () => {
  assert.equal(toApiPath(POSIX_ROOT, "/work/root/a/b.txt"), "a/b.txt");
  assert.equal(toApiPath(POSIX_ROOT, "/work/other/b.txt"), null);
  assert.equal(toApiPath(POSIX_ROOT, "/work/root2/b.txt"), null);
  assert.equal(toApiPath(POSIX_ROOT, POSIX_ROOT), "");
});

test("语义按输入形态选，而不是按运行平台", () => {
  // 在任意平台上：Windows 拼写给反斜杠结果，POSIX 拼写给斜杠结果。
  assert.equal(safeJoin("C:\\a", "b/c.txt"), "C:\\a\\b\\c.txt");
  assert.equal(safeJoin("/a", "b/c.txt"), "/a/b/c.txt");
  assert.equal(toApiPath("C:\\a", "C:\\a\\b\\c.txt"), "b/c.txt");
  assert.equal(toApiPath("/a", "/a/b/c.txt"), "b/c.txt");
});

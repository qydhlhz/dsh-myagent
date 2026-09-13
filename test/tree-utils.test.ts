// test/tree-utils.test.ts — tree-utils 纯函数测试（joinRel / sortEntries / resolveRoot /
// sessionForRoot / validateNameInput）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  joinRel,
  resolveAbsPath,
  resolveRoot,
  sessionForRoot,
  sortEntries,
  validateNameInput,
  type SessionsSnapshot,
  type WorkspacesSnapshot,
} from "../src/client/tree-utils.ts";

test("joinRel 拼接与根处理", () => {
  assert.equal(joinRel("", "a"), "a");
  assert.equal(joinRel("src", "a.ts"), "src/a.ts");
});

test("resolveAbsPath 根级文件：root + / + 名", () => {
  assert.equal(resolveAbsPath("C:\\proj", "a.txt"), "C:\\proj/a.txt");
  assert.equal(resolveAbsPath("/home/user/proj", "a.txt"), "/home/user/proj/a.txt");
});

test("resolveAbsPath 嵌套文件：root + / + 相对路径", () => {
  assert.equal(resolveAbsPath("C:\\proj", "src/utils.ts"), "C:\\proj/src/utils.ts");
  assert.equal(resolveAbsPath("/home/user/proj", "deep/nested/x.json"), "/home/user/proj/deep/nested/x.json");
});

test("resolveAbsPath 根自身（空 rel）返回 root", () => {
  assert.equal(resolveAbsPath("C:\\proj", ""), "C:\\proj");
  assert.equal(resolveAbsPath("/home/user/proj", ""), "/home/user/proj");
});

test("resolveAbsPath root 自带尾部分隔符时不重复拼接", () => {
  assert.equal(resolveAbsPath("C:\\proj\\", "a.txt"), "C:\\proj\\a.txt");
  assert.equal(resolveAbsPath("/home/user/proj/", "a.txt"), "/home/user/proj/a.txt");
});

test("escapeHtml 转义 & < >（& 优先，防二次转义）", () => {
  assert.equal(escapeHtml("a & b"), "a &amp; b");
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
  assert.equal(escapeHtml("&&<>"), "&amp;&amp;&lt;&gt;");
  assert.equal(escapeHtml("plain"), "plain");
});

test("validateNameInput name：空/分隔符/点拒绝，合法返回 null", () => {
  assert.equal(validateNameInput("name", ""), "名称不能为空");
  assert.equal(validateNameInput("name", "sub/bar.txt"), "名称不能包含 / 或 \\");
  assert.equal(validateNameInput("name", "a\\b"), "名称不能包含 / 或 \\");
  assert.equal(validateNameInput("name", "."), "名称不能是 . 或 ..");
  assert.equal(validateNameInput("name", ".."), "名称不能是 . 或 ..");
  assert.equal(validateNameInput("name", "a.txt"), null);
  assert.equal(validateNameInput("name", "子目录文件"), null); // 中文等合法字符不误伤
});

test("validateNameInput path：空/前导分隔符/..段拒绝，合法返回 null", () => {
  assert.equal(validateNameInput("path", ""), "路径不能为空");
  assert.equal(validateNameInput("path", "/a"), "路径不能以分隔符开头");
  assert.equal(validateNameInput("path", "\\a"), "路径不能以分隔符开头");
  assert.equal(validateNameInput("path", "src/../x"), "路径不能包含 ..");
  assert.equal(validateNameInput("path", "../x"), "路径不能包含 ..");
  assert.equal(validateNameInput("path", ".."), "路径不能包含 ..");
  assert.equal(validateNameInput("path", "src/utils.ts"), null);
  assert.equal(validateNameInput("path", "a"), null);
});

test("sortEntries 目录在前、同组按名排序", () => {
  const entries: any[] = [
    { name: "z.txt", kind: "file" },
    { name: "b", kind: "dir" },
    { name: "a", kind: "dir" },
    { name: "m.txt", kind: "file" },
  ];
  assert.deepEqual(sortEntries(entries).map((e) => e.name), ["a", "b", "m.txt", "z.txt"]);
});

const wss = (items: WorkspacesSnapshot["items"]): WorkspacesSnapshot => ({ items, archivedSessionIds: [] });

test("resolveRoot 当前会话命中其工作沙盒", () => {
  const sessions: SessionsSnapshot = { byId: {}, current: "s1" };
  const workspaces = wss([
    { workspaceId: "w1", path: "C:\\a", title: "a", sessionIds: ["s1"] },
    { workspaceId: "w2", path: "C:\\b", title: "b", sessionIds: ["s2"] },
  ]);
  assert.equal(resolveRoot(sessions, workspaces), "C:\\a");
});

test("resolveRoot 无当前会话取第一个工作沙盒", () => {
  const sessions: SessionsSnapshot = { byId: {}, current: undefined };
  const workspaces = wss([
    { workspaceId: "w1", path: "C:\\a", title: "a", sessionIds: [] },
    { workspaceId: "w2", path: "C:\\b", title: "b", sessionIds: [] },
  ]);
  assert.equal(resolveRoot(sessions, workspaces), "C:\\a");
});

test("resolveRoot 当前会话不属于任何工作沙盒时回退第一个工作沙盒", () => {
  const sessions: SessionsSnapshot = { byId: {}, current: "sX" };
  const workspaces = wss([
    { workspaceId: "w1", path: "C:\\a", title: "a", sessionIds: ["s1"] },
    { workspaceId: "w2", path: "C:\\b", title: "b", sessionIds: ["s2"] },
  ]);
  assert.equal(resolveRoot(sessions, workspaces), "C:\\a");
});

test("resolveRoot 空集返回 null", () => {
  assert.equal(resolveRoot({ byId: {} }, wss([])), null);
});

test("resolveRoot 显式 currentSessionId 参数优先于 sessions.current", () => {
  const sessions: SessionsSnapshot = { byId: {}, current: "s1" };
  const workspaces = wss([
    { workspaceId: "w1", path: "C:\\a", title: "a", sessionIds: ["s1"] },
    { workspaceId: "w2", path: "C:\\b", title: "b", sessionIds: ["s2"] },
  ]);
  assert.equal(resolveRoot(sessions, workspaces, "s2"), "C:\\b");
});

// sessionForRoot：构造会话作用域文件地址时"该根属于哪个会话"的唯一来源。
// 选错会话 → 官方预览会按另一个会话的根解析相对路径，读到别的文件。

test("sessionForRoot 优先当前会话（该根下）", () => {
  const sessions: SessionsSnapshot = { byId: {}, current: "s2" };
  const workspaces = wss([{ workspaceId: "w1", path: "C:\\a", title: "a", sessionIds: ["s1", "s2"] }]);
  assert.deepEqual(sessionForRoot(sessions, workspaces, "C:\\a"), { sessionId: "s2", cwd: "C:\\a" });
});

test("sessionForRoot 当前会话不在该根下时取该根第一个会话", () => {
  const sessions: SessionsSnapshot = { byId: {}, current: "s9" };
  const workspaces = wss([
    { workspaceId: "w1", path: "C:\\a", title: "a", sessionIds: ["s1"] },
    { workspaceId: "w2", path: "C:\\b", title: "b", sessionIds: ["s2"] },
  ]);
  assert.deepEqual(sessionForRoot(sessions, workspaces, "C:\\b"), { sessionId: "s2", cwd: "C:\\b" });
});

test("sessionForRoot 没有当前会话时取第一个会话", () => {
  const sessions: SessionsSnapshot = { byId: {}, current: undefined };
  const workspaces = wss([{ workspaceId: "w1", path: "C:\\a", title: "a", sessionIds: ["s1", "s2"] }]);
  assert.deepEqual(sessionForRoot(sessions, workspaces, "C:\\a"), { sessionId: "s1", cwd: "C:\\a" });
});

test("sessionForRoot 路径比较去掉尾部分隔符且 win32 大小写不敏感", () => {
  const sessions: SessionsSnapshot = { byId: {}, current: "s1" };
  const workspaces = wss([{ workspaceId: "w1", path: "C:\\Proj\\", title: "p", sessionIds: ["s1"] }]);
  assert.deepEqual(sessionForRoot(sessions, workspaces, "c:/proj"), {
    sessionId: "s1",
    cwd: "C:\\Proj\\",
  });
});

test("sessionForRoot 根下没有会话时返回 null（不猜会话）", () => {
  const sessions: SessionsSnapshot = { byId: {}, current: "s1" };
  const workspaces = wss([{ workspaceId: "w1", path: "C:\\a", title: "a", sessionIds: [] }]);
  assert.equal(sessionForRoot(sessions, workspaces, "C:\\a"), null);
  assert.equal(sessionForRoot(sessions, workspaces, "C:\\other"), null);
});

test("sessionForRoot 容错 sessionIds 缺失（host 投影时序）", () => {
  const sessions: SessionsSnapshot = { byId: {}, current: "s1" };
  const workspaces: WorkspacesSnapshot = {
    items: [{ workspaceId: "w1", path: "C:\\a", title: "a" }],
    archivedSessionIds: [],
  };
  assert.equal(sessionForRoot(sessions, workspaces, "C:\\a"), null);
});

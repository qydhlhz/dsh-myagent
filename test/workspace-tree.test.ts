// test/workspace-tree.test.ts — 工作区「原生工作区树」分级的语义锁。
//
// 这些用例的期望值直接来自官方 @deepseek-ai/dsh-client-ui-workspace 的
// folderPath / owningParentFolder 实现（源码逐字复刻，见 src/client/workspace-tree.ts 抬头），
// 所以它们同时锁住"插件与原生分级结果一致"这件事。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ancestorsOf,
  buildWorkspaceTree,
  folderPath,
  owningParentFolder,
} from "../src/client/workspace-tree.ts";

const ws = (workspaceId: string, path: string) => ({ workspaceId, path });

test("folderPath 只为 Windows 风格路径折反斜杠，并去掉末尾斜杠", () => {
  // 盘符与 UNC 折成正斜杠
  assert.equal(folderPath("D:\\work\\proj"), "D:/work/proj");
  assert.equal(folderPath("\\\\server\\share\\x"), "//server/share/x");
  // POSIX 路径里的反斜杠是**合法文件名字符**，不能当分隔符折掉
  assert.equal(folderPath("/home/me/a\\b"), "/home/me/a\\b");
  // 末尾斜杠一律去掉（含多个）
  assert.equal(folderPath("D:\\work\\proj\\"), "D:/work/proj");
  assert.equal(folderPath("/home/me///"), "/home/me");
});

test("owningParentFolder：真包含才算父子，相等不算，取最长前缀（最近祖先）", () => {
  const parents = ["/a", "/a/b", "/a/b/c", "/x"];
  assert.equal(owningParentFolder("/a/b/c/d", parents), "/a/b/c");
  assert.equal(owningParentFolder("/a/b/z", parents), "/a/b");
  assert.equal(owningParentFolder("/a/z", parents), "/a");
  // 等于自身 → 不是自己的祖先
  assert.equal(owningParentFolder("/a/b", parents), "/a");
  // 仅仅前缀相同但不是路径段（/ab 不以 "/a/" 开头）→ 不算
  assert.equal(owningParentFolder("/ab", parents), undefined);
  assert.equal(owningParentFolder("/y", parents), undefined);
});

test("owningParentFolder：分隔符与末尾斜杠差异不影响判定（Windows 拼写混用）", () => {
  assert.equal(owningParentFolder("D:\\work\\proj", ["D:/work"]), "D:/work");
  assert.equal(owningParentFolder("D:/work/proj", ["D:\\work\\"]), "D:\\work\\");
});

test("owningParentFolder：大小写敏感（与工作区身份一致）", () => {
  assert.equal(owningParentFolder("D:/Work/proj", ["D:/work"]), undefined);
  assert.equal(owningParentFolder("D:/work/proj", ["D:/work"]), "D:/work");
});

test("buildWorkspaceTree：深度优先排序，父级在前、子树紧随、兄弟保持宿主顺序", () => {
  const items = [
    ws("w1", "D:/work"),
    ws("w2", "D:/work/proj-a"),
    ws("w3", "D:/other"),
    ws("w4", "D:/work/proj-a/sub"),
    ws("w5", "D:/work/proj-b"),
  ];
  const tree = buildWorkspaceTree(items);
  assert.equal(tree.hasNesting, true);
  assert.deepEqual(
    tree.order.map((r) => [r.item.workspaceId, r.depth, r.hasChildren]),
    [
      ["w1", 0, true],   // D:/work        有子级
      ["w2", 1, true],   // └ proj-a       有子级
      ["w4", 2, false],  //   └ sub
      ["w5", 1, false],  // └ proj-b
      ["w3", 0, false],  // D:/other 保持宿主顺序排在 work 之后
    ],
  );
  assert.equal(tree.parents.get("w1"), undefined);
  assert.equal(tree.parents.get("w2"), "w1");
  assert.equal(tree.parents.get("w4"), "w2");
  assert.equal(tree.parents.get("w5"), "w1");
  assert.equal(tree.parents.get("w3"), undefined);
});

test("buildWorkspaceTree：没有任何嵌套时 hasNesting=false，顺序与传入顺序完全一致", () => {
  const items = [ws("a", "D:/x"), ws("b", "D:/y"), ws("c", "/z")];
  const tree = buildWorkspaceTree(items);
  assert.equal(tree.hasNesting, false);
  assert.deepEqual(tree.order.map((r) => r.item.workspaceId), ["a", "b", "c"]);
  assert.deepEqual(tree.order.map((r) => r.depth), [0, 0, 0]);
});

test("buildWorkspaceTree：删除父级后子级自动挂到下一个已注册祖先，没有祖先则成为根", () => {
  const before = buildWorkspaceTree([ws("g", "/a"), ws("p", "/a/b"), ws("c", "/a/b/c")]);
  assert.equal(before.parents.get("c"), "p");
  // 删掉中间层 p：c 应当挂到 g
  const after = buildWorkspaceTree([ws("g", "/a"), ws("c", "/a/b/c")]);
  assert.equal(after.parents.get("c"), "g");
  assert.equal(after.order.find((r) => r.item.workspaceId === "c")?.depth, 1);
  // 再把 g 也删掉：c 变根
  const alone = buildWorkspaceTree([ws("c", "/a/b/c")]);
  assert.equal(alone.parents.get("c"), undefined);
  assert.equal(alone.order[0].depth, 0);
});

test("buildWorkspaceTree：同路径的多条注册不会互相当父子（相等不算包含）", () => {
  // 官方允许同一目录被登记多次（不同 workspaceId），彼此不能成为对方的父级。
  const tree = buildWorkspaceTree([ws("a", "/dup"), ws("b", "/dup")]);
  assert.equal(tree.parents.get("a"), undefined);
  assert.equal(tree.parents.get("b"), undefined);
  assert.equal(tree.hasNesting, false);
});

test("roots 与 childrenOf：渲染器靠这两个表递归，父级折叠时子树自然不渲染", () => {
  const { roots, childrenOf, parents } = buildWorkspaceTree([
    ws("a", "/a"),
    ws("b", "/a/b"),
    ws("c", "/a/b/c"),
    ws("d", "/x"),
  ]);
  assert.deepEqual(roots.map((r) => r.workspaceId), ["a", "d"]);
  assert.deepEqual((childrenOf.get("a") ?? []).map((r) => r.workspaceId), ["b"]);
  assert.deepEqual((childrenOf.get("b") ?? []).map((r) => r.workspaceId), ["c"]);
  assert.equal(childrenOf.get("c"), undefined); // 叶子没有该键
  assert.equal(childrenOf.get("d"), undefined);
  // 折叠 a 时渲染器不再进入 a 的子级块 → b、c 都不渲染。这里断言"它们确实只在 a 之下"。
  assert.deepEqual(ancestorsOf("c", parents), ["b", "a"]);
});

test("ancestorsOf：沿父链向上收集全部祖先，自身不在其中", () => {
  const { parents } = buildWorkspaceTree([
    ws("a", "/a"),
    ws("b", "/a/b"),
    ws("c", "/a/b/c"),
    ws("d", "/a/b/c/d"),
  ]);
  assert.deepEqual(ancestorsOf("d", parents), ["c", "b", "a"]);
  assert.deepEqual(ancestorsOf("b", parents), ["a"]);
  assert.deepEqual(ancestorsOf("a", parents), []);
});

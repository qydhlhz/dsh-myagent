// test/viewer-store.test.ts — viewer-store 模块级 store 测试（openViewer/closeViewer/
// getViewerState/subscribe 通知；useViewerState 是 React hook，不在 node 测试里调用）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeViewer, getViewerState, openViewer, subscribeViewer } from "../src/client/viewer-store.ts";

test("初始为空态", () => {
  closeViewer();
  assert.deepEqual(getViewerState(), { root: null, path: null });
});

test("openViewer 写入 root/path，getViewerState 返回同一快照引用", () => {
  closeViewer();
  openViewer("C:\\proj", "src/a.ts");
  const s1 = getViewerState();
  assert.deepEqual(s1, { root: "C:\\proj", path: "src/a.ts" });
  assert.equal(getViewerState(), s1); // 未变化时快照引用稳定（useSyncExternalStore 要求）
});

test("openViewer 切换文件产生新快照", () => {
  openViewer("C:\\proj", "b.ts");
  assert.deepEqual(getViewerState(), { root: "C:\\proj", path: "b.ts" });
});

test("closeViewer 清空并通知订阅者", () => {
  closeViewer();
  let notified = 0;
  const unsub = subscribeViewer(() => {
    notified += 1;
  });
  openViewer("C:\\proj", "a.ts");
  assert.equal(notified, 1);
  closeViewer();
  assert.equal(notified, 2);
  assert.deepEqual(getViewerState(), { root: null, path: null });
  unsub();
  closeViewer(); // 已退订，不再通知
  assert.equal(notified, 2);
});

test("重复 openViewer（同 root/path）不触发通知", () => {
  openViewer("C:\\proj", "a.ts");
  let notified = 0;
  const unsub = subscribeViewer(() => {
    notified += 1;
  });
  openViewer("C:\\proj", "a.ts");
  assert.equal(notified, 0);
  unsub();
});

test("重复 closeViewer（空态）不触发通知", () => {
  closeViewer();
  let notified = 0;
  const unsub = subscribeViewer(() => {
    notified += 1;
  });
  closeViewer();
  assert.equal(notified, 0);
  unsub();
});

test("订阅函数返回退订函数，可多次调用不报错", () => {
  const unsub = subscribeViewer(() => {});
  unsub();
  unsub();
  assert.ok(true);
});

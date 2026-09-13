// test/active-root-store.test.ts — 文件树"当前根"显式选择的纯 store 测试。
// 语义契约：显式选择优先于推导值；重复设置同一值不通知；clear 幂等；
// 订阅/退订正确。消费方（ComposedInner）在此之上加"切换会话即清除"。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearActiveRoot,
  getActiveRoot,
  setActiveRoot,
  subscribeActiveRoot,
} from "../src/client/active-root-store.ts";

test("初始无显式选择（回落到推导根）", () => {
  clearActiveRoot();
  assert.equal(getActiveRoot(), null);
});

test("setActiveRoot 记录选择并可读回", () => {
  setActiveRoot("D:/ws-a");
  assert.equal(getActiveRoot(), "D:/ws-a");
  setActiveRoot("D:/ws-b");
  assert.equal(getActiveRoot(), "D:/ws-b");
  clearActiveRoot();
});

test("重复设置同一个根不触发通知（避免无谓重渲染）", () => {
  clearActiveRoot();
  let notified = 0;
  const off = subscribeActiveRoot(() => {
    notified += 1;
  });
  setActiveRoot("D:/ws-a");
  assert.equal(notified, 1, "首次设置应通知一次");
  setActiveRoot("D:/ws-a");
  assert.equal(notified, 1, "同值重复设置不应再通知");
  setActiveRoot("D:/ws-b");
  assert.equal(notified, 2, "换值应通知");
  off();
  clearActiveRoot();
});

test("clearActiveRoot 幂等：未选择时是空操作", () => {
  clearActiveRoot();
  let notified = 0;
  const off = subscribeActiveRoot(() => {
    notified += 1;
  });
  clearActiveRoot();
  assert.equal(notified, 0, "本来就没选择，不应通知");
  setActiveRoot("D:/ws-a");
  assert.equal(notified, 1);
  clearActiveRoot();
  assert.equal(notified, 2, "有选择时清除应通知");
  clearActiveRoot();
  assert.equal(notified, 2, "再次清除不应通知");
  off();
});

test("退订后不再收到通知", () => {
  clearActiveRoot();
  let notified = 0;
  const off = subscribeActiveRoot(() => {
    notified += 1;
  });
  off();
  setActiveRoot("D:/ws-a");
  assert.equal(notified, 0);
  clearActiveRoot();
});

test("多个订阅者都被通知", () => {
  clearActiveRoot();
  const seen: string[] = [];
  const offA = subscribeActiveRoot(() => seen.push("a"));
  const offB = subscribeActiveRoot(() => seen.push("b"));
  setActiveRoot("D:/ws-x");
  assert.deepEqual(seen.sort(), ["a", "b"]);
  offA();
  offB();
  clearActiveRoot();
});

test("点不同区来回切换：每次换值都通知一次", () => {
  clearActiveRoot();
  let notified = 0;
  const off = subscribeActiveRoot(() => {
    notified += 1;
  });
  setActiveRoot("D:/a");
  setActiveRoot("D:/b");
  setActiveRoot("D:/a");
  assert.equal(notified, 3);
  off();
  clearActiveRoot();
});

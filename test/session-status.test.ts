// test/session-status.test.ts — 会话行状态点语义测试（等待用户 vs 运行中）。
//
// 修的是什么：宿主在等审批 / 等回答时，会话那一侧的回合仍在跑（摘要 running 依旧 true），
// 而"等待用户"这个位**不在会话摘要里**，必须从槽位全局标准套件的 `useSessionStatus`
// 快照按会话 id 取统一 UI 状态（dsh 0.2 的 SessionStatus = { running, pendingInteraction,
// completionUnread }；0.1.5 那条 `useSessionPendingInteraction` 通道在 0.2 已不存在）。
// 旧实现只读摘要字段 → 等待态永远落到 running 分支 → 与"正常执行"同款蓝色脉冲点，用户分不出来。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mainSessionId,
  pendingKindOf,
  sessionDotKind,
  SESSION_DOT_LABEL,
  visiblePendingKind,
  type SessionStatusSnapshot,
} from "../src/client/tree-utils.ts";
import { DOT_VISUAL, dotPresentation } from "../src/client/ui-kit.ts";

const summary = (over: Partial<{ running: boolean; blank: boolean }> = {}) => ({
  id: "s1",
  title: "会话",
  ...over,
});

test("visiblePendingKind 只认三个待交互域，未知/空当没有", () => {
  assert.equal(visiblePendingKind("approval"), "approval");
  assert.equal(visiblePendingKind("plan-review"), "plan-review");
  assert.equal(visiblePendingKind("question"), "question");
  assert.equal(visiblePendingKind("tool-call"), undefined);
  assert.equal(visiblePendingKind(undefined), undefined);
});

test("pendingKindOf 按会话 id 取统一状态里的待交互域，缺键/未知 kind 返回 undefined", () => {
  const statuses: SessionStatusSnapshot = new Map([
    ["s1", { running: true, pendingInteraction: { kind: "approval", sessionId: "s1" }, completionUnread: false }],
    ["s2", { running: true, pendingInteraction: { kind: "question", sessionId: "s2" }, completionUnread: false }],
    ["s3", { running: true, pendingInteraction: { kind: "whatever", sessionId: "s3" }, completionUnread: false }],
    // 有状态但没有待交互位 —— 不得抛，返回 undefined。
    ["s4", { running: true, completionUnread: false }],
  ]);
  assert.equal(pendingKindOf(statuses, "s1"), "approval");
  assert.equal(pendingKindOf(statuses, "s2"), "question");
  assert.equal(pendingKindOf(statuses, "s3"), undefined);
  assert.equal(pendingKindOf(statuses, "s4"), undefined);
  assert.equal(pendingKindOf(statuses, "s9"), undefined);
  assert.equal(pendingKindOf(undefined, "s1"), undefined);
});

test("等待用户压过运行中：running=true 且有待交互时出待交互态（本轮修复的核心）", () => {
  // 宿主等审批/等回答时回合仍在跑 —— 这正是旧实现显示成蓝色脉冲点的场景。
  for (const [kind, expected] of [
    ["approval", "approval"],
    ["plan-review", "plan-review"],
    ["question", "question"],
  ] as const) {
    assert.equal(
      sessionDotKind({
        id: "s1",
        summary: summary({ running: true }),
        status: { running: true, pendingInteraction: { kind, sessionId: "s1" }, completionUnread: false },
      }),
      expected,
    );
  }
  // 没有待交互时才是运行中。
  assert.equal(
    sessionDotKind({ id: "s1", summary: summary({ running: true }), status: { running: true, completionUnread: false } }),
    "running",
  );
});

test("统一状态优先于摘要的 running 兜底", () => {
  // 状态说没在跑、摘要还停在 true → 以状态为准（官方 ui-workspace 同款口径）。
  assert.equal(
    sessionDotKind({ id: "s1", summary: summary({ running: true }), status: { running: false, completionUnread: false } }),
    "idle",
  );
  // 状态缺席（该会话还没有状态条目）→ 退回摘要的 running。
  assert.equal(sessionDotKind({ id: "s1", summary: summary({ running: true }) }), "running");
  // 摘要字段是未知值 → 当没有，落到空闲。
  assert.equal(sessionDotKind({ id: "s1", summary: summary({ running: false }) }), "idle");
});

test("其余优先级：已完成待读 > 空白 > 当前 > 空闲", () => {
  const done = { running: false, completionUnread: true };
  assert.equal(sessionDotKind({ id: "s1", summary: summary(), status: done }), "completed");
  assert.equal(sessionDotKind({ id: "s1", summary: summary(), status: done, current: "s1" }), "completed");
  assert.equal(sessionDotKind({ id: "s1", summary: summary({ blank: true }), current: "s1" }), "blank");
  assert.equal(sessionDotKind({ id: "s1", summary: summary(), current: "s1" }), "current");
  assert.equal(sessionDotKind({ id: "s1", summary: summary() }), "idle");
  // 列表还没到（摘要缺失）→ 不渲染点。
  assert.equal(sessionDotKind({ id: "s1", summary: undefined }), undefined);
});

test("当前会话按 mainView 引用来源推导（0.2 已无 current 字段）", () => {
  const list = {
    byId: {
      s1: { id: "s1", retainedBy: { gateway: 1 } },
      s2: { id: "s2", retainedBy: { mainView: 1, controllerOperation: 1 } },
      s3: { id: "s3", retainedBy: {} },
    },
  };
  assert.equal(mainSessionId(list), "s2");
  // 没有任何 mainView 引用（例如打开的是全局面板）→ undefined，不误标"当前会话"。
  assert.equal(mainSessionId({ byId: { s1: { id: "s1", retainedBy: { gateway: 2 } } } }), undefined);
  // 摘要没有 retainedBy（旧快照/测试桩）→ 不抛。
  assert.equal(mainSessionId({ byId: { s1: { id: "s1" } } }), undefined);
});

test("每种状态都有中文悬停提示", () => {
  for (const kind of Object.keys(DOT_VISUAL) as Array<keyof typeof DOT_VISUAL>) {
    assert.equal(typeof SESSION_DOT_LABEL[kind], "string");
    assert.notEqual(SESSION_DOT_LABEL[kind], "");
  }
});

test("等待态的视觉与运行态明显区分：颜色不同 + 动效档不同 + 带光环", () => {
  const running = dotPresentation("running", 8);
  const approval = dotPresentation("approval", 8);
  const question = dotPresentation("question", 8);

  // 动效档：运行 = 呼吸脉冲，等待 = 双闪（节奏不同，余光可辨）。
  assert.equal(running.className, "fm-dot fm-dot-pulse");
  assert.equal(approval.className, "fm-dot fm-dot-attention");
  assert.equal(question.className, "fm-dot fm-dot-attention");

  // 颜色：运行是蓝色 token，等待是琥珀 token / 亮黄，两两不同。
  assert.equal(running.style.background, "var(--dsw-alias-state-business-primary)");
  assert.equal(approval.style.background, "var(--dsw-alias-state-warn-primary)");
  assert.equal(question.style.background, "#FACC15");
  assert.notEqual(running.style.background, approval.style.background);

  // 光环：等待态有 --fm-dot-halo（CSS 里画 2px 柔光环），运行态没有。
  assert.equal(running.style["--fm-dot-halo"], undefined);
  assert.equal(typeof approval.style["--fm-dot-halo"], "string");
  assert.equal(typeof question.style["--fm-dot-halo"], "string");
});

test("静态状态点不带动效类；空白新会话是空心点", () => {
  for (const kind of ["completed", "current", "idle"] as const) {
    const { className } = dotPresentation(kind, 8);
    assert.equal(className, "fm-dot");
  }
  const blank = dotPresentation("blank", 8);
  assert.equal(blank.className, "fm-dot");
  assert.equal(blank.style.background, undefined);
  assert.equal(typeof blank.style.border, "string");
});

test("状态点尺寸跟随调用点（宽态会话行与 rail 都是 8px）", () => {
  const { style } = dotPresentation("running", 8);
  assert.equal(style.width, 8);
  assert.equal(style.height, 8);
});

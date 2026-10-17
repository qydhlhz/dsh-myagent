// test/session-rename.test.ts — 「给任意会话改名」这条路径的回归测试。
//
// 背景：桌面版 DSH（0.2.0-rc.2）把客户端会话服务的 `binding` 改成了**保留引用上的 getter**
// （`SessionReference.get binding()`，服务本身没有这个方法）。插件当时写的是
// `ctx.sessions.binding(id)?.session.rename(title)`，于是直接 TypeError；又因为调用点
// "发了不等"，异常变成 unhandled rejection —— **改名静默失效**（标题只写进插件自己的
// annotations.json，dsh 侧永远是旧名字）。这里把两条路径都钉死，防止再次回归。
import { test } from "node:test";
import assert from "node:assert/strict";

import { renameSessionVia, type SessionsLike } from "../src/client/session-rename.ts";

/** 新版 dsh：只有 using（binding 是引用上的 getter，服务上没有）。 */
function modernSessions(onRename: (sessionId: string, title: string) => unknown) {
  const calls: Array<{ via: string; sessionId: string; title: string; source?: string }> = [];
  const sessions: SessionsLike = {
    async using(target, options, operation) {
      const reference = {
        binding: {
          session: {
            async rename(title: string) {
              calls.push({ via: "using", sessionId: target, title, source: options.source });
              return onRename(target, title);
            },
          },
        },
      };
      return operation(reference);
    },
  };
  return { sessions, calls };
}

/** 旧版 dsh：只有 binding（同步返回已绑定的会话，未打开则为 undefined）。 */
function legacySessions(bound: Record<string, boolean>, onRename?: (id: string, title: string) => unknown) {
  const calls: Array<{ via: string; sessionId: string; title: string }> = [];
  const sessions: SessionsLike = {
    binding(sessionId: string) {
      if (!bound[sessionId]) return undefined;
      return {
        session: {
          async rename(title: string) {
            calls.push({ via: "binding", sessionId, title });
            return (onRename?.(sessionId, title) ?? { ok: true }) as any;
          },
        },
      };
    },
  };
  return { sessions, calls };
}

test("新版 dsh：走 sessions.using，且能改**没被打开过**的会话", async () => {
  const { sessions, calls } = modernSessions(() => ({ ok: true, value: { title: "meta分析：已检索完文献", seq: 7 } }));
  await renameSessionVia(sessions, "session-never-opened", "meta分析：已检索完文献");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].via, "using");
  assert.equal(calls[0].sessionId, "session-never-opened");
  assert.equal(calls[0].title, "meta分析：已检索完文献");
  assert.equal(calls[0].source, "myagentOrganizer", "要带 source 标签（retainedBy 记账用）");
});

test("新版 dsh：宿主拒绝（ok:false）必须抛错，而不是静默成功", async () => {
  const { sessions } = modernSessions(() => ({ ok: false, error: { message: "title rejected by host" } }));
  await assert.rejects(
    () => renameSessionVia(sessions, "s1", "x：y"),
    /title rejected by host/,
    "失败必须冒泡成异常，调用方才能提示用户",
  );
});

test("旧版 dsh：没有 using 时退回 binding 路径", async () => {
  const { sessions, calls } = legacySessions({ s1: true });
  await renameSessionVia(sessions, "s1", "旧版：改名成功");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].via, "binding");
});

test("旧版 dsh：会话未绑定时报可读错误", async () => {
  const { sessions } = legacySessions({ s1: false });
  await assert.rejects(() => renameSessionVia(sessions, "s2", "x"), /unknown session "s2"/);
});

test("服务形状完全不认识时也要报错（不静默）", async () => {
  await assert.rejects(() => renameSessionVia({} as SessionsLike, "s3", "x"), /unknown session "s3"/);
  await assert.rejects(() => renameSessionVia(undefined, "s3", "x"), /unknown session "s3"/);
});

test("回归：旧写法 `ctx.sessions.binding(...)` 在新版服务上会 TypeError（说明为何要 using）", () => {
  const modern: any = { using: async () => ({ ok: true }) };
  assert.equal(typeof modern.binding, "undefined", "新版服务上没有 binding 方法");
  assert.throws(() => modern.binding("s1"), TypeError);
});

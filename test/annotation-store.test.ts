import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANNOTATIONS_PATH,
  emptyAnnotations,
  parseAnnotations,
  serializeAnnotations,
  setWorkspaceBrief,
  setGroupBrief,
  setSessionBrief,
  setLastPlan,
  setLastOrganizedAt,
  deriveBriefFromTitle,
  loadAnnotations,
  saveAnnotations,
} from "../src/client/annotation-store.ts";
import type { Api, ApiResult, ReadResult, WriteResult } from "../src/client/api.ts";

function fakeApi(overrides: {
  read?: (path: string) => Promise<ApiResult<ReadResult>>;
  write?: (path: string, content: string, expectedVersion?: unknown) => Promise<ApiResult<WriteResult>>;
}): Api {
  return {
    root: "/tmp",
    read: overrides.read ?? (async () => ({ ok: false, status: 404, code: "NOT_FOUND", message: "x" })),
    write: overrides.write ?? (async () => ({ ok: true, data: { version: "v2" } })),
  } as unknown as Api;
}

test("emptyAnnotations 为空标注", () => {
  const a = emptyAnnotations();
  assert.equal(a.version, 1);
  assert.deepEqual(a.workspaces, {});
  assert.deepEqual(a.groups, {});
  assert.deepEqual(a.sessions, {});
});

test("parseAnnotations 解析合法 JSON", () => {
  const text = JSON.stringify({
    version: 1,
    workspaces: { w1: { id: "w1", brief: "沙盒", updatedAt: "2026-08-16T00:00:00.000Z" } },
    groups: { g1: { id: "g1", brief: "分组", updatedAt: "2026-08-16T00:00:00.000Z", workspaceId: "w1" } },
    sessions: { s1: { id: "s1", title: "标题", brief: "会话", updatedAt: "2026-08-16T00:00:00.000Z" } },
    lastOrganizedAt: "2026-08-16T01:00:00.000Z",
    lastPlan: { actions: [] },
  });
  const a = parseAnnotations(text);
  assert.equal(a.workspaces.w1?.brief, "沙盒");
  assert.equal(a.groups.g1?.workspaceId, "w1");
  assert.equal(a.sessions.s1?.title, "标题");
  assert.equal(a.lastOrganizedAt, "2026-08-16T01:00:00.000Z");
  assert.deepEqual(a.lastPlan, { actions: [] });
});

test("parseAnnotations 对 null/空串/坏 JSON 返回空标注", () => {
  assert.equal(parseAnnotations(null).version, 1);
  assert.equal(parseAnnotations("").version, 1);
  assert.equal(parseAnnotations("{bad").version, 1);
});

test("serializeAnnotations/parseAnnotations 往返", () => {
  const a = setSessionBrief(emptyAnnotations(), "s1", "标题", "会话");
  const back = parseAnnotations(serializeAnnotations(a));
  assert.equal(back.sessions.s1?.brief, "会话");
  assert.equal(back.sessions.s1?.title, "标题");
});

test("setWorkspaceBrief/setGroupBrief/setSessionBrief 不可变更新", () => {
  const base = emptyAnnotations();
  const w = setWorkspaceBrief(base, "w1", "沙盒");
  assert.equal(base.workspaces.w1, undefined);
  assert.equal(w.workspaces.w1?.brief, "沙盒");
  const g = setGroupBrief(w, "g1", "w1", "分组");
  assert.equal(g.groups.g1?.workspaceId, "w1");
  const s = setSessionBrief(g, "s1", "标题", "会话");
  assert.equal(s.sessions.s1?.title, "标题");
});

test("setLastPlan/setLastOrganizedAt 写入快照字段", () => {
  const a = setLastOrganizedAt(setLastPlan(emptyAnnotations(), { actions: [1] }), "2026-08-16T00:00:00.000Z");
  assert.deepEqual(a.lastPlan, { actions: [1] });
  assert.equal(a.lastOrganizedAt, "2026-08-16T00:00:00.000Z");
});

test("deriveBriefFromTitle 生成一句话简述", () => {
  assert.equal(deriveBriefFromTitle(" 修复登录 "), "对话：修复登录");
  assert.equal(deriveBriefFromTitle("  "), "");
});

test("loadAnnotations 404 时返回空标注", async () => {
  const api = fakeApi({});
  const { data, version } = await loadAnnotations(api);
  assert.equal(data.version, 1);
  assert.equal(version, undefined);
});

test("loadAnnotations 解析已有文件并带版本", async () => {
  const api = fakeApi({
    read: async () => ({
      ok: true,
      data: {
        path: ANNOTATIONS_PATH,
        kind: "text",
        mime: "application/json",
        size: 1,
        truncated: false,
        editable: true,
        content: JSON.stringify({ version: 1, workspaces: {}, groups: {}, sessions: {} }),
        version: "v1",
      },
    }),
  });
  const { data, version } = await loadAnnotations(api);
  assert.equal(version, "v1");
  assert.deepEqual(data.sessions, {});
});

test("saveAnnotations 写回并返回新版本", async () => {
  let written: any;
  const api = fakeApi({
    write: async (_path: string, content: string, expectedVersion?: unknown) => {
      written = { path: _path, content, expectedVersion };
      return { ok: true, data: { version: "v2" } };
    },
  });
  const version = await saveAnnotations(api, emptyAnnotations(), "v1");
  assert.equal(version, "v2");
  assert.equal(written.path, ANNOTATIONS_PATH);
  assert.equal(written.expectedVersion, "v1");
  assert.ok(JSON.parse(written.content).version === 1);
});

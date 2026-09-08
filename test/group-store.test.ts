import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GROUP_ID,
  applyMutation,
  replayMutations,
  emptyGroups,
  parseGroups,
  serializeGroups,
  groupOfSession,
  visibleSessionsForGroup,
  createGroup,
  addGroup,
  renameGroup,
  moveSessionToGroup,
  deleteGroup,
  reorderGroups,
  reorderSessionInGroup,
  loadGroups,
  saveGroups,
  GROUPS_PATH,
} from "../src/client/group-store.ts";
import type { Api, ApiResult, ReadResult, WriteResult } from "../src/client/api.ts";
import { describeApiError } from "../src/client/api.ts";

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

test("emptyGroups 只含默认分组", () => {
  const g = emptyGroups();
  assert.equal(g.version, 1);
  assert.equal(g.defaultGroup.id, DEFAULT_GROUP_ID);
  assert.deepEqual(g.groups, []);
});

test("parseGroups 解析合法 JSON", () => {
  const text = JSON.stringify({
    version: 1,
    defaultGroup: { id: "default", name: "收件箱" },
    groups: [{ id: "g1", name: "工作", sessionIds: ["s1", "s2"] }],
  });
  const g = parseGroups(text);
  assert.equal(g.defaultGroup.name, "收件箱");
  assert.equal(g.groups.length, 1);
  assert.deepEqual(g.groups[0].sessionIds, ["s1", "s2"]);
});

test("parseGroups 对 null/空串/坏 JSON 返回默认分组", () => {
  assert.equal(parseGroups(null).groups.length, 0);
  assert.equal(parseGroups("").defaultGroup.name, "默认分组");
  assert.equal(parseGroups("{bad").defaultGroup.name, "默认分组");
});

test("serializeGroups/parseGroups 往返", () => {
  const g = createGroup(emptyGroups(), "项目A");
  const back = parseGroups(serializeGroups(g));
  assert.equal(back.groups.length, 1);
  assert.equal(back.groups[0].name, "项目A");
});

test("groupOfSession 返回所属命名分组或默认", () => {
  const g = createGroup(emptyGroups(), "工作");
  const withSession = moveSessionToGroup(g, "s1", g.groups[0].id);
  assert.equal(groupOfSession(withSession, "s1"), g.groups[0].id);
  assert.equal(groupOfSession(withSession, "s2"), DEFAULT_GROUP_ID);
});

test("visibleSessionsForGroup 默认分组排除命名分组会话", () => {
  const g = createGroup(emptyGroups(), "工作");
  const withSession = moveSessionToGroup(g, "s1", g.groups[0].id);
  assert.deepEqual(visibleSessionsForGroup(withSession, DEFAULT_GROUP_ID, ["s1", "s2"]), ["s2"]);
  assert.deepEqual(visibleSessionsForGroup(withSession, g.groups[0].id, ["s1", "s2"]), ["s1"]);
});

test("createGroup 追加到末尾", () => {
  const g = createGroup(emptyGroups(), "A");
  const g2 = createGroup(g, "B");
  assert.deepEqual(g2.groups.map((x) => x.name), ["A", "B"]);
});

test("addGroup 使用稳定的分组对象，重复调用不会生成新 id", () => {
  const group = createGroup(emptyGroups(), "A").groups[0];
  const once = addGroup(emptyGroups(), group);
  const twice = addGroup(once, group);
  assert.deepEqual(twice.groups.map((g) => g.id), [group.id]);
  assert.equal(twice.groups[0].name, "A");
});

test("renameGroup 可改默认分组与命名分组", () => {
  const g = renameGroup(emptyGroups(), DEFAULT_GROUP_ID, "收件箱");
  assert.equal(g.defaultGroup.name, "收件箱");
  const created = createGroup(emptyGroups(), "A");
  const renamed = renameGroup(created, created.groups[0].id, "B");
  assert.equal(renamed.groups[0].name, "B");
});

test("moveSessionToGroup 移入/移出命名分组", () => {
  const g = createGroup(emptyGroups(), "工作");
  const id = g.groups[0].id;
  const inGroup = moveSessionToGroup(g, "s1", id);
  assert.deepEqual(inGroup.groups[0].sessionIds, ["s1"]);
  const backToDefault = moveSessionToGroup(inGroup, "s1", DEFAULT_GROUP_ID);
  assert.deepEqual(backToDefault.groups[0].sessionIds, []);
});

test("deleteGroup 移到默认分组/其他分组/归档", () => {
  const g = createGroup(emptyGroups(), "工作");
  const id = g.groups[0].id;
  const withS = moveSessionToGroup(g, "s1", id);
  const toDefault = deleteGroup(withS, id, "default");
  assert.deepEqual(toDefault.data.groups, []);
  assert.deepEqual(toDefault.sessionsToArchive, []);

  const g2 = createGroup(emptyGroups(), "工作");
  const id2 = g2.groups[0].id;
  const g3 = createGroup(g2, "项目");
  const id3 = g3.groups[1].id;
  const withS2 = moveSessionToGroup(moveSessionToGroup(g3, "s1", id2), "s2", id2);
  const toOther = deleteGroup(withS2, id2, id3);
  assert.deepEqual(toOther.sessionsToArchive, []);
  const project = toOther.data.groups.find((x) => x.id === id3)!;
  assert.deepEqual(project.sessionIds, ["s1", "s2"]);

  const g4 = createGroup(emptyGroups(), "工作");
  const id4 = g4.groups[0].id;
  const withS3 = moveSessionToGroup(g4, "s1", id4);
  const archived = deleteGroup(withS3, id4, "archive");
  assert.deepEqual(archived.sessionsToArchive, ["s1"]);
  assert.deepEqual(archived.data.groups, []);
});

test("reorderGroups 调整命名分组顺序（移到目标之前）", () => {
  const g = createGroup(createGroup(emptyGroups(), "A"), "B");
  const aId = g.groups[0].id;
  const bId = g.groups[1].id;
  const reordered = reorderGroups(g, aId, bId);
  assert.deepEqual(reordered.groups.map((x) => x.id), [aId, bId]);
  const down = reorderGroups(reordered, bId, aId);
  assert.deepEqual(down.groups.map((x) => x.id), [bId, aId]);
});

test("mutate 可把本地变更合并到外部最新数据", () => {
  const base = createGroup(emptyGroups(), "外部");
  const merged = applyMutation(base, (data) => createGroup(data, "本地"));
  assert.deepEqual(merged.groups.map((x) => x.name), ["外部", "本地"]);
});

test("replayMutations 从外部数据合并连续本地操作", () => {
  const external = createGroup(emptyGroups(), "外部");
  const result = replayMutations(external, [
    (d) => createGroup(d, "A"),
    (d) => createGroup(d, "B"),
  ]);
  assert.deepEqual(result.groups.map((x) => x.name), ["外部", "A", "B"]);
});

test("deleteGroup 不允许删除默认分组", () => {
  const res = deleteGroup(emptyGroups(), DEFAULT_GROUP_ID, "default");
  assert.equal(res.data.groups.length, 0);
  assert.deepEqual(res.sessionsToArchive, []);
});

test("loadGroups 404 时返回空默认分组", async () => {
  const api = fakeApi({});
  const { data, version } = await loadGroups(api);
  assert.equal(data.groups.length, 0);
  assert.equal(data.defaultGroup.name, "默认分组");
  assert.equal(version, undefined);
});

test("loadGroups 解析已有文件并带版本", async () => {
  const api = fakeApi({
    read: async () => ({
      ok: true,
      data: {
        path: GROUPS_PATH,
        kind: "text",
        mime: "application/json",
        size: 1,
        truncated: false,
        editable: true,
        content: JSON.stringify({ version: 1, defaultGroup: { id: "default", name: "收件箱" }, groups: [] }),
        version: "v1",
      },
    }),
  });
  const { data, version } = await loadGroups(api);
  assert.equal(data.defaultGroup.name, "收件箱");
  assert.equal(version, "v1");
});

test("saveGroups 写回并返回新版本", async () => {
  let written: any;
  const api = fakeApi({
    write: async (_path: string, content: string, expectedVersion?: unknown) => {
      written = { path: _path, content, expectedVersion };
      return { ok: true, data: { version: "v2" } };
    },
  });
  const version = await saveGroups(api, emptyGroups(), "v1");
  assert.equal(version, "v2");
  assert.equal(written.path, GROUPS_PATH);
  assert.equal(written.expectedVersion, "v1");
  assert.ok(JSON.parse(written.content).defaultGroup);
});

test("saveGroups 失败时抛出带 code/status 的错误", async () => {
  const api = fakeApi({
    write: async () => ({ ok: false, status: 409, code: "FS_STALE_VERSION", message: "stale" }),
  });
  await assert.rejects(
    saveGroups(api, emptyGroups(), "v1"),
    (err: any) => {
      assert.equal(err.message, "stale");
      assert.equal(err.code, "FS_STALE_VERSION");
      assert.equal(err.status, 409);
      assert.equal(describeApiError(err), "文件已被修改，请重新加载后再保存");
      return true;
    },
  );
});

test("reorderGroups 默认分组不参与", () => {
  const g = emptyGroups();
  assert.deepEqual(reorderGroups(g, DEFAULT_GROUP_ID, "some-group"), g);
});

test("visibleSessionsForGroup 命名分组按分组内 sessionIds 顺序过滤", () => {
  const g = createGroup(emptyGroups(), "工作");
  const id = g.groups[0].id;
  const withS = moveSessionToGroup(moveSessionToGroup(g, "s2", id), "s1", id);
  assert.deepEqual(visibleSessionsForGroup(withS, id, ["s1", "s2", "s3"]), ["s2", "s1"]);
});

test("reorderSessionInGroup 在命名分组内上移/下移会话", () => {
  const g = createGroup(emptyGroups(), "工作");
  const id = g.groups[0].id;
  const withS = moveSessionToGroup(moveSessionToGroup(moveSessionToGroup(g, "s1", id), "s2", id), "s3", id);
  // 初始顺序：s1, s2, s3
  assert.deepEqual(withS.groups[0].sessionIds, ["s1", "s2", "s3"]);
  // s2 上移到 s1 前
  const up = reorderSessionInGroup(withS, id, "s2", "s1");
  assert.deepEqual(up.groups[0].sessionIds, ["s2", "s1", "s3"]);
  // s1 下移到末尾
  const down = reorderSessionInGroup(withS, id, "s1", undefined);
  assert.deepEqual(down.groups[0].sessionIds, ["s2", "s3", "s1"]);
});

test("moveSessionToGroup 目标分组不存在时保持原数据", () => {
  const g = createGroup(emptyGroups(), "工作");
  const id = g.groups[0].id;
  const withS = moveSessionToGroup(g, "s1", id);
  const unchanged = moveSessionToGroup(withS, "s1", "missing-group");
  assert.deepEqual(unchanged, withS);
  assert.deepEqual(unchanged.groups[0].sessionIds, ["s1"]);
});

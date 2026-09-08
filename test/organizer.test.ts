import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GROUP_ID,
  createGroup,
  emptyGroups,
  moveSessionToGroup,
} from "../src/client/group-store.ts";
import { emptyAnnotations } from "../src/client/annotation-store.ts";
import {
  buildOrganizePlan,
  diffOrganize,
  applyOrganizeActionToGroups,
  applyOrganizeActionToAnnotations,
  normalizeOrganizePlan,
  type OrganizerSnapshot,
} from "../src/client/organizer.ts";

function sampleSnapshot(): OrganizerSnapshot {
  const groups = createGroup(emptyGroups(), "工作");
  const gid = groups.groups[0].id;
  const withSession = moveSessionToGroup(groups, "s1", gid);
  return {
    workspaces: [
      {
        id: "w1",
        title: "项目A",
        brief: "",
        defaultGroupName: "默认分组",
        groups: [
          { id: DEFAULT_GROUP_ID, name: "默认分组", brief: "", sessionIds: ["s2"] },
          { id: gid, name: "工作", brief: "", sessionIds: ["s1"] },
          { id: "g-empty", name: "空组", brief: "", sessionIds: [] },
        ],
        sessions: [
          { id: "s1", title: "修复登录", brief: "" },
          { id: "s2", title: "工作排期", brief: "" },
        ],
      },
    ],
  };
}

test("buildOrganizePlan 补齐缺失简述", () => {
  const plan = buildOrganizePlan(sampleSnapshot());
  const briefActions = plan.actions.filter((a) => a.kind === "updateBrief");
  assert.ok(briefActions.some((a) => a.entity === "workspace" && a.newBrief.includes("项目A")));
  assert.ok(briefActions.some((a) => a.entity === "group" && a.newBrief.includes("默认分组")));
  assert.ok(briefActions.some((a) => a.entity === "session" && a.newBrief.includes("修复登录")));
});

test("buildOrganizePlan 合并重名分组", () => {
  const groups = createGroup(createGroup(emptyGroups(), "工作"), "工作");
  const snapshot: OrganizerSnapshot = {
    workspaces: [{
      id: "w1",
      title: "项目A",
      brief: "沙盒",
      defaultGroupName: "默认分组",
      groups: [
        { id: DEFAULT_GROUP_ID, name: "默认分组", brief: "分组", sessionIds: [] },
        ...groups.groups.map((g) => ({ id: g.id, name: g.name, brief: "分组", sessionIds: [] })),
      ],
      sessions: [],
    }],
  };
  const plan = buildOrganizePlan(snapshot);
  assert.ok(plan.actions.some((a) => a.kind === "mergeGroup" && a.fromName === "工作" && a.toName === "工作"));
});

test("buildOrganizePlan 删除空命名分组", () => {
  const plan = buildOrganizePlan(sampleSnapshot());
  assert.ok(plan.actions.some((a) => a.kind === "deleteGroup" && a.name === "空组"));
});

test("buildOrganizePlan 把默认分组会话按名称移入匹配分组", () => {
  const plan = buildOrganizePlan(sampleSnapshot());
  const move = plan.actions.find((a) => a.kind === "moveSession" && a.sessionId === "s2");
  assert.ok(move);
  assert.equal(move && move.kind === "moveSession" && move.toGroupName, "工作");
});

test("diffOrganize 为每个动作生成可勾选差异项", () => {
  const snapshot = sampleSnapshot();
  const plan = buildOrganizePlan(snapshot);
  const items = diffOrganize(snapshot, plan);
  assert.equal(items.length, plan.actions.length);
  assert.ok(items.every((i) => i.id && i.title && i.description));
});

test("applyOrganizeActionToGroups 处理移动/删除/合并", () => {
  const groups = createGroup(emptyGroups(), "工作");
  const gid = groups.groups[0].id;
  const withSession = moveSessionToGroup(groups, "s1", gid);
  const moved = applyOrganizeActionToGroups(withSession, {
    kind: "moveSession",
    workspaceId: "w1",
    sessionId: "s1",
    sessionTitle: "s1",
    fromGroupId: gid,
    fromGroupName: "工作",
    toGroupId: DEFAULT_GROUP_ID,
    toGroupName: "默认分组",
    reason: "test",
  });
  assert.deepEqual(moved.groups[0].sessionIds, []);
});

test("applyOrganizeActionToAnnotations 更新简述", () => {
  const base = emptyAnnotations();
  const next = applyOrganizeActionToAnnotations(base, {
    kind: "updateBrief",
    entity: "workspace",
    workspaceId: "w1",
    entityName: "项目A",
    oldBrief: "",
    newBrief: "工作沙盒：项目A",
    reason: "test",
  });
  assert.equal(next.workspaces.w1?.brief, "工作沙盒：项目A");
});

test("normalizeOrganizePlan 过滤没有 moveSession 的 createGroup，避免空分组", () => {
  const plan = normalizeOrganizePlan({
    actions: [
      { kind: "createGroup", workspaceId: "w1", groupId: "g-empty", name: "空组", reason: "x" },
      { kind: "createGroup", workspaceId: "w1", groupId: "g-ok", name: "MYAGENT", reason: "x" },
      { kind: "moveSession", workspaceId: "w1", sessionId: "s1", toGroupId: "g-ok", toGroupName: "MYAGENT" },
    ],
  });
  assert.equal(plan.actions.length, 2);
  assert.ok(plan.actions.some((a) => a.kind === "createGroup" && a.groupId === "g-ok"));
  assert.ok(!plan.actions.some((a) => a.kind === "createGroup" && a.groupId === "g-empty"));
});

test("normalizeOrganizePlan 过滤非法动作并保留合法动作", () => {
  const plan = normalizeOrganizePlan({
    actions: [
      { kind: "createGroup", workspaceId: "w1", groupId: "g1", name: "工作", reason: "x" },
      { kind: "unknown", workspaceId: "w1" },
      { kind: "moveSession", workspaceId: "w1", sessionId: "s1", toGroupId: "g1", toGroupName: "工作" },
    ],
  });
  assert.equal(plan.actions.length, 2);
  assert.equal(plan.actions[0].kind, "createGroup");
  assert.equal(plan.actions[1].kind, "moveSession");
});

test("buildOrganizePlan 默认分组无命名分组时按共同主题新建分组", () => {
  const snapshot: OrganizerSnapshot = {
    workspaces: [{
      id: "w1",
      title: "项目A",
      brief: "沙盒",
      defaultGroupName: "默认分组",
      groups: [
        { id: DEFAULT_GROUP_ID, name: "默认分组", brief: "分组", sessionIds: ["s1", "s2"] },
      ],
      sessions: [
        { id: "s1", title: "修复登录 bug", brief: "" },
        { id: "s2", title: "登录超时排查", brief: "" },
      ],
    }],
  };
  const plan = buildOrganizePlan(snapshot);
  const create = plan.actions.find((a) => a.kind === "createGroup");
  assert.ok(create);
  assert.equal(create && create.kind === "createGroup" && create.name, "登录修复");
});

test("buildOrganizePlan 默认分组先按项目名新建分组", () => {
  const snapshot: OrganizerSnapshot = {
    workspaces: [{
      id: "w1",
      title: "项目A",
      brief: "沙盒",
      defaultGroupName: "默认分组",
      groups: [
        { id: DEFAULT_GROUP_ID, name: "默认分组", brief: "分组", sessionIds: ["s1", "s2", "s3"] },
      ],
      sessions: [
        { id: "s1", title: "MYAGENT 登录讨论", brief: "讨论 myagent 登录方案" },
        { id: "s2", title: "MYAGENT 登录执行", brief: "实现 myagent 登录功能" },
        { id: "s3", title: "dsh-file-manager 配置执行", brief: "配置 dsh-file-manager" },
      ],
    }],
  };
  const plan = buildOrganizePlan(snapshot);
  const creates = plan.actions.filter((a) => a.kind === "createGroup");
  assert.ok(creates.some((a) => a.kind === "createGroup" && a.name === "MYAGENT"));
  assert.ok(creates.some((a) => a.kind === "createGroup" && a.name === "dsh-file-manager"));
  const moves = plan.actions.filter((a) => a.kind === "moveSession");
  assert.ok(moves.some((a) => a.kind === "moveSession" && a.sessionId === "s1" && a.toGroupName === "MYAGENT"));
  assert.ok(moves.some((a) => a.kind === "moveSession" && a.sessionId === "s3" && a.toGroupName === "dsh-file-manager"));
});

test("buildOrganizePlan 会纠正旧版错误简介产生的无意义分组名", () => {
  const snapshot: OrganizerSnapshot = {
    workspaces: [{
      id: "w1",
      title: "项目A",
      brief: "沙盒",
      defaultGroupName: "默认分组",
      groups: [
        { id: DEFAULT_GROUP_ID, name: "默认分组", brief: "分组", sessionIds: [] },
        { id: "g-bad", name: "的对", brief: "分组：的对", sessionIds: ["s1", "s2"] },
      ],
      sessions: [
        { id: "s1", title: "修复登录 bug", brief: "排查登录接口超时问题" },
        { id: "s2", title: "登录模块重构", brief: "重构登录流程" },
      ],
    }],
  };
  const plan = buildOrganizePlan(snapshot);
  const rename = plan.actions.find((a) => a.kind === "renameGroup" && a.groupId === "g-bad");
  assert.ok(rename);
  assert.equal(rename && rename.kind === "renameGroup" && rename.newName, "登录修复");
});

test("buildOrganizePlan 会按项目名拆分旧式阶段分组（如“插件开发”）", () => {
  const snapshot: OrganizerSnapshot = {
    workspaces: [{
      id: "w1",
      title: "项目A",
      brief: "沙盒",
      defaultGroupName: "默认分组",
      groups: [
        { id: DEFAULT_GROUP_ID, name: "默认分组", brief: "分组", sessionIds: [] },
        { id: "g-dev", name: "插件开发", brief: "分组：插件开发", sessionIds: ["s1", "s2"] },
      ],
      sessions: [
        { id: "s1", title: "Myagent 切换图标反色改造", brief: "使用黑白 MA 素材修改左下角切换图标并实现反色切换" },
        { id: "s2", title: "dsh-file-manager 文件树开发", brief: "开发 dsh-file-manager 文件树" },
      ],
    }],
  };
  const plan = buildOrganizePlan(snapshot);
  const creates = plan.actions.filter((a) => a.kind === "createGroup");
  assert.ok(creates.some((a) => a.kind === "createGroup" && a.name === "MYAGENT"));
  assert.ok(creates.some((a) => a.kind === "createGroup" && a.name === "dsh-file-manager"));
  const moves = plan.actions.filter((a) => a.kind === "moveSession");
  assert.ok(moves.some((a) => a.kind === "moveSession" && a.sessionId === "s1" && a.toGroupName === "MYAGENT"));
});

test("buildOrganizePlan 会按项目名拆分宽泛分组（如“插件”）", () => {
  const snapshot: OrganizerSnapshot = {
    workspaces: [{
      id: "w1",
      title: "项目A",
      brief: "沙盒",
      defaultGroupName: "默认分组",
      groups: [
        { id: DEFAULT_GROUP_ID, name: "默认分组", brief: "分组", sessionIds: [] },
        { id: "g-plugin", name: "插件", brief: "分组：插件", sessionIds: ["s1", "s2", "s3", "s4"] },
      ],
      sessions: [
        { id: "s1", title: "MYAGENT 插件配置", brief: "配置 myagent 插件" },
        { id: "s2", title: "MYAGENT 插件安装", brief: "安装 myagent 插件" },
        { id: "s3", title: "dsh-file-manager 插件开发", brief: "开发 dsh-file-manager 插件" },
        { id: "s4", title: "dsh-file-manager 插件实现", brief: "实现 dsh-file-manager 插件" },
      ],
    }],
  };
  const plan = buildOrganizePlan(snapshot);
  const creates = plan.actions.filter((a) => a.kind === "createGroup");
  assert.ok(creates.some((a) => a.kind === "createGroup" && a.name === "MYAGENT"));
  assert.ok(creates.some((a) => a.kind === "createGroup" && a.name === "dsh-file-manager"));
});

// src/client/group-store.ts — 工作区内聊天框分组的数据模型、纯函数与读写封装。
import { Api } from "./api.ts";
import type { ApiError } from "./api.ts";

export const DEFAULT_GROUP_ID = "default";
export const GROUPS_PATH = ".myagent/groups.json";

export interface GroupMeta {
  id: string;
  name: string;
  sessionIds: string[];
}

export interface SessionGroups {
  version: number;
  defaultGroup: { id: string; name: string };
  groups: GroupMeta[];
}

export interface GroupLoadResult {
  data: SessionGroups;
  version?: unknown;
}

export function emptyGroups(): SessionGroups {
  return {
    version: 1,
    defaultGroup: { id: DEFAULT_GROUP_ID, name: "默认分组" },
    groups: [],
  };
}

export function parseGroups(text: string | null | undefined): SessionGroups {
  if (!text) return emptyGroups();
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== "object") return emptyGroups();
    const version = typeof raw.version === "number" ? raw.version : 1;
    const defaultGroup =
      raw.defaultGroup && typeof raw.defaultGroup.name === "string"
        ? { id: DEFAULT_GROUP_ID, name: raw.defaultGroup.name }
        : { id: DEFAULT_GROUP_ID, name: "默认分组" };
    const groups = Array.isArray(raw.groups)
      ? raw.groups
          .filter(
            (g: any) =>
              g &&
              typeof g.id === "string" &&
              g.id !== DEFAULT_GROUP_ID &&
              typeof g.name === "string",
          )
          .map((g: any) => ({
            id: g.id,
            name: g.name,
            sessionIds: Array.isArray(g.sessionIds)
              ? g.sessionIds.filter((x: unknown): x is string => typeof x === "string")
              : [],
          }))
      : [];
    return { version, defaultGroup, groups };
  } catch {
    return emptyGroups();
  }
}

export function serializeGroups(data: SessionGroups): string {
  return JSON.stringify(data, null, 2);
}

export function groupOfSession(data: SessionGroups, sessionId: string): string {
  const named = data.groups.find((g) => g.sessionIds.includes(sessionId));
  return named ? named.id : DEFAULT_GROUP_ID;
}

export function visibleSessionsForGroup(
  data: SessionGroups,
  groupId: string,
  workspaceSessionIds: string[],
): string[] {
  if (groupId === DEFAULT_GROUP_ID) {
    const named = new Set(data.groups.flatMap((g) => g.sessionIds));
    return workspaceSessionIds.filter((id) => !named.has(id));
  }
  const group = data.groups.find((g) => g.id === groupId);
  if (!group) return [];
  // 命名分组内按 group.sessionIds 的顺序展示，而不是按工作区全局顺序。
  // 这样同一个分组内的对话才能通过调整 sessionIds 顺序实现上移/下移。
  return group.sessionIds.filter((id) => workspaceSessionIds.includes(id));
}

export function createGroup(data: SessionGroups, name: string): SessionGroups {
  const id = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return { ...data, groups: [...data.groups, { id, name, sessionIds: [] }] };
}

export function addGroup(data: SessionGroups, group: GroupMeta): SessionGroups {
  if (data.groups.some((g) => g.id === group.id)) return data;
  return { ...data, groups: [...data.groups, group] };
}

export function renameGroup(data: SessionGroups, groupId: string, name: string): SessionGroups {
  if (groupId === DEFAULT_GROUP_ID) {
    return { ...data, defaultGroup: { ...data.defaultGroup, name } };
  }
  return {
    ...data,
    groups: data.groups.map((g) => (g.id === groupId ? { ...g, name } : g)),
  };
}

export function moveSessionToGroup(
  data: SessionGroups,
  sessionId: string,
  targetGroupId: string,
): SessionGroups {
  if (targetGroupId !== DEFAULT_GROUP_ID) {
    const target = data.groups.find((g) => g.id === targetGroupId);
    if (!target) return data;
  }
  const groups = data.groups.map((g) => ({
    ...g,
    sessionIds: g.sessionIds.filter((id) => id !== sessionId),
  }));
  if (targetGroupId === DEFAULT_GROUP_ID) return { ...data, groups };
  return {
    ...data,
    groups: groups.map((g) =>
      g.id === targetGroupId ? { ...g, sessionIds: [...g.sessionIds, sessionId] } : g,
    ),
  };
}

export function deleteGroup(
  data: SessionGroups,
  groupId: string,
  destination: "default" | "archive" | string,
): { data: SessionGroups; sessionsToArchive: string[] } {
  if (groupId === DEFAULT_GROUP_ID) return { data, sessionsToArchive: [] };
  const target = data.groups.find((g) => g.id === groupId);
  if (!target) return { data, sessionsToArchive: [] };
  const sessions = target.sessionIds;
  const remaining = data.groups.filter((g) => g.id !== groupId);
  let next: SessionGroups = { ...data, groups: remaining };
  if (destination === "archive") {
    return { data: next, sessionsToArchive: sessions };
  }
  if (destination !== "default") {
    for (const id of sessions) next = moveSessionToGroup(next, id, destination);
  }
  return { data: next, sessionsToArchive: [] };
}

export function applyMutation(
  base: SessionGroups,
  mutate: (data: SessionGroups) => SessionGroups,
): SessionGroups {
  return mutate(base);
}

export function replayMutations(
  base: SessionGroups,
  mutations: Array<(data: SessionGroups) => SessionGroups>,
): SessionGroups {
  return mutations.reduce((acc, fn) => fn(acc), base);
}

export function reorderGroups(data: SessionGroups, fromId: string, toId: string): SessionGroups {
  if (fromId === DEFAULT_GROUP_ID) return data;
  const from = data.groups.findIndex((g) => g.id === fromId);
  const to = data.groups.findIndex((g) => g.id === toId);
  if (from === -1 || to === -1 || from === to) return data;
  const next = [...data.groups];
  const [item] = next.splice(from, 1);
  const targetIndex = next.findIndex((g) => g.id === toId);
  next.splice(targetIndex, 0, item);
  return { ...data, groups: next };
}

/** 在同一个命名分组内调整会话顺序：beforeSessionId 为空时移到末尾。 */
export function reorderSessionInGroup(
  data: SessionGroups,
  groupId: string,
  sessionId: string,
  beforeSessionId?: string,
): SessionGroups {
  if (groupId === DEFAULT_GROUP_ID) return data;
  const groupIndex = data.groups.findIndex((g) => g.id === groupId);
  if (groupIndex === -1) return data;
  const group = data.groups[groupIndex];
  if (!group.sessionIds.includes(sessionId)) return data;
  const next = group.sessionIds.filter((id) => id !== sessionId);
  const insertIndex = beforeSessionId === undefined ? next.length : next.indexOf(beforeSessionId);
  if (insertIndex === -1) return data;
  next.splice(insertIndex, 0, sessionId);
  const groups = [...data.groups];
  groups[groupIndex] = { ...group, sessionIds: next };
  return { ...data, groups };
}

export async function loadGroups(api: Api): Promise<GroupLoadResult> {
  const res = await api.read(GROUPS_PATH);
  if (!res.ok) {
    if (res.status === 404) return { data: emptyGroups(), version: undefined };
    throw { status: res.status, code: res.code, message: res.message } satisfies ApiError;
  }
  return { data: parseGroups(res.data?.content), version: res.data?.version };
}

export async function saveGroups(
  api: Api,
  data: SessionGroups,
  version?: unknown,
): Promise<unknown> {
  const res = await api.write(GROUPS_PATH, serializeGroups(data), version);
  if (!res.ok) {
    throw { status: res.status, code: res.code, message: res.message } satisfies ApiError;
  }
  return res.data?.version;
}

// src/client/organizer.ts — 工作区“区管家”的纯函数：快照模型、建议生成、差异展示、
// 以及把建议动作应用到 groups/annotations 的辅助函数。
// 当前实现为“无子 agent 时的本地确定性整理器”，接口与设计文档中的“结构化整理建议 JSON”
// 对齐；后续若宿主暴露 continuable subagent，可在同一边界内替换为 agent 输出。
import {
  DEFAULT_GROUP_ID,
  addGroup,
  deleteGroup,
  moveSessionToGroup,
  renameGroup,
  type SessionGroups,
} from "./group-store.ts";
import type { AnnotationData } from "./annotation-store.ts";

export interface OrganizerSession {
  id: string;
  title: string;
  brief: string;
}

export interface OrganizerGroup {
  id: string;
  name: string;
  brief: string;
  sessionIds: string[];
}

export interface OrganizerWorkspace {
  id: string;
  title: string;
  brief: string;
  defaultGroupName: string;
  groups: OrganizerGroup[];
  sessions: OrganizerSession[];
}

export interface OrganizerSnapshot {
  workspaces: OrganizerWorkspace[];
}

export type OrganizeAction =
  | {
      kind: "createGroup";
      workspaceId: string;
      groupId: string;
      name: string;
      reason: string;
    }
  | {
      kind: "renameGroup";
      workspaceId: string;
      groupId: string;
      oldName: string;
      newName: string;
      reason: string;
    }
  | {
      kind: "deleteGroup";
      workspaceId: string;
      groupId: string;
      name: string;
      reason: string;
    }
  | {
      kind: "mergeGroup";
      workspaceId: string;
      fromGroupId: string;
      fromName: string;
      toGroupId: string;
      toName: string;
      reason: string;
    }
  | {
      kind: "moveSession";
      workspaceId: string;
      sessionId: string;
      sessionTitle: string;
      fromGroupId: string;
      fromGroupName: string;
      toGroupId: string;
      toGroupName: string;
      reason: string;
    }
  | {
      kind: "updateBrief";
      entity: "workspace" | "group" | "session";
      workspaceId?: string;
      groupId?: string;
      sessionId?: string;
      entityName: string;
      oldBrief: string;
      newBrief: string;
      reason: string;
    };

export interface OrganizePlan {
  actions: OrganizeAction[];
}

export interface OrganizeDiffItem {
  id: string;
  action: OrganizeAction;
  title: string;
  description: string;
}

export interface OrganizerSnapshotInput {
  workspaces: OrganizerWorkspace[];
}

function norm(s: string): string {
  return s.trim().toLocaleLowerCase();
}

const STOP_TOKENS = new Set([
  "工作", "项目", "对话", "关于", "这个", "那个", "一个", "进行", "使用",
  "如何", "什么", "怎么", "为什么", "可以", "需要", "没有", "就是", "还是",
  "因为", "所以", "但是", "如果", "然后", "现在", "今天", "昨天", "明天",
  "学习", "开发", "测试", "修复", "实现", "的", "了", "是", "在", "我", "你",
  "他", "她", "它", "我们", "你们", "他们", "它们", "and", "the", "for", "with",
]);

// 旧版自动简介“关于‘xxx’的对话”可能产生无意义分组名（如“的对”），这些名字需要被纠正。
const JUNK_GROUP_NAMES = new Set(["的对", "的对话", "关于", "对话", "关于的", "的的"]);

// 过于宽泛的分组名：即使不是错误，也往往把不同目的的会话混在一起，需要尝试拆分。
const COARSE_GROUP_NAMES = new Set(["插件", "dsh", "项目", "工作", "开发", "测试", "讨论", "其他", "相关", "默认", "杂项"]);

function isJunkGroupName(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (JUNK_GROUP_NAMES.has(n)) return true;
  // 纯标点/数字/过短且无字母数字中文意义的名字也视为可疑。
  if (n.length <= 1) return true;
  return false;
}

function isCoarseGroupName(name: string): boolean {
  const n = name.trim();
  if (COARSE_GROUP_NAMES.has(n)) return true;
  // 极短且是常见宽泛词（如“插件”已在上面的集合中；这里再兜底“的”“中”等）。
  return n.length <= 2 && !isJunkGroupName(n);
}

/** 判断是否为“项目无关”的旧式分组名：宽泛词本身，或“宽泛词+阶段”（如“插件开发”“插件配置”）。
 *  这类分组可能是旧版按用途/阶段拆分产生的，里面混了多个项目，需要按项目名重新拆分。 */
const PHASE_SUFFIXES = ["开发", "实现", "配置", "安装", "部署", "设置", "讨论", "咨询", "修复", "调试", "调研", "规划", "测试", "移植", "封装", "执行"];

function isProjectAgnosticGroupName(name: string): boolean {
  const n = name.trim();
  if (isCoarseGroupName(n)) return true;
  for (const suffix of PHASE_SUFFIXES) {
    if (n.endsWith(suffix)) {
      const root = n.slice(0, n.length - suffix.length);
      if (isCoarseGroupName(root)) return true;
    }
  }
  return false;
}

/** 从一组会话的标题/简述中提取一个最合适的主题词作为分组名。 */
function suggestNameFromSessions(sessions: OrganizerSession[]): string {
  const texts = sessions
    .map((s) => `${s.title} ${s.brief}`)
    .filter((t) => t.trim());
  if (texts.length === 0) return "";
  const project = commonProject(sessions);
  if (project) return project;
  const tokenCount = new Map<string, number>();
  for (const text of texts) {
    const tokens = new Set(tokenize(text));
    for (const t of tokens) {
      if (JUNK_GROUP_NAMES.has(t)) continue;
      tokenCount.set(t, (tokenCount.get(t) ?? 0) + 1);
    }
  }
  const isChinese = (t: string) => /[一-鿿]/.test(t);
  const ranked = [...tokenCount.entries()]
    .filter(([t, count]) => count >= 2 && !isJunkGroupName(t) && isChinese(t))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  if (ranked.length > 0) return specificGroupName(sessions, ranked[0][0]);
  // 没有共同词时，取第一条非空标题/简述里的第一个中文候选词。
  for (const text of texts) {
    const tokens = tokenize(text).filter((t) => !isJunkGroupName(t) && isChinese(t));
    if (tokens.length > 0) return specificGroupName(sessions, tokens[0]);
  }
  return "";
}

/** 根据标题/简述判断会话阶段/目的，返回中文阶段词（如“配置”“移植”“讨论”）。 */
function phaseOf(text: string): string {
  if (/配置|安装|部署|设置|接入/.test(text)) return "配置";
  if (/移植|封装|复制|迁移/.test(text)) return "移植封装";
  if (/开发|实现|编码|编写|构建/.test(text)) return "开发";
  if (/讨论|咨询|问答|了解|探究/.test(text)) return "讨论";
  if (/修复|调试|排查|解决|报错/.test(text)) return "修复";
  if (/调研|搜索|查询|查找|对比/.test(text)) return "调研";
  if (/规划|计划|方案|设计/.test(text)) return "规划";
  if (/测试|验证|试用/.test(text)) return "测试";
  return "";
}

/** 识别会话所属项目名；优先按项目名分组，而不是按用途/阶段跨项目归类。 */
const PROJECT_NAMES: Array<{ name: string; test: RegExp }> = [
  { name: "MYAGENT", test: /dsh-myagent|myagent|my agent/i },
  { name: "dsh-file-manager", test: /dsh-file-manager|file[-_ ]?manager/i },
  { name: "MA-logo", test: /ma-logo|ma[-_ ]?logo|ma 图标|ma图标/i },
  { name: "dsh-vision-any", test: /dsh-vision-any|vision-any/i },
  { name: "dsh-anchored-standard", test: /dsh-anchored-standard|anchored-standard/i },
  { name: "opencode", test: /opencode/i },
  { name: "GitHub MCP", test: /github[-_ ]?mcp|github mcp/i },
  { name: "xingli", test: /xingli/i },
  { name: "dsh", test: /\bdsh\b/i },
];

function projectOf(s: OrganizerSession): string {
  // 标题优先：标题里的项目名比简介里顺带提到的其他项目更可靠。
  for (const p of PROJECT_NAMES) {
    if (p.test.test(s.title)) return p.name;
  }
  for (const p of PROJECT_NAMES) {
    if (p.test.test(s.brief)) return p.name;
  }
  return "";
}

function commonProject(sessions: OrganizerSession[]): string {
  const projects = sessions.map((s) => projectOf(s)).filter(Boolean);
  const first = projects[0];
  if (first && projects.every((p) => p === first)) return first;
  return "";
}

/** 从一组会话中推断一个更具体的分组名：主题词 + 阶段词，避免只叫“插件”。 */
function specificGroupName(sessions: OrganizerSession[], topic: string): string {
  const phaseCount = new Map<string, number>();
  for (const s of sessions) {
    const phase = phaseOf(`${s.title} ${s.brief}`);
    if (phase) phaseCount.set(phase, (phaseCount.get(phase) ?? 0) + 1);
  }
  const topPhase = [...phaseCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  if (topPhase && !topic.includes(topPhase)) return `${topic}${topPhase}`;
  return topic;
}

/** 从标题/简述中提取候选主题词：拉丁词 + 中文二元组。 */
function tokenize(text: string): string[] {
  const lower = text.toLocaleLowerCase();
  const tokens = new Set<string>();
  for (const m of lower.match(/[a-z0-9]{2,}/g) ?? []) {
    if (!STOP_TOKENS.has(m)) tokens.add(m);
  }
  const han = lower.replace(/[^一-鿿]/g, "");
  for (let i = 0; i < han.length - 1; i++) {
    const bigram = han.slice(i, i + 2);
    if (!STOP_TOKENS.has(bigram)) tokens.add(bigram);
  }
  return [...tokens];
}

function defaultBriefFor(kind: "workspace" | "group" | "session", name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (kind === "workspace") return `工作区：${trimmed}`;
  if (kind === "group") return `分组：${trimmed}`;
  return `对话：${trimmed}`;
}

function uniqueActionId(index: number): string {
  return `action-${index}`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 把外部（agent）返回的整理建议 JSON 规范化为内部 OrganizePlan，丢弃字段不全的动作。 */
export function normalizeOrganizePlan(input: unknown): OrganizePlan {
  if (!isRecord(input) || !Array.isArray(input.actions)) return { actions: [] };
  const actions: OrganizeAction[] = [];
  for (const raw of input.actions) {
    if (!isRecord(raw)) continue;
    const kind = raw.kind;
    const workspaceId = str(raw.workspaceId);
    if (!workspaceId) continue;
    switch (kind) {
      case "createGroup": {
        const groupId = str(raw.groupId);
        const name = str(raw.name);
        if (groupId && name) actions.push({ kind, workspaceId, groupId, name, reason: str(raw.reason) });
        break;
      }
      case "renameGroup": {
        const groupId = str(raw.groupId);
        const oldName = str(raw.oldName);
        const newName = str(raw.newName);
        if (groupId && newName) actions.push({ kind, workspaceId, groupId, oldName: oldName || newName, newName, reason: str(raw.reason) });
        break;
      }
      case "deleteGroup": {
        const groupId = str(raw.groupId);
        const name = str(raw.name);
        if (groupId) actions.push({ kind, workspaceId, groupId, name: name || groupId, reason: str(raw.reason) });
        break;
      }
      case "mergeGroup": {
        const fromGroupId = str(raw.fromGroupId);
        const fromName = str(raw.fromName);
        const toGroupId = str(raw.toGroupId);
        const toName = str(raw.toName);
        if (fromGroupId && toGroupId) actions.push({ kind, workspaceId, fromGroupId, fromName: fromName || fromGroupId, toGroupId, toName: toName || toGroupId, reason: str(raw.reason) });
        break;
      }
      case "moveSession": {
        const sessionId = str(raw.sessionId);
        const sessionTitle = str(raw.sessionTitle);
        const fromGroupId = str(raw.fromGroupId);
        const fromGroupName = str(raw.fromGroupName);
        const toGroupId = str(raw.toGroupId);
        const toGroupName = str(raw.toGroupName);
        if (sessionId && toGroupId) actions.push({ kind, workspaceId, sessionId, sessionTitle: sessionTitle || sessionId, fromGroupId: fromGroupId || "default", fromGroupName: fromGroupName || "默认分组", toGroupId, toGroupName: toGroupName || toGroupId, reason: str(raw.reason) });
        break;
      }
      case "updateBrief": {
        const entity = raw.entity;
        if (entity !== "workspace" && entity !== "group" && entity !== "session") break;
        const entityName = str(raw.entityName);
        const newBrief = str(raw.newBrief);
        if (entityName && newBrief) {
          const base = { kind, entity, workspaceId, entityName, oldBrief: str(raw.oldBrief), newBrief, reason: str(raw.reason) };
          if (entity === "workspace") actions.push(base as OrganizeAction);
          else if (entity === "group") {
            const groupId = str(raw.groupId);
            if (groupId) actions.push({ ...base, groupId } as OrganizeAction);
          } else {
            const sessionId = str(raw.sessionId);
            if (sessionId) actions.push({ ...base, sessionId } as OrganizeAction);
          }
        }
        break;
      }
    }
  }
  // 防止管家/外部 agent 只建议 createGroup 却没有对应的 moveSession，导致产生空分组。
  const moveTargets = new Set(
    actions.filter((a): a is Extract<OrganizeAction, { kind: "moveSession" }> => a.kind === "moveSession").map((a) => a.toGroupId),
  );
  const filtered = actions.filter((a) => a.kind !== "createGroup" || moveTargets.has(a.groupId));
  return { actions: filtered };
}

/** 当默认分组中有多个未归类的会话时，先按项目名新建分组并移入；无法识别项目的再按共同主题词兜底。 */
function suggestNewGroups(
  ws: OrganizerWorkspace,
  actions: OrganizeAction[],
  matched: Set<string>,
): void {
  const defaultGroup = ws.groups.find((g) => g.id === DEFAULT_GROUP_ID);
  if (!defaultGroup) return;
  const sessionById = new Map(ws.sessions.map((s) => [s.id, s]));
  const candidates = defaultGroup.sessionIds
    .map((id) => sessionById.get(id))
    .filter((s): s is OrganizerSession => !!s && !matched.has(s.id) && Boolean(s.title.trim() || s.brief.trim()));
  if (candidates.length === 0) return;

  const existingNames = new Set(ws.groups.filter((g) => g.id !== DEFAULT_GROUP_ID).map((g) => norm(g.name)));
  const createdNames = new Set<string>();
  const moved = new Set<string>(matched);
  let created = 0;

  // 第一优先：按项目名分组，例如“MYAGENT”“dsh-file-manager”。
  const byProject = new Map<string, OrganizerSession[]>();
  const unprojected: OrganizerSession[] = [];
  for (const s of candidates) {
    const project = projectOf(s);
    if (project) {
      const arr = byProject.get(project) ?? [];
      arr.push(s);
      byProject.set(project, arr);
    } else {
      unprojected.push(s);
    }
  }

  for (const [project, arr] of byProject) {
    const name = project;
    const existing = ws.groups.find((g) => g.id !== DEFAULT_GROUP_ID && norm(g.name) === norm(name));
    const groupId = existing?.id ?? `g_org_${ws.id.replace(/\W/g, "_")}_${created}_${Math.random().toString(36).slice(2, 8)}`;
    if (!existing) {
      if (existingNames.has(norm(name)) || createdNames.has(norm(name))) continue;
      actions.push({
        kind: "createGroup",
        workspaceId: ws.id,
        groupId,
        name,
        reason: `按项目名新建分组“${name}”`,
      });
      createdNames.add(norm(name));
    }
    for (const s of arr) {
      if (moved.has(s.id)) continue;
      actions.push({
        kind: "moveSession",
        workspaceId: ws.id,
        sessionId: s.id,
        sessionTitle: s.title || s.id,
        fromGroupId: DEFAULT_GROUP_ID,
        fromGroupName: defaultGroup.name,
        toGroupId: groupId,
        toGroupName: name,
        reason: `会话“${s.title || s.id}”属于项目“${name}”，移入项目分组`,
      });
      moved.add(s.id);
    }
    created++;
  }

  // 第二优先：无法识别项目的会话仍按共同主题词建组，避免完全散落在默认分组。
  const remaining = unprojected.filter((s) => !moved.has(s.id));
  if (remaining.length < 2) return;
  const tokenCount = new Map<string, number>();
  const tokenSessions = new Map<string, string[]>();
  for (const s of remaining) {
    const tokens = new Set(tokenize(`${s.title} ${s.brief}`));
    for (const t of tokens) {
      tokenCount.set(t, (tokenCount.get(t) ?? 0) + 1);
      const arr = tokenSessions.get(t) ?? [];
      arr.push(s.id);
      tokenSessions.set(t, arr);
    }
  }

  const isChinese = (t: string) => /[一-鿿]/.test(t);
  const ranked = [...tokenCount.entries()]
    .filter(([t, count]) => count >= 2 && isChinese(t) && !isJunkGroupName(t))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);

  for (const [token, count] of ranked) {
    if (created >= 5) break;
    const ids = (tokenSessions.get(token) ?? []).filter((id) => !moved.has(id));
    if (ids.length < 2) continue;
    const memberSessions = ids
      .map((id) => sessionById.get(id))
      .filter((s): s is OrganizerSession => !!s);
    const name = specificGroupName(memberSessions, token);
    if (existingNames.has(norm(name)) || createdNames.has(norm(name))) continue;
    const groupId = `g_org_${ws.id.replace(/\W/g, "_")}_${created}_${Math.random().toString(36).slice(2, 8)}`;
    actions.push({
      kind: "createGroup",
      workspaceId: ws.id,
      groupId,
      name,
      reason: `根据 ${count} 个会话的共同主题“${token}”新建分组“${name}”`,
    });
    for (const id of ids) {
      const s = sessionById.get(id);
      actions.push({
        kind: "moveSession",
        workspaceId: ws.id,
        sessionId: id,
        sessionTitle: s?.title || id,
        fromGroupId: DEFAULT_GROUP_ID,
        fromGroupName: defaultGroup.name,
        toGroupId: groupId,
        toGroupName: name,
        reason: `会话“${s?.title || id}”与新建分组“${name}”匹配`,
      });
      moved.add(id);
    }
    createdNames.add(norm(name));
    created++;
  }
}

/** 拆分宽泛分组：如果一个大组里混了多个项目，按项目名拆成更清晰的项目分组。 */
function splitCoarseGroup(
  ws: OrganizerWorkspace,
  group: OrganizerGroup,
  actions: OrganizeAction[],
): void {
  if (!isProjectAgnosticGroupName(group.name)) return;
  const sessionById = new Map(ws.sessions.map((s) => [s.id, s]));
  const members = group.sessionIds
    .map((id) => sessionById.get(id))
    .filter((s): s is OrganizerSession => !!s);
  if (members.length < 2) return;

  const byProject = new Map<string, OrganizerSession[]>();
  const unprojected: OrganizerSession[] = [];
  for (const s of members) {
    const project = projectOf(s);
    if (project) {
      const arr = byProject.get(project) ?? [];
      arr.push(s);
      byProject.set(project, arr);
    } else {
      unprojected.push(s);
    }
  }
  if (byProject.size === 0) return;

  const existingNames = new Set(ws.groups.filter((g) => g.id !== DEFAULT_GROUP_ID).map((g) => norm(g.name)));
  const createdNames = new Set<string>();
  const moved = new Set<string>();
  let createdIndex = 0;

  for (const [project, arr] of byProject) {
    const name = project;
    const existing = ws.groups.find((g) => g.id !== DEFAULT_GROUP_ID && g.id !== group.id && norm(g.name) === norm(name));
    const groupId = existing?.id ?? `g_split_${ws.id.replace(/\W/g, "_")}_${createdIndex}_${Math.random().toString(36).slice(2, 8)}`;
    if (!existing) {
      if (existingNames.has(norm(name)) || createdNames.has(norm(name))) continue;
      actions.push({
        kind: "createGroup",
        workspaceId: ws.id,
        groupId,
        name,
        reason: `拆分宽泛分组“${group.name}”：按项目“${name}”归类`,
      });
      createdNames.add(norm(name));
    }
    for (const s of arr) {
      actions.push({
        kind: "moveSession",
        workspaceId: ws.id,
        sessionId: s.id,
        sessionTitle: s.title || s.id,
        fromGroupId: group.id,
        fromGroupName: group.name,
        toGroupId: groupId,
        toGroupName: name,
        reason: `会话“${s.title || s.id}”属于项目“${name}”，移入项目分组`,
      });
      moved.add(s.id);
    }
    createdIndex++;
  }

  // 无法识别项目的会话暂时保留在宽泛分组中；只有全部成员都移走后才删除原分组。
  if (moved.size > 0 && moved.size === members.length) {
    actions.push({
      kind: "deleteGroup",
      workspaceId: ws.id,
      groupId: group.id,
      name: group.name,
      reason: `宽泛分组“${group.name}”的会话已全部分入项目分组`,
    });
  }
}

/** 本地确定性整理建议：补齐简述、合并重名分组、删除空命名分组、按名称把默认分组会话归入匹配分组。 */
export function buildOrganizePlan(snapshot: OrganizerSnapshot): OrganizePlan {
  const actions: OrganizeAction[] = [];

  for (const ws of snapshot.workspaces) {
    if (!ws.brief.trim()) {
      actions.push({
        kind: "updateBrief",
        entity: "workspace",
        workspaceId: ws.id,
        entityName: ws.title || ws.id,
        oldBrief: "",
        newBrief: defaultBriefFor("workspace", ws.title || ws.id),
        reason: "工作区缺少一句话标注",
      });
    }

    // 补齐分组简述（含默认分组）。
    for (const group of ws.groups) {
      if (!group.brief.trim()) {
        actions.push({
          kind: "updateBrief",
          entity: "group",
          workspaceId: ws.id,
          groupId: group.id,
          entityName: group.name,
          oldBrief: "",
          newBrief: defaultBriefFor("group", group.name),
          reason: "分组缺少一句话标注",
        });
      }
    }

    // 补齐会话简述（仅标题存在且未人工填写简述时）。
    for (const session of ws.sessions) {
      if (!session.brief.trim() && session.title.trim()) {
        actions.push({
          kind: "updateBrief",
          entity: "session",
          workspaceId: ws.id,
          sessionId: session.id,
          entityName: session.title || session.id,
          oldBrief: "",
          newBrief: defaultBriefFor("session", session.title || session.id),
          reason: "会话缺少一句话标注",
        });
      }
    }

    // 合并重名分组：保留第一个，后续重名组合并进去。
    const seen = new Map<string, string>();
    const mergedFrom = new Set<string>();
    for (const group of ws.groups) {
      if (group.id === DEFAULT_GROUP_ID) continue;
      const key = norm(group.name);
      if (!key) continue;
      const firstId = seen.get(key);
      if (firstId === undefined) {
        seen.set(key, group.id);
        continue;
      }
      const first = ws.groups.find((g) => g.id === firstId);
      if (first) {
        actions.push({
          kind: "mergeGroup",
          workspaceId: ws.id,
          fromGroupId: group.id,
          fromName: group.name,
          toGroupId: first.id,
          toName: first.name,
          reason: `存在重名分组“${group.name}”，合并到先创建的“${first.name}”`,
        });
        mergedFrom.add(group.id);
      }
    }

    // 删除空的命名分组（已被合并的分组不再重复删除）。
    const removedGroupIds = new Set(mergedFrom);
    for (const group of ws.groups) {
      if (group.id === DEFAULT_GROUP_ID || mergedFrom.has(group.id)) continue;
      if (group.sessionIds.length === 0) {
        actions.push({
          kind: "deleteGroup",
          workspaceId: ws.id,
          groupId: group.id,
          name: group.name,
          reason: `分组“${group.name}”中没有聊天框`,
        });
        removedGroupIds.add(group.id);
      }
    }

    // 默认分组中的会话，若标题/简述包含某个命名分组名称，则建议移入该分组。
    // 跳过将被合并/删除的分组，避免“移入后又删除/合并”的冲突建议。
    const matchedByMove = new Set<string>();
    const namedGroups = ws.groups.filter((g) => g.id !== DEFAULT_GROUP_ID && !removedGroupIds.has(g.id));
    const defaultGroup = ws.groups.find((g) => g.id === DEFAULT_GROUP_ID);
    for (const session of ws.sessions) {
      if (!defaultGroup?.sessionIds.includes(session.id)) continue;
      const haystack = `${session.title} ${session.brief}`.toLocaleLowerCase();
      let best: OrganizerGroup | undefined;
      for (const group of namedGroups) {
        if (!group.name.trim()) continue;
        if (haystack.includes(norm(group.name))) {
          if (!best || group.name.length > best.name.length) best = group;
        }
      }
      if (best) {
        actions.push({
          kind: "moveSession",
          workspaceId: ws.id,
          sessionId: session.id,
          sessionTitle: session.title || session.id,
          fromGroupId: DEFAULT_GROUP_ID,
          fromGroupName: defaultGroup?.name ?? DEFAULT_GROUP_ID,
          toGroupId: best.id,
          toGroupName: best.name,
          reason: `会话“${session.title || session.id}”的内容与分组“${best.name}”匹配`,
        });
        matchedByMove.add(session.id);
      }
    }

    // 仍未归入任何命名分组的默认分组会话，按共同主题建议新建分组。
    suggestNewGroups(ws, actions, matchedByMove);

    // 纠正由旧版错误简介产生的无意义分组名（例如“的对”）。
    const sessionById = new Map(ws.sessions.map((s) => [s.id, s]));
    for (const group of ws.groups) {
      if (group.id === DEFAULT_GROUP_ID) continue;
      if (!isJunkGroupName(group.name)) continue;
      const memberSessions = group.sessionIds
        .map((id) => sessionById.get(id))
        .filter((s): s is OrganizerSession => !!s);
      if (memberSessions.length === 0) continue;
      const suggested = suggestNameFromSessions(memberSessions);
      if (suggested && norm(suggested) !== norm(group.name)) {
        actions.push({
          kind: "renameGroup",
          workspaceId: ws.id,
          groupId: group.id,
          oldName: group.name,
          newName: suggested,
          reason: `原分组名“${group.name}”来自旧版错误简介，根据最新会话内容建议改为“${suggested}”`,
        });
      }
    }

    // 拆分宽泛/旧式阶段分组（如“插件”“插件开发”），按项目名细分成“MYAGENT”“dsh-file-manager”等项目分组。
    for (const group of ws.groups) {
      if (group.id === DEFAULT_GROUP_ID) continue;
      splitCoarseGroup(ws, group, actions);
    }
  }

  return { actions };
}

function actionTitle(action: OrganizeAction): string {
  switch (action.kind) {
    case "createGroup":
      return `新建分组：${action.name}`;
    case "renameGroup":
      return `重命名分组：${action.oldName} → ${action.newName}`;
    case "deleteGroup":
      return `删除空分组：${action.name}`;
    case "mergeGroup":
      return `合并分组：${action.fromName} → ${action.toName}`;
    case "moveSession":
      return `移动会话：${action.sessionTitle} → ${action.toGroupName}`;
    case "updateBrief": {
      if (action.entity === "session") return `更新会话标题与简介：${action.entityName}`;
      const where = action.entity === "workspace" ? "工作区" : "分组";
      return `更新${where}简述：${action.entityName}`;
    }
  }
}

function actionDescription(action: OrganizeAction): string {
  switch (action.kind) {
    case "createGroup":
      return action.reason;
    case "renameGroup":
      return action.reason;
    case "deleteGroup":
      return action.reason;
    case "mergeGroup":
      return action.reason;
    case "moveSession":
      return action.reason;
    case "updateBrief": {
      const oldBrief = action.oldBrief ? `“${action.oldBrief}”` : "（空）";
      const briefPart = `${oldBrief} → “${action.newBrief}”`;
      return action.entity === "session"
        ? `${action.reason}：标题“${action.entityName}”，简介 ${briefPart}`
        : `${action.reason}：${briefPart}`;
    }
  }
}

/** 生成动作去重用的稳定 key。 */
export function organizeActionKey(action: OrganizeAction): string {
  switch (action.kind) {
    case "createGroup":
      return `createGroup:${action.workspaceId}:${action.groupId}`;
    case "renameGroup":
      return `renameGroup:${action.workspaceId}:${action.groupId}:${action.newName}`;
    case "deleteGroup":
      return `deleteGroup:${action.workspaceId}:${action.groupId}`;
    case "mergeGroup":
      return `mergeGroup:${action.workspaceId}:${action.fromGroupId}:${action.toGroupId}`;
    case "moveSession":
      return `moveSession:${action.workspaceId}:${action.sessionId}:${action.toGroupId}`;
    case "updateBrief":
      return `updateBrief:${action.entity}:${action.workspaceId}:${action.groupId ?? action.sessionId ?? ""}:${action.newBrief}`;
  }
}

/** 把建议动作转成 UI 可勾选的差异列表。 */
export function diffOrganize(_snapshot: OrganizerSnapshot, plan: OrganizePlan): OrganizeDiffItem[] {
  return plan.actions.map((action, index) => ({
    id: uniqueActionId(index),
    action,
    title: actionTitle(action),
    description: actionDescription(action),
  }));
}

/** 将单个整理动作应用到某个工作区的 groups.json 数据。 */
export function applyOrganizeActionToGroups(groups: SessionGroups, action: OrganizeAction)
: SessionGroups {
  switch (action.kind) {
    case "createGroup":
      return addGroup(groups, { id: action.groupId, name: action.name, sessionIds: [] });
    case "renameGroup":
      return renameGroup(groups, action.groupId, action.newName);
    case "deleteGroup":
      return deleteGroup(groups, action.groupId, "default").data;
    case "mergeGroup":
      return deleteGroup(groups, action.fromGroupId, action.toGroupId).data;
    case "moveSession":
      return moveSessionToGroup(groups, action.sessionId, action.toGroupId);
    default:
      return groups;
  }
}

/** 将单个整理动作应用到 annotations.json 数据。 */
export function applyOrganizeActionToAnnotations(data: AnnotationData, action: OrganizeAction): AnnotationData {
  switch (action.kind) {
    case "updateBrief": {
      if (action.entity === "workspace" && action.workspaceId) {
        return {
          ...data,
          workspaces: {
            ...data.workspaces,
            [action.workspaceId]: {
              id: action.workspaceId,
              brief: action.newBrief,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      }
      if (action.entity === "group" && action.workspaceId && action.groupId) {
        return {
          ...data,
          groups: {
            ...data.groups,
            [action.groupId]: {
              id: action.groupId,
              brief: action.newBrief,
              updatedAt: new Date().toISOString(),
              workspaceId: action.workspaceId,
            },
          },
        };
      }
      if (action.entity === "session" && action.workspaceId && action.sessionId) {
        return {
          ...data,
          sessions: {
            ...data.sessions,
            [action.sessionId]: {
              id: action.sessionId,
              brief: action.newBrief,
              updatedAt: new Date().toISOString(),
              title: action.entityName,
            },
          },
        };
      }
      return data;
    }
    case "createGroup": {
      if (!action.workspaceId) return data;
      return {
        ...data,
        groups: {
          ...data.groups,
          [action.groupId]: {
            id: action.groupId,
            brief: defaultBriefFor("group", action.name),
            updatedAt: new Date().toISOString(),
            workspaceId: action.workspaceId,
          },
        },
      };
    }
    case "renameGroup": {
      const existing = data.groups[action.groupId];
      if (!existing) return data;
      return {
        ...data,
        groups: {
          ...data.groups,
          [action.groupId]: {
            ...existing,
            brief: existing.brief || defaultBriefFor("group", action.newName),
            updatedAt: new Date().toISOString(),
          },
        },
      };
    }
    case "deleteGroup":
    case "mergeGroup": {
      const groupId = action.kind === "deleteGroup" ? action.groupId : action.fromGroupId;
      if (!data.groups[groupId]) return data;
      const groups = { ...data.groups };
      delete groups[groupId];
      return { ...data, groups };
    }
    default:
      return data;
  }
}

/** 汇总多个整理动作对 groups 的连续变更（按动作顺序）。 */
export function applyOrganizeActionsToGroups(
  groups: SessionGroups,
  actions: OrganizeAction[],
): SessionGroups {
  return actions.reduce(
    (acc, action) => (isGroupAction(action) ? applyOrganizeActionToGroups(acc, action) : acc),
    groups,
  );
}

/** 汇总多个整理动作对 annotations 的连续变更。 */
export function applyOrganizeActionsToAnnotations(
  data: AnnotationData,
  actions: OrganizeAction[],
): AnnotationData {
  return actions.reduce((acc, action) => applyOrganizeActionToAnnotations(acc, action), data);
}

export function isGroupAction(action: OrganizeAction): boolean {
  return (
    action.kind === "createGroup" ||
    action.kind === "renameGroup" ||
    action.kind === "deleteGroup" ||
    action.kind === "mergeGroup" ||
    action.kind === "moveSession"
  );
}

export function isAnnotationAction(action: OrganizeAction): boolean {
  return action.kind === "updateBrief" || action.kind === "createGroup" || action.kind === "renameGroup" || action.kind === "deleteGroup" || action.kind === "mergeGroup";
}

# 工作沙盒内聊天框分组（Session Groups）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在每个工作沙盒内增加扁平命名分组，支持新建/重命名/删除/折叠/排序分组，以及通过拖拽或菜单把聊天框移入分组。

**Architecture:** 宿主不提供会话分组 API，因此分组元数据以 `.myagent/groups.json` 存于每个工作沙盒根目录，由客户端 `group-store.ts` 负责读写与纯函数操作；`WorkspaceBrowser` 负责渲染与交互；文件树隐藏 `.myagent` 目录。

**Tech Stack:** TypeScript / React / dsh client primitives / node:test（纯函数测试）

---

## 文件结构

- 新建 `src/client/group-store.ts` — 分组数据模型、纯函数、`loadGroups/saveGroups`
- 新建 `test/group-store.test.ts` — 纯函数测试
- 修改 `src/client/WorkspaceBrowser.tsx` — 分组渲染、管理交互、拖拽/菜单移动会话
- 修改 `src/client/SidebarComposite.tsx` — 把 `api` 传给 `WorkspaceBrowser`
- 修改 `src/service.ts` — 文件树根目录隐藏 `.myagent`
- 修改 `test/service.test.ts` — 补充 `.myagent` 隐藏测试

---

## Task 1: group-store 纯函数与读写封装

**Files:**
- Create: `src/client/group-store.ts`
- Create: `test/group-store.test.ts`

- [ ] **Step 1: 编写失败测试**

`test/group-store.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GROUP_ID,
  emptyGroups,
  parseGroups,
  serializeGroups,
  groupOfSession,
  visibleSessionsForGroup,
  createGroup,
  renameGroup,
  moveSessionToGroup,
  deleteGroup,
  reorderGroups,
} from "../src/client/group-store.ts";

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

test("reorderGroups 调整命名分组顺序", () => {
  const g = createGroup(createGroup(emptyGroups(), "A"), "B");
  const aId = g.groups[0].id;
  const bId = g.groups[1].id;
  const reordered = reorderGroups(g, aId, 1);
  assert.deepEqual(reordered.groups.map((x) => x.id), [bId, aId]);
});

test("deleteGroup 不允许删除默认分组", () => {
  const res = deleteGroup(emptyGroups(), DEFAULT_GROUP_ID, "default");
  assert.equal(res.data.groups.length, 0);
  assert.deepEqual(res.sessionsToArchive, []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --test-isolation=none test/group-store.test.ts`
Expected: FAIL，`Cannot find module '../src/client/group-store.ts'`

- [ ] **Step 3: 实现 `src/client/group-store.ts`**

```ts
// src/client/group-store.ts — 工作沙盒内聊天框分组的数据模型、纯函数与读写封装。
import { Api } from "./api.ts";

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
  const set = new Set(group.sessionIds);
  return workspaceSessionIds.filter((id) => set.has(id));
}

export function createGroup(data: SessionGroups, name: string): SessionGroups {
  const id = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return { ...data, groups: [...data.groups, { id, name, sessionIds: [] }] };
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
  const groups = data.groups.map((g) => ({
    ...g,
    sessionIds: g.sessionIds.filter((id) => id !== sessionId),
  }));
  if (targetGroupId === DEFAULT_GROUP_ID) return { ...data, groups };
  const target = groups.find((g) => g.id === targetGroupId);
  if (!target) return { ...data, groups };
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

export function reorderGroups(data: SessionGroups, fromId: string, toIndex: number): SessionGroups {
  if (fromId === DEFAULT_GROUP_ID) return data;
  const from = data.groups.findIndex((g) => g.id === fromId);
  if (from === -1) return data;
  const next = [...data.groups];
  const [item] = next.splice(from, 1);
  next.splice(toIndex, 0, item);
  return { ...data, groups: next };
}

export async function loadGroups(api: Api): Promise<GroupLoadResult> {
  const res = await api.read(GROUPS_PATH);
  if (!res.ok) {
    if (res.status === 404) return { data: emptyGroups(), version: undefined };
    throw new Error(res.message);
  }
  return { data: parseGroups(res.data?.content), version: res.data?.version };
}

export async function saveGroups(
  api: Api,
  data: SessionGroups,
  version?: unknown,
): Promise<unknown> {
  const res = await api.write(GROUPS_PATH, serializeGroups(data), version);
  if (!res.ok) throw new Error(res.message);
  return res.data?.version;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --test-isolation=none test/group-store.test.ts`
Expected: PASS（所有 group-store 测试）

- [ ] **Step 5: 提交**

```bash
git add src/client/group-store.ts test/group-store.test.ts
git commit -m "feat(dsh-myagent): 会话分组数据模型与纯函数"
```

---

## Task 2: 把 api 传入 WorkspaceBrowser

**Files:**
- Modify: `src/client/WorkspaceBrowser.tsx`
- Modify: `src/client/SidebarComposite.tsx`

- [ ] **Step 1: WorkspaceBrowserProps 增加 api**

在 `src/client/WorkspaceBrowser.tsx` 顶部 import 区加入：

```ts
import type { Api } from "./api.ts";
```

在 `WorkspaceBrowserProps` 接口中加入字段：

```ts
  /** 当前工作沙盒的文件 API（读取/写入 .myagent/groups.json 用）。 */
  api: Api | null;
```

- [ ] **Step 2: SidebarComposite 向 WorkspaceBrowser 传 api**

`src/client/SidebarComposite.tsx` 中有两处 `<WorkspaceBrowser ...>`：

- rail 分支：`<WorkspaceBrowser {...props} wide={false} />` 改为
  `<WorkspaceBrowser {...props} wide={false} api={api} />`
- 展开分支：`<WorkspaceBrowser {...props} wide toolbarKey={wsExpandSeq} scrollLock={wsAnimating} />` 改为
  `<WorkspaceBrowser {...props} wide toolbarKey={wsExpandSeq} scrollLock={wsAnimating} api={api} />`

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/client/WorkspaceBrowser.tsx src/client/SidebarComposite.tsx
git commit -m "feat(dsh-myagent): WorkspaceBrowser 接入 api 以读写分组元数据"
```

---

## Task 3: WorkspaceBrowser 加载并渲染分组

**Files:**
- Modify: `src/client/WorkspaceBrowser.tsx`

- [ ] **Step 1: 引入 group-store 并增加状态**

在 `src/client/WorkspaceBrowser.tsx` 顶部 import：

```ts
import {
  DEFAULT_GROUP_ID,
  emptyGroups,
  loadGroups,
  saveGroups,
  visibleSessionsForGroup,
  type SessionGroups,
} from "./group-store.ts";
```

在组件函数 `WorkspaceBrowser` 内部增加状态（放在现有 `collapsed` 状态附近）：

```ts
  const [groupsData, setGroupsData] = useState<SessionGroups>(() => emptyGroups());
  const [groupsVersion, setGroupsVersion] = useState<unknown>(undefined);
  const [groupsError, setGroupsError] = useState<string | null>(null);
```

- [ ] **Step 2: 加载 groups.json 的 effect**

在 `const [drag, setDrag] = ...` 之后加入：

```ts
  React.useEffect(() => {
    let cancelled = false;
    if (!props.api) {
      setGroupsData(emptyGroups());
      setGroupsVersion(undefined);
      return;
    }
    setGroupsError(null);
    loadGroups(props.api)
      .then(({ data, version }) => {
        if (cancelled) return;
        setGroupsData(data);
        setGroupsVersion(version);
      })
      .catch((e: Error) => {
        if (!cancelled) setGroupsError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [props.api?.root]);
```

- [ ] **Step 3: 定义分组折叠状态**

在 `const [confirmTarget, ...]` 附近加入：

```ts
  const GROUP_COLLAPSED_KEY = "fm.group.collapsed";
  const [groupCollapsed, setGroupCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(GROUP_COLLAPSED_KEY);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  });
  const toggleGroup = (groupId: string) => {
    setGroupCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      try { localStorage.setItem(GROUP_COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };
```

- [ ] **Step 4: 渲染分组结构**

把当前 `{!isCollapsed ? visible.map(...) : null}` 整段替换为“默认分组 + 命名分组”的渲染。

先定义一个内部辅助组件（放在 `WorkspaceBrowser` 函数外、文件末尾附近）：

```tsx
function GroupHeader(props: {
  name: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      role="treeitem"
      aria-expanded={!props.collapsed}
      className="fm-wb-row fm-wb-group-row"
      onClick={props.onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 4px 3px 12px",
        borderRadius: 6,
        cursor: "pointer",
        fontWeight: 600,
      }}
    >
      <span style={{ flex: "none", width: 16, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-secondary)" }}>
        {props.collapsed ? <IconFolderClose16 size={16} /> : <IconFolderOpen16 size={16} />}
      </span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
        {props.name} ({props.count})
      </span>
      {props.onRename || props.onDelete ? (
        <span className="fm-wb-row-actions" style={{ display: "inline-flex", gap: 2, flex: "none" }}>
          {props.onRename ? (
            <Button size="sm" variant="ghost" icon={<IconEditOutline16 size={16} />} style={ICON_BTN_STYLE} title="重命名分组" aria-label="重命名分组" onClick={(e) => { e.stopPropagation(); props.onRename?.(); }} />
          ) : null}
          {props.onDelete ? (
            <Button size="sm" variant="ghost" icon={<IconTrashOutline16 size={16} />} style={{ ...ICON_BTN_STYLE, color: "var(--dsw-alias-state-error-primary)" }} title="删除分组" aria-label="删除分组" onClick={(e) => { e.stopPropagation(); props.onDelete?.(); }} />
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
```

在 `{!isCollapsed ? ... : null}` 处替换为：

```tsx
{!isCollapsed ? (
  <>
    {renderGroupSection({
      workspaceId: w.workspaceId,
      groupId: DEFAULT_GROUP_ID,
      name: groupsData.defaultGroup.name,
      sessions: visibleSessionsForGroup(groupsData, DEFAULT_GROUP_ID, w.sessionIds ?? []),
    })}
    {groupsData.groups.map((g) =>
      renderGroupSection({
        workspaceId: w.workspaceId,
        groupId: g.id,
        name: g.name,
        sessions: visibleSessionsForGroup(groupsData, g.id, w.sessionIds ?? []),
      }),
    )}
  </>
) : null}
```

并在组件内部（`WorkspaceBrowser` 函数体内）定义 `renderGroupSection`：

```tsx
const renderGroupSection = (arg: {
  workspaceId: string;
  groupId: string;
  name: string;
  sessions: string[];
}) => {
  const isCollapsedGroup = groupCollapsed.has(arg.groupId);
  return (
    <div key={arg.groupId} style={{ position: "relative" }}>
      <GroupHeader
        name={arg.name}
        count={arg.sessions.length}
        collapsed={isCollapsedGroup}
        onToggle={() => toggleGroup(arg.groupId)}
        onRename={arg.groupId === DEFAULT_GROUP_ID ? undefined : () => setGroupAction({ kind: "rename", workspaceId: arg.workspaceId, groupId: arg.groupId, name: arg.name })}
        onDelete={arg.groupId === DEFAULT_GROUP_ID ? undefined : () => setGroupAction({ kind: "delete", workspaceId: arg.workspaceId, groupId: arg.groupId, name: arg.name })}
      />
      {!isCollapsedGroup
        ? arg.sessions.map((id) => {
            const s = sessions[id];
            const label = s?.title || (s?.blank ? "新会话" : id);
            return (
              <div
                key={id}
                role="treeitem"
                aria-selected={id === current}
                className="fm-wb-row"
                draggable
                style={{
                  padding: "3px 4px 3px 20px",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  position: "relative",
                  background: id === current ? "var(--dsw-alias-interactive-bg-hover)" : undefined,
                  borderRadius: 6,
                }}
                onClick={() => props.open?.(id)}
              >
                <span style={{ flex: "none", width: 16, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-tertiary)" }}>
                  {statusDot(id, s)}
                </span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{label}</span>
                <span className="fm-wb-row-actions" style={{ display: "inline-flex", gap: 2, flex: "none" }}>
                  <Button size="sm" variant="ghost" icon={<IconListPenOutline16 size={16} />} style={ICON_BTN_STYLE} title="重命名会话" aria-label="重命名会话" onClick={(e) => { e.stopPropagation(); setRenameTarget({ kind: "session", id, title: label }); }} />
                  <Button size="sm" variant="ghost" icon={<IconArchiveOutline20 size={16} />} style={ICON_BTN_STYLE} title="归档会话" aria-label="归档会话" onClick={(e) => { e.stopPropagation(); setConfirmTarget({ kind: "session", id, title: label }); }} />
                </span>
              </div>
            );
          })
        : null}
    </div>
  );
};
```

> 注意：`renderGroupSection` 中先不接拖拽/移动菜单，后续 Task 5 再补。

- [ ] **Step 5: 增加 groupAction 状态**

在 `renameTarget` 状态附近加入：

```ts
  const [groupAction, setGroupAction] = useState<
    | { kind: "create"; workspaceId: string }
    | { kind: "rename"; workspaceId: string; groupId: string; name: string }
    | { kind: "delete"; workspaceId: string; groupId: string; name: string }
    | null
  >(null);
```

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS（`groupAction` 暂未使用会因未开启 noUnusedLocals 而不报错；如报 unused，先加一个空引用或后续 Task 4 使用）

- [ ] **Step 7: 提交**

```bash
git add src/client/WorkspaceBrowser.tsx
git commit -m "feat(dsh-myagent): 工作沙盒内渲染默认分组与命名分组"
```

---

## Task 4: 分组新建/重命名/删除/拖拽排序

**Files:**
- Modify: `src/client/WorkspaceBrowser.tsx`

- [ ] **Step 1: 新建分组入口**

在工作沙盒行 hover 操作组中加入“新建分组”按钮（放在“在此工作沙盒新建会话”旁边）：

```tsx
<Button
  size="sm"
  variant="ghost"
  icon={<IconPlusOutline16 size={16} />}
  style={ICON_BTN_STYLE}
  title="新建分组"
  aria-label="新建分组"
  onClick={(e) => {
    e.stopPropagation();
    setGroupAction({ kind: "create", workspaceId: w.workspaceId });
  }}
/>
```

- [ ] **Step 2: 新建/重命名使用 PromptModal**

在现有 `PromptModal` 区域（`renameTarget` 渲染之后）加入：

```tsx
{groupAction?.kind === "create" ? (
  <PromptModal
    open
    title="新建分组"
    description="输入分组名称，例如：工作、项目A"
    placeholder="分组名称"
    initialValue=""
    validate={(v) => validateNameInput(v)}
    onSubmit={(name) => {
      const next = createGroup(groupsData, name);
      setGroupsData(next);
      saveGroups(props.api!, next, groupsVersion).then(setGroupsVersion).catch((e) => window.alert(`保存分组失败：${e.message}`));
      setGroupAction(null);
    }}
    onClose={() => setGroupAction(null)}
  />
) : null}

{groupAction?.kind === "rename" ? (
  <PromptModal
    open
    title="重命名分组"
    description="输入新的分组名称"
    placeholder="分组名称"
    initialValue={groupAction.name}
    validate={(v) => validateNameInput(v)}
    onSubmit={(name) => {
      const next = renameGroup(groupsData, groupAction.groupId, name);
      setGroupsData(next);
      saveGroups(props.api!, next, groupsVersion).then(setGroupsVersion).catch((e) => window.alert(`保存分组失败：${e.message}`));
      setGroupAction(null);
    }}
    onClose={() => setGroupAction(null)}
  />
) : null}
```

需要在 `WorkspaceBrowser.tsx` 顶部 import 补充：

```ts
import { createGroup, renameGroup, deleteGroup, reorderGroups } from "./group-store.ts";
```

- [ ] **Step 3: 删除分组选择去向对话框**

新增一个内部组件 `GroupDeleteDialog`（放在 `GroupHeader` 附近）：

```tsx
function GroupDeleteDialog(props: {
  groupName: string;
  destinationOptions: { id: string; name: string }[];
  onCancel: () => void;
  onConfirm: (destination: "default" | "archive" | string) => void;
}) {
  const [dest, setDest] = useState<"default" | "archive" | string>("default");
  return (
    <Modal
      open
      onClose={props.onCancel}
      title={`删除分组“${props.groupName}”`}
      description="组内聊天框要如何处理？"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={props.onCancel}>取消</Button>
          <Button size="sm" variant="primary" onClick={() => props.onConfirm(dest)}>确认</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="radio" checked={dest === "default"} onChange={() => setDest("default")} />
          移回默认分组
        </label>
        {props.destinationOptions.map((g) => (
          <label key={g.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="radio" checked={dest === g.id} onChange={() => setDest(g.id)} />
            移到 {g.name}
          </label>
        ))}
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="radio" checked={dest === "archive"} onChange={() => setDest("archive")} />
          归档会话
        </label>
      </div>
    </Modal>
  );
}
```

在 `WorkspaceBrowser.tsx` 顶部 import 补充：

```ts
import { Modal } from "@deepseek-ai/dsh-client-ui-primitives";
```

在 `groupAction?.kind === "delete"` 时渲染：

```tsx
{groupAction?.kind === "delete" ? (
  <GroupDeleteDialog
    groupName={groupAction.name}
    destinationOptions={groupsData.groups.filter((g) => g.id !== groupAction.groupId).map((g) => ({ id: g.id, name: g.name }))}
    onCancel={() => setGroupAction(null)}
    onConfirm={(dest) => {
      const { data, sessionsToArchive } = deleteGroup(groupsData, groupAction.groupId, dest);
      setGroupsData(data);
      saveGroups(props.api!, data, groupsVersion)
        .then((v) => {
          setGroupsVersion(v);
          for (const id of sessionsToArchive) props.archiveSession?.(id);
        })
        .catch((e) => window.alert(`保存分组失败：${e.message}`));
      setGroupAction(null);
    }}
  />
) : null}
```

> `destinationOptions` 使用 `{ id, name }[]`，radio 值用 id，显示名用 name。

- [ ] **Step 4: 分组拖拽排序**

给 `GroupHeader` 增加可选 `draggable` 相关 props，或直接在 `renderGroupSection` 的 `GroupHeader` 外包一层可拖拽容器：

在 `renderGroupSection` 返回的根 `div` 上增加：

```tsx
draggable={arg.groupId !== DEFAULT_GROUP_ID}
onDragStart={(e) => {
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", arg.groupId);
  setDrag({ kind: "group", id: arg.groupId, workspaceId: arg.workspaceId, over: null });
}}
onDragOver={(e) => {
  if (drag?.kind !== "group" || drag.workspaceId !== arg.workspaceId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}}
onDrop={(e) => {
  if (drag?.kind !== "group" || drag.workspaceId !== arg.workspaceId) return;
  e.preventDefault();
  const fromId = drag.id;
  const toId = arg.groupId;
  const fromIndex = groupsData.groups.findIndex((g) => g.id === fromId);
  const toIndex = groupsData.groups.findIndex((g) => g.id === toId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
  const next = reorderGroups(groupsData, fromId, toIndex);
  setGroupsData(next);
  saveGroups(props.api!, next, groupsVersion).then(setGroupsVersion).catch((e) => window.alert(`保存分组失败：${e.message}`));
  setDrag(null);
}}
```

同时把 `DragState` 的 `kind` 联合类型扩展：

```ts
interface DragState {
  kind: "workspace" | "session" | "group";
  ...
}
```

`commitDrag`/`endDrag` 中遇到 `kind === "group"` 时直接 `setDrag(null)` 返回，避免走会话/工作沙盒逻辑：

```ts
if (active.kind === "group") {
  setDrag(null);
  dropCommitted.current = false;
  return;
}
```

- [ ] **Step 5: 类型检查与提交**

Run: `npx tsc --noEmit`
Expected: PASS

```bash
git add src/client/WorkspaceBrowser.tsx
git commit -m "feat(dsh-myagent): 分组新建/重命名/删除/拖拽排序"
```

---

## Task 5: 会话移动（菜单 + 拖拽）

**Files:**
- Modify: `src/client/WorkspaceBrowser.tsx`

- [ ] **Step 1: 会话行增加“移动到分组”菜单**

在会话行 hover 操作组中增加按钮：

```tsx
<Button
  size="sm"
  variant="ghost"
  icon={<IconFolderOpen16 size={16} />}
  style={ICON_BTN_STYLE}
  title="移动到分组"
  aria-label="移动到分组"
  onClick={(e) => {
    e.stopPropagation();
    setMoveSessionTarget({ workspaceId: arg.workspaceId, sessionId: id });
  }}
/>
```

新增状态：

```ts
  const [moveSessionTarget, setMoveSessionTarget] = useState<null | { workspaceId: string; sessionId: string }>(null);
```

新增一个简单的选择对话框（复用 `Modal`）：

```tsx
function MoveSessionDialog(props: {
  groupOptions: { id: string; name: string }[];
  onCancel: () => void;
  onConfirm: (groupId: string) => void;
}) {
  const [dest, setDest] = useState<string>(DEFAULT_GROUP_ID);
  return (
    <Modal
      open
      onClose={props.onCancel}
      title="移动到分组"
      description="选择目标分组"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={props.onCancel}>取消</Button>
          <Button size="sm" variant="primary" onClick={() => props.onConfirm(dest)}>确认</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
        {props.groupOptions.map((g) => (
          <label key={g.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="radio" checked={dest === g.id} onChange={() => setDest(g.id)} />
            {g.name}
          </label>
        ))}
      </div>
    </Modal>
  );
}
```

渲染：

```tsx
{moveSessionTarget ? (
  <MoveSessionDialog
    groupOptions={[
      { id: DEFAULT_GROUP_ID, name: groupsData.defaultGroup.name },
      ...groupsData.groups.map((g) => ({ id: g.id, name: g.name })),
    ]}
    onCancel={() => setMoveSessionTarget(null)}
    onConfirm={(groupId) => {
      const next = moveSessionToGroup(groupsData, moveSessionTarget.sessionId, groupId);
      setGroupsData(next);
      saveGroups(props.api!, next, groupsVersion)
        .then((v) => setGroupsVersion(v))
        .catch((e) => window.alert(`保存分组失败：${e.message}`));
      // 移动到其他分组时，追加到宿主扁平顺序末尾，便于目标分组按当前顺序显示。
      if (groupId !== DEFAULT_GROUP_ID) {
        props.insertSessionBefore?.(moveSessionTarget.workspaceId, moveSessionTarget.sessionId, undefined);
      }
      setMoveSessionTarget(null);
    }}
  />
) : null}
```

- [ ] **Step 2: 会话拖拽入分组**

给 `GroupHeader` 增加两个可选 props：

```ts
  onSessionDragOver?: (e: React.DragEvent) => void;
  onSessionDrop?: (e: React.DragEvent) => void;
```

在 `GroupHeader` 根元素上追加这两个 handler：

```tsx
onDragOver={props.onSessionDragOver}
onDrop={props.onSessionDrop}
```

在 `renderGroupSection` 中向 `GroupHeader` 传入：

```tsx
<GroupHeader
  name={arg.name}
  count={arg.sessions.length}
  collapsed={isCollapsedGroup}
  onToggle={() => toggleGroup(arg.groupId)}
  onRename={...}
  onDelete={...}
  onSessionDragOver={(e) => {
    if (drag?.kind !== "session" || drag.workspaceId !== arg.workspaceId || drag.groupId === arg.groupId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }}
  onSessionDrop={(e) => {
    if (drag?.kind !== "session" || drag.workspaceId !== arg.workspaceId || drag.groupId === arg.groupId) return;
    e.preventDefault();
    const next = moveSessionToGroup(groupsData, drag.id, arg.groupId);
    setGroupsData(next);
    saveGroups(props.api!, next, groupsVersion)
      .then((v) => setGroupsVersion(v))
      .catch((err) => window.alert(`保存分组失败：${err.message}`));
    if (arg.groupId !== DEFAULT_GROUP_ID) {
      props.insertSessionBefore?.(arg.workspaceId, drag.id, undefined);
    }
    setDrag(null);
    dropCommitted.current = false;
  }}
/>
```

> 分组拖拽排序（Task 4）的 `onDragOver/onDrop` 仍放在 `renderGroupSection` 的外层容器上；会话拖拽入组放在 `GroupHeader` 上，两者互不覆盖。

- [ ] **Step 3: 会话拖拽状态携带 groupId**

在会话行 `onDragStart` 中补充 `groupId`：

```ts
setDrag({
  kind: "session",
  id,
  workspaceId: w.workspaceId,
  groupId: groupOfSession(groupsData, id),
  over: null,
});
```

修改 `DragState`：

```ts
interface DragState {
  kind: "workspace" | "session" | "group";
  id: string;
  workspaceId?: string;
  /** session 拖拽所属分组；用于限制同组内排序、跨组时只能 drop 到分组行。 */
  groupId?: string;
  over: { id: string; half: "before" | "after" } | null;
}
```

- [ ] **Step 4: 限制会话行拖拽只在同组内排序**

把会话行 `onDragOver` 条件从：

```ts
drag?.kind === "session" && drag.workspaceId === w.workspaceId
```

改为：

```ts
drag?.kind === "session" &&
drag.workspaceId === w.workspaceId &&
drag.groupId === groupOfSession(groupsData, id)
```

`onDrop` 同样加上 `drag.groupId === groupOfSession(groupsData, id)` 条件。

- [ ] **Step 5: 类型检查与提交**

Run: `npx tsc --noEmit`
Expected: PASS

```bash
git add src/client/WorkspaceBrowser.tsx
git commit -m "feat(dsh-myagent): 会话支持菜单/拖拽移动到分组"
```

---

## Task 6: 文件树隐藏 .myagent

**Files:**
- Modify: `src/service.ts`
- Modify: `test/service.test.ts`

- [ ] **Step 1: 编写失败测试**

在 `test/service.test.ts` 末尾追加：

```ts
test("tree 根目录隐藏 .myagent 元数据目录", async () => {
  fs.mkdirSync(path.join(root, ".myagent"));
  fs.writeFileSync(path.join(root, ".myagent", "groups.json"), "{}");
  fs.writeFileSync(path.join(root, "visible.txt"), "x");
  const r = await svc.tree(root, "");
  const names = r.entries.map((e: any) => e.name);
  assert.ok(!names.includes(".myagent"));
  assert.ok(names.includes("visible.txt"));
});
```

> 该测试直接使用现有 `beforeEach` 创建的 `root`、`svc`，无需额外 helper。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --test-isolation=none test/service.test.ts`
Expected: FAIL，`.myagent` 仍出现在 entries

- [ ] **Step 3: 实现过滤**

修改 `src/service.ts` 的 `tree()`：

```ts
const entries = (await this.fs.listDir(t))
  .filter((e) => !(rel === "" && e.name === ".myagent"))
  .map((e) => ({
    name: e.name,
    path: rel === "" ? e.name : `${rel}/${e.name}`,
    kind: e.type === "dir" || e.type === "directory" ? "dir" : "file",
    ...(e.size !== undefined ? { size: e.size } : {}),
  }));
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test --test-isolation=none test/service.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/service.ts test/service.test.ts
git commit -m "feat(dsh-myagent): 文件树隐藏 .myagent 元数据目录"
```

---

## Task 7: 全量验证与收尾

- [ ] **Step 1: 全量测试**

Run: `node --test --test-isolation=none`
Expected: PASS（92 + 新增 group-store/service 测试）

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 构建并冒烟**

Run:
```bash
npm run build:node
node --check lib/client.js
node smoke.mjs
```
Expected: 全部 PASS

> 若沙箱不允许 esbuild spawn，客户端 bundle 使用临时 tsdown 配置重建（见 `.cache/client-tsdown.config.ts`），并确保 `lib/client.js` 包含新分组渲染。

- [ ] **Step 4: 更新 README 与 Claude_memory**

- `README.md` 功能列表增加“工作沙盒内聊天框分组”。
- `Claude_memory.md` 记录本功能实现要点。

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs(dsh-myagent): 记录聊天框分组功能"
```

---

## 自审记录

- 规格覆盖：数据模型（Task 1）、UI 渲染（Task 3）、分组管理（Task 4）、会话移动（Task 5）、隐藏元数据（Task 6）、测试（Task 1/6/7）。
- 类型一致性：`DragState.kind` 统一扩展为 `"workspace" | "session" | "group"`；`group-store` 函数名在 Task 1 定义后，后续任务引用一致。
- 无占位符：所有新增代码均给出完整实现；UI 接线以“替换/新增”形式给出关键代码。

// src/client/annotation-store.ts — 工作区内“一句话标注”的数据模型、纯函数与读写封装。
// 对应设计文档：docs/superpowers/specs/2026-08-16-sandbox-organizer-design.md
// 标注权威副本始终在 `<工作区根>/.myagent/annotations.json`，UI 直接读写；
// 常驻子 agent 只消费同步注入的摘要视图。
import { Api } from "./api.ts";
import type { ApiError } from "./api.ts";

export const ANNOTATIONS_PATH = ".myagent/annotations.json";

export interface AnnotationRecord {
  id: string;
  brief: string;
  updatedAt: string;
}

export interface GroupAnnotation extends AnnotationRecord {
  workspaceId: string;
}

export interface SessionAnnotation extends AnnotationRecord {
  title?: string;
  /**
   * 上次总结时宿主给的会话持久化标记（`ev:<事件数>` / `sz:<字节数>`）。
   * 区管家用它判断"自上次总结之后这个对话有没有新内容" —— 相等就跳过，不再重复总结。
   */
  marker?: string;
}

export interface AnnotationData {
  version: 1;
  workspaces: Record<string, AnnotationRecord>;
  groups: Record<string, GroupAnnotation>;
  sessions: Record<string, SessionAnnotation>;
  lastOrganizedAt?: string;
  lastPlan?: unknown;
}

export interface AnnotationLoadResult {
  data: AnnotationData;
  version?: unknown;
}

export function emptyAnnotations(): AnnotationData {
  return {
    version: 1,
    workspaces: {},
    groups: {},
    sessions: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAnnotationRecord(id: string, value: unknown): AnnotationRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" && typeof id !== "string") return null;
  if (typeof value.brief !== "string") return null;
  return {
    id: typeof value.id === "string" ? value.id : id,
    brief: value.brief,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

function parseGroupAnnotation(id: string, value: unknown): GroupAnnotation | null {
  const base = parseAnnotationRecord(id, value);
  if (!base) return null;
  const workspaceId = isRecord(value) && typeof value.workspaceId === "string" ? value.workspaceId : "";
  return { ...base, workspaceId };
}

function parseSessionAnnotation(id: string, value: unknown): SessionAnnotation | null {
  const base = parseAnnotationRecord(id, value);
  if (!base) return null;
  const title = isRecord(value) && typeof value.title === "string" ? value.title : undefined;
  const marker = isRecord(value) && typeof value.marker === "string" ? value.marker : undefined;
  return {
    ...base,
    ...(title === undefined ? {} : { title }),
    ...(marker === undefined ? {} : { marker }),
  };
}

export function parseAnnotations(text: string | null | undefined): AnnotationData {
  if (!text) return emptyAnnotations();
  try {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw)) return emptyAnnotations();
    const version = typeof raw.version === "number" ? raw.version : 1;
    const workspaces: Record<string, AnnotationRecord> = {};
    if (isRecord(raw.workspaces)) {
      for (const [id, value] of Object.entries(raw.workspaces)) {
        const record = parseAnnotationRecord(id, value);
        if (record) workspaces[id] = record;
      }
    }
    const groups: Record<string, GroupAnnotation> = {};
    if (isRecord(raw.groups)) {
      for (const [id, value] of Object.entries(raw.groups)) {
        const record = parseGroupAnnotation(id, value);
        if (record) groups[id] = record;
      }
    }
    const sessions: Record<string, SessionAnnotation> = {};
    if (isRecord(raw.sessions)) {
      for (const [id, value] of Object.entries(raw.sessions)) {
        const record = parseSessionAnnotation(id, value);
        if (record) sessions[id] = record;
      }
    }
    return {
      version: version as 1,
      workspaces,
      groups,
      sessions,
      ...(typeof raw.lastOrganizedAt === "string" ? { lastOrganizedAt: raw.lastOrganizedAt } : {}),
      ...(isRecord(raw.lastPlan) ? { lastPlan: raw.lastPlan } : {}),
    };
  } catch {
    return emptyAnnotations();
  }
}

export function serializeAnnotations(data: AnnotationData): string {
  return JSON.stringify(data, null, 2);
}

export function setWorkspaceBrief(
  data: AnnotationData,
  id: string,
  brief: string,
  now = new Date().toISOString(),
): AnnotationData {
  return {
    ...data,
    workspaces: {
      ...data.workspaces,
      [id]: { id, brief, updatedAt: now },
    },
  };
}

export function setGroupBrief(
  data: AnnotationData,
  id: string,
  workspaceId: string,
  brief: string,
  now = new Date().toISOString(),
): AnnotationData {
  return {
    ...data,
    groups: {
      ...data.groups,
      [id]: { id, brief, updatedAt: now, workspaceId },
    },
  };
}

export function setSessionBrief(
  data: AnnotationData,
  id: string,
  title: string | undefined,
  brief: string,
  now = new Date().toISOString(),
): AnnotationData {
  const prev = data.sessions[id];
  return {
    ...data,
    sessions: {
      ...data.sessions,
      [id]: {
        id,
        brief,
        updatedAt: now,
        ...(title === undefined ? {} : { title }),
        // marker 由区管家写入（见 setSessionMarker）；这里保留已有值，避免普通重命名把它抹掉。
        ...(prev?.marker === undefined ? {} : { marker: prev.marker }),
      },
    },
  };
}

/**
 * 记录"这个会话已经被总结到哪个版本"。
 *
 * 区管家的一次性更新靠它做增量：marker 与宿主当前值相等 → 说明这条对话自上次总结后
 * 没有任何新内容 → 直接跳过（不调模型）。所以只有**真的总结过**才写它。
 */
export function setSessionMarker(
  data: AnnotationData,
  id: string,
  marker: string,
  now = new Date().toISOString(),
): AnnotationData {
  const prev = data.sessions[id];
  return {
    ...data,
    sessions: {
      ...data.sessions,
      [id]: {
        id,
        brief: prev?.brief ?? "",
        ...(prev?.title === undefined ? {} : { title: prev.title }),
        marker,
        updatedAt: now,
      },
    },
  };
}

export function setLastOrganizedAt(data: AnnotationData, iso: string): AnnotationData {
  return { ...data, lastOrganizedAt: iso };
}

export function setLastPlan(data: AnnotationData, plan: unknown): AnnotationData {
  return { ...data, lastPlan: plan };
}

/** 从标题生成一句默认简述（不读取会话内容，符合设计“非目标”）。 */
export function deriveBriefFromTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "";
  return `对话：${trimmed}`;
}

export async function loadAnnotations(api: Api): Promise<AnnotationLoadResult> {
  const res = await api.read(ANNOTATIONS_PATH);
  if (!res.ok) {
    if (res.status === 404) return { data: emptyAnnotations(), version: undefined };
    throw { status: res.status, code: res.code, message: res.message } satisfies ApiError;
  }
  return { data: parseAnnotations(res.data?.content), version: res.data?.version };
}

export async function saveAnnotations(
  api: Api,
  data: AnnotationData,
  version?: unknown,
): Promise<unknown> {
  const res = await api.write(ANNOTATIONS_PATH, serializeAnnotations(data), version);
  if (!res.ok) {
    throw { status: res.status, code: res.code, message: res.message } satisfies ApiError;
  }
  return res.data?.version;
}

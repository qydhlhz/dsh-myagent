// src/client/active-root-store.ts — 文件树"当前根"的显式选择（模块级小 store）。
//
// 为什么需要：文件树的根原本只由 `resolveRoot(sessions, workspaces)` 推导（当前会话所属
// 工作区 → 回落到第一个工作区）。用户点左侧"区"标签时希望能把文件树切到那个区，而"点标签"
// 这个动作不改变任何会话状态，推导式拿不到这个意图，所以需要一个显式覆盖位。
//
// 语义：
//   - 有显式选择（activeRoot !== null）→ 用它；
//   - 没有 → 回到推导值；
//   - 切换会话时由消费方调 clearActiveRoot()，让文件树跟着会话走（避免"点了 A 区、
//     又打开 B 区的会话，树还停在 A"）。
// 不可变快照 + Set 监听器，getSnapshot 返回同一引用直至状态变化（useSyncExternalStore 要求）。
import { useSyncExternalStore } from "react";

let activeRoot: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 用户点了某个区标签：把文件树根切到该区。重复点同一个区不触发通知。 */
export function setActiveRoot(root: string): void {
  if (activeRoot === root) return;
  activeRoot = root;
  emit();
}

/** 放弃显式选择，回到推导根（切换会话时调用）。未选择时是空操作。 */
export function clearActiveRoot(): void {
  if (activeRoot === null) return;
  activeRoot = null;
  emit();
}

export function getActiveRoot(): string | null {
  return activeRoot;
}

export function subscribeActiveRoot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React 18 hook：订阅显式选择（ComposedInner 用）。 */
export function useActiveRoot(): string | null {
  return useSyncExternalStore(subscribeActiveRoot, getActiveRoot, getActiveRoot);
}

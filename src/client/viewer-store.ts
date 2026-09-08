// src/client/viewer-store.ts — 查看器共享状态（Round 2：查看器改为 details 列并行分割后，
// 打开文件的状态从 sidebar 的 Composed 提升为模块级小 store，供两处消费）：
//   - SidebarComposite 侧（Composed）：FileTree onOpenFile → openViewer(root, path) +
//     ctx.layout.openDetails()；切换工作沙盒 → closeViewer()。
//   - details 槽侧（DetailsComposite）：useViewerState() 读到 path/root → 渲染 FileViewerPanel；
//     无 → 渲染空态。
// 设计：不可变快照 + Set 监听器，getSnapshot 返回同一对象引用直至状态变化
// （useSyncExternalStore 的快照稳定性要求）。不依赖 React 之外任何运行时。
import { useSyncExternalStore } from "react";

export interface ViewerState {
  /** 工作沙盒根（绝对路径）；null = 未打开任何文件。 */
  root: string | null;
  /** 条目相对路径；null = 未打开任何文件。 */
  path: string | null;
}

const EMPTY: ViewerState = { root: null, path: null };

let state: ViewerState = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 打开查看器（FileTree onOpenFile 后由 Composed 调用）。root 与 path 均与当前快照
 *  相等时不通知（与 closeViewer 的 EMPTY 守卫对称，重复点击同一文件不触发重渲染）。 */
export function openViewer(root: string, path: string): void {
  if (state.root === root && state.path === path) return;
  state = { root, path };
  emit();
}

/** 关闭查看器（详情面板关闭按钮 / 切换工作沙盒）。空状态重复关闭不触发通知。 */
export function closeViewer(): void {
  if (state === EMPTY) return;
  state = EMPTY;
  emit();
}

export function getViewerState(): ViewerState {
  return state;
}

export function subscribeViewer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React 18 hook：订阅查看器状态（DetailsComposite 用）。 */
export function useViewerState(): ViewerState {
  return useSyncExternalStore(subscribeViewer, getViewerState, getViewerState);
}

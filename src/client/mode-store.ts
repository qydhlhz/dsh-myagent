// src/client/mode-store.ts — 原始模式 / MyAgent 模式。localStorage 持久化 + 订阅。
// 模式只切换"我们的 UI 贡献层"注册状态，插件本身保持运行（避免自锁死）。
import React from "react";

export type Mode = "myagent" | "original";

const KEY = "dsh-myagent.mode";
let mode: Mode = (() => {
  try { return localStorage.getItem(KEY) === "myagent" ? "myagent" : "original"; } catch { return "original"; }
})();
const listeners = new Set<() => void>();

export function getMode(): Mode { return mode; }
export function setMode(m: Mode): void {
  if (m === mode) return;
  mode = m;
  try { localStorage.setItem(KEY, m); } catch { /* 隐私模式等场景忽略 */ }
  for (const l of [...listeners]) l();
}
export function subscribeMode(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export function useMode(): Mode {
  return React.useSyncExternalStore(subscribeMode, getMode);
}

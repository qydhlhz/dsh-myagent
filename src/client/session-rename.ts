// src/client/session-rename.ts — 给任意会话改名（区管家批量命名、重命名弹窗共用）。
//
// 【为什么单独成模块】client.ts 是插件入口，import 了一堆 .tsx，Node 测试跑不了；
// 而"改名"这条路径恰恰必须能被测试钉住 —— 它曾经静默失效过整整一轮。
//
// 【2026-10-03 的真根因】桌面版 DSH（0.2.0-rc.2，`D:\DSH`）里，客户端会话服务把
// `binding` 改成了**保留引用上的 getter**：
//   `class SessionReference { get binding() { … return this.record.binding; } }`
//   （dsh-api-session-controller/lib/client.js:3110）
// 服务本身上没有 `binding` 方法，所以旧写法
//   `ctx.sessions.binding(sessionId)?.session.rename(title)`
// 直接 `TypeError: ctx.sessions.binding is not a function`；又因为调用点是"发了不等"
// （fire-and-forget），异常退化成 unhandled rejection —— **改名静默失效**：
// 标题只写进本插件自己的 annotations.json，dsh 侧（会话列表 / 对话头部）永远还是旧名字。
// 用户看到的就是"区管家的重命名功能坏了"。
//
// 官方 ui-workspace 的做法（dsh-client-ui-workspace/lib/client.js:4176）：
//   `sessions.using(sessionId, { source: "workspaceOperation" },
//                    (reference) => reference.binding.session.rename(title))`
// `using` 会 retain → 等 session open → 跑回调 → release，因此**没被打开过的会话也能改名**。
// 旧版本 dsh 没有 `using` 时退回原来的 `binding` 路径，两边都能用。
export interface RenameOutcome {
  ok?: boolean;
  error?: { message?: string } | null;
}

/** 会话客户端服务的最小形状（`using` 与旧的 `binding` 都是可选的）。 */
export interface SessionsLike {
  using?: (
    target: string,
    options: { source: string; signal?: AbortSignal },
    operation: (reference: any) => unknown,
  ) => Promise<unknown>;
  binding?: (sessionId: string) => { session?: { rename(title: string): Promise<RenameOutcome> } } | undefined;
}

/**
 * 给一个会话改标题（dsh 侧真改名，不只是插件侧标注）。
 *
 * @param sessions `ctx.sessions`（客户端会话服务）
 * @param sessionId 目标会话（**不需要**已打开）
 * @param title 新标题（宿主会做规范化并返回接受后的标题）
 * @throws 宿主拒绝/服务形状不认识时抛出可读错误 —— 调用方必须 await 并展示它
 */
export async function renameSessionVia(sessions: SessionsLike | undefined, sessionId: string, title: string): Promise<void> {
  // ① 新版 dsh：retain + open + rename + release。
  if (typeof sessions?.using === "function") {
    const result = (await sessions.using(sessionId, { source: "myagentOrganizer" }, (reference: any) =>
      reference.binding.session.rename(title))) as RenameOutcome | undefined;
    if (result?.ok) return;
    throw new Error(result?.error?.message ?? `rename failed for "${sessionId}"`);
  }
  // ② 旧版 dsh：会话必须已被打开（binding 直接给到会话句柄）。
  const session = sessions?.binding?.(sessionId)?.session;
  if (session === undefined) {
    throw new Error(`unknown session "${sessionId}"（当前 dsh 版本既没有 sessions.using，也没有已绑定的会话）`);
  }
  const result = await session.rename(title);
  if (!result?.ok) throw new Error(result?.error?.message ?? `rename failed for "${sessionId}"`);
}

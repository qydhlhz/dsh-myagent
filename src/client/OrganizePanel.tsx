// src/client/OrganizePanel.tsx — 区管家面板。
//
// 定位（用户定案）：区管家就是一个**不显示对话框的独立对话 agent**，只跑两条固定提示词命令：
//   ① 一键更新全部对话：逐个会话读内容 → 先写简介 → 再写「主题：进度」标题（没聊过的不碰）
//   ② 一键整理分组：按项目名归类，给出并应用分组调整
// 面板只做三件事：**说清自己是什么**、**给两个按钮**、**显示消耗用量**。
// 所以这里不再有"几十条差异逐条勾选"那种要用户先做功课的界面，只有运行结果与用量。
import React, { useState } from "react";
import {
  Button,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconCloseOutline16,
  IconLoadingOutline16,
  IconRefreshOutline16,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { OrganizerAgentInfo, OrganizerRunSummary, OrganizerUsage } from "./api.ts";
import { TopHatIcon } from "./TopHatIcon.tsx";
import { RADIUS } from "./ui-kit.ts";

/**
 * 面板局部样式。只做两件事：
 *  ① 把 `IconLoadingOutline16` 从静态缺口弧变成真正在转的转圈（官方图标本身不带动画）；
 *  ② 明细按钮的悬停底色（走官方 interactive-bg-hover token，不硬编码色值）。
 * 与 RailPanel / WorkspaceBrowser 一样，用组件内 `<style>` 注入，命名统一 fm-op-* 前缀。
 */
const PANEL_CSS = `
@keyframes fm-op-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.fm-op-spin{animation:fm-op-spin 1s linear infinite;transform-origin:50% 50%}
.fm-op-detail{transition:background .12s ease,color .12s ease}
.fm-op-detail:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.fm-op-detail:active{background:var(--dsw-alias-interactive-bg-active)}
`;

/** 大数字加千分位。 */
function n(value: number | undefined | null): string {
  return typeof value === "number" ? value.toLocaleString("en-US") : "-";
}

function Row(props: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, padding: "2px 0", fontSize: 12, lineHeight: 1.6 }}>
      <span style={{ flex: "none", width: 86, color: "var(--dsw-alias-label-secondary)" }}>{props.label}</span>
      <span style={{ minWidth: 0, flex: 1, wordBreak: "break-word" }}>{props.value}</span>
    </div>
  );
}

function Head(props: { children: React.ReactNode }) {
  return (
    <div style={{ margin: "10px 0 4px", fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-secondary)" }}>
      {props.children}
    </div>
  );
}

/**
 * 运行结果的一句话摘要 + 可展开明细（+ 可选的撤销按钮）。
 *
 * 明细按钮的位置（用户定案）：放在**本块右上角**，与标题同一行 —— 结果块可能很长，
 * 按钮跟在正文后面时要先滚到底才看得见。展开后按钮文案变「收起明细」，
 * 同时在明细列表**末尾**再放一个「收起明细」：翻完长列表的人不必再滚回顶部。
 */
function ResultBlock(props: {
  title: string;
  summary: React.ReactNode;
  details?: Array<{ key: string; primary: string; secondary?: string }>;
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const count = props.details?.length ?? 0;
  const detailButtonStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    flex: "none",
    height: 22,
    padding: "0 8px",
    border: "none",
    borderRadius: RADIUS.pill,
    background: "transparent",
    color: "var(--dsw-alias-label-secondary)",
    font: "inherit",
    fontSize: 12,
    lineHeight: 1,
    cursor: "pointer",
  };
  return (
    <div
      style={{
        marginTop: 6,
        padding: "6px 8px",
        borderRadius: RADIUS.card,
        background: "var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.08))",
        fontSize: 12,
        lineHeight: 1.7,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{props.title}</span>
        {count > 0 ? (
          <button
            type="button"
            className="fm-op-detail"
            aria-expanded={open}
            title={open ? "收起明细" : "查看明细"}
            onClick={() => setOpen((v) => !v)}
            style={detailButtonStyle}
          >
            {open ? "收起明细" : `查看明细（${count}）`}
            {open ? <IconChevronUpOutline14 size={14} /> : <IconChevronDownOutline14 size={14} />}
          </button>
        ) : null}
      </div>
      <div>{props.summary}</div>
      {props.extra}
      {count > 0 && open ? (
        <>
          <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 5 }}>
            {props.details?.map((d) => (
              <div key={d.key}>
                <div style={{ fontWeight: 600 }}>{d.primary}</div>
                {d.secondary ? <div style={{ color: "var(--dsw-alias-label-secondary)" }}>{d.secondary}</div> : null}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2 }}>
            <button type="button" className="fm-op-detail" onClick={() => setOpen(false)} style={detailButtonStyle}>
              收起明细
              <IconChevronUpOutline14 size={14} />
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function OrganizePanel(props: {
  onClose: () => void;
  /** ① 一键更新全部对话。 */
  onUpdateAll: () => void;
  updating: boolean;
  updateProgress?: { done: number; total: number } | null;
  updateSummary?: OrganizerRunSummary | null;
  updateDetails?: Array<{ sessionId: string; title?: string; brief?: string }>;
  updateError?: string | null;
  /** ② 一键整理分组。 */
  onOrganizeGroups: () => void;
  organizing: boolean;
  organizeSummary?: { created: number; moved: number; renamed: number; deleted: number; updated: number } | null;
  organizeDetails?: Array<{ key: string; primary: string; secondary?: string }>;
  organizeError?: string | null;
  onUndoOrganize?: () => void;
  canUndoOrganize?: boolean;
  /** 用量。 */
  agent?: OrganizerAgentInfo | null;
  usage?: OrganizerUsage | null;
  changedCount?: number | null;
  loadingInfo?: boolean;
}) {
  const agent = props.agent;
  const usage = props.usage;
  // 上下文以"会话日志里的最近一次提示词规模"为准（跨重启有效）；日志还没内容时退回内存值。
  const contextTokens = usage?.contextTokens ?? agent?.contextTokens ?? 0;
  const budget = agent?.contextBudgetTokens ?? 0;
  const pct = budget > 0 ? Math.min(100, Math.round((contextTokens / budget) * 100)) : 0;
  const input = usage?.inputTokens ?? agent?.totalInputTokens ?? 0;
  const cache = usage?.cacheReadTokens ?? agent?.totalCacheReadTokens ?? 0;
  const output = usage?.outputTokens ?? agent?.totalOutputTokens ?? 0;
  const requests = usage?.requests ?? agent?.requests ?? 0;
  const busy = props.updating || props.organizing;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <style>{PANEL_CSS}</style>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--dsw-alias-border-l1)" }}>
        <TopHatIcon size={16} />
        <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>区管家</span>
        <Button size="sm" variant="ghost" icon={<IconCloseOutline16 size={16} />} style={{ width: 28, height: 28, padding: 0 }} title="关闭区管家" aria-label="关闭区管家" onClick={props.onClose} />
      </div>

      <div className="fm-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 10px 12px" }}>
        {/* 我是什么 */}
        <Head>这是什么</Head>
        <div style={{ fontSize: 12, lineHeight: 1.75, color: "var(--dsw-alias-label-secondary)" }}>
          我是一个<b>不显示对话框</b>的独立 agent，只跑下面两条固定命令。
          <br />· <b>一键更新全部对话</b>：读会话 → 写简介 → 写<b>「主题：进度」</b>标题；没聊过的不重复处理。
          <br />· <b>一键整理分组</b>：按项目名归类并应用，整理前自动留可撤销快照。
          <br />
          <span style={{ color: "var(--dsw-alias-label-tertiary)" }}>两条命令都要消耗 token，约 1–2 分钱/条。</span>
        </div>

        {/* 两条命令 */}
        <Head>命令</Head>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Button
            type="button"
            size="sm"
            variant="primary"
            data-myagent-update-all
            disabled={busy}
            icon={
              props.updating ? (
                <IconLoadingOutline16 size={16} className="fm-op-spin" />
              ) : (
                <IconRefreshOutline16 size={16} />
              )
            }
            onClick={props.onUpdateAll}
          >
            {props.updating ? "更新中…" : "一键更新全部对话"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-myagent-organize-groups
            disabled={busy}
            icon={
              props.organizing ? (
                <IconLoadingOutline16 size={16} className="fm-op-spin" />
              ) : (
                <IconCheckOutline16 size={16} />
              )
            }
            onClick={props.onOrganizeGroups}
          >
            {props.organizing ? "整理中…" : "一键整理分组"}
          </Button>
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--dsw-alias-label-secondary)" }}>
          {props.loadingInfo
            ? "统计中…"
            : props.changedCount === null || props.changedCount === undefined
              ? ""
              : props.changedCount === 0
                ? "当前没有新对话需要更新。"
                : `当前有 ${props.changedCount} 条会话有新对话。`}
          {props.updateProgress ? ` 进度 ${props.updateProgress.done} / ${props.updateProgress.total}` : ""}
        </div>

        {/* 结果 */}
        {props.updateError ? (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--dsw-alias-state-error-primary)" }}>{props.updateError}</div>
        ) : null}
        {props.updateSummary ? (
          <ResultBlock
            title="上次「更新全部对话」"
            summary={
              <>
                检查 {props.updateSummary.checked} · 更新 {props.updateSummary.updated} · 未变{" "}
                {props.updateSummary.unchanged} · 跳过 {props.updateSummary.skipped}
                <br />
                模型 {props.updateSummary.agent} 条 / 本地兜底 {props.updateSummary.local} 条 · 耗时{" "}
                {(props.updateSummary.elapsedMs / 1000).toFixed(1)}s
              </>
            }
            details={(props.updateDetails ?? []).map((d) => ({ key: d.sessionId, primary: d.title || "(无标题)", secondary: d.brief }))}
          />
        ) : null}
        {props.organizeError ? (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--dsw-alias-state-error-primary)" }}>{props.organizeError}</div>
        ) : null}
        {props.organizeSummary ? (
          <ResultBlock
            title="上次「整理分组」"
            summary={
              <>
                新建 {props.organizeSummary.created} 组 · 移动 {props.organizeSummary.moved} 条 · 重命名{" "}
                {props.organizeSummary.renamed} · 删除 {props.organizeSummary.deleted} · 改标注{" "}
                {props.organizeSummary.updated}
              </>
            }
            details={props.organizeDetails}
            extra={
              props.canUndoOrganize && props.onUndoOrganize ? (
                <div style={{ marginTop: 4 }}>
                  <Button size="sm" variant="ghost" onClick={props.onUndoOrganize}>
                    撤销这次整理
                  </Button>
                </div>
              ) : null
            }
          />
        ) : null}

        {/* 用量 */}
        <Head>消耗用量</Head>
        <div data-myagent-usage>
          <Row label="上下文已用" value={`${n(contextTokens)} tokens${budget > 0 ? `（预算 ${n(budget)}，${pct}%）` : ""}`} />
          <Row label="会话累计" value={`输入 ${n(input)} · 缓存命中 ${n(cache)} · 输出 ${n(output)}`} />
          <Row label="模型" value={agent ? `${agent.provider || "-"} / ${agent.model || "-"}` : "解析中…"} />
          <Row label="请求次数" value={`${n(requests)} 次${agent ? `（本次启动 ${n(agent.requests)} 次 · 上下文轮换 ${n(agent.rotations)} 次）` : ""}`} />
          <Row label="上次运行" value={agent?.lastRequestAt ? new Date(agent.lastRequestAt).toLocaleString() : "尚未运行"} />
          <Row label="管家会话" value={agent?.sessionId ?? "-"} />
          {/* 分区建议走**另一个** agent（planner，开了推理）—— 单列一行，否则看不出它真在思考。 */}
          {agent?.planner ? (
            <Row
              label="分区建议"
              value={`${agent.planner.ready ? "已就绪" : "未启动"} · 推理档 ${
                agent.planner.reasoningEffort ?? "跟随模型默认"
              } · 上下文 ${n(agent.planner.contextTokens)} ／ 预算 ${n(agent.planner.contextBudgetTokens)} · 推理 token ${n(
                agent.planner.totalReasoningTokens,
              )}`}
            />
          ) : null}
          <Row label="会话日志" value={usage?.sessionBytes != null ? `${n(usage.sessionBytes)} 字节` : "-"} />
          {agent && !agent.ready ? (
            <div style={{ marginTop: 4, fontSize: 12, color: "var(--dsw-alias-state-error-primary)" }}>
              管家 agent 尚未就绪：请检查 settings.yaml 的 agent-default-model（provider / model）。
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

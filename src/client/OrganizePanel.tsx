// src/client/OrganizePanel.tsx — 沙盒管家的差异交互框。
// 设计文档要求：点击“沙盒管家”后隐藏工作沙盒具体内容，展示“与上一版的改动”；
// 支持逐条勾选、全选/全不选，应用勾选项后执行整理。
import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  IconCheckOutline16,
  IconCloseOutline16,
  IconLoadingOutline16,
  IconRefreshOutline16,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { OrganizeAction, OrganizeDiffItem } from "./organizer.ts";
import { TopHatIcon } from "./TopHatIcon.tsx";

export function OrganizePanel(props: {
  loading: boolean;
  applying?: boolean;
  error?: string | null;
  items: OrganizeDiffItem[];
  onApply: (actions: OrganizeAction[]) => void;
  onClose: () => void;
  onRetry?: () => void;
  onResummarizeAll?: () => void;
  resummarizingAll?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(props.items.map((i) => i.id)));

  useEffect(() => {
    setSelected(new Set(props.items.map((i) => i.id)));
  }, [props.items]);

  const allSelected = props.items.length > 0 && selected.size === props.items.length;
  const anySelected = selected.size > 0;

  const selectedActions = useMemo(
    () => props.items.filter((i) => selected.has(i.id)).map((i) => i.action),
    [props.items, selected],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(props.items.map((i) => i.id)));
  };

  if (props.loading || props.applying) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, height: "100%", color: "var(--dsw-alias-label-secondary)", fontSize: 13 }}>
        <IconLoadingOutline16 size={20} />
        <span>{props.applying ? "正在应用并刷新…" : "沙盒管家整理中…"}</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--dsw-alias-border-l1)" }}>
        <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>沙盒管家</span>
        {props.onRetry && !props.loading && !props.applying && !props.error && props.items.length > 0 ? (
          <Button size="sm" variant="ghost" icon={<IconRefreshOutline16 size={16} />} style={{ width: 28, height: 28, padding: 0 }} title="重新整理" aria-label="重新整理" onClick={props.onRetry} />
        ) : null}
        {props.onResummarizeAll ? (
          <Button type="button" size="sm" variant="ghost" icon={<IconRefreshOutline16 size={16} />} style={{ width: 28, height: 28, padding: 0 }} disabled={props.resummarizingAll} title="重新总结所有对话记录" aria-label="重新总结所有对话记录" onClick={props.onResummarizeAll} />
        ) : null}
        <Button size="sm" variant="ghost" icon={<IconCloseOutline16 size={16} />} style={{ width: 28, height: 28, padding: 0 }} title="关闭整理" aria-label="关闭整理" onClick={props.onClose} />
      </div>

      {props.error ? (
        <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--dsw-alias-state-error-primary)", display: "flex", flexDirection: "column", gap: 8 }}>
          <span>{props.error}</span>
          {props.onRetry ? <Button size="sm" variant="outline" onClick={props.onRetry}>重试</Button> : null}
        </div>
      ) : null}

      {!props.error && props.items.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "24px 20px", textAlign: "center", color: "var(--dsw-alias-label-secondary)", fontSize: 13 }}>
          <TopHatIcon size={32} />
          <div style={{ fontWeight: 600, fontSize: 15, color: "var(--dsw-alias-label-primary)" }}>沙盒管家</div>
          <div style={{ maxWidth: 440, lineHeight: 1.7 }}>
            原理：由独立 agent 维护沙盒上下文，只读取未归档、未删除对话的标题与简介，先按项目名分组，再在项目内用“主题+阶段”命名。勾选建议后即可应用。
          </div>
          <div style={{ opacity: 0.85 }}>
            当前没有需要整理的改动，说明你的沙盒已经比较整齐。
          </div>
          {props.onRetry ? (
            <Button size="sm" variant="outline" icon={<IconRefreshOutline16 size={16} />} onClick={props.onRetry}>重新整理</Button>
          ) : null}
        </div>
      ) : null}

      {!props.error && props.items.length > 0 ? (
        <>
          <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid var(--dsw-alias-border-l2)" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              {allSelected ? "全不选" : "全选"}
            </label>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "var(--dsw-alias-label-secondary)" }}>已选 {selected.size} / {props.items.length}</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 0" }}>
            {props.items.map((item) => (
              <label
                key={item.id}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontSize: 13,
                  borderRadius: 6,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggle(item.id)}
                  style={{ marginTop: 2 }}
                />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", color: "var(--dsw-alias-label-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
                  <span style={{ display: "block", color: "var(--dsw-alias-label-secondary)", fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>{item.description}</span>
                </span>
              </label>
            ))}
          </div>
          <div style={{ flex: "none", display: "flex", justifyContent: "flex-end", gap: 8, padding: "8px 10px", borderTop: "1px solid var(--dsw-alias-border-l1)" }}>
            <Button size="sm" variant="ghost" onClick={props.onClose}>取消</Button>
            <Button size="sm" variant="primary" icon={<IconCheckOutline16 size={16} />} disabled={!anySelected || props.applying} onClick={() => props.onApply(selectedActions)}>
              应用勾选项
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

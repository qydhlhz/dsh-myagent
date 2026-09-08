// src/client/ContextMenu.tsx — 悬浮右键菜单 + 输入/确认对话框（primitives 原生样式）。
//
// 组件选型理由（相比自绘方案）：
//  - primitives 的 Menu 支持 portal + getAnchorRect 模式：列表 fixed 定位到 document.body，
//    z-index 1100（宿主编译 CSS 实测），点击外部/Esc 关闭、视口边缘 12px clamp 兜底都是
//    内置行为——与 DSH 其它菜单（如 ui-workspace 的行菜单）完全一致，故不采用自绘。
//  - 删除二次确认（点删除 → 该项变红色"确认删除？"态 → 再点执行）由本组件持有 armed 状态、
//    动态替换 Menu items 实现（Menu 在 open 期间 items 可变，重渲染不关闭列表）。
//  - 输入/确认一律用 primitives Modal + Input + Button：Modal 是 portal 到 body 的模态层
//    （宿主 z-index 1000，DOM 顺序在抽屉之后，天然盖在抽屉之上），Escape/遮罩点击关闭内置。
//  - primitives 组件在宿主模块表（PLATFORM_MODULES）中提供的是带真实 CSS 的副本，
//    故本文件只 import 组件本身，由 esbuild external 解析（见 scripts/build-client.mjs）。
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Menu, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import type { MenuEntry } from "@deepseek-ai/dsh-client-ui-primitives";

/** 菜单项：普通项或分隔线。confirmLabel 提供二次确认（首次点击变危险态，再次点击才触发）。 */
export interface ContextMenuItem {
  key: string;
  /** separator 项省略 label/onSelect。 */
  label?: string;
  separator?: boolean;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** 二次确认文案：点过一次后该项显示为 confirmLabel 的危险态，再点才执行 onSelect。 */
  confirmLabel?: string;
  /** 选中后不关闭菜单（复制类瞬时反馈项用；项文案由调用方自行切换）。 */
  keepOpen?: boolean;
  onSelect?: () => void;
}

/**
 * 通用悬浮右键菜单。props: x/y（视口坐标）、items、onClose。
 * 内部用 primitives Menu（portal + getAnchorRect），并按估算尺寸做视口边缘翻转
 * （side bottom→top、align start→end）；Menu 自身的 12px clamp 作最终兜底。
 * 菜单 fixed 定位不随内容滚动：监听 window scroll（capture）→ onClose，滚动即收起。
 */
export function ContextMenu({ x, y, items, onClose }: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // 重新定位（换条目或换位置）时重置二次确认态。
  useEffect(() => {
    setArmedKey(null);
  }, [x, y]);

  useCloseOnScroll(onClose);

  const entries = useMemo<MenuEntry[]>(
    () =>
      items.map((it) => {
        if (it.separator) return { type: "separator" as const, id: it.key };
        const armed = armedKey === it.key;
        return {
          id: it.key,
          label: armed ? (it.confirmLabel ?? `${it.label}？`) : it.label!,
          icon: it.icon,
          disabled: it.disabled,
          danger: it.danger || armed,
        };
      }),
    [items, armedKey],
  );

  const getAnchorRect = useCallback(() => {
    // Menu portal 模式用 anchor rect 定位：Menu 内部读取 left/right/top/bottom，
    // width/height 取 0 时 right=left=x、bottom=top=y，菜单从 (x, y) 展开。
    // 注：side="top" 时 Menu 用 r.top - lh - 4 计算，r.top = y 即"菜单底边贴近 y"，
    // 与 side="bottom"（r.bottom + 4）对称，翻转后都停在光标附近。
    const rect = { left: x, top: y, right: x, bottom: y, width: 0, height: 0, x, y, toJSON: () => ({}) };
    return rect as unknown as DOMRect;
  }, [x, y]);

  // 视口边缘翻转：按估算尺寸预判溢出（primitives 菜单 min-width 218px、行高约 32px）。
  const vw = typeof window === "undefined" ? 0 : window.innerWidth;
  const vh = typeof window === "undefined" ? 0 : window.innerHeight;
  const estW = 218;
  const estH = items.filter((it) => !it.separator).length * 32 + 24;
  const align = x + estW > vw - 12 ? "end" : "start";
  const side = y + estH > vh - 12 ? "top" : "bottom";

  const handleSelect = (id: string) => {
    const it = itemsRef.current.find((i) => i.key === id);
    if (!it || it.separator) return;
    if (it.confirmLabel && armedKey !== id) {
      setArmedKey(id);
      return; // 二次确认第一步：不关闭菜单，该项变红等再次点击。
    }
    if (!it.keepOpen) onClose();
    it.onSelect?.();
  };

  return (
    <Menu
      open
      anchor={null}
      items={entries}
      onSelect={handleSelect}
      onClose={onClose}
      side={side}
      align={align}
      portal
      getAnchorRect={getAnchorRect}
    />
  );
}

/**
 * 菜单打开期间监听 window scroll（capture: true，捕获阶段能收到任意滚动容器的 scroll）→
 * 调 onClose。菜单（含 portal 版）fixed 定位不随内容滚动，滚动后继续显示会错位；
 * 卸载时移除监听（组件卸载即菜单关闭，无需单独清理状态）。
 */
export function useCloseOnScroll(onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onScroll = () => onCloseRef.current();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, []);
}

/** 输入对话框：Modal + Input + 取消/确定（Enter 提交；validate 出错时禁用确认并显示错误文案）。
 *  可选在下方用小号灰色字体展示当前“一句话简介”（只读，不在重命名弹窗中编辑）。 */
export function PromptModal({ open, title, description, initialValue, placeholder, confirmLabel = "确定", validate, brief, onSubmit, onClose, onResummarizeTitle, onResummarizeBrief, resummarizingTitle, resummarizingBrief }: {
  open: boolean;
  title: string;
  description?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** 输入校验（如 validateNameInput）：返回非 null 错误文案时显示在输入框下方并禁用确认按钮。 */
  validate?: (value: string) => string | null;
  /** 只读展示的一句话简介；不传则不显示。 */
  brief?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
  /** 重新总结对话内容命名 / 简介（仅会话重命名弹窗使用）。 */
  onResummarizeTitle?: () => void;
  onResummarizeBrief?: () => void;
  resummarizingTitle?: boolean;
  resummarizingBrief?: boolean;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  useEffect(() => {
    if (open) setValue(initialValue ?? "");
  }, [open, initialValue]);

  // 校验按 trim 后的值（与提交一致）；无 validate prop 时退化为仅空值禁用。
  const trimmed = value.trim();
  const error = validate ? validate(trimmed) : null;
  const canSubmit = trimmed !== "" && error === null;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      className="fm-prompt-modal-wide"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <style>{`.fm-prompt-modal-wide{width:min(560px,calc(100vw - 32px))!important}`}</style>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <Input
            value={value}
            placeholder={placeholder}
            autoFocus
            style={{ width: "100%", boxSizing: "border-box" }}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          {error ? (
            <div style={{ color: "var(--dsw-alias-state-error-primary)", fontSize: 12, marginTop: 6 }}>{error}</div>
          ) : null}
        </div>
        {onResummarizeTitle || onResummarizeBrief ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {onResummarizeTitle ? (
              <Button type="button" size="sm" variant="outline" disabled={resummarizingTitle} onClick={onResummarizeTitle}>
                {resummarizingTitle ? "总结中…" : "重新总结命名"}
              </Button>
            ) : null}
            {onResummarizeBrief ? (
              <Button type="button" size="sm" variant="outline" disabled={resummarizingBrief} onClick={onResummarizeBrief}>
                {resummarizingBrief ? "总结中…" : "重新总结简介"}
              </Button>
            ) : null}
          </div>
        ) : null}
        {brief !== undefined ? (
          <div style={{ fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.5, wordBreak: "break-word" }}>
            {brief || "暂无简介"}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/** 确认对话框：Modal + 描述 + 取消/危险确认。 */
export function ConfirmModal({ open, title, description, confirmLabel = "确认", onConfirm, onClose }: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            variant="outline"
            onClick={onConfirm}
            style={{ color: "var(--dsw-alias-state-error-primary)", borderColor: "var(--dsw-alias-state-error-primary)" }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

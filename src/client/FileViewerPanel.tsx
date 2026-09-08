// src/client/FileViewerPanel.tsx — 文件查看/编辑器（Round 2：覆盖式抽屉 → details 列并行分割）。
// 本版加入 CodeMirror 6 代码编辑器：打开代码文件自动启用彩色编辑/行号，并提供“运行”按钮。
// 保留：三态渲染（text/image/binary）+ 截断警示 + 可编辑文本保存（Ctrl/Cmd+S）+
// 保存冲突（CAS 409）草稿保留 + 下载 + 重试（dirty 时 Modal 确认）。
// 状态机：loaded（读取结果）/ error（加载或保存失败）/ draft（可编辑文本草稿）/
// saving（保存中）/ running（运行中）/ runResult（运行输出）。
// CodeMirror 6 与语言包全部打进 client bundle；react/react-dom 仍 external。
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, IconCloseOutline16, IconCodeOutline16, IconDataOutline16, IconDownloadOutline16, IconLoadingOutline16, IconPlayOutline16, IconWarningOutline16 } from "@deepseek-ai/dsh-client-ui-primitives";
import { basicSetup, EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { StreamLanguage } from "@codemirror/language";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { sql } from "@codemirror/lang-sql";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { go } from "@codemirror/lang-go";
import { rust } from "@codemirror/lang-rust";
import { r } from "@codemirror/legacy-modes/mode/r";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import type { Api, ReadResult, RunResult } from "./api.ts";
import { describeApiError } from "./api.ts";
import { ConfirmModal } from "./ContextMenu.tsx";
import { CsvTable } from "./CsvTable.tsx";

// CodeMirror 在 details 列里需要明确高度；焦点时不显示默认蓝框，避免与 DSH 主题冲突。
const CM_CSS = `
.cm-editor { height: 100%; font-size: 13px; }
.cm-editor.cm-focused { outline: none; }
.cm-scroller { font-family: monospace; }
`;

// 右侧查看器宽度拖拽把手：位于面板左边缘，可自由加宽（比宿主默认 360/520 更大）。
const PANEL_RESIZE_CSS = `
.fm-viewer-resize {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 10px;
  cursor: col-resize;
  z-index: 1000;
  touch-action: none;
  user-select: none;
}
.fm-viewer-resize::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 36px;
  border-radius: 2px;
  background: var(--dsw-alias-border-l2);
  opacity: 0.35;
  transition: opacity 0.15s ease, background 0.15s ease;
}
.fm-viewer-resize:hover::after,
.fm-viewer-resize.fm-viewer-resize-active::after {
  opacity: 1;
  background: var(--dsw-alias-label-secondary);
}
/* 查看器打开时，隐藏宿主自带的 details 拖拽把手，统一使用上面自定义把手，
   避免宿主把手把宽度钳制回 360-520px 导致“拖不动/加不宽”。 */
.pI_x6G_handle[data-side="details"] {
  display: none !important;
}
`;

/** 根据文件扩展名返回 CodeMirror 语言扩展；不支持时返回 null（纯文本编辑）。 */
function codeMirrorExtension(path: string) {
  const name = path.split("/").pop() ?? path;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  switch (ext) {
    case "py":
      return python();
    case "r":
      return StreamLanguage.define(r);
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript({ jsx: true });
    case "ts":
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "json":
      return json();
    case "md":
    case "markdown":
      return markdown();
    case "yaml":
    case "yml":
      return yaml();
    case "sql":
      return sql();
    case "html":
    case "htm":
      return html();
    case "css":
      return css();
    case "c":
    case "h":
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
      return cpp();
    case "java":
      return java();
    case "go":
      return go();
    case "rs":
      return rust();
    case "sh":
    case "bash":
      return StreamLanguage.define(shell);
    default:
      return null;
  }
}

/** 当前 v1 可运行的文件类型（与宿主 resolveRunPlan 保持一致）。 */
function isRunnable(path: string): boolean {
  return /\.(py|r|js|mjs|cjs|sh)$/i.test(path);
}

/** 从查看器向上找到宿主三栏 grid 容器（用于加宽右侧 details 列）。 */
function findDetailsGrid(el: HTMLElement | null): HTMLElement | null {
  let cur = el?.parentElement ?? null;
  while (cur) {
    if (getComputedStyle(cur).display === "grid") return cur;
    cur = cur.parentElement;
  }
  return null;
}

/** CSV / TSV 以表格形式展示。 */
function isTabular(path: string): boolean {
  return /\.(csv|tsv)$/i.test(path);
}

function delimiterFor(path: string): string {
  return /\.tsv$/i.test(path) ? "	" : ",";
}

/**
 * 文件查看/编辑面板：渲染在 details 槽内（details 列由宿主布局控制宽度）。
 * onClose 由 DetailsComposite 接上 closeViewer + ctx.layout.closeDetails()。
 */
export function FileViewerPanel({ api, path, onClose }: { api: Api; path: string; onClose: () => void }) {
  const [loaded, setLoaded] = useState<ReadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [outputRatio, setOutputRatio] = useState(0.3);
  const [tableMode, setTableMode] = useState(() => isTabular(path));
  const viewerRootRef = useRef<HTMLDivElement>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const draftRef = useRef<string | null>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const reloadSeqRef = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++reloadSeqRef.current;
    setError(null);
    setLoaded(null);
    setDraft(null);
    const res = await api.read(path);
    if (seq !== reloadSeqRef.current) return;
    if (res.ok) {
      setLoaded(res.data);
      if (res.data.kind === "text") setDraft(res.data.content ?? "");
    } else {
      setError(describeApiError(res));
    }
  }, [api, path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (): Promise<boolean> => {
    if (saving || !loaded || draft === null) return false;
    setSaving(true);
    const res = await api.write(path, draft, loaded?.version);
    setSaving(false);
    if (res.ok) {
      setLoaded({ ...loaded, content: draft, version: res.data?.version ?? loaded.version });
      setError(null);
      return true;
    } else {
      setError(describeApiError(res));
      return false;
    }
  }, [api, path, loaded, draft, saving]);

  // 保持 saveRef 永远指向最新 save（CodeMirror 的 Ctrl+S 回调用）。
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // 保持 draftRef 永远指向最新草稿（编辑器创建/同步用）。
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const downloadHref = `/api/myagent/read?raw=1&root=${encodeURIComponent(api.root)}&path=${encodeURIComponent(path)}`;
  const dirty = draft !== null && loaded?.content !== draft;
  const canRun = isRunnable(path) && loaded?.kind === "text" && draft !== null;
  const showOutput = canRun && (running || runResult !== null || runError !== null);


  const run = useCallback(async () => {
    if (running || !loaded || draft === null) return;
    if (dirty) {
      const ok = await saveRef.current();
      if (!ok) return;
    }
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    const res = await api.run(path);
    setRunning(false);
    if (res.ok) setRunResult(res.data);
    else setRunError(describeApiError(res));
  }, [api, path, loaded, draft, running, dirty]);

  const startOutputResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitRef.current;
    const containerHeight = container?.getBoundingClientRect().height || window.innerHeight;
    if (containerHeight <= 0) return;
    const startY = e.clientY;
    const startRatio = outputRatio;
    // 用比例而不是固定像素：输出区占右侧面板 10% ~ 70%，不会拖出可视区。
    const onMove = (ev: MouseEvent) => {
      // 按用户习惯：鼠标上滑 → 输出区变高（分割线下移）；下滑 → 输出区变矮（分割线上移）。
      const delta = (startY - ev.clientY) / containerHeight;
      const next = Math.min(Math.max(0.1, startRatio + delta), 0.7);
      setOutputRatio(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [outputRatio]);

  // 拖拽右侧查看器左边缘，可自由加宽 details 列（超过宿主默认 360/520 的限制）。
  const startPanelResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const grid = findDetailsGrid(viewerRootRef.current);
    if (!grid) return;
    const frameWidth = grid.getBoundingClientRect().width;
    const cols = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/);
    const sidebar = parseFloat(cols[0] ?? "") || 280;
    const startDetails = parseFloat(cols[2] ?? "") || Math.round(frameWidth * 0.45);
    const startX = e.clientX;
    const handle = e.currentTarget;
    handle.classList.add("fm-viewer-resize-active");
    const onMove = (ev: PointerEvent) => {
      const delta = startX - ev.clientX;
      const maxDetails = Math.max(360, frameWidth - sidebar - 360);
      const next = Math.min(Math.max(360, startDetails + delta), maxDetails);
      const center = Math.max(360, frameWidth - sidebar - next);
      grid.style.gridTemplateColumns = `${sidebar}px ${center}px ${next}px`;
      grid.removeAttribute("data-details-collapsed");
    };
    const onUp = () => {
      handle.classList.remove("fm-viewer-resize-active");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  // 创建 CodeMirror 编辑器（每个文件/文本类型挂载一次；草稿变化通过下方同步 effect 更新）。
  useEffect(() => {
    if (loaded?.kind !== "text" || draft === null || !editorHostRef.current) return;
    const editable = !!loaded.editable;
    const lang = codeMirrorExtension(path);
    const view = new EditorView({
      state: EditorState.create({
        doc: draftRef.current ?? "",
        extensions: [
          basicSetup,
          oneDark,
          EditorView.editable.of(editable),
          EditorState.readOnly.of(!editable),
          ...(lang ? [lang] : []),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const next = update.state.doc.toString();
            draftRef.current = next;
            if (editable) setDraft(next);
          }),
          EditorView.domEventHandlers({
            keydown: (event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "s") {
                event.preventDefault();
                if (editable) void saveRef.current();
              }
            },
          }),
        ],
      }),
      parent: editorHostRef.current,
    });
    editorViewRef.current = view;
    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
    // 只在 path / 文本类型 / 可编辑性变化时重建；草稿变化由下方 effect 同步，避免输入丢焦点。
  }, [path, loaded?.kind, loaded?.editable, tableMode]);

  // 外部草稿变化（reload/保存成功）时同步 CodeMirror 文档；内部输入时 current === draft 不动作。
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || draft === null) return;
    const current = view.state.doc.toString();
    if (current !== draft) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: draft } });
    }
  }, [draft]);
  const retry = () => {
    // 409 后重试会重新加载并丢弃草稿：dirty 时先确认，避免误丢未保存修改。
    if (dirty) setConfirmDiscard(true);
    else void reload();
  };

  return (
    <div
      ref={viewerRootRef}
      style={{
        // 流内填满 details 列：高度 100%，内部 flex 列布局；列宽由宿主布局拖拽把手控制。
        // 左边界线对齐原生 DetailsPanel（.ydkMvW_root 的 border-left），拖拽把手在槽外。
        width: "100%",
        height: "100%",
        minWidth: 0,
        background: "var(--dsw-alias-bg-layer-1)",
        borderLeft: "1px solid var(--dsw-alias-border-l2)",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      <style>{CM_CSS}</style>
      <style>{PANEL_RESIZE_CSS}</style>
      <div
        className="fm-viewer-resize"
        onPointerDown={startPanelResize}
        title="拖拽加宽/收窄查看器"
        aria-label="拖拽调整查看器宽度"
      />
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: "6px 10px",
            borderBottom: "1px solid var(--dsw-alias-border-l1)",
            flex: "none",
            minHeight: 42,
          }}
        >
          <span
            style={{
              flex: "none",
              width: 28,
              height: 28,
              borderRadius: 6,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--dsw-alias-interactive-bg-hover)",
              color: "var(--dsw-alias-label-secondary)",
            }}
          >
            {loaded?.kind === "text" ? <IconCodeOutline16 size={16} /> : <IconDataOutline16 size={16} />}
          </span>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <span
              title={path}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--dsw-alias-label-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {path.split("/").pop() || path}
              {dirty ? <span style={{ color: "var(--dsw-alias-state-warn-primary)", marginLeft: 4, fontWeight: 400 }}>● 未保存</span> : null}
            </span>
            <span
              title={path}
              style={{
                fontSize: 11,
                color: "var(--dsw-alias-label-tertiary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {path}
            </span>
          </span>
          <span style={{ display: "flex", gap: 4, flex: "none", alignItems: "center" }}>
            {loaded?.editable && draft !== null ? (
              <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()} style={{ whiteSpace: "nowrap" }}>
                {saving ? "保存中…" : "保存"}
              </Button>
            ) : null}
            {isTabular(path) && loaded?.kind === "text" && draft !== null ? (
              <Button size="sm" variant="ghost" onClick={() => setTableMode((v) => !v)} style={{ whiteSpace: "nowrap" }}>
                {tableMode ? "文本" : "表格"}
              </Button>
            ) : null}
            {canRun ? (
              <Button size="sm" variant="primary" icon={<IconPlayOutline16 size={16} />} disabled={running || saving} onClick={() => void run()} style={{ whiteSpace: "nowrap" }}>
                {running ? "运行中…" : "运行"}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              icon={<IconDownloadOutline16 size={16} />}
              style={{ width: 28, height: 28, padding: 0 }}
              title="下载"
              aria-label="下载"
              onClick={() => {
                window.location.href = downloadHref;
              }}
            />
            <Button size="sm" variant="ghost" icon={<IconCloseOutline16 size={16} />} style={{ width: 28, height: 28, padding: 0 }} title="关闭" aria-label="关闭" onClick={onClose} />
          </span>
        </div>
      <div ref={splitRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="fm-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
          {error ? (
            <div style={{ height: "100%", minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", maxWidth: 360 }}>
                <IconWarningOutline16 size={28} />
                <div style={{ color: "var(--dsw-alias-state-error-primary)", fontSize: 13, lineHeight: 1.5 }}>{error}</div>
                <Button size="sm" variant="outline" onClick={retry}>重试</Button>
              </div>
            </div>
          ) : null}
          {!loaded && !error ? (
            <div style={{ height: "100%", minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dsw-alias-label-secondary)", fontSize: 13, gap: 8 }}>
              <IconLoadingOutline16 size={18} />
              <span>加载中…</span>
            </div>
          ) : null}
          {loaded?.truncated ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "var(--dsw-alias-state-warn-secondary)", color: "var(--dsw-alias-state-warn-label)", fontSize: 12 }}>
              <IconWarningOutline16 size={14} />
              <span style={{ flex: 1, minWidth: 0 }}>
                {loaded.kind === "text" ? "文件较大，仅显示前 512KB。" : "文件过大，仅提供下载。"}
              </span>
              <a style={{ color: "var(--dsw-alias-state-warn-label)", flex: "none" }} href={downloadHref}>下载完整文件</a>
            </div>
          ) : null}
          {loaded?.kind === "image" && loaded.content ? (
            <div style={{ width: "100%", height: "100%", minHeight: 0, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "var(--dsw-alias-bg-base)" }}>
              <img alt={path} src={`data:${loaded.mime};base64,${loaded.content}`} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 6 }} />
            </div>
          ) : null}
        {loaded?.kind === "pdf" ? (
          <div className="fm-scroll" style={{ width: "100%", height: "100%", background: "var(--dsw-alias-bg-base)", overflow: "auto" }}>
            <iframe
              title={path}
              src={api.inlineHref(path)}
              style={{ width: "100%", height: "100%", border: 0, background: "var(--dsw-alias-bg-base)" }}
            />
          </div>
        ) : null}
        {loaded?.kind === "audio" ? (
          <div
            className="fm-scroll"
            style={{
              width: "100%",
              height: "100%",
              boxSizing: "border-box",
              background: "var(--dsw-alias-bg-base)",
              overflow: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <audio controls src={api.inlineHref(path)} style={{ width: "100%", maxWidth: 560 }} />
          </div>
        ) : null}
        {loaded?.kind === "video" ? (
          <div
            className="fm-scroll"
            style={{
              width: "100%",
              height: "100%",
              boxSizing: "border-box",
              background: "var(--dsw-alias-bg-base)",
              overflow: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <video controls src={api.inlineHref(path)} style={{ maxWidth: "100%", maxHeight: "100%" }} />
          </div>
        ) : null}
        {loaded?.kind === "binary" ? (
          <div style={{ height: "100%", minHeight: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center", color: "var(--dsw-alias-label-secondary)" }}>
            <IconDataOutline16 size={32} />
            <span>二进制文件，无法预览</span>
            <Button size="sm" variant="outline" icon={<IconDownloadOutline16 size={16} />} onClick={() => { window.location.href = downloadHref; }}>下载文件</Button>
          </div>
        ) : null}
        {loaded?.kind === "text" && draft !== null ? (
          isTabular(path) && tableMode ? (
            <CsvTable content={draft} delimiter={delimiterFor(path)} />
          ) : (
            <div
              ref={editorHostRef}
              style={{ width: "100%", height: "100%", overflow: "hidden", background: "var(--dsw-alias-bg-base)" }}
            />
          )
        ) : null}
      </div>

      {showOutput ? (
        <>
          <div
              onMouseDown={startOutputResize}
              style={{
                flex: "none",
                height: 10,
                cursor: "row-resize",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--dsw-alias-label-secondary)",
                fontSize: 10,
                lineHeight: 1,
                userSelect: "none",
                background: "var(--dsw-alias-border-l1)",
                borderTop: "1px solid var(--dsw-alias-border-l2)",
              }}
              title="拖动调整输出区高度"
            >
              ⋯
            </div>
          <div
            style={{
              flex: `0 0 ${outputRatio * 100}%`,
              minHeight: 80,
              maxHeight: "70%",
              overflow: "auto",
              background: "var(--dsw-alias-bg-base)",
              fontFamily: "monospace",
              fontSize: 12,
              padding: "6px 10px",
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
              <strong style={{ flex: 1, color: "var(--dsw-alias-label-primary)" }}>运行输出</strong>
              {!running && (runResult || runError) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRunResult(null);
                    setRunError(null);
                  }}
                >
                  清除
                </Button>
              ) : null}
            </div>
            {running ? (
              <div style={{ color: "var(--dsw-alias-label-secondary)" }}>正在运行…</div>
            ) : null}
            {runError ? (
              <div style={{ color: "var(--dsw-alias-state-error-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {runError}
              </div>
            ) : null}
            {runResult ? (
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: "var(--dsw-alias-label-primary)",
                }}
              >
                {runResult.stdout}
                {runResult.stderr ? `
--- stderr ---
${runResult.stderr}` : ""}
                {`
--- 退出码: ${runResult.exitCode ?? "无"}${runResult.timedOut ? "（超时）" : ""} ---`}
              </pre>
            ) : null}
          </div>
        </>
      ) : null}

      </div>
      {/* 放弃未保存修改确认（Modal 替代原 window.confirm）。 */}
      <ConfirmModal
        open={confirmDiscard}
        title="放弃未保存的修改？"
        description="重试将重新加载文件，当前未保存的修改不会保留。"
        confirmLabel="放弃并重试"
        onConfirm={() => {
          setConfirmDiscard(false);
          void reload();
        }}
        onClose={() => setConfirmDiscard(false)}
      />
    </div>
  );
}

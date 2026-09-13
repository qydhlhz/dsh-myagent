window.__ModuleLoader__.load({ id: "dsh-myagent", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;

"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react15 = __toESM(require("react"), 1);

// src/client/SidebarComposite.tsx
var import_react8 = require("react");
var import_dsh_client_ui_primitives6 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/WorkspaceBrowser.tsx
var import_react4 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/tree-utils.ts
function joinRel(parent, name) {
  return parent === "" ? name : `${parent}/${name}`;
}
function resolveAbsPath(root, rel) {
  if (rel === "") return root;
  const sep = root.endsWith("/") || root.endsWith("\\") ? "" : "/";
  return `${root}${sep}${rel}`;
}
function validateNameInput(kind, value) {
  if (kind === "name") {
    if (value === "") return "\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A";
    if (/[/\\]/.test(value)) return "\u540D\u79F0\u4E0D\u80FD\u5305\u542B / \u6216 \\";
    if (value === "." || value === "..") return "\u540D\u79F0\u4E0D\u80FD\u662F . \u6216 ..";
    return null;
  }
  if (value === "") return "\u8DEF\u5F84\u4E0D\u80FD\u4E3A\u7A7A";
  if (/^[/\\]/.test(value)) return "\u8DEF\u5F84\u4E0D\u80FD\u4EE5\u5206\u9694\u7B26\u5F00\u5934";
  if (value.split(/[/\\]/).includes("..")) return "\u8DEF\u5F84\u4E0D\u80FD\u5305\u542B ..";
  return null;
}
function sortEntries(entries) {
  return [...entries].sort((a, b) => a.kind !== b.kind ? a.kind === "dir" ? -1 : 1 : a.name.localeCompare(b.name));
}
function normForCompare(path) {
  const r = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:/.test(r) || r.startsWith("//") ? r.toLowerCase() : r;
}
function sessionForRoot(sessions, workspaces, root) {
  const target = normForCompare(root);
  for (const w of workspaces.items) {
    if (typeof w.path !== "string" || normForCompare(w.path) !== target) continue;
    const ids = w.sessionIds ?? [];
    if (sessions.current !== void 0 && ids.includes(sessions.current)) {
      return { sessionId: sessions.current, cwd: w.path };
    }
    const first = ids[0];
    if (first !== void 0) return { sessionId: first, cwd: w.path };
  }
  return null;
}
function resolveRoot(sessions, workspaces, currentSessionId) {
  const current = currentSessionId ?? sessions.current;
  if (current !== void 0) {
    for (const w of workspaces.items) {
      if ((w.sessionIds ?? []).includes(current)) return w.path;
    }
  }
  const first = workspaces.items[0];
  return first ? first.path : null;
}

// src/client/active-root-store.ts
var import_react = require("react");
var activeRoot = null;
var listeners = /* @__PURE__ */ new Set();
function emit() {
  for (const listener of listeners) listener();
}
function setActiveRoot(root) {
  if (activeRoot === root) return;
  activeRoot = root;
  emit();
}
function clearActiveRoot() {
  if (activeRoot === null) return;
  activeRoot = null;
  emit();
}
function getActiveRoot() {
  return activeRoot;
}
function subscribeActiveRoot(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function useActiveRoot() {
  return (0, import_react.useSyncExternalStore)(subscribeActiveRoot, getActiveRoot, getActiveRoot);
}

// src/client/ContextMenu.tsx
var import_react2 = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime = require("react/jsx-runtime");
function ContextMenu({ x, y, items, onClose }) {
  const [armedKey, setArmedKey] = (0, import_react2.useState)(null);
  const itemsRef = (0, import_react2.useRef)(items);
  itemsRef.current = items;
  (0, import_react2.useEffect)(() => {
    setArmedKey(null);
  }, [x, y]);
  useCloseOnScroll(onClose);
  const entries = (0, import_react2.useMemo)(
    () => items.map((it) => {
      if (it.separator) return { type: "separator", id: it.key };
      const armed = armedKey === it.key;
      return {
        id: it.key,
        label: armed ? it.confirmLabel ?? `${it.label}\uFF1F` : it.label,
        icon: it.icon,
        disabled: it.disabled,
        danger: it.danger || armed
      };
    }),
    [items, armedKey]
  );
  const getAnchorRect = (0, import_react2.useCallback)(() => {
    const rect = { left: x, top: y, right: x, bottom: y, width: 0, height: 0, x, y, toJSON: () => ({}) };
    return rect;
  }, [x, y]);
  const vw = typeof window === "undefined" ? 0 : window.innerWidth;
  const vh = typeof window === "undefined" ? 0 : window.innerHeight;
  const estW = 218;
  const estH = items.filter((it) => !it.separator).length * 32 + 24;
  const align = x + estW > vw - 12 ? "end" : "start";
  const side = y + estH > vh - 12 ? "top" : "bottom";
  const handleSelect = (id) => {
    const it = itemsRef.current.find((i) => i.key === id);
    if (!it || it.separator) return;
    if (it.confirmLabel && armedKey !== id) {
      setArmedKey(id);
      return;
    }
    if (!it.keepOpen) onClose();
    it.onSelect?.();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_dsh_client_ui_primitives.Menu,
    {
      open: true,
      anchor: null,
      items: entries,
      onSelect: handleSelect,
      onClose,
      side,
      align,
      portal: true,
      getAnchorRect
    }
  );
}
function useCloseOnScroll(onClose) {
  const onCloseRef = (0, import_react2.useRef)(onClose);
  onCloseRef.current = onClose;
  (0, import_react2.useEffect)(() => {
    const onScroll = () => onCloseRef.current();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, []);
}
function PromptModal({ open, title, description, initialValue, placeholder, confirmLabel = "\u786E\u5B9A", validate, brief, onSubmit, onClose, onResummarizeTitle, onResummarizeBrief, resummarizingTitle, resummarizingBrief }) {
  const [value, setValue] = (0, import_react2.useState)(initialValue ?? "");
  (0, import_react2.useEffect)(() => {
    if (open) setValue(initialValue ?? "");
  }, [open, initialValue]);
  const trimmed = value.trim();
  const error = validate ? validate(trimmed) : null;
  const canSubmit = trimmed !== "" && error === null;
  const submit = () => {
    if (!canSubmit) return;
    onSubmit(trimmed);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    import_dsh_client_ui_primitives.Modal,
    {
      open,
      onClose,
      title,
      description,
      className: "fm-prompt-modal-wide",
      footer: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "ghost", onClick: onClose, children: "\u53D6\u6D88" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "primary", onClick: submit, disabled: !canSubmit, children: confirmLabel })
      ] }),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: `.fm-prompt-modal-wide{width:min(560px,calc(100vw - 32px))!important}` }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { width: "100%", display: "flex", flexDirection: "column", gap: 10 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              import_dsh_client_ui_primitives.Input,
              {
                value,
                placeholder,
                autoFocus: true,
                style: { width: "100%", boxSizing: "border-box" },
                onChange: (e) => setValue(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === "Enter") submit();
                }
              }
            ),
            error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-state-error-primary)", fontSize: 12, marginTop: 6 }, children: error }) : null
          ] }),
          onResummarizeTitle || onResummarizeBrief ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [
            onResummarizeTitle ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", size: "sm", variant: "outline", disabled: resummarizingTitle, onClick: onResummarizeTitle, children: resummarizingTitle ? "\u603B\u7ED3\u4E2D\u2026" : "\u91CD\u65B0\u603B\u7ED3\u547D\u540D" }) : null,
            onResummarizeBrief ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", size: "sm", variant: "outline", disabled: resummarizingBrief, onClick: onResummarizeBrief, children: resummarizingBrief ? "\u603B\u7ED3\u4E2D\u2026" : "\u91CD\u65B0\u603B\u7ED3\u7B80\u4ECB" }) : null
          ] }) : null,
          brief !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.5, wordBreak: "break-word" }, children: brief || "\u6682\u65E0\u7B80\u4ECB" }) : null
        ] })
      ]
    }
  );
}
function ConfirmModal({ open, title, description, confirmLabel = "\u786E\u8BA4", onConfirm, onClose }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_dsh_client_ui_primitives.Modal,
    {
      open,
      onClose,
      title,
      description,
      footer: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "ghost", onClick: onClose, children: "\u53D6\u6D88" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.Button,
          {
            variant: "outline",
            onClick: onConfirm,
            style: { color: "var(--dsw-alias-state-error-primary)", borderColor: "var(--dsw-alias-state-error-primary)" },
            children: confirmLabel
          }
        )
      ] })
    }
  );
}

// src/client/TopHatIcon.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function TopHatIcon({ size = 16 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 96 96",
      fill: "currentColor",
      "aria-hidden": "true",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "48", cy: "30", r: "16" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M76.8 59.6C72.4 56 66.8 53.6 61.2 52 60.2 51.71 59.2 51.44 58.2 51.2L50.5 82 80 82 80 66C79.9478 63.4946 78.773 61.1451 76.8 59.6Z" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M54.43 58 48 54.17 41.57 58C41.3708 58.0956 41.1319 58.0116 41.0363 57.8124 41.0031 57.7433 40.9905 57.6661 41 57.59L41 48.79C41 48.45 41.31 48.22 41.57 48.38L48 52.11 54.43 48.33C54.69 48.17 55 48.4 55 48.74L55 57.54C55.0579 57.7532 54.932 57.973 54.7188 58.0308 54.6221 58.0571 54.519 58.0461 54.43 58Z" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "48", cy: "61.5", r: "1.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "48", cy: "67.5", r: "1.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("circle", { cx: "48", cy: "73.5", r: "1.5" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M23.24 62.53 23.24 64.91 35.79 64.91 36.61 74.66C36.6497 75.7843 36.2141 76.8732 35.41 77.66 34.4633 78.6458 33.2939 79.39 32 79.83L32 82 45.5 82 37.81 51.25C36.81 51.48 35.81 51.73 34.81 52 30.1832 53.3512 25.7698 55.3475 21.7 57.93 22.7001 59.255 23.2407 60.87 23.24 62.53Z" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M53 86 33.56 86C33.57 85.9505 33.57 85.8995 33.56 85.85 33.56 85.5 33.19 85.23 32.38 85.02 32.0499 84.9433 31.7161 84.8832 31.38 84.84L31.01 84.84C30.44 84.65 30.12 84.42 30.12 84.2L30.12 78.4C31.5911 78.2172 32.9579 77.5443 34 76.49 34.4519 76.0641 34.7087 75.471 34.71 74.85L34.04 66.85 24.43 66.85 23.86 74.85C23.8443 75.4604 24.0877 76.049 24.53 76.47 25.6032 77.5521 27.0151 78.2333 28.53 78.4L28.53 84.22C28.53 84.45 28.18 84.69 27.67 84.86 27.1765 84.891 26.6874 84.9714 26.21 85.1 25.49 85.31 25.1 85.57 25.03 85.9 25.03 85.96 25.03 86 25.08 86.05L20.52 86.05C20.98 85.79 21.24 85.49 21.24 85.17L21.24 62.53C21.2482 60.435 20.0924 58.5087 18.24 57.53L17.69 47.94 18.44 47.94 18.44 47.47C18.4441 46.6589 17.9221 45.9386 17.15 45.69 17.0461 45.621 16.9247 45.5829 16.8 45.58L13.5 45.58C13.375 45.5811 13.2532 45.6194 13.15 45.69 12.3759 45.9378 11.8504 46.6572 11.85 47.47L11.85 47.94 12.6 47.94 12 57.53C10.1476 58.5087 8.9918 60.435 9 62.53L9 85.12C9 85.44 9.26 85.74 9.72 86L4 86C2.89543 86 2 86.8954 2 88 2 89.1046 2.89543 90 4 90L53 90C54.1046 90 55 89.1046 55 88 55 86.8954 54.1046 86 53 86ZM25.69 71.22 25.86 68.22 32.86 68.22 33.07 71.22Z" })
      ]
    }
  );
}

// src/client/api.ts
var BASE = "/api/myagent";
function describeApiError(e) {
  if (e.status === 404) return "\u6587\u4EF6\u6216\u76EE\u5F55\u4E0D\u5B58\u5728";
  if (e.status === 403 && e.code === "FS_SANDBOX_DENIED") return "\u5F53\u524D\u4F1A\u8BDD\u6C99\u7BB1\u4E0D\u5141\u8BB8\u5199\u5165\u8BE5\u4F4D\u7F6E";
  if (e.status === 403) return "\u8D85\u51FA\u5DE5\u4F5C\u533A\u8303\u56F4";
  if (e.status === 409 && (e.code === "FS_STALE_VERSION" || e.code === "CONFLICT")) return "\u6587\u4EF6\u5DF2\u88AB\u4FEE\u6539\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u540E\u518D\u4FDD\u5B58";
  if (e.status === 409) return "\u76EE\u6807\u5DF2\u5B58\u5728\uFF0C\u8BF7\u6362\u4E2A\u540D\u5B57";
  if (e.status === 413) return "\u6587\u4EF6\u8FC7\u5927\uFF0C\u4EC5\u63D0\u4F9B\u4E0B\u8F7D";
  return `\u64CD\u4F5C\u5931\u8D25\uFF08${e.code ?? e.status}\uFF09`;
}
var Api = class {
  root;
  constructor(root) {
    this.root = root;
  }
  async req(path, init) {
    let res;
    try {
      res = await fetch(`${BASE}${path}`, init);
    } catch {
      return { ok: false, status: 0, code: "NETWORK", message: "\u7F51\u7EDC\u9519\u8BEF" };
    }
    try {
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return {
          ok: false,
          status: res.status,
          code: "NOT_JSON",
          message: `\u54CD\u5E94\u4E0D\u662F JSON\uFF1A${text.slice(0, 200) || res.statusText}`
        };
      }
      if (res.ok && body?.ok) return { ok: true, data: body.data };
      return {
        ok: false,
        status: body?.status ?? res.status,
        code: body?.code ?? "UNKNOWN",
        message: body?.message ?? res.statusText
      };
    } catch {
      return { ok: false, status: res.status, code: "NOT_JSON", message: "\u54CD\u5E94\u4E0D\u662F JSON" };
    }
  }
  tree(path) {
    return this.req(
      `/tree?root=${encodeURIComponent(this.root)}&path=${encodeURIComponent(path)}`
    );
  }
  read(path) {
    return this.req(
      `/read?root=${encodeURIComponent(this.root)}&path=${encodeURIComponent(path)}`
    );
  }
  /** 生成原始字节内联地址（仅用于 PDF/音视频等安全类型）。 */
  inlineHref(path) {
    return `${BASE}/read?raw=1&inline=1&root=${encodeURIComponent(this.root)}&path=${encodeURIComponent(path)}`;
  }
  write(path, content, expectedVersion) {
    return this.req("/write", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        root: this.root,
        path,
        content,
        ...expectedVersion !== void 0 ? { expectedVersion } : {}
      })
    });
  }
  op(op, path, to) {
    return this.req("/op", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: this.root, op, path, ...to ? { to } : {} })
    });
  }
  /** 请求宿主侧“工作区整理员”生成整理建议；宿主不可用/失败时由调用方降级本地整理。 */
  /** 运行代码文件（当前文件必须已保存到磁盘）。 */
  run(path) {
    return this.req("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: this.root, path })
    });
  }
  organizePlan(snapshot) {
    return this.req("/organize/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot })
    });
  }
  /** 请求宿主根据会话内容生成一句话简介；未达到 4 次交互时返回 ready=false。 */
  sessionSummary(sessionId) {
    return this.req("/session/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId })
    });
  }
  /** 重新总结单个会话的标题/简介。 */
  sessionResummarize(sessionId, mode2) {
    return this.req("/session/resummarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, mode: mode2 })
    });
  }
  /**
   * 区管家：一次性更新「有新对话的会话」。
   *
   * 每项带 `marker`（上次总结时宿主给的持久化标记）：宿主只重新总结 marker 变了的会话，
   * 没新内容的原样返回 `unchanged: true`。响应里还有 `summary`（检查/更新/未变/跳过计数）
   * 与 `agent`（管家上下文与 token 用量）。
   *
   * ⚠️ 客户端**按小块**反复调用它（见 WorkspaceBrowser 的 CHUNK 逻辑）：几十条会话
   * 逐个走模型远超单个请求的预算，分块才能既看到进度又不撞路由超时。
   */
  resummarizeAll(sessions) {
    return this.req("/organize/resummarize-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions })
    });
  }
  /** 区管家面板：管家是谁（模型/会话）+ 消耗用量 + 各会话当前 marker。 */
  organizerStatus(sessions) {
    return this.req("/organizer/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions })
    });
  }
};

// src/client/group-store.ts
var DEFAULT_GROUP_ID = "default";
var GROUPS_PATH = ".myagent/groups.json";
function emptyGroups() {
  return {
    version: 1,
    defaultGroup: { id: DEFAULT_GROUP_ID, name: "\u9ED8\u8BA4\u5206\u7EC4" },
    groups: []
  };
}
function parseGroups(text) {
  if (!text) return emptyGroups();
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== "object") return emptyGroups();
    const version = typeof raw.version === "number" ? raw.version : 1;
    const defaultGroup = raw.defaultGroup && typeof raw.defaultGroup.name === "string" ? { id: DEFAULT_GROUP_ID, name: raw.defaultGroup.name } : { id: DEFAULT_GROUP_ID, name: "\u9ED8\u8BA4\u5206\u7EC4" };
    const groups = Array.isArray(raw.groups) ? raw.groups.filter(
      (g) => g && typeof g.id === "string" && g.id !== DEFAULT_GROUP_ID && typeof g.name === "string"
    ).map((g) => ({
      id: g.id,
      name: g.name,
      sessionIds: Array.isArray(g.sessionIds) ? g.sessionIds.filter((x) => typeof x === "string") : []
    })) : [];
    return { version, defaultGroup, groups };
  } catch {
    return emptyGroups();
  }
}
function serializeGroups(data) {
  return JSON.stringify(data, null, 2);
}
function groupOfSession(data, sessionId) {
  const named = data.groups.find((g) => g.sessionIds.includes(sessionId));
  return named ? named.id : DEFAULT_GROUP_ID;
}
function visibleSessionsForGroup(data, groupId, workspaceSessionIds) {
  if (groupId === DEFAULT_GROUP_ID) {
    const named = new Set(data.groups.flatMap((g) => g.sessionIds));
    return workspaceSessionIds.filter((id) => !named.has(id));
  }
  const group = data.groups.find((g) => g.id === groupId);
  if (!group) return [];
  return group.sessionIds.filter((id) => workspaceSessionIds.includes(id));
}
function createGroup(data, name) {
  const id = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return { ...data, groups: [...data.groups, { id, name, sessionIds: [] }] };
}
function addGroup(data, group) {
  if (data.groups.some((g) => g.id === group.id)) return data;
  return { ...data, groups: [...data.groups, group] };
}
function renameGroup(data, groupId, name) {
  if (groupId === DEFAULT_GROUP_ID) {
    return { ...data, defaultGroup: { ...data.defaultGroup, name } };
  }
  return {
    ...data,
    groups: data.groups.map((g) => g.id === groupId ? { ...g, name } : g)
  };
}
function moveSessionToGroup(data, sessionId, targetGroupId) {
  if (targetGroupId !== DEFAULT_GROUP_ID) {
    const target = data.groups.find((g) => g.id === targetGroupId);
    if (!target) return data;
  }
  const groups = data.groups.map((g) => ({
    ...g,
    sessionIds: g.sessionIds.filter((id) => id !== sessionId)
  }));
  if (targetGroupId === DEFAULT_GROUP_ID) return { ...data, groups };
  return {
    ...data,
    groups: groups.map(
      (g) => g.id === targetGroupId ? { ...g, sessionIds: [...g.sessionIds, sessionId] } : g
    )
  };
}
function deleteGroup(data, groupId, destination) {
  if (groupId === DEFAULT_GROUP_ID) return { data, sessionsToArchive: [] };
  const target = data.groups.find((g) => g.id === groupId);
  if (!target) return { data, sessionsToArchive: [] };
  const sessions = target.sessionIds;
  const remaining = data.groups.filter((g) => g.id !== groupId);
  let next = { ...data, groups: remaining };
  if (destination === "archive") {
    return { data: next, sessionsToArchive: sessions };
  }
  if (destination !== "default") {
    for (const id of sessions) next = moveSessionToGroup(next, id, destination);
  }
  return { data: next, sessionsToArchive: [] };
}
function replayMutations(base, mutations) {
  return mutations.reduce((acc, fn) => fn(acc), base);
}
function reorderGroups(data, fromId, toId) {
  if (fromId === DEFAULT_GROUP_ID) return data;
  const from = data.groups.findIndex((g) => g.id === fromId);
  const to = data.groups.findIndex((g) => g.id === toId);
  if (from === -1 || to === -1 || from === to) return data;
  const next = [...data.groups];
  const [item] = next.splice(from, 1);
  const targetIndex = next.findIndex((g) => g.id === toId);
  next.splice(targetIndex, 0, item);
  return { ...data, groups: next };
}
function reorderSessionInGroup(data, groupId, sessionId, beforeSessionId) {
  if (groupId === DEFAULT_GROUP_ID) return data;
  const groupIndex = data.groups.findIndex((g) => g.id === groupId);
  if (groupIndex === -1) return data;
  const group = data.groups[groupIndex];
  if (!group.sessionIds.includes(sessionId)) return data;
  const next = group.sessionIds.filter((id) => id !== sessionId);
  const insertIndex = beforeSessionId === void 0 ? next.length : next.indexOf(beforeSessionId);
  if (insertIndex === -1) return data;
  next.splice(insertIndex, 0, sessionId);
  const groups = [...data.groups];
  groups[groupIndex] = { ...group, sessionIds: next };
  return { ...data, groups };
}
async function loadGroups(api) {
  const res = await api.read(GROUPS_PATH);
  if (!res.ok) {
    if (res.status === 404) return { data: emptyGroups(), version: void 0 };
    throw { status: res.status, code: res.code, message: res.message };
  }
  return { data: parseGroups(res.data?.content), version: res.data?.version };
}
async function saveGroups(api, data, version) {
  const res = await api.write(GROUPS_PATH, serializeGroups(data), version);
  if (!res.ok) {
    throw { status: res.status, code: res.code, message: res.message };
  }
  return res.data?.version;
}

// src/client/annotation-store.ts
var ANNOTATIONS_PATH = ".myagent/annotations.json";
function emptyAnnotations() {
  return {
    version: 1,
    workspaces: {},
    groups: {},
    sessions: {}
  };
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function parseAnnotationRecord(id, value) {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" && typeof id !== "string") return null;
  if (typeof value.brief !== "string") return null;
  return {
    id: typeof value.id === "string" ? value.id : id,
    brief: value.brief,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : ""
  };
}
function parseGroupAnnotation(id, value) {
  const base = parseAnnotationRecord(id, value);
  if (!base) return null;
  const workspaceId = isRecord(value) && typeof value.workspaceId === "string" ? value.workspaceId : "";
  return { ...base, workspaceId };
}
function parseSessionAnnotation(id, value) {
  const base = parseAnnotationRecord(id, value);
  if (!base) return null;
  const title = isRecord(value) && typeof value.title === "string" ? value.title : void 0;
  const marker = isRecord(value) && typeof value.marker === "string" ? value.marker : void 0;
  return {
    ...base,
    ...title === void 0 ? {} : { title },
    ...marker === void 0 ? {} : { marker }
  };
}
function parseAnnotations(text) {
  if (!text) return emptyAnnotations();
  try {
    const raw = JSON.parse(text);
    if (!isRecord(raw)) return emptyAnnotations();
    const version = typeof raw.version === "number" ? raw.version : 1;
    const workspaces = {};
    if (isRecord(raw.workspaces)) {
      for (const [id, value] of Object.entries(raw.workspaces)) {
        const record = parseAnnotationRecord(id, value);
        if (record) workspaces[id] = record;
      }
    }
    const groups = {};
    if (isRecord(raw.groups)) {
      for (const [id, value] of Object.entries(raw.groups)) {
        const record = parseGroupAnnotation(id, value);
        if (record) groups[id] = record;
      }
    }
    const sessions = {};
    if (isRecord(raw.sessions)) {
      for (const [id, value] of Object.entries(raw.sessions)) {
        const record = parseSessionAnnotation(id, value);
        if (record) sessions[id] = record;
      }
    }
    return {
      version,
      workspaces,
      groups,
      sessions,
      ...typeof raw.lastOrganizedAt === "string" ? { lastOrganizedAt: raw.lastOrganizedAt } : {},
      ...isRecord(raw.lastPlan) ? { lastPlan: raw.lastPlan } : {}
    };
  } catch {
    return emptyAnnotations();
  }
}
function serializeAnnotations(data) {
  return JSON.stringify(data, null, 2);
}
function setSessionBrief(data, id, title, brief, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const prev = data.sessions[id];
  return {
    ...data,
    sessions: {
      ...data.sessions,
      [id]: {
        id,
        brief,
        updatedAt: now,
        ...title === void 0 ? {} : { title },
        // marker 由区管家写入（见 setSessionMarker）；这里保留已有值，避免普通重命名把它抹掉。
        ...prev?.marker === void 0 ? {} : { marker: prev.marker }
      }
    }
  };
}
function setSessionMarker(data, id, marker, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const prev = data.sessions[id];
  return {
    ...data,
    sessions: {
      ...data.sessions,
      [id]: {
        id,
        brief: prev?.brief ?? "",
        ...prev?.title === void 0 ? {} : { title: prev.title },
        marker,
        updatedAt: now
      }
    }
  };
}
function setLastOrganizedAt(data, iso) {
  return { ...data, lastOrganizedAt: iso };
}
function setLastPlan(data, plan) {
  return { ...data, lastPlan: plan };
}
async function loadAnnotations(api) {
  const res = await api.read(ANNOTATIONS_PATH);
  if (!res.ok) {
    if (res.status === 404) return { data: emptyAnnotations(), version: void 0 };
    throw { status: res.status, code: res.code, message: res.message };
  }
  return { data: parseAnnotations(res.data?.content), version: res.data?.version };
}
async function saveAnnotations(api, data, version) {
  const res = await api.write(ANNOTATIONS_PATH, serializeAnnotations(data), version);
  if (!res.ok) {
    throw { status: res.status, code: res.code, message: res.message };
  }
  return res.data?.version;
}

// src/client/organizer.ts
function defaultBriefFor(kind, name) {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (kind === "workspace") return `\u5DE5\u4F5C\u533A\uFF1A${trimmed}`;
  if (kind === "group") return `\u5206\u7EC4\uFF1A${trimmed}`;
  return `\u5BF9\u8BDD\uFF1A${trimmed}`;
}
function uniqueActionId(index) {
  return `action-${index}`;
}
function str(v) {
  return typeof v === "string" ? v : "";
}
function isRecord2(v) {
  return typeof v === "object" && v !== null;
}
function normalizeOrganizePlan(input) {
  if (!isRecord2(input) || !Array.isArray(input.actions)) return { actions: [] };
  const actions = [];
  for (const raw of input.actions) {
    if (!isRecord2(raw)) continue;
    const kind = raw.kind;
    const workspaceId = str(raw.workspaceId);
    if (!workspaceId) continue;
    switch (kind) {
      case "createGroup": {
        const groupId = str(raw.groupId);
        const name = str(raw.name);
        if (groupId && name) actions.push({ kind, workspaceId, groupId, name, reason: str(raw.reason) });
        break;
      }
      case "renameGroup": {
        const groupId = str(raw.groupId);
        const oldName = str(raw.oldName);
        const newName = str(raw.newName);
        if (groupId && newName) actions.push({ kind, workspaceId, groupId, oldName: oldName || newName, newName, reason: str(raw.reason) });
        break;
      }
      case "deleteGroup": {
        const groupId = str(raw.groupId);
        const name = str(raw.name);
        if (groupId) actions.push({ kind, workspaceId, groupId, name: name || groupId, reason: str(raw.reason) });
        break;
      }
      case "mergeGroup": {
        const fromGroupId = str(raw.fromGroupId);
        const fromName = str(raw.fromName);
        const toGroupId = str(raw.toGroupId);
        const toName = str(raw.toName);
        if (fromGroupId && toGroupId) actions.push({ kind, workspaceId, fromGroupId, fromName: fromName || fromGroupId, toGroupId, toName: toName || toGroupId, reason: str(raw.reason) });
        break;
      }
      case "moveSession": {
        const sessionId = str(raw.sessionId);
        const sessionTitle = str(raw.sessionTitle);
        const fromGroupId = str(raw.fromGroupId);
        const fromGroupName = str(raw.fromGroupName);
        const toGroupId = str(raw.toGroupId);
        const toGroupName = str(raw.toGroupName);
        if (sessionId && toGroupId) actions.push({ kind, workspaceId, sessionId, sessionTitle: sessionTitle || sessionId, fromGroupId: fromGroupId || "default", fromGroupName: fromGroupName || "\u9ED8\u8BA4\u5206\u7EC4", toGroupId, toGroupName: toGroupName || toGroupId, reason: str(raw.reason) });
        break;
      }
      case "updateBrief": {
        const entity = raw.entity;
        if (entity !== "workspace" && entity !== "group" && entity !== "session") break;
        const entityName = str(raw.entityName);
        const newBrief = str(raw.newBrief);
        if (entityName && newBrief) {
          const base = { kind, entity, workspaceId, entityName, oldBrief: str(raw.oldBrief), newBrief, reason: str(raw.reason) };
          if (entity === "workspace") actions.push(base);
          else if (entity === "group") {
            const groupId = str(raw.groupId);
            if (groupId) actions.push({ ...base, groupId });
          } else {
            const sessionId = str(raw.sessionId);
            if (sessionId) actions.push({ ...base, sessionId });
          }
        }
        break;
      }
    }
  }
  const moveTargets = new Set(
    actions.filter((a) => a.kind === "moveSession").map((a) => a.toGroupId)
  );
  const filtered = actions.filter((a) => a.kind !== "createGroup" || moveTargets.has(a.groupId));
  return { actions: filtered };
}
function actionTitle(action) {
  switch (action.kind) {
    case "createGroup":
      return `\u65B0\u5EFA\u5206\u7EC4\uFF1A${action.name}`;
    case "renameGroup":
      return `\u91CD\u547D\u540D\u5206\u7EC4\uFF1A${action.oldName} \u2192 ${action.newName}`;
    case "deleteGroup":
      return `\u5220\u9664\u7A7A\u5206\u7EC4\uFF1A${action.name}`;
    case "mergeGroup":
      return `\u5408\u5E76\u5206\u7EC4\uFF1A${action.fromName} \u2192 ${action.toName}`;
    case "moveSession":
      return `\u79FB\u52A8\u4F1A\u8BDD\uFF1A${action.sessionTitle} \u2192 ${action.toGroupName}`;
    case "updateBrief": {
      if (action.entity === "session") return `\u66F4\u65B0\u4F1A\u8BDD\u6807\u9898\u4E0E\u7B80\u4ECB\uFF1A${action.entityName}`;
      const where = action.entity === "workspace" ? "\u5DE5\u4F5C\u533A" : "\u5206\u7EC4";
      return `\u66F4\u65B0${where}\u7B80\u8FF0\uFF1A${action.entityName}`;
    }
  }
}
function actionDescription(action) {
  switch (action.kind) {
    case "createGroup":
      return action.reason;
    case "renameGroup":
      return action.reason;
    case "deleteGroup":
      return action.reason;
    case "mergeGroup":
      return action.reason;
    case "moveSession":
      return action.reason;
    case "updateBrief": {
      const oldBrief = action.oldBrief ? `\u201C${action.oldBrief}\u201D` : "\uFF08\u7A7A\uFF09";
      const briefPart = `${oldBrief} \u2192 \u201C${action.newBrief}\u201D`;
      return action.entity === "session" ? `${action.reason}\uFF1A\u6807\u9898\u201C${action.entityName}\u201D\uFF0C\u7B80\u4ECB ${briefPart}` : `${action.reason}\uFF1A${briefPart}`;
    }
  }
}
function diffOrganize(_snapshot, plan) {
  return plan.actions.map((action, index) => ({
    id: uniqueActionId(index),
    action,
    title: actionTitle(action),
    description: actionDescription(action)
  }));
}
function applyOrganizeActionToGroups(groups, action) {
  switch (action.kind) {
    case "createGroup":
      return addGroup(groups, { id: action.groupId, name: action.name, sessionIds: [] });
    case "renameGroup":
      return renameGroup(groups, action.groupId, action.newName);
    case "deleteGroup":
      return deleteGroup(groups, action.groupId, "default").data;
    case "mergeGroup":
      return deleteGroup(groups, action.fromGroupId, action.toGroupId).data;
    case "moveSession":
      return moveSessionToGroup(groups, action.sessionId, action.toGroupId);
    default:
      return groups;
  }
}
function applyOrganizeActionToAnnotations(data, action) {
  switch (action.kind) {
    case "updateBrief": {
      if (action.entity === "workspace" && action.workspaceId) {
        return {
          ...data,
          workspaces: {
            ...data.workspaces,
            [action.workspaceId]: {
              id: action.workspaceId,
              brief: action.newBrief,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            }
          }
        };
      }
      if (action.entity === "group" && action.workspaceId && action.groupId) {
        return {
          ...data,
          groups: {
            ...data.groups,
            [action.groupId]: {
              id: action.groupId,
              brief: action.newBrief,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
              workspaceId: action.workspaceId
            }
          }
        };
      }
      if (action.entity === "session" && action.workspaceId && action.sessionId) {
        return {
          ...data,
          sessions: {
            ...data.sessions,
            [action.sessionId]: {
              id: action.sessionId,
              brief: action.newBrief,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
              title: action.entityName
            }
          }
        };
      }
      return data;
    }
    case "createGroup": {
      if (!action.workspaceId) return data;
      return {
        ...data,
        groups: {
          ...data.groups,
          [action.groupId]: {
            id: action.groupId,
            brief: defaultBriefFor("group", action.name),
            updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
            workspaceId: action.workspaceId
          }
        }
      };
    }
    case "renameGroup": {
      const existing = data.groups[action.groupId];
      if (!existing) return data;
      return {
        ...data,
        groups: {
          ...data.groups,
          [action.groupId]: {
            ...existing,
            brief: existing.brief || defaultBriefFor("group", action.newName),
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          }
        }
      };
    }
    case "deleteGroup":
    case "mergeGroup": {
      const groupId = action.kind === "deleteGroup" ? action.groupId : action.fromGroupId;
      if (!data.groups[groupId]) return data;
      const groups = { ...data.groups };
      delete groups[groupId];
      return { ...data, groups };
    }
    default:
      return data;
  }
}
function applyOrganizeActionsToAnnotations(data, actions) {
  return actions.reduce((acc, action) => applyOrganizeActionToAnnotations(acc, action), data);
}
function isGroupAction(action) {
  return action.kind === "createGroup" || action.kind === "renameGroup" || action.kind === "deleteGroup" || action.kind === "mergeGroup" || action.kind === "moveSession";
}

// src/client/OrganizePanel.tsx
var import_react3 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/ui-kit.ts
var RADIUS = {
  /** 官方文件树行（ui-sidebar-files .row）：10px。 */
  treeRow: 10,
  /** 官方侧栏导航项行（ui-sidebar）：8px。 */
  navRow: 8,
  /** 官方卡片 / pill / tab：12px。 */
  card: 12,
  /** 官方 Button size="sm"：14px。 */
  control: 14,
  /** 官方图标按钮：28px 方框 + 全圆 = 正圆（官方 .tool / .iconButton）。 */
  icon: 999,
  /** 官方 tag / 细指示条：全圆。 */
  pill: 999
};
var FONT_SECONDARY = "var(--dsh-content-font-size-secondary, 13px)";
var TREE_ROW = {
  paddingY: 5,
  paddingX: 10,
  gap: 6,
  /** 子级相对父级的缩进量。 */
  indent: 18
};
var HEADER_BORDER = "0.5px solid var(--dsw-alias-border-l3)";
var ICON_BUTTON_STYLE = {
  width: 28,
  height: 28,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  borderRadius: RADIUS.icon
};
var ICON_GLYPH_SIZE = 14;
var ICON_HIT_EXPAND = 2;
var ROW_ACTION_BUTTON_STYLE = {
  width: 20,
  height: 20,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  borderRadius: RADIUS.icon
};
var ROW_ACTION_GAP = 2;
var ROW_ACTION_HIT_INSET = "-6px -1px";
var ROW_MIN_HEIGHT = { workspace: 40, group: 36, session: 34 };
var RAIL_BUTTON_SIZE = 32;
var RAIL_DOT_SIZE = 8;
var RAIL_MAX_TASKS = 12;
var SCROLLBAR_CSS = `
.fm-scroll {
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l2) transparent;
}
.fm-scroll::-webkit-scrollbar {
  width: 8px;
}
.fm-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.fm-scroll::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l2);
  border-radius: ${RADIUS.pill}px;
}
.fm-scroll:hover::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-hover-l2);
}
`;

// src/client/OrganizePanel.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var PANEL_CSS = `
@keyframes fm-op-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.fm-op-spin{animation:fm-op-spin 1s linear infinite;transform-origin:50% 50%}
.fm-op-detail{transition:background .12s ease,color .12s ease}
.fm-op-detail:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.fm-op-detail:active{background:var(--dsw-alias-interactive-bg-active)}
`;
function n(value) {
  return typeof value === "number" ? value.toLocaleString("en-US") : "-";
}
function Row(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", gap: 8, padding: "2px 0", fontSize: 12, lineHeight: 1.6 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: "none", width: 86, color: "var(--dsw-alias-label-secondary)" }, children: props.label }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { minWidth: 0, flex: 1, wordBreak: "break-word" }, children: props.value })
  ] });
}
function Head(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { margin: "10px 0 4px", fontSize: 12, fontWeight: 600, color: "var(--dsw-alias-label-secondary)" }, children: props.children });
}
function ResultBlock(props) {
  const [open, setOpen] = (0, import_react3.useState)(false);
  const count = props.details?.length ?? 0;
  const detailButtonStyle = {
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
    cursor: "pointer"
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "div",
    {
      style: {
        marginTop: 6,
        padding: "6px 8px",
        borderRadius: RADIUS.card,
        background: "var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.08))",
        fontSize: 12,
        lineHeight: 1.7
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1, minWidth: 0, fontWeight: 600 }, children: props.title }),
          count > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "button",
            {
              type: "button",
              className: "fm-op-detail",
              "aria-expanded": open,
              title: open ? "\u6536\u8D77\u660E\u7EC6" : "\u67E5\u770B\u660E\u7EC6",
              onClick: () => setOpen((v) => !v),
              style: detailButtonStyle,
              children: [
                open ? "\u6536\u8D77\u660E\u7EC6" : `\u67E5\u770B\u660E\u7EC6\uFF08${count}\uFF09`,
                open ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconChevronUpOutline14, { size: 14 }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconChevronDownOutline14, { size: 14 })
              ]
            }
          ) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { children: props.summary }),
        props.extra,
        count > 0 && open ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { marginTop: 4, display: "flex", flexDirection: "column", gap: 5 }, children: props.details?.map((d) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { fontWeight: 600 }, children: d.primary }),
            d.secondary ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { color: "var(--dsw-alias-label-secondary)" }, children: d.secondary }) : null
          ] }, d.key)) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: 2 }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { type: "button", className: "fm-op-detail", onClick: () => setOpen(false), style: detailButtonStyle, children: [
            "\u6536\u8D77\u660E\u7EC6",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconChevronUpOutline14, { size: 14 })
          ] }) })
        ] }) : null
      ]
    }
  );
}
function OrganizePanel(props) {
  const agent = props.agent;
  const usage = props.usage;
  const contextTokens = usage?.contextTokens ?? agent?.contextTokens ?? 0;
  const budget = agent?.contextBudgetTokens ?? 0;
  const pct = budget > 0 ? Math.min(100, Math.round(contextTokens / budget * 100)) : 0;
  const input = usage?.inputTokens ?? agent?.totalInputTokens ?? 0;
  const cache = usage?.cacheReadTokens ?? agent?.totalCacheReadTokens ?? 0;
  const output = usage?.outputTokens ?? agent?.totalOutputTokens ?? 0;
  const requests = usage?.requests ?? agent?.requests ?? 0;
  const busy = props.updating || props.organizing;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("style", { children: PANEL_CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--dsw-alias-border-l1)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(TopHatIcon, { size: 16 }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { flex: 1, fontWeight: 600, fontSize: 13 }, children: "\u533A\u7BA1\u5BB6" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconCloseOutline16, { size: 16 }), style: { width: 28, height: 28, padding: 0 }, title: "\u5173\u95ED\u533A\u7BA1\u5BB6", "aria-label": "\u5173\u95ED\u533A\u7BA1\u5BB6", onClick: props.onClose })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "fm-scroll", style: { flex: 1, minHeight: 0, overflowY: "auto", padding: "0 10px 12px" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Head, { children: "\u8FD9\u662F\u4EC0\u4E48" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { fontSize: 12, lineHeight: 1.75, color: "var(--dsw-alias-label-secondary)" }, children: [
        "\u6211\u662F\u4E00\u4E2A",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("b", { children: "\u4E0D\u663E\u793A\u5BF9\u8BDD\u6846" }),
        "\u7684\u72EC\u7ACB agent\uFF0C\u53EA\u8DD1\u4E0B\u9762\u4E24\u6761\u56FA\u5B9A\u547D\u4EE4\u3002",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("br", {}),
        "\xB7 ",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("b", { children: "\u4E00\u952E\u66F4\u65B0\u5168\u90E8\u5BF9\u8BDD" }),
        "\uFF1A\u8BFB\u4F1A\u8BDD \u2192 \u5199\u7B80\u4ECB \u2192 \u5199",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("b", { children: "\u300C\u4E3B\u9898\uFF1A\u8FDB\u5EA6\u300D" }),
        "\u6807\u9898\uFF1B\u6CA1\u804A\u8FC7\u7684\u4E0D\u91CD\u590D\u5904\u7406\u3002",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("br", {}),
        "\xB7 ",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("b", { children: "\u4E00\u952E\u6574\u7406\u5206\u7EC4" }),
        "\uFF1A\u6309\u9879\u76EE\u540D\u5F52\u7C7B\u5E76\u5E94\u7528\uFF0C\u6574\u7406\u524D\u81EA\u52A8\u7559\u53EF\u64A4\u9500\u5FEB\u7167\u3002",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("br", {}),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)" }, children: "\u4E24\u6761\u547D\u4EE4\u90FD\u8981\u6D88\u8017 token\uFF0C\u7EA6 1\u20132 \u5206\u94B1/\u6761\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Head, { children: "\u547D\u4EE4" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          import_dsh_client_ui_primitives2.Button,
          {
            type: "button",
            size: "sm",
            variant: "primary",
            "data-myagent-update-all": true,
            disabled: busy,
            icon: props.updating ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconLoadingOutline16, { size: 16, className: "fm-op-spin" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconRefreshOutline16, { size: 16 }),
            onClick: props.onUpdateAll,
            children: props.updating ? "\u66F4\u65B0\u4E2D\u2026" : "\u4E00\u952E\u66F4\u65B0\u5168\u90E8\u5BF9\u8BDD"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          import_dsh_client_ui_primitives2.Button,
          {
            type: "button",
            size: "sm",
            variant: "outline",
            "data-myagent-organize-groups": true,
            disabled: busy,
            icon: props.organizing ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconLoadingOutline16, { size: 16, className: "fm-op-spin" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconCheckOutline16, { size: 16 }),
            onClick: props.onOrganizeGroups,
            children: props.organizing ? "\u6574\u7406\u4E2D\u2026" : "\u4E00\u952E\u6574\u7406\u5206\u7EC4"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { marginTop: 6, fontSize: 12, color: "var(--dsw-alias-label-secondary)" }, children: [
        props.loadingInfo ? "\u7EDF\u8BA1\u4E2D\u2026" : props.changedCount === null || props.changedCount === void 0 ? "" : props.changedCount === 0 ? "\u5F53\u524D\u6CA1\u6709\u65B0\u5BF9\u8BDD\u9700\u8981\u66F4\u65B0\u3002" : `\u5F53\u524D\u6709 ${props.changedCount} \u6761\u4F1A\u8BDD\u6709\u65B0\u5BF9\u8BDD\u3002`,
        props.updateProgress ? ` \u8FDB\u5EA6 ${props.updateProgress.done} / ${props.updateProgress.total}` : ""
      ] }),
      props.updateError ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { marginTop: 6, fontSize: 12, color: "var(--dsw-alias-state-error-primary)" }, children: props.updateError }) : null,
      props.updateSummary ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        ResultBlock,
        {
          title: "\u4E0A\u6B21\u300C\u66F4\u65B0\u5168\u90E8\u5BF9\u8BDD\u300D",
          summary: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            "\u68C0\u67E5 ",
            props.updateSummary.checked,
            " \xB7 \u66F4\u65B0 ",
            props.updateSummary.updated,
            " \xB7 \u672A\u53D8",
            " ",
            props.updateSummary.unchanged,
            " \xB7 \u8DF3\u8FC7 ",
            props.updateSummary.skipped,
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("br", {}),
            "\u6A21\u578B ",
            props.updateSummary.agent,
            " \u6761 / \u672C\u5730\u515C\u5E95 ",
            props.updateSummary.local,
            " \u6761 \xB7 \u8017\u65F6",
            " ",
            (props.updateSummary.elapsedMs / 1e3).toFixed(1),
            "s"
          ] }),
          details: (props.updateDetails ?? []).map((d) => ({ key: d.sessionId, primary: d.title || "(\u65E0\u6807\u9898)", secondary: d.brief }))
        }
      ) : null,
      props.organizeError ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { marginTop: 6, fontSize: 12, color: "var(--dsw-alias-state-error-primary)" }, children: props.organizeError }) : null,
      props.organizeSummary ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        ResultBlock,
        {
          title: "\u4E0A\u6B21\u300C\u6574\u7406\u5206\u7EC4\u300D",
          summary: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            "\u65B0\u5EFA ",
            props.organizeSummary.created,
            " \u7EC4 \xB7 \u79FB\u52A8 ",
            props.organizeSummary.moved,
            " \u6761 \xB7 \u91CD\u547D\u540D",
            " ",
            props.organizeSummary.renamed,
            " \xB7 \u5220\u9664 ",
            props.organizeSummary.deleted,
            " \xB7 \u6539\u6807\u6CE8",
            " ",
            props.organizeSummary.updated
          ] }),
          details: props.organizeDetails,
          extra: props.canUndoOrganize && props.onUndoOrganize ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { marginTop: 4 }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { size: "sm", variant: "ghost", onClick: props.onUndoOrganize, children: "\u64A4\u9500\u8FD9\u6B21\u6574\u7406" }) }) : null
        }
      ) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Head, { children: "\u6D88\u8017\u7528\u91CF" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { "data-myagent-usage": true, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Row, { label: "\u4E0A\u4E0B\u6587\u5DF2\u7528", value: `${n(contextTokens)} tokens${budget > 0 ? `\uFF08\u9884\u7B97 ${n(budget)}\uFF0C${pct}%\uFF09` : ""}` }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Row, { label: "\u4F1A\u8BDD\u7D2F\u8BA1", value: `\u8F93\u5165 ${n(input)} \xB7 \u7F13\u5B58\u547D\u4E2D ${n(cache)} \xB7 \u8F93\u51FA ${n(output)}` }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Row, { label: "\u6A21\u578B", value: agent ? `${agent.provider || "-"} / ${agent.model || "-"}` : "\u89E3\u6790\u4E2D\u2026" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Row, { label: "\u8BF7\u6C42\u6B21\u6570", value: `${n(requests)} \u6B21${agent ? `\uFF08\u672C\u6B21\u542F\u52A8 ${n(agent.requests)} \u6B21 \xB7 \u4E0A\u4E0B\u6587\u8F6E\u6362 ${n(agent.rotations)} \u6B21\uFF09` : ""}` }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Row, { label: "\u4E0A\u6B21\u8FD0\u884C", value: agent?.lastRequestAt ? new Date(agent.lastRequestAt).toLocaleString() : "\u5C1A\u672A\u8FD0\u884C" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Row, { label: "\u7BA1\u5BB6\u4F1A\u8BDD", value: agent?.sessionId ?? "-" }),
        agent?.planner ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          Row,
          {
            label: "\u5206\u533A\u5EFA\u8BAE",
            value: `${agent.planner.ready ? "\u5DF2\u5C31\u7EEA" : "\u672A\u542F\u52A8"} \xB7 \u63A8\u7406\u6863 ${agent.planner.reasoningEffort ?? "\u8DDF\u968F\u6A21\u578B\u9ED8\u8BA4"} \xB7 \u4E0A\u4E0B\u6587 ${n(agent.planner.contextTokens)} \uFF0F \u9884\u7B97 ${n(agent.planner.contextBudgetTokens)} \xB7 \u63A8\u7406 token ${n(
              agent.planner.totalReasoningTokens
            )}`
          }
        ) : null,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Row, { label: "\u4F1A\u8BDD\u65E5\u5FD7", value: usage?.sessionBytes != null ? `${n(usage.sessionBytes)} \u5B57\u8282` : "-" }),
        agent && !agent.ready ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { marginTop: 4, fontSize: 12, color: "var(--dsw-alias-state-error-primary)" }, children: "\u7BA1\u5BB6 agent \u5C1A\u672A\u5C31\u7EEA\uFF1A\u8BF7\u68C0\u67E5 settings.yaml \u7684 agent-default-model\uFF08provider / model\uFF09\u3002" }) : null
      ] })
    ] })
  ] });
}

// src/client/WorkspaceBrowser.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
var COLLAPSED_KEY = "fm.workspace.collapsed";
var GROUP_COLLAPSED_KEY = "fm.group.collapsed";
function readCollapsed() {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (raw === null) return /* @__PURE__ */ new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function writeCollapsed(ids) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
  }
}
var BROWSER_CSS = `
.fm-wb-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.fm-wb-row-actions{display:none}
.fm-wb-row:hover .fm-wb-row-actions{display:inline-flex;align-items:center}
.fm-wb-ws-chevron{display:none}
.fm-wb-ws-row:hover .fm-wb-ws-chevron{display:inline-flex}
.fm-wb-ws-row:hover .fm-wb-ws-folder{display:none}
.fm-wb-arrow{transition:transform .15s var(--ds-ease-in-out, ease)}
.fm-wb-arrow-open{transform:rotate(90deg)}
/* \u2500\u2500 \u65B9\u6848 B \xB7 \u5BFC\u8F68\u6811\uFF08\u7528\u6237 2026 \u9009\u5B9A\uFF0C\u89C6\u89C9\u5BF9\u7167\u9875 .superpowers/brainstorm/workspace-ui\uFF09\u2500\u2500
   \u4E09\u7EA7\u4E0D\u518D"\u53EA\u5DEE\u7F29\u8FDB"\uFF0C\u6539\u6210\u5206\u5DE5\u660E\u786E\u7684\u4E09\u6863\uFF1A
     \u4E00\u7EA7 \u5DE5\u4F5C\u533A 13px/600/\u4E3B\u8272   \xB7 \u4E8C\u7EA7 \u5206\u7EC4 12px/600/\u6B21\u8272\uFF08\u5C0F\u8282\u6807\u7B7E\uFF09\xB7 \u4E09\u7EA7 \u4F1A\u8BDD 13px/400/\u4E3B\u8272
   \u518D\u7ED9\u5206\u7EC4\u5BB9\u5668\u753B\u4E00\u6761 1px \u6DE1\u5BFC\u8F68\uFF0C\u4F1A\u8BDD\u6302\u5728\u5BFC\u8F68\u53F3\u4FA7 \u2014\u2014 \u4ECE\u5C5E\u5173\u7CFB\u4E0D\u7528\u8BFB\u5B57\u3002
   \u5BFC\u8F68\u53D6 border-l2\uFF08\u5B98\u65B9\u6700\u6DE1\u7684\u5206\u9694\u8272\uFF09\uFF0C\u591F\u6DE1\u3001\u4E0D\u62A2\u5185\u5BB9\uFF1B\u7A7A\u5206\u7EC4/\u5DF2\u6536\u8D77\u5206\u7EC4\u91CC
   top > bottom\uFF0C\u4F2A\u5143\u7D20\u9AD8\u5EA6\u4E3A\u8D1F\u3001\u4E0D\u7ED8\u5236\uFF0C\u4E0D\u4F1A\u7559\u4E00\u6761\u5B64\u7EBF\u3002 */
.fm-wb-grp{position:relative;margin-bottom:4px}
.fm-wb-grp::before{
  content:"";position:absolute;left:24px;top:36px;bottom:4px;width:1px;
  background:var(--dsw-alias-border-l2);pointer-events:none
}
/* \u4E8C\u7EA7\u7684\u8BA1\u6570\uFF1A\u4ECE\u300C\u540D\u79F0 (1)\u300D\u6587\u672C\u6539\u6210\u72EC\u7ACB\u80F6\u56CA\uFF0C\u5E2E\u5B83\u548C\u4E00\u7EA7\u5212\u6E05\u754C\u9650\u3002
   \u5E95\u8272\u7528 interactive-bg-hover\uFF08\u4EAE/\u6697\u4E3B\u9898\u90FD\u81EA\u9002\u5E94\uFF0C\u4E0D\u5199\u6B7B rgba\uFF09\u3002 */
.fm-wb-cnt{
  flex:none;font-size:11px;line-height:16px;height:16px;padding:0 6px;
  border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);
  color:var(--dsw-alias-label-tertiary)
}
/* \u2500\u2500 \u56FE\u6807\u6309\u94AE\uFF1A\u5B57\u5F62\u6536\u5C0F + \u6709\u6548\u70B9\u51FB\u8303\u56F4\u653E\u5927\uFF08\u7528\u6237\u53CD\u9988"\u6709\u70B9\u62E5\u6324"\uFF09\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   \u5B98\u65B9 .tool / .iconButton \u662F 28px \u65B9\u6846 + CSS \u91CC\u628A svg \u5B9A\u6210 15px\uFF08\u4E0D\u770B\u8C03\u7528\u70B9\u4F20\u7684 size\uFF09\uFF1B
   \u8FD9\u91CC\u6CBF\u7528\u540C\u4E00\u63A5\u7EBF\u5E76\u628A\u5B57\u5F62\u518D\u6536\u4E00\u6863\u5230 14px\uFF0C\u540C\u65F6\u7528\u4F2A\u5143\u7D20\u628A\u547D\u4E2D\u533A\u5411\u56DB\u5468\u5404\u6269 2px
   \uFF0828 \u2192 32\uFF0C\u9762\u79EF +31%\uFF09\u3002\u4F2A\u5143\u7D20\u753B\u5728\u6309\u94AE\u76D2\u5916\u4ECD\u80FD\u547D\u4E2D\u3001\u70B9\u51FB\u76EE\u6807\u5C31\u662F\u6309\u94AE\u672C\u8EAB\uFF0C
   \u6240\u4EE5\u547D\u4E2D\u533A\u53D8\u5927\u800C\u5E03\u5C40\u4E0E\u884C\u9AD8\u5B8C\u5168\u4E0D\u53D8\uFF08\u884C\u9AD8\u4ECD\u7531 28px \u6309\u94AE\u6258\u5E95\uFF09\u3002
   \u26A0\uFE0F \u76F8\u90BB\u6309\u94AE gap \u5FC5\u987B \u2265 2\xD72=4px\uFF0C\u5426\u5219\u4E24\u4E2A\u547D\u4E2D\u533A\u91CD\u53E0\u3001\u70B9\u4E2D\u8C01\u770B DOM \u987A\u5E8F
   \u2014\u2014 \u884C\u5185\u64CD\u4F5C\u7EC4\u539F\u6765\u662F gap:2\uFF0C\u5DF2\u540C\u6B65\u6539\u6210 4\u3002 */
.fm-tb-btn svg,
.fm-fold-btn svg,
.fm-icon-btn svg,
.fm-wb-row-actions > button svg{width:${ICON_GLYPH_SIZE}px;height:${ICON_GLYPH_SIZE}px}
.fm-tb-btn,
.fm-icon-btn,
.fm-wb-row-actions > button{position:relative}
/* \u5E38\u89C4\u56FE\u6807\u6309\u94AE\uFF08\u6807\u9898\u680F / rail / \u5173\u95ED\u952E\uFF09\uFF1A\u76F8\u90BB gap \u2265 4\uFF0C\u5404\u6269 2px \u2192 32\xD732\uFF0C\u8FB9\u754C\u6B63\u597D\u76F8\u63A5\u3002 */
.fm-tb-btn::after,
.fm-fold-btn::after,
.fm-icon-btn::after{
  content:"";position:absolute;inset:-${ICON_HIT_EXPAND}px;border-radius:999px
}
/* \u884C\u5185\u64CD\u4F5C\u6309\u94AE\uFF08\u7D27\u51D1 20px\uFF09\uFF1A\u547D\u4E2D\u533A\u6A2A\u7AD6\u5206\u5F00\u6269 \u2014\u2014 \u6A2A\u5411\u94FA\u6EE1 22px \u8282\u8DDD\uFF08\u76F8\u90BB\u4E25\u4E1D\u5408\u7F1D\uFF0C
   \u65E2\u4E0D\u91CD\u53E0\u4E5F\u4E0D\u7559\u6B7B\u533A\uFF09\uFF0C\u7EB5\u5411\u767D\u9001 6px\uFF0820 \u2192 32px \u9AD8\uFF0C\u884C\u5185\u4E0A\u4E0B\u6CA1\u6709\u90BB\u5C45\uFF09\u3002 */
.fm-wb-row-actions > button::after{
  content:"";position:absolute;inset:${ROW_ACTION_HIT_INSET};border-radius:999px
}
.fm-wb-drop-before::before,.fm-wb-drop-after::after{
  content:"";position:absolute;left:6px;right:6px;height:2px;border-radius:${RADIUS.pill}px;
  background:var(--dsw-alias-state-business-primary);pointer-events:none;z-index:2
}
.fm-wb-drop-before::before{top:-1px}
.fm-wb-drop-after::after{bottom:-1px}
/* \u8FD0\u884C\u4E2D\u4F1A\u8BDD\u72B6\u6001\u70B9\u7684\u547C\u5438\u8109\u51B2\uFF08\u4E0E\u5B98\u65B9 StateDot ongoing \u7684\u6D3B\u8DC3\u6697\u793A\u4E00\u81F4\uFF09\u3002 */
@keyframes fm-wb-dot-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.fm-wb-dot-running{animation:fm-wb-dot-pulse 1.2s ease-in-out infinite}
/* \u53EA\u9690\u85CF\u5BBF\u4E3B\u539F\u751F\u201C\u65B0\u4F1A\u8BDD\u201D\u5927\u6309\u94AE\uFF08\u4FDD\u7559 DeepSeek logo/brand \u6309\u94AE\uFF09\u3002 */
button.hHd-Xa_newSession,
button[class*="newSession"],
[role="button"].hHd-Xa_newSession,
[role="button"][class*="newSession"]{display:none!important}
/* \u538B\u7F29\u539F\u751F logo \u533A\uFF0C\u907F\u514D\u906E\u6321\u5DE5\u4F5C\u533A\u6309\u94AE */
.hHd-Xa_logoRow{height:40px!important;margin-bottom:4px!important;padding:4px 0 4px 4px!important}
/* \u9876\u90E8\u4FA7\u680F\u6536\u8D77\u952E\uFF1A\u5BBD\u6001/\u6536\u8D77\u6001\u90FD\u663E\u793A\u53CC\u7BAD\u5934\uFF08\u6536\u8D77\u6001\u4E3A\u53F3\u7BAD\u5934\uFF0C\u4E0D\u518D\u663E\u793A\u9CB8\u9C7C\uFF09\u3002
   \u6839\u56E0\uFF082026 \u5B9E\u6D4B\uFF09\uFF1A\u5B98\u65B9\u6536\u8D77\u6001\u6309\u94AE\u5185\u90E8\u6E32\u67D3\u7684\u662F <span class="hHd-Xa_railMark"> \u91CC\u7684
   DeepSeek \u9CB8\u9C7C svg\uFF0824\xD718\uFF09\uFF0C\u672C\u63D2\u4EF6\u53C8\u7528 ::before \u5728\u540C\u4E00\u9897 30\xD730 \u6309\u94AE\u4E0A\u753B 24\xD724 \u53CC\u7BAD\u5934
   \u2014\u2014\u4E24\u8005\u540C\u6846\u53E0\u5728\u4E00\u8D77\uFF08\u7528\u6237\u62A5\u7684"logo \u548C\u5C55\u5F00\u7BAD\u5934\u91CD\u5408"\uFF09\u3002
   \u6B64\u524D\u53EA\u9690\u85CF .hHd-Xa_panelIcon / .hHd-Xa_railFish\uFF0C\u800C\u672C\u7248 dsh \u7684\u771F\u5B9E\u7C7B\u540D\u662F
   .hHd-Xa_railMark\uFF08railFish \u662F\u65E7\u7248\u540D\uFF09\uFF0C\u6240\u4EE5\u9CB8\u9C7C\u4E00\u76F4\u6CA1\u88AB\u9690\u85CF\u6389\u3002
   \u4E09\u4E2A\u7C7B\u540D\u4E00\u8D77\u9690\u85CF\uFF1ArailMark \u8986\u76D6\u5F53\u524D\u7248\u672C\uFF0CrailFish / panelIcon \u8986\u76D6\u65E7\u7248\u672C\u3002 */
button.hHd-Xa_toggle .hHd-Xa_panelIcon,
button.hHd-Xa_toggle .hHd-Xa_railMark,
button.hHd-Xa_toggle .hHd-Xa_railFish{display:none!important}
/* \u5B98\u65B9\u5728\u6536\u8D77\u6001 hover \u65F6\u4F1A\u628A railMark \u6539\u56DE display:inline\u3001\u628A panelIcon \u663E\u793A\u51FA\u6765
   \uFF08.hHd-Xa_collapsed .hHd-Xa_toggle:hover ...\uFF09\u2014\u2014\u4E0A\u4E00\u6761 !important \u5DF2\u8986\u76D6\uFF0C
   \u8FD9\u91CC\u518D\u9489\u4E00\u6B21\u6536\u8D77\u6001\uFF0C\u907F\u514D hover \u65F6\u9CB8\u9C7C\u95EA\u56DE\u6765\u538B\u4F4F\u53CC\u7BAD\u5934\u3002 */
.hHd-Xa_collapsed button.hHd-Xa_toggle:hover .hHd-Xa_railMark,
.hHd-Xa_collapsed button.hHd-Xa_toggle:hover .hHd-Xa_panelIcon{display:none!important}
.hHd-Xa_root:not(.hHd-Xa_collapsed) button.hHd-Xa_toggle{position:relative}
.hHd-Xa_root:not(.hHd-Xa_collapsed) button.hHd-Xa_toggle::before{
  content:"";position:absolute;left:50%;top:50%;width:24px;height:24px;transform:translate(-50%,-50%);
  background-color:currentColor;
  -webkit-mask:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M10 6 L5 12 L10 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M19 6 L14 12 L19 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat center/contain;
  mask:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M10 6 L5 12 L10 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M19 6 L14 12 L19 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat center/contain;
}
.hHd-Xa_root:not(.hHd-Xa_collapsed) button.hHd-Xa_toggle::after{display:none!important}
.hHd-Xa_root.hHd-Xa_collapsed button.hHd-Xa_toggle{position:relative;width:30px!important;height:30px!important;transform:translate(-1px,-2px)}
.hHd-Xa_root.hHd-Xa_collapsed button.hHd-Xa_toggle::before{
  content:"";position:absolute;left:50%;top:50%;width:24px;height:24px;transform:translate(-50%,-50%);
  background-color:currentColor;
  -webkit-mask:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M14 6 L19 12 L14 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M5 6 L10 12 L5 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat center/contain;
  mask:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M14 6 L19 12 L14 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M5 6 L10 12 L5 18' fill='none' stroke='black' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat center/contain;
}
.hHd-Xa_root.hHd-Xa_collapsed button.hHd-Xa_toggle::after{display:none!important}
`;
var ICON_BTN_STYLE = ICON_BUTTON_STYLE;
function rowHalf(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
}
function WorkspaceBrowser(props) {
  const { useSessions, useWorkspaces } = props;
  const workspaces = useWorkspaces((s) => s.items) ?? [];
  const archived = useWorkspaces((s) => s.archivedSessionIds) ?? [];
  const sessions = useSessions((s) => s.byId) ?? {};
  const current = useSessions((s) => s.current);
  const [collapsed, setCollapsed] = (0, import_react4.useState)(() => readCollapsed());
  const [groupsByWorkspace, setGroupsByWorkspace] = (0, import_react4.useState)({});
  const [groupsVersions, setGroupsVersions] = (0, import_react4.useState)({});
  const [groupsErrors, setGroupsErrors] = (0, import_react4.useState)({});
  const [groupsLoaded, setGroupsLoaded] = (0, import_react4.useState)({});
  const [drag, setDrag] = (0, import_react4.useState)(null);
  const [sessionDrag, setSessionDrag] = (0, import_react4.useState)(null);
  const [dropGroupId, setDropGroupId] = (0, import_react4.useState)(null);
  const [dropSessionId, setDropSessionId] = (0, import_react4.useState)(null);
  const [dropSessionHalf, setDropSessionHalf] = (0, import_react4.useState)(null);
  const dropGroupIdRef = (0, import_react4.useRef)(null);
  const dropSessionIdRef = (0, import_react4.useRef)(null);
  const dropSessionHalfRef = (0, import_react4.useRef)(null);
  const sessionDragRef = (0, import_react4.useRef)(null);
  const longPressTimer = (0, import_react4.useRef)(null);
  const longPressOrigin = (0, import_react4.useRef)(null);
  const longPressElement = (0, import_react4.useRef)(null);
  const longPressPointerId = (0, import_react4.useRef)(null);
  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressOrigin.current = null;
    dropSessionIdRef.current = null;
    dropSessionHalfRef.current = null;
    setDropSessionId(null);
    setDropSessionHalf(null);
    const el = longPressElement.current;
    const pid = longPressPointerId.current;
    longPressElement.current = null;
    longPressPointerId.current = null;
    if (el && pid !== null) {
      try {
        el.releasePointerCapture(pid);
      } catch {
      }
    }
  };
  const startSessionLongPress = (e, workspaceId, sessionId) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    clearLongPress();
    sessionDragRef.current = null;
    longPressElement.current = e.currentTarget;
    longPressPointerId.current = e.pointerId;
    longPressOrigin.current = { x: e.clientX, y: e.clientY };
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      const dragInfo = {
        workspaceId,
        sessionId,
        groupId: groupOfSession(groupsForWorkspace(workspaceId), sessionId)
      };
      sessionDragRef.current = dragInfo;
      setSessionDrag(dragInfo);
      setDropGroupId(null);
      dropGroupIdRef.current = null;
      dropSessionIdRef.current = null;
      dropSessionHalfRef.current = null;
      setDropSessionId(null);
      setDropSessionHalf(null);
      try {
        longPressElement.current?.setPointerCapture(longPressPointerId.current);
      } catch {
      }
    }, 150);
  };
  const updateSessionLongPress = (e) => {
    const origin = longPressOrigin.current;
    const activeDrag = sessionDragRef.current;
    if (!activeDrag && origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 8) {
      clearLongPress();
      return;
    }
    if (!activeDrag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const groupEl = el?.closest?.("[data-group-id]");
    const gid = groupEl?.getAttribute("data-group-id") ?? null;
    dropGroupIdRef.current = gid;
    setDropGroupId(gid);
    const sessionEl = el?.closest?.("[data-session-id]");
    const sid = sessionEl?.getAttribute("data-session-id") ?? null;
    if (sid && sid !== activeDrag.sessionId && gid === activeDrag.groupId && sessionEl) {
      const rect = sessionEl.getBoundingClientRect();
      const half = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      dropSessionIdRef.current = sid;
      dropSessionHalfRef.current = half;
      setDropSessionId(sid);
      setDropSessionHalf(half);
    } else {
      dropSessionIdRef.current = null;
      dropSessionHalfRef.current = null;
      setDropSessionId(null);
      setDropSessionHalf(null);
    }
  };
  const endSessionLongPress = () => {
    const targetGroup = dropGroupIdRef.current;
    const targetSession = dropSessionIdRef.current;
    const targetHalf = dropSessionHalfRef.current;
    clearLongPress();
    const activeDrag = sessionDragRef.current ?? sessionDrag;
    if (activeDrag) {
      if (targetGroup && targetGroup !== activeDrag.groupId) {
        moveSessionAndSave(activeDrag.workspaceId, activeDrag.sessionId, targetGroup);
      } else {
        if (targetSession && targetSession !== activeDrag.sessionId) {
          const w = workspaces.find((x) => x.workspaceId === activeDrag.workspaceId);
          if (w) {
            const visible = visibleSessionsForGroup(
              groupsForWorkspace(activeDrag.workspaceId),
              activeDrag.groupId,
              (w.sessionIds ?? []).filter((id) => !archived.includes(id))
            );
            const targetIndex = visible.indexOf(targetSession);
            const sourceIndex = visible.indexOf(activeDrag.sessionId);
            if (targetIndex !== -1 && sourceIndex !== -1) {
              const beforeId = targetHalf === "before" ? targetSession : visible[targetIndex + 1];
              if (beforeId !== activeDrag.sessionId) {
                reorderSessionInSameGroup(activeDrag.workspaceId, activeDrag.sessionId, activeDrag.groupId, beforeId);
              }
            }
          }
        }
      }
      sessionDragRef.current = null;
      setSessionDrag(null);
      setDropGroupId(null);
      dropGroupIdRef.current = null;
      dropSessionIdRef.current = null;
      dropSessionHalfRef.current = null;
    }
  };
  const groupsVersionsRef = (0, import_react4.useRef)({});
  const pendingMutations = (0, import_react4.useRef)({});
  const groupsDiskRef = (0, import_react4.useRef)({});
  const flushing = (0, import_react4.useRef)({});
  const knownSessionIds = (0, import_react4.useRef)({});
  const [annotationsByWorkspace, setAnnotationsByWorkspace] = (0, import_react4.useState)({});
  const [annotationsVersions, setAnnotationsVersions] = (0, import_react4.useState)({});
  const [annotationsErrors, setAnnotationsErrors] = (0, import_react4.useState)({});
  const [annotationsLoaded, setAnnotationsLoaded] = (0, import_react4.useState)({});
  const annotationsVersionsRef = (0, import_react4.useRef)({});
  const annotationsDiskRef = (0, import_react4.useRef)({});
  const annotationsPending = (0, import_react4.useRef)({});
  const annotationsFlushing = (0, import_react4.useRef)({});
  const annotationsFlushPromise = (0, import_react4.useRef)({});
  const autoBriefedRef = (0, import_react4.useRef)(/* @__PURE__ */ new Set());
  const interactionCounts = (0, import_react4.useRef)({});
  const lastRunning = (0, import_react4.useRef)({});
  const summaryRequested = (0, import_react4.useRef)(/* @__PURE__ */ new Set());
  const [organizeOpen, setOrganizeOpen] = (0, import_react4.useState)(false);
  const [organizeApplying, setOrganizeApplying] = (0, import_react4.useState)(false);
  const [organizeError, setOrganizeError] = (0, import_react4.useState)(null);
  const [updateRunning, setUpdateRunning] = (0, import_react4.useState)(false);
  const [updateSummary, setUpdateSummary] = (0, import_react4.useState)(null);
  const [updateError, setUpdateError] = (0, import_react4.useState)(null);
  const [updateDetails, setUpdateDetails] = (0, import_react4.useState)([]);
  const [updateProgress, setUpdateProgress] = (0, import_react4.useState)(null);
  const [organizing, setOrganizing] = (0, import_react4.useState)(false);
  const [organizeSummary, setOrganizeSummary] = (0, import_react4.useState)(null);
  const [organizeDetails, setOrganizeDetails] = (0, import_react4.useState)([]);
  const [canUndoOrganize, setCanUndoOrganize] = (0, import_react4.useState)(false);
  const organizeUndoRef = (0, import_react4.useRef)(null);
  const [changedCount, setChangedCount] = (0, import_react4.useState)(null);
  const [agentInfo, setAgentInfo] = (0, import_react4.useState)(null);
  const [agentUsage, setAgentUsage] = (0, import_react4.useState)(null);
  const [loadingInfo, setLoadingInfo] = (0, import_react4.useState)(false);
  const workspaceById = (id) => workspaces.find((x) => x.workspaceId === id);
  const apiForWorkspace = (id) => {
    const w = workspaceById(id);
    return w ? new Api(w.path) : null;
  };
  const groupsForWorkspace = (id) => groupsByWorkspace[id] ?? emptyGroups();
  const annotationsForWorkspace = (id) => annotationsByWorkspace[id] ?? emptyAnnotations();
  const flushAnnotations = async (workspaceId) => {
    const api = apiForWorkspace(workspaceId);
    if (!api) return;
    while ((annotationsPending.current[workspaceId]?.length ?? 0) > 0) {
      const batch = annotationsPending.current[workspaceId] ?? [];
      annotationsPending.current[workspaceId] = [];
      const base = annotationsDiskRef.current[workspaceId] ?? emptyAnnotations();
      const desired = batch.reduce((acc, item) => item.mutate(acc), base);
      setAnnotationsByWorkspace((m) => ({ ...m, [workspaceId]: desired }));
      try {
        let version = annotationsVersionsRef.current[workspaceId];
        if (version === void 0) {
          const loaded = await loadAnnotations(api);
          version = loaded.version;
          annotationsDiskRef.current[workspaceId] = loaded.data;
          annotationsVersionsRef.current[workspaceId] = version;
          setAnnotationsVersions((m) => ({ ...m, [workspaceId]: version }));
          const merged = batch.reduce((acc, item) => item.mutate(acc), loaded.data);
          setAnnotationsByWorkspace((m) => ({ ...m, [workspaceId]: merged }));
          const saved2 = await saveAnnotations(api, merged, version);
          annotationsDiskRef.current[workspaceId] = merged;
          annotationsVersionsRef.current[workspaceId] = saved2;
          setAnnotationsVersions((m) => ({ ...m, [workspaceId]: saved2 }));
          continue;
        }
        const saved = await saveAnnotations(api, desired, version);
        annotationsDiskRef.current[workspaceId] = desired;
        annotationsVersionsRef.current[workspaceId] = saved;
        setAnnotationsVersions((m) => ({ ...m, [workspaceId]: saved }));
        setAnnotationsErrors((m) => {
          const next = { ...m };
          delete next[workspaceId];
          return next;
        });
      } catch (e) {
        const isConflict = e?.status === 409 || e?.code === "FS_STALE_VERSION" || e?.code === "CONFLICT";
        setAnnotationsErrors((m) => ({ ...m, [workspaceId]: describeApiError(e) }));
        try {
          const loaded = await loadAnnotations(api);
          annotationsDiskRef.current[workspaceId] = loaded.data;
          annotationsVersionsRef.current[workspaceId] = loaded.version;
          setAnnotationsVersions((m) => ({ ...m, [workspaceId]: loaded.version }));
          if (isConflict) {
            const merged = batch.reduce((acc, item) => item.mutate(acc), loaded.data);
            setAnnotationsByWorkspace((m) => ({ ...m, [workspaceId]: merged }));
            const saved = await saveAnnotations(api, merged, loaded.version);
            annotationsDiskRef.current[workspaceId] = merged;
            annotationsVersionsRef.current[workspaceId] = saved;
            setAnnotationsVersions((m) => ({ ...m, [workspaceId]: saved }));
          } else {
            setAnnotationsByWorkspace((m) => ({ ...m, [workspaceId]: loaded.data }));
          }
        } catch {
        }
      }
    }
  };
  const updateAnnotations = (workspaceId, mutate) => {
    const api = apiForWorkspace(workspaceId);
    if (!api) return;
    const base = annotationsDiskRef.current[workspaceId] ?? annotationsForWorkspace(workspaceId);
    const next = mutate(base);
    annotationsDiskRef.current[workspaceId] = next;
    setAnnotationsByWorkspace((m) => ({ ...m, [workspaceId]: next }));
    (annotationsPending.current[workspaceId] ??= []).push({ mutate });
    if (!annotationsFlushing.current[workspaceId]) {
      annotationsFlushing.current[workspaceId] = true;
      annotationsFlushPromise.current[workspaceId] = flushAnnotations(workspaceId).catch(() => {
      }).finally(() => {
        annotationsFlushing.current[workspaceId] = false;
      });
    }
  };
  const awaitAnnotationsFlushed = async () => {
    const pending = Object.values(annotationsFlushPromise.current).filter(Boolean);
    if (pending.length > 0) await Promise.all(pending);
  };
  const workspaceKey = workspaces.map((w) => `${w.workspaceId}:${w.path}`).join("|");
  const [selectedGroupByWorkspace, setSelectedGroupByWorkspace] = (0, import_react4.useState)({});
  const [activeWorkspaceId, setActiveWorkspaceId] = (0, import_react4.useState)(null);
  const selectedGroupForWorkspace = (workspaceId) => selectedGroupByWorkspace[workspaceId] ?? DEFAULT_GROUP_ID;
  const selectGroup = (workspaceId, groupId) => {
    setActiveWorkspaceId(workspaceId);
    setSelectedGroupByWorkspace((m) => ({ ...m, [workspaceId]: groupId }));
  };
  const activeWorkspaceForNewChat = () => {
    if (activeWorkspaceId) return activeWorkspaceId;
    const currentWorkspace = workspaces.find((w) => (w.sessionIds ?? []).includes(current ?? ""));
    return currentWorkspace?.workspaceId ?? workspaces[0]?.workspaceId;
  };
  const flushWorkspace = async (workspaceId) => {
    const api = apiForWorkspace(workspaceId);
    if (!api) return;
    while ((pendingMutations.current[workspaceId]?.length ?? 0) > 0) {
      const batch = pendingMutations.current[workspaceId] ?? [];
      pendingMutations.current[workspaceId] = [];
      const base = groupsDiskRef.current[workspaceId] ?? groupsForWorkspace(workspaceId);
      const desired = replayMutations(base, batch.map((x) => x.mutate));
      setGroupsByWorkspace((m) => ({ ...m, [workspaceId]: desired }));
      try {
        let version = groupsVersionsRef.current[workspaceId];
        if (version === void 0) {
          const loaded = await loadGroups(api);
          version = loaded.version;
          groupsDiskRef.current[workspaceId] = loaded.data;
          groupsVersionsRef.current[workspaceId] = version;
          setGroupsVersions((m) => ({ ...m, [workspaceId]: version }));
          const merged = replayMutations(loaded.data, batch.map((x) => x.mutate));
          setGroupsByWorkspace((m) => ({ ...m, [workspaceId]: merged }));
          const saved2 = await saveGroups(api, merged, version);
          groupsDiskRef.current[workspaceId] = merged;
          groupsVersionsRef.current[workspaceId] = saved2;
          setGroupsVersions((m) => ({ ...m, [workspaceId]: saved2 }));
          for (const item of batch) item.onSuccess?.();
          continue;
        }
        const saved = await saveGroups(api, desired, version);
        groupsDiskRef.current[workspaceId] = desired;
        groupsVersionsRef.current[workspaceId] = saved;
        setGroupsVersions((m) => ({ ...m, [workspaceId]: saved }));
        for (const item of batch) item.onSuccess?.();
      } catch (e) {
        const isConflict = e?.status === 409 || e?.code === "FS_STALE_VERSION" || e?.code === "CONFLICT";
        try {
          const loaded = await loadGroups(api);
          groupsDiskRef.current[workspaceId] = loaded.data;
          groupsVersionsRef.current[workspaceId] = loaded.version;
          setGroupsVersions((m) => ({ ...m, [workspaceId]: loaded.version }));
          if (isConflict) {
            const merged = replayMutations(loaded.data, batch.map((x) => x.mutate));
            setGroupsByWorkspace((m) => ({ ...m, [workspaceId]: merged }));
            const saved = await saveGroups(api, merged, loaded.version);
            groupsDiskRef.current[workspaceId] = merged;
            groupsVersionsRef.current[workspaceId] = saved;
            setGroupsVersions((m) => ({ ...m, [workspaceId]: saved }));
            for (const item of batch) item.onSuccess?.();
            continue;
          }
          setGroupsByWorkspace((m) => ({ ...m, [workspaceId]: loaded.data }));
        } catch {
          setGroupsByWorkspace((m) => ({ ...m, [workspaceId]: groupsDiskRef.current[workspaceId] ?? groupsForWorkspace(workspaceId) }));
        }
        window.alert(`\u4FDD\u5B58\u5206\u7EC4\u5931\u8D25\uFF1A${describeApiError(e)}`);
      }
    }
  };
  const enqueueGroupSave = (workspaceId, mutate, onSuccess) => {
    const api = apiForWorkspace(workspaceId);
    if (!api) {
      window.alert("\u65E0\u6CD5\u5B9A\u4F4D\u5DE5\u4F5C\u533A");
      return false;
    }
    if (!groupsLoaded[workspaceId]) {
      window.alert("\u5206\u7EC4\u5C1A\u672A\u52A0\u8F7D\u5B8C\u6210\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
      return false;
    }
    (pendingMutations.current[workspaceId] ??= []).push({ mutate, onSuccess });
    if (!flushing.current[workspaceId]) {
      flushing.current[workspaceId] = true;
      void flushWorkspace(workspaceId).finally(() => {
        flushing.current[workspaceId] = false;
      }).catch(() => {
      });
    }
    return true;
  };
  import_react4.default.useEffect(() => {
    let cancelled = false;
    for (const w of workspaces) {
      const api = new Api(w.path);
      loadGroups(api).then(({ data, version }) => {
        if (cancelled) return;
        groupsVersionsRef.current[w.workspaceId] = version;
        groupsDiskRef.current[w.workspaceId] = data;
        setGroupsByWorkspace((m) => ({ ...m, [w.workspaceId]: data }));
        setGroupsVersions((m) => ({ ...m, [w.workspaceId]: version }));
        setGroupsLoaded((m) => ({ ...m, [w.workspaceId]: true }));
        setGroupsErrors((m) => {
          const next = { ...m };
          delete next[w.workspaceId];
          return next;
        });
      }).catch((e) => {
        if (cancelled) return;
        setGroupsErrors((m) => ({ ...m, [w.workspaceId]: describeApiError(e) }));
        groupsDiskRef.current[w.workspaceId] = emptyGroups();
        setGroupsByWorkspace((m) => ({ ...m, [w.workspaceId]: emptyGroups() }));
        setGroupsLoaded((m) => ({ ...m, [w.workspaceId]: true }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [workspaceKey]);
  import_react4.default.useEffect(() => {
    let cancelled = false;
    for (const w of workspaces) {
      const api = new Api(w.path);
      loadAnnotations(api).then(({ data, version }) => {
        if (cancelled) return;
        annotationsVersionsRef.current[w.workspaceId] = version;
        annotationsDiskRef.current[w.workspaceId] = data;
        setAnnotationsByWorkspace((m) => ({ ...m, [w.workspaceId]: data }));
        setAnnotationsVersions((m) => ({ ...m, [w.workspaceId]: version }));
        setAnnotationsLoaded((m) => ({ ...m, [w.workspaceId]: true }));
        setAnnotationsErrors((m) => {
          const next = { ...m };
          delete next[w.workspaceId];
          return next;
        });
      }).catch((e) => {
        if (cancelled) return;
        setAnnotationsErrors((m) => ({ ...m, [w.workspaceId]: describeApiError(e) }));
        annotationsDiskRef.current[w.workspaceId] = emptyAnnotations();
        setAnnotationsByWorkspace((m) => ({ ...m, [w.workspaceId]: emptyAnnotations() }));
        setAnnotationsLoaded((m) => ({ ...m, [w.workspaceId]: true }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [workspaceKey]);
  const workspaceSessionsKey = workspaces.map((w) => `${w.workspaceId}:${(w.sessionIds ?? []).join(",")}`).join("|");
  import_react4.default.useEffect(() => {
    for (const w of workspaces) {
      const visible = (w.sessionIds ?? []).filter((id) => !archived.includes(id));
      const known = knownSessionIds.current[w.workspaceId];
      if (!known) {
        knownSessionIds.current[w.workspaceId] = new Set(visible);
        continue;
      }
      const nextKnown = new Set(known);
      for (const id of visible) nextKnown.add(id);
      const targetGroupId = selectedGroupForWorkspace(w.workspaceId);
      if (targetGroupId !== DEFAULT_GROUP_ID && groupsLoaded[w.workspaceId]) {
        const data = groupsForWorkspace(w.workspaceId);
        for (const id of visible) {
          if (!known.has(id) && groupOfSession(data, id) === DEFAULT_GROUP_ID) {
            enqueueGroupSave(w.workspaceId, (d) => moveSessionToGroup(d, id, targetGroupId));
          }
        }
      }
      knownSessionIds.current[w.workspaceId] = nextKnown;
    }
  }, [workspaceSessionsKey, selectedGroupByWorkspace, groupsLoaded]);
  import_react4.default.useEffect(() => {
    for (const [id, s] of Object.entries(sessions)) {
      const running = !!s?.running;
      const prev = lastRunning.current[id];
      if (prev === true && !running) {
        interactionCounts.current[id] = (interactionCounts.current[id] ?? 0) + 1;
      }
      lastRunning.current[id] = running;
    }
  }, [sessions]);
  import_react4.default.useEffect(() => {
    for (const w of workspaces) {
      if (!annotationsLoaded[w.workspaceId]) continue;
      const ann = annotationsForWorkspace(w.workspaceId);
      for (const id of w.sessionIds ?? []) {
        const s = sessions[id];
        const title = s?.title;
        if (!title) continue;
        const key = `${w.workspaceId}:${id}`;
        const rec = ann.sessions[id];
        if (rec && rec.brief.trim()) {
          autoBriefedRef.current.add(key);
          continue;
        }
        if (autoBriefedRef.current.has(key) || summaryRequested.current.has(key)) continue;
        const count = interactionCounts.current[id] ?? 0;
        if (count < 4) continue;
        autoBriefedRef.current.add(key);
        summaryRequested.current.add(key);
        void (async () => {
          try {
            const res = await new Api("").sessionSummary(id);
            if (res.ok && res.data?.ready && res.data.brief) {
              updateAnnotations(w.workspaceId, (d) => setSessionBrief(d, id, title, res.data.brief));
            }
          } catch {
          }
        })();
      }
    }
  }, [workspaceSessionsKey, annotationsLoaded, sessions]);
  import_react4.default.useEffect(() => {
    const ids = new Set(workspaces.map((w) => w.workspaceId));
    setGroupsErrors((m) => {
      const next = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    setGroupsByWorkspace((m) => {
      const next = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    setGroupsVersions((m) => {
      const next = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    setGroupsLoaded((m) => {
      const next = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    for (const k of Object.keys(groupsVersionsRef.current)) if (!ids.has(k)) delete groupsVersionsRef.current[k];
    for (const k of Object.keys(pendingMutations.current)) if (!ids.has(k)) delete pendingMutations.current[k];
    for (const k of Object.keys(groupsDiskRef.current)) if (!ids.has(k)) delete groupsDiskRef.current[k];
    for (const k of Object.keys(flushing.current)) if (!ids.has(k)) delete flushing.current[k];
    for (const k of Object.keys(knownSessionIds.current)) if (!ids.has(k)) delete knownSessionIds.current[k];
    setAnnotationsErrors((m) => {
      const next = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    setAnnotationsByWorkspace((m) => {
      const next = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    setAnnotationsVersions((m) => {
      const next = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    setAnnotationsLoaded((m) => {
      const next = {};
      for (const [k, v] of Object.entries(m)) if (ids.has(k)) next[k] = v;
      return next;
    });
    for (const k of Object.keys(annotationsVersionsRef.current)) if (!ids.has(k)) delete annotationsVersionsRef.current[k];
    for (const k of Object.keys(annotationsDiskRef.current)) if (!ids.has(k)) delete annotationsDiskRef.current[k];
    for (const k of Object.keys(annotationsPending.current)) if (!ids.has(k)) delete annotationsPending.current[k];
    for (const k of Object.keys(annotationsFlushing.current)) if (!ids.has(k)) delete annotationsFlushing.current[k];
    for (const k of Array.from(autoBriefedRef.current)) {
      const wsId = k.split(":")[0];
      if (!ids.has(wsId)) autoBriefedRef.current.delete(k);
    }
    for (const k of Array.from(summaryRequested.current)) {
      const wsId = k.split(":")[0];
      if (!ids.has(wsId)) summaryRequested.current.delete(k);
    }
  }, [workspaceKey]);
  const [groupAction, setGroupAction] = (0, import_react4.useState)(null);
  const [renameTarget, setRenameTarget] = (0, import_react4.useState)(null);
  const [resummarizingTitle, setResummarizingTitle] = (0, import_react4.useState)(false);
  const [resummarizingBrief, setResummarizingBrief] = (0, import_react4.useState)(false);
  const [confirmTarget, setConfirmTarget] = (0, import_react4.useState)(null);
  const [groupCollapsed, setGroupCollapsed] = (0, import_react4.useState)(() => {
    try {
      const raw = localStorage.getItem(GROUP_COLLAPSED_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
    } catch {
      return /* @__PURE__ */ new Set();
    }
  });
  const toggleGroup = (workspaceId, groupId) => {
    const key = `${workspaceId}:${groupId}`;
    setGroupCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const expandGroup = (workspaceId, groupId) => {
    const key = `${workspaceId}:${groupId}`;
    setGroupCollapsed((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };
  const handleNewChat = () => {
    const wsId = activeWorkspaceForNewChat();
    if (!wsId) {
      void Promise.resolve().then(() => props.startSession?.()).catch((e) => window.alert(`\u64CD\u4F5C\u5931\u8D25\uFF1A${e?.message ?? String(e)}`));
      return;
    }
    const gid = selectedGroupForWorkspace(wsId);
    if (gid !== DEFAULT_GROUP_ID) expandGroup(wsId, gid);
    void Promise.resolve().then(() => props.startSession?.(wsId)).catch((e) => window.alert(`\u64CD\u4F5C\u5931\u8D25\uFF1A${e?.message ?? String(e)}`));
  };
  const handleNewChatInGroup = (workspaceId, groupId) => {
    selectGroup(workspaceId, groupId);
    expandGroup(workspaceId, groupId);
    void Promise.resolve().then(() => props.startSession?.(workspaceId)).catch((e) => window.alert(`\u64CD\u4F5C\u5931\u8D25\uFF1A${e?.message ?? String(e)}`));
  };
  const collectSnapshot = () => ({
    workspaces: workspaces.map((w) => {
      const wsGroups = groupsDiskRef.current[w.workspaceId] ?? groupsForWorkspace(w.workspaceId);
      const ann = annotationsDiskRef.current[w.workspaceId] ?? annotationsForWorkspace(w.workspaceId);
      const visible = (w.sessionIds ?? []).filter((id) => !archived.includes(id));
      const groups = [
        {
          id: DEFAULT_GROUP_ID,
          name: wsGroups.defaultGroup.name,
          brief: ann.groups[DEFAULT_GROUP_ID]?.brief ?? "",
          sessionIds: visibleSessionsForGroup(wsGroups, DEFAULT_GROUP_ID, visible)
        },
        ...wsGroups.groups.map((g) => ({
          id: g.id,
          name: g.name,
          brief: ann.groups[g.id]?.brief ?? "",
          sessionIds: visibleSessionsForGroup(wsGroups, g.id, visible)
        }))
      ];
      return {
        id: w.workspaceId,
        title: w.title ?? w.path ?? w.workspaceId,
        brief: ann.workspaces[w.workspaceId]?.brief ?? "",
        defaultGroupName: wsGroups.defaultGroup.name,
        groups,
        sessions: visible.map((id) => {
          const s = sessions[id];
          return {
            id,
            title: ann.sessions[id]?.title || s?.title || id,
            brief: ann.sessions[id]?.brief ?? ""
          };
        })
      };
    })
  });
  const waitForGroupFlush = async (workspaceIds) => {
    for (let i = 0; i < 100; i++) {
      if (workspaceIds.every((id) => !flushing.current[id])) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const reloadGroupsAndAnnotations = async () => {
    await Promise.all(workspaces.map(async (w) => {
      const api = new Api(w.path);
      try {
        const [groups, annotations] = await Promise.all([
          loadGroups(api),
          loadAnnotations(api)
        ]);
        groupsVersionsRef.current[w.workspaceId] = groups.version;
        groupsDiskRef.current[w.workspaceId] = groups.data;
        setGroupsByWorkspace((m) => ({ ...m, [w.workspaceId]: groups.data }));
        setGroupsVersions((m) => ({ ...m, [w.workspaceId]: groups.version }));
        annotationsVersionsRef.current[w.workspaceId] = annotations.version;
        annotationsDiskRef.current[w.workspaceId] = annotations.data;
        setAnnotationsByWorkspace((m) => ({ ...m, [w.workspaceId]: annotations.data }));
        setAnnotationsVersions((m) => ({ ...m, [w.workspaceId]: annotations.version }));
        setGroupsErrors((m) => {
          const next = { ...m };
          delete next[w.workspaceId];
          return next;
        });
        setAnnotationsErrors((m) => {
          const next = { ...m };
          delete next[w.workspaceId];
          return next;
        });
      } catch {
      }
    }));
  };
  const collectSummarizeTargets = () => {
    const sessionToWs = /* @__PURE__ */ new Map();
    const sessions2 = [];
    for (const w of workspaces) {
      const ann = annotationsDiskRef.current[w.workspaceId] ?? annotationsForWorkspace(w.workspaceId);
      const visible = (w.sessionIds ?? []).filter((id) => !archived.includes(id));
      for (const id of visible) {
        if (sessionToWs.has(id)) continue;
        sessionToWs.set(id, w.workspaceId);
        sessions2.push({ id, marker: ann.sessions[id]?.marker ?? null });
      }
    }
    return { sessionToWs, sessions: sessions2 };
  };
  const refreshOrganizerStatus = async () => {
    setLoadingInfo(true);
    try {
      const { sessions: sessions2 } = collectSummarizeTargets();
      const res = await new Api("").organizerStatus(sessions2.map((s) => ({ id: s.id })));
      if (!res.ok) return;
      setAgentInfo(res.data.agent);
      setAgentUsage(res.data.usage ?? null);
      const markerById = new Map(res.data.sessions.map((s) => [s.id, s.marker]));
      let changed = 0;
      for (const s of sessions2) {
        const current2 = markerById.get(s.id) ?? null;
        if (current2 === null || s.marker == null || s.marker !== current2) changed += 1;
      }
      setChangedCount(changed);
    } catch {
    } finally {
      setLoadingInfo(false);
    }
  };
  const applySessionUpdate = (wsId, u) => {
    if (u.brief) updateAnnotations(wsId, (d) => setSessionBrief(d, u.sessionId, void 0, u.brief));
    if (u.title) {
      props.renameSession?.(u.sessionId, u.title);
      const briefNow = u.brief ?? annotationsForWorkspace(wsId).sessions[u.sessionId]?.brief ?? "";
      updateAnnotations(wsId, (d) => setSessionBrief(d, u.sessionId, u.title, briefNow));
    }
    if (u.marker) updateAnnotations(wsId, (d) => setSessionMarker(d, u.sessionId, u.marker));
  };
  const handleUpdateChanged = async () => {
    setUpdateRunning(true);
    setUpdateError(null);
    setUpdateProgress(null);
    const CHUNK = 6;
    try {
      const { sessionToWs, sessions: sessions2 } = collectSummarizeTargets();
      if (sessions2.length === 0) {
        setUpdateError("\u6CA1\u6709\u53EF\u89C1\u4F1A\u8BDD\u53EF\u66F4\u65B0\u3002");
        return;
      }
      const status = await new Api("").organizerStatus(sessions2.map((s) => ({ id: s.id })));
      if (!status.ok) {
        setUpdateError(`\u65E0\u6CD5\u83B7\u53D6\u4F1A\u8BDD\u72B6\u6001\uFF1A${status.message}`);
        return;
      }
      setAgentInfo(status.data.agent);
      setAgentUsage(status.data.usage ?? null);
      const markerById = new Map(status.data.sessions.map((s) => [s.id, s.marker]));
      let changed = 0;
      const targets = sessions2.filter((s) => {
        const current2 = markerById.get(s.id) ?? null;
        const isChanged = current2 === null || s.marker == null || s.marker !== current2;
        if (isChanged) changed += 1;
        return isChanged;
      });
      setChangedCount(changed);
      if (targets.length === 0) {
        setUpdateSummary({ checked: sessions2.length, updated: 0, unchanged: sessions2.length, skipped: 0, agent: 0, local: 0, elapsedMs: 0 });
        setUpdateDetails([]);
        return;
      }
      const details = [];
      const totals = { checked: 0, updated: 0, unchanged: 0, skipped: 0, agent: 0, local: 0 };
      const startedAt = Date.now();
      for (let i = 0; i < targets.length; i += CHUNK) {
        const chunk = targets.slice(i, i + CHUNK);
        setUpdateProgress({ done: i, total: targets.length });
        const res = await new Api("").resummarizeAll(chunk);
        if (!res.ok) {
          setUpdateError(`\u66F4\u65B0\u4E2D\u65AD\uFF08\u5DF2\u5B8C\u6210 ${i} / ${targets.length}\uFF09\uFF1A${res.message}`);
          break;
        }
        for (const u of res.data.updates ?? []) {
          const wsId = sessionToWs.get(u.sessionId);
          if (!wsId) continue;
          if (u.skipped || u.unchanged) {
            if (u.marker) updateAnnotations(wsId, (d) => setSessionMarker(d, u.sessionId, u.marker));
            continue;
          }
          applySessionUpdate(wsId, u);
          details.push({ sessionId: u.sessionId, title: u.title, brief: u.brief });
        }
        const s = res.data.summary;
        if (s) {
          totals.checked += s.checked;
          totals.updated += s.updated;
          totals.unchanged += s.unchanged;
          totals.skipped += s.skipped;
          totals.agent += s.agent;
          totals.local += s.local;
        }
        if (res.data.agent) setAgentInfo(res.data.agent);
        setUpdateDetails([...details]);
        setUpdateProgress({ done: Math.min(i + CHUNK, targets.length), total: targets.length });
        await awaitAnnotationsFlushed();
        await reseedMarkers(sessionToWs, (res.data.updates ?? []).map((u) => u.sessionId));
      }
      setUpdateSummary({ ...totals, elapsedMs: Date.now() - startedAt });
      await reseedMarkers(sessionToWs, details.map((d) => d.sessionId));
      await reloadGroupsAndAnnotations();
      await refreshOrganizerStatus();
      console.log("[dsh-myagent] \u533A\u7BA1\u5BB6\u4E00\u952E\u66F4\u65B0\u5B8C\u6210", totals);
    } catch (e) {
      setUpdateError(`\u66F4\u65B0\u5931\u8D25\uFF1A${e?.message ?? String(e)}`);
    } finally {
      setUpdateProgress(null);
      setUpdateRunning(false);
    }
  };
  const reseedMarkers = async (sessionToWs, ids) => {
    if (ids.length === 0) return;
    try {
      await new Promise((resolve) => setTimeout(resolve, 700));
      const fresh = await new Api("").organizerStatus(ids.map((id) => ({ id })));
      if (!fresh.ok) return;
      const freshById = new Map(fresh.data.sessions.map((s) => [s.id, s.marker]));
      for (const id of ids) {
        const wsId = sessionToWs.get(id);
        const m = freshById.get(id);
        if (wsId && m) updateAnnotations(wsId, (d) => setSessionMarker(d, id, m));
      }
      await awaitAnnotationsFlushed();
    } catch {
    }
  };
  const handleOrganizeGroups = async () => {
    setOrganizing(true);
    setOrganizeError(null);
    try {
      await reloadGroupsAndAnnotations();
      const snapshot = collectSnapshot();
      const res = await new Api("").organizePlan(snapshot);
      if (!res.ok) throw new Error(`\u6A21\u578B\u672A\u7ED9\u51FA\u6574\u7406\u5EFA\u8BAE\uFF1A${res.message || res.code || res.status}`);
      if (!res.data?.plan) throw new Error("\u6A21\u578B\u672A\u8FD4\u56DE\u6574\u7406\u5EFA\u8BAE");
      const plan = normalizeOrganizePlan(res.data.plan);
      const actions = plan.actions;
      const summary = {
        created: actions.filter((a) => a.kind === "createGroup").length,
        moved: actions.filter((a) => a.kind === "moveSession").length,
        renamed: actions.filter((a) => a.kind === "renameGroup" || a.kind === "mergeGroup").length,
        deleted: actions.filter((a) => a.kind === "deleteGroup").length,
        updated: actions.filter((a) => a.kind === "updateBrief").length
      };
      setOrganizeDetails(
        diffOrganize(snapshot, plan).map((item) => ({ key: item.id, primary: item.title, secondary: item.description }))
      );
      if (actions.length === 0) {
        setOrganizeSummary({ created: 0, moved: 0, renamed: 0, deleted: 0, updated: 0 });
        return;
      }
      organizeUndoRef.current = workspaces.map((w) => ({
        workspaceId: w.workspaceId,
        groups: groupsDiskRef.current[w.workspaceId] ?? groupsForWorkspace(w.workspaceId),
        annotations: annotationsDiskRef.current[w.workspaceId] ?? annotationsForWorkspace(w.workspaceId)
      }));
      setCanUndoOrganize(true);
      await handleApplyOrganize(actions, { keepOpen: true, extraSummary: summary });
      await refreshOrganizerStatus();
    } catch (e) {
      void refreshOrganizerStatus();
      setOrganizeError(e instanceof Error ? e.message : String(e));
    } finally {
      setOrganizing(false);
    }
  };
  const handleUndoOrganize = async () => {
    const backup = organizeUndoRef.current;
    if (!backup || backup.length === 0) return;
    setOrganizing(true);
    try {
      for (const item of backup) {
        const api = apiForWorkspace(item.workspaceId);
        if (!api) continue;
        try {
          const savedGroups = await saveGroups(api, item.groups, groupsVersionsRef.current[item.workspaceId]);
          groupsVersionsRef.current[item.workspaceId] = savedGroups;
          groupsDiskRef.current[item.workspaceId] = item.groups;
        } catch (e) {
          setOrganizeError(`\u64A4\u9500\u5206\u7EC4\u5931\u8D25\uFF1A${describeApiError(e)}`);
        }
        try {
          const savedAnn = await saveAnnotations(api, item.annotations, annotationsVersionsRef.current[item.workspaceId]);
          annotationsVersionsRef.current[item.workspaceId] = savedAnn;
          annotationsDiskRef.current[item.workspaceId] = item.annotations;
        } catch (e) {
          setOrganizeError(`\u64A4\u9500\u6807\u6CE8\u5931\u8D25\uFF1A${describeApiError(e)}`);
        }
      }
      organizeUndoRef.current = null;
      setCanUndoOrganize(false);
      setOrganizeSummary(null);
      setOrganizeDetails([]);
      await reloadGroupsAndAnnotations();
    } finally {
      setOrganizing(false);
    }
  };
  const handleApplyOrganize = async (actions, options = {}) => {
    setOrganizeApplying(true);
    try {
      const groupMutations = {};
      const hostMoves = [];
      const affected = /* @__PURE__ */ new Set();
      for (const action of actions) {
        if (!action.workspaceId) continue;
        affected.add(action.workspaceId);
        if (isGroupAction(action)) {
          (groupMutations[action.workspaceId] ??= []).push((d) => applyOrganizeActionToGroups(d, action));
          if (action.kind === "moveSession" && action.toGroupId !== DEFAULT_GROUP_ID) {
            hostMoves.push({ workspaceId: action.workspaceId, sessionId: action.sessionId });
          }
        }
      }
      for (const [workspaceId, muts] of Object.entries(groupMutations)) {
        const moves = hostMoves.filter((m) => m.workspaceId === workspaceId);
        enqueueGroupSave(workspaceId, (d) => replayMutations(d, muts), () => {
          for (const m of moves) run(() => props.insertSessionBefore?.(m.workspaceId, m.sessionId, void 0));
        });
      }
      for (const workspaceId of affected) {
        const planForWs = actions.filter((a) => a.workspaceId === workspaceId);
        updateAnnotations(workspaceId, (d) => {
          let next = applyOrganizeActionsToAnnotations(d, planForWs);
          next = setLastPlan(next, { actions: planForWs });
          next = setLastOrganizedAt(next, (/* @__PURE__ */ new Date()).toISOString());
          return next;
        });
      }
      await waitForGroupFlush([...affected]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await reloadGroupsAndAnnotations();
      if (options.extraSummary) setOrganizeSummary(options.extraSummary);
    } finally {
      setOrganizeApplying(false);
      if (!options.keepOpen) setOrganizeOpen(false);
    }
  };
  import_react4.default.useEffect(() => {
    try {
      localStorage.setItem(GROUP_COLLAPSED_KEY, JSON.stringify([...groupCollapsed]));
    } catch {
    }
  }, [groupCollapsed]);
  const dropCommitted = (0, import_react4.useRef)(false);
  const run = (action) => {
    Promise.resolve().then(() => action?.()).catch((e) => window.alert(`\u64CD\u4F5C\u5931\u8D25\uFF1A${e?.message ?? String(e)}`));
  };
  const moveSessionAndSave = (workspaceId, sessionId, groupId) => {
    const data = groupsForWorkspace(workspaceId);
    const currentGroup = groupOfSession(data, sessionId);
    if (currentGroup === groupId) return false;
    return enqueueGroupSave(workspaceId, (data2) => moveSessionToGroup(data2, sessionId, groupId), () => {
      if (groupId !== DEFAULT_GROUP_ID) {
        run(() => props.insertSessionBefore?.(workspaceId, sessionId, void 0));
      }
    });
  };
  const reorderSessionInSameGroup = (workspaceId, sessionId, groupId, beforeId) => {
    if (groupId === DEFAULT_GROUP_ID) {
      run(() => props.insertSessionBefore?.(workspaceId, sessionId, beforeId));
      return;
    }
    enqueueGroupSave(workspaceId, (d) => reorderSessionInGroup(d, groupId, sessionId, beforeId), () => {
      run(() => props.insertSessionBefore?.(workspaceId, sessionId, beforeId));
    });
  };
  const handleResummarizeSession = async (mode2) => {
    if (!renameTarget || renameTarget.kind !== "session") return;
    const sessionId = renameTarget.id;
    const workspaceId = renameTarget.workspaceId;
    if (mode2 === "title") setResummarizingTitle(true);
    else setResummarizingBrief(true);
    try {
      const res = await new Api("").sessionResummarize(sessionId, mode2);
      if (res.ok) {
        const data = res.data;
        if (data.brief) {
          const titleForBrief = data.title ?? renameTarget.title;
          updateAnnotations(workspaceId, (d) => setSessionBrief(d, sessionId, titleForBrief, data.brief));
          setRenameTarget((prev) => prev ? { ...prev, brief: data.brief } : prev);
        }
        if (data.title) {
          props.renameSession?.(sessionId, data.title);
          updateAnnotations(workspaceId, (d) => setSessionBrief(d, sessionId, data.title, data.brief ?? renameTarget.brief ?? ""));
          setRenameTarget((prev) => prev ? { ...prev, title: data.title } : prev);
        }
        void refreshOrganizerStatus();
      } else {
        window.alert(`\u91CD\u65B0\u603B\u7ED3\u5931\u8D25\uFF1A${res.message}`);
      }
    } catch (e) {
      window.alert(`\u91CD\u65B0\u603B\u7ED3\u5931\u8D25\uFF1A${e?.message ?? String(e)}`);
    } finally {
      if (mode2 === "title") setResummarizingTitle(false);
      else setResummarizingBrief(false);
    }
  };
  const setCollapsedIds = (next) => {
    setCollapsed(next);
    writeCollapsed(next);
  };
  const expand = (workspaceId) => {
    if (!collapsed.has(workspaceId)) return;
    const next = new Set(collapsed);
    next.delete(workspaceId);
    setCollapsedIds(next);
  };
  const collapse = (workspaceId) => {
    if (collapsed.has(workspaceId)) return;
    const next = new Set(collapsed);
    next.add(workspaceId);
    setCollapsedIds(next);
  };
  const scrollRef = (0, import_react4.useRef)(null);
  import_react4.default.useEffect(() => {
    const id = props.revealWorkspaceId;
    if (id === null || id === void 0) return;
    expand(id);
    const nodes = scrollRef.current?.querySelectorAll("[data-workspace-id]");
    const el = nodes === void 0 ? void 0 : Array.from(nodes).find((n2) => n2.getAttribute("data-workspace-id") === id);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    props.onRevealed?.();
  }, [props.revealWorkspaceId]);
  const commitDrag = (active) => {
    if (active.kind === "group") {
      setDrag(null);
      dropCommitted.current = false;
      return;
    }
    if (dropCommitted.current) return;
    dropCommitted.current = true;
    const visibleSessionIds = (w2) => (w2.sessionIds ?? []).filter((id) => !archived.includes(id));
    if (active.kind === "workspace") {
      const ids2 = workspaces.map((w2) => w2.workspaceId);
      const targetIndex2 = ids2.indexOf(active.over?.id ?? "");
      if (targetIndex2 === -1) return;
      const anchor2 = active.over.half === "before" ? active.over.id : ids2[targetIndex2 + 1];
      if (anchor2 === active.id) return;
      const sourceIndex2 = ids2.indexOf(active.id);
      const anchorIndex2 = anchor2 === void 0 ? ids2.length : ids2.indexOf(anchor2);
      if (sourceIndex2 !== -1 && (anchorIndex2 === sourceIndex2 || anchorIndex2 === sourceIndex2 + 1)) return;
      run(() => props.insertWorkspaceBefore?.(active.id, anchor2));
      return;
    }
    const w = workspaces.find((x) => x.workspaceId === active.workspaceId);
    if (w === void 0) return;
    const ids = visibleSessionIds(w);
    const targetIndex = ids.indexOf(active.over?.id ?? "");
    if (targetIndex === -1) return;
    const anchor = active.over.half === "before" ? active.over.id : ids[targetIndex + 1];
    if (anchor === active.id) return;
    const sourceIndex = ids.indexOf(active.id);
    const anchorIndex = anchor === void 0 ? ids.length : ids.indexOf(anchor);
    if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return;
    run(() => props.insertSessionBefore?.(active.workspaceId, active.id, anchor));
  };
  const endDrag = (active) => {
    if (active.over !== null) commitDrag(active);
    setDrag(null);
    dropCommitted.current = false;
  };
  import_react4.default.useEffect(() => {
    if (drag === null) return;
    const acceptDrag = (e) => {
      e.preventDefault();
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = "move";
    };
    const acceptDrop = (e) => {
      e.preventDefault();
    };
    document.addEventListener("dragover", acceptDrag);
    document.addEventListener("drop", acceptDrop);
    return () => {
      document.removeEventListener("dragover", acceptDrag);
      document.removeEventListener("drop", acceptDrop);
    };
  }, [drag !== null]);
  if (workspaces.length === 0) {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { fontSize: FONT_SECONDARY, padding: 8, color: "var(--dsw-alias-label-secondary)" }, children: "\u6682\u65E0\u5DE5\u4F5C\u533A\uFF08\u8BF7\u5728\u5BBF\u4E3B\u4FA7\u6DFB\u52A0\uFF09" });
  }
  const statusDot = (id, s) => {
    const dot = {
      width: 8,
      height: 8,
      borderRadius: "50%",
      boxSizing: "border-box",
      display: "inline-block",
      flex: "none"
    };
    if (s === void 0) return null;
    if (s.pendingInteraction !== void 0) {
      const label = s.pendingInteraction === "approval" ? "\u7B49\u5F85\u6279\u51C6" : s.pendingInteraction === "plan-review" ? "\u7B49\u5F85\u8BA1\u5212\u786E\u8BA4" : "\u7B49\u5F85\u56DE\u7B54";
      const color = s.pendingInteraction === "question" ? "#FACC15" : "var(--dsw-alias-state-warn-primary)";
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { ...dot, background: color }, title: label });
    }
    if (s.running) {
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "fm-wb-dot-running", style: { ...dot, background: "var(--dsw-alias-state-business-primary)" }, title: "\u6B63\u5728\u8FD0\u884C" });
    }
    if (s.completed) {
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { ...dot, background: "var(--dsw-alias-state-success-primary)" }, title: "\u5DF2\u5B8C\u6210" });
    }
    if (s.blank) {
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { ...dot, border: "1px solid var(--dsw-alias-label-tertiary)" }, title: "\u65B0\u4F1A\u8BDD" });
    }
    if (id === current) {
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { ...dot, background: "var(--dsw-alias-state-business-primary)" }, title: "\u5F53\u524D\u4F1A\u8BDD" });
    }
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { ...dot, background: "var(--dsw-alias-label-tertiary)" }, title: "\u7A7A\u95F2" });
  };
  const renderGroupSection = (arg) => {
    const wsGroups = groupsForWorkspace(arg.workspaceId);
    const isCollapsedGroup = groupCollapsed.has(`${arg.workspaceId}:${arg.groupId}`);
    const isSessionDropTarget = sessionDrag !== null && sessionDrag.workspaceId === arg.workspaceId && sessionDrag.groupId !== arg.groupId && dropGroupId === arg.groupId;
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
      "div",
      {
        "data-group-id": arg.groupId,
        className: "fm-wb-grp",
        onPointerMove: updateSessionLongPress,
        onPointerUp: endSessionLongPress,
        onPointerCancel: endSessionLongPress,
        style: {
          position: "relative",
          ...drag?.kind === "group" && drag.over?.id === arg.groupId ? { outline: "1px solid var(--dsw-alias-state-business-primary)" } : {}
        },
        onDragOver: (e) => {
          if (drag?.kind !== "group" || drag.workspaceId !== arg.workspaceId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDrag((d) => d && d.kind === "group" ? { ...d, over: { id: arg.groupId, half: "before" } } : d);
        },
        onDrop: (e) => {
          if (drag?.kind !== "group" || drag.workspaceId !== arg.workspaceId) return;
          e.preventDefault();
          const fromId = drag.id;
          const toId = arg.groupId;
          if (fromId === toId) return;
          enqueueGroupSave(arg.workspaceId, (data) => reorderGroups(data, fromId, toId));
          setDrag(null);
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            GroupHeader,
            {
              draggable: arg.groupId !== DEFAULT_GROUP_ID,
              onDragStart: (e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", arg.groupId);
                setDrag({ kind: "group", id: arg.groupId, workspaceId: arg.workspaceId, over: null });
              },
              onDragEnd: () => {
                if (drag?.kind === "group" && drag.id === arg.groupId) endDrag(drag);
              },
              name: arg.name,
              count: arg.sessions.length,
              collapsed: isCollapsedGroup,
              selected: selectedGroupForWorkspace(arg.workspaceId) === arg.groupId,
              onToggle: () => {
                selectGroup(arg.workspaceId, arg.groupId);
                toggleGroup(arg.workspaceId, arg.groupId);
              },
              onRename: () => setGroupAction({ kind: "rename", workspaceId: arg.workspaceId, groupId: arg.groupId, name: arg.name, brief: annotationsForWorkspace(arg.workspaceId).groups[arg.groupId]?.brief ?? "" }),
              onDelete: arg.groupId === DEFAULT_GROUP_ID ? void 0 : () => setGroupAction({ kind: "delete", workspaceId: arg.workspaceId, groupId: arg.groupId, name: arg.name }),
              onNewChat: () => handleNewChatInGroup(arg.workspaceId, arg.groupId),
              highlight: isSessionDropTarget,
              onSessionDragOver: (e) => {
                if (drag?.kind !== "session" || drag.workspaceId !== arg.workspaceId || drag.groupId === arg.groupId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDrag((d) => d && d.kind === "session" ? { ...d, over: { id: arg.groupId, half: "before" } } : d);
              },
              onSessionDrop: (e) => {
                if (drag?.kind !== "session" || drag.workspaceId !== arg.workspaceId || drag.groupId === arg.groupId) return;
                e.preventDefault();
                dropCommitted.current = true;
                moveSessionAndSave(arg.workspaceId, drag.id, arg.groupId);
                setDrag(null);
              }
            }
          ),
          !isCollapsedGroup ? arg.sessions.map((id) => {
            const s = sessions[id];
            const rec = annotationsForWorkspace(arg.workspaceId).sessions[id];
            const label = rec?.title || s?.title || (s?.blank ? "\u65B0\u4F1A\u8BDD" : id);
            const isDragging = sessionDrag?.sessionId === id;
            const isDropTarget = dropSessionId === id;
            const dropLine = isDropTarget && dropSessionHalf ? dropSessionHalf === "before" ? "top" : "bottom" : null;
            return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
              "div",
              {
                role: "treeitem",
                "data-session-id": id,
                "aria-selected": id === current,
                className: "fm-wb-row",
                onPointerDown: (e) => startSessionLongPress(e, arg.workspaceId, id),
                style: {
                  padding: "3px 8px 3px 34px",
                  // 行高显式钉住：20px 紧凑按钮撑不到 34px，不钉就会塌掉。
                  // box-sizing:border-box 见工作区行同款注释（否则 minHeight 不含 padding）。
                  boxSizing: "border-box",
                  minHeight: ROW_MIN_HEIGHT.session,
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  position: "relative",
                  background: id === current ? "var(--dsw-alias-interactive-bg-hover)" : void 0,
                  borderRadius: RADIUS.navRow,
                  ...isDragging ? {
                    opacity: 0.55,
                    transform: "scale(1.02)",
                    boxShadow: "0 2px 10px rgba(0,0,0,.18)",
                    willChange: "transform, opacity",
                    transition: "opacity .25s ease, transform .25s ease, box-shadow .25s ease"
                  } : { transition: "opacity .25s ease" }
                },
                onClick: () => {
                  selectGroup(arg.workspaceId, groupOfSession(groupsForWorkspace(arg.workspaceId), id));
                  props.open?.(id);
                },
                children: [
                  dropLine ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: {
                    position: "absolute",
                    left: 8,
                    right: 8,
                    height: 2,
                    borderRadius: RADIUS.pill,
                    background: "var(--dsw-alias-state-business-primary)",
                    pointerEvents: "none",
                    zIndex: 1,
                    ...dropLine === "top" ? { top: -2 } : { bottom: -2 },
                    transition: "top .15s ease, bottom .15s ease, opacity .15s ease"
                  } }) : null,
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { flex: "none", width: 16, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-tertiary)" }, children: statusDot(id, s) }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }, children: label }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "fm-wb-row-actions", style: { display: "inline-flex", gap: ROW_ACTION_GAP, flex: "none" }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconListPenOutline16, { size: 16 }), style: ROW_ACTION_BUTTON_STYLE, title: "\u91CD\u547D\u540D\u4F1A\u8BDD", "aria-label": "\u91CD\u547D\u540D\u4F1A\u8BDD", onClick: (e) => {
                      e.stopPropagation();
                      setRenameTarget({ kind: "session", id, title: label, brief: annotationsForWorkspace(arg.workspaceId).sessions[id]?.brief ?? "", workspaceId: arg.workspaceId });
                    } }),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconArchiveOutline20, { size: 16 }), style: ROW_ACTION_BUTTON_STYLE, title: "\u5F52\u6863\u4F1A\u8BDD", "aria-label": "\u5F52\u6863\u4F1A\u8BDD", onClick: (e) => {
                      e.stopPropagation();
                      setConfirmTarget({ kind: "session", id, title: label });
                    } })
                  ] })
                ]
              },
              id
            );
          }) : null
        ]
      },
      arg.groupId
    );
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { fontSize: FONT_SECONDARY, lineHeight: 1.5, userSelect: "none", color: "var(--dsw-alias-label-primary)", height: "100%", display: "flex", flexDirection: "column" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("style", { children: BROWSER_CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { flex: "none", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 34px 4px 4px", background: "var(--dsw-specific-sidebar-fill)", borderBottom: HEADER_BORDER }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconFolderOpen16, { size: 16 }),
        "\u5DE5\u4F5C\u533A"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          import_dsh_client_ui_primitives3.Button,
          {
            className: "fm-tb-btn",
            style: { ...ICON_BTN_STYLE, animationDelay: "0ms" },
            size: "sm",
            variant: "ghost",
            icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(TopHatIcon, { size: 16 }),
            title: "\u533A\u7BA1\u5BB6",
            "aria-label": "\u533A\u7BA1\u5BB6",
            onClick: () => {
              setOrganizeOpen(true);
              void refreshOrganizerStatus();
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          import_dsh_client_ui_primitives3.Button,
          {
            className: "fm-tb-btn",
            style: { ...ICON_BTN_STYLE, animationDelay: "40ms" },
            size: "sm",
            variant: "ghost",
            icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconNewChatOutline16, { size: 16 }),
            title: "\u65B0\u5BF9\u8BDD\uFF08\u5F53\u524D\u9009\u4E2D\u5206\u7EC4\uFF09",
            "aria-label": "\u65B0\u5BF9\u8BDD\uFF08\u5F53\u524D\u9009\u4E2D\u5206\u7EC4\uFF09",
            "data-myagent-new-chat": true,
            onClick: () => handleNewChat()
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { className: "fm-tb-btn", style: { ...ICON_BTN_STYLE, animationDelay: "80ms" }, size: "sm", variant: "ghost", icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconProjectAddOutline16, { size: 16 }), title: "\u65B0\u5DE5\u4F5C\u533A", "aria-label": "\u65B0\u5DE5\u4F5C\u533A", onClick: () => run(() => props.addWorkspace?.()) })
      ] }, props.toolbarKey ?? 0)
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "div",
      {
        ref: scrollRef,
        className: "fm-scroll",
        role: "tree",
        "aria-label": "\u5DE5\u4F5C\u533A\u4E0E\u4F1A\u8BDD",
        style: { flex: 1, minHeight: 0, overflowY: props.scrollLock ? "hidden" : "auto", overflowX: "hidden", scrollbarGutter: "stable" },
        children: organizeOpen ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          OrganizePanel,
          {
            onClose: () => setOrganizeOpen(false),
            onUpdateAll: handleUpdateChanged,
            updating: updateRunning,
            updateProgress,
            updateSummary,
            updateDetails,
            updateError,
            onOrganizeGroups: handleOrganizeGroups,
            organizing: organizing || organizeApplying,
            organizeSummary,
            organizeDetails,
            organizeError,
            onUndoOrganize: handleUndoOrganize,
            canUndoOrganize,
            agent: agentInfo,
            usage: agentUsage,
            changedCount,
            loadingInfo
          }
        ) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
          workspaces[0] && groupsErrors[workspaces[0].workspaceId] ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { padding: "4px 8px", fontSize: 12, color: "var(--dsw-alias-state-error-primary)" }, children: [
            "\u5206\u7EC4\u52A0\u8F7D\u5931\u8D25\uFF1A",
            groupsErrors[workspaces[0].workspaceId]
          ] }) : null,
          workspaces.map((w, i) => {
            const isCollapsed = collapsed.has(w.workspaceId);
            const visible = (w.sessionIds ?? []).filter((id) => !archived.includes(id));
            const wsGroups = groupsForWorkspace(w.workspaceId);
            const wsMarker = drag?.kind === "workspace" && drag.over?.id === w.workspaceId ? drag.over.half : null;
            return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
              "div",
              {
                role: "group",
                "data-workspace-id": w.workspaceId,
                style: {
                  position: "relative",
                  marginBottom: 6,
                  // 工作区之间加灰色分割线；子聊天框（会话行）不加。
                  ...i > 0 ? { borderTop: "1px solid var(--dsw-alias-border-l2)" } : {}
                },
                className: wsMarker === "before" ? "fm-wb-drop-before" : wsMarker === "after" ? "fm-wb-drop-after" : void 0,
                onDragOver: drag?.kind === "workspace" ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const half = rowHalf(e);
                  setDrag((d) => d === null || d.kind !== "workspace" ? d : { ...d, over: { id: w.workspaceId, half } });
                } : void 0,
                onDrop: drag?.kind === "workspace" ? (e) => {
                  e.preventDefault();
                  const half = rowHalf(e);
                  setDrag((d) => d === null ? d : { ...d, over: { id: w.workspaceId, half } });
                  commitDrag({ ...drag, over: { id: w.workspaceId, half } });
                } : void 0,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
                    "div",
                    {
                      role: "treeitem",
                      "aria-expanded": !isCollapsed,
                      className: "fm-wb-row fm-wb-ws-row",
                      draggable: true,
                      title: w.path ?? w.workspaceId,
                      style: {
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 8px",
                        // 行高显式钉住：20px 紧凑按钮撑不到 40px，不钉就会塌掉。
                        // 必须配 box-sizing:border-box —— min-height 默认只作用于 content box，
                        // 否则行高会变成 minHeight + 2×padding（实测 52 而不是 40）。
                        boxSizing: "border-box",
                        minHeight: ROW_MIN_HEIGHT.workspace,
                        borderRadius: RADIUS.navRow,
                        cursor: "pointer",
                        fontWeight: 600
                      },
                      onClick: () => {
                        if (typeof w.path === "string" && w.path !== "") setActiveRoot(w.path);
                        if (isCollapsed) expand(w.workspaceId);
                        else collapse(w.workspaceId);
                      },
                      onDragStart: (e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", w.workspaceId);
                        dropCommitted.current = false;
                        setDrag({ kind: "workspace", id: w.workspaceId, over: null });
                      },
                      onDragEnd: () => {
                        if (drag?.kind === "workspace" && drag.id === w.workspaceId) endDrag(drag);
                      },
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "fm-wb-ws-folder", style: { flex: "none", width: 16, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-secondary)" }, children: isCollapsed ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconFolderClose16, { size: 16 }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconFolderOpen16, { size: 16 }) }),
                        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "fm-wb-ws-chevron", style: { flex: "none", width: 16, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-caption)" }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconTriangleRightFill14, { size: 14, className: `fm-wb-arrow${isCollapsed ? "" : " fm-wb-arrow-open"}` }) }),
                        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }, children: w.title ?? w.path }),
                        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "fm-wb-row-actions", style: { display: "inline-flex", gap: ROW_ACTION_GAP, flex: "none" }, children: [
                          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                            import_dsh_client_ui_primitives3.Button,
                            {
                              size: "sm",
                              variant: "ghost",
                              icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconPlusOutline16, { size: 16 }),
                              style: ROW_ACTION_BUTTON_STYLE,
                              title: "\u65B0\u5EFA\u5206\u7EC4",
                              "aria-label": "\u65B0\u5EFA\u5206\u7EC4",
                              onClick: (e) => {
                                e.stopPropagation();
                                setGroupAction({ kind: "create", workspaceId: w.workspaceId });
                              }
                            }
                          ),
                          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconEditOutline16, { size: 16 }), style: ROW_ACTION_BUTTON_STYLE, title: "\u91CD\u547D\u540D\u5DE5\u4F5C\u533A", "aria-label": "\u91CD\u547D\u540D\u5DE5\u4F5C\u533A", onClick: (e) => {
                            e.stopPropagation();
                            setRenameTarget({ kind: "workspace", id: w.workspaceId, title: w.title ?? w.path, brief: annotationsForWorkspace(w.workspaceId).workspaces[w.workspaceId]?.brief ?? "", workspaceId: w.workspaceId });
                          } }),
                          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconTrashOutline16, { size: 16 }), style: { ...ROW_ACTION_BUTTON_STYLE, color: "var(--dsw-alias-state-error-primary)" }, title: "\u5220\u9664\u5DE5\u4F5C\u533A", "aria-label": "\u5220\u9664\u5DE5\u4F5C\u533A", onClick: (e) => {
                            e.stopPropagation();
                            setConfirmTarget({ kind: "workspace", id: w.workspaceId, title: w.title ?? w.path });
                          } })
                        ] })
                      ]
                    }
                  ),
                  !isCollapsed ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
                    renderGroupSection({
                      workspaceId: w.workspaceId,
                      groupId: DEFAULT_GROUP_ID,
                      name: wsGroups.defaultGroup.name,
                      sessions: visibleSessionsForGroup(wsGroups, DEFAULT_GROUP_ID, visible)
                    }),
                    wsGroups.groups.map(
                      (g) => renderGroupSection({
                        workspaceId: w.workspaceId,
                        groupId: g.id,
                        name: g.name,
                        sessions: visibleSessionsForGroup(wsGroups, g.id, visible)
                      })
                    )
                  ] }) : null
                ]
              },
              w.workspaceId
            );
          })
        ] })
      }
    ),
    renameTarget ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      PromptModal,
      {
        open: true,
        title: renameTarget.kind === "workspace" ? "\u91CD\u547D\u540D\u5DE5\u4F5C\u533A" : "\u91CD\u547D\u540D\u4F1A\u8BDD",
        initialValue: renameTarget.title,
        placeholder: renameTarget.kind === "workspace" ? "\u5DE5\u4F5C\u533A\u540D\u79F0" : "\u4F1A\u8BDD\u6807\u9898",
        validate: (v) => validateNameInput("name", v),
        brief: renameTarget.brief ?? "",
        ...renameTarget.kind === "session" ? {
          onResummarizeTitle: () => handleResummarizeSession("title"),
          onResummarizeBrief: () => handleResummarizeSession("brief"),
          resummarizingTitle,
          resummarizingBrief
        } : {},
        onSubmit: (t) => {
          const target = renameTarget;
          run(() => {
            if (target.kind === "session") {
              props.renameSession?.(target.id, t);
              updateAnnotations(target.workspaceId, (d) => setSessionBrief(d, target.id, t, annotationsForWorkspace(target.workspaceId).sessions[target.id]?.brief ?? ""));
            } else {
              props.renameWorkspace?.(target.id, t);
            }
          });
          setRenameTarget(null);
        },
        onClose: () => setRenameTarget(null)
      }
    ) : null,
    groupAction?.kind === "create" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      PromptModal,
      {
        open: true,
        title: "\u65B0\u5EFA\u5206\u7EC4",
        description: "\u8F93\u5165\u5206\u7EC4\u540D\u79F0\uFF0C\u4F8B\u5982\uFF1A\u5DE5\u4F5C\u3001\u9879\u76EEA",
        placeholder: "\u5206\u7EC4\u540D\u79F0",
        initialValue: "",
        validate: (v) => validateNameInput("name", v),
        onSubmit: (name) => {
          const newGroup = createGroup(emptyGroups(), name).groups[0];
          enqueueGroupSave(groupAction.workspaceId, (data) => addGroup(data, newGroup));
          setGroupAction(null);
        },
        onClose: () => setGroupAction(null)
      }
    ) : null,
    groupAction?.kind === "rename" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      PromptModal,
      {
        open: true,
        title: "\u91CD\u547D\u540D\u5206\u7EC4",
        description: "\u8F93\u5165\u65B0\u7684\u5206\u7EC4\u540D\u79F0",
        placeholder: "\u5206\u7EC4\u540D\u79F0",
        initialValue: groupAction.name,
        validate: (v) => validateNameInput("name", v),
        brief: groupAction.brief ?? "",
        onSubmit: (name) => {
          enqueueGroupSave(groupAction.workspaceId, (data) => renameGroup(data, groupAction.groupId, name));
          setGroupAction(null);
        },
        onClose: () => setGroupAction(null)
      }
    ) : null,
    groupAction?.kind === "delete" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      GroupDeleteDialog,
      {
        groupName: groupAction.name,
        destinationOptions: groupsForWorkspace(groupAction.workspaceId).groups.filter((g) => g.id !== groupAction.groupId).map((g) => ({ id: g.id, name: g.name })),
        onCancel: () => setGroupAction(null),
        onConfirm: (dest) => {
          const workspaceId = groupAction.workspaceId;
          let sessionsToArchive = [];
          enqueueGroupSave(workspaceId, (data) => {
            const res = deleteGroup(data, groupAction.groupId, dest);
            sessionsToArchive = res.sessionsToArchive;
            return res.data;
          }, () => {
            for (const id of sessionsToArchive) {
              Promise.resolve().then(() => props.archiveSession?.(id)).catch((err) => {
                window.alert(`\u5206\u7EC4\u5DF2\u5220\u9664\uFF0C\u4F46\u4F1A\u8BDD ${id} \u5F52\u6863\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u5904\u7406\uFF1A${describeApiError(err)}`);
              });
            }
          });
          setGroupAction(null);
        }
      }
    ) : null,
    confirmTarget ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      ConfirmModal,
      {
        open: true,
        title: confirmTarget.kind === "workspace" ? `\u5220\u9664\u5DE5\u4F5C\u533A ${confirmTarget.title}\uFF1F` : `\u5F52\u6863\u4F1A\u8BDD ${confirmTarget.title}\uFF1F`,
        description: confirmTarget.kind === "workspace" ? "\u8BE5\u5DE5\u4F5C\u533A\u4E0B\u7684\u4F1A\u8BDD\u5C06\u88AB\u4E00\u5E76\u5220\u9664\uFF0C\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002" : "\u5F52\u6863\u540E\u7684\u4F1A\u8BDD\u5C06\u4ECE\u5F53\u524D\u5217\u8868\u4E2D\u9690\u85CF\u3002",
        confirmLabel: confirmTarget.kind === "workspace" ? "\u5220\u9664" : "\u5F52\u6863",
        onConfirm: () => {
          const target = confirmTarget;
          run(() => target.kind === "workspace" ? props.deleteWorkspace?.(target.id) : props.archiveSession?.(target.id));
          setConfirmTarget(null);
        },
        onClose: () => setConfirmTarget(null)
      }
    ) : null
  ] });
}
function GroupDeleteDialog(props) {
  const [dest, setDest] = (0, import_react4.useState)("default");
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
    import_dsh_client_ui_primitives3.Modal,
    {
      open: true,
      onClose: props.onCancel,
      title: `\u5220\u9664\u5206\u7EC4\u201C${props.groupName}\u201D`,
      description: "\u7EC4\u5185\u804A\u5929\u6846\u8981\u5982\u4F55\u5904\u7406\uFF1F",
      footer: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "ghost", onClick: props.onCancel, children: "\u53D6\u6D88" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "primary", onClick: () => props.onConfirm(dest), children: "\u786E\u8BA4" })
      ] }),
      children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { type: "radio", checked: dest === "default", onChange: () => setDest("default") }),
          "\u79FB\u56DE\u9ED8\u8BA4\u5206\u7EC4"
        ] }),
        props.destinationOptions.map((g) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { type: "radio", checked: dest === g.id, onChange: () => setDest(g.id) }),
          "\u79FB\u5230 ",
          g.name
        ] }, g.id)),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { type: "radio", checked: dest === "archive", onChange: () => setDest("archive") }),
          "\u5F52\u6863\u4F1A\u8BDD"
        ] })
      ] })
    }
  );
}
function GroupHeader(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
    "div",
    {
      role: "treeitem",
      "aria-expanded": !props.collapsed,
      className: "fm-wb-row fm-wb-group-row",
      draggable: props.draggable,
      onClick: props.onToggle,
      onDragStart: props.onDragStart,
      onDragEnd: props.onDragEnd,
      onDragOver: props.onSessionDragOver,
      onDrop: props.onSessionDrop,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px 4px 16px",
        // 行高显式钉住：20px 紧凑按钮撑不到 36px，不钉就会塌掉。
        // box-sizing:border-box 见工作区行同款注释（否则 minHeight 不含 padding）。
        boxSizing: "border-box",
        minHeight: ROW_MIN_HEIGHT.group,
        borderRadius: RADIUS.navRow,
        cursor: "pointer",
        fontWeight: 600,
        // 方案 B：二级 = 小节标签。字号降到 12、颜色转次色，与一级（13px/主色）分层；
        // 配合下面的 chevron（不再是 folder）与计数胶囊，一眼区分"这是分组，不是另一个工作区"。
        fontSize: 12,
        color: "var(--dsw-alias-label-secondary)",
        ...props.selected ? { background: "var(--dsw-alias-interactive-bg-hover)" } : {},
        ...props.highlight ? { outline: "1px solid var(--dsw-alias-state-business-primary)" } : {}
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { flex: "none", width: 16, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-tertiary)" }, children: props.collapsed ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconTriangleRightFill14, { size: 14 }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconChevronDownOutline14, { size: 14 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }, children: props.name }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "fm-wb-cnt", title: `${props.count} \u4E2A\u4F1A\u8BDD`, children: props.count }),
        props.onRename || props.onDelete || props.onNewChat ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "fm-wb-row-actions", style: { display: "inline-flex", gap: ROW_ACTION_GAP, flex: "none" }, children: [
          props.onNewChat ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
            import_dsh_client_ui_primitives3.Button,
            {
              size: "sm",
              variant: "ghost",
              icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconNewChatOutline16, { size: 16 }),
              style: ROW_ACTION_BUTTON_STYLE,
              title: "\u65B0\u5BF9\u8BDD\uFF08\u5F53\u524D\u9009\u4E2D\u5206\u7EC4\uFF09",
              "aria-label": "\u65B0\u5BF9\u8BDD\uFF08\u5F53\u524D\u9009\u4E2D\u5206\u7EC4\uFF09",
              "data-myagent-new-chat-group": true,
              onClick: (e) => {
                e.stopPropagation();
                props.onNewChat?.();
              }
            }
          ) : null,
          props.onRename ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconEditOutline16, { size: 16 }), style: ROW_ACTION_BUTTON_STYLE, title: "\u91CD\u547D\u540D\u5206\u7EC4", "aria-label": "\u91CD\u547D\u540D\u5206\u7EC4", onClick: (e) => {
            e.stopPropagation();
            props.onRename?.();
          } }) : null,
          props.onDelete ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.IconTrashOutline16, { size: 16 }), style: { ...ROW_ACTION_BUTTON_STYLE, color: "var(--dsw-alias-state-error-primary)" }, title: "\u5220\u9664\u5206\u7EC4", "aria-label": "\u5220\u9664\u5206\u7EC4", onClick: (e) => {
            e.stopPropagation();
            props.onDelete?.();
          } }) : null
        ] }) : null
      ]
    }
  );
}

// src/client/FileTree.tsx
var import_react6 = require("react");

// src/client/FileBadge.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var FRAME = "M9.23438 0.546389C10.1941 0.546389 10.9683 0.544914 11.5859 0.611819C12.2161 0.680096 12.7634 0.825745 13.2393 1.17139C13.5172 1.3733 13.7619 1.61812 13.9639 1.896C14.3096 2.37183 14.4551 2.91922 14.5234 3.54932C14.5903 4.16686 14.5889 4.94133 14.5889 5.90088V10.0981C14.5889 11.0576 14.5903 11.8321 14.5234 12.4497C14.4552 13.0798 14.3094 13.6272 13.9639 14.103C13.7619 14.381 13.5172 14.6257 13.2393 14.8276C12.7633 15.1734 12.2163 15.3189 11.5859 15.3872C10.9683 15.4541 10.1942 15.4536 9.23438 15.4536H6.76563C5.80591 15.4536 5.03168 15.4541 4.41407 15.3872C3.78385 15.3189 3.23665 15.1734 2.76074 14.8276C2.48291 14.6257 2.23802 14.3809 2.03614 14.103C1.69066 13.6272 1.54483 13.0798 1.47657 12.4497C1.40973 11.8321 1.41114 11.0576 1.41114 10.0981V5.90088C1.41113 4.94132 1.40966 4.16686 1.47657 3.54932C1.54488 2.91921 1.69042 2.37184 2.03614 1.896C2.2381 1.61807 2.4828 1.37333 2.76074 1.17139C3.23665 0.825682 3.78386 0.680109 4.41407 0.611819C5.03168 0.544905 5.80591 0.546389 6.76563 0.546389H9.23438ZM6.76563 1.896C5.77586 1.896 5.0876 1.89738 4.55957 1.95459C4.0443 2.01043 3.76214 2.11349 3.55469 2.26416C3.39135 2.38284 3.24761 2.52662 3.12891 2.68994C2.97821 2.89736 2.8752 3.17967 2.81934 3.69483C2.76214 4.22279 2.76075 4.91131 2.76074 5.90088V10.0981C2.76074 11.0876 2.76221 11.7762 2.81934 12.3042C2.87516 12.8194 2.97829 13.1026 3.12891 13.3101C3.24754 13.4733 3.39147 13.6172 3.55469 13.7358C3.76213 13.8865 4.04438 13.9896 4.55957 14.0454C5.0876 14.1026 5.77586 14.103 6.76563 14.103H9.23438C10.2242 14.103 10.9124 14.1026 11.4404 14.0454C11.9556 13.9896 12.2379 13.8865 12.4453 13.7358C12.6086 13.6172 12.7525 13.4733 12.8711 13.3101C13.0217 13.1026 13.1248 12.8195 13.1807 12.3042C13.2378 11.7762 13.2393 11.0876 13.2393 10.0981V5.90088C13.2393 4.91131 13.2379 4.22279 13.1807 3.69483C13.1248 3.17969 13.0218 2.89736 12.8711 2.68994C12.7524 2.52667 12.6086 2.38281 12.4453 2.26416C12.2379 2.11355 11.9556 2.01041 11.4404 1.95459C10.9124 1.8974 10.2241 1.896 9.23438 1.896H6.76563Z";
var INNER = "M6.76563 1.896C5.77586 1.896 5.0876 1.89738 4.55957 1.95459C4.0443 2.01043 3.76214 2.11349 3.55469 2.26416C3.39135 2.38284 3.24761 2.52662 3.12891 2.68994C2.97821 2.89736 2.8752 3.17967 2.81934 3.69483C2.76214 4.22279 2.76075 4.91131 2.76074 5.90088V10.0981C2.76074 11.0876 2.76221 11.7762 2.81934 12.3042C2.87516 12.8194 2.97829 13.1026 3.12891 13.3101C3.24754 13.4733 3.39147 13.6172 3.55469 13.7358C3.76213 13.8865 4.04438 13.9896 4.55957 14.0454C5.0876 14.1026 5.77586 14.103 6.76563 14.103H9.23438C10.2242 14.103 10.9124 14.1026 11.4404 14.0454C11.9556 13.9896 12.2379 13.8865 12.4453 13.7358C12.6086 13.6172 12.7525 13.4733 12.8711 13.3101C13.0217 13.1026 13.1248 12.8195 13.1807 12.3042C13.2378 11.7762 13.2393 11.0876 13.2393 10.0981V5.90088C13.2393 4.91131 13.2379 4.22279 13.1807 3.69483C13.1248 3.17969 13.0218 2.89736 12.8711 2.68994C12.7524 2.52667 12.6086 2.38281 12.4453 2.26416C12.2379 2.11355 11.9556 2.01041 11.4404 1.95459C10.9124 1.8974 10.2241 1.896 9.23438 1.896H6.76563Z";
var LINE1 = "M11.2426 4.80473V6.10551H4.75819V4.80473H11.2426Z";
var LINE2 = "M9.40858 7.84478V9.14557H4.75819V7.84478H9.40858Z";
function FileBadge(props) {
  const { size = 16, lines = false } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { fill: "currentColor", fillOpacity: "0.3", d: INNER }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { fill: "currentColor", d: FRAME }),
    lines ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { fill: "currentColor", d: LINE1 }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { fill: "currentColor", d: LINE2 })
    ] }) : null
  ] });
}
function FileBadgeFrame(props) {
  const { size = 16 } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("path", { fill: "currentColor", d: FRAME }) });
}

// src/client/file-icon.tsx
var import_react5 = __toESM(require("react"), 1);
var primitives = __toESM(require("@deepseek-ai/dsh-client-ui-primitives"), 1);
var host = primitives;
var hasHostFileIcons = typeof host.FileTypeIcon === "function" && typeof host.classifyFileType === "function";
function FileIcon({ name, size = 16, className }) {
  if (!hasHostFileIcons) {
    const Fallback = primitives.IconBrowseOutline16;
    return import_react5.default.createElement(Fallback, { kind: "file", size, className });
  }
  return import_react5.default.createElement(host.FileTypeIcon, {
    kind: host.classifyFileType(name),
    size,
    className
  });
}

// src/client/FileTree.tsx
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime6 = require("react/jsx-runtime");
var TREE_CSS = `
.fm-tree-row{border-radius:${RADIUS.treeRow}px}
.fm-tree-row:hover{background:var(--dsw-specific-sidebar-nav-item-hover)}
`;
async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      document.body.appendChild(ta);
      try {
        ta.select();
        return document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    } catch {
      return false;
    }
  }
}
function parentOf(path) {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}
function FileTree({ api, onOpenFile, headerExtra, toolbarKey, scrollLock }) {
  const [roots, setRoots] = (0, import_react6.useState)(null);
  const [openDirs, setOpenDirs] = (0, import_react6.useState)({});
  const [rootOpen, setRootOpen] = (0, import_react6.useState)(true);
  const [selected, setSelected] = (0, import_react6.useState)(null);
  const [error, setError] = (0, import_react6.useState)(null);
  const [menu, setMenu] = (0, import_react6.useState)(null);
  const [dialog, setDialog] = (0, import_react6.useState)(null);
  const [toolbarOpen, setToolbarOpen] = (0, import_react6.useState)(false);
  const [copiedPath, setCopiedPath] = (0, import_react6.useState)(false);
  const copiedTimerRef = (0, import_react6.useRef)(null);
  useCloseOnScroll(() => setToolbarOpen(false));
  const clearCopiedTimer = () => {
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
  };
  (0, import_react6.useEffect)(() => {
    return () => {
      clearCopiedTimer();
    };
  }, []);
  const reload = (0, import_react6.useCallback)(async () => {
    const res = await api.tree("");
    if (res.ok) {
      setRoots(sortEntries(res.data.entries));
      setError(null);
    } else {
      setError(describeApiError(res));
    }
  }, [api]);
  (0, import_react6.useEffect)(() => {
    void reload();
  }, [reload]);
  const toggleDir = async (entry) => {
    if (openDirs[entry.path]) {
      setOpenDirs((o) => {
        const n2 = { ...o };
        delete n2[entry.path];
        return n2;
      });
      return;
    }
    const res = await api.tree(entry.path);
    if (res.ok) {
      setOpenDirs((o) => ({ ...o, [entry.path]: sortEntries(res.data.entries) }));
      setError(null);
    } else {
      setError(describeApiError(res));
    }
  };
  const runOp = (op, path, to) => api.op(op, path, to).then((res) => {
    if (res.ok) void reload();
    else setError(describeApiError(res));
  });
  const menuItemsFor = (entry) => {
    const isDir = entry.kind === "dir";
    const isRoot = entry.path === "";
    const parent = parentOf(entry.path);
    const open = Boolean(openDirs[entry.path]);
    const items = [];
    if (isDir) {
      items.push({
        key: "toggle",
        label: open ? "\u6536\u8D77" : "\u5C55\u5F00",
        icon: open ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconChevronDownOutline14, { size: 14 }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconTriangleRightFill14, { size: 14 }),
        onSelect: () => isRoot ? setRootOpen((v) => !v) : void toggleDir(entry)
      });
    } else {
      items.push({
        key: "open",
        label: "\u6253\u5F00",
        icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconBrowseOutline16, { size: 16 }),
        onSelect: () => onOpenFile(entry.path)
      });
    }
    items.push({
      key: "copy-path",
      label: copiedPath ? "\u5DF2\u590D\u5236 \u2713" : "\u590D\u5236\u9879\u76EE\u5730\u5740",
      icon: copiedPath ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconCheckOutline16, { size: 16 }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconCopyOutline16, { size: 16 }),
      keepOpen: true,
      onSelect: () => {
        void copyTextToClipboard(resolveAbsPath(api.root, entry.path)).then((ok) => {
          if (!ok) return;
          setCopiedPath(true);
          clearCopiedTimer();
          copiedTimerRef.current = window.setTimeout(() => {
            copiedTimerRef.current = null;
            setCopiedPath(false);
          }, 1500);
        });
      }
    });
    items.push({ key: "sep1", separator: true });
    items.push({
      key: "new-file",
      label: "\u65B0\u5EFA\u6587\u4EF6",
      icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconPlusOutline16, { size: 16 }),
      onSelect: () => setDialog({ kind: "new-file", base: isDir ? entry.path : parent })
    });
    items.push({
      key: "new-folder",
      label: "\u65B0\u5EFA\u6587\u4EF6\u5939",
      icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconFolderClose16, { size: 16 }),
      onSelect: () => setDialog({ kind: "new-folder", base: isDir ? entry.path : parent })
    });
    items.push({ key: "sep2", separator: true });
    if (!isRoot) {
      items.push({
        key: "rename",
        label: "\u91CD\u547D\u540D",
        icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconEditOutline16, { size: 16 }),
        onSelect: () => setDialog({ kind: "rename", entry, base: parent })
      });
      items.push({
        key: "delete",
        label: "\u5220\u9664",
        icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconTrashOutline16, { size: 16 }),
        danger: true,
        confirmLabel: "\u786E\u8BA4\u5220\u9664\uFF1F",
        onSelect: () => void runOp("remove", entry.path)
      });
      items.push({
        key: "move",
        label: "\u79FB\u52A8\u2026",
        icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconRightUpOutline16, { size: 16 }),
        onSelect: () => setDialog({ kind: "move", entry, base: parent })
      });
    }
    items.push({ key: "sep3", separator: true });
    items.push({
      key: "refresh",
      label: "\u5237\u65B0",
      icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconRefreshOutline16, { size: 16 }),
      onSelect: () => void reload()
    });
    return items;
  };
  const renderEntries = (entries, depth) => entries.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
      "div",
      {
        className: "fm-tree-row",
        style: {
          display: "flex",
          alignItems: "center",
          gap: TREE_ROW.gap,
          // 官方文件树：每级缩进 18px、行内边距 5px 10px（内层 wrapper 再让 8px）。
          padding: `${TREE_ROW.paddingY}px ${TREE_ROW.paddingX}px ${TREE_ROW.paddingY}px ${TREE_ROW.paddingX + depth * TREE_ROW.indent}px`,
          cursor: "pointer",
          // 选中态：interactive-bg-active（sidebar 内行选中等价物）；圆角对齐官方 10px。
          background: selected === entry.path ? "var(--dsw-alias-interactive-bg-active)" : void 0,
          color: "var(--dsw-alias-label-primary)",
          whiteSpace: "nowrap"
        },
        onClick: () => {
          if (menu || toolbarOpen) {
            setMenu(null);
            setToolbarOpen(false);
            return;
          }
          setSelected(entry.path);
          if (entry.kind === "dir") void toggleDir(entry);
          else onOpenFile(entry.path);
        },
        onContextMenu: (e) => {
          e.preventDefault();
          e.stopPropagation();
          setSelected(entry.path);
          setMenu({ x: e.clientX, y: e.clientY, entry });
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { flex: "none", width: 14, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-tertiary)" }, children: entry.kind === "dir" ? openDirs[entry.path] ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconChevronDownOutline14, { size: 14 }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconTriangleRightFill14, { size: 14 }) : null }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { flex: "none", display: "inline-flex", color: "var(--dsw-alias-label-tertiary)" }, children: entry.kind === "dir" ? openDirs[entry.path] ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconFolderOpenOutline16, { size: 16 }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconFolderClose16, { size: 16 }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(FileIcon, { name: entry.name, size: 16 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }, children: entry.name })
        ]
      }
    ),
    openDirs[entry.path]?.length ? renderEntries(openDirs[entry.path], depth + 1) : null
  ] }, entry.path));
  return (
    // 外层与 WorkspaceBrowser 同构：height:100% + flex 列（不滚动）——内部树滚动区
    // （flex:1 + minHeight:0 + fm-scroll）才能正确收缩并出现渐变滚动条；此前外层
    // overflow:auto + 高度 auto 让 flex:1 失效，区文件树实际滚动的是浏览器默认粗滚动条。
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { height: "100%", display: "flex", flexDirection: "column", fontSize: FONT_SECONDARY, lineHeight: 1.5, userSelect: "none", color: "var(--dsw-alias-label-primary)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("style", { children: TREE_CSS }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_jsx_runtime6.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_jsx_runtime6.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { height: "100%", display: "flex", flexDirection: "column" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { flex: "none", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 34px 4px 4px", background: "var(--dsw-specific-sidebar-fill)", borderBottom: HEADER_BORDER }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, color: "var(--dsw-alias-label-primary)" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(FileBadge, { lines: true }),
            "\u533A\u6587\u4EF6\u6811"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: { display: "flex", gap: 4 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              import_dsh_client_ui_primitives4.Menu,
              {
                open: toolbarOpen,
                onClose: () => setToolbarOpen(false),
                items: [
                  { id: "new-file", label: "\u65B0\u5EFA\u6587\u4EF6", icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconPlusOutline16, { size: 16 }) },
                  { id: "new-folder", label: "\u65B0\u5EFA\u6587\u4EF6\u5939", icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconFolderClose16, { size: 16 }) }
                ],
                onSelect: (id) => {
                  setToolbarOpen(false);
                  if (id === "new-file") setDialog({ kind: "new-file", base: "" });
                  else if (id === "new-folder") setDialog({ kind: "new-folder", base: "" });
                },
                portal: true,
                anchor: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { className: "fm-tb-btn", style: { ...ICON_BTN_STYLE, animationDelay: "0ms" }, size: "sm", variant: "ghost", icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconPlusOutline16, { size: 16 }), title: "\u65B0\u5EFA\u6587\u4EF6\u6216\u6587\u4EF6\u5939", "aria-label": "\u65B0\u5EFA\u6587\u4EF6\u6216\u6587\u4EF6\u5939", onClick: () => setToolbarOpen((v) => !v) })
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { className: "fm-tb-btn", style: { ...ICON_BTN_STYLE, animationDelay: "40ms" }, size: "sm", variant: "ghost", icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconRefreshOutline16, { size: 16 }), title: "\u5237\u65B0", "aria-label": "\u5237\u65B0", onClick: () => void reload() })
          ] }, toolbarKey ?? 0)
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
          "div",
          {
            className: "fm-scroll",
            style: { flex: 1, minHeight: 0, overflowY: scrollLock ? "hidden" : "auto", scrollbarGutter: "stable", padding: "8px 0 8px 8px" },
            children: [
              error ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, color: "var(--dsw-alias-state-error-primary)", padding: "2px 4px" }, children: [
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { flex: 1, minWidth: 0 }, children: error }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                  import_dsh_client_ui_primitives4.Button,
                  {
                    size: "sm",
                    variant: "ghost",
                    onClick: () => {
                      setError(null);
                      void reload();
                    },
                    children: "\u91CD\u8BD5"
                  }
                )
              ] }) : null,
              roots === null ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { padding: 8, color: "var(--dsw-alias-label-secondary)" }, children: "\u52A0\u8F7D\u4E2D\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
                  "div",
                  {
                    className: "fm-tree-row",
                    title: api.root,
                    onClick: () => {
                      if (menu || toolbarOpen) {
                        setMenu(null);
                        setToolbarOpen(false);
                        return;
                      }
                      setRootOpen((v) => !v);
                    },
                    onContextMenu: (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMenu({ x: e.clientX, y: e.clientY, entry: { name: api.root, path: "", kind: "dir" } });
                    },
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: TREE_ROW.gap,
                      padding: `${TREE_ROW.paddingY}px ${TREE_ROW.paddingX}px`,
                      cursor: "pointer",
                      color: "var(--dsw-alias-label-primary)",
                      whiteSpace: "nowrap"
                    },
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { flex: "none", width: 14, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-tertiary)" }, children: rootOpen ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconChevronDownOutline14, { size: 14 }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconTriangleRightFill14, { size: 14 }) }),
                      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { flex: "none", display: "inline-flex", color: "var(--dsw-alias-label-tertiary)" }, children: rootOpen ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconFolderOpenOutline16, { size: 16 }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconFolderClose16, { size: 16 }) }),
                      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }, children: api.root })
                    ]
                  }
                ),
                rootOpen ? renderEntries(roots, 1) : null
              ] })
            ]
          }
        )
      ] }) }) }),
      menu ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        ContextMenu,
        {
          x: menu.x,
          y: menu.y,
          items: menuItemsFor(menu.entry),
          onClose: () => {
            setMenu(null);
            setCopiedPath(false);
            clearCopiedTimer();
          }
        },
        menu.entry.path
      ) : null,
      dialog?.kind === "new-file" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        PromptModal,
        {
          open: true,
          title: "\u65B0\u5EFA\u6587\u4EF6",
          description: dialog.base === "" ? "\u5728\u5DE5\u4F5C\u533A\u6839\u76EE\u5F55\u4E0B\u521B\u5EFA" : `\u5728 ${dialog.base} \u4E0B\u521B\u5EFA`,
          placeholder: "\u65B0\u6587\u4EF6\u540D\u79F0\uFF0C\u5982 new-file.txt",
          validate: (v) => validateNameInput("name", v),
          onSubmit: (name) => {
            const rel = joinRel(dialog.base, name);
            void api.write(rel, "").then((res) => {
              if (res.ok) void reload();
              else setError(describeApiError(res));
            });
            setDialog(null);
          },
          onClose: () => setDialog(null)
        }
      ) : null,
      dialog?.kind === "new-folder" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        PromptModal,
        {
          open: true,
          title: "\u65B0\u5EFA\u6587\u4EF6\u5939",
          description: dialog.base === "" ? "\u5728\u5DE5\u4F5C\u533A\u6839\u76EE\u5F55\u4E0B\u521B\u5EFA" : `\u5728 ${dialog.base} \u4E0B\u521B\u5EFA`,
          placeholder: "\u65B0\u6587\u4EF6\u5939\u540D\u79F0\uFF0C\u5982 src",
          validate: (v) => validateNameInput("name", v),
          onSubmit: (name) => {
            void runOp("mkdir", joinRel(dialog.base, name));
            setDialog(null);
          },
          onClose: () => setDialog(null)
        }
      ) : null,
      dialog?.kind === "rename" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        PromptModal,
        {
          open: true,
          title: `\u91CD\u547D\u540D ${dialog.entry.name}`,
          initialValue: dialog.entry.name,
          placeholder: "\u65B0\u540D\u5B57",
          validate: (v) => validateNameInput("name", v),
          onSubmit: (name) => {
            void runOp("rename", dialog.entry.path, joinRel(dialog.base, name));
            setDialog(null);
          },
          onClose: () => setDialog(null)
        }
      ) : null,
      dialog?.kind === "move" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        PromptModal,
        {
          open: true,
          title: `\u79FB\u52A8 ${dialog.entry.name}`,
          description: "\u76EE\u6807\u8DEF\u5F84\uFF08\u5DE5\u4F5C\u533A\u5185\u76F8\u5BF9\u8DEF\u5F84\uFF09",
          initialValue: dialog.entry.path,
          placeholder: "\u76EE\u6807\u8DEF\u5F84\uFF0C\u5982 src/utils.ts",
          validate: (v) => validateNameInput("path", v),
          onSubmit: (to) => {
            void runOp("move", dialog.entry.path, to);
            setDialog(null);
          },
          onClose: () => setDialog(null)
        }
      ) : null
    ] })
  );
}

// src/client/RailPanel.tsx
var import_react7 = require("react");
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime7 = require("react/jsx-runtime");
var STATUS_LABEL = {
  running: "\u6B63\u5728\u8FD0\u884C",
  approval: "\u7B49\u5F85\u6279\u51C6",
  "plan-review": "\u7B49\u5F85\u8BA1\u5212\u786E\u8BA4",
  question: "\u7B49\u5F85\u56DE\u7B54"
};
function dotColor(kind) {
  if (kind === "running") return "var(--dsw-alias-state-business-primary)";
  if (kind === "question") return "#FACC15";
  return "var(--dsw-alias-state-warn-primary)";
}
var RAIL_CSS = `
.fm-rail{display:flex;flex-direction:column;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:2px 0 0}
.fm-rail-btn{
  width:${RAIL_BUTTON_SIZE}px;height:${RAIL_BUTTON_SIZE}px;flex:none;
  display:inline-flex;align-items:center;justify-content:center;
  padding:0;border:none;border-radius:999px;background:transparent;cursor:pointer;
  color:var(--dsw-alias-label-tertiary);
}
.fm-rail-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.fm-rail-btn:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
/* \u5B57\u5F62\u7EDF\u4E00 15px\uFF1A\u5B98\u65B9 .tool / .iconButton \u5C31\u662F 28px \u65B9\u6846\u914D 15px \u5B57\u5F62\uFF08CSS \u5B9A\u5C3A\u5BF8\uFF09\u3002 */
.fm-rail-btn svg{width:15px;height:15px}
.fm-rail-btn .fm-rail-dot{width:${RAIL_DOT_SIZE}px;height:${RAIL_DOT_SIZE}px}
.fm-rail-sep{width:20px;height:1px;background:var(--dsw-alias-border-l3);margin:1px 0;flex:none}
.fm-rail-dot{display:block;border-radius:50%;box-sizing:border-box}
/* \u8FD0\u884C\u4E2D\u7684\u547C\u5438\u8109\u51B2\uFF0C\u4E0E\u5BBD\u6001\u72B6\u6001\u70B9\u540C\u6B3E\u6697\u793A\u3002 */
@keyframes fm-rail-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.fm-rail-dot-running{animation:fm-rail-pulse 1.2s ease-in-out infinite}
.fm-rail-more{font-size:10px;line-height:12px;color:var(--dsw-alias-label-tertiary);flex:none}
`;
function RailPanel(props) {
  const sessions = props.useSessions((s) => s);
  const workspaces = props.useWorkspaces((s) => s);
  const currentWorkspaceId = (0, import_react7.useMemo)(() => {
    const cur = sessions.current;
    if (cur === void 0) return void 0;
    return workspaces.items.find((w) => (w.sessionIds ?? []).includes(cur))?.workspaceId;
  }, [sessions.current, workspaces.items]);
  const active = (0, import_react7.useMemo)(() => {
    const archived = new Set(workspaces.archivedSessionIds ?? []);
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const w of workspaces.items) {
      for (const id of w.sessionIds ?? []) {
        if (seen.has(id) || archived.has(id)) continue;
        seen.add(id);
        const s = sessions.byId[id];
        if (s === void 0) continue;
        const kind = s.pendingInteraction ?? (s.running ? "running" : void 0);
        if (kind === void 0) continue;
        out.push({ id, title: s.title ?? "\u672A\u547D\u540D\u4F1A\u8BDD", label: STATUS_LABEL[kind], kind });
      }
    }
    return out;
  }, [sessions.byId, workspaces.items, workspaces.archivedSessionIds]);
  const shown = active.slice(0, RAIL_MAX_TASKS);
  const hidden = active.length - shown.length;
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "fm-rail", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("style", { children: RAIL_CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
      "button",
      {
        type: "button",
        className: "fm-rail-btn",
        title: "\u5C55\u5F00\u5E76\u5B9A\u4F4D\u5230\u5F53\u524D\u5BF9\u8BDD\u6240\u5728\u7684\u5DE5\u4F5C\u533A",
        "aria-label": "\u5C55\u5F00\u5E76\u5B9A\u4F4D\u5230\u5F53\u524D\u5BF9\u8BDD\u6240\u5728\u7684\u5DE5\u4F5C\u533A",
        "data-myagent-rail": "workspace",
        onClick: () => {
          props.onRevealWorkspace(currentWorkspaceId);
          props.expandSidebar?.();
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives5.IconFolderOpen16, { size: 15 })
      }
    ),
    props.hasFileTree ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
      "button",
      {
        type: "button",
        className: "fm-rail-btn",
        title: "\u5C55\u5F00\u5E76\u663E\u793A\u5F53\u524D\u5BF9\u8BDD\u7684\u6587\u4EF6\u6811",
        "aria-label": "\u5C55\u5F00\u5E76\u663E\u793A\u5F53\u524D\u5BF9\u8BDD\u7684\u6587\u4EF6\u6811",
        "data-myagent-rail": "files",
        onClick: () => {
          props.onRevealFileTree();
          props.expandSidebar?.();
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(FileBadge, { lines: true, size: 15 })
      }
    ) : null,
    shown.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "fm-rail-sep" }) : null,
    shown.map((t) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
      "button",
      {
        type: "button",
        className: "fm-rail-btn",
        "data-myagent-rail": "task",
        "data-session-id": t.id,
        title: `${t.title} \xB7 ${t.label}`,
        "aria-label": `${t.title} \xB7 ${t.label}`,
        onClick: () => props.open?.(t.id),
        children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "span",
          {
            className: `fm-rail-dot${t.kind === "running" ? " fm-rail-dot-running" : ""}`,
            style: { background: dotColor(t.kind) }
          }
        )
      },
      t.id
    )),
    hidden > 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "fm-rail-more", children: [
      "+",
      hidden
    ] }) : null
  ] });
}

// src/client/SidebarComposite.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
var MIN_RATIO = 0.2;
var MAX_RATIO = 0.8;
var WS_COLLAPSED_KEY = "fm.ws-collapsed";
var FS_COLLAPSED_KEY = "fm.fs-collapsed";
function readCollapsed2(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === "true";
  } catch {
    return false;
  }
}
function writeCollapsed2(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
  }
}
var SPLITTER_CSS = `
.fm-splitter-handle:hover,
.fm-splitter-handle:focus-visible,
.fm-splitter-handle.fm-splitter-dragging {
  background: var(--dsw-alias-interactive-bg-hover);
}
.fm-splitter-handle:hover .fm-splitter-bar,
.fm-splitter-handle:focus-visible .fm-splitter-bar,
.fm-splitter-handle.fm-splitter-dragging .fm-splitter-bar {
  height: 3px;
  background: var(--dsw-alias-label-secondary);
}
.fm-splitter-bar {
  height: 2px;
  background: var(--dsw-alias-border-l2);
}
`;
var EDGE_STRIP_CSS = `
.fm-edge-strip{background:var(--dsw-alias-bg-layer-1)}
.fm-edge-strip:hover{background:var(--dsw-alias-interactive-bg-hover)}
`;
var BTN_ANIM_CSS = `
@keyframes fm-btn-in {
  from { opacity: 0; transform: translateX(14px); }
  to { opacity: 1; transform: none; }
}
.fm-tb-btn { animation: fm-btn-in 0.22s ease backwards; }
`;
var FOLD_BTN_CSS = `
.fm-fold-btn {
  position: absolute;
  top: 4px;
  right: 2px;
  z-index: 5;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: ${RADIUS.icon}px;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: none;
  transition: background .15s ease;
}
.fm-fold-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.fm-fold-btn-active,
.fm-fold-btn-active:hover {
  background: transparent;
}
`;
function EdgeStrip(props) {
  const { icon, title, label, onClick, border, hidden } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
    "div",
    {
      className: "fm-edge-strip",
      title: label,
      onClick,
      style: {
        flex: "none",
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        padding: "0 4px 0 4px",
        cursor: "pointer",
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? "none" : "auto",
        transition: "opacity .15s ease",
        ...border === "bottom" ? { borderBottom: HEADER_BORDER } : { borderTop: HEADER_BORDER }
      },
      children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, color: "var(--dsw-alias-label-secondary)", fontSize: FONT_SECONDARY }, children: [
        icon,
        title
      ] })
    }
  );
}
function foldButton(label, collapsed, onClick) {
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
    "button",
    {
      type: "button",
      className: `fm-fold-btn${collapsed ? " fm-fold-btn-active" : ""}`,
      title: label,
      "aria-label": label,
      "aria-expanded": !collapsed,
      onClick,
      children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives6.IconPanelLeftOutline16, { size: 16 })
    }
  );
}
function SidebarComposite(props) {
  const { api, onOpenFile } = props;
  const [ratio, setRatio] = (0, import_react8.useState)(0.55);
  const containerRef = (0, import_react8.useRef)(null);
  const dragRef = (0, import_react8.useRef)(null);
  const [dragging, setDragging] = (0, import_react8.useState)(false);
  const [wsCollapsed, setWsCollapsed] = (0, import_react8.useState)(() => readCollapsed2(WS_COLLAPSED_KEY));
  const [fsCollapsed, setFsCollapsed] = (0, import_react8.useState)(() => readCollapsed2(FS_COLLAPSED_KEY));
  const [revealWorkspaceId, setRevealWorkspaceId] = (0, import_react8.useState)(null);
  const [wsExpandSeq, setWsExpandSeq] = (0, import_react8.useState)(0);
  const [fsExpandSeq, setFsExpandSeq] = (0, import_react8.useState)(0);
  const [wsAnimating, setWsAnimating] = (0, import_react8.useState)(false);
  const [fsAnimating, setFsAnimating] = (0, import_react8.useState)(false);
  const wsTimer = (0, import_react8.useRef)(null);
  const fsTimer = (0, import_react8.useRef)(null);
  const toggleWs = () => {
    if (wsCollapsed) setWsExpandSeq((s) => s + 1);
    setWsAnimating(true);
    if (wsTimer.current !== null) window.clearTimeout(wsTimer.current);
    wsTimer.current = window.setTimeout(() => setWsAnimating(false), 260);
    setWsCollapsed((v) => {
      const next = !v;
      writeCollapsed2(WS_COLLAPSED_KEY, next);
      return next;
    });
  };
  const toggleFs = () => {
    if (fsCollapsed) setFsExpandSeq((s) => s + 1);
    setFsAnimating(true);
    if (fsTimer.current !== null) window.clearTimeout(fsTimer.current);
    fsTimer.current = window.setTimeout(() => setFsAnimating(false), 260);
    setFsCollapsed((v) => {
      const next = !v;
      writeCollapsed2(FS_COLLAPSED_KEY, next);
      return next;
    });
  };
  const onHandlePointerDown = (e) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    dragRef.current = { kind: "ratio", startY: e.clientY, startRatio: ratio, height: rect.height };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandlePointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "ratio") {
      const next = d.startRatio + (e.clientY - d.startY) / d.height;
      setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, next)));
    }
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };
  const onHandleKeyDown = (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setRatio((r) => Math.max(MIN_RATIO, r - 0.05));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setRatio((r) => Math.min(MAX_RATIO, r + 0.05));
    } else if (e.key === "Home") {
      e.preventDefault();
      setRatio(MIN_RATIO);
    } else if (e.key === "End") {
      e.preventDefault();
      setRatio(MAX_RATIO);
    }
  };
  if (props.wide === false) {
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--dsw-specific-sidebar-fill)" }, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      RailPanel,
      {
        useSessions: props.useSessions,
        useWorkspaces: props.useWorkspaces,
        expandSidebar: props.expandSidebar,
        onRevealWorkspace: (workspaceId) => setRevealWorkspaceId(workspaceId ?? null),
        onRevealFileTree: () => clearActiveRoot(),
        hasFileTree: api !== null,
        open: props.open
      }
    ) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
    "div",
    {
      ref: containerRef,
      style: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--dsw-specific-sidebar-fill)" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("style", { children: SPLITTER_CSS }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("style", { children: EDGE_STRIP_CSS }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("style", { children: BTN_ANIM_CSS }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("style", { children: FOLD_BTN_CSS }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("style", { children: SCROLLBAR_CSS }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "div",
          {
            style: {
              position: "relative",
              height: wsCollapsed ? 32 : `${ratio * 100}%`,
              flex: "0 0 auto",
              minHeight: 0,
              transition: dragging ? "none" : "height .22s ease",
              overflow: "hidden"
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "div",
                {
                  style: {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    opacity: wsCollapsed ? 0 : 1,
                    transition: "opacity .15s ease",
                    pointerEvents: wsCollapsed ? "none" : "auto",
                    overflow: "hidden"
                  },
                  children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    WorkspaceBrowser,
                    {
                      ...props,
                      wide: true,
                      toolbarKey: wsExpandSeq,
                      scrollLock: wsAnimating,
                      revealWorkspaceId,
                      onRevealed: () => setRevealWorkspaceId(null)
                    }
                  )
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(EdgeStrip, { icon: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives6.IconFolderClose16, { size: 16 }), title: "\u5DE5\u4F5C\u533A", label: "\u5C55\u5F00\u5DE5\u4F5C\u533A", onClick: toggleWs, border: "bottom", hidden: !wsCollapsed }),
              foldButton(wsCollapsed ? "\u5C55\u5F00\u5DE5\u4F5C\u533A" : "\u6536\u8D77\u5DE5\u4F5C\u533A", wsCollapsed, toggleWs)
            ]
          }
        ),
        !wsCollapsed ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          "div",
          {
            role: "separator",
            "aria-orientation": "horizontal",
            "aria-label": "\u8C03\u6574\u533A\u6587\u4EF6\u6811\u4E0E\u5DE5\u4F5C\u533A\u533A\u9AD8\u5EA6",
            "aria-valuenow": Math.round(ratio * 100),
            "aria-valuemin": MIN_RATIO * 100,
            "aria-valuemax": MAX_RATIO * 100,
            tabIndex: 0,
            title: "\u62D6\u62FD\u8C03\u6574\u5206\u533A\uFF08\u2191/\u2193 \u5FAE\u8C03\uFF09",
            className: `fm-splitter-handle${dragging ? " fm-splitter-dragging" : ""}`,
            onPointerDown: onHandlePointerDown,
            onPointerMove: onHandlePointerMove,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
            onLostPointerCapture: endDrag,
            onKeyDown: onHandleKeyDown,
            style: {
              flex: "none",
              height: 6,
              cursor: "row-resize",
              touchAction: "none",
              // 触屏拖拽不被滚动吞掉
              display: "flex",
              alignItems: "center",
              outline: "none"
              // 焦点指示由 :focus-visible 样式提供（背景/指示条变亮）
            },
            children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "fm-splitter-bar", style: { width: "100%", borderRadius: RADIUS.pill } })
          }
        ) : null,
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "div",
          {
            style: {
              position: "relative",
              flex: fsCollapsed ? "0 0 auto" : "1 1 0%",
              height: fsCollapsed ? 32 : void 0,
              minHeight: 0,
              overflow: "hidden"
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                "div",
                {
                  style: {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    opacity: fsCollapsed ? 0 : 1,
                    transition: "opacity .15s ease",
                    pointerEvents: fsCollapsed ? "none" : "auto",
                    overflow: "hidden"
                  },
                  children: api === null ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { padding: 8, fontSize: FONT_SECONDARY, color: "var(--dsw-alias-label-secondary)" }, children: "\u65E0\u5DE5\u4F5C\u533A" }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(FileTree, { api, onOpenFile, toolbarKey: fsExpandSeq, scrollLock: fsAnimating }, api.root)
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                EdgeStrip,
                {
                  icon: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(FileBadgeFrame, {}),
                  title: "\u533A\u6587\u4EF6\u6811",
                  label: "\u5C55\u5F00\u533A\u6587\u4EF6\u6811",
                  onClick: toggleFs,
                  border: "top",
                  hidden: !fsCollapsed
                }
              ),
              foldButton(fsCollapsed ? "\u5C55\u5F00\u533A\u6587\u4EF6\u6811" : "\u6536\u8D77\u533A\u6587\u4EF6\u6811", fsCollapsed, toggleFs)
            ]
          }
        )
      ]
    }
  );
}

// src/client/file-address.ts
var FILE_ADDRESS_PREFIX = "dsh-resource://file/";
function isAbsoluteWorkspacePath(path) {
  return path.startsWith("/") || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith("\\\\");
}
function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(/%3A/gi, ":");
}
function encodePath(path) {
  return path.split("/").map(encodeSegment).join("/");
}
function sessionFileAddress(sessionId, path) {
  const normalized = path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`;
}
function fileAddressFor(sessionId, cwd, path) {
  const normalized = path.replace(/\\/g, "/");
  if (!isAbsoluteWorkspacePath(normalized)) return sessionFileAddress(sessionId, normalized);
  const root = cwd === void 0 ? "" : cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  if (root !== "" && normalized === root) return sessionFileAddress(sessionId, "");
  if (root !== "" && normalized.startsWith(`${root}/`)) {
    return sessionFileAddress(sessionId, normalized.slice(root.length + 1));
  }
  return sessionFileAddress(sessionId, normalized);
}

// src/client/image-document.ts
var IMAGE_PANZOOM_ID = "dsh-myagent/image-panzoom";
var IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"];
var IMAGE_MEDIA_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml"
};
function extensionOf(addressOrName) {
  const name = addressOrName.slice(addressOrName.lastIndexOf("/") + 1);
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
  }
  const dot = decoded.lastIndexOf(".");
  if (dot <= 0 || dot === decoded.length - 1) return null;
  return decoded.slice(dot + 1).toLowerCase();
}
function imageMediaTypeOf(address) {
  const ext = extensionOf(address);
  if (ext === null) return null;
  return IMAGE_MEDIA_TYPES[ext] ?? null;
}
function imagePanZoomDefinition() {
  return {
    id: IMAGE_PANZOOM_ID,
    extensions: IMAGE_EXTENSIONS,
    // 缺省即 'extension'（外部实现优先于内建）；显式写出来表明"有意压掉内建图片渲染器"。
    priority: "extension",
    title: () => "\u56FE\u7247\uFF08\u53EF\u62D6\u52A8\u7F29\u653E\uFF09",
    loading: "bytes-complete"
    // 不使用文档的换行偏好（那是文本渲染器的事），故不声明 wrap。
  };
}

// src/client/image-panzoom.tsx
var import_react9 = __toESM(require("react"), 1);

// src/client/image-view.ts
var MIN_SCALE = 0.02;
var MAX_SCALE = 32;
function clampScale(scale) {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}
function centeredView(natural, container) {
  return {
    scale: 1,
    tx: (container.width - natural.width) / 2,
    ty: (container.height - natural.height) / 2
  };
}
function fitWidthView(natural, container) {
  if (natural.width <= 0 || natural.height <= 0) return { scale: 1, tx: 0, ty: 0 };
  const scale = clampScale(container.width / natural.width);
  const height = natural.height * scale;
  return {
    scale,
    tx: (container.width - natural.width * scale) / 2,
    // 装得下 → 居中；装不下 → 顶到上沿（从图的上方开始看）
    ty: height <= container.height ? (container.height - height) / 2 : 0
  };
}
function panView(view, dx, dy) {
  return { scale: view.scale, tx: view.tx + dx, ty: view.ty + dy };
}
function zoomView(view, factor, anchor) {
  const scale = clampScale(view.scale * factor);
  if (scale === view.scale) return view;
  const imageX = (anchor.x - view.tx) / view.scale;
  const imageY = (anchor.y - view.ty) / view.scale;
  return { scale, tx: anchor.x - imageX * scale, ty: anchor.y - imageY * scale };
}
function clampView(view, natural, container, margin = 48) {
  const w = natural.width * view.scale;
  const h = natural.height * view.scale;
  const axis = (size, viewport, t) => {
    if (size <= viewport) return (viewport - size) / 2;
    const min = viewport - size - margin;
    const max = margin;
    return Math.min(max, Math.max(min, t));
  };
  return {
    scale: view.scale,
    tx: axis(w, container.width, view.tx),
    ty: axis(h, container.height, view.ty)
  };
}

// src/client/image-panzoom.tsx
var WHEEL_SENSITIVITY = 15e-4;
var CURSOR_CSS = `
.fm-zoom-host { cursor: grab; }
.fm-zoom-host.fm-zoom-dragging { cursor: grabbing; }
.fm-zoom-hint { transition: opacity .25s ease; }
`;
function ImagePanZoom({ resourceAddress, content }) {
  const hostRef = (0, import_react9.useRef)(null);
  const dragRef = (0, import_react9.useRef)(null);
  const [view, setView] = (0, import_react9.useState)({ scale: 1, tx: 0, ty: 0 });
  const [fitted, setFitted] = (0, import_react9.useState)(true);
  const [dragging, setDragging] = (0, import_react9.useState)(false);
  const [touched, setTouched] = (0, import_react9.useState)(false);
  const [natural, setNatural] = (0, import_react9.useState)(null);
  const [url, setUrl] = (0, import_react9.useState)(null);
  const [failed, setFailed] = (0, import_react9.useState)(false);
  const data = content?.kind === "bytes" ? content.data : void 0;
  (0, import_react9.useEffect)(() => {
    if (data === void 0) return;
    setFailed(false);
    const mime = imageMediaTypeOf(resourceAddress) ?? "application/octet-stream";
    const blob = new Blob([data], { type: mime });
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
    };
  }, [data, resourceAddress]);
  const containerSize = (0, import_react9.useCallback)(() => {
    const host2 = hostRef.current;
    if (host2 === null) return null;
    return { width: host2.clientWidth, height: host2.clientHeight };
  }, []);
  const applyFitWidth = (0, import_react9.useCallback)(() => {
    const size = containerSize();
    if (size === null || natural === null) return;
    setView(fitWidthView(natural, size));
    setFitted(true);
  }, [containerSize, natural]);
  const applyActualSize = (0, import_react9.useCallback)(() => {
    const size = containerSize();
    if (size === null || natural === null) return;
    setView(centeredView(natural, size));
    setFitted(false);
  }, [containerSize, natural]);
  const onImgLoad = (e) => {
    const img = e.currentTarget;
    const size = { width: img.naturalWidth, height: img.naturalHeight };
    setNatural(size);
    const host2 = containerSize();
    if (host2 !== null) setView(fitWidthView(size, host2));
    setFitted(true);
  };
  (0, import_react9.useLayoutEffect)(() => {
    const host2 = hostRef.current;
    if (host2 === null || natural === null) return;
    const observer = new ResizeObserver(() => {
      const size = containerSize();
      if (size === null) return;
      setView(fitWidthView(natural, size));
      setFitted(true);
    });
    observer.observe(host2);
    return () => observer.disconnect();
  }, [containerSize, natural]);
  (0, import_react9.useEffect)(() => {
    const host2 = hostRef.current;
    if (host2 === null || natural === null) return;
    const onWheel = (event) => {
      event.preventDefault();
      const rect = host2.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = Math.exp(-event.deltaY * WHEEL_SENSITIVITY);
      setView((current) => {
        const next = zoomView(current, factor, anchor);
        const size = containerSize();
        return size === null ? next : clampView(next, natural, size);
      });
      setFitted(false);
      setTouched(true);
    };
    host2.addEventListener("wheel", onWheel, { passive: false });
    return () => host2.removeEventListener("wheel", onWheel);
  }, [containerSize, natural]);
  const onPointerDown = (event) => {
    if (event.button !== 0 || natural === null) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view };
    setDragging(true);
    setTouched(true);
  };
  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId || natural === null) return;
    const size = containerSize();
    const moved = panView(drag.view, event.clientX - drag.x, event.clientY - drag.y);
    setView(size === null ? moved : clampView(moved, natural, size));
    setFitted(false);
  };
  const endDrag = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };
  const onDoubleClick = () => {
    if (fitted) applyActualSize();
    else applyFitWidth();
    setTouched(true);
  };
  const onKeyDown = (event) => {
    const size = containerSize();
    if (size === null || natural === null) return;
    const center = { x: size.width / 2, y: size.height / 2 };
    if (event.key === "+" || event.key === "=" || event.key === "Add") {
      event.preventDefault();
      setView((c) => clampView(zoomView(c, 1.25, center), natural, size));
      setFitted(false);
    } else if (event.key === "-" || event.key === "Subtract") {
      event.preventDefault();
      setView((c) => clampView(zoomView(c, 1 / 1.25, center), natural, size));
      setFitted(false);
    } else if (event.key === "0") {
      event.preventDefault();
      applyFitWidth();
    } else if (event.key === "1") {
      event.preventDefault();
      applyActualSize();
    }
    setTouched(true);
  };
  const percent = (0, import_react9.useMemo)(() => `${Math.round(view.scale * 100)}%`, [view.scale]);
  return import_react9.default.createElement(
    "div",
    {
      ref: hostRef,
      className: `fm-zoom-host${dragging ? " fm-zoom-dragging" : ""}`,
      tabIndex: 0,
      role: "img",
      "aria-label": `\u56FE\u7247\u9884\u89C8\uFF0C\u5F53\u524D\u7F29\u653E ${percent}\u3002\u62D6\u52A8\u5E73\u79FB\uFF0C\u6EDA\u8F6E\u7F29\u653E\uFF0C\u53CC\u51FB\u590D\u4F4D`,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onLostPointerCapture: endDrag,
      onDoubleClick,
      onKeyDown,
      style: {
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        touchAction: "none",
        // 触屏拖动不被页面滚动吞掉
        outline: "none",
        background: "var(--dsw-alias-bg-layer-1)"
      }
    },
    import_react9.default.createElement("style", null, CURSOR_CSS),
    failed ? import_react9.default.createElement(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          fontSize: 13,
          color: "var(--dsw-alias-label-secondary)"
        }
      },
      "\u56FE\u7247\u65E0\u6CD5\u89E3\u7801\uFF0C\u53EF\u80FD\u5DF2\u635F\u574F\u6216\u4E0D\u662F\u53D7\u652F\u6301\u7684\u683C\u5F0F"
    ) : null,
    url !== null && !failed ? import_react9.default.createElement("img", {
      src: url,
      alt: "",
      draggable: false,
      onLoad: onImgLoad,
      onError: () => setFailed(true),
      style: {
        position: "absolute",
        left: 0,
        top: 0,
        // transform-origin: 0 0 —— 与 image-view.ts 的数学模型一致（p_screen = p*scale + t）
        transformOrigin: "0 0",
        transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
        // 放大到像素级时用最近邻，避免浏览器把图糊成一片
        imageRendering: view.scale >= 4 ? "pixelated" : "auto",
        userSelect: "none",
        maxWidth: "none",
        maxHeight: "none",
        willChange: "transform"
      }
    }) : null,
    // 缩放比例常驻右下角；操作提示在首次交互后淡出。
    import_react9.default.createElement(
      "div",
      {
        style: {
          position: "absolute",
          right: 8,
          bottom: 8,
          padding: "2px 6px",
          // 官方 tag / 胶囊元素用全圆（此前 4px 偏方）；底色也改走官方 bg-layer-2 token。
          borderRadius: 999,
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          color: "var(--dsw-alias-label-secondary)",
          background: "var(--dsw-alias-bg-layer-2)",
          pointerEvents: "none"
        }
      },
      percent
    ),
    import_react9.default.createElement(
      "div",
      {
        className: "fm-zoom-hint",
        style: {
          position: "absolute",
          left: 8,
          bottom: 8,
          fontSize: 11,
          color: "var(--dsw-alias-label-secondary)",
          opacity: touched ? 0 : 1,
          pointerEvents: "none"
        }
      },
      "\u62D6\u52A8\u5E73\u79FB \xB7 \u6EDA\u8F6E\u7F29\u653E \xB7 \u53CC\u51FB\u9002\u5E94\u5BBD\u5EA6/100%"
    )
  );
}

// src/client/ErrorBoundary.tsx
var import_react10 = __toESM(require("react"), 1);
var import_jsx_runtime9 = require("react/jsx-runtime");
var ErrorBoundary = class extends import_react10.default.Component {
  state = { hasError: false };
  static getDerivedStateFromError(error) {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch(error, info) {
    console.error(`[dsh-myagent] ${this.props.label} \u6E32\u67D3\u51FA\u9519\uFF0C\u5DF2\u964D\u7EA7\u4E3A\u5360\u4F4D:`, error, info.componentStack);
  }
  /** 重试：清空错误态，触发子树重挂。 */
  retry = () => {
    this.setState({ hasError: false, message: void 0 });
  };
  render() {
    if (this.state.hasError) {
      return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 16,
            boxSizing: "border-box",
            height: "100%",
            fontSize: 13,
            textAlign: "center",
            color: "var(--dsw-alias-label-secondary)"
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { children: [
              this.props.label,
              "\u7EC4\u4EF6\u6E32\u67D3\u51FA\u9519\uFF1A",
              this.state.message ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
                "code",
                {
                  style: {
                    display: "block",
                    marginTop: 4,
                    fontSize: 11,
                    lineHeight: 1.5,
                    color: "var(--dsw-alias-label-secondary)",
                    wordBreak: "break-all",
                    whiteSpace: "pre-wrap"
                  },
                  children: this.state.message
                }
              ) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              "button",
              {
                type: "button",
                onClick: this.retry,
                style: {
                  cursor: "pointer",
                  padding: "4px 12px",
                  // 对齐官方 Button size="sm" 的 14px 圆角（此前 6px 明显偏方）。
                  borderRadius: RADIUS.control,
                  border: "0.5px solid var(--dsw-alias-border-l3)",
                  background: "var(--dsw-alias-bg-layer-1)",
                  color: "var(--dsw-alias-label-primary)",
                  fontSize: 13
                },
                children: "\u91CD\u8BD5"
              }
            )
          ]
        }
      );
    }
    return this.props.children;
  }
};

// src/client/ModeKeyButton.tsx
var import_react12 = __toESM(require("react"), 1);

// src/client/mode-store.ts
var import_react11 = __toESM(require("react"), 1);
var KEY = "dsh-myagent.mode";
var mode = (() => {
  try {
    return localStorage.getItem(KEY) === "myagent" ? "myagent" : "original";
  } catch {
    return "original";
  }
})();
var listeners2 = /* @__PURE__ */ new Set();
function getMode() {
  return mode;
}
function setMode(m) {
  if (m === mode) return;
  mode = m;
  try {
    localStorage.setItem(KEY, m);
  } catch {
  }
  for (const l of [...listeners2]) l();
}
function subscribeMode(cb) {
  listeners2.add(cb);
  return () => {
    listeners2.delete(cb);
  };
}
function useMode() {
  return import_react11.default.useSyncExternalStore(subscribeMode, getMode);
}

// src/client/ModeKeyButton.tsx
var MODE_CSS = `
/* \u5E95\u680F\u6A21\u5F0F\u952E\uFF1Ahover \u9762\u4E0E\u5B98\u65B9\u5E95\u680F\u56FE\u6807\u952E\u4E00\u81F4\uFF0828~32px \u65B9\u6846 + \u6B63\u5706\uFF09\u3002
   \u6CE8\u610F .fm-mk-chip\uFF08MA logo \u65B9\u7247\u672C\u8EAB\uFF09\u7684 18px / 6px \u5706\u89D2\u662F\u7528\u6237 v7 \u5B9A\u6848\uFF0C\u672C\u8F6E\u4E0D\u52A8\u3002 */
.fm-mk-btn{box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border:none;border-radius:50%;background:transparent;cursor:pointer;padding:0}
.fm-mk-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
// 2026-08-15 \u534F\u8C03\u6027\u8C03\u6574 v2\uFF08\u7528\u6237\u53CD\u9988\uFF09\uFF1Achip 22\u219218px\uFF08\u4E0E\u5DE6\u53F3 18px \u7EBF\u6761\u56FE\u6807\u540C\u5C3A\u5BF8\uFF09\u3001
// \u5706\u89D2 7\u21926px\uFF1BMyAgent \u6001\u7684\u9ED1\u5E95\u4E0D\u518D\u7528\u7EAF\u9ED1\u2014\u2014\u6DF1\u8272\u4E3B\u9898\u4E0B\u6539\u4E3A\u4FA7\u680F\u80CC\u666F\u8272
// \uFF08--dsw-specific-sidebar-fill = bluish-900\uFF09\uFF0C\u9ED1\u65B9\u5757\u878D\u5165\u4FA7\u680F\uFF0C\u53EA\u6D6E\u73B0\u767D\u8272 MA \u5B57\u6BCD\uFF0C
// \u4E0E\u5DE6\u53F3\u767D\u8272\u7EBF\u6761\u56FE\u6807\u540C\u91CD\u91CF\uFF1B\u6D45\u8272\u4E3B\u9898\u4FDD\u6301\u7EAF\u9ED1\u65B9\u5757\uFF08\u53CD\u8272\u6548\u679C\u4FDD\u7559\uFF09\u3002
// v3\uFF08\u7528\u6237\u53CD\u9988\uFF09\uFF1Achip 18\u219216px\uFF0C\u7EE7\u7EED\u7F29\u5C0F\u5DE6\u4E0B\u89D2 MA \u56FE\u6807\u3002
// v4\uFF08\u7528\u6237\u53CD\u9988\uFF09\uFF1Achip 16\u219212px\uFF1B\u5706\u89D2 6\u21924px\uFF0C\u4FDD\u6301\u5706\u89D2\u65B9\u5757\u6BD4\u4F8B\uFF08\u907F\u514D 12px/6px \u53D8\u6210\u6B63\u5706\uFF09\u3002
// v5\uFF08\u7528\u6237\u53CD\u9988\uFF09\uFF1Achip 12\u21926px\uFF1B\u5706\u89D2 4\u21922px\uFF0C\u4FDD\u6301\u5706\u89D2\u65B9\u5757\u6BD4\u4F8B\u3002
// v6\uFF08\u8C03\u8BD5\uFF09\uFF1A6px \u4EC5\u7528\u4E8E\u786E\u8BA4\u7F13\u5B58\u95EE\u9898\uFF1B\u786E\u8BA4\u540E\u5148\u6539\u56DE 12px\u3002
// v7\uFF08\u6700\u7EC8\uFF0C\u7528\u6237\u786E\u8BA4\uFF09\uFF1Achip \u56DE\u5230 18px\uFF0C\u5706\u89D2 6px\uFF08\u4E0E v2 \u4E00\u81F4\uFF09\u3002
.fm-mk-chip{width:18px;height:18px;border-radius:6px;overflow:hidden;flex:none;box-shadow:0 0 0 1px rgba(0,0,0,.08)}
.fm-mk-bg{fill:#ffffff}
.fm-mk-bg.fm-mk-bg-dark{fill:#000000}
body[data-ds-dark-theme] .fm-mk-bg.fm-mk-bg-dark{fill:var(--dsw-specific-sidebar-fill)}
`;
var MA_BG = "M0,278.58V0h278.58v278.58H0ZM57.32,154.21l-.03-40.63-.04-24.55,2.58,5.15,3.58,7.34,12.17,26.29,10,21.42,5.94,12.63,6.16,13.11,14.37-32.22,6.18-14.47,9.83-23.15,18.12-42.47,8.94-21.05-26.96.07-13.52,30.96-12.42,28.39-5.41,11.94-10.69-23.09-8.78-18.76-9.75-20.84c-1.35-2.89-2.66-5.49-3.97-8.6l-35.1.04.12,21.38-.04,134.78v39.84s28.73.01,28.73.01l-.04-41.64.02-41.87ZM225.72,211.87l8.82,25.89,11.57-.1,23.8.08-4.9-13.8-5.99-17.44-13.98-40.13-14-40.71-7.93-22.54-6.19-17.77-9.4-26.72-2.9-8.26-3.13-8.68-31.81.06-21.17,52.06-7.25,17.98-7.46,18.61-15.18,37.66-5.51,13.78-10.18,25.15-12.87,30.75,36.54-.06,12.65-32.16,2.87-7.4,21.25-.1,42.92.04,14.6.1,4.83,13.71Z";
var MA_M = "M226.1,211.91l-4.83-13.71-14.6-.1-42.92-.04-21.25.1-2.87,7.4-12.65,32.16-36.54.06,12.87-30.75,10.18-25.15,5.51-13.78,15.18-37.66,7.46-18.61,7.25-17.98,21.17-52.06,31.81-.06,3.13,8.68,2.9,8.26,9.4,26.72,6.19,17.77,7.93,22.54,14,40.71,13.98,40.13,5.99,17.44,4.9,13.8-23.8-.08-11.57.1-8.82-25.89ZM152.98,166.4h33.69s26.23.16,26.23.16l-3.46-10.37-10.04-29.89-14.97-43.36-1.83,4.97-12.97,34.33-3.28,8.68-4,10.74-2.92,7.61-6.43,17.14Z";
var MA_A = "M57.7,154.26l-.02,41.87.04,41.64h-28.74s0-39.85,0-39.85l.04-134.78-.12-21.38,35.1-.04c1.31,3.11,2.61,5.71,3.97,8.6l9.75,20.84,8.78,18.76,10.69,23.09,5.41-11.94,12.42-28.39,13.52-30.96,26.96-.07-8.94,21.05-18.12,42.47-9.83,23.15-6.18,14.47-14.37,32.22-6.16-13.11-5.94-12.63-10-21.42-12.17-26.29-3.58-7.34-2.58-5.15.04,24.55.03,40.63Z";
var MA_NOTCH = "152.98,166.4 159.41,149.26 162.33,141.65 166.34,130.91 169.62,122.22 182.59,87.9 184.43,82.93 199.4,126.29 209.44,156.18 212.9,166.55 186.68,166.41 152.98,166.4";
function ensureCss() {
  if (typeof document === "undefined") return;
  const existing = document.querySelector("style[data-fm-mk]");
  if (existing) {
    existing.setAttribute("data-plugin", "dsh-myagent");
    existing.textContent = MODE_CSS;
    return;
  }
  const tag = document.createElement("style");
  tag.dataset.fmMk = "1";
  tag.dataset.plugin = "dsh-myagent";
  tag.textContent = MODE_CSS;
  document.head.appendChild(tag);
}
function MaLogoIcon({ dark }) {
  const fg = dark ? "#ffffff" : "#000000";
  const bgCls = dark ? "fm-mk-bg fm-mk-bg-dark" : "fm-mk-bg";
  return import_react12.default.createElement(
    "div",
    {
      className: "fm-mk-chip",
      // 内联尺寸兜底：即使外部 style 因 HMR/缓存残留未更新，也能强制最终尺寸。
      style: {
        width: 18,
        height: 18,
        borderRadius: 6,
        overflow: "hidden",
        flex: "none",
        boxShadow: "0 0 0 1px rgba(0,0,0,.08)"
      }
    },
    import_react12.default.createElement(
      "svg",
      { viewBox: "0 0 278.58 278.58", width: "100%", height: "100%", display: "block", "aria-hidden": true },
      import_react12.default.createElement("path", { className: bgCls, d: MA_BG }),
      import_react12.default.createElement("path", { fill: fg, d: MA_M }),
      import_react12.default.createElement("path", { fill: fg, d: MA_A }),
      import_react12.default.createElement("polygon", { className: bgCls, points: MA_NOTCH })
    )
  );
}
function ModeKeyButton() {
  ensureCss();
  const mode2 = useMode();
  const on = mode2 === "myagent";
  return import_react12.default.createElement("button", {
    className: "fm-mk-btn",
    title: on ? "MyAgent \u6A21\u5F0F\uFF08\u70B9\u51FB\u5207\u6362\u6807\u51C6\u6A21\u5F0F\uFF09" : "\u6807\u51C6\u6A21\u5F0F\uFF08\u70B9\u51FB\u5207\u6362 MyAgent \u6A21\u5F0F\uFF09",
    "data-active": on ? "true" : void 0,
    onClick: () => setMode(on ? "original" : "myagent")
  }, import_react12.default.createElement(MaLogoIcon, { dark: on }));
}

// src/client/MyAgentBrand.tsx
var import_react13 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives7 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/brand-metrics.ts
var WORDMARK_ASPECT = 156 / 24;
var WORDMARK_SIZE = 16;
var LOCKUP_GAP = 3;
var SEP_WIDTH = 1;
var TAG_WIDTH = 54;
var MARK_AND_GAP = 24 + 6;
var LOCKUP_WIDTH = WORDMARK_SIZE * WORDMARK_ASPECT + LOCKUP_GAP + SEP_WIDTH + LOCKUP_GAP + TAG_WIDTH;
var HOST_SIDEBAR_MIN = 264;
var HOST_SIDEBAR_MAX = 420;
var SIDEBAR_INLINE_PADDING = 12;
var LOGO_ROW_OVERHEAD = 4 + 28 + 8;
function brandWidthFor(sidebarWidth) {
  return sidebarWidth - 2 * SIDEBAR_INLINE_PADDING - LOGO_ROW_OVERHEAD;
}
var HOST_MIN_BRAND_WIDTH = brandWidthFor(HOST_SIDEBAR_MIN);
var HOST_MAX_BRAND_WIDTH = brandWidthFor(HOST_SIDEBAR_MAX);
var TAG_VISIBLE_MIN_BRAND_WIDTH = MARK_AND_GAP + LOCKUP_WIDTH + 2;
var MIN_NAME_SLOT_BUDGET = HOST_MIN_BRAND_WIDTH - MARK_AND_GAP;
var NAME_SLOT_BUDGET = brandWidthFor(280) - MARK_AND_GAP;

// src/client/MyAgentBrand.tsx
var HostWordmark = import_dsh_client_ui_primitives7.BrandWordmark;
var BRAND_CSS = `
/* \u5DE6\u4E0A\u89D2 logo \u5757\u7684 MYAGENT \u5B57\u6837\uFF08sidebar.brand.name \u69FD\u5185\uFF09\u3002
   \u5168\u7528\u5BBF\u4E3B\u65E2\u6709\u6392\u7248\u5C5E\u6027\uFF1Acolor:inherit \u8DDF\u968F .hHd-Xa_brandName \u7684 label-primary\uFF0C
   \u7AD6\u7EBF\u7528 currentColor + \u900F\u660E\u5EA6\uFF0C\u6DF1\u6D45\u4E3B\u9898\u90FD\u4E0D\u9700\u8981\u989D\u5916\u5206\u652F\u3002
   \u5C3A\u5BF8\u89C1 brand-metrics.ts\uFF1A\u9501\u578B 164px\uFF0C\u5BBF\u4E3B\u6700\u7A84\u6863\u7684 name \u69FD\u662F 170px \u2192 \u6574\u6761\u653E\u5F97\u4E0B\u3002 */
.fm-bn-root{display:flex;align-items:center;gap:3px;min-width:0;flex:none}
.fm-bn-wordmark{display:inline-flex;align-items:center;flex:none}
.fm-bn-sep{flex:none;width:1px;height:11px;background:currentColor;opacity:.28}
.fm-bn-tag{flex:none;font-size:10px;font-weight:700;letter-spacing:.08em;line-height:1;color:inherit;white-space:nowrap}
`;
function ensureCss2() {
  if (typeof document === "undefined") return;
  const existing = document.querySelector("style[data-fm-bn]");
  if (existing) {
    existing.setAttribute("data-plugin", "dsh-myagent");
    existing.textContent = BRAND_CSS;
    return;
  }
  const tag = document.createElement("style");
  tag.dataset.fmBn = "1";
  tag.dataset.plugin = "dsh-myagent";
  tag.textContent = BRAND_CSS;
  document.head.appendChild(tag);
}
function MyAgentBrandName() {
  ensureCss2();
  const rootRef = import_react13.default.useRef(null);
  const [roomy, setRoomy] = import_react13.default.useState(true);
  import_react13.default.useEffect(() => {
    const root = rootRef.current;
    const brandButton = root?.closest("button") ?? null;
    if (!brandButton || typeof ResizeObserver === "undefined") return;
    const measure = () => setRoomy(brandButton.clientWidth >= TAG_VISIBLE_MIN_BRAND_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(brandButton);
    return () => observer.disconnect();
  }, []);
  return import_react13.default.createElement(
    "div",
    { ref: rootRef, className: "fm-bn-root", "data-fm-brand-myagent": "1" },
    HostWordmark ? import_react13.default.createElement(
      "span",
      { className: "fm-bn-wordmark" },
      import_react13.default.createElement(HostWordmark, { size: WORDMARK_SIZE, includeMark: false })
    ) : null,
    roomy ? [
      import_react13.default.createElement("span", { key: "sep", className: "fm-bn-sep", "aria-hidden": "true" }),
      import_react13.default.createElement("span", { key: "tag", className: "fm-bn-tag" }, "MYAGENT")
    ] : null
  );
}

// src/client/IconOnlySettingsTrigger.tsx
var import_react14 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives8 = require("@deepseek-ai/dsh-client-ui-primitives");
function IconOnlySettingsTrigger(props) {
  return props.wide ? import_react14.default.createElement(import_dsh_client_ui_primitives8.IconSettingsOutline16, { size: 18 }) : import_react14.default.createElement(import_dsh_client_ui_primitives8.IconSettingsOutline14, { size: 18 });
}

// src/client/settings-compact.ts
var CSS = `
.hHd-Xa_footArea{position:relative;padding:8px 0 3px;border-top:1px solid var(--dsw-alias-border-l1)}
.hHd-Xa_settingsArea{position:absolute;top:8px;left:0;width:32px;height:32px;display:flex;align-items:center;justify-content:center;z-index:auto}
/* \u5B98\u65B9\u8BBE\u7F6E\u5F39\u7A97 overlay \u867D\u7136\u662F z-index:1000\uFF0C\u4F46\u82E5 settingsArea \u521B\u5EFA\u5C40\u90E8\u5C42\u53E0\u4E0A\u4E0B\u6587\uFF0C
   \u5F39\u7A97\u4F1A\u88AB\u56F0\u5728 sidebar \u7684 z-index:1 \u5C42\u91CC\uFF0C\u88AB\u53F3\u4FA7\u67E5\u770B\u5668/\u4E3B\u533A\u91CC\u66F4\u9AD8\u7684 z-index \u5185\u5BB9\u76D6\u4F4F\u3002
   \u8FD9\u91CC\u53BB\u6389 settingsArea \u7684\u5C42\u53E0\u4E0A\u4E0B\u6587\uFF08\u4E0A\u9762 z-index:auto\uFF09\uFF0C\u5E76\u628A overlay \u63D0\u5230 1200\uFF0C
   \u786E\u4FDD\u8BBE\u7F6E\u5F39\u7A97\u59CB\u7EC8\u5728\u6240\u6709\u666E\u901A UI / \u83DC\u5355\uFF08z-index \u22641100\uFF09\u4E4B\u4E0A\u3002 */
.VOzbGW_overlay{z-index:1200 !important}
.hHd-Xa_settingsArea .VOzbGW_trigger{box-sizing:border-box;width:32px;height:32px;min-width:0;margin:0;padding:0;border-radius:6px;justify-content:center;gap:0;display:flex;align-items:center;background:transparent}
.hHd-Xa_settingsArea .VOzbGW_trigger:hover{background:var(--dsw-alias-bg-layer-1)}
.hHd-Xa_footerActions{padding-left:36px;align-items:center}
.hHd-Xa_collapsed .hHd-Xa_footArea{padding:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:0}
.hHd-Xa_collapsed .hHd-Xa_settingsArea{position:static;order:2;width:auto;height:auto;min-height:0;margin:0;padding:0;display:flex;justify-content:center}
.hHd-Xa_collapsed .hHd-Xa_settingsArea .VOzbGW_trigger{width:36px;height:36px;margin:0 0 10px;padding:0;border-radius:50%;justify-content:center}
.hHd-Xa_collapsed .hHd-Xa_footerActions{order:-1;padding-left:0;width:auto;margin:0;display:flex;justify-content:center}
.hHd-Xa_collapsed .hHd-Xa_footerActions .fm-mk-btn{width:36px;height:36px;margin:10px 0 0}
`;
function ensureSettingsCompactCss() {
  if (typeof document === "undefined") return;
  const existing = document.querySelector("style[data-fm-settings-compact]");
  if (existing) {
    existing.setAttribute("data-plugin", "dsh-myagent");
    existing.textContent = CSS;
    return;
  }
  const tag = document.createElement("style");
  tag.dataset.fmSettingsCompact = "1";
  tag.dataset.plugin = "dsh-myagent";
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

// src/client/client.ts
var inject = ["slots", "sessions", "workspaces", "sidebarRight", "sidebarRightTabs"];
var OFFICIAL_FILES_KIND = "files";
var FILES_SHADOW_ID = "dsh-myagent/files-removed";
var enhancementDisposers = [];
var appliedCtx = null;
function buildActions(ctx) {
  return () => ({
    startSession: async (workspaceId) => {
      let target = workspaceId;
      if (target === void 0) {
        const ws = ctx.workspaces.list.getSnapshot();
        const sessions = ctx.sessions.list.getSnapshot();
        const currentWorkspaceId = sessions.current === void 0 ? void 0 : ws.items.find((item) => (item.sessionIds ?? []).includes(sessions.current))?.workspaceId;
        target = currentWorkspaceId ?? ws.recentWorkspaceId;
      }
      if (target === void 0) {
        ctx.workspaces.startSession();
        return;
      }
      const sessionId = await ctx.sessions.create({ workspaceId: target });
      ctx.sessions.open(sessionId);
    },
    // 新建工作区：宿主原生目录选择器选一个已存在目录 → workspace.create 注册。
    addWorkspace: async () => {
      const path = await ctx.workspaces.pickDirectory();
      if (path === null) return;
      await ctx.workspaces.create({ path });
    },
    open: (sessionId) => {
      ctx.sessions.open(sessionId);
    },
    renameSession: async (sessionId, title) => {
      const session = ctx.sessions.binding(sessionId)?.session;
      if (session === void 0) throw new Error(`unknown session "${sessionId}"`);
      const result = await session.rename(title);
      if (!result.ok) throw new Error(result.error.message);
    },
    renameWorkspace: async (workspaceId, title) => {
      await ctx.workspaces.rename(workspaceId, title);
    },
    deleteWorkspace: async (workspaceId) => {
      await ctx.workspaces.delete(workspaceId);
    },
    archiveSession: async (sessionId) => {
      await ctx.workspaces.archiveSession(sessionId);
    },
    // 拖拽排序：beforeWorkspaceId/beforeSessionId 省略（undefined）时追加到末尾
    // （runtime client.js insertBefore 注释：omitted appends）。
    insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
      await ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId);
    },
    insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
      await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId);
    }
  });
}
function openFileInPreview(ctx, sessionId, cwd, absPath) {
  try {
    ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, absPath));
  } catch (err) {
    console.warn("[dsh-myagent] cannot open preview tab", err);
  }
}
function filesShadowDefinition() {
  return {
    id: FILES_SHADOW_ID,
    kind: OFFICIAL_FILES_KIND,
    priority: "extension",
    // title 只在 placeTab 打开该页时用到；该页已无入口，给个可读名字即可。
    title: () => "\u5DE5\u4F5C\u533A\u6587\u4EF6"
    // 没有 guide 字段 = 不上 guide 页；没有 patterns = 不参与任何地址认领。
  };
}
function registerEnhancements(ctx) {
  if (enhancementDisposers.length > 0) return;
  const actions = buildActions(ctx);
  enhancementDisposers.push(
    ctx.slots.inject(
      "sidebar.brand.name",
      () => ctx.slots.register({ name: "sidebar.brand.name", priority: -100 }, MyAgentBrandName)
    )
  );
  enhancementDisposers.push(
    ctx.slots.inject(
      "sidebar.workspaces",
      () => ctx.slots.register({ name: "sidebar.workspaces", priority: -100, inject: actions }, Composed)
    )
  );
  enhancementDisposers.push(
    ctx.effect(() => ctx.sidebarRightTabs.register(filesShadowDefinition()), "dsh-myagent: hide official files type")
  );
  enhancementDisposers.push(
    ctx.slots.inject(
      "sidebar.right.pane.tab",
      () => ctx.slots.register({ name: "sidebar.right.pane.tab", key: FILES_SHADOW_ID }, FilesRemovedBody)
    )
  );
  enhancementDisposers.push(
    ctx.slots.inject(
      "sidebar.right.tab.document",
      () => ctx.slots.register({ name: "sidebar.right.tab.document", key: IMAGE_PANZOOM_ID }, ImagePanZoom)
    )
  );
  const imageRendererHandle = ctx.inject(["documentPreviews"], (scope) => {
    scope.effect(
      () => scope.documentPreviews.register(imagePanZoomDefinition()),
      "dsh-myagent: image pan/zoom renderer"
    );
  });
  enhancementDisposers.push(
    typeof imageRendererHandle === "function" ? imageRendererHandle : () => imageRendererHandle?.dispose?.()
  );
}
function unregisterEnhancements() {
  for (const d of enhancementDisposers) d();
  enhancementDisposers = [];
}
function syncEnhancements() {
  if (appliedCtx === null) return;
  if (getMode() === "myagent") registerEnhancements(appliedCtx);
  else unregisterEnhancements();
}
function apply(ctx) {
  appliedCtx = ctx;
  syncEnhancements();
  subscribeMode(syncEnhancements);
  ctx.slots.inject(
    "sidebar.footer.action",
    () => ctx.slots.register({ name: "sidebar.footer.action", id: "dsh-myagent-mode", order: 0 }, ModeKeyButton)
  );
  ctx.slots.inject(
    "settings.trigger",
    () => ctx.slots.register({ name: "settings.trigger", priority: -100 }, IconOnlySettingsTrigger)
  );
  ensureSettingsCompactCss();
}
function Composed(props) {
  return import_react15.default.createElement(
    ErrorBoundary,
    { label: "\u5DE5\u4F5C\u533A\u5217\u8868" },
    import_react15.default.createElement(ComposedInner, props)
  );
}
function ComposedInner(props) {
  const sessions = props.useSessions((s) => s);
  const workspaces = props.useWorkspaces((s) => s);
  const manualRoot = useActiveRoot();
  const root = (0, import_react15.useMemo)(() => {
    const derived = resolveRoot(sessions, workspaces);
    if (manualRoot !== null && workspaces.items.some((w) => w.path === manualRoot)) return manualRoot;
    return derived;
  }, [manualRoot, sessions, workspaces]);
  const api = (0, import_react15.useMemo)(() => root === null ? null : new Api(root), [root]);
  const ctx = appliedCtx;
  const currentSession = sessions.current;
  const lastSession = (0, import_react15.useRef)(currentSession);
  (0, import_react15.useEffect)(() => {
    if (lastSession.current === currentSession) return;
    lastSession.current = currentSession;
    clearActiveRoot();
  }, [currentSession]);
  const onOpenFile = (0, import_react15.useCallback)(
    (p) => {
      if (api === null || ctx === null) return;
      const target = sessionForRoot(sessions, workspaces, api.root);
      if (target === null) {
        console.warn("[dsh-myagent] no session belongs to workspace", api.root);
        return;
      }
      openFileInPreview(ctx, target.sessionId, target.cwd, resolveAbsPath(api.root, p));
    },
    [api, ctx, sessions, workspaces]
  );
  return import_react15.default.createElement(SidebarComposite, { ...props, api, onOpenFile });
}
function FilesRemovedBody() {
  return import_react15.default.createElement(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: 16,
        fontSize: FONT_SECONDARY,
        lineHeight: 1.6,
        textAlign: "center",
        color: "var(--dsw-alias-label-secondary)"
      }
    },
    "\u5B98\u65B9\u6587\u4EF6\u6811\u5DF2\u5728 MyAgent \u6A21\u5F0F\u4E2D\u9690\u85CF\uFF0C\u8BF7\u4F7F\u7528\u5DE6\u4FA7\u7684\u300C\u533A\u6587\u4EF6\u6811\u300D\u6D4F\u89C8\u6587\u4EF6\u3002"
  );
}

return module.exports;
}});

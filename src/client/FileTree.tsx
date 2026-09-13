// src/client/FileTree.tsx — 懒加载区文件树（Task 7 初版；UI polish 轮升级；Round 2 加
// "复制项目地址"；0.1.5 轮文件图标对齐官方）。api 由 props 传入（SidebarComposite 用
// resolveRoot 推导工作区根后构造）；点击文件触发 onOpenFile（0.1.5 起在右侧栏打开
// myagent 查看器标签页，见 client.ts 的 openFileInViewer）。
// 文件图标用宿主的 FileTypeIcon + classifyFileType（与官方 ui-sidebar-files 文件树同款，
// 按扩展名着色）；目录仍用"展开/收起"两态文件夹图标（官方只有收起态，此处保留更好的一档）。
// 右键改悬浮菜单（primitives Menu，原生样式），新建/重命名/移动走 Modal+Input，删除为
// 菜单内二次确认——不再使用 window.prompt/confirm。
// 颜色/交互全部走 --dsw-* token（宿主主题注入），无硬编码色值。
// 折叠（rail）模式（宿主整体 rail 用，区级折叠不再传 collapsed）：collapsed=true 时不
// 渲染树，只显示竖向图标列（展开区文件树 / ＋新建 / 刷新，与工作区区 rail 风格一致）；
// headerExtra 由 SidebarComposite 注入折叠切换按钮（标题栏右侧）。树状态
// （roots/openDirs）在折叠期间保留，展开后原样恢复。
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FileBadge } from "./FileBadge.tsx";
import { FileIcon } from "./file-icon.tsx";
import {
  Button,
  IconBrowseOutline16,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconCopyOutline16,
  IconEditOutline16,
  IconFolderClose16,
  IconFolderOpenOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconRightUpOutline16,
  IconTrashOutline16,
  IconTriangleRightFill14,
  Menu,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { Api } from "./api.ts";
import { describeApiError } from "./api.ts";
import { joinRel, resolveAbsPath, sortEntries, validateNameInput, type TreeEntry } from "./tree-utils.ts";
import { ContextMenu, PromptModal, useCloseOnScroll, type ContextMenuItem } from "./ContextMenu.tsx";
import { ICON_BTN_STYLE } from "./WorkspaceBrowser.tsx";
import { FONT_SECONDARY, HEADER_BORDER, RADIUS, TREE_ROW } from "./ui-kit.ts";
// 行 hover 用宿主 CSS 类（token 化，避免每行 onMouseEnter 重渲染）；选中态走内联
// interactive 背景 token（inline 优先于类，hover 不会盖掉选中）。
// 行圆角由官方 6px 视觉档统一到官方文件树的 10px（RADIUS.treeRow）。
const TREE_CSS = `
.fm-tree-row{border-radius:${RADIUS.treeRow}px}
.fm-tree-row:hover{background:var(--dsw-specific-sidebar-nav-item-hover)}
`;

/**
 * 复制文本到剪贴板：优先 navigator.clipboard（需要 secure context + 用户手势），
 * 失败回退 textarea + document.execCommand("copy")（旧浏览器/非安全上下文）。
 * 返回是否成功。
 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      // 不可见但不 display:none（execCommand 需要元素可聚焦/可选中）。
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      document.body.appendChild(ta);
      try {
        ta.select();
        return document.execCommand("copy");
      } finally {
        // finally 兜底：select/execCommand 抛异常也移除 textarea，不留残留 DOM
        // （appendChild 成功才会进入此 try，removeChild 恒安全）。
        document.body.removeChild(ta);
      }
    } catch {
      return false;
    }
  }
}

type Dialog =
  | { kind: "new-file" | "new-folder"; base: string }
  | { kind: "rename" | "move"; entry: TreeEntry; base: string };

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function FileTree({ api, onOpenFile, headerExtra, toolbarKey, scrollLock }: {
  api: Api;
  onOpenFile: (path: string) => void;
  /** 标题栏右侧追加内容（SidebarComposite 注入区级折叠切换按钮）。 */
  headerExtra?: React.ReactNode;
  /** 标题栏按钮组 key（每次展开递增，强制重挂载按钮组以重放 stagger 滑入动画）。 */
  toolbarKey?: number;
  /** 区容器高度过渡期间置 true：树滚动区临时 hidden（避免滚动条闪现抖动）。 */
  scrollLock?: boolean;
}) {
  const [roots, setRoots] = useState<TreeEntry[] | null>(null);
  const [openDirs, setOpenDirs] = useState<Record<string, TreeEntry[]>>({});
  // 最高级一层树：当前工作区地址根节点行（默认展开；收起后目录树整体隐藏）。
  const [rootOpen, setRootOpen] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: TreeEntry } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toolbarOpen, setToolbarOpen] = useState(false);
  // "复制项目地址"成功后的瞬时反馈（菜单项短暂变为"已复制 ✓"，1.5s 后恢复，不关闭菜单）。
  const [copiedPath, setCopiedPath] = useState(false);
  // 复位计时器句柄：新复制先清旧句柄（1.5s 内两次复制不会因旧计时器提前复位），
  // 卸载/菜单关闭时也清理，避免卸载后 setState 与计时器泄漏。
  const copiedTimerRef = useRef<number | null>(null);
  // 工具条"+新建"菜单：滚动即收起（fixed 定位菜单不随内容滚动，继续显示会错位）。
  useCloseOnScroll(() => setToolbarOpen(false));

  // 清除"已复制 ✓"复位计时器（复制成功重新计时前 / 菜单关闭 / 卸载时复用）。
  const clearCopiedTimer = () => {
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearCopiedTimer(); // 卸载时清掉挂起的复位计时器
    };
  }, []);

  const reload = useCallback(async () => {
    const res = await api.tree("");
    if (res.ok) {
      setRoots(sortEntries(res.data.entries));
      setError(null);
    } else {
      setError(describeApiError(res));
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggleDir = async (entry: TreeEntry) => {
    if (openDirs[entry.path]) {
      setOpenDirs((o) => {
        const n = { ...o };
        delete n[entry.path];
        return n;
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

  const runOp = (op: "mkdir" | "rename" | "remove" | "move", path: string, to?: string) =>
    api.op(op, path, to).then((res) => {
      if (res.ok) void reload();
      else setError(describeApiError(res));
    });

  // 右键菜单项（随条目类型与展开态变化）。
  const menuItemsFor = (entry: TreeEntry): ContextMenuItem[] => {
    const isDir = entry.kind === "dir";
    // 根节点（path === ""，工作区地址行）：展开/收起切 rootOpen；禁止重命名/删除/移动。
    const isRoot = entry.path === "";
    const parent = parentOf(entry.path);
    const open = Boolean(openDirs[entry.path]);
    const items: ContextMenuItem[] = [];
    if (isDir) {
      items.push({
        key: "toggle",
        label: open ? "收起" : "展开",
        icon: open ? <IconChevronDownOutline14 size={14} /> : <IconTriangleRightFill14 size={14} />,
        onSelect: () => (isRoot ? setRootOpen((v) => !v) : void toggleDir(entry)),
      });
    } else {
      items.push({
        key: "open",
        label: "打开",
        icon: <IconBrowseOutline16 size={16} />,
        onSelect: () => onOpenFile(entry.path),
      });
    }
    // 复制项目地址（放在"打开"下方）：复制绝对路径（api.root + "/" + entry.path）。
    // keepOpen：不关闭菜单，成功后在原位上短暂显示"已复制 ✓"（1.5s 恢复）。
    items.push({
      key: "copy-path",
      label: copiedPath ? "已复制 ✓" : "复制项目地址",
      icon: copiedPath ? <IconCheckOutline16 size={16} /> : <IconCopyOutline16 size={16} />,
      keepOpen: true,
      onSelect: () => {
        void copyTextToClipboard(resolveAbsPath(api.root, entry.path)).then((ok) => {
          if (!ok) return; // 复制失败保持原菜单项（不切换成"已复制"）
          setCopiedPath(true);
          // 先清旧句柄再设新：1.5s 内两次复制不会因旧计时器提前复位。
          clearCopiedTimer();
          copiedTimerRef.current = window.setTimeout(() => {
            copiedTimerRef.current = null;
            setCopiedPath(false);
          }, 1500);
        });
      },
    });
    items.push({ key: "sep1", separator: true });
    items.push({
      key: "new-file",
      label: "新建文件",
      icon: <IconPlusOutline16 size={16} />,
      onSelect: () => setDialog({ kind: "new-file", base: isDir ? entry.path : parent }),
    });
    items.push({
      key: "new-folder",
      label: "新建文件夹",
      icon: <IconFolderClose16 size={16} />,
      onSelect: () => setDialog({ kind: "new-folder", base: isDir ? entry.path : parent }),
    });
    items.push({ key: "sep2", separator: true });
    if (!isRoot) {
      items.push({
        key: "rename",
        label: "重命名",
        icon: <IconEditOutline16 size={16} />,
        onSelect: () => setDialog({ kind: "rename", entry, base: parent }),
      });
      items.push({
        key: "delete",
        label: "删除",
        icon: <IconTrashOutline16 size={16} />,
        danger: true,
        confirmLabel: "确认删除？",
        onSelect: () => void runOp("remove", entry.path),
      });
      items.push({
        key: "move",
        label: "移动…",
        icon: <IconRightUpOutline16 size={16} />,
        onSelect: () => setDialog({ kind: "move", entry, base: parent }),
      });
    }
    items.push({ key: "sep3", separator: true });
    items.push({
      key: "refresh",
      label: "刷新",
      icon: <IconRefreshOutline16 size={16} />,
      onSelect: () => void reload(),
    });
    return items;
  };

  const renderEntries = (entries: TreeEntry[], depth: number) =>
    entries.map((entry) => (
      <div key={entry.path}>
        <div
          className="fm-tree-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: TREE_ROW.gap,
            // 官方文件树：每级缩进 18px、行内边距 5px 10px（内层 wrapper 再让 8px）。
            padding: `${TREE_ROW.paddingY}px ${TREE_ROW.paddingX}px ${TREE_ROW.paddingY}px ${TREE_ROW.paddingX + depth * TREE_ROW.indent}px`,
            cursor: "pointer",
            // 选中态：interactive-bg-active（sidebar 内行选中等价物）；圆角对齐官方 10px。
            background: selected === entry.path ? "var(--dsw-alias-interactive-bg-active)" : undefined,
            color: "var(--dsw-alias-label-primary)",
            whiteSpace: "nowrap",
          }}
          onClick={() => {
            // 菜单打开时点击树行：只收起菜单，不触发选中/展开/打开（避免点击菜单外误激活行）。
            if (menu || toolbarOpen) {
              setMenu(null);
              setToolbarOpen(false);
              return;
            }
            setSelected(entry.path);
            if (entry.kind === "dir") void toggleDir(entry);
            else onOpenFile(entry.path);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSelected(entry.path);
            setMenu({ x: e.clientX, y: e.clientY, entry });
          }}
        >
          <span style={{ flex: "none", width: 14, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-tertiary)" }}>
            {entry.kind === "dir" ? (openDirs[entry.path] ? <IconChevronDownOutline14 size={14} /> : <IconTriangleRightFill14 size={14} />) : null}
          </span>
          <span style={{ flex: "none", display: "inline-flex", color: "var(--dsw-alias-label-tertiary)" }}>
            {entry.kind === "dir" ? (openDirs[entry.path] ? <IconFolderOpenOutline16 size={16} /> : <IconFolderClose16 size={16} />) : <FileIcon name={entry.name} size={16} />}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{entry.name}</span>
        </div>
        {openDirs[entry.path]?.length ? renderEntries(openDirs[entry.path], depth + 1) : null}
      </div>
    ));

  return (
    // 外层与 WorkspaceBrowser 同构：height:100% + flex 列（不滚动）——内部树滚动区
    // （flex:1 + minHeight:0 + fm-scroll）才能正确收缩并出现渐变滚动条；此前外层
    // overflow:auto + 高度 auto 让 flex:1 失效，区文件树实际滚动的是浏览器默认粗滚动条。
    <div style={{ height: "100%", display: "flex", flexDirection: "column", fontSize: FONT_SECONDARY, lineHeight: 1.5, userSelect: "none", color: "var(--dsw-alias-label-primary)" }}>
      <style>{TREE_CSS}</style>
      {/* 收起态（rail）不再由本组件渲染：整块 rail 交给 RailPanel（两颗区标 + 进行中任务点列），
          故此处只剩展开态一种形态，原先的 collapsed 分支已删除。 */}
      <>
        <>
          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            {/* 标题栏行保持侧栏黑色底，底部一条黑灰边界线与内容区区分（内容区不铺色）。
                padding-right 34：按钮组右端贴近右上角固定折叠键（留 4px 间隙）。 */}
            <div style={{ flex: "none", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 34px 4px 4px", background: "var(--dsw-specific-sidebar-fill)", borderBottom: HEADER_BORDER }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--dsw-alias-label-primary)" }}>
                {/* 与工作区区的文件夹图标区分：区文件树用浏览/文档图标（内部涂灰，带横线） */}
                <FileBadge lines />
                区文件树
              </span>
              {/* 标题栏右侧按钮组：key=toolbarKey（每次展开递增 → 重挂载 → stagger 滑入动画重放，
                  与区容器展开过渡同时进行）。 */}
              <span key={toolbarKey ?? 0} style={{ display: "flex", gap: 4 }}>
                {/* 展开过渡动画：按钮依次滑入（fm-tb-btn）。 */}
                <Menu
                  open={toolbarOpen}
                  onClose={() => setToolbarOpen(false)}
                  items={[
                    { id: "new-file", label: "新建文件", icon: <IconPlusOutline16 size={16} /> },
                    { id: "new-folder", label: "新建文件夹", icon: <IconFolderClose16 size={16} /> },
                  ]}
                  onSelect={(id) => {
                    setToolbarOpen(false);
                    if (id === "new-file") setDialog({ kind: "new-file", base: "" });
                    else if (id === "new-folder") setDialog({ kind: "new-folder", base: "" });
                  }}
                  portal
                  anchor={
                    <Button className="fm-tb-btn" style={{ ...ICON_BTN_STYLE, animationDelay: "0ms" }} size="sm" variant="ghost" icon={<IconPlusOutline16 size={16} />} title="新建文件或文件夹" aria-label="新建文件或文件夹" onClick={() => setToolbarOpen((v) => !v)} />
                  }
                />
                <Button className="fm-tb-btn" style={{ ...ICON_BTN_STYLE, animationDelay: "40ms" }} size="sm" variant="ghost" icon={<IconRefreshOutline16 size={16} />} title="刷新" aria-label="刷新" onClick={() => void reload()} />
              </span>
            </div>
            {/* 树滚动区：滚动条上界在标题栏下方；scrollLock（区容器过渡期间）置 hidden 避免
                滚动条闪现抖动；fm-scroll 提供渐变滚动条样式。 */}
            <div
              className="fm-scroll"
              style={{ flex: 1, minHeight: 0, overflowY: scrollLock ? "hidden" : "auto", scrollbarGutter: "stable", padding: "8px 0 8px 8px" }}
            >
              {error ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--dsw-alias-state-error-primary)", padding: "2px 4px" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>{error}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      // 重试会重新拉取目录（不涉及草稿，无需确认）。
                      setError(null);
                      void reload();
                    }}
                  >
                    重试
                  </Button>
                </div>
              ) : null}
              {roots === null ? (
                <div style={{ padding: 8, color: "var(--dsw-alias-label-secondary)" }}>加载中…</div>
              ) : (
                <>
                  {/* 最高级一层树：当前工作区完整地址（根节点行）。点击展开/收起其下目录树；
                      子级从 depth 1 起缩进；右键弹与目录一致的操作菜单（新建在根目录、
                      复制根地址；重命名/删除/移动对根不可用）。 */}
                  <div
                    className="fm-tree-row"
                    title={api.root}
                    onClick={() => {
                      // 菜单打开时点击：只收起菜单，不触发展开/收起（与普通树行一致）。
                      if (menu || toolbarOpen) {
                        setMenu(null);
                        setToolbarOpen(false);
                        return;
                      }
                      setRootOpen((v) => !v);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMenu({ x: e.clientX, y: e.clientY, entry: { name: api.root, path: "", kind: "dir" } });
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: TREE_ROW.gap,
                      padding: `${TREE_ROW.paddingY}px ${TREE_ROW.paddingX}px`,
                      cursor: "pointer",
                      color: "var(--dsw-alias-label-primary)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ flex: "none", width: 14, display: "inline-flex", justifyContent: "center", color: "var(--dsw-alias-label-tertiary)" }}>
                      {rootOpen ? <IconChevronDownOutline14 size={14} /> : <IconTriangleRightFill14 size={14} />}
                    </span>
                    <span style={{ flex: "none", display: "inline-flex", color: "var(--dsw-alias-label-tertiary)" }}>
                      {rootOpen ? <IconFolderOpenOutline16 size={16} /> : <IconFolderClose16 size={16} />}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{api.root}</span>
                  </div>
                  {rootOpen ? renderEntries(roots, 1) : null}
                </>
              )}
            </div>
          </div>
        </>
      </>

      {menu ? (
        <ContextMenu
          key={menu.entry.path}
          x={menu.x}
          y={menu.y}
          items={menuItemsFor(menu.entry)}
          onClose={() => {
            setMenu(null);
            setCopiedPath(false); // 菜单关闭时复位"已复制 ✓"反馈并清计时器，避免残留到下一次菜单
            clearCopiedTimer();
          }}
        />
      ) : null}

      {dialog?.kind === "new-file" ? (
        <PromptModal
          open
          title="新建文件"
          description={dialog.base === "" ? "在工作区根目录下创建" : `在 ${dialog.base} 下创建`}
          placeholder="新文件名称，如 new-file.txt"
          validate={(v) => validateNameInput("name", v)}
          onSubmit={(name) => {
            const rel = joinRel(dialog.base, name);
            void api.write(rel, "").then((res) => {
              if (res.ok) void reload();
              else setError(describeApiError(res));
            });
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "new-folder" ? (
        <PromptModal
          open
          title="新建文件夹"
          description={dialog.base === "" ? "在工作区根目录下创建" : `在 ${dialog.base} 下创建`}
          placeholder="新文件夹名称，如 src"
          validate={(v) => validateNameInput("name", v)}
          onSubmit={(name) => {
            void runOp("mkdir", joinRel(dialog.base, name));
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "rename" ? (
        <PromptModal
          open
          title={`重命名 ${dialog.entry.name}`}
          initialValue={dialog.entry.name}
          placeholder="新名字"
          validate={(v) => validateNameInput("name", v)}
          onSubmit={(name) => {
            void runOp("rename", dialog.entry.path, joinRel(dialog.base, name));
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "move" ? (
        <PromptModal
          open
          title={`移动 ${dialog.entry.name}`}
          description="目标路径（工作区内相对路径）"
          initialValue={dialog.entry.path}
          placeholder="目标路径，如 src/utils.ts"
          validate={(v) => validateNameInput("path", v)}
          onSubmit={(to) => {
            void runOp("move", dialog.entry.path, to);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

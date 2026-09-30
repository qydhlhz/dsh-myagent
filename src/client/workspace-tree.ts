// src/client/workspace-tree.ts — 工作区「原生工作区树」分级（纯函数，浏览器/测试共用）。
//
// 【为什么要这个模块】本插件接管的 sidebar.workspaces 会整个替换掉官方 ui-workspace 的
// 浏览器，也就一并替换掉了它的「视图选项 → 分组方式：按工作区 / 按工作区树 / 单列表」。
// 用户要求工作区按 **dsh 原生的「工作区树」** 方式分级，所以这里把官方那套判据逐字复刻出来，
// 只做分级与排序，渲染仍由 WorkspaceBrowser 负责。
//
// 【官方语义（源码实证：@deepseek-ai/dsh-client-ui-workspace 的 client.js）】
//   folderPath(path)
//     Windows 风格（盘符 X:/ 或 UNC \\）才把反斜杠折成正斜杠，其余原样；
//     统一去掉末尾的 /。
//   owningParentFolder(path, parents)
//     在**已注册的工作区路径**里找"最近的祖先"：候选必须满足
//       child !== root 且 child 以 `${root}/` 开头（即真包含，不是相等）
//     取其中 root 最长的一个 —— 越长的前缀=越近的祖先。
//     匹配是**大小写敏感**的（与工作区身份一致，路径用宿主拼写）。
//   组的父子映射：parents[workspaceId] = 最近的已注册祖先的 workspaceId，没有则 undefined。
//
// 【本模块的渲染顺序约定】父级在前，其子树紧随其后（深度优先、兄弟之间保持宿主顺序）。
// 与官方的一处**有意差异**：官方把子工作区排在"父级自己的会话之前"，而本插件的会话列表
// 长在父级区段内部，把子区段插进去会让拖拽 drop 目标在父子之间冒泡串味（父级区段的
// onDragOver/onDrop 会覆盖子区段刚设好的目标）。因此这里采用"父级区段（行 + 会话）之后
// 紧跟子树"的扁平顺序 —— 层级靠缩进与引导线表达，语义（谁是谁的子级、折叠谁藏谁）完全一致。

/** 一个可用于分级的最小形状（WorkspaceView 的结构子集）。 */
export interface TreeItemLike {
  workspaceId: string;
  path: string;
}

/**
 * 路径归一化：与官方 folderPath 逐字一致 —— 只为 Windows 风格路径折反斜杠，去掉末尾斜杠。
 * 注意**不做**大小写折叠：官方的工作区路径比较就是大小写敏感的。
 */
export function folderPath(path: string): string {
  return (/^[A-Za-z]:[/\\]/.test(path) || path.startsWith("\\\\") ? path.replaceAll("\\", "/") : path)
    .replace(/\/+$/, "");
}

/**
 * 找最近的**已注册**祖先目录（不含目录自身）—— 官方 owningParentFolder 的逐字复刻。
 *
 * @param path - 待判定的工作区目录。
 * @param parents - 已注册的工作区目录集合。
 * @returns 拥有它的父目录（原样返回 parents 里的那个字符串）；没有任何父目录时 undefined。
 */
export function owningParentFolder(path: string, parents: readonly string[]): string | undefined {
  const child = folderPath(path);
  let owner: string | undefined;
  let length = -1;
  for (const parent of parents) {
    const root = folderPath(parent);
    if (root.length > length && child !== root && child.startsWith(`${root}/`)) {
      owner = parent;
      length = root.length;
    }
  }
  return owner;
}

/** 分级结果。 */
export interface WorkspaceTree<T extends TreeItemLike> {
  /** workspaceId → 最近的已注册祖先 id（没有则 undefined）。 */
  parents: Map<string, string | undefined>;
  /** 顶层工作区（没有已注册祖先），保持传入顺序。 */
  roots: T[];
  /** workspaceId → 其直接子级（保持传入顺序）。没有子级时该键不存在。 */
  childrenOf: Map<string, T[]>;
  /** 扁平化的渲染顺序：深度优先，父级在前、子树紧随其后；兄弟之间保持传入顺序。 */
  order: Array<{ item: T; depth: number; hasChildren: boolean }>;
  /** 是否真的存在父子关系 —— 为 false 时渲染结果与"不分级"完全一致。 */
  hasNesting: boolean;
}

/**
 * 把已注册工作区按原生「工作区树」分级。
 *
 * 不改变任何工作区的归属或顺序数据：纯粹派生出「谁挂在谁下面」与子级表，
 * 因此删除父级后子级会自动挂到下一个已注册祖先（或成为根）—— 与官方一致。
 */
export function buildWorkspaceTree<T extends TreeItemLike>(items: readonly T[]): WorkspaceTree<T> {
  const byPath = new Map<string, string>(); // path -> workspaceId
  for (const item of items) byPath.set(item.path, item.workspaceId);

  const parents = new Map<string, string | undefined>();
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];
  const paths = [...byPath.keys()];

  for (const item of items) {
    const parentPath = owningParentFolder(item.path, paths);
    const parentId = parentPath === undefined ? undefined : byPath.get(parentPath);
    parents.set(item.workspaceId, parentId);
    if (parentId === undefined) {
      roots.push(item);
    } else {
      const list = childrenOf.get(parentId);
      if (list === undefined) childrenOf.set(parentId, [item]);
      else list.push(item);
    }
  }

  const order: Array<{ item: T; depth: number; hasChildren: boolean }> = [];
  const emit = (item: T, depth: number): void => {
    const kids = childrenOf.get(item.workspaceId) ?? [];
    order.push({ item, depth, hasChildren: kids.length > 0 });
    for (const kid of kids) emit(kid, depth + 1);
  };
  for (const item of roots) emit(item, 0);

  return { parents, roots, childrenOf, order, hasNesting: childrenOf.size > 0 };
}

/** 沿父链向上收集全部祖先 id（不含自身）。用于"当前会话所在的工作区"自动展开其祖先。 */
export function ancestorsOf(
  workspaceId: string,
  parents: ReadonlyMap<string, string | undefined>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([workspaceId]);
  for (let key = parents.get(workspaceId); key !== undefined; key = parents.get(key)) {
    if (seen.has(key)) break; // 理论上不会成环（前缀关系严格），仍然防御
    seen.add(key);
    out.push(key);
  }
  return out;
}

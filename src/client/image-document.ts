// src/client/image-document.ts — 图片文档渲染器的"元数据与匹配"部分（纯函数，无 React/DOM）。
//
// 与 image-panzoom.tsx（React 组件）分开，是因为 Node 的测试运行器只能直接加载 .ts
// （.tsx 需要 JSX 转译，会 ERR_UNKNOWN_FILE_EXTENSION）；元数据与扩展名判定是纯逻辑，
// 拆出来后可以直接单测，也避免测试为了一个常量去拖进整个组件树。
//
// 为什么是"渲染器"而不是"标签类型"：右侧栏官方预览
// （@deepseek-ai/dsh-client-ui-sidebar-documentpreview）把**渲染器**做成了公开注册表
// `ctx.documentPreviews`，`priority: 'extension'` 的外部实现优先于内建实现，所以只需要注册
// **图片扩展名**的渲染器就能接管图片，Markdown/代码/PDF/HTML/纯文本仍全部由官方渲染。

/** 本渲染器在 documentPreviews 注册表里的实现名，同时是 body 槽的 key。 */
export const IMAGE_PANZOOM_ID = "dsh-myagent/image-panzoom";

/** 接管的扩展名（与内建 ImageBody 的 IMAGE_EXTENSIONS 对齐，少一个就会有图片回落无缩放版）。 */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"] as const;

/** 扩展名 → MIME（Blob 类型；SVG 必须给 image/svg+xml，否则浏览器不渲染）。 */
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

/**
 * 文件地址末段 → 小写扩展名。
 * @returns 扩展名；没有扩展名、点开头（.hidden）、以点结尾（trailing.）时 null。
 */
export function extensionOf(addressOrName: string): string | null {
  const name = addressOrName.slice(addressOrName.lastIndexOf("/") + 1);
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // 编码非法时退回原文（与官方 basenameOf 同款容错）
  }
  const dot = decoded.lastIndexOf(".");
  if (dot <= 0 || dot === decoded.length - 1) return null;
  return decoded.slice(dot + 1).toLowerCase();
}

/** 地址 → 图片 MIME；不是已接管的图片扩展名时 null。 */
export function imageMediaTypeOf(address: string): string | null {
  const ext = extensionOf(address);
  if (ext === null) return null;
  return IMAGE_MEDIA_TYPES[ext] ?? null;
}

/** 渲染器定义（交给 ctx.documentPreviews.register）。 */
export function imagePanZoomDefinition() {
  return {
    id: IMAGE_PANZOOM_ID,
    extensions: IMAGE_EXTENSIONS,
    // 缺省即 'extension'（外部实现优先于内建）；显式写出来表明"有意压掉内建图片渲染器"。
    priority: "extension" as const,
    title: () => "图片（可拖动缩放）",
    loading: "bytes-complete" as const,
    // 不使用文档的换行偏好（那是文本渲染器的事），故不声明 wrap。
  };
}

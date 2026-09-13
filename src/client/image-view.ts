// src/client/image-view.ts — 图片查看器的视图变换数学（纯函数，无 React / DOM 依赖）。
//
// 模型：图片以 transform: translate(tx,ty) scale(scale)、transform-origin: 0 0 绘制，
// 于是"图片坐标 → 容器坐标"为 p_screen = p_image * scale + t。滚轮缩放要**锚定光标**：
// 先反解光标下的图片坐标，缩放后再把它放回同一个屏幕位置。
// 全部纯函数，便于单测（组件只负责事件与渲染）。

export interface ViewSize {
  width: number;
  height: number;
}

/** 图片在容器里的摆放：缩放系数 + 左上角偏移（容器坐标 px）。 */
export interface ImageView {
  scale: number;
  tx: number;
  ty: number;
}

/** 缩放上下限：下限够小能看到全图，上限够大能看像素（32x）。 */
export const MIN_SCALE = 0.02;
export const MAX_SCALE = 32;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** 居中摆放（不缩放）：100% 时把图片摆到容器中央。 */
export function centeredView(natural: ViewSize, container: ViewSize): ImageView {
  return {
    scale: 1,
    tx: (container.width - natural.width) / 2,
    ty: (container.height - natural.height) / 2,
  };
}

/**
 * 适应宽度：图片宽度**顶满容器宽度**并据此定缩放（等价于 `<img style="width:100%">`）。
 *
 * 这是本查看器的默认姿态，也是容器尺寸变化（拖左右分割线 / 折叠侧栏 / 窗口 resize）时的
 * 固定行为：宽度永远贴满可视宽度，既不留横向空白、也不横向溢出。
 * 小图会被放大（"顶满宽度"的字面语义）；上限仍受 MAX_SCALE 约束。
 */
export function fitWidthView(natural: ViewSize, container: ViewSize): ImageView {
  if (natural.width <= 0 || natural.height <= 0) return { scale: 1, tx: 0, ty: 0 };
  const scale = clampScale(container.width / natural.width);
  const height = natural.height * scale;
  return {
    scale,
    tx: (container.width - natural.width * scale) / 2,
    // 装得下 → 居中；装不下 → 顶到上沿（从图的上方开始看）
    ty: height <= container.height ? (container.height - height) / 2 : 0,
  };
}

/** 按屏幕位移平移（拖动）。 */
export function panView(view: ImageView, dx: number, dy: number): ImageView {
  return { scale: view.scale, tx: view.tx + dx, ty: view.ty + dy };
}

/**
 * 以容器内某点（一般是光标位置）为锚点缩放。
 * @param view - 当前视图。
 * @param factor - 缩放倍率（>1 放大）。会被夹到 [MIN_SCALE, MAX_SCALE]。
 * @param anchor - 锚点，容器坐标；锚点下的图片像素在缩放前后保持不动。
 */
export function zoomView(view: ImageView, factor: number, anchor: { x: number; y: number }): ImageView {
  const scale = clampScale(view.scale * factor);
  if (scale === view.scale) return view; // 已到上下限：不做无谓的状态更新
  const imageX = (anchor.x - view.tx) / view.scale;
  const imageY = (anchor.y - view.ty) / view.scale;
  return { scale, tx: anchor.x - imageX * scale, ty: anchor.y - imageY * scale };
}

/**
 * 把图片约束在容器附近，避免拖出视野后"找不回来"。
 *
 * 规则：图片比容器小的轴居中；比容器大的轴允许自由移动，但至少保留
 * `margin` 像素露在容器内（两侧都不越界到完全看不见）。
 */
export function clampView(view: ImageView, natural: ViewSize, container: ViewSize, margin = 48): ImageView {
  const w = natural.width * view.scale;
  const h = natural.height * view.scale;
  const axis = (size: number, viewport: number, t: number): number => {
    if (size <= viewport) return (viewport - size) / 2; // 比容器小 → 居中
    const min = viewport - size - margin; // 右/下边界（负）
    const max = margin; // 左/上边界
    return Math.min(max, Math.max(min, t));
  };
  return {
    scale: view.scale,
    tx: axis(w, container.width, view.tx),
    ty: axis(h, container.height, view.ty),
  };
}

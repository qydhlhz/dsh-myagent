// test/image-view.test.ts — 图片查看器视图变换的纯函数测试。
// 这些函数决定"滚轮缩放时光标下的像素是否真的不动"，是拖动/缩放体验正确性的核心，
// 所以按"锚点不漂移"这条不变量来断言，而不只是比数值。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SCALE,
  MIN_SCALE,
  centeredView,
  clampScale,
  clampView,
  fitWidthView,
  panView,
  zoomView,
  type ImageView,
} from "../src/client/image-view.ts";
import {
  IMAGE_EXTENSIONS,
  extensionOf,
  imageMediaTypeOf,
  imagePanZoomDefinition,
} from "../src/client/image-document.ts";

const CONTAINER = { width: 800, height: 600 };
const BIG = { width: 4000, height: 3000 }; // 比容器大 → 适应宽度会缩小
const SMALL = { width: 100, height: 50 }; // 比容器小 → 适应宽度会放大（"顶满宽度"）
const TALL = { width: 400, height: 4000 }; // 顶满宽度后高度远超容器 → 纵向要能拖

test("fitWidthView 宽度精确顶满容器（大图缩小）", () => {
  const view = fitWidthView(BIG, CONTAINER);
  assert.equal(view.scale, 800 / 4000); // 只看宽度，不看高度
  assert.equal(4000 * view.scale, 800, "缩放后宽度应恰好等于容器宽度");
  assert.equal(view.tx, 0);
  // 4000x3000 顶满 800 宽 → 高 600，恰好装下 → 纵向居中
  assert.equal(view.ty, (600 - 3000 * (800 / 4000)) / 2);
});

test("fitWidthView 小图被放大到顶满宽度（不是保持 100%）", () => {
  const view = fitWidthView(SMALL, CONTAINER);
  assert.equal(view.scale, 8); // 800/100
  assert.equal(100 * view.scale, 800);
  assert.equal(view.ty, (600 - 50 * 8) / 2); // 400 高 < 600 → 居中
});

test("fitWidthView 顶满宽度后过高的图顶到上沿（纵向可拖）", () => {
  const view = fitWidthView(TALL, CONTAINER);
  assert.equal(view.scale, 2); // 800/400
  assert.equal(view.tx, 0);
  assert.equal(view.ty, 0, "高度溢出时应顶到上沿，而不是居中留白");
  assert.ok(4000 * view.scale > CONTAINER.height);
});

test("fitWidthView 跟随容器宽度变化（拖分割线的行为）", () => {
  const wide = fitWidthView(BIG, { width: 800, height: 600 });
  const narrow = fitWidthView(BIG, { width: 400, height: 600 });
  assert.equal(4000 * narrow.scale, 400, "容器变窄后宽度应重新顶满");
  assert.ok(narrow.scale < wide.scale, "容器变窄 → 缩放变小");
  assert.equal(narrow.tx, 0);
});

test("fitWidthView 尺寸非法时不产生 NaN", () => {
  const view = fitWidthView({ width: 0, height: 0 }, CONTAINER);
  assert.ok(Number.isFinite(view.scale) && Number.isFinite(view.tx) && Number.isFinite(view.ty));
});

test("centeredView 是 100% 居中", () => {
  const view = centeredView(BIG, CONTAINER);
  assert.deepEqual(view, { scale: 1, tx: (800 - 4000) / 2, ty: (600 - 3000) / 2 });
});

test("panView 只改位移不改缩放", () => {
  const view: ImageView = { scale: 2, tx: 10, ty: 20 };
  assert.deepEqual(panView(view, -3, 5), { scale: 2, tx: 7, ty: 25 });
});

test("zoomView 锚点下的图片像素在缩放前后不动（核心不变量）", () => {
  const view: ImageView = { scale: 1, tx: 0, ty: 0 };
  const anchor = { x: 137, y: 89 };
  const imageBefore = { x: (anchor.x - view.tx) / view.scale, y: (anchor.y - view.ty) / view.scale };
  const zoomed = zoomView(view, 2.5, anchor);
  const imageAfter = { x: (anchor.x - zoomed.tx) / zoomed.scale, y: (anchor.y - zoomed.ty) / zoomed.scale };
  assert.ok(Math.abs(imageBefore.x - imageAfter.x) < 1e-9, "锚点 X 漂移");
  assert.ok(Math.abs(imageBefore.y - imageAfter.y) < 1e-9, "锚点 Y 漂移");
  assert.equal(zoomed.scale, 2.5);
});

test("zoomView 连续缩放可逆（放大再等倍缩小回到原位）", () => {
  const view: ImageView = { scale: 1.3, tx: -40, ty: 25 };
  const anchor = { x: 300, y: 200 };
  const round = zoomView(zoomView(view, 1.7, anchor), 1 / 1.7, anchor);
  assert.ok(Math.abs(round.scale - view.scale) < 1e-9);
  assert.ok(Math.abs(round.tx - view.tx) < 1e-9);
  assert.ok(Math.abs(round.ty - view.ty) < 1e-9);
});

test("zoomView 撞到上下限时原样返回（不做无谓更新）", () => {
  const maxed: ImageView = { scale: MAX_SCALE, tx: 0, ty: 0 };
  assert.equal(zoomView(maxed, 2, { x: 0, y: 0 }), maxed);
  const mined: ImageView = { scale: MIN_SCALE, tx: 0, ty: 0 };
  assert.equal(zoomView(mined, 0.5, { x: 0, y: 0 }), mined);
});

test("clampScale 夹取并把非法值收敛到 1", () => {
  assert.equal(clampScale(1e9), MAX_SCALE);
  assert.equal(clampScale(1e-9), MIN_SCALE);
  assert.equal(clampScale(Number.NaN), 1);
  assert.equal(clampScale(Number.POSITIVE_INFINITY), 1);
});

test("clampView 小于容器的轴居中", () => {
  const view: ImageView = { scale: 0.5, tx: -999, ty: 999 };
  const clamped = clampView(view, SMALL, CONTAINER); // 50x25，两轴都小于容器
  assert.equal(clamped.tx, (800 - 50) / 2);
  assert.equal(clamped.ty, (600 - 25) / 2);
});

test("clampView 大于容器的轴允许移动但保留可见余量", () => {
  const natural = { width: 1000, height: 1000 };
  const view: ImageView = { scale: 2, tx: 0, ty: 0 }; // 2000x2000
  // 往右下拖到极限：左上角最多到 margin
  assert.equal(clampView({ ...view, tx: 99999, ty: 99999 }, natural, CONTAINER, 48).tx, 48);
  // 往左上拖到极限：至少留 margin 露在容器内
  assert.equal(clampView({ ...view, tx: -99999, ty: -99999 }, natural, CONTAINER, 48).tx, 800 - 2000 - 48);
  // 视野内正常值不被改动
  assert.equal(clampView({ ...view, tx: -300, ty: -400 }, natural, CONTAINER, 48).tx, -300);
});

test("extensionOf 从地址末段取扩展名（含解码与大小写）", () => {
  assert.equal(extensionOf("dsh-resource://file/absolute/C:/x/a.PNG"), "png");
  assert.equal(extensionOf("dsh-resource://file/session/s1/%E4%B8%AD%E6%96%87.jpeg"), "jpeg");
  assert.equal(extensionOf("dsh-resource://file/session/s1/archive.tar.gz"), "gz");
  assert.equal(extensionOf("dsh-resource://file/session/s1/noext"), null);
  assert.equal(extensionOf("dsh-resource://file/session/s1/.hidden"), null); // 点开头不算扩展名
  assert.equal(extensionOf("dsh-resource://file/session/s1/trailing."), null);
});

test("imageMediaTypeOf 只认已接管的图片扩展名", () => {
  assert.equal(imageMediaTypeOf("dsh-resource://file/session/s1/a.png"), "image/png");
  assert.equal(imageMediaTypeOf("dsh-resource://file/session/s1/a.svg"), "image/svg+xml");
  assert.equal(imageMediaTypeOf("dsh-resource://file/session/s1/a.ico"), "image/x-icon");
  assert.equal(imageMediaTypeOf("dsh-resource://file/session/s1/a.txt"), null);
  assert.equal(imageMediaTypeOf("dsh-resource://file/session/s1/a.pdf"), null);
});

test("渲染器定义：extension 档、bytes 完整加载、覆盖全部图片扩展名", () => {
  const definition = imagePanZoomDefinition();
  assert.equal(definition.priority, "extension", "必须压过内建图片渲染器");
  assert.equal(definition.loading, "bytes-complete", "图片要完整字节，不能走文本分页");
  assert.deepEqual([...definition.extensions], [...IMAGE_EXTENSIONS]);
  // 内建 ImageBody 的扩展名集合（官方 IMAGE_EXTENSIONS）；少一个就会有图片回落到无缩放版本。
  const claimed: readonly string[] = definition.extensions;
  for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"]) {
    assert.ok(claimed.includes(ext), `缺少扩展名 ${ext}`);
  }
  assert.equal(typeof definition.title(), "string");
});

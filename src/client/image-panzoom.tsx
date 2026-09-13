// src/client/image-panzoom.tsx — MyAgent 的图片文档渲染器：横向顶满宽度 + 鼠标拖动平移 + 滚轮缩放。
//
// 元数据 / 扩展名匹配 / 注册表定义在 image-document.ts（纯 .ts，便于直接单测）；
// 视图变换数学在 image-view.ts；本文件只负责事件、渲染与 object URL 生命周期。
//
// 内建 ImageBody 的注释写得很直白：'Present complete image bytes **without fitting or
// scaling them to the pane**' —— 按原始像素摆放、靠外层滚动条看，所以不能拖动、不能缩放。
// 本实现：
//   - 打开即"适应宽度"（宽度顶满可视宽度），**容器尺寸一变就重新适应宽度** ——
//     拖左右分割线 / 折叠侧栏 / 窗口 resize 时宽度始终贴满，不留横向空白；
//   - 滚轮以光标为锚点缩放、按住左键拖动平移；
//   - 双击在「适应宽度 ↔ 100%」间切换，+/-/0/1 键盘等价；
//   - 始终把图约束在视野附近（clampView），拖不丢。
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  centeredView,
  clampView,
  fitWidthView,
  panView,
  zoomView,
  type ImageView,
  type ViewSize,
} from "./image-view.ts";
import { imageMediaTypeOf } from "./image-document.ts";

/** 滚轮缩放灵敏度：按 deltaY 指数缩放，触控板与鼠标滚轮都能用。 */
const WHEEL_SENSITIVITY = 0.0015;

interface Props {
  /** 文件地址（取扩展名判 MIME，也用作重载 key）。 */
  resourceAddress: string;
  /** 文档内容；本渲染器只处理 kind === 'bytes'。 */
  content: { kind: string; data?: Uint8Array };
}

const CURSOR_CSS = `
.fm-zoom-host { cursor: grab; }
.fm-zoom-host.fm-zoom-dragging { cursor: grabbing; }
.fm-zoom-hint { transition: opacity .25s ease; }
`;

/**
 * 图片预览 body：横向顶满宽度 + 拖动平移 + 滚轮缩放。
 *
 * 滚轮用原生监听而非 React 合成事件：必须 `{ passive: false }` 才能 preventDefault
 * （否则缩放的同时外层还会滚动），React 的 onWheel 无法保证这一点。
 */
export function ImagePanZoom({ resourceAddress, content }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; view: ImageView } | null>(null);
  const [view, setView] = useState<ImageView>({ scale: 1, tx: 0, ty: 0 });
  // 是否处于"适应宽度"状态（决定双击往哪个方向切）。
  const [fitted, setFitted] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false);
  const [natural, setNatural] = useState<ViewSize | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const data = content?.kind === "bytes" ? content.data : undefined;

  // 字节 → object URL；卸载/换文件时回收，避免泄漏。
  useEffect(() => {
    if (data === undefined) return;
    setFailed(false);
    const mime = imageMediaTypeOf(resourceAddress) ?? "application/octet-stream";
    const blob = new Blob([data as BlobPart], { type: mime });
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
    };
  }, [data, resourceAddress]);

  const containerSize = useCallback((): ViewSize | null => {
    const host = hostRef.current;
    if (host === null) return null;
    return { width: host.clientWidth, height: host.clientHeight };
  }, []);

  const applyFitWidth = useCallback(() => {
    const size = containerSize();
    if (size === null || natural === null) return;
    setView(fitWidthView(natural, size));
    setFitted(true);
  }, [containerSize, natural]);

  const applyActualSize = useCallback(() => {
    const size = containerSize();
    if (size === null || natural === null) return;
    setView(centeredView(natural, size));
    setFitted(false);
  }, [containerSize, natural]);

  // 图片解码出真实尺寸后先"适应宽度"。
  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const size = { width: img.naturalWidth, height: img.naturalHeight };
    setNatural(size);
    const host = containerSize();
    if (host !== null) setView(fitWidthView(size, host));
    setFitted(true);
  };

  // 容器尺寸一变就重新"适应宽度" —— 拖左右分割线、折叠侧栏、窗口 resize 全走这里，
  // 于是图片宽度始终顶满可视宽度（用户要求：拖动分割线时保持横向自适应顶满宽度）。
  // 依赖里**故意不放** fitted：尺寸变化一律回到适应宽度，行为可预期。
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null || natural === null) return;
    const observer = new ResizeObserver(() => {
      const size = containerSize();
      if (size === null) return;
      setView(fitWidthView(natural, size));
      setFitted(true);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [containerSize, natural]);

  // 滚轮缩放：锚定光标。passive:false 才能阻止外层滚动。
  useEffect(() => {
    const host = hostRef.current;
    if (host === null || natural === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
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
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [containerSize, natural]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || natural === null) return;
    event.preventDefault();
    // 指针捕获是"拖出元素后仍能收到 move"的优化，不是拖动的前提：
    // 拿不到（指针已失效等）时抛 NotFoundError，若让它冒泡会中断整个处理器、拖动直接失灵。
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 降级：不捕获，光标留在元素内的拖动照常工作。
    }
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view };
    setDragging(true);
    setTouched(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId || natural === null) return;
    const size = containerSize();
    const moved = panView(drag.view, event.clientX - drag.x, event.clientY - drag.y);
    setView(size === null ? moved : clampView(moved, natural, size));
    // 拖动即离开"适应宽度"状态（语义标记；容器 resize 时仍会回到适应宽度）。
    setFitted(false);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  const onDoubleClick = () => {
    if (fitted) applyActualSize();
    else applyFitWidth();
    setTouched(true);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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

  const percent = useMemo(() => `${Math.round(view.scale * 100)}%`, [view.scale]);

  return React.createElement(
    "div",
    {
      ref: hostRef,
      className: `fm-zoom-host${dragging ? " fm-zoom-dragging" : ""}`,
      tabIndex: 0,
      role: "img",
      "aria-label": `图片预览，当前缩放 ${percent}。拖动平移，滚轮缩放，双击复位`,
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
        touchAction: "none", // 触屏拖动不被页面滚动吞掉
        outline: "none",
        background: "var(--dsw-alias-bg-layer-1)",
      },
    },
    React.createElement("style", null, CURSOR_CSS),
    failed
      ? React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              fontSize: 13,
              color: "var(--dsw-alias-label-secondary)",
            },
          },
          "图片无法解码，可能已损坏或不是受支持的格式",
        )
      : null,
    url !== null && !failed
      ? React.createElement("img", {
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
            willChange: "transform",
          },
        })
      : null,
    // 缩放比例常驻右下角；操作提示在首次交互后淡出。
    React.createElement(
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
          pointerEvents: "none",
        },
      },
      percent,
    ),
    React.createElement(
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
          pointerEvents: "none",
        },
      },
      "拖动平移 · 滚轮缩放 · 双击适应宽度/100%",
    ),
  );
}

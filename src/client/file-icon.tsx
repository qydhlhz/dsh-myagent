// src/client/file-icon.tsx — 宿主 primitives 的"按扩展名着色文件图标"薄封装。
//
// 背景：`FileTypeIcon` / `classifyFileType` 是 dsh 0.1.5 才新增的 primitives 导出
// （官方 ui-sidebar-files 文件树用它给每个文件配彩色类型图标）。本项目 devDependencies
// 里的 `@deepseek-ai/dsh-client-ui-primitives` 存根仍是 0.1.0-rc.6，类型声明里没有这两个
// 成员——但运行时它们由**宿主**的模块表提供（primitives 在 esbuild external 列表里，
// 打进 bundle 会丢掉真实 CSS 与图标），所以不是"用不了"，只是"类型看不见"。
//
// 因此这里做一层薄封装而不是直接强转：
//   1) 类型：本地声明我用到的那两个成员，绕开过时的存根类型；
//   2) 运行时：真的取不到（旧宿主）就退回 myagent 旧版的通用浏览图标，不白屏、不抛错。
// 新宿主上就是官方同款彩色图标。
import React from "react";
import * as primitives from "@deepseek-ai/dsh-client-ui-primitives";

interface FileTypeIconProps {
  kind: string;
  size?: number;
  className?: string;
}
type FileTypeIconComponent = (props: FileTypeIconProps) => React.ReactElement | null;
type ClassifyFileType = (name: string) => string;

const host = primitives as unknown as Partial<{
  FileTypeIcon: FileTypeIconComponent;
  classifyFileType: ClassifyFileType;
}>;

/** 宿主是否提供了彩色文件类型图标（新宿主 true；旧宿主 false → 走通用图标）。 */
export const hasHostFileIcons =
  typeof host.FileTypeIcon === "function" && typeof host.classifyFileType === "function";

/**
 * 一个文件的类型图标（按扩展名着色）。
 * @param name - 文件名（含扩展名）；目录请直接用文件夹图标，不要走这里。
 */
export function FileIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  if (!hasHostFileIcons) {
    // 旧宿主兜底：通用"浏览/文档"图标（与 0.1.0 版 FileTree 的行为一致）。
    const Fallback = (primitives as unknown as { IconBrowseOutline16: FileTypeIconComponent }).IconBrowseOutline16;
    return React.createElement(Fallback, { kind: "file", size, className });
  }
  return React.createElement(host.FileTypeIcon as FileTypeIconComponent, {
    kind: (host.classifyFileType as ClassifyFileType)(name),
    size,
    className,
  });
}

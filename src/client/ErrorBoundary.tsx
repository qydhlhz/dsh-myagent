// src/client/ErrorBoundary.tsx — 槽位注册组件的局部渲染错误边界。
// 背景（根因修复配套）：槽位组件渲染抛错会让 slots supervisor abdicate 整个注册
// （本项目曾因拖拽重排刷新后 host 投影缺 sessionIds，渲染崩溃 → sidebar.workspaces
// 回退原版 ui-workspace：区文件树消失、侧栏复原）。因此 Composed / DetailsComposite
// 各包一层 ErrorBoundary：此后任何渲染错误只降级为局部占位（label + 重试按钮），
// 不再拖垮整个槽位注册。
// 降级占位直接展示触发错误的 message（label + "组件渲染出错：" + 消息），
// 不用翻 console 即可从 UI 读出失败原因。
import React from "react";
import { RADIUS } from "./ui-kit.ts";

export interface ErrorBoundaryProps {
  // children 声明为可选：client.ts 以 React.createElement(ErrorBoundary, { label }, child)
  // 调用（rest 参数形式的 children 不参与 props 对象的类型校验），可选可让该调用过 tsc。
  children?: React.ReactNode;
  /** 降级占位文案中的组件名，如 "工作区列表" / "区文件树查看器"。 */
  label: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  /** 触发降级的错误消息（getDerivedStateFromError 捕获），占位 UI 直接展示便于定位。 */
  message?: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    // 保留现场（宿主 console 可见），只降级不吞错。
    console.error(`[dsh-myagent] ${this.props.label} 渲染出错，已降级为占位:`, error, info.componentStack);
  }

  /** 重试：清空错误态，触发子树重挂。 */
  private retry = () => {
    this.setState({ hasError: false, message: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
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
            color: "var(--dsw-alias-label-secondary)",
          }}
        >
          <div>
            {this.props.label}组件渲染出错：
            {this.state.message ? (
              <code
                style={{
                  display: "block",
                  marginTop: 4,
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: "var(--dsw-alias-label-secondary)",
                  wordBreak: "break-all",
                  whiteSpace: "pre-wrap",
                }}
              >
                {this.state.message}
              </code>
            ) : null}
          </div>
          <button
            type="button"
            onClick={this.retry}
            style={{
              cursor: "pointer",
              padding: "4px 12px",
              // 对齐官方 Button size="sm" 的 14px 圆角（此前 6px 明显偏方）。
              borderRadius: RADIUS.control,
              border: "0.5px solid var(--dsw-alias-border-l3)",
              background: "var(--dsw-alias-bg-layer-1)",
              color: "var(--dsw-alias-label-primary)",
              fontSize: 13,
            }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

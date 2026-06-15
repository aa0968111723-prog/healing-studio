/* AI Director · 設計套件元件 scope 包裝
 * ----------------------------------------------------------------------------
 * 設計套件元件（Button/Pill/Card/ShotCard/GateCard/PromptVault/WorkflowBuilder）
 * 綁設計系統短別名 token（--surface / --text / --muted＝次級文字…）。其中幾個與
 * app 既有 shadcn token 同名不同義，故元件「必須」用在 .aidv-kit 範圍內，token
 * 才會解析成設計套件原義（見 design-kit.css）。
 *
 * 用法：
 *   <AidvKit>            // 預設 <div className="aidv-kit">
 *     <ShotCard … />
 *   </AidvKit>
 *
 *   // 想換成其它元素（例如直接套在某個面板根節點）：
 *   <AidvKit as="section" className="p-4">…</AidvKit>
 *
 * 也可不用包裝，直接在任一祖先節點加 className="aidv-kit"。
 */
import * as React from "react";
import "./design-kit.css";
import { cn } from "./tokens";

type AidvKitProps = React.HTMLAttributes<HTMLElement> & {
  /** 要渲染的容器標籤（預設 div） */
  as?: keyof React.JSX.IntrinsicElements;
};

export function AidvKit({ as = "div", className, children, ...rest }: AidvKitProps) {
  return React.createElement(
    as,
    { className: cn("aidv-kit", className), ...rest },
    children,
  );
}

export default AidvKit;

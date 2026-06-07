// shells/SocialShell.tsx — 社群圖文 shell（新建；社群系統② 0 專屬實作）。
// P0 為佔位骨架，預設經 SHELL_SOCIAL=OFF 顯示「已關閉」；實 UI（重用 /video cockpit）為 P5。
import { ShellFrame } from "./ShellFrame";

export function SocialShell() {
  return <ShellFrame shell="social" />;
}

export default SocialShell;

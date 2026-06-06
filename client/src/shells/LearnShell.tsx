// shells/LearnShell.tsx — 學習文件 shell（group: learn）。
// 【P6】委派給 shells/learn/LearnShell（富 shell）。import 路徑不變（App/ShellRoutes 仍 import
//   "@/shells/LearnShell"），只把實作換成富 shell。SHELL_LEARN_RICH=OFF 時其內部會退回
//   ShellFrame（純 re-home 既有頁＝P0 行為），故本委派零風險、可一鍵還原。
export { LearnShell, default } from "./learn/LearnShell";

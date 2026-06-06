// shells/SettingsShell.tsx — 設定 shell（group: settings + admin）。
// 【P6/橫貫】委派給 shells/settings/SettingsShell（富 shell）。import 路徑不變（App/ShellRoutes
//   仍 import "@/shells/SettingsShell"），只把實作換成富 shell。SHELL_SETTINGS_RICH=OFF 時其
//   內部會退回 ShellFrame（純 re-home 既有頁＝P0 行為），故本委派零風險、可一鍵還原。
export { SettingsShell, default } from "./settings/SettingsShell";

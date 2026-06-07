// shells/VideoShell.tsx — 影片製作 shell（group: create/train/orb-創作）。
// 旗艦殼：P2 導演座艙（預設）；ENABLE_VIDEO_COCKPIT=OFF 時退回 P0 re-home 行為
//（DirectorAI / world-storyboard / image-video-pro studio / playground / light-orb）。
import { ENABLE_VIDEO_COCKPIT } from "@/config/videoFlags";
import { ShellFrame } from "./ShellFrame";
import { VideoCockpitFrame } from "./video/VideoCockpitFrame";

export function VideoShell() {
  // 本元件只在 ENABLE_4SHELL=ON 時被 ShellRoutes 掛載 → 座艙永遠在雙旗標之下。
  // ENABLE_VIDEO_COCKPIT=ON（預設）→ P2 旗艦座艙；=0 → 退回 P0 re-home（除錯逃生口）。
  if (ENABLE_VIDEO_COCKPIT) return <VideoCockpitFrame />;
  return <ShellFrame shell="video" />;
}

export default VideoShell;

/* AI Director · Flow TV 放映皮（barrel）— AIDV-117 / U-14
 * 全屏沉浸提示庫放映器（跨 /video /social）。零後端可回滾（flowTvFlags）。
 * 元件須用在 <AidvKit>（.aidv-kit scope）內；FlowTvOverlay 已自帶包裝。
 */
export {
  FlowTvOverlay,
  FlowTvOverlay as default,
  FLOW_TV_MOCK_ITEMS,
} from "./FlowTv";
export type { FlowTvItem, FlowTvOverlayProps } from "./FlowTv";
export { FLOW_TV_ENABLED, FLOW_TV_AUTOPLAY_MS } from "./flowTvFlags";

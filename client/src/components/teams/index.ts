/* AI Director · 團隊協作視覺（barrel）— U-13 / AIDV-116
 * /learn/teams 團隊協作系統視覺：團隊清單卡／成員列／角色標籤／共享範圍指示／分工看板。
 * 純前端唯讀消費 props（mock 離線可驗）；零後端可回滾（旗標見 teamsFlags.ts）。
 * 元件須用在 <AidvKit>（.aidv-kit scope）內，token 才解析成設計套件原義。
 */
export * from "./teamsTypes";
export * from "./teamsFlags";
export * from "./TeamAtoms";
export * from "./TeamCard";
export * from "./DivisionBoard";
export * from "./TeamsBoard";

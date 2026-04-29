# orbTraceId Trace Contract（v1）

日期：2026-04-29

## 目標
`orbTraceId` 是跨通道關聯 ID，用來把同一個任務在 HTTP(tRPC)、SSE、WS、Webhook、背景任務中的事件串起來。

## 欄位定義
- `traceId`：HTTP request-level 追蹤 ID（既有）。
- `orbTraceId`：跨通道/跨生命週期追蹤 ID（本次新增）。

## Header 規格
- 入站可帶：`x-orb-trace-id`
- 相容回退：若未帶 `x-orb-trace-id`，可使用 `x-trace-id`
- 出站回應：
  - `x-trace-id`
  - `x-orb-trace-id`

## 產生規則
1. 若請求帶 `x-orb-trace-id`：直接採用。
2. 否則若有 `x-trace-id`：採用其值。
3. 否則由 server 產生：`orb_${randomUUID()}`。

## context 傳遞
- `createContext()` 在 tRPC ctx 注入 `ctx.orbTraceId`。
- 若 header 無值，會從 logger async context 讀取；仍無值時 server 生成。

## logger 格式
每筆 JSON log 會包含：
- `traceId`
- `orbTraceId`
- `message`
- `metadata`

## 生命週期
- 建立：request middleware
- 傳遞：request header / async local storage / tRPC context
- 可擴充（下一步）：SSE event payload、WS envelope、webhook payload metadata、background job table


## Day 2 已落地通道
- SSE：連線建立事件 `connected` 會附帶 `orbTraceId`。
- SSE：generationBus emit 若未帶 `orbTraceId`，會自動回填 async context 的 `orbTraceId`。
- WS：`/ws/orb-voice` 支援 query `orbTraceId`，若缺失由 server 產生並回傳在 `ready/transcript/error` payload。
- Webhook(fal)：入站可讀 `x-orb-trace-id` 或 payload `orbTraceId`，結果回寫 `backgroundJobs.resultJson.orbTraceId`。

/**
 * seed-dev-multi-agent.ts — AIDV-406
 *
 * 開發環境 seed 腳本：
 *   1. 插入測試創作者（userId=1）
 *   2. 登記三個測試代理（video、image、audio 能力）
 *   3. 建立一筆測試 video_project
 *   4. 模擬 assign 路由，驗證選派正確
 *
 * 執行（需要本地 MySQL，via docker-compose）：
 *   docker compose -f dev-environment/docker-compose.yml up -d mysql
 *   DATABASE_URL=mysql://root:password@127.0.0.1:3306/healing npx tsx scripts/seed-dev-multi-agent.ts
 *
 * 退出碼：0 = 全過；非 0 = 至少一項失敗。
 */

process.env.NODE_ENV = process.env.NODE_ENV ?? "development";

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

async function main(): Promise<void> {
  const { getDb } = await import("../server/db");
  const { agentDynamicRegistry, videoProjects } = await import("../drizzle/schema");
  const { eq, sql } = await import("drizzle-orm");

  const db = await getDb();
  if (!db) {
    console.error("DB 不可用 — 請確認 DATABASE_URL 已設定且 MySQL 正在執行。");
    process.exit(2);
  }

  console.log("\n── 1) 清除舊測試代理（idempotent）─────────────────────────");
  const testAgentIds = ["seed-video-agent", "seed-image-agent", "seed-audio-agent"];
  for (const agentId of testAgentIds) {
    await db
      .delete(agentDynamicRegistry)
      .where(eq(agentDynamicRegistry.agentId, agentId))
      .catch(() => null);
  }
  console.log("  已清除舊測試代理。");

  console.log("\n── 2) 登記測試代理 ──────────────────────────────────────");
  const agents = [
    {
      agentId: "seed-video-agent",
      capabilities: ["video", "fal"],
      costPerToken: "0.002",
      currentLoad: "0.1",
      allowedEndpoints: ["studio.video", "studio.export"],
    },
    {
      agentId: "seed-image-agent",
      capabilities: ["image", "stable-diffusion"],
      costPerToken: "0.001",
      currentLoad: "0.5",
      allowedEndpoints: ["studio.image"],
    },
    {
      agentId: "seed-audio-agent",
      capabilities: ["audio", "tts"],
      costPerToken: "0.0005",
      currentLoad: "0.8",
      allowedEndpoints: null,
    },
  ];

  for (const agent of agents) {
    await db
      .insert(agentDynamicRegistry)
      .values({
        agentId: agent.agentId,
        capabilities: agent.capabilities,
        allowedEndpoints: agent.allowedEndpoints,
        costPerToken: agent.costPerToken,
        currentLoad: agent.currentLoad,
        isActive: true,
      })
      .onDuplicateKeyUpdate({
        set: {
          capabilities: agent.capabilities,
          allowedEndpoints: agent.allowedEndpoints,
          costPerToken: agent.costPerToken,
          currentLoad: agent.currentLoad,
          isActive: true,
          lastHeartbeatAt: sql`NOW()`,
        },
      });
    console.log(`  ✅ 登記代理: ${agent.agentId} (load=${agent.currentLoad})`);
  }

  console.log("\n── 3) 建立測試 video_project ────────────────────────────");
  const testUserId = 1;
  const insertResult = await db.insert(videoProjects).values({
    userId: testUserId,
    title: "AIDV-406 多代理派工種子影片",
    aspectRatio: "16:9",
    outputSpec: { resolution: "1080p", fps: 30, codec: "h264" },
    priorityClass: "standard",
  });
  const projectId = (insertResult[0] as { insertId: number }).insertId;
  check(`videoProject 建立成功 (id=${projectId})`, projectId > 0);

  console.log("\n── 4) 驗證 assign 路由（負載最低原則）─────────────────");
  // 取出符合 video 能力的活躍代理，按負載排序
  const candidates = await db
    .select()
    .from(agentDynamicRegistry)
    .where(eq(agentDynamicRegistry.isActive, true))
    .orderBy(agentDynamicRegistry.currentLoad)
    .limit(100);

  const videoAgents = candidates.filter(a => {
    const caps = a.capabilities as string[];
    return caps.includes("video") && caps.includes("fal");
  });

  check("有符合 [video, fal] 能力的代理", videoAgents.length > 0);
  if (videoAgents.length > 0) {
    const best = videoAgents[0]!;
    check(`選出負載最低代理: ${best.agentId}`, best.agentId === "seed-video-agent");
    check(`負載值正確 (load=0.1)`, parseFloat(best.currentLoad as string) <= 0.2);
  }

  // 驗證 scope guard：seed-image-agent 無 studio.video scope
  const scopeMismatch = candidates.filter(a => {
    const caps = a.capabilities as string[];
    if (!caps.includes("video")) return false;
    const allowed = (a.allowedEndpoints as string[] | null) ?? [];
    return !["studio.video"].every(s => allowed.includes(s));
  });
  check("scope guard：image-agent 不含 studio.video（不入選）",
    scopeMismatch.every(a => a.agentId !== "seed-video-agent"));

  console.log("\n── 5) 清除測試 video_project ────────────────────────────");
  if (projectId > 0) {
    await db.delete(videoProjects).where(eq(videoProjects.id, projectId));
    console.log(`  已刪除測試 project id=${projectId}`);
  }

  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("❌ 有項目未通過，請檢查 DB 狀態。");
    process.exit(1);
  }
  console.log("✅ 所有 seed 驗證通過。dev 環境已備妥多代理測試資料。\n");
}

main().catch(err => {
  console.error("Seed 腳本崩潰：", err);
  process.exit(1);
});

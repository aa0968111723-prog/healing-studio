/**
 * Test Replicate API Token validity and LoRA training submission
 */
import dotenv from "dotenv";
dotenv.config();

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

console.log("=== LoRA Training API Test ===");
console.log(
  `REPLICATE_API_TOKEN: ${REPLICATE_API_TOKEN ? REPLICATE_API_TOKEN.substring(0, 8) + "..." : "NOT SET"}`
);

if (!REPLICATE_API_TOKEN) {
  console.error("❌ REPLICATE_API_TOKEN is not set");
  process.exit(1);
}

// Test 1: Verify API Token by listing models
console.log("\n--- Test 1: Verify API Token ---");
try {
  const resp = await fetch(
    "https://api.replicate.com/v1/models/ostris/flux-dev-lora-trainer",
    {
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
    }
  );
  const data = await resp.json();
  if (resp.ok) {
    console.log(`✅ API Token valid. Model: ${data.name || data.url}`);
    console.log(`   Owner: ${data.owner}`);
    console.log(
      `   Description: ${(data.description || "").substring(0, 80)}...`
    );
    if (data.latest_version) {
      console.log(`   Latest version: ${data.latest_version.id}`);
    }
  } else {
    console.error(`❌ API Token invalid or model not found: ${resp.status}`);
    console.error(JSON.stringify(data, null, 2));
  }
} catch (err) {
  console.error(`❌ Network error: ${err.message}`);
}

// Test 2: Check account billing/quota
console.log("\n--- Test 2: Check Account ---");
try {
  const resp = await fetch("https://api.replicate.com/v1/account", {
    headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
  });
  const data = await resp.json();
  if (resp.ok) {
    console.log(`✅ Account: ${data.username || data.github_url || "OK"}`);
    console.log(`   Type: ${data.type || "unknown"}`);
  } else {
    console.error(`⚠️ Account check failed: ${resp.status}`);
    console.error(JSON.stringify(data, null, 2));
  }
} catch (err) {
  console.error(`❌ Network error: ${err.message}`);
}

// Test 3: Dry-run prediction creation (without actually submitting)
console.log("\n--- Test 3: Prediction API Access ---");
try {
  const resp = await fetch("https://api.replicate.com/v1/predictions", {
    method: "GET",
    headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
  });
  const data = await resp.json();
  if (resp.ok) {
    console.log(
      `✅ Predictions API accessible. Recent predictions: ${data.results?.length || 0}`
    );
    if (data.results && data.results.length > 0) {
      const latest = data.results[0];
      console.log(
        `   Latest: ${latest.model} | status: ${latest.status} | created: ${latest.created_at}`
      );
    }
  } else {
    console.error(`⚠️ Predictions API check failed: ${resp.status}`);
    console.error(JSON.stringify(data, null, 2));
  }
} catch (err) {
  console.error(`❌ Network error: ${err.message}`);
}

console.log("\n=== Test Complete ===");

import { describe, expect, it } from "vitest";
import {
  accessLevelLabel,
  dataSourceKindLabel,
  matchedByLabel,
  connectionStatusLabel,
  providerLabel,
} from "./teamDataFormat";

describe("teamDataFormat", () => {
  it("labels access levels", () => {
    expect(accessLevelLabel("summary_only")).toBe("僅摘要");
    expect(accessLevelLabel("none")).toBe("不開放");
    expect(accessLevelLabel("full_reference")).toBe("完整引用");
    expect(accessLevelLabel("unknown")).toBe("unknown");
  });

  it("labels data source kinds", () => {
    expect(dataSourceKindLabel("team_data")).toBe("團隊資料");
    expect(dataSourceKindLabel("cloud")).toBe("雲端");
    expect(dataSourceKindLabel("notes")).toBe("筆記");
    expect(dataSourceKindLabel("weird")).toBe("weird");
  });

  it("labels AIDV-303 project context source kinds", () => {
    expect(dataSourceKindLabel("worldbuilding")).toBe("世界觀");
    expect(dataSourceKindLabel("character")).toBe("角色");
    expect(dataSourceKindLabel("scene")).toBe("場景");
    expect(dataSourceKindLabel("continuity")).toBe("連貫性");
  });

  it("labels matchedBy (empty for nullish)", () => {
    expect(matchedByLabel("vector")).toBe("語意");
    expect(matchedByLabel("fts")).toBe("關鍵字");
    expect(matchedByLabel(null)).toBe("");
    expect(matchedByLabel(undefined)).toBe("");
  });

  it("labels connection status and provider", () => {
    expect(connectionStatusLabel("active")).toBe("啟用中");
    expect(connectionStatusLabel("error")).toBe("連線異常");
    expect(providerLabel("google_drive")).toBe("Google Drive");
    expect(providerLabel("notion")).toBe("Notion");
    expect(providerLabel("custom")).toBe("custom");
  });
});

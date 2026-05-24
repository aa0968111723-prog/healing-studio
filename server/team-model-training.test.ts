/**
 * team-model-training.test.ts — M 訓練 track
 *
 * 驗證：訓練資料集只收 full_reference + team_shared + image + fileUrl 的素材；
 * 發起訓練需 owner/admin + 授權確認 + REPLICATE token + 足量圖片；happy path 建立
 * team_shared 模型並啟動 Replicate；listModels 任一成員可讀。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getTeamMembershipMock = vi.fn();
const listTeachingMaterialsForUserMock = vi.fn();
const listProjectDataAccessRulesMock = vi.fn();
const createFineTunedModelMock = vi.fn();
const updateFineTunedModelMock = vi.fn();
const getFineTunedModelsByTeamMock = vi.fn();
const buildAndUploadZipMock = vi.fn();
const startReplicateTrainingMock = vi.fn();

vi.mock("./db", () => ({
  getTeamMembership: (...a: unknown[]) => getTeamMembershipMock(...a),
  listTeachingMaterialsForUser: (...a: unknown[]) =>
    listTeachingMaterialsForUserMock(...a),
  listProjectDataAccessRules: (...a: unknown[]) =>
    listProjectDataAccessRulesMock(...a),
  createFineTunedModel: (...a: unknown[]) => createFineTunedModelMock(...a),
  updateFineTunedModel: (...a: unknown[]) => updateFineTunedModelMock(...a),
  getFineTunedModelsByTeam: (...a: unknown[]) => getFineTunedModelsByTeamMock(...a),
}));

vi.mock("./services/falTrainer", () => ({
  buildAndUploadZip: (...a: unknown[]) => buildAndUploadZipMock(...a),
}));
vi.mock("./services/replicateClient", () => ({
  startReplicateTraining: (...a: unknown[]) => startReplicateTrainingMock(...a),
}));
vi.mock("./_core/webhookTokens", () => ({
  signWebhookToken: () => "tok",
}));

import {
  previewTeamTrainingDataset,
  startTeamModelTraining,
  listTeamModels,
} from "./subsystems/trainingTrack/trainingTrackService";

const USER = 42;
const TEAM = 7;

function img(id: number, over: Record<string, unknown> = {}) {
  return { id, title: `素材${id}`, teamId: TEAM, fileUrl: `https://cdn/${id}.png`, mediaType: "image", userId: 1, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REPLICATE_API_TOKEN = "rep_token";
  getTeamMembershipMock.mockResolvedValue({ teamId: TEAM, userId: USER, role: "admin" });
  listProjectDataAccessRulesMock.mockResolvedValue([
    { id: 1, teamId: TEAM, projectId: null, materialId: null, connectionId: null, accessLevel: "full_reference", allowedModesJson: null },
  ]);
  buildAndUploadZipMock.mockResolvedValue("https://cdn/dataset.zip");
  startReplicateTrainingMock.mockResolvedValue({ trainingId: "tr_1", status: "starting" });
  updateFineTunedModelMock.mockResolvedValue(undefined);
});

describe("collectTeamTrainingImages (via previewDataset)", () => {
  it("includes only full_reference + team + image + fileUrl materials", async () => {
    getTeamMembershipMock.mockResolvedValue({ role: "member" });
    listTeachingMaterialsForUserMock.mockResolvedValue([
      img(1),
      img(2),
      img(3, { fileUrl: null }), // 無 fileUrl → 排除
      img(4, { teamId: 999 }), // 別隊 → 排除
    ]);
    const res = await previewTeamTrainingDataset(USER, { teamId: TEAM, projectId: null });
    expect(res.count).toBe(2);
    expect(res.sample.map(s => s.id)).toEqual([1, 2]);
  });

  it("excludes a material with an explicit none rule (material-specific overrides team-wide)", async () => {
    getTeamMembershipMock.mockResolvedValue({ role: "member" });
    listTeachingMaterialsForUserMock.mockResolvedValue([img(1), img(2)]);
    listProjectDataAccessRulesMock.mockResolvedValue([
      { id: 1, teamId: TEAM, projectId: null, materialId: null, connectionId: null, accessLevel: "full_reference", allowedModesJson: null },
      { id: 2, teamId: TEAM, projectId: null, materialId: 2, connectionId: null, accessLevel: "none", allowedModesJson: null },
    ]);
    const res = await previewTeamTrainingDataset(USER, { teamId: TEAM, projectId: null });
    expect(res.sample.map(s => s.id)).toEqual([1]);
  });

  it("excludes summary_only materials (training requires full_reference)", async () => {
    getTeamMembershipMock.mockResolvedValue({ role: "member" });
    listTeachingMaterialsForUserMock.mockResolvedValue([img(1)]);
    listProjectDataAccessRulesMock.mockResolvedValue([
      { id: 1, teamId: TEAM, projectId: null, materialId: null, connectionId: null, accessLevel: "summary_only", allowedModesJson: null },
    ]);
    const res = await previewTeamTrainingDataset(USER, { teamId: TEAM, projectId: null });
    expect(res.count).toBe(0);
  });
});

describe("startTeamModelTraining", () => {
  const baseInput = {
    teamId: TEAM,
    projectId: null,
    modelName: "團隊風格 A",
    triggerWord: "teamstyle",
    modelType: "style_lora" as const,
    consentAcknowledged: true,
  };

  it("creates a team_shared model and starts Replicate training", async () => {
    listTeachingMaterialsForUserMock.mockResolvedValue([img(1), img(2), img(3), img(4), img(5)]);
    createFineTunedModelMock.mockResolvedValue(100);

    const res = await startTeamModelTraining(USER, baseInput);

    expect(createFineTunedModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: TEAM, visibility: "team_shared", modelType: "style_lora", status: "pending" })
    );
    expect(buildAndUploadZipMock).toHaveBeenCalled();
    expect(startReplicateTrainingMock).toHaveBeenCalled();
    expect(updateFineTunedModelMock).toHaveBeenCalledWith(
      100,
      expect.objectContaining({ status: "training", replicatePredictionId: "tr_1" })
    );
    expect(res).toMatchObject({ modelId: 100, imageCount: 5 });
  });

  it("rejects a non-admin (forbidden)", async () => {
    getTeamMembershipMock.mockResolvedValue({ role: "member" });
    await expect(startTeamModelTraining(USER, baseInput)).rejects.toMatchObject({ reason: "forbidden" });
    expect(createFineTunedModelMock).not.toHaveBeenCalled();
  });

  it("requires consent acknowledgement", async () => {
    await expect(
      startTeamModelTraining(USER, { ...baseInput, consentAcknowledged: false })
    ).rejects.toMatchObject({ reason: "precondition" });
  });

  it("requires REPLICATE_API_TOKEN", async () => {
    delete process.env.REPLICATE_API_TOKEN;
    await expect(startTeamModelTraining(USER, baseInput)).rejects.toMatchObject({ reason: "precondition" });
  });

  it("requires at least the minimum number of images", async () => {
    listTeachingMaterialsForUserMock.mockResolvedValue([img(1), img(2)]); // 只有 2 張
    await expect(startTeamModelTraining(USER, baseInput)).rejects.toMatchObject({ reason: "precondition" });
    expect(buildAndUploadZipMock).not.toHaveBeenCalled();
  });

  it("marks the model failed if the Replicate kickoff throws", async () => {
    listTeachingMaterialsForUserMock.mockResolvedValue([img(1), img(2), img(3), img(4)]);
    createFineTunedModelMock.mockResolvedValue(101);
    startReplicateTrainingMock.mockRejectedValue(new Error("replicate down"));

    await expect(startTeamModelTraining(USER, baseInput)).rejects.toMatchObject({ reason: "precondition" });
    expect(updateFineTunedModelMock).toHaveBeenCalledWith(101, { status: "failed" });
  });
});

describe("listTeamModels", () => {
  it("maps team models for a member", async () => {
    getTeamMembershipMock.mockResolvedValue({ role: "member" });
    getFineTunedModelsByTeamMock.mockResolvedValue([
      { id: 100, name: "團隊風格 A", modelType: "style_lora", status: "ready", configJson: { triggerWord: "teamstyle" }, teamId: TEAM, createdAt: new Date("2026-05-24T00:00:00.000Z") },
    ]);
    const models = await listTeamModels(USER, TEAM);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ id: 100, status: "ready", triggerWord: "teamstyle", teamId: TEAM });
  });

  it("rejects a non-member (forbidden)", async () => {
    getTeamMembershipMock.mockResolvedValue(null);
    await expect(listTeamModels(USER, TEAM)).rejects.toMatchObject({ reason: "forbidden" });
  });
});

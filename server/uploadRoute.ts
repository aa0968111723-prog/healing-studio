import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { storagePut } from "./storage";
import { authenticateRequest } from "./_core/googleAuth";

const uploadRouter = Router();

// Parse raw body for file uploads (multipart handled manually via base64 JSON)
// We use JSON-based upload: { fileName, mimeType, data (base64) }
uploadRouter.post("/api/upload", async (req: Request, res: Response) => {
  try {
    // Authenticate the request
    const user = await authenticateRequest(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { fileName, mimeType, data } = req.body as {
      fileName: string;
      mimeType: string;
      data: string; // base64 encoded
    };

    if (!fileName || !mimeType || !data) {
      res.status(400).json({ error: "Missing fileName, mimeType, or data" });
      return;
    }

    // Decode base64 data
    const buffer = Buffer.from(data, "base64");

    // Check file size (max 16MB)
    const MAX_SIZE = 16 * 1024 * 1024;
    if (buffer.length > MAX_SIZE) {
      res.status(413).json({ error: "File too large. Maximum size is 16MB." });
      return;
    }

    // Generate a unique file key to prevent enumeration
    const suffix = nanoid(8);
    const ext = fileName.includes(".") ? fileName.split(".").pop() : "";
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileKey = `uploads/${user.id}/${safeFileName}-${suffix}${ext ? "." + ext : ""}`;

    // Upload to S3 via storagePut
    const { url, key } = await storagePut(fileKey, buffer, mimeType);

    res.json({
      success: true,
      url,
      fileKey: key,
      fileName: safeFileName,
      mimeType,
      fileSizeBytes: buffer.length,
    });
  } catch (error: any) {
    console.error("[Upload] Error:", error);
    if (error.message?.includes("authenticate") || error.message?.includes("Unauthorized")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    // Return a short, user-friendly error — avoid dumping long config instructions to the UI
    const isStorageError =
      error.message?.includes("Storage") ||
      error.message?.includes("S3") ||
      error.message?.includes("GCS") ||
      error.message?.includes("Forge");
    if (isStorageError) {
      res.status(503).json({
        error: "Storage 未設定：請聯絡管理員在 Railway 設定 S3/R2 儲存環境變數。",
      });
      return;
    }
    res.status(500).json({ error: "Upload failed: " + (error.message || "Unknown error") });
  }
});

export { uploadRouter };

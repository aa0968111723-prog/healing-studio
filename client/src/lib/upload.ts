/**
 * Shared file upload helper — uploads a File to S3 via /api/upload
 */
export async function uploadFileToS3(file: File): Promise<{ url: string; fileKey: string }> {
  const reader = new FileReader();
  const base64 = await new Promise<string>((resolve, reject) => {
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(",")[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      data: base64,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "上傳失敗" }));
    throw new Error(err.error || "上傳失敗");
  }

  const result = await response.json();
  return { url: result.url, fileKey: result.fileKey };
}

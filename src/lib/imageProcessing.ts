// Image helpers for publishing. Kept out of the component so the publish flow
// reads as flow, not pixel-pushing. Browser-only (Canvas / Image / btoa).

export async function fileToBase64(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

// Tauri 2 postMessage IPC fallback (WebView2) молча дропает большие сообщения.
// Гарантируем что JPEG ≤ JPEG_MAX_BYTES перед base64-кодированием.
const MAX_IMAGE_DIMENSION = 1280;
const JPEG_MAX_BYTES = 100 * 1024; // 100 КБ → base64 ≈ 133 КБ

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Canvas toBlob failed"));
      else resolve(blob);
    }, "image/jpeg", quality);
  });
}

/** Convert + downscale image to JPEG via Canvas with guaranteed size limit. */
export async function normalizeImageToJpeg(
  file: File,
): Promise<{ base64: string; mimeType: string; fileName: string }> {
  if (file.type === "image/gif") {
    return { base64: await fileToBase64(file), mimeType: "image/gif", fileName: file.name };
  }

  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = blobUrl;
    });

    const stem = file.name.replace(/\.[^.]+$/, "");

    // Пробуем прогрессивно уменьшать размер и качество пока не уложимся в лимит.
    for (const dim of [MAX_IMAGE_DIMENSION, 1024, 800, 640]) {
      let { naturalWidth: w, naturalHeight: h } = img;
      const longest = Math.max(w, h);
      if (longest > dim) {
        const scale = dim / longest;
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);

      for (const quality of [0.85, 0.72, 0.58, 0.44]) {
        const blob = await canvasToBlob(canvas, quality);
        if (blob.size <= JPEG_MAX_BYTES) {
          return { base64: await fileToBase64(blob), mimeType: "image/jpeg", fileName: `${stem}.jpg` };
        }
      }
    }

    // Крайний случай: принудительный минимум
    const canvas = document.createElement("canvas");
    canvas.width  = 640;
    canvas.height = Math.round(img.naturalHeight * (640 / img.naturalWidth));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 0.44);
    return { base64: await fileToBase64(blob), mimeType: "image/jpeg", fileName: `${stem}.jpg` };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

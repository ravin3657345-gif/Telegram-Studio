import { fileRegistry } from "@/lib/fileRegistry";
import type { DraftAttachment } from "@/types/draft";

// Shared by restoreAttachmentsIntoJson/registerFilesIntoJson below — walks the
// doc patching every blockImage/blockVideo node's `src` to the freshly
// registered blob URL for its `fileId`, once the caller has already gotten
// real File objects into fileRegistry by whatever means (base64 over IPC,
// a bundled local asset, ...).
function patchSrcByFileId(contentJson: string, urlMap: Record<string, string>): string {
  if (!Object.keys(urlMap).length) return contentJson;
  try {
    const doc = JSON.parse(contentJson);
    const patchNode = (node: Record<string, unknown>) => {
      if (node.attrs && typeof node.attrs === "object") {
        const attrs = node.attrs as Record<string, unknown>;
        if (typeof attrs.fileId === "string" && urlMap[attrs.fileId]) {
          attrs.src = urlMap[attrs.fileId];
        }
      }
      if (Array.isArray(node.content)) {
        (node.content as Record<string, unknown>[]).forEach(patchNode);
      }
    };
    patchNode(doc);
    return JSON.stringify(doc);
  } catch {
    return contentJson;
  }
}

/**
 * Rebuilds in-memory blob URLs for a post's file attachments and patches
 * every blockImage/blockVideo node's `src` to point at them, keyed by the
 * same `fileId` the node already carries. Used both when opening an existing
 * draft and when applying a (database-backed) template — either way the
 * actual bytes only exist on disk (base64-encoded over IPC) until this runs.
 */
export function restoreAttachmentsIntoJson(contentJson: string, attachments: DraftAttachment[]): string {
  if (!attachments.length) return contentJson;

  const urlMap: Record<string, string> = {};
  for (const att of attachments) {
    try {
      const byteStr = atob(att.dataBase64);
      const bytes = new Uint8Array(byteStr.length);
      for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
      const file = new File([bytes], att.fileName, { type: att.mimeType });
      urlMap[att.fileId] = fileRegistry.addWithId(att.fileId, file);
    } catch { /* skip broken attachment */ }
  }
  return patchSrcByFileId(contentJson, urlMap);
}

/**
 * Same job as restoreAttachmentsIntoJson, but for File objects already in
 * hand (e.g. fetched from a bundled static asset — see the showcase example
 * template in exampleTemplates.ts) instead of base64 DraftAttachments that
 * arrived over Tauri IPC. Skips the base64 round-trip since there's no IPC
 * boundary to cross for a file that's already local.
 */
export function registerFilesIntoJson(contentJson: string, files: Record<string, File>): string {
  const urlMap: Record<string, string> = {};
  for (const [fileId, file] of Object.entries(files)) {
    urlMap[fileId] = fileRegistry.addWithId(fileId, file);
  }
  return patchSrcByFileId(contentJson, urlMap);
}

/**
 * Reads every blockImage/blockVideo `fileId` still resolvable in fileRegistry
 * back out as a base64 DraftAttachment, ready to send to upsertDraft/saveTemplate.
 * Shared by useAutoSave (drafts) and EditorPage's "save as template" action.
 */
export async function collectInlineAttachments(contentJson: string): Promise<DraftAttachment[]> {
  try {
    const doc = JSON.parse(contentJson || "{}");
    const promises: Promise<DraftAttachment>[] = [];

    const collect = (node: Record<string, unknown>) => {
      const attrs = node.attrs as Record<string, unknown> | undefined;
      if (attrs && typeof attrs.fileId === "string") {
        const fileId = attrs.fileId as string;
        const file = fileRegistry.getFile(fileId);
        if (file) {
          promises.push(new Promise<DraftAttachment>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const b64 = (reader.result as string).split(",")[1] ?? "";
              resolve({ fileId, dataBase64: b64, mimeType: file.type, fileName: file.name });
            };
            reader.readAsDataURL(file);
          }));
        }
      }
      if (Array.isArray(node.content)) {
        (node.content as Record<string, unknown>[]).forEach(collect);
      }
    };
    collect(doc);

    return await Promise.all(promises);
  } catch {
    return [];
  }
}

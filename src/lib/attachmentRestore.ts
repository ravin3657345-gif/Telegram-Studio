import { fileRegistry } from "@/lib/fileRegistry";
import type { DraftAttachment } from "@/types/draft";

/**
 * Rebuilds in-memory blob URLs for a post's file attachments and patches
 * every blockImage/blockVideo node's `src` to point at them, keyed by the
 * same `fileId` the node already carries. Used both when opening an existing
 * draft and when applying a template — either way the actual bytes only
 * exist on disk (base64-encoded over IPC) until this runs.
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

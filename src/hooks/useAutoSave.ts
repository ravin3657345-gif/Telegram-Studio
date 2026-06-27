import { useEffect, useRef } from "react";
import { useEditorStore } from "@/store/editorStore";
import { useAttachmentStore } from "@/store/attachmentStore";
import { fileRegistry } from "@/lib/fileRegistry";
import { upsertDraft } from "@/lib/tauriApi";
import { AUTOSAVE_DEBOUNCE_MS } from "@/lib/constants";
import type { DraftAttachment } from "@/types/draft";

function extractPlainText(json: string): string {
  try {
    const doc = JSON.parse(json);
    const parts: string[] = [];
    function walk(node: any) {
      if (!node) return;
      if (node.type === "text") parts.push(node.text ?? "");
      if (node.type === "hardBreak") parts.push(" ");
      if (Array.isArray(node.content)) node.content.forEach(walk);
    }
    walk(doc);
    return parts.join("").replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    return "";
  }
}

export function useAutoSave(enabled = true) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe only to trigger changes — actual values read from store at fire time
  const contentJson = useEditorStore((s) => s.contentJson);
  const postTitle   = useEditorStore((s) => s.postTitle);

  useEffect(() => {
    if (!enabled) return;
    if (!contentJson && !postTitle) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      // Read ALL values fresh from store to avoid stale closures
      const {
        draftId, draftTitle, postTitle: latestPostTitle,
        contentJson: latestContentJson,
        setSaveStatus, setLastSavedAt, setDraftId,
      } = useEditorStore.getState();

      if (!latestContentJson && !latestPostTitle) return;

      setSaveStatus("saving");
      try {
        // Collect file attachments from the editor JSON
        let attachments: DraftAttachment[] = [];
        try {
          const doc = JSON.parse(latestContentJson || "{}");
          const promises: Promise<DraftAttachment>[] = [];
          const collectNodes = (node: Record<string, unknown>) => {
            if (node.attrs && typeof node.attrs === "object") {
              const attrs = node.attrs as Record<string, unknown>;
              if (typeof attrs.fileId === "string") {
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
            }
            if (Array.isArray(node.content)) {
              (node.content as Record<string, unknown>[]).forEach(collectNodes);
            }
          };
          collectNodes(doc);

          // Also save bottom-panel attachmentStore files to draft_media
          const { files: bottomFiles } = useAttachmentStore.getState();
          for (const af of bottomFiles) {
            const file = fileRegistry.getFile(af.id);
            if (file) {
              promises.push(new Promise<DraftAttachment>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => {
                  const b64 = (reader.result as string).split(",")[1] ?? "";
                  resolve({ fileId: af.id, dataBase64: b64, mimeType: af.mimeType, fileName: af.name });
                };
                reader.readAsDataURL(file);
              }));
            }
          }

          attachments = await Promise.all(promises);
        } catch { /* skip */ }

        const draft = await upsertDraft({
          id:          draftId ?? undefined,
          title:       draftTitle,
          postTitle:   latestPostTitle,
          contentJson: latestContentJson || "{}",
          contentText: extractPlainText(latestContentJson),
          attachments: attachments.length ? attachments : undefined,
        });
        if (!draftId) setDraftId(draft.id);
        setSaveStatus("saved");
        setLastSavedAt(new Date());
      } catch {
        setSaveStatus("error");
      }
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [contentJson, postTitle, enabled]);
}

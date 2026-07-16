import { useEffect, useRef } from "react";
import { useEditorStore } from "@/store/editorStore";
import { useAttachmentStore } from "@/store/attachmentStore";
import { useSettingsStore } from "@/store/settingsStore";
import { fileRegistry } from "@/lib/fileRegistry";
import { upsertDraft } from "@/lib/tauriApi";
import { collectInlineAttachments } from "@/lib/attachmentRestore";
import { t } from "@/lib/i18n";
import { toast } from "@/store/uiStore";
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

export function useAutoSave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastErrorShownRef = useRef<string | null>(null);

  // Subscribe only to trigger changes — actual values read from store at fire time
  const contentJson = useEditorStore((s) => s.contentJson);
  const postTitle   = useEditorStore((s) => s.postTitle);
  const autosaveInterval = useSettingsStore((s) => s.autosaveInterval);

  useEffect(() => {
    if (autosaveInterval <= 0) return;
    if (!contentJson && !postTitle) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      // Read ALL values fresh from store to avoid stale closures
      const {
        draftId, draftTitle, postTitle: latestPostTitle,
        contentJson: latestContentJson, publishMode,
        setSaveStatus, setSaveErrorMessage, setLastSavedAt, setDraftId,
      } = useEditorStore.getState();

      if (!latestContentJson && !latestPostTitle) return;

      setSaveStatus("saving");
      try {
        // Collect file attachments from the editor JSON
        let attachments: DraftAttachment[] = [];
        try {
          attachments = await collectInlineAttachments(latestContentJson || "{}");

          // Also save bottom-panel attachmentStore files to draft_media
          const { files: bottomFiles } = useAttachmentStore.getState();
          const bottomPromises: Promise<DraftAttachment>[] = [];
          for (const af of bottomFiles) {
            const file = fileRegistry.getFile(af.id);
            if (file) {
              bottomPromises.push(new Promise<DraftAttachment>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => {
                  const b64 = (reader.result as string).split(",")[1] ?? "";
                  resolve({ fileId: af.id, dataBase64: b64, mimeType: af.mimeType, fileName: af.name });
                };
                reader.readAsDataURL(file);
              }));
            }
          }
          attachments = attachments.concat(await Promise.all(bottomPromises));
        } catch { /* skip */ }

        const draft = await upsertDraft({
          id:          draftId ?? undefined,
          title:       draftTitle,
          postTitle:   latestPostTitle,
          contentJson: latestContentJson || "{}",
          contentText: extractPlainText(latestContentJson),
          publishMode,
          attachments: attachments.length ? attachments : undefined,
        });
        if (!draftId) setDraftId(draft.id);
        setSaveStatus("saved");
        setSaveErrorMessage(null);
        setLastSavedAt(new Date());
        lastErrorShownRef.current = null;
      } catch (e) {
        // Tauri commands return Result<T, String> — the reject value is
        // already the human-readable Rust error string (e.g. attachment
        // count/size limits from attachments::validate), not a stack trace.
        const msg = e instanceof Error ? e.message : String(e);
        setSaveStatus("error");
        setSaveErrorMessage(msg);
        // Autosave retries on every content change, so only toast once per
        // distinct error instead of spamming on every keystroke-triggered retry.
        if (lastErrorShownRef.current !== msg) {
          lastErrorShownRef.current = msg;
          toast.error(t("editor.saveError"), msg);
        }
      }
    }, autosaveInterval);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [contentJson, postTitle, autosaveInterval]);
}

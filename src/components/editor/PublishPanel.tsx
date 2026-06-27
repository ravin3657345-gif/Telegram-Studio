import { useState } from "react";
import { Send, Clock, CheckCircle2, AlertCircle, Loader2, ChevronDown, ExternalLink, FileText, Layers, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ScheduleDialog } from "@/components/editor/ScheduleDialog";
import { useChannelsStore } from "@/store/channelsStore";
import { usePublishStore } from "@/store/publishStore";
import { useEditorStore } from "@/store/editorStore";
import { publishPost, schedulePost, telegraphPublish, publishRichPost, sendPoll, editPublishedPost } from "@/lib/tauriApi";
import { segmentDocument } from "@/lib/htmlConverter";
import type { TextSegment, ImageSegment, VideoSegment, FileSegment, PollSegment } from "@/lib/htmlConverter";
import { tiptapToTelegraphNodes } from "@/lib/telegraphConverter";
import { tiptapToRichHtml } from "@/lib/richMessageConverter";
import { fileRegistry } from "@/lib/fileRegistry";
import { useAttachmentStore } from "@/store/attachmentStore";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { toast } from "@/store/uiStore";
import type { PublishResult } from "@/types/publish";

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function fileToBase64(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

/** Convert any image to JPEG via Canvas. Handles WebP, BMP, HEIC, etc. */
async function normalizeImageToJpeg(file: File): Promise<{ base64: string; mimeType: string; fileName: string }> {
  const SUPPORTED = ["image/jpeg", "image/png", "image/gif"];

  if (file.type === "image/gif") {
    return { base64: await fileToBase64(file), mimeType: "image/gif", fileName: file.name };
  }

  if (SUPPORTED.includes(file.type)) {
    const slice = await file.slice(0, 4).arrayBuffer();
    const b = new Uint8Array(slice);
    const isJpeg = b[0] === 0xFF && b[1] === 0xD8;
    const isPng  = b[0] === 0x89 && b[1] === 0x50;
    if (isJpeg || isPng) {
      return { base64: await fileToBase64(file), mimeType: file.type, fileName: file.name };
    }
  }

  const blobUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = blobUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);

    const base64 = await new Promise<string>((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) { reject(new Error("Canvas toBlob failed")); return; }
        try { resolve(await fileToBase64(blob)); } catch (e) { reject(e); }
      }, "image/jpeg", 0.92);
    });

    const stem = file.name.replace(/\.[^.]+$/, "");
    return { base64, mimeType: "image/jpeg", fileName: `${stem}.jpg` };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface PublishPanelProps { draftId?: string }

export function PublishPanel({ draftId }: PublishPanelProps) {
  const { bots, channels, activeBot, setActiveBot } = useChannelsStore();
  const { selectedChannelIds, status, results, lastError,
          toggleChannel, setChannels, setStatus, setResults, setError, reset } = usePublishStore();
  const { contentJson, postTitle, includeTitle, publishMode, setPublishMode, editingHistoryId, setEditingHistoryId } = useEditorStore();
  useSettingsStore((s) => s.language);
  const attachedFiles    = useAttachmentStore((s) => s.files);
  const clearAttachments = useAttachmentStore((s) => s.clearAll);

  const [showSchedule, setShowSchedule] = useState(false);
  const [telegraphUrl, setTelegraphUrl] = useState<string | null>(null);

  const botChannels = activeBot ? channels.filter((c) => c.botId === activeBot) : channels;

  const effectiveTitle = includeTitle ? postTitle : "";
  const segments = segmentDocument(contentJson || '{"type":"doc","content":[]}', effectiveTitle);
  const hasAttachments = attachedFiles.length > 0;
  const hasContent = hasAttachments || segments.some(
    (s) =>
      (s.type === "text" && s.html.trim()) ||
      s.type === "image" ||
      s.type === "video" ||
      s.type === "file" ||
      (s.type === "poll" && s.question.trim().length > 0 && s.options.filter((o) => o.trim()).length >= 2)
  );
  const hasFiles = hasAttachments || segments.some((s) => s.type === "file");
  const fileBlockedInRich = publishMode === "rich" && hasFiles;
  const canPublish =
    !!activeBot && selectedChannelIds.length > 0 && hasContent &&
    !fileBlockedInRich &&
    status !== "publishing" && status !== "scheduling";

  // ── Normal publish ───────────────────────────────────────────────────────────

  async function publishAllSegments(): Promise<PublishResult[]> {
    const allResults: PublishResult[] = [];

    const polls   = segments.filter((s): s is PollSegment  => s.type === "poll");
    const nonPoll = segments.filter((s) => s.type !== "poll");

    const captionHtml = nonPoll
      .filter((s): s is TextSegment => s.type === "text")
      .map((s) => s.html.trim())
      .filter(Boolean)
      .join("\n\n");

    const mediaSegs = nonPoll.filter(
      (s): s is ImageSegment | VideoSegment | FileSegment =>
        s.type === "image" || s.type === "video" || s.type === "file"
    );

    for (const channelId of selectedChannelIds) {
      const channel = channels.find((c) => c.id === channelId);
      let success = true;
      let lastMsgId: number | null = null;
      let errorMsg: string | null = null;

      try {
        // Read fresh Zustand state to avoid stale closure when async runs after re-render
        const freshAttachments = useAttachmentStore.getState().files;
        if (captionHtml || mediaSegs.length > 0 || freshAttachments.length > 0) {
          const mediaItems: { fileName: string; mimeType: string; mediaType: string; dataBase64: string }[] = [];

          // Images / videos from editor blocks
          for (const seg of mediaSegs) {
            const file = fileRegistry.getFile(seg.fileId);
            if (!file) continue;
            const { base64: dataBase64, mimeType, fileName } = seg.type === "image"
              ? await normalizeImageToJpeg(file)
              : { base64: await fileToBase64(file), mimeType: seg.mimeType, fileName: seg.fileName };
            mediaItems.push({ fileName, mimeType, mediaType: seg.type, dataBase64 });
          }

          // Files from the attachment panel
          for (const att of freshAttachments) {
            const file = fileRegistry.getFile(att.id);
            if (!file) throw new Error(ti("attach.fileGone", { name: att.name }));
            const dataBase64 = await fileToBase64(file);
            mediaItems.push({ fileName: att.name, mimeType: att.mimeType, mediaType: "file", dataBase64 });
          }

          const res = await publishPost({
            botId: activeBot!,
            channelIds: [channelId],
            contentHtml: captionHtml,
            media: mediaItems,
            buttons: [],
            draftId: draftId ?? null,
            scheduleAt: null,
          });
          if (res[0]?.success) lastMsgId = res[0].telegramMsgId ?? null;
          else { success = false; errorMsg = res[0]?.errorMessage ?? t("common.error"); }
        }

        if (success) {
          for (const seg of polls) {
            const validOpts = seg.options.filter((o) => o.trim().length > 0);
            if (!seg.question.trim() || validOpts.length < 2) continue;
            const res = await sendPoll({
              botId: activeBot!,
              channelIds: [channelId],
              question: seg.question,
              options: validOpts,
              isAnonymous: seg.isAnonymous,
              allowsMultipleAnswers: seg.allowsMultipleAnswers,
            });
            if (res[0]?.success) lastMsgId = res[0].telegramMsgId ?? null;
            else { success = false; errorMsg = res[0]?.errorMessage ?? t("common.error"); break; }
          }
        }
      } catch (e) {
        success = false;
        errorMsg = String(e);
      }

      allResults.push({
        channelId,
        channelTitle: channel?.title ?? channelId,
        success,
        telegramMsgId: lastMsgId,
        errorMessage: errorMsg,
      });
    }

    return allResults;
  }

  // ── Rich message publish ─────────────────────────────────────────────────────

  async function publishViaRichMessage(): Promise<PublishResult[]> {
    const { html, photos } = tiptapToRichHtml(
      contentJson || '{"type":"doc","content":[]}',
      effectiveTitle
    );

    const filledPhotos = await Promise.all(
      photos.map(async (p) => {
        const file = fileRegistry.getFile(p.fileId);
        if (!file) return null;
        const isVideo = file.type.startsWith("video/");
        const { base64: dataBase64, mimeType, fileName } = isVideo
          ? { base64: await fileToBase64(file), mimeType: file.type, fileName: file.name }
          : await normalizeImageToJpeg(file);
        return { attachName: p.attachName, dataBase64, mimeType, fileName };
      })
    );

    return publishRichPost({
      botId: activeBot!,
      channelIds: selectedChannelIds,
      blocksJson: html,
      photos: filledPhotos.filter((p): p is NonNullable<typeof p> => p !== null),
      draftId: draftId ?? null,
    });
  }

  // ── Telegraph publish ───────────────────────────────────────────────────────

  async function publishViaTelegraph(): Promise<PublishResult[]> {
    const { nodes, fileIds } = tiptapToTelegraphNodes(
      contentJson || '{"type":"doc","content":[]}',
      effectiveTitle
    );

    const images = await Promise.all(
      fileIds.map(async (fileId) => {
        const file = fileRegistry.getFile(fileId);
        if (!file) return null;
        const { base64: dataBase64, mimeType, fileName } = await normalizeImageToJpeg(file);
        return { fileId, dataBase64, mimeType, fileName };
      })
    );

    const tgResult = await telegraphPublish({
      title: effectiveTitle.trim() || t("publish.defaultTitle"),
      nodesJson: JSON.stringify(nodes),
      images: images.filter((i): i is NonNullable<typeof i> => i !== null),
    });

    setTelegraphUrl(tgResult.url);

    const allResults: PublishResult[] = [];
    for (const channelId of selectedChannelIds) {
      const channel = channels.find((c) => c.id === channelId);
      try {
        const res = await publishPost({
          botId: activeBot!,
          channelIds: [channelId],
          contentHtml: tgResult.url,
          media: [],
          buttons: [],
          draftId: draftId ?? null,
          scheduleAt: null,
        });
        allResults.push({
          channelId,
          channelTitle: channel?.title ?? channelId,
          success: res[0]?.success ?? false,
          telegramMsgId: res[0]?.telegramMsgId ?? null,
          errorMessage: res[0]?.errorMessage ?? null,
        });
      } catch (e) {
        allResults.push({
          channelId,
          channelTitle: channel?.title ?? channelId,
          success: false,
          telegramMsgId: null,
          errorMessage: String(e),
        });
      }
    }

    return allResults;
  }

  // ── Edit published post handler ──────────────────────────────────────────────

  const [updating, setUpdating] = useState(false);

  async function handleUpdate() {
    if (!editingHistoryId || !contentJson) return;
    setUpdating(true);
    try {
      // Build the same HTML that would be published in "normal" mode
      const segs = segmentDocument(contentJson, effectiveTitle);
      const textHtml = segs
        .filter((s) => s.type === "text")
        .map((s) => (s as { type: "text"; html: string }).html)
        .join("\n\n");

      await editPublishedPost(editingHistoryId, textHtml);
      toast.success("Публикация обновлена в Telegram");
      setEditingHistoryId(null);
    } catch (e) {
      toast.error("Ошибка обновления: " + String(e));
    } finally {
      setUpdating(false);
    }
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handlePublish() {
    if (!canPublish) return;
    reset();
    setTelegraphUrl(null);
    setStatus("publishing");
    try {
      let res: PublishResult[];
      if (publishMode === "rich") res = await publishViaRichMessage();
      else if (publishMode === "telegraph") res = await publishViaTelegraph();
      else res = await publishAllSegments();
      setResults(res);
      setStatus("done");
      if (res.some((r) => r.success)) clearAttachments();
    } catch (e) {
      const msg = String(e);
      setError(msg);
      setStatus("error");
      toast.error(msg);
    }
  }

  async function handleSchedule(isoDate: string) {
    if (!canPublish) return;
    setShowSchedule(false);
    reset();
    setStatus("scheduling");
    const textHtml = segments
      .filter((s) => s.type === "text")
      .map((s) => (s as any).html)
      .join("\n\n")
      .trim();
    try {
      await schedulePost({
        botId: activeBot!,
        channelIds: selectedChannelIds,
        contentHtml: textHtml || "—",
        media: [],
        buttons: [],
        draftId: draftId ?? null,
        scheduleAt: isoDate,
      });
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  const normalHint = segments.length > 1
    ? ti("publish.normal.hintN", { n: segments.length })
    : t("publish.normal.hint1");

  return (
    <>
      <div className="flex flex-col gap-3 px-4 pt-4 pb-4">
        <p className="text-2xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          {t("publish.section")}
        </p>

        {/* Bot selector */}
        <div>
          <p className="text-2xs mb-1" style={{ color: "var(--text-muted)" }}>{t("publish.bot")}</p>
          <div className="relative">
            <select
              className="appearance-none w-full h-7 rounded-md border pl-3 pr-7 text-xs focus:outline-none cursor-pointer"
              style={{ backgroundColor: "var(--bg-input)", borderColor: "var(--border-default)", color: activeBot ? "var(--text-primary)" : "var(--text-muted)" }}
              value={activeBot ?? ""}
              onChange={(e) => { setActiveBot(e.target.value || null); setChannels([]); }}
            >
              <option value="">{t("publish.selectBot")}</option>
              {bots.map((b) => <option key={b.id} value={b.id}>@{b.username}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
          </div>
        </div>

        {/* Channel list */}
        <div>
          <p className="text-2xs mb-1.5" style={{ color: "var(--text-muted)" }}>{t("publish.channels")}</p>
          {botChannels.length === 0 ? (
            <p className="text-2xs italic" style={{ color: "var(--text-muted)" }}>
              {activeBot ? t("publish.noChannels") : t("publish.selectBotFirst")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {botChannels.map((ch) => {
                const checked = selectedChannelIds.includes(ch.id);
                return (
                  <label
                    key={ch.id}
                    className="flex items-center gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 transition-colors"
                    style={{
                      backgroundColor: checked ? "rgba(42,171,238,0.10)" : "var(--bg-elevated)",
                      border: `1.5px solid ${checked ? "var(--accent)" : "var(--border-default)"}`,
                      transition: "background-color 0.13s, border-color 0.13s",
                    }}
                  >
                    {/* Custom checkbox */}
                    <input type="checkbox" checked={checked} onChange={() => toggleChannel(ch.id)} className="sr-only" />
                    <span
                      style={{
                        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        backgroundColor: checked ? "var(--accent)" : "transparent",
                        border: `2px solid ${checked ? "var(--accent)" : "var(--border-default)"}`,
                        transition: "all 0.13s",
                      }}
                    >
                      {checked && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                    <span className="text-xs font-medium truncate" style={{ color: checked ? "var(--text-primary)" : "var(--text-secondary)" }}>{ch.title}</span>
                    {ch.username && <span className="text-2xs ml-auto flex-shrink-0" style={{ color: "var(--text-muted)" }}>@{ch.username}</span>}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Publish mode selector */}
        <div>
          <p className="text-2xs mb-1.5" style={{ color: "var(--text-muted)" }}>{t("publish.format")}</p>
          <div className="flex flex-col gap-1">
            {([
              { id: "normal",    icon: <Send size={11}/>,     label: t("publish.normal"),     hint: normalHint },
              { id: "rich",      icon: <Layers size={11}/>,   label: t("publish.rich"),        hint: t("publish.rich.hint") },
              { id: "telegraph", icon: <FileText size={11}/>, label: t("publish.telegraph"),   hint: t("publish.telegraph.hint") },
            ] as const).map(({ id, icon, label, hint }) => (
              <label
                key={id}
                className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 transition-colors"
                style={{
                  backgroundColor: publishMode === id ? "rgba(42,171,238,0.08)" : "transparent",
                  border: `1px solid ${publishMode === id ? "rgba(42,171,238,0.3)" : "var(--border-default)"}`,
                  borderRadius: 6,
                }}
              >
                <input
                  type="radio"
                  name="publishMode"
                  value={id}
                  checked={publishMode === id}
                  onChange={() => setPublishMode(id)}
                  className="accent-blue-500 w-3 h-3 flex-shrink-0"
                />
                <span style={{ color: publishMode === id ? "var(--accent)" : "var(--text-muted)", flexShrink: 0 }}>{icon}</span>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium leading-tight" style={{ color: publishMode === id ? "var(--accent)" : "var(--text-primary)" }}>{label}</span>
                  <span className="text-2xs leading-tight" style={{ color: "var(--text-muted)" }}>{hint}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Telegraph URL after publish */}
        {telegraphUrl && (
          <a
            href={telegraphUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-2xs px-2 py-1.5 rounded-md"
            style={{ color: "var(--accent)", backgroundColor: "rgba(42,171,238,0.08)", textDecoration: "none" }}
          >
            <ExternalLink size={10} />
            <span className="truncate">{telegraphUrl}</span>
          </a>
        )}

        {/* Results */}
        {(status === "done" || status === "error") && (
          <div className="flex flex-col gap-1">
            {status === "error" && lastError && (
              <div className="text-2xs flex items-center gap-1 px-2 py-1 rounded" style={{ color: "var(--danger)", backgroundColor: "rgba(239,68,68,0.1)" }}>
                <AlertCircle size={11} />{lastError}
              </div>
            )}
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5 text-2xs px-2 py-0.5" style={{ color: r.success ? "var(--success)" : "var(--danger)" }}>
                {r.success ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                <span className="truncate">{r.channelTitle}</span>
                {!r.success && r.errorMessage && (
                  <span className="truncate ml-auto" style={{ color: "var(--text-muted)" }} title={r.errorMessage ?? ""}>
                    {(r.errorMessage ?? "").slice(0, 30)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* File warning in Rich mode */}
        {fileBlockedInRich && (
          <div
            className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
            style={{
              backgroundColor: "rgba(251,191,36,0.1)",
              border: "1px solid rgba(251,191,36,0.3)",
              color: "var(--text-secondary)",
            }}
          >
            <AlertCircle size={13} style={{ color: "#fbbf24", flexShrink: 0, marginTop: 1 }} />
            <span>
              {t("publish.fileInRich")}&nbsp;
              <button
                style={{ color: "var(--accent)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
                onClick={() => setPublishMode("normal")}
              >
                {t("publish.fileInRichLink")}
              </button>
              .
            </span>
          </div>
        )}

        {/* Edit mode banner */}
        {editingHistoryId && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 10px", borderRadius: 8, marginBottom: 6,
            backgroundColor: "rgba(42,171,238,0.10)",
            border: "1px solid rgba(42,171,238,0.25)",
          }}>
            <Pencil size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>Режим редактирования</p>
              <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>Изменения отправятся в Telegram</p>
            </div>
            <button
              onClick={() => setEditingHistoryId(null)}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}
              title="Выйти из режима редактирования"
            >
              ✕
            </button>
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col gap-2 mt-1">
          {editingHistoryId ? (
            <Button
              variant="primary" size="sm" fullWidth
              disabled={updating || !contentJson}
              leftIcon={updating ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              onClick={handleUpdate}
            >
              {updating ? "Обновляется…" : "Обновить в Telegram"}
            </Button>
          ) : (
            <>
              <Button variant="primary" size="sm" fullWidth disabled={!canPublish}
                leftIcon={status === "publishing" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                onClick={handlePublish}
              >
                {status === "publishing"
                  ? (publishMode === "telegraph" ? t("publish.publishingTelegraph") : t("publish.publishing"))
                  : t("publish.button")}
              </Button>

              <Button variant="ghost" size="sm" fullWidth disabled={!canPublish}
                leftIcon={status === "scheduling" ? <Loader2 size={13} className="animate-spin" /> : <Clock size={13} />}
                onClick={() => setShowSchedule(true)}
              >
                {status === "scheduling" ? t("publish.scheduling") : t("publish.schedule")}
              </Button>
            </>
          )}
        </div>
      </div>

      {showSchedule && <ScheduleDialog onConfirm={handleSchedule} onClose={() => setShowSchedule(false)} />}
    </>
  );
}

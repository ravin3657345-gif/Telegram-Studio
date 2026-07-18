import { useEffect, useState } from "react";
import { Send, Clock, CheckCircle2, AlertCircle, Loader2, Layers, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SplitButton } from "@/components/ui/SplitButton";
import { ScheduleDialog } from "@/components/editor/ScheduleDialog";
import { PublishConfirmDialog } from "@/components/editor/PublishConfirmDialog";
import { useChannelsStore } from "@/store/channelsStore";
import { usePublishStore } from "@/store/publishStore";
import { useEditorStore } from "@/store/editorStore";
import { publishPost, schedulePost, publishRichPost, republishRichPost, scheduleRichPost, sendPoll, editPublishedPost, upsertDraft, updateScheduledPostContent } from "@/lib/tauriApi";
import { segmentDocument, splitIntoMessagesAtGaps, splitJsonAtGaps } from "@/lib/htmlConverter";
import { TELEGRAM_MAX_RICH_BLOCKS } from "@/lib/constants";
import type { TextSegment, PollSegment } from "@/lib/htmlConverter";
import { tiptapToRichHtml } from "@/lib/richMessageConverter";
import { fileRegistry } from "@/lib/fileRegistry";
import { collectInlineAttachments } from "@/lib/attachmentRestore";
import { useAttachmentStore } from "@/store/attachmentStore";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { toast, useUiStore } from "@/store/uiStore";
import { fileToBase64, normalizeImageToJpeg } from "@/lib/imageProcessing";
import type { PublishResult } from "@/types/publish";

// ─── Component ─────────────────────────────────────────────────────────────────

interface PublishPanelProps { draftId?: string }

export function PublishPanel({ draftId }: PublishPanelProps) {
  const { bots, channels } = useChannelsStore();
  const { selectedChannelIds, status, results, lastError,
          toggleChannel, setStatus, setResults, setError, reset } = usePublishStore();
  const { contentJson, postTitle, includeTitle, publishMode, setPublishMode, editingHistoryId, setEditingHistoryId, draftTitle, setDraftId, draftStatus, lastSavedAt } = useEditorStore();
  useSettingsStore((s) => s.language);
  const bumpHistory      = useUiStore((s) => s.bumpHistory);
  const attachedFiles    = useAttachmentStore((s) => s.files);
  const clearAttachments = useAttachmentStore((s) => s.clearAll);

  const [showSchedule, setShowSchedule] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);

  const splitGaps      = useEditorStore((s) => s.splitGaps);
  const effectiveTitle = includeTitle ? postTitle : "";
  const messages = splitIntoMessagesAtGaps(
    contentJson || '{"type":"doc","content":[]}',
    splitGaps,
    effectiveTitle,
  );
  const segments = messages.flat();
  const hasAttachments = attachedFiles.length > 0;
  // Tables are Rich Messages only (Bot API 10.1's RichBlockTable) — normal
  // HTML has no table concept at all, and the segments above (built from
  // the normal-mode converter) never see one, so a Rich post consisting of
  // nothing but a table would otherwise register as "no content" and get
  // its publish button disabled outright.
  const hasTable = (contentJson ?? "").includes('"type":"blockTable"');
  // Same reasoning as hasTable — audio is also Rich-only (Bot API 10.1's
  // <audio> tag), invisible to the normal-mode segments below.
  const hasAudio = (contentJson ?? "").includes('"type":"blockAudio"');
  // Same reasoning as hasTable/hasAudio — maps and formulas are also
  // Rich-only (Bot API 10.1's <tg-map>/<tg-math-block>), invisible to the
  // normal-mode segments below.
  const hasMap = (contentJson ?? "").includes('"type":"blockMap"');
  const hasFormula = (contentJson ?? "").includes('"type":"blockFormula"');
  // Bot API 10.1 caps a single Rich Message at 500 top-level blocks
  // (separate from the 32,768-char length cap) — checked per split chunk
  // via the same splitJsonAtGaps used by the real publish call, since each
  // chunk becomes its own independent sendRichMessage.
  const richBlockLimitExceeded = publishMode === "rich" && splitJsonAtGaps(
    contentJson || '{"type":"doc","content":[]}',
    splitGaps,
  ).some((chunk) => {
    try { return (JSON.parse(chunk).content ?? []).length > TELEGRAM_MAX_RICH_BLOCKS; }
    catch { return false; }
  });
  const hasContent = hasAttachments || (publishMode === "rich" && (hasTable || hasAudio || hasMap || hasFormula)) || segments.some(
    (s) =>
      (s.type === "text" && s.html.trim()) ||
      s.type === "image" ||
      s.type === "video" ||
      s.type === "file" ||
      (s.type === "poll" && s.question.trim().length > 0 && s.options.filter((o) => o.trim()).length >= 2)
  );
  const hasFiles = hasAttachments || segments.some((s) => s.type === "file");
  const fileBlockedInRich = publishMode === "rich" && hasFiles;
  const tableBlockedOutsideRich = publishMode !== "rich" && hasTable;
  const audioBlockedOutsideRich = publishMode !== "rich" && hasAudio;
  const mapBlockedOutsideRich = publishMode !== "rich" && hasMap;
  const formulaBlockedOutsideRich = publishMode !== "rich" && hasFormula;
  // Scheduled posts support text + images/video/files (scheduler persists media
  // to disk and sends it via the same photo/video/document logic as immediate
  // publish). Polls are the one segment type with no scheduled-send path yet —
  // sendPoll is a separate Telegram API call the scheduler doesn't make.
  const hasPollSegment = segments.some((s) => s.type === "poll");
  const mediaBlockedInSchedule = hasPollSegment;
  const hasBots = bots.length > 0;

  const canPublish =
    hasBots && selectedChannelIds.length > 0 && hasContent &&
    !fileBlockedInRich &&
    !tableBlockedOutsideRich && !audioBlockedOutsideRich &&
    !mapBlockedOutsideRich && !formulaBlockedOutsideRich && !richBlockLimitExceeded &&
    status !== "publishing" && status !== "scheduling";

  const canSchedule = canPublish && !mediaBlockedInSchedule;

  // Keeps an already-scheduled post's queued content in sync with the draft.
  // scheduled_posts.content_html is a one-time snapshot taken when the post
  // was first scheduled — editing the draft afterwards never touched it, so
  // fire a best-effort resync after every autosave completes (only for
  // normal-mode drafts — editing an already-scheduled Rich draft is blocked
  // entirely, see EditorPage.tsx's isRichScheduledLocked; the only supported
  // Rich flow is "compose fresh, then publish or schedule once").
  useEffect(() => {
    if (!draftId || draftStatus !== "scheduled" || publishMode === "rich" || !lastSavedAt) return;

    (async () => {
      try {
        const textHtml = segments
          .filter((s): s is TextSegment => s.type === "text")
          .map((s) => s.html)
          .join("\n\n")
          .trim();

        type Encoded = { fileName: string; mimeType: string; mediaType: string; dataBase64: string };
        const encoded: Encoded[] = [];
        for (const seg of segments) {
          if (seg.type !== "image" && seg.type !== "video" && seg.type !== "file") continue;
          const file = fileRegistry.getFile(seg.fileId);
          if (!file) continue;
          const { base64: dataBase64, mimeType, fileName } = seg.type === "image"
            ? await normalizeImageToJpeg(file)
            : { base64: await fileToBase64(file), mimeType: seg.mimeType, fileName: seg.fileName };
          encoded.push({ fileName, mimeType, mediaType: seg.type, dataBase64 });
        }
        const freshAttachments = useAttachmentStore.getState().files;
        for (const att of freshAttachments) {
          const file = fileRegistry.getFile(att.id);
          if (!file) continue;
          encoded.push({ fileName: att.name, mimeType: att.mimeType, mediaType: "file", dataBase64: await fileToBase64(file) });
        }

        await updateScheduledPostContent({
          draftId,
          contentHtml: textHtml || "—",
          media: encoded,
        });
      } catch {
        // Best-effort — the autosave itself already succeeded, the next edit
        // will retry the resync.
      }
    })();
    // Only re-run when a fresh autosave actually completed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSavedAt]);

  // ── Normal / Caption publish ─────────────────────────────────────────────────

  async function publishAllSegments(): Promise<PublishResult[]> {
    const allResults: PublishResult[] = [];
    const polls = segments.filter((s): s is PollSegment => s.type === "poll");

    // Pre-encode ALL media blocks once (keyed by fileId) — avoids re-encoding per channel
    type Encoded = { fileName: string; mimeType: string; mediaType: string; dataBase64: string };
    const encodedByFileId = new Map<string, Encoded>();
    for (const seg of segments) {
      if (seg.type !== "image" && seg.type !== "video" && seg.type !== "file") continue;
      if (encodedByFileId.has(seg.fileId)) continue;
      const file = fileRegistry.getFile(seg.fileId);
      if (!file) continue;
      const { base64: dataBase64, mimeType, fileName } = seg.type === "image"
        ? await normalizeImageToJpeg(file)
        : { base64: await fileToBase64(file), mimeType: seg.mimeType, fileName: seg.fileName };
      encodedByFileId.set(seg.fileId, { fileName, mimeType, mediaType: seg.type, dataBase64 });
    }

    // Fresh attachments always go with the FIRST message (not in the TipTap doc)
    const freshAttachments = useAttachmentStore.getState().files;
    const freshEncoded: Encoded[] = [];
    for (const att of freshAttachments) {
      const file = fileRegistry.getFile(att.id);
      if (!file) throw new Error(ti("attach.fileGone", { name: att.name }));
      freshEncoded.push({ fileName: att.name, mimeType: att.mimeType, mediaType: "file", dataBase64: await fileToBase64(file) });
    }

    for (const channelId of selectedChannelIds) {
      const channel = channels.find((c) => c.id === channelId);
      let success = true;
      let lastMsgId: number | null = null;
      let errorMsg: string | null = null;

      try {
        // Send each message group separately (1 group = 1 Telegram message)
        for (let mi = 0; mi < messages.length; mi++) {
          const msgSegs = messages[mi];

          const msgHtml = msgSegs
            .filter((s): s is TextSegment => s.type === "text")
            .map((s) => s.html.trim())
            .filter(Boolean)
            .join("\n\n");

          // Collect media for this message: fresh attachments (first msg only) + inline blocks
          const msgMedia: Encoded[] = [];
          if (mi === 0) msgMedia.push(...freshEncoded);
          for (const seg of msgSegs) {
            if (seg.type === "image" || seg.type === "video" || seg.type === "file") {
              const enc = encodedByFileId.get(seg.fileId);
              if (enc) msgMedia.push(enc);
            }
          }

          if (!msgHtml && msgMedia.length === 0) continue;

          const res = await publishPost({
            botId: null,
            channelIds: [channelId],
            contentHtml: msgHtml,
            media: msgMedia,
            buttons: [],
            draftId: mi === 0 ? (draftId ?? null) : null,
            scheduleAt: null,
          });
          if (res[0]?.success) lastMsgId = res[0].telegramMsgId ?? null;
          else { success = false; errorMsg = res[0]?.errorMessage ?? t("common.error"); break; }
        }

        if (success) {
          for (const seg of polls) {
            const validOpts = seg.options.filter((o) => o.trim().length > 0);
            if (!seg.question.trim() || validOpts.length < 2) continue;
            const res = await sendPoll({
              botId: null,
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
    const jsonChunks = splitJsonAtGaps(contentJson || '{"type":"doc","content":[]}', splitGaps);

    const allResults: PublishResult[] = [];

    for (let ci = 0; ci < jsonChunks.length; ci++) {
      // First chunk gets the title, subsequent chunks don't
      const chunkTitle = ci === 0 ? effectiveTitle : "";
      const { html, photos } = tiptapToRichHtml(jsonChunks[ci], chunkTitle);

      const filledPhotos = await Promise.all(
        photos.map(async (p) => {
          const file = fileRegistry.getFile(p.fileId);
          if (!file) return null;
          const isVideo = file.type.startsWith("video/");
          const isAudio = file.type.startsWith("audio/");
          const { base64: dataBase64, mimeType, fileName } = isVideo || isAudio
            ? { base64: await fileToBase64(file), mimeType: file.type, fileName: file.name }
            : await normalizeImageToJpeg(file);
          return { attachName: p.attachName, dataBase64, mimeType, fileName };
        })
      );

      const res = await publishRichPost({
        botId: null,
        channelIds: selectedChannelIds,
        richHtml: html,
        photos: filledPhotos.filter((p): p is NonNullable<typeof p> => p !== null),
        draftId: ci === 0 ? (draftId ?? null) : null,
      });

      // Merge results (same channels, may be called multiple times)
      for (const r of res) {
        const existing = allResults.find((x) => x.channelId === r.channelId);
        if (!existing) {
          allResults.push(r);
        } else if (!r.success) {
          // First failure wins
          existing.success = false;
          existing.errorMessage = r.errorMessage;
        } else {
          existing.telegramMsgId = r.telegramMsgId;
        }
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
      if (publishMode === "rich") {
        // Rich messages can't be edited in Telegram — delete old, send new
        const { html, photos } = tiptapToRichHtml(
          contentJson,
          effectiveTitle
        );
        const filledPhotos = await Promise.all(
          photos.map(async (p) => {
            const file = fileRegistry.getFile(p.fileId);
            if (!file) return null;
            const isVideo = file.type.startsWith("video/");
            const isAudio = file.type.startsWith("audio/");
            const { base64: dataBase64, mimeType, fileName } = isVideo || isAudio
              ? { base64: await fileToBase64(file), mimeType: file.type, fileName: file.name }
              : await normalizeImageToJpeg(file);
            return { attachName: p.attachName, dataBase64, mimeType, fileName };
          })
        );
        await republishRichPost(
          editingHistoryId,
          html,
          filledPhotos.filter((p): p is NonNullable<typeof p> => p !== null),
          contentJson ?? undefined,
        );
      } else {
        const segs = segmentDocument(contentJson, effectiveTitle);
        const textHtml = segs
          .filter((s) => s.type === "text")
          .map((s) => (s as { type: "text"; html: string }).html)
          .join("\n\n");
        await editPublishedPost(editingHistoryId, textHtml, contentJson ?? undefined);
      }
      bumpHistory();
      toast.success(t("publish.updated"));
      setEditingHistoryId(null);
    } catch (e) {
      toast.error(t("publish.updateError") + ": " + String(e));
    } finally {
      setUpdating(false);
    }
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handlePublish() {
    if (!canPublish) return;
    reset();
    setStatus("publishing");
    try {
      let res: PublishResult[];
      if (publishMode === "rich") res = await publishViaRichMessage();
      else res = await publishAllSegments();
      setResults(res);
      setStatus("done");
      if (res.some((r) => r.success)) {
        clearAttachments();
        const successChannels = res.filter((r) => r.success).map((r) => r.channelTitle).join(", ");
        toast.success(t("publish.published"), successChannels);
      }
    } catch (e) {
      const msg = String(e);
      setError(msg);
      setStatus("error");
      toast.error(msg);
    }
  }

  async function handleSchedule(isoDate: string) {
    if (!canSchedule) return;
    setShowSchedule(false);
    reset();
    setStatus("scheduling");
    const textHtml = segments
      .filter((s) => s.type === "text")
      .map((s) => (s as any).html)
      .join("\n\n")
      .trim();
    try {
      // A scheduled post with no draftId has nowhere to live once it's fired
      // or cancelled — it never shows up in Drafts (which only lists rows
      // from the drafts table) and reopening it from the calendar has no
      // content to load. Autosave normally creates the draft, but it's
      // debounced, so scheduling right after typing (or with autosave
      // disabled) can beat it to the punch. Make sure one exists here too.
      let effectiveDraftId = draftId;
      if (!effectiveDraftId) {
        const attachments = await collectInlineAttachments(contentJson || "{}");
        const draft = await upsertDraft({
          title: draftTitle,
          postTitle,
          contentJson: contentJson || "{}",
          attachments: attachments.length ? attachments : undefined,
        });
        effectiveDraftId = draft.id;
        setDraftId(draft.id);
      }

      // Encode inline (image/video/file) segments — same encoding used for
      // immediate publish — plus any fresh bottom-panel attachments. The
      // scheduler persists these to disk and sends them at fire time.
      type Encoded = { fileName: string; mimeType: string; mediaType: string; dataBase64: string };
      const encoded: Encoded[] = [];
      for (const seg of segments) {
        if (seg.type !== "image" && seg.type !== "video" && seg.type !== "file") continue;
        const file = fileRegistry.getFile(seg.fileId);
        if (!file) continue;
        const { base64: dataBase64, mimeType, fileName } = seg.type === "image"
          ? await normalizeImageToJpeg(file)
          : { base64: await fileToBase64(file), mimeType: seg.mimeType, fileName: seg.fileName };
        encoded.push({ fileName, mimeType, mediaType: seg.type, dataBase64 });
      }
      const freshAttachments = useAttachmentStore.getState().files;
      for (const att of freshAttachments) {
        const file = fileRegistry.getFile(att.id);
        if (!file) throw new Error(ti("attach.fileGone", { name: att.name }));
        encoded.push({ fileName: att.name, mimeType: att.mimeType, mediaType: "file", dataBase64: await fileToBase64(file) });
      }

      await schedulePost({
        botId: bots[0]?.id ?? null,
        channelIds: selectedChannelIds,
        contentHtml: textHtml || "—",
        media: encoded,
        buttons: [],
        draftId: effectiveDraftId,
        scheduleAt: isoDate,
      });
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  // ── Rich message schedule ────────────────────────────────────────────────────
  // Mirrors handleSchedule above, but builds the snapshot via tiptapToRichHtml
  // (single-shot — no jsonChunks loop, see the resync effect's comment for why)
  // and calls scheduleRichPost instead.
  async function handleScheduleRich(isoDate: string) {
    if (!canSchedule) return;
    setShowSchedule(false);
    reset();
    setStatus("scheduling");
    try {
      let effectiveDraftId = draftId;
      if (!effectiveDraftId) {
        const attachments = await collectInlineAttachments(contentJson || "{}");
        const draft = await upsertDraft({
          title: draftTitle,
          postTitle,
          contentJson: contentJson || "{}",
          attachments: attachments.length ? attachments : undefined,
        });
        effectiveDraftId = draft.id;
        setDraftId(draft.id);
      }

      const { html, photos } = tiptapToRichHtml(contentJson || '{"type":"doc","content":[]}', effectiveTitle);
      const filledPhotos = await Promise.all(
        photos.map(async (p) => {
          const file = fileRegistry.getFile(p.fileId);
          if (!file) return null;
          const isVideo = file.type.startsWith("video/");
          const isAudio = file.type.startsWith("audio/");
          const { base64: dataBase64, mimeType, fileName } = isVideo || isAudio
            ? { base64: await fileToBase64(file), mimeType: file.type, fileName: file.name }
            : await normalizeImageToJpeg(file);
          return { attachName: p.attachName, dataBase64, mimeType, fileName };
        })
      );

      await scheduleRichPost({
        botId: bots[0]?.id ?? null,
        channelIds: selectedChannelIds,
        richHtml: html,
        photos: filledPhotos.filter((p): p is NonNullable<typeof p> => p !== null),
        draftId: effectiveDraftId,
        scheduleAt: isoDate,
      });
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }

  async function handleScheduleDispatch(isoDate: string) {
    if (publishMode === "rich") await handleScheduleRich(isoDate);
    else await handleSchedule(isoDate);
  }

  const normalHint = segments.length > 1
    ? ti("publish.normal.hintN", { n: segments.length })
    : t("publish.normal.hint1");

  return (
    <>
      <div className="flex flex-col" style={{ flex: "1 1 auto", minHeight: 0 }}>
      <div className="flex flex-col gap-3 px-4 pt-4 pb-3 flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        <p className="text-2xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          {t("publish.section")}
        </p>

        {/* No bots warning */}
        {!hasBots && (
          <p className="text-2xs italic px-1" style={{ color: "var(--text-muted)" }}>
            {t("publish.addBotHint")}
          </p>
        )}

        {/* Channel list */}
        <div>
          <p className="text-2xs mb-1.5" style={{ color: "var(--text-muted)" }}>{t("publish.channels")}</p>
          {channels.length === 0 ? (
            <p className="text-2xs italic" style={{ color: "var(--text-muted)" }}>
              {t("publish.noChannels")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {channels.map((ch) => {
                const checked = selectedChannelIds.includes(ch.id);
                return (
                  <label
                    key={ch.id}
                    className="publish-channel-row flex items-center gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 transition-colors"
                    style={{
                      backgroundColor: checked ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "var(--bg-elevated)",
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

        {/* Publish mode selector — hidden when editing a published post (mode is locked) */}
        {!editingHistoryId ? (
          <div data-tour="format-switcher">
            <p className="text-2xs mb-1.5" style={{ color: "var(--text-muted)" }}>{t("publish.format")}</p>
            <div className="flex flex-col gap-1">
              {([
                { id: "normal", icon: <Send size={11}/>,   label: t("publish.normal"), hint: normalHint },
                { id: "rich",   icon: <Layers size={11}/>, label: t("publish.rich"),   hint: t("publish.rich.hint") },
              ] as const).map(({ id, icon, label, hint }) => (
                <label
                  key={id}
                  title={hint}
                  className="publish-format-row flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 transition-colors"
                  style={{
                    backgroundColor: publishMode === id ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
                    border: `1px solid ${publishMode === id ? "color-mix(in srgb, var(--accent) 30%, transparent)" : "var(--border-default)"}`,
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
                  <span className="text-xs font-medium leading-tight min-w-0" style={{ color: publishMode === id ? "var(--accent)" : "var(--text-primary)" }}>{label}</span>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md" style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)" }}>
            {publishMode === "rich" ? <Layers size={11} style={{ color: "var(--accent)" }}/> : <Send size={11} style={{ color: "var(--accent)" }}/>}
            <span className="text-xs" style={{ color: "var(--accent)" }}>
              {publishMode === "rich" ? t("publish.rich") : t("publish.normal")}
            </span>
            <span className="text-2xs" style={{ color: "var(--text-muted)" }}>— {t("publish.modeLocked")}</span>
          </div>
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
              <div key={i} className="flex flex-col gap-0.5 px-2 py-0.5">
                <div className="flex items-center gap-1.5 text-2xs" style={{ color: r.success ? "var(--success)" : "var(--danger)" }}>
                  {r.success ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                  <span className="truncate">{r.channelTitle}</span>
                  {r.success && r.botUsername && (
                    <span className="ml-auto flex-shrink-0 text-2xs" style={{ color: "var(--text-muted)" }}>@{r.botUsername}</span>
                  )}
                </div>
                {!r.success && r.errorMessage && (
                  <span className="text-2xs pl-4 truncate" style={{ color: "var(--text-muted)" }} title={r.errorMessage ?? ""}>
                    {(r.errorMessage ?? "").slice(0, 60)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* File warning in Rich mode */}
        {fileBlockedInRich && (
          <div
            className="publish-warning-box flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
            style={{
              backgroundColor: "var(--warning-subtle)",
              border: "1px solid color-mix(in srgb, var(--warning) 30%, transparent)",
              color: "var(--text-secondary)",
            }}
          >
            <AlertCircle size={13} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 1 }} />
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

        {/* Rich block-count warning — Telegram caps a single Rich Message at 500 blocks */}
        {richBlockLimitExceeded && (
          <div
            className="publish-warning-box flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
            style={{
              backgroundColor: "var(--warning-subtle)",
              border: "1px solid color-mix(in srgb, var(--warning) 30%, transparent)",
              color: "var(--text-secondary)",
            }}
          >
            <AlertCircle size={13} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 1 }} />
            <span>{ti("publish.tooManyRichBlocks", { n: TELEGRAM_MAX_RICH_BLOCKS })}</span>
          </div>
        )}

        {/* Table warning outside Rich mode — tables only exist in Rich Messages */}
        {tableBlockedOutsideRich && (
          <div
            className="publish-warning-box flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
            style={{
              backgroundColor: "var(--warning-subtle)",
              border: "1px solid color-mix(in srgb, var(--warning) 30%, transparent)",
              color: "var(--text-secondary)",
            }}
          >
            <AlertCircle size={13} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 1 }} />
            <span>
              {t("publish.tableOutsideRich")}&nbsp;
              <button
                style={{ color: "var(--accent)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
                onClick={() => setPublishMode("rich")}
              >
                {t("publish.tableOutsideRichLink")}
              </button>
              .
            </span>
          </div>
        )}

        {/* Audio warning outside Rich mode — audio only exists in Rich Messages */}
        {audioBlockedOutsideRich && (
          <div
            className="publish-warning-box flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
            style={{
              backgroundColor: "var(--warning-subtle)",
              border: "1px solid color-mix(in srgb, var(--warning) 30%, transparent)",
              color: "var(--text-secondary)",
            }}
          >
            <AlertCircle size={13} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 1 }} />
            <span>
              {t("publish.audioOutsideRich")}&nbsp;
              <button
                style={{ color: "var(--accent)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
                onClick={() => setPublishMode("rich")}
              >
                {t("publish.audioOutsideRichLink")}
              </button>
              .
            </span>
          </div>
        )}

        {/* Map warning outside Rich mode — maps only exist in Rich Messages */}
        {mapBlockedOutsideRich && (
          <div
            className="publish-warning-box flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
            style={{
              backgroundColor: "var(--warning-subtle)",
              border: "1px solid color-mix(in srgb, var(--warning) 30%, transparent)",
              color: "var(--text-secondary)",
            }}
          >
            <AlertCircle size={13} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 1 }} />
            <span>
              {t("publish.mapOutsideRich")}&nbsp;
              <button
                style={{ color: "var(--accent)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
                onClick={() => setPublishMode("rich")}
              >
                {t("publish.mapOutsideRichLink")}
              </button>
              .
            </span>
          </div>
        )}

        {/* Formula warning outside Rich mode — formulas only exist in Rich Messages */}
        {formulaBlockedOutsideRich && (
          <div
            className="publish-warning-box flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
            style={{
              backgroundColor: "var(--warning-subtle)",
              border: "1px solid color-mix(in srgb, var(--warning) 30%, transparent)",
              color: "var(--text-secondary)",
            }}
          >
            <AlertCircle size={13} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 1 }} />
            <span>
              {t("publish.formulaOutsideRich")}&nbsp;
              <button
                style={{ color: "var(--accent)", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0, font: "inherit" }}
                onClick={() => setPublishMode("rich")}
              >
                {t("publish.formulaOutsideRichLink")}
              </button>
              .
            </span>
          </div>
        )}

        {/* Media/poll warning for scheduled posts — scheduler only carries text */}
        {mediaBlockedInSchedule && !fileBlockedInRich && (
          <div
            className="publish-warning-box flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
            style={{
              backgroundColor: "var(--warning-subtle)",
              border: "1px solid color-mix(in srgb, var(--warning) 30%, transparent)",
              color: "var(--text-secondary)",
            }}
          >
            <AlertCircle size={13} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 1 }} />
            <span>{t("publish.mediaInSchedule")}</span>
          </div>
        )}

        {/* Edit mode banner */}
        {editingHistoryId && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 10px", borderRadius: 8, marginBottom: 6,
            backgroundColor: "color-mix(in srgb, var(--accent) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
          }}>
            <Pencil size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>{t("publish.editMode")}</p>
              <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{t("publish.editModeHint")}</p>
            </div>
            <button
              onClick={() => setEditingHistoryId(null)}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}
              title={t("publish.exitEditMode")}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Buttons — pinned footer, always visible regardless of how tall the
          scrollable content above is (channel list, warnings, etc.) */}
      <div
        className="flex flex-col gap-2 px-4 pt-3 pb-4 flex-shrink-0"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        {editingHistoryId ? (
          <Button
            variant="primary" size="sm" fullWidth
            disabled={updating || !contentJson}
            leftIcon={updating ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            onClick={handleUpdate}
          >
            {updating ? t("publish.updating") : t("publish.updateTelegram")}
          </Button>
        ) : (
          <SplitButton
            primary={{
              label: status === "publishing" ? t("publish.publishing") : t("publish.button"),
              icon: <Send size={13} />,
              onClick: () => setShowPublishConfirm(true),
              disabled: !canPublish,
              loading: status === "publishing",
            }}
            secondary={{
              label: status === "scheduling" ? t("publish.scheduling") : t("publish.schedule"),
              icon: <Clock size={13} />,
              onClick: () => setShowSchedule(true),
              disabled: !canSchedule,
              loading: status === "scheduling",
            }}
          />
        )}
      </div>
      </div>

      {showSchedule && <ScheduleDialog onConfirm={handleScheduleDispatch} onClose={() => setShowSchedule(false)} />}

      {showPublishConfirm && (
        <PublishConfirmDialog
          channels={channels.filter((c) => selectedChannelIds.includes(c.id))}
          publishMode={publishMode}
          postTitle={effectiveTitle}
          onConfirm={() => { setShowPublishConfirm(false); handlePublish(); }}
          onClose={() => setShowPublishConfirm(false)}
        />
      )}
    </>
  );
}

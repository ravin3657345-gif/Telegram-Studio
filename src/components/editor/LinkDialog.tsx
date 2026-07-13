import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Link, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { Dialog, DialogTitle, DialogDescription, VisuallyHidden } from "@/components/ui/Dialog";

interface LinkDialogProps {
  editor: Editor;
  onClose: () => void;
}

export function LinkDialog({ editor, onClose }: LinkDialogProps) {
  const urlInputRef = useRef<HTMLInputElement>(null);
  useSettingsStore((s) => s.language);

  const existingHref =
    (editor.getAttributes("link").href as string | undefined) ?? "";
  const selectedText = editor.state.doc.textBetween(
    editor.state.selection.from,
    editor.state.selection.to,
    ""
  );
  const hasSelection = selectedText.length > 0;

  const [url, setUrl]       = useState(existingHref);
  const [text, setText]     = useState(selectedText);
  const [urlError, setUrlError] = useState("");

  useEffect(() => {
    urlInputRef.current?.focus();
    urlInputRef.current?.select();
  }, []);

  function validate(value: string): boolean {
    if (!value.trim()) {
      setUrlError(t("link.emptyError"));
      return false;
    }
    try {
      const u = value.startsWith("http") ? value : `https://${value}`;
      new URL(u);
      setUrlError("");
      return true;
    } catch {
      setUrlError(t("link.invalidError"));
      return false;
    }
  }

  function handleApply() {
    const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;
    if (!validate(normalizedUrl)) return;

    if (hasSelection) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: normalizedUrl })
        .run();
    } else {
      const insertText = text.trim() || normalizedUrl;
      editor
        .chain()
        .focus()
        .insertContent(`<a href="${normalizedUrl}">${insertText}</a>`)
        .run();
    }

    onClose();
  }

  function handleRemove() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onClose();
  }

  const hasExistingLink = !!existingHref;

  return (
    <Dialog
      onOpenChange={(open) => !open && onClose()}
      className="w-96 rounded-xl border"
      style={{
        backgroundColor: "var(--bg-elevated)",
        borderColor: "var(--border-default)",
        boxShadow: "var(--shadow-modal)",
      }}
    >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <Link size={15} style={{ color: "var(--accent)" }} />
            <DialogTitle asChild>
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {hasExistingLink ? t("link.editTitle") : t("link.insertTitle")}
              </span>
            </DialogTitle>
          </div>
          <VisuallyHidden><DialogDescription>{t("link.urlLabel")}</DialogDescription></VisuallyHidden>
          <button
            onClick={onClose}
            className="rounded p-0.5 transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {!hasSelection && (
            <div>
              <label
                className="block text-xs mb-1.5 font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("link.textLabel")}
              </label>
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("link.textPlaceholder")}
                className="w-full h-8 rounded-md border px-3 text-sm"
                style={{
                  backgroundColor: "var(--bg-input)",
                  borderColor: "var(--border-default)",
                  color: "var(--text-primary)",
                  outline: "none",
                }}
              />
            </div>
          )}

          <div>
            <label
              className="block text-xs mb-1.5 font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("link.urlLabel")}
            </label>
            <input
              ref={urlInputRef}
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setUrlError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && handleApply()}
              placeholder={t("link.urlPlaceholder")}
              className="w-full h-8 rounded-md border px-3 text-sm font-mono"
              style={{
                backgroundColor: "var(--bg-input)",
                borderColor: urlError ? "var(--danger)" : "var(--border-default)",
                color: "var(--text-primary)",
                outline: "none",
              }}
            />
            {urlError && (
              <p className="text-2xs mt-1" style={{ color: "var(--danger)" }}>
                {urlError}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-4 py-3 border-t"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div>
            {hasExistingLink && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRemove}
                leftIcon={<Trash2 size={13} />}
                style={{ color: "var(--danger)" } as React.CSSProperties}
              >
                {t("link.remove")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("link.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleApply}
              disabled={!url.trim()}
            >
              {t("link.apply")}
            </Button>
          </div>
        </div>
    </Dialog>
  );
}

import { useState } from "react";
import { X, Megaphone, List, Users, Tag, type LucideIcon } from "lucide-react";
import type { TemplateCategory } from "@/types/template";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";

interface Props {
  onConfirm: (name: string, category: TemplateCategory) => void;
  onClose: () => void;
  /** Pre-fills the name field — the post's/draft's title when creating,
   *  the existing template's name when editing. */
  initialName?: string;
  /** Pre-selects a category — used when editing an existing template. */
  initialCategory?: TemplateCategory;
}

function getCategories(): { id: TemplateCategory; label: string; description: string; Icon: LucideIcon }[] {
  return [
    { id: "announcements", label: t("template.cat.announcements"),  description: t("template.cat.announcements.desc"), Icon: Megaphone },
    { id: "collections",  label: t("template.cat.collections"),    description: t("template.cat.collections.desc"),   Icon: List      },
    { id: "engagement",   label: t("template.cat.engagement"),     description: t("template.cat.engagement.desc"),    Icon: Users     },
    { id: "promo",        label: t("template.cat.promo"),          description: t("template.cat.promo.desc"),         Icon: Tag       },
  ];
}

export function SaveTemplateDialog({ onConfirm, onClose, initialName, initialCategory }: Props) {
  useSettingsStore((s) => s.language);
  const categories = getCategories();
  const [name, setName] = useState(initialName ?? "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: 320,
          maxWidth: "calc(100vw - 32px)",
          borderRadius: 16,
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 16px 12px" }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>
            {t("editor.saveAsTemplate")}
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "var(--text-muted)", lineHeight: 0 }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "0 16px 14px" }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.03em", textTransform: "uppercase" }}>
            {t("template.nameLabel")}
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("drafts.untitled")}
            autoFocus
            style={{
              width: "100%", boxSizing: "border-box",
              height: 36, borderRadius: 8, padding: "0 10px",
              border: "1.5px solid var(--border-default)",
              backgroundColor: "var(--bg-elevated)",
              color: "var(--text-primary)",
              fontSize: 13,
              outline: "none",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; }}
          />
        </div>

        <p style={{ padding: "0 16px 12px", fontSize: 12, color: "var(--text-muted)" }}>
          {t("template.chooseCategory")}
        </p>

        {/* Category cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 12px 16px" }}>
          {categories.map(({ id, label, description, Icon }) => {
            const selected = id === initialCategory;
            return (
            <button
              key={id}
              onClick={() => onConfirm(name.trim() || t("drafts.untitled"), id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderRadius: 10,
                border: `1.5px solid ${selected ? "var(--accent)" : "var(--border-default)"}`,
                backgroundColor: selected ? "rgba(42,171,238,0.07)" : "var(--bg-elevated)",
                cursor: "pointer",
                textAlign: "left",
                transition: "border-color 0.15s, background-color 0.15s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.backgroundColor = "rgba(42,171,238,0.07)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = selected ? "var(--accent)" : "var(--border-default)";
                e.currentTarget.style.backgroundColor = selected ? "rgba(42,171,238,0.07)" : "var(--bg-elevated)";
              }}
            >
              <div
                style={{
                  width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                  backgroundColor: "rgba(42,171,238,0.12)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <Icon size={16} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3 }}>
                  {label}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  {description}
                </div>
              </div>
            </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

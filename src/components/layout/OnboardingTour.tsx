import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowRight, ArrowLeft } from "lucide-react";
import { useSettingsStore } from "@/store/settingsStore";
import { t, type TranslationKey } from "@/lib/i18n";

interface TourStep {
  selector: string;
  titleKey: TranslationKey;
  descKey: TranslationKey;
}

// Every selector must point at something that's already on screen right after
// setup (the editor page) — no cross-page navigation mid-tour, so a step can
// never end up pointing at nothing.
const TOUR_STEPS: TourStep[] = [
  { selector: '[data-tour="nav-editor"]',    titleKey: "tour.editor.title",    descKey: "tour.editor.desc" },
  { selector: '[data-tour="sidebar-widget"]', titleKey: "tour.widget.title",   descKey: "tour.widget.desc" },
  { selector: '[data-tour="nav-templates"]', titleKey: "tour.templates.title", descKey: "tour.templates.desc" },
  { selector: '[data-tour="nav-schedule"]',  titleKey: "tour.schedule.title",  descKey: "tour.schedule.desc" },
  { selector: '[data-tour="nav-history"]',   titleKey: "tour.history.title",   descKey: "tour.history.desc" },
  { selector: '[data-tour="editor-content"]', titleKey: "tour.slash.title",   descKey: "tour.slash.desc" },
  { selector: '[data-tour="publish-panel"]', titleKey: "tour.publish.title",  descKey: "tour.publish.desc" },
];

const CARD_W = 300;
const PAD = 16;

function cardPosition(rect: DOMRect | null): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardH = 168;

  if (!rect) {
    return { top: (vh - cardH) / 2, left: (vw - CARD_W) / 2 };
  }

  // Prefer to the right of the target (sidebar items live on the left edge).
  if (rect.right + PAD + CARD_W < vw) {
    return {
      left: rect.right + PAD,
      top: Math.min(Math.max(rect.top, PAD), vh - cardH - PAD),
    };
  }
  // Otherwise below the target.
  if (rect.bottom + PAD + cardH < vh) {
    return {
      left: Math.min(Math.max(rect.left, PAD), vw - CARD_W - PAD),
      top: rect.bottom + PAD,
    };
  }
  // Otherwise above the target.
  return {
    left: Math.min(Math.max(rect.left, PAD), vw - CARD_W - PAD),
    top: Math.max(PAD, rect.top - cardH - PAD),
  };
}

export function OnboardingTour() {
  const hasSeenTour = useSettingsStore((s) => s.hasSeenOnboardingTour);
  const setHasSeenTour = useSettingsStore((s) => s.setHasSeenOnboardingTour);

  const [active, setActive] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Start a beat after mount — lets the page finish laying out first so the
  // very first spotlight doesn't measure a half-rendered sidebar.
  useEffect(() => {
    if (hasSeenTour) return;
    setStepIdx(0);
    const timer = setTimeout(() => setActive(true), 700);
    return () => clearTimeout(timer);
  }, [hasSeenTour]);

  const measure = useCallback(() => {
    const el = document.querySelector(TOUR_STEPS[stepIdx].selector);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [stepIdx]);

  useEffect(() => {
    if (!active) return;
    measure();
    window.addEventListener("resize", measure);
    // Cheap poll — covers late-mounting targets and scroll/layout shifts
    // without wiring a bespoke observer for a one-time first-launch overlay.
    const poll = setInterval(measure, 300);
    return () => {
      window.removeEventListener("resize", measure);
      clearInterval(poll);
    };
  }, [active, measure]);

  if (!active) return null;

  function finish() {
    setActive(false);
    setHasSeenTour(true);
  }

  function next() {
    if (stepIdx >= TOUR_STEPS.length - 1) { finish(); return; }
    setStepIdx((i) => i + 1);
  }

  function back() {
    setStepIdx((i) => Math.max(0, i - 1));
  }

  const step = TOUR_STEPS[stepIdx];
  const pos = cardPosition(rect);
  const isLast = stepIdx === TOUR_STEPS.length - 1;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 10000 }}>
      {/* Dimmed backdrop with a spotlight cutout around the current target */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: rect ? "transparent" : "rgba(0,0,0,0.6)",
          transition: "background-color 0.2s ease",
        }}
        onClick={finish}
      />
      {rect && (
        <div
          style={{
            position: "fixed",
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            borderRadius: 10,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
            outline: "2px solid var(--accent)",
            outlineOffset: 2,
            pointerEvents: "none",
            transition: "top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease",
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className="soft-ui"
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: CARD_W,
          borderRadius: 14,
          padding: "16px 18px 14px",
          backgroundColor: "var(--bg-surface)",
          transition: "top 0.25s ease, left 0.25s ease",
        }}
      >
        <button
          onClick={finish}
          title={t("tour.skip")}
          style={{
            position: "absolute", top: 10, right: 10,
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-muted)", padding: 4, borderRadius: 6, lineHeight: 0,
          }}
        >
          <X size={14} />
        </button>

        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 5, paddingRight: 16 }}>
          {t(step.titleKey)}
        </p>
        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 14 }}>
          {t(step.descKey)}
        </p>

        {/* Step dots */}
        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {TOUR_STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === stepIdx ? 14 : 5,
                height: 5,
                borderRadius: 3,
                backgroundColor: i === stepIdx ? "var(--accent)" : "var(--border-default)",
                transition: "width 0.15s ease, background-color 0.15s ease",
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={finish}
            style={{
              fontSize: 12, color: "var(--text-muted)", background: "none", border: "none",
              cursor: "pointer", padding: "6px 4px", marginRight: "auto",
            }}
          >
            {t("tour.skip")}
          </button>
          {stepIdx > 0 && (
            <button
              onClick={back}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                fontSize: 12, fontWeight: 600, color: "var(--text-secondary)",
                background: "var(--bg-elevated)", border: "1px solid var(--border-default)",
                borderRadius: 8, padding: "6px 10px", cursor: "pointer",
              }}
            >
              <ArrowLeft size={12} />
              {t("tour.back")}
            </button>
          )}
          <button
            onClick={next}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              fontSize: 12, fontWeight: 600, color: "#fff",
              background: "var(--accent)", border: "none",
              borderRadius: 8, padding: "6px 12px", cursor: "pointer",
            }}
          >
            {isLast ? t("tour.finish") : t("tour.next")}
            {!isLast && <ArrowRight size={12} />}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

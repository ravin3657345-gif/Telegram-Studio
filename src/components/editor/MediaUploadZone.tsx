import { Upload } from "lucide-react";
import { t } from "@/lib/i18n";

interface MediaUploadZoneProps {
  visible: boolean;
}

export function MediaUploadZone({ visible }: MediaUploadZoneProps) {
  if (!visible) return null;

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none"
      style={{ backdropFilter: "blur(2px)" }}
    >
      {/* Dark overlay */}
      <div
        className="absolute inset-0 rounded-xl"
        style={{ backgroundColor: "rgba(10, 10, 10, 0.75)" }}
      />

      {/* Drop indicator */}
      <div
        className="relative flex flex-col items-center gap-4 p-8 rounded-2xl border-2 border-dashed"
        style={{ borderColor: "var(--accent)" }}
      >
        <div
          className="flex items-center justify-center w-16 h-16 rounded-full"
          style={{ backgroundColor: "var(--accent-subtle)" }}
        >
          <Upload size={28} style={{ color: "var(--accent)" }} />
        </div>

        <div className="text-center">
          <p
            className="text-base font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {t("drop.release")}
          </p>
          <p
            className="text-sm mt-1"
            style={{ color: "var(--text-secondary)" }}
          >
            {t("drop.hint")}
          </p>
        </div>
      </div>
    </div>
  );
}

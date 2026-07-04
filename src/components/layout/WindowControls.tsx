import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import { t } from "@/lib/i18n";

const appWindow = getCurrentWindow();

export function WindowControls() {
  return (
    <div
      className="flex items-center justify-between h-8 px-3 flex-shrink-0"
      style={{ backgroundColor: "var(--bg-sidebar)" }}
      data-tauri-drag-region
    >
      {/* Left: logo + title */}
      <div
        className="flex items-center gap-2 select-none pointer-events-none"
        data-tauri-drag-region
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="flex-shrink-0"
        >
          <path
            d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z"
            fill="var(--accent)"
          />
        </svg>
        <span
          className="text-xs font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          Telegram Studio
        </span>
      </div>

      {/* Right: window buttons */}
      <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <WinBtn
          onClick={() => appWindow.minimize()}
          aria-label={t("window.minimize")}
        >
          <Minus size={10} strokeWidth={2} />
        </WinBtn>

        <WinBtn
          onClick={() => appWindow.toggleMaximize()}
          aria-label={t("window.maximize")}
        >
          <Square size={9} strokeWidth={2} />
        </WinBtn>

        <WinBtn
          onClick={() => appWindow.close()}
          aria-label={t("window.close")}
          danger
        >
          <X size={11} strokeWidth={2} />
        </WinBtn>
      </div>
    </div>
  );
}

interface WinBtnProps {
  children: React.ReactNode;
  onClick: () => void;
  "aria-label": string;
  danger?: boolean;
}

function WinBtn({ children, onClick, danger, ...rest }: WinBtnProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center justify-center w-10 h-6 rounded transition-colors",
        danger
          ? "hover:bg-red-600 hover:text-white"
          : "hover:bg-[var(--bg-hover)]"
      )}
      style={{ color: "var(--text-muted)" }}
      {...rest}
    >
      {children}
    </button>
  );
}

import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import { t } from "@/lib/i18n";

const appWindow = getCurrentWindow();

export function WindowControls() {
  return (
    <div
      className="flex items-center justify-between h-8 pl-3 flex-shrink-0"
      style={{ backgroundColor: "var(--bg-sidebar)" }}
      data-tauri-drag-region
    >
      {/* Left: logo + title */}
      <div
        className="flex items-center gap-2 select-none pointer-events-none"
        data-tauri-drag-region
      >
        <img
          src="/icon.png"
          width="16"
          height="16"
          alt=""
          draggable={false}
          className="flex-shrink-0"
          style={{ borderRadius: 4 }}
        />
        <span
          className="text-xs font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          Telegram Studio
        </span>
      </div>

      {/* Right: window buttons — flush against the actual top-right corner
          (full bar height, no gap, no rounded corners, no trailing padding)
          so mashing the cursor into the screen corner — the usual way to
          close a window without looking, since native title bars treat that
          corner as an infinite target — always lands on Close instead of
          overshooting into empty drag-region padding past it. */}
      <div className="flex items-center h-full self-stretch" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
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
        "flex items-center justify-center w-11 h-full transition-colors",
        danger
          ? "hover:bg-red-600 hover:text-white"
          : "hover:bg-[var(--bg-hover)]"
      )}
      style={{ color: "var(--text-secondary)" }}
      {...rest}
    >
      {children}
    </button>
  );
}

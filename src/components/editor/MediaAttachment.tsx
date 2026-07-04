import { X, FileText, Film, Image } from "lucide-react";
import type { MediaItem } from "@/store/editorStore";
import { t } from "@/lib/i18n";

interface MediaAttachmentProps {
  item: MediaItem;
  onRemove: (id: string) => void;
}

export function MediaAttachment({ item, onRemove }: MediaAttachmentProps) {
  const isImage = item.mediaType === "image";
  const isVideo = item.mediaType === "video" || item.mediaType === "gif";
  const isFile  = item.mediaType === "file";

  const sizeKb = (item.fileSize / 1024).toFixed(0);
  const sizeMb = (item.fileSize / (1024 * 1024)).toFixed(1);
  const sizeLabel = item.fileSize > 1024 * 1024 ? `${sizeMb} МБ` : `${sizeKb} КБ`;

  return (
    <div
      className="relative group flex-shrink-0 rounded-lg overflow-hidden border"
      style={{
        width: 80,
        height: 80,
        borderColor: "var(--border-default)",
        backgroundColor: "var(--bg-elevated)",
      }}
    >
      {/* Preview */}
      {isImage && item.previewUrl && (
        <img
          src={item.previewUrl}
          alt={item.fileName}
          className="w-full h-full object-cover"
        />
      )}

      {isVideo && item.previewUrl ? (
        <video
          src={item.previewUrl}
          className="w-full h-full object-cover"
          muted
          preload="metadata"
        />
      ) : isVideo ? (
        <MediaIcon icon={Film} />
      ) : null}

      {isFile && (
        <div className="flex flex-col items-center justify-center w-full h-full gap-1 p-1">
          <FileText size={22} style={{ color: "var(--accent)" }} />
          <span
            className="text-2xs text-center leading-tight truncate w-full px-1"
            style={{ color: "var(--text-secondary)" }}
          >
            {item.fileName.split(".").pop()?.toUpperCase()}
          </span>
        </div>
      )}

      {/* Size badge */}
      <div
        className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-2xs text-center truncate"
        style={{
          backgroundColor: "rgba(0,0,0,0.55)",
          color: "#fff",
          fontSize: 10,
        }}
      >
        {sizeLabel}
      </div>

      {/* Video overlay icon */}
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="rounded-full p-1.5"
            style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          >
            <Film size={14} color="#fff" />
          </div>
        </div>
      )}

      {/* Remove button */}
      <button
        onClick={() => onRemove(item.id)}
        className="absolute top-0.5 right-0.5 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ backgroundColor: "rgba(0,0,0,0.65)" }}
        title={t("media.delete")}
      >
        <X size={12} color="#fff" />
      </button>
    </div>
  );
}

function MediaIcon({ icon: Icon }: { icon: typeof Image }) {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <Icon size={24} style={{ color: "var(--text-muted)" }} />
    </div>
  );
}

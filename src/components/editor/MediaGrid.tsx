import { useRef } from "react";
import { Plus } from "lucide-react";
import { MediaAttachment } from "./MediaAttachment";
import type { MediaItem } from "@/store/editorStore";
import { TELEGRAM_MAX_MEDIA_GROUP } from "@/lib/constants";

interface MediaGridProps {
  items: MediaItem[];
  onRemove: (id: string) => void;
  onAddMore: (files: File[]) => void;
}

export function MediaGrid({ items, onRemove, onAddMore }: MediaGridProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  if (items.length === 0) return null;

  const canAddMore = items.length < TELEGRAM_MAX_MEDIA_GROUP;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) onAddMore(files);
    e.target.value = "";
  }

  return (
    <div
      className="px-4 pb-3 flex-shrink-0 border-t"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <div className="pt-3 flex items-center gap-2 flex-wrap">
        {items.map((item) => (
          <MediaAttachment key={item.id} item={item} onRemove={onRemove} />
        ))}

        {canAddMore && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*,video/*,*/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => inputRef.current?.click()}
              className="flex-shrink-0 flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed transition-colors"
              style={{
                width: 80,
                height: 80,
                borderColor: "var(--border-default)",
                color: "var(--text-muted)",
              }}
              title="Добавить ещё"
            >
              <Plus size={20} />
              <span className="text-2xs">Добавить</span>
            </button>
          </>
        )}

        <div className="flex-1" />
        <span
          className="text-2xs flex-shrink-0"
          style={{ color: "var(--text-muted)" }}
        >
          {items.length}/{TELEGRAM_MAX_MEDIA_GROUP} файлов
        </span>
      </div>
    </div>
  );
}

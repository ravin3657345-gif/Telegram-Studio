import { LayoutGrid, GalleryHorizontal } from "lucide-react";
import { t } from "@/lib/i18n";
import type { MediaGroupLayout } from "./mediaGroupLayout";

// Small pill shown in the corner of a blockImage/blockVideo NodeView when it's
// part of a run of 2+ adjacent media blocks (Rich mode only) — lets the user
// flip the whole run between a grid collage and a swipeable slideshow.
export function MediaGroupLayoutToggle({
  layout,
  onClick,
}: {
  layout: MediaGroupLayout;
  onClick: () => void;
}) {
  const isSlideshow = layout === "slideshow";

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      contentEditable={false}
      title={isSlideshow ? t("media.groupSlideshow") : t("media.groupCollage")}
      style={{
        position: "absolute",
        bottom: 8,
        left: 8,
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "rgba(0,0,0,0.55)",
        border: "none",
        borderRadius: 14,
        height: 26,
        padding: "0 10px",
        cursor: "pointer",
        color: "white",
        fontSize: 11,
      }}
    >
      {isSlideshow ? <GalleryHorizontal size={13} /> : <LayoutGrid size={13} />}
      {isSlideshow ? t("media.groupSlideshow") : t("media.groupCollage")}
    </button>
  );
}

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";
import { t } from "@/lib/i18n";

// Rich Messages only (Bot API 10.1's RichBlockMap, HTML tag <tg-map lat long
// zoom> — see richMessageConverter.ts). Undocumented tag, confirmed live by
// sending a real sendRichMessage and reading the parsed-back rich_message
// block (came back as {type:"map", location:{latitude,longitude}, zoom,
// width, height} — lat/long are the correct attribute names, "latitude"/
// "longitude" are NOT recognized and silently produce garbage coordinates).
//
// Real interactive picker (click/drag to place the pin) via Leaflet + OSM
// tiles — img-src CSP in tauri.conf.json explicitly allows
// *.tile.openstreetmap.org for this (self-hosted Leaflet JS/CSS, but the
// tiles themselves are a legitimate runtime network fetch, same category as
// the litterbox.catbox.moe uploads Rich mode already does for photos).

// Vite bundles these as hashed asset URLs — Leaflet's own CSS references the
// marker images via relative paths that don't resolve once bundled, so the
// default icon must be re-pointed at the actual bundled URLs explicitly.
const markerIcon = L.icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MapNodeView({ node, updateAttributes, deleteNode, selected }: any) {
  const { lat, long, zoom } = node.attrs as { lat: number; long: number; zoom: number };
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  // Distinguishes "the map moved because WE set .setView() from a prop
  // change" from "the user actually dragged/clicked" — without this, every
  // attrs update would re-trigger its own moveend and loop.
  const programmatic = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, { attributionControl: true }).setView([lat, long], zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map);

    const marker = L.marker([lat, long], { icon: markerIcon, draggable: true }).addTo(map);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      updateAttributes({ lat: pos.lat, long: pos.lng });
    });
    map.on("click", (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      updateAttributes({ lat: e.latlng.lat, long: e.latlng.lng });
    });
    map.on("zoomend", () => {
      if (programmatic.current) return;
      updateAttributes({ zoom: map.getZoom() });
    });

    mapRef.current = map;
    markerRef.current = marker;
    // The NodeView mounts inside a scroll container whose final size isn't
    // known on the first paint — Leaflet renders a blank/grey tile grid if
    // initialized before its container has real dimensions.
    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the map in sync when attrs change from elsewhere (undo/redo,
  // collaborative edits) without fighting the user's own drag/click, which
  // already updated attrs from the map itself above.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    const current = marker.getLatLng();
    if (Math.abs(current.lat - lat) > 1e-9 || Math.abs(current.lng - long) > 1e-9) {
      marker.setLatLng([lat, long]);
      programmatic.current = true;
      map.setView([lat, long], map.getZoom());
      programmatic.current = false;
    }
  }, [lat, long]);

  return (
    <NodeViewWrapper as="div" contentEditable={false} style={{ margin: "8px 0" }}>
      <div
        style={{
          borderRadius: 8, overflow: "hidden",
          border: `1.5px solid ${selected ? "var(--accent)" : "var(--border-default)"}`,
          transition: "border-color 0.1s",
          position: "relative",
        }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); deleteNode(); }}
          title={t("block.delete")}
          style={{
            position: "absolute", top: 6, right: 6, zIndex: 1000,
            display: "flex", background: "var(--bg-elevated)", border: "1px solid var(--border-default)",
            cursor: "pointer", padding: 4, borderRadius: 6, color: "var(--text-muted)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
          }}
        >
          <X size={14} />
        </button>
        <div ref={containerRef} style={{ height: 220, width: "100%" }} />
      </div>
    </NodeViewWrapper>
  );
}

export const BlockMap = Node.create({
  name: "blockMap",
  group: "block",
  atom: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      lat:  { default: 55.7558 },
      long: { default: 37.6173 },
      zoom: { default: 15 },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-block-map]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-block-map": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MapNodeView);
  },
});

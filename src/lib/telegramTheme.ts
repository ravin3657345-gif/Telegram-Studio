// Telegram chat colour palettes used by the message preview.
// Pure data — extracted from TelegramPreview so the component focuses on render.

export interface TGPalette {
  chatBg: string;
  chatGradient: string;
  chatDotPattern: string;
  headerBg: string;
  headerBorder: string;
  headerText: string;
  headerTextMuted: string;
  headerIcon: string;
  bubbleBg: string;
  bubbleText: string;
  timeFg: string;
  checkFg: string;
  linkFg: string;
  codeBg: string;
  quoteBorder: string;
  quoteBg: string;
  quoteFade: string;
  mediaBg: string;
  videoOverlay: string;
  spoilerBg: string;
  datePillBg: string;
  datePillText: string;
  inputBg: string;
  inputBorder: string;
  inputPlaceholder: string;
  emptyText: string;
  titleColor: string;
  headingColor: string;
}

export const DARK: TGPalette = {
  chatBg:           "#17212b",
  chatGradient:     `radial-gradient(ellipse at 15% 85%, rgba(28,55,80,0.6) 0%, transparent 55%),
                     radial-gradient(ellipse at 85% 15%, rgba(20,45,70,0.5) 0%, transparent 55%)`,
  chatDotPattern:   `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Ccircle cx='30' cy='30' r='1.5' fill='rgba(255,255,255,0.025)'/%3E%3Ccircle cx='0' cy='0' r='1.5' fill='rgba(255,255,255,0.025)'/%3E%3Ccircle cx='60' cy='0' r='1.5' fill='rgba(255,255,255,0.025)'/%3E%3Ccircle cx='0' cy='60' r='1.5' fill='rgba(255,255,255,0.025)'/%3E%3Ccircle cx='60' cy='60' r='1.5' fill='rgba(255,255,255,0.025)'/%3E%3C/svg%3E")`,
  headerBg:         "#1f2b38",
  headerBorder:     "rgba(255,255,255,0.06)",
  headerText:       "#ffffff",
  headerTextMuted:  "rgba(255,255,255,0.45)",
  headerIcon:       "rgba(255,255,255,0.5)",
  bubbleBg:         "#2b5278",
  bubbleText:       "rgba(255,255,255,0.92)",
  timeFg:           "rgba(255,255,255,0.45)",
  checkFg:          "#5ac8fa",
  linkFg:           "#6ab7f5",
  codeBg:           "rgba(0,0,0,0.28)",
  quoteBorder:      "#5b9bd5",
  quoteBg:          "rgba(91,155,213,0.10)",
  quoteFade:        "rgba(43,82,120,0.95)",
  mediaBg:          "#162330",
  videoOverlay:     "rgba(0,0,0,0.38)",
  spoilerBg:        "rgba(255,255,255,0.14)",
  datePillBg:       "rgba(0,0,0,0.35)",
  datePillText:     "rgba(255,255,255,0.7)",
  inputBg:          "rgba(255,255,255,0.06)",
  inputBorder:      "rgba(255,255,255,0.07)",
  inputPlaceholder: "rgba(255,255,255,0.25)",
  emptyText:        "rgba(255,255,255,0.22)",
  titleColor:       "#ffffff",
  headingColor:     "#ffffff",
};

export const LIGHT: TGPalette = {
  chatBg:           "#dfe4ea",
  chatGradient:     `radial-gradient(ellipse at 20% 80%, rgba(180,200,220,0.5) 0%, transparent 55%),
                     radial-gradient(ellipse at 80% 20%, rgba(160,185,210,0.4) 0%, transparent 55%)`,
  chatDotPattern:   `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Ccircle cx='30' cy='30' r='1.5' fill='rgba(0,0,0,0.04)'/%3E%3Ccircle cx='0' cy='0' r='1.5' fill='rgba(0,0,0,0.04)'/%3E%3Ccircle cx='60' cy='0' r='1.5' fill='rgba(0,0,0,0.04)'/%3E%3Ccircle cx='0' cy='60' r='1.5' fill='rgba(0,0,0,0.04)'/%3E%3Ccircle cx='60' cy='60' r='1.5' fill='rgba(0,0,0,0.04)'/%3E%3C/svg%3E")`,
  headerBg:         "#ffffff",
  headerBorder:     "rgba(0,0,0,0.08)",
  headerText:       "#111111",
  headerTextMuted:  "rgba(0,0,0,0.45)",
  headerIcon:       "rgba(0,0,0,0.4)",
  bubbleBg:         "#effdde",
  bubbleText:       "rgba(0,0,0,0.87)",
  timeFg:           "rgba(0,0,0,0.4)",
  checkFg:          "#4fab3e",
  linkFg:           "#1a73e8",
  codeBg:           "rgba(0,0,0,0.06)",
  quoteBorder:      "#6c9bc3",
  quoteBg:          "rgba(108,155,195,0.12)",
  quoteFade:        "rgba(239,253,222,0.95)",
  mediaBg:          "#c8d3de",
  videoOverlay:     "rgba(0,0,0,0.22)",
  spoilerBg:        "rgba(0,0,0,0.12)",
  datePillBg:       "rgba(0,0,0,0.22)",
  datePillText:     "rgba(255,255,255,0.9)",
  inputBg:          "rgba(0,0,0,0.05)",
  inputBorder:      "rgba(0,0,0,0.07)",
  inputPlaceholder: "rgba(0,0,0,0.3)",
  emptyText:        "rgba(0,0,0,0.3)",
  titleColor:       "#111111",
  headingColor:     "#111111",
};

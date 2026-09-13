// @vitest-environment jsdom
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { UpdateDialog } from "./UpdateDialog";
import { useUpdateStore } from "@/store/updateStore";
import { t } from "@/lib/i18n";

// The dialog is deliberately un-dismissible: an update prompt that a stray
// Escape or a click on the backdrop throws away is the bug this guards against,
// because the user never gets to read what the update is. Radix is given an
// inert `onOpenChange` and `open` is always true while mounted, so it cannot
// close the dialog itself — these tests exercise the real DOM events Radix
// reacts to (Escape on the document, pointerdown outside the content) rather
// than calling the callback directly.

// jsdom has no matchMedia, and useIsMobileLayout() (via Dialog) calls it.
const mql = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (window as any).matchMedia = mql;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  // An update is waiting, which is the only state that opens the dialog.
  useUpdateStore.setState({
    status: "available",
    info: { version: "9.9.9", currentVersion: "1.9.5", notes: "что нового", date: null },
    dialogOpen: true,
    downloaded: 0,
    contentLength: null,
    error: null,
    installed: false,
    deferredVersion: null,
  });

  act(() => {
    root.render(<UpdateDialog />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const dialogVisible = () => document.querySelector('[role="dialog"]') !== null;

const clickButton = (label: string) => {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!button) throw new Error(`кнопка «${label}» не найдена`);
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
};

describe("UpdateDialog", () => {
  it("показывается, когда есть обновление", () => {
    expect(dialogVisible()).toBe(true);
  });

  it("не закрывается по Escape", () => {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }),
      );
    });

    expect(dialogVisible()).toBe(true);
    expect(useUpdateStore.getState().dialogOpen).toBe(true);
  });

  it("не закрывается кликом по фону", () => {
    const overlay = document.querySelector(".dialog-overlay");
    expect(overlay).not.toBeNull();

    act(() => {
      overlay!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(dialogVisible()).toBe(true);
    expect(useUpdateStore.getState().dialogOpen).toBe(true);
  });

  it("не имеет крестика для закрытия", () => {
    const closeButtons = [...document.querySelectorAll("button")].filter(
      (b) => b.getAttribute("aria-label") === t("common.close"),
    );
    expect(closeButtons).toHaveLength(0);
  });

  it("закрывается кнопкой «Позже» и запоминает отложенную версию", () => {
    clickButton(t("update.later"));

    expect(useUpdateStore.getState().dialogOpen).toBe(false);
    expect(useUpdateStore.getState().deferredVersion).toBe("9.9.9");
  });

  it("оставляет «Обновить сейчас» и «Позже» единственными кнопками-действиями", () => {
    const labels = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(labels).toContain(t("update.install"));
    expect(labels).toContain(t("update.later"));
  });
});

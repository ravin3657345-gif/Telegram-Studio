// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeTelegramHtml } from "./telegramSanitize";

describe("sanitizeTelegramHtml", () => {
  it("keeps allowed formatting tags", () => {
    const html = "<b>bold</b> <i>italic</i> <a href=\"https://x.com\">link</a>";
    const out = sanitizeTelegramHtml(html);
    expect(out).toContain("<b>bold</b>");
    expect(out).toContain("<i>italic</i>");
    expect(out).toContain("href=\"https://x.com\"");
  });

  it("strips <script> tags", () => {
    const out = sanitizeTelegramHtml('<b>ok</b><script>alert(1)</script>');
    expect(out).toContain("<b>ok</b>");
    expect(out.toLowerCase()).not.toContain("<script");
  });

  it("removes event-handler attributes", () => {
    const out = sanitizeTelegramHtml('<b onclick="steal()">x</b>');
    expect(out).not.toContain("onclick");
  });

  it("drops disallowed tags but keeps their text", () => {
    const out = sanitizeTelegramHtml("<div><b>hi</b></div>");
    expect(out).not.toContain("<div>");
    expect(out).toContain("<b>hi</b>");
  });

  it("keeps tg-spoiler and details/summary", () => {
    const out = sanitizeTelegramHtml(
      "<tg-spoiler>secret</tg-spoiler><details><summary>q</summary>a</details>",
    );
    expect(out).toContain("<tg-spoiler>");
    expect(out).toContain("<summary>");
  });
});

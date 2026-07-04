import { describe, it, expect } from "vitest";
import { ru } from "./locales/ru";
import { en } from "./locales/en";
import { fr } from "./locales/fr";
import { pl } from "./locales/pl";
import { es } from "./locales/es";
import { t, ti, setI18nLanguage, pluralWords } from "./i18n";

const locales = { en, fr, pl, es } as Record<string, Record<string, string>>;
const ruKeys = Object.keys(ru);

describe("i18n locale consistency", () => {
  for (const [name, dict] of Object.entries(locales)) {
    it(`${name} has no keys missing relative to ru`, () => {
      const missing = ruKeys.filter((k) => !(k in dict));
      expect(missing, `missing in ${name}: ${missing.join(", ")}`).toEqual([]);
    });

    it(`${name} has no extra keys not present in ru`, () => {
      const extra = Object.keys(dict).filter((k) => !(k in ru));
      expect(extra, `extra in ${name}: ${extra.join(", ")}`).toEqual([]);
    });

    it(`${name} has no empty translations`, () => {
      const empty = Object.entries(dict)
        .filter(([, v]) => !v || !v.trim())
        .map(([k]) => k);
      expect(empty, `empty in ${name}: ${empty.join(", ")}`).toEqual([]);
    });
  }
});

describe("t / ti", () => {
  it("returns the ru string by default", () => {
    setI18nLanguage("ru");
    expect(t("nav.editor")).toBe(ru["nav.editor"]);
  });

  it("switches language", () => {
    setI18nLanguage("en");
    expect(t("nav.editor")).toBe(en["nav.editor"]);
    setI18nLanguage("ru");
  });

  it("interpolates parameters", () => {
    // Use a key that contains a {placeholder}
    const key = ruKeys.find((k) => ru[k as keyof typeof ru].includes("{")) as
      | keyof typeof ru
      | undefined;
    if (key) {
      const paramName = ru[key].match(/\{(\w+)\}/)?.[1];
      if (paramName) {
        const out = ti(key, { [paramName]: "XYZ" });
        expect(out).toContain("XYZ");
        expect(out).not.toContain(`{${paramName}}`);
      }
    }
  });
});

describe("pluralWords", () => {
  it("uses Russian plural rules", () => {
    setI18nLanguage("ru");
    expect(pluralWords(1)).toBe("1 слово");
    expect(pluralWords(2)).toBe("2 слова");
    expect(pluralWords(5)).toBe("5 слов");
    expect(pluralWords(11)).toBe("11 слов");
  });

  it("uses English plural rules", () => {
    setI18nLanguage("en");
    expect(pluralWords(1)).toBe("1 word");
    expect(pluralWords(3)).toBe("3 words");
    setI18nLanguage("ru");
  });
});

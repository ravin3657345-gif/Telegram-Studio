import type { Language } from "@/types/settings";
import { ru } from "./locales/ru";
import { en } from "./locales/en";
import { fr } from "./locales/fr";
import { pl } from "./locales/pl";
import { es } from "./locales/es";

// Per-language dictionaries live in ./locales/*.ts. `ru` is the source of truth
// for the key set (TranslationKey) and the fallback when a key is missing.
const translations = { ru, en, fr, pl, es } satisfies Record<Language, Record<string, string>>;

export type TranslationKey = keyof typeof ru;

let currentLanguage: Language = "ru";

export function setI18nLanguage(lang: Language) {
  currentLanguage = lang;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("lang", lang);
  }
}

export function t(key: TranslationKey): string {
  return (translations[currentLanguage] as Record<string, string>)?.[key] ?? ru[key] ?? key;
}

export function ti(key: TranslationKey, params: Record<string, string | number>): string {
  let str = t(key);
  for (const [k, v] of Object.entries(params)) {
    str = str.split(`{${k}}`).join(String(v));
  }
  return str;
}

export function pluralWords(n: number): string {
  if (currentLanguage === "ru") {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} слово`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} слова`;
    return `${n} слов`;
  }
  if (currentLanguage === "pl") {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (n === 1) return `${n} słowo`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} słowa`;
    return `${n} słów`;
  }
  if (currentLanguage === "fr") return n === 1 ? `${n} mot` : `${n} mots`;
  if (currentLanguage === "es") return n === 1 ? `${n} palabra` : `${n} palabras`;
  return n === 1 ? `${n} word` : `${n} words`;
}

export function useT() {
  return t;
}

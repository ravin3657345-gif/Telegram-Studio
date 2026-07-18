// Built-in "quality post" examples shown in the Templates gallery.
//
// These are NOT stored in the database — they're a static, undeletable
// catalog bundled with the app, one per template category, each
// demonstrating a real Telegram copywriting technique (hook + structure +
// CTA, the AIDA/ODC offer formula, ranked digests, FAQ/spoiler blocks, etc.)
// grounded in current best-practice guides rather than invented from scratch.
//
// "Use" behaves exactly like using a real template: it loads the content
// into the editor via setContentJson(), it just never touches the DB.

import type { TemplateCategory } from "@/types/template";
import demoCollage1 from "@/assets/demo/demo-collage-1.jpg";
import demoCollage2 from "@/assets/demo/demo-collage-2.jpg";
import demoSlide1 from "@/assets/demo/demo-slide-1.jpg";
import demoSlide2 from "@/assets/demo/demo-slide-2.jpg";

export interface ExampleTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  /** One-line note on the copywriting technique this example demonstrates. */
  technique: string;
  contentJson: string;
  /**
   * Bundled local image assets this example's blockImage nodes reference by
   * fileId (see registerFilesIntoJson in attachmentRestore.ts) — undefined
   * for every other example here, since none of them use real media. Vite
   * resolves each import to a small hashed-filename URL, not the image bytes
   * themselves, so this costs nothing until a template that actually needs
   * one is used.
   */
  assets?: Record<string, { url: string; fileName: string; mimeType: string }>;
}

// blockImage's `src` is only ever a display URL — the real Rich-publish path
// (PublishPanel.tsx) resolves photos via fileRegistry.getFile(fileId)
// exclusively, so `src` alone would preview fine and then fail/vanish on
// Publish. TemplatesPage.handleUseExample fetches these and registers them
// into fileRegistry (via registerFilesIntoJson) before setting the content,
// exactly like opening a real draft/template restores its own attachments.
const SHOWCASE_ASSETS: NonNullable<ExampleTemplate["assets"]> = {
  "demo-collage-1": { url: demoCollage1, fileName: "demo-collage-1.jpg", mimeType: "image/jpeg" },
  "demo-collage-2": { url: demoCollage2, fileName: "demo-collage-2.jpg", mimeType: "image/jpeg" },
  "demo-slide-1":   { url: demoSlide1,   fileName: "demo-slide-1.jpg",   mimeType: "image/jpeg" },
  "demo-slide-2":   { url: demoSlide2,   fileName: "demo-slide-2.jpg",   mimeType: "image/jpeg" },
};

const doc = (...content: unknown[]) => JSON.stringify({ type: "doc", content });
const heading = (level: number, text: string) => ({
  type: "heading", attrs: { level }, content: [{ type: "text", text }],
});
const p = (...runs: Array<string | { text: string; marks: unknown[] }>) => ({
  type: "paragraph",
  content: runs.map((r) => (typeof r === "string" ? { type: "text", text: r } : { type: "text", text: r.text, marks: r.marks })),
});
const bold = (text: string) => ({ text, marks: [{ type: "bold" }] });
const italic = (text: string) => ({ text, marks: [{ type: "italic" }] });
const underline = (text: string) => ({ text, marks: [{ type: "underline" }] });
const strike = (text: string) => ({ text, marks: [{ type: "strike" }] });
const spoiler = (text: string) => ({ text, marks: [{ type: "spoiler" }] });
const highlight = (text: string) => ({ text, marks: [{ type: "highlight" }] });
const inlineCode = (text: string) => ({ text, marks: [{ type: "code" }] });
const link = (text: string, href: string) => ({ text, marks: [{ type: "link", attrs: { href } }] });
const li = (...runs: Array<string | { text: string; marks: unknown[] }>) => ({
  type: "listItem",
  content: [p(...runs)],
});
const quote = (expandable: boolean, ...blocks: unknown[]) => ({
  type: "blockquote",
  attrs: { expandable },
  content: blocks,
});
const check = (checked: boolean, text: string) => ({
  type: "checkItem",
  attrs: { checked },
  content: [{ type: "text", text }],
});
// `src: ""` — patched to a real blob URL by registerFilesIntoJson once
// TemplatesPage fetches the matching SHOWCASE_ASSETS entry; empty until then
// is fine, this node never renders before that patch runs.
const img = (fileId: string, groupLayout: "collage" | "slideshow") => ({
  type: "blockImage",
  attrs: { src: "", fileId, groupLayout, fileName: SHOWCASE_ASSETS[fileId].fileName, mimeType: SHOWCASE_ASSETS[fileId].mimeType },
});

export const EXAMPLE_TEMPLATES: ExampleTemplate[] = [
  {
    id: "__example-announcement",
    name: "Запуск новой функции",
    category: "announcements",
    technique: "Хук в заголовке + список изменений + чёткий призыв к действию",
    contentJson: doc(
      heading(2, "🚀 Мы запустили тёмную тему"),
      p("Друзья, наконец-то! ", bold("Самая частая просьба за последний месяц"), " — и мы её выполнили."),
      {
        type: "bulletList",
        content: [
          li("Автоматическое переключение по времени суток"),
          li("Ручной выбор в настройках профиля"),
          li("Поддержка во всех разделах приложения"),
        ],
      },
      p(bold("Обновите приложение и попробуйте прямо сейчас →")),
    ),
  },
  {
    id: "__example-promo",
    name: "Скидка выходного дня",
    category: "promo",
    technique: "Формула ODC: оффер, дедлайн, призыв к действию",
    contentJson: doc(
      heading(2, "🔥 Скидка 30% только на выходных"),
      p(italic("Такое бывает раз в квартал.")),
      p(bold("Оффер: −30% на годовую подписку по промокоду WEEKEND30")),
      {
        type: "blockquote",
        attrs: { expandable: false },
        content: [p("⏰ Промокод сгорает в воскресенье в 23:59 — второго шанса не будет.")],
      },
      p(bold("Активировать скидку →")),
    ),
  },
  {
    id: "__example-engagement",
    name: "Опрос про контент-план",
    category: "engagement",
    technique: "Живой опрос вместо риторического вопроса — реальные голоса вместо догадок",
    contentJson: doc(
      p("Готовим контент-план на следующий месяц и хотим свериться с вами 👇"),
      {
        type: "blockPoll",
        attrs: {
          question: "Какой формат постов заходит вам больше всего?",
          options: ["Разборы кейсов", "Подборки инструментов", "Опросы и голосования", "Новости и анонсы"],
          isAnonymous: true,
          allowsMultipleAnswers: false,
        },
      },
      p("Голосуйте — учтём результаты в следующем дайджесте!"),
    ),
  },
  {
    id: "__example-collection",
    name: "Топ-5 находок недели",
    category: "collections",
    technique: "Нумерованный рейтинг — порядок несёт смысл (от лучшего к следующему)",
    contentJson: doc(
      heading(2, "📌 Топ-5 находок недели"),
      {
        type: "orderedList",
        content: [
          li(bold("Инструмент для скриптов"), " — экономит час в день на рутине"),
          li(bold("Шаблон отчёта"), " — закрывает половину вопросов в первом же сообщении"),
          li(bold("Расширение для заметок"), " — синхронизация без лишних кликов"),
          li(bold("Библиотека иконок"), " — бесплатно и без подписки"),
          li(bold("Подборка горячих клавиш"), " — ускоряет работу в редакторе вдвое"),
        ],
      },
      p(italic("Сохраняйте, чтобы не потерять 📎")),
    ),
  },
  {
    id: "__example-faq",
    name: "Ответы на частые вопросы",
    category: "other",
    technique: "Сворачиваемые блоки-спойлеры держат ленту компактной, пока не понадобятся детали",
    contentJson: doc(
      heading(2, "❓ Отвечаем на частые вопросы"),
      p("Собрали то, о чём чаще всего спрашивают в комментариях."),
      {
        type: "blockFaq",
        attrs: {
          question: "Как отменить подписку?",
          answer: "<p>Откройте <b>Настройки → Подписка</b> и нажмите «Отменить». Доступ сохранится до конца оплаченного периода.</p>",
        },
      },
      {
        type: "blockFaq",
        attrs: {
          question: "Можно ли вернуть деньги?",
          answer: "<p>Да, в течение <b>14 дней</b> с момента оплаты — просто напишите в поддержку.</p>",
        },
      },
    ),
  },
  {
    // Mirrors the sales-bot's own /demo command (sales-bot/supabase/functions/
    // sales-bot/index.ts, handleDemo) block-for-block where possible, so a
    // user who saw that live demo in Telegram gets the same post inside the
    // app. The four demo photos (collage + slideshow) are bundled as real
    // local assets — see `assets` below and SHOWCASE_ASSETS above — the
    // audio player is the one thing still not reproduced, same reason
    // (needs a real attached file) but nobody's asked for that one yet.
    id: "__example-showcase",
    name: "Витрина блоков Rich-режима",
    category: "other",
    technique: "То же демо, что бот присылает по команде /demo — один пост, все текстовые/структурные блоки сразу",
    assets: SHOWCASE_ASSETS,
    contentJson: doc(
      { type: "anchorPoint" },
      heading(2, "🎨 Витрина возможностей Rich-режима"),
      p("Так выглядит пост, собранный в Telegram Studio из блоков — без единой строчки HTML или Markdown."),
      p(bold("жирный"), " ", italic("курсив"), " ", underline("подчёркнутый"), " ", strike("зачёркнутый"), " ", spoiler("спойлер"), " ", highlight("маркер"), " и ", inlineCode("инлайн-код")),
      quote(false, p("Обычная цитата — для пояснений и врезок.")),
      quote(false,
        p(bold("Форматирование"), " работает и внутри цитаты"),
        quote(false, p("а внутри неё — ещё одна, вложенная")),
      ),
      check(true, "Собрать пост в редакторе"),
      check(false, "Опубликовать в канал"),
      {
        type: "orderedList",
        content: [
          li("Открыть редактор"),
          li("Собрать пост из блоков"),
          li("Нажать «Опубликовать»"),
        ],
      },
      {
        type: "codeBlock",
        attrs: { language: "javascript" },
        content: [{ type: "text", text: 'console.log("Привет, Telegram!");' }],
      },
      quote(true, p("Раскрывающийся текст — нажмите, чтобы посмотреть. Удобно для пояснений, которые не нужно показывать сразу всем.")),
      p("Фото собираются в коллаж:"),
      img("demo-collage-1", "collage"),
      img("demo-collage-2", "collage"),
      p("Или в слайд-шоу, если снимков много и их удобнее пролистывать:"),
      img("demo-slide-1", "slideshow"),
      img("demo-slide-2", "slideshow"),
      p("Карта — например, для анонса локации мероприятия:"),
      { type: "blockMap", attrs: { lat: 55.7558, long: 37.6173, zoom: 15 } },
      p("И формулы, если вдруг это техническая статья:"),
      { type: "blockFormula", attrs: { expression: "E = mc^2" } },
      {
        type: "blockTable",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { header: true }, content: [{ type: "text", text: "Блок" }] },
              { type: "tableCell", attrs: { header: true }, content: [{ type: "text", text: "Поддержка" }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "Фото, видео, аудио, коллажи, слайд-шоу" }] },
              { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "Да" }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "Таблицы, чек-листы, код, раскрывающийся текст" }] },
              { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "Да" }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "Карты, формулы (LaTeX)" }] },
              { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "Да" }] },
            ],
          },
        ],
      },
      quote(false, p("💡 Всё это собирается визуально, перетаскиванием блоков — редактор сам превращает их в нужную разметку.")),
      p("А ссылки в тексте — обычным словом, без некрасивого URL целиком: ", link("вот так", "https://telegram.org"), "."),
      p("И «Лифт» — для длинных постов, мгновенный переход наверх без прокрутки: ", link("👆 Лифт", "#top")),
    ),
  },
];

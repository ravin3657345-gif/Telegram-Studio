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

export interface ExampleTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  /** One-line note on the copywriting technique this example demonstrates. */
  technique: string;
  contentJson: string;
}

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
const li = (...runs: Array<string | { text: string; marks: unknown[] }>) => ({
  type: "listItem",
  content: [p(...runs)],
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
];

// Продающий бот для Telegram Studio — webhook-версия bot.mjs (см. sales-bot/bot.mjs
// для истории/референса — этот файл его функциональный порт). Принимает оплату
// Telegram Stars, сам генерирует лицензионный ключ (порт keygen.exe /
// src-tauri/core/src/license.rs::generate_key на TS) и присылает покупателю
// ключ + установщик.
//
// В отличие от bot.mjs — никакого long polling, синглтон-лока, локальных
// файлов. Каждый вызов — отдельный HTTP-запрос от Telegram (webhook), без
// памяти между вызовами: всё персистентное состояние (леджер продаж, конфиг,
// лог, "незавершённая рассылка") — в Postgres (public.sales_ledger,
// public.bot_config, public.bot_log), файлы — в Storage bucket sales-assets.
//
// Секреты (Dashboard → Edge Functions → sales-bot → Secrets):
//   TELEGRAM_BOT_TOKEN   — токен от @BotFather
//   TELEGRAM_WEBHOOK_SECRET — произвольная строка, та же, что передаётся
//                             setWebhook(secret_token=...) — проверяется на
//                             каждый запрос, иначе кто угодно с интернета
//                             мог бы POST-нуть поддельный successful_payment
//                             и получить лицензию бесплатно.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — подставляются Supabase
//   автоматически для каждой Edge Function, задавать вручную не нужно.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;

const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const BUCKET = "sales-assets";

// ── Postgres (PostgREST) — service_role, bypasses RLS, как и keygen.exe ──

async function sb(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase REST ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res;
}

function publicUrl(objectPath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}

// ── Конфиг бота (public.bot_config, одна строка) ─────────────────────────

interface BotConfig {
  stars_price: number;
  rub_per_star: number;
  admin_chat_id: string;
  support_contact: string;
  pending_broadcast: string | null;
  latest_installer_version: string | null;
}

async function getConfig(): Promise<BotConfig> {
  const res = await sb("bot_config?select=*&id=eq.true");
  const rows = await res.json();
  return rows[0];
}

async function setPendingBroadcast(text: string | null) {
  await sb("bot_config?id=eq.true", {
    method: "PATCH",
    body: JSON.stringify({ pending_broadcast: text }),
  });
}

// admin_chat_id может содержать несколько ID через запятую (несколько
// администраторов) — CSV-строка вместо схемы, чтобы не трогать колонку/
// control-panel (там обычное текстовое поле, спокойно принимает "id1,id2").
function adminChatIds(config: BotConfig): string[] {
  return (config.admin_chat_id || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAdmin(config: BotConfig, chatId: number | string): boolean {
  return adminChatIds(config).includes(String(chatId));
}

// ── Лог (public.bot_log) — консоль (видна в Dashboard → Functions → Logs) +
// таблица (для /log у админа и вкладки Logs в control-panel) ────────────

async function log(...args: unknown[]) {
  const line = args.map(String).join(" ");
  console.log(line);
  try {
    await sb("bot_log", { method: "POST", body: JSON.stringify({ message: line }) });
  } catch (err) {
    console.error("Не удалось записать в bot_log:", err);
  }
}

function logError(...args: unknown[]) {
  return log("ОШИБКА:", ...args);
}

// ── Telegram Bot API ──────────────────────────────────────────────────────

async function api(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) await logError(`${method} failed:`, JSON.stringify(data));
  return data;
}

// Фото/аудио шлём прямыми публичными Storage-URL — Telegram сам их скачивает
// на своей стороне, работает для обычных медиа-расширений (подтверждено
// тестами: .png/.zip/.pdf проходят через sendDocument по URL).
async function sendDocument(chatId: number | string, url: string, caption?: string) {
  return api("sendDocument", { chat_id: chatId, document: url, caption });
}

// Установщик — ИСКЛЮЧЕНИЕ: Telegram отказывается фетчить .exe/.msi по URL
// вообще ("failed to get HTTP URL content"), подтверждено прямым тестом
// against живого Bot API — это, судя по всему, осознанная защита от раздачи
// малвари через ботов, не зависит от Content-Type. Поэтому для установщика,
// в отличие от остальных файлов, качаем байты сами (Storage → Deno fetch) и
// шлём multipart'ом — то же самое, что делал bot.mjs с локальным диском,
// просто источник байтов другой.
async function sendInstallerDocument(chatId: number | string, version: string, caption: string) {
  const filename = `Telegram-Studio-${version}-x64.msi`;
  const fileRes = await fetch(publicUrl(`installers/${filename}`));
  if (!fileRes.ok) {
    await logError(`Не удалось скачать установщик из Storage: HTTP ${fileRes.status}`);
    return { ok: false };
  }
  const blob = await fileRes.blob();
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", caption);
  form.append("document", blob, filename);
  const res = await fetch(`${TG_API}/sendDocument`, { method: "POST", body: form });
  const data = await res.json();
  if (!data.ok) await logError("sendDocument (installer) failed:", JSON.stringify(data));
  return data;
}

async function sendMediaGroup(chatId: number | string, items: { url: string; caption?: string }[]) {
  const media = items.map((item, i) => ({
    type: "photo",
    media: item.url,
    ...(i === 0 && item.caption ? { caption: item.caption } : {}),
  }));
  return api("sendMediaGroup", { chat_id: chatId, media });
}

// ── Генерация лицензионного ключа — порт generate_key()/base32_encode() из
// src-tauri/core/src/license.rs:11,28-43,85-90. Тот же алфавит (без 0/O/1/I),
// тот же битовый алгоритм — JS-битовые операторы усекают до 32 бит точно так
// же, как Rust u32, так что результат побитово идентичен. ───────────────

const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const KEY_BYTES = 10;

function base32Encode(data: Uint8Array): string {
  let out = "";
  let bits = 0;
  let bitCount = 0;
  for (const byte of data) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      out += CHARSET[(bits >> bitCount) & 0x1f];
    }
  }
  if (bitCount > 0) {
    out += CHARSET[(bits << (5 - bitCount)) & 0x1f];
  }
  return out;
}

function generateKeyRaw(): string {
  const bytes = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

// Та же группировка по 4 символа через дефис, что format_for_display() в
// keygen/src/main.rs:20-26.
function formatForDisplay(key: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < key.length; i += 4) chunks.push(key.slice(i, i + 4));
  return chunks.join("-");
}

// Регистрирует ключ в public.licenses — тот же INSERT, что делает
// register_key() в keygen/src/main.rs:38-55.
async function generateLicenseKey(telegramId: number): Promise<string> {
  const raw = generateKeyRaw();
  await sb("licenses", {
    method: "POST",
    body: JSON.stringify({ key: raw, buyer_telegram_id: telegramId }),
  });
  return formatForDisplay(raw);
}

// ── Продажи (public.sales_ledger) ────────────────────────────────────────

async function logSale(from: { id: number; username?: string; first_name?: string }, starsAmount: number, key: string, chargeId: string) {
  await sb("sales_ledger", {
    method: "POST",
    body: JSON.stringify({
      user_id: from.id,
      username: from.username ?? "",
      first_name: from.first_name ?? "",
      stars: starsAmount,
      key,
      charge_id: chargeId,
    }),
  });
}

// Идемпотентность: Telegram может доставить successful_payment повторно —
// ищем уже выданный ключ по charge_id (UNIQUE в sales_ledger) вместо
// генерации нового, чтобы один платёж не дал два ключа.
async function findExistingSale(chargeId: string): Promise<string | null> {
  const res = await sb(`sales_ledger?select=key&charge_id=eq.${encodeURIComponent(chargeId)}`);
  const rows = await res.json();
  return rows[0]?.key ?? null;
}

async function findSalesByUser(userId: number | string): Promise<{ createdAt: string; key: string }[]> {
  const res = await sb(`sales_ledger?select=created_at,key&user_id=eq.${userId}&order=created_at.desc`);
  const rows = await res.json();
  return rows.map((r: { created_at: string; key: string }) => ({ createdAt: r.created_at, key: r.key }));
}

async function uniqueBuyerIds(): Promise<string[]> {
  const res = await sb("sales_ledger?select=user_id");
  const rows: { user_id: number }[] = await res.json();
  return [...new Set(rows.map((r) => String(r.user_id)))];
}

// ── Установщик — bot_config.latest_installer_version + фиксированная схема
// имён в Storage (installers/Telegram-Studio-<version>-x64.msi). Обновляется
// control-panel при заливке новой сборки (см. upload_installer_to_storage). ─


// ── Скриншоты / демо — статичные файлы, публичные URL, без TTL-хостинга ─

const SCREENSHOTS = [
  { file: "02_editor_example.png", caption: "Редактор постов: заголовок, форматирование, живое превью справа — точь-в-точь как в Telegram" },
  { file: "06_drag_drop.png", caption: "Перетащите нужный блок из панели прямо в пост — таблица, чек-лист, опрос, аудио и другие" },
  { file: "04_rich_mode.png", caption: "Rich-режим — расширенные посты (Bot API 10.1): коллажи, слайд-шоу, вложенные цитаты" },
  { file: "05_rich_publish.png", caption: "Готовый Rich-пост с заголовками и списком — именно так он придёт подписчикам" },
  { file: "07_rich_with_image.png", caption: "Изображения прямо внутри форматированного текста, а не отдельным вложением" },
  { file: "03_templates.png", caption: "Готовые шаблоны — не начинать с чистого листа каждый раз" },
  { file: "01_editor.png", caption: "Блочный конструктор поста: заголовки, списки, чек-листы, код, аудио, видео, файлы" },
];

const BUY_KEYBOARD = { inline_keyboard: [[{ text: "💳 Купить", callback_data: "buy" }]] };
const MAIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: "📸 Скриншоты", callback_data: "screenshots" }, { text: "💳 Купить", callback_data: "buy" }],
    [{ text: "❓ Как это работает", callback_data: "help" }, { text: "🔑 Мой ключ", callback_data: "mykey" }],
    [{ text: "🎬 Демо Rich-режима", callback_data: "demo" }, { text: "📥 Обновление", callback_data: "update" }],
  ],
};

// Постоянная клавиатура под полем ввода (Reply Keyboard) — второй, отдельный
// от MAIN_KEYBOARD слой навигации. В отличие от инлайн-кнопок (привязаны к
// одному сообщению, "уезжают" вверх по мере переписки), эта висит всегда,
// пока её явно не убрать. Один sendMessage может нести только ОДИН тип
// reply_markup — inline_keyboard и keyboard нельзя совместить в одном
// сообщении, поэтому она отправляется отдельным коротким сообщением следом
// за основным текстом /start (см. handleStart). Нажатие такой кнопки просто
// присылает её текст как обычное сообщение от пользователя — сравнение по
// точному тексту в handleUpdate ниже, как с /command-ами.
const REPLY_KEYBOARD = {
  keyboard: [
    [{ text: "💳 Купить" }],
    [{ text: "📸 Скриншоты" }, { text: "🎬 Демо" }, { text: "🔑 Мой ключ" }],
    [{ text: "❓ Как это работает" }, { text: "📥 Обновление" }],
  ],
  resize_keyboard: true,
};

// ── Хендлеры покупателя ──────────────────────────────────────────────────

async function handleStart(chatId: number) {
  await log(`/start от chat ${chatId}`);
  await api("sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text:
      "✨ <b>Telegram Studio</b> — как выглядит пост, если собирать его по-настоящему, а не в одно текстовое поле.\n\n" +
      "🧩 <b>Блочный редактор.</b> Заголовки, списки, чек-листы, цитаты, таблицы, код, карты, формулы — перетащили блок из панели, дальше пост собирается сам. Живое превью показывает готовый результат.\n\n" +
      "🎬 <b>Rich-режим.</b> Коллажи, слайд-шоу, аудио, карты, формулы — форматы, которых вообще нет в обычной отправке сообщений.\n\n" +
      "📋 <b>Шаблоны и черновики.</b> Собрали формат один раз — дальше автосейв, без риска потерять текст.\n\n" +
      "⏰ <b>Планирование.</b> Указали дату и время — Telegram Studio опубликует сам.\n\n" +
      "🔒 <b>Всё локально.</b> Ни сервера, ни аналитики, ни доступа к вашим данным — работает на вашем компьютере.\n\n" +
      "💳 <b>Разовая покупка.</b> Заплатили один раз — программа остаётся с вами. Важные обновления бот пришлёт сам, как только выйдут.\n\n" +
      "👇 Посмотрите живое демо Rich-режима кнопкой ниже — займёт 10 секунд.",
    reply_markup: MAIN_KEYBOARD,
  });
  await api("sendMessage", {
    chat_id: chatId,
    text: "Меню всегда под рукой ⬇️",
    reply_markup: REPLY_KEYBOARD,
  });
}

async function handleScreenshots(chatId: number) {
  await log(`Скриншоты для chat ${chatId}`);
  const items = SCREENSHOTS.map((s) => ({ url: publicUrl(`screenshots/${s.file}`), caption: s.caption }));
  await sendMediaGroup(chatId, items);
  await api("sendMessage", { chat_id: chatId, text: "Готовы попробовать?", reply_markup: BUY_KEYBOARD });
}

async function handleMyKey(chatId: number, userId: number, config: BotConfig) {
  await log(`Запрос ключа для user ${userId}`);
  const sales = await findSalesByUser(userId);
  if (sales.length === 0) {
    await api("sendMessage", {
      chat_id: chatId,
      text: `Не нашёл покупок на этот аккаунт. Если вы покупали лицензию под другим Telegram-аккаунтом — напишите ${config.support_contact}.`,
      reply_markup: BUY_KEYBOARD,
    });
    return;
  }
  const formatDate = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const text =
    sales.length === 1
      ? `Ваш ключ активации:\n\n${sales[0].key}\n\nКуплен ${formatDate(sales[0].createdAt)}. Вставьте его в поле активации при первом запуске приложения.`
      : `Ваши ключи активации:\n\n${sales.map((s, i) => `${i + 1}. ${s.key} (куплен ${formatDate(s.createdAt)})`).join("\n")}\n\nВставьте нужный в поле активации при первом запуске приложения.`;
  await api("sendMessage", { chat_id: chatId, text });
}

async function handleGetUpdate(chatId: number, userId: number, config: BotConfig) {
  await log(`Запрос установщика для user ${userId}`);
  const sales = await findSalesByUser(userId);
  if (sales.length === 0) {
    await api("sendMessage", {
      chat_id: chatId,
      text: `Установщик доступен только покупателям — не нашёл покупок на этот аккаунт. Если вы покупали лицензию под другим Telegram-аккаунтом — напишите ${config.support_contact}.`,
      reply_markup: BUY_KEYBOARD,
    });
    return;
  }
  if (!config.latest_installer_version) {
    await api("sendMessage", { chat_id: chatId, text: `Не нашёл установщик — напишите ${config.support_contact} напрямую.` });
    return;
  }
  await sendInstallerDocument(chatId, config.latest_installer_version, "Установщик Telegram Studio (Windows)");
}

async function handleDemo(chatId: number) {
  await log(`Демо Rich-режима для chat ${chatId}`);
  await api("sendMessage", { chat_id: chatId, text: "Собираю демо-пост… это займёт пару секунд." });
  try {
    const img1 = publicUrl("demo/demo_collage1.jpg");
    const img2 = publicUrl("demo/demo_collage2.jpg");
    const img3 = publicUrl("demo/demo_slide1.jpg");
    const img4 = publicUrl("demo/demo_slide2.jpg");
    const audioUrl = publicUrl("demo/demo_audio.mp3");

    const html =
      '<a name="top"></a>' +
      "<h2>Демо Rich-режима</h2>" +
      "<p>Так выглядит пост, собранный в Telegram Studio из блоков — без единой строчки HTML или Markdown.</p>" +
      "<p><b>жирный</b> <i>курсив</i> <u>подчёркнутый</u> <s>зачёркнутый</s> <tg-spoiler>спойлер</tg-spoiler> <mark>маркер</mark> и <code>инлайн-код</code></p>" +
      "<blockquote>Обычная цитата — для пояснений и врезок, с подписью автора.<cite>Редакция</cite></blockquote>" +
      "<blockquote>Цитата с <b>форматированием</b> внутри<blockquote>а внутри неё — ещё одна, вложенная</blockquote></blockquote>" +
      "<p>А выносная цитата — крупнее и по центру, для эффектных высказываний:</p>" +
      "<aside>Лучший способ предсказать будущее — создать его самому.<cite>Питер Друкер</cite></aside>" +
      "<ul><li><input type=\"checkbox\" checked>Собрать пост в редакторе</li><li><input type=\"checkbox\">Опубликовать в канал</li></ul>" +
      "<ol><li>Открыть редактор</li><li>Собрать пост из блоков</li><li>Нажать «Опубликовать»</li></ol>" +
      "<pre><code>console.log(\"Привет, Telegram!\");</code></pre>" +
      "<details><summary>Раскрывающийся текст — нажмите, чтобы посмотреть</summary>Удобно для пояснений, которые не нужно показывать сразу всем.</details>" +
      "<p>Фото собираются в коллаж:</p>" +
      `<tg-collage><img src="${img1}"/><img src="${img2}"/></tg-collage>` +
      "<p>Или в слайд-шоу, если снимков много и их удобнее пролистывать:</p>" +
      `<tg-slideshow><img src="${img3}"/><img src="${img4}"/></tg-slideshow>` +
      "<p>Аудио — отдельным плеером прямо в посте:</p>" +
      `<audio src="${audioUrl}"></audio>` +
      "<p>Карта — например, для анонса локации мероприятия:</p>" +
      '<tg-map lat="55.7558" long="37.6173" zoom="15"></tg-map>' +
      "<p>И формулы, если вдруг это техническая статья:</p>" +
      "<tg-math-block>E = mc^2</tg-math-block>" +
      "<table bordered><tr><th>Блок</th><th>Поддержка</th></tr><tr><td>Фото, видео, аудио, коллажи, слайд-шоу</td><td>Да</td></tr><tr><td>Таблицы, чек-листы, код, раскрывающийся текст</td><td>Да</td></tr><tr><td>Карты, формулы (LaTeX)</td><td>Да</td></tr><tr><td>Выносная цитата, подпись автора у цитаты</td><td>Да</td></tr></table>" +
      "<blockquote>💡 Всё это собирается визуально, перетаскиванием блоков — редактор сам превращает их в нужную разметку.</blockquote>" +
      '<p>А ссылки в тексте — обычным словом, без некрасивого URL целиком: <a href="https://telegram.org">вот так</a>.</p>' +
      '<p>И «Лифт» — для длинных постов, мгновенный переход наверх без прокрутки: <a href="#top">👆 Лифт</a></p>';

    await api("sendRichMessage", { chat_id: chatId, rich_message: { html } });
    await api("sendMessage", { chat_id: chatId, text: "Это был реальный Rich-пост. Хотите собрать свой?", reply_markup: BUY_KEYBOARD });
  } catch (err) {
    await logError("Демо Rich-режима не удалось:", err instanceof Error ? err.stack : err);
    await api("sendMessage", { chat_id: chatId, text: "Не получилось собрать демо — попробуйте ещё раз чуть позже." });
  }
}

async function handleHelp(chatId: number, config: BotConfig) {
  await log(`/help от chat ${chatId}`);
  await api("sendMessage", {
    chat_id: chatId,
    text:
      "Как это работает:\n" +
      "1. Нажимаете «Купить» — открывается счёт в Telegram Stars.\n" +
      "2. Сразу после оплаты бот присылает лицензионный ключ и установщик (.msi, Windows x64).\n" +
      "3. При первом запуске приложения вставляете ключ в окно активации — готово, дальше всё работает офлайн.\n\n" +
      "Полезно знать:\n" +
      "• Ключ активируется один раз и привязывается к вашему устройству — при переустановке Windows просто введите тот же ключ снова, он подойдёт. На другом компьютере он уже не сработает.\n" +
      "• Потеряли ключ? Пришлю его снова: /mykey или кнопка «🔑 Мой ключ».\n" +
      "• Хотите увидеть Rich-режим в деле — не на скриншоте, а живым сообщением? /demo.\n" +
      "• Вышло обновление, а установщик потеряли? /update пришлёт последнюю версию (только покупателям).\n" +
      `• Если что-то пошло не так — напишите ${config.support_contact} напрямую.\n\n` +
      "Команды: /start — об приложении, /buy — купить лицензию, /mykey — прислать мой ключ ещё раз, /demo — живой пример Rich-поста, /update — прислать последний установщик. Кнопка «📸 Скриншоты» в /start покажет интерфейс.",
  });
}

async function handleBuy(chatId: number, config: BotConfig) {
  await log(`Выставляю счёт на ${config.stars_price} Stars для chat ${chatId}`);
  await api("sendInvoice", {
    chat_id: chatId,
    title: "Telegram Studio — лицензия",
    description: "Лицензионный ключ активации Telegram Studio (десктоп, Windows). Разовая покупка, без подписки.",
    payload: `license-${chatId}-${Date.now()}`,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: "Лицензия Telegram Studio", amount: config.stars_price }],
  });
}

async function handlePreCheckout(query: { id: string; from: { id: number; username?: string } }) {
  await log(`Pre-checkout от ${query.from.username ?? query.from.id} — подтверждаю`);
  await api("answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok: true });
}

interface SuccessfulPaymentMessage {
  chat: { id: number };
  from: { id: number; username?: string; first_name?: string };
  successful_payment: { total_amount: number; telegram_payment_charge_id: string };
}

async function handleSuccessfulPayment(message: SuccessfulPaymentMessage, config: BotConfig) {
  const chatId = message.chat.id;
  const payment = message.successful_payment;
  const chargeId = payment.telegram_payment_charge_id;
  await log(`Оплата получена: ${payment.total_amount} Stars от ${message.from.username ?? message.from.id} (charge ${chargeId}) — генерирую ключ`);
  try {
    const existingKey = await findExistingSale(chargeId);
    const isRedelivery = existingKey !== null;
    let key: string;
    if (isRedelivery) {
      key = existingKey!;
      await log(`Повторная доставка апдейта по уже обработанной оплате (charge ${chargeId}) — переиспользую выданный ключ`);
    } else {
      key = await generateLicenseKey(message.from.id);
      await log(`Ключ сгенерирован: ${key}`);
      await logSale(message.from, payment.total_amount, key, chargeId);
    }

    await api("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text:
        "✅ <b>Оплата прошла успешно!</b>\n\n" +
        "🔑 Ваш ключ активации:\n" +
        `<code>${key}</code>\n\n` +
        "Вставьте его в поле активации при первом запуске приложения — и всё готово.",
    });

    if (config.latest_installer_version) {
      await sendInstallerDocument(chatId, config.latest_installer_version, "Установщик Telegram Studio (Windows)");
    } else {
      await api("sendMessage", { chat_id: chatId, text: `Не нашёл установщик — напишите ${config.support_contact} напрямую.` });
    }

    await api("sendMessage", {
      chat_id: chatId,
      text: "Если нужна ещё одна лицензия (например, в подарок) — можно купить снова:",
      reply_markup: BUY_KEYBOARD,
    });
    await log("Заказ выполнен.");

    if (!isRedelivery) {
      const buyer = message.from.username ? `@${message.from.username}` : String(message.from.id);
      await notifyAdmin(config, `💰 Продажа: ${payment.total_amount} Stars от ${buyer}\nКлюч: ${key}`);
    }
  } catch (err) {
    await logError("Fulfilment failed:", err instanceof Error ? err.stack : err);
    await api("sendMessage", {
      chat_id: chatId,
      text: `Оплата прошла, но при выдаче ключа произошла ошибка — напишите ${config.support_contact} напрямую, разберёмся вручную.`,
    });
    const buyer = message.from.username ? `@${message.from.username}` : String(message.from.id);
    await notifyAdmin(
      config,
      `⚠️ Оплата ${payment.total_amount} Stars от ${buyer} (charge ${chargeId}) прошла, но выдача ключа упала: ${err instanceof Error ? err.message : err}\nНужно выдать ключ вручную!`
    );
  }
}

async function notifyAdmin(config: BotConfig, text: string) {
  for (const chatId of adminChatIds(config)) {
    try {
      await api("sendMessage", { chat_id: chatId, text });
    } catch (err) {
      await logError("notifyAdmin failed:", err);
    }
  }
}

// ── Мини-панель управления в Telegram (для admin_chat_id) ────────────────

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function handleAdminStatus(chatId: number, config: BotConfig) {
  const res = await sb("sales_ledger?select=stars,user_id");
  const rows: { stars: number; user_id: number }[] = await res.json();
  const totalStars = rows.reduce((sum, r) => sum + (r.stars || 0), 0);
  const uniqueBuyers = new Set(rows.map((r) => r.user_id)).size;
  const balance = await api("getMyStarBalance", {});
  const balanceText = balance.ok ? `${balance.result.amount} ⭐` : "не удалось получить";
  await api("sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text:
      "<b>Статус бота</b> (Supabase Edge Function)\n\n" +
      `Продаж всего: ${rows.length} (${uniqueBuyers} уникальных покупателей)\n` +
      `Начислено Stars за всё время: ${totalStars}\n` +
      `Баланс на счету бота: ${balanceText}\n` +
      `Актуальный установщик: ${config.latest_installer_version ? `v${config.latest_installer_version}` : "не найден"}`,
  });
}

async function handleAdminSales(chatId: number) {
  const res = await sb("sales_ledger?select=created_at,username,user_id,stars&order=created_at.desc&limit=10");
  const rows: { created_at: string; username: string; user_id: number; stars: number }[] = await res.json();
  if (rows.length === 0) {
    await api("sendMessage", { chat_id: chatId, text: "Продаж пока нет." });
    return;
  }
  const formatDate = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const text =
    "<b>Последние продажи</b> (не больше 10)\n\n" +
    rows.map((r) => {
      const buyer = r.username ? `@${escapeHtml(r.username)}` : r.user_id;
      return `${formatDate(r.created_at)} — ${buyer} — ${r.stars}⭐`;
    }).join("\n");
  await api("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
}

async function handleAdminLog(chatId: number) {
  const res = await sb("bot_log?select=created_at,message&order=id.desc&limit=20");
  const rows: { created_at: string; message: string }[] = await res.json();
  if (rows.length === 0) {
    await api("sendMessage", { chat_id: chatId, text: "Лог пока пуст." });
    return;
  }
  let body = rows.reverse().map((r) => r.message).join("\n");
  const MAX_BODY = 3500;
  if (body.length > MAX_BODY) body = "…" + body.slice(body.length - MAX_BODY);
  await api("sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: `<b>Хвост лога</b> (последние ${rows.length} строк)\n\n<pre>${escapeHtml(body)}</pre>`,
  });
}

async function handleAdminInstallers(chatId: number, config: BotConfig) {
  if (!config.latest_installer_version) {
    await api("sendMessage", { chat_id: chatId, text: "Установщик не найден." });
    return;
  }
  await api("sendMessage", { chat_id: chatId, text: `⭐ Актуальный установщик: v${config.latest_installer_version}` });
}

async function handleAdminGetBuild(chatId: number, config: BotConfig) {
  if (!config.latest_installer_version) {
    await api("sendMessage", { chat_id: chatId, text: "Не нашёл установщик." });
    return;
  }
  await log(`Отправляю установщик админу (без проверки покупки): v${config.latest_installer_version}`);
  await sendInstallerDocument(chatId, config.latest_installer_version, `Тестовая сборка: v${config.latest_installer_version}`);
}

// Ключ без оплаты — только для администраторов (например, чтобы выдать себе
// лицензию на второй компьютер). Сознательно НЕ пишет строку в sales_ledger:
// это не продажа, а sales_ledger — источник правды для /mykey и статистики.
// Ключ всё равно попадает в public.licenses и активируется как обычно.
async function handleAdminFreeKey(chatId: number) {
  await log(`Бесплатный ключ для admin (chat ${chatId})`);
  try {
    const key = await generateLicenseKey(chatId);
    await api("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: `🔑 Ключ без оплаты:\n\n<code>${key}</code>\n\nНе учтён в статистике продаж — это личный ключ, не покупка.`,
    });
  } catch (err) {
    await logError("handleAdminFreeKey failed:", err instanceof Error ? err.stack : err);
    await api("sendMessage", { chat_id: chatId, text: "Не получилось сгенерировать ключ, смотри /log." });
  }
}

async function handleAdminBroadcastStart(chatId: number, text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    await api("sendMessage", { chat_id: chatId, text: "Использование: /broadcast текст сообщения для рассылки покупателям" });
    return;
  }
  const buyerCount = (await uniqueBuyerIds()).length;
  if (buyerCount === 0) {
    await api("sendMessage", { chat_id: chatId, text: "Покупателей пока нет — рассылать некому." });
    return;
  }
  await setPendingBroadcast(trimmed);
  await api("sendMessage", {
    chat_id: chatId,
    text: `Разослать ${buyerCount} покупателям:\n\n${trimmed}`,
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Отправить", callback_data: "broadcast_confirm" },
        { text: "❌ Отмена", callback_data: "broadcast_cancel" },
      ]],
    },
  });
}

async function runPendingBroadcast(chatId: number, config: BotConfig) {
  if (!config.pending_broadcast) return;
  const text = config.pending_broadcast;
  await setPendingBroadcast(null);
  const ids = await uniqueBuyerIds();
  let sent = 0;
  for (let i = 0; i < ids.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 50));
    const res = await api("sendMessage", {
      chat_id: ids[i],
      text,
      reply_markup: { inline_keyboard: [[{ text: "📥 Скачать обновление", callback_data: "update" }]] },
    });
    if (res.ok) sent++;
  }
  await api("sendMessage", {
    chat_id: chatId,
    text: `Рассылка завершена: отправлено ${sent} из ${ids.length}${sent < ids.length ? `, не удалось ${ids.length - sent}` : ""}.`,
  });
}

// ── Диспетчер ─────────────────────────────────────────────────────────────

interface CallbackQuery {
  id: string;
  data: string;
  from: { id: number; username?: string };
  message: { chat: { id: number }; message_id: number };
}

async function handleCallbackQuery(query: CallbackQuery, config: BotConfig) {
  await log(`Нажата кнопка "${query.data}" от ${query.from.username ?? query.from.id}`);
  const chatId = query.message.chat.id;
  await Promise.all([
    api("answerCallbackQuery", { callback_query_id: query.id }),
    api("deleteMessage", { chat_id: chatId, message_id: query.message.message_id }),
  ]);
  if (query.data === "buy") return handleBuy(chatId, config);
  if (query.data === "screenshots") return handleScreenshots(chatId);
  if (query.data === "help") return handleHelp(chatId, config);
  if (query.data === "mykey") return handleMyKey(chatId, query.from.id, config);
  if (query.data === "demo") return handleDemo(chatId);
  if (query.data === "update") return handleGetUpdate(chatId, query.from.id, config);
  if (query.data === "broadcast_confirm" && isAdmin(config, chatId)) return runPendingBroadcast(chatId, config);
  if (query.data === "broadcast_cancel" && isAdmin(config, chatId)) {
    await setPendingBroadcast(null);
    return api("sendMessage", { chat_id: chatId, text: "Рассылка отменена." });
  }
}

// deno-lint-ignore no-explicit-any
async function handleUpdate(update: any, config: BotConfig) {
  if (update.message?.text === "/start") return handleStart(update.message.chat.id);
  if (update.message?.text === "/buy") return handleBuy(update.message.chat.id, config);
  if (update.message?.text === "/help") return handleHelp(update.message.chat.id, config);
  if (update.message?.text === "/mykey") return handleMyKey(update.message.chat.id, update.message.from.id, config);
  if (update.message?.text === "/demo") return handleDemo(update.message.chat.id);
  if (update.message?.text === "/update") return handleGetUpdate(update.message.chat.id, update.message.from.id, config);
  if (update.message?.text === "/status" && isAdmin(config, update.message.chat.id)) return handleAdminStatus(update.message.chat.id, config);
  if (update.message?.text === "/sales" && isAdmin(config, update.message.chat.id)) return handleAdminSales(update.message.chat.id);
  if (update.message?.text === "/log" && isAdmin(config, update.message.chat.id)) return handleAdminLog(update.message.chat.id);
  if (update.message?.text === "/installers" && isAdmin(config, update.message.chat.id)) return handleAdminInstallers(update.message.chat.id, config);
  if (update.message?.text === "/mybuild" && isAdmin(config, update.message.chat.id)) return handleAdminGetBuild(update.message.chat.id, config);
  if (update.message?.text === "/freekey" && isAdmin(config, update.message.chat.id)) return handleAdminFreeKey(update.message.chat.id);
  if (update.message?.text?.startsWith("/broadcast") && isAdmin(config, update.message.chat.id)) {
    return handleAdminBroadcastStart(update.message.chat.id, update.message.text.slice("/broadcast".length));
  }
  // Нажатия постоянной клавиатуры (REPLY_KEYBOARD) — Telegram присылает их
  // как обычный текст сообщения, сравниваем по точному совпадению с кнопкой.
  if (update.message?.text === "💳 Купить") return handleBuy(update.message.chat.id, config);
  if (update.message?.text === "📸 Скриншоты") return handleScreenshots(update.message.chat.id);
  if (update.message?.text === "🎬 Демо") return handleDemo(update.message.chat.id);
  if (update.message?.text === "🔑 Мой ключ") return handleMyKey(update.message.chat.id, update.message.from.id, config);
  if (update.message?.text === "❓ Как это работает") return handleHelp(update.message.chat.id, config);
  if (update.message?.text === "📥 Обновление") return handleGetUpdate(update.message.chat.id, update.message.from.id, config);
  if (update.callback_query) return handleCallbackQuery(update.callback_query, config);
  if (update.pre_checkout_query) return handlePreCheckout(update.pre_checkout_query);
  if (update.message?.successful_payment) return handleSuccessfulPayment(update.message, config);
}

// ── HTTP-вход ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  // Проверка секрета webhook'а — без неё этот публичный URL мог бы принять
  // поддельный successful_payment от кого угодно и выдать бесплатную
  // лицензию. Секрет задаётся при setWebhook(secret_token=...).
  const secretHeader = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secretHeader !== WEBHOOK_SECRET) {
    return new Response("Forbidden", { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  try {
    const config = await getConfig();
    await handleUpdate(update, config);
  } catch (err) {
    await logError("handleUpdate failed:", err instanceof Error ? err.stack : err);
  }

  // Telegram ждёт 200 максимум за ~несколько секунд, иначе повторяет доставку —
  // мы уже всё обработали синхронно выше, просто подтверждаем получение.
  return new Response("OK", { status: 200 });
});

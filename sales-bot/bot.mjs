// Продающий бот для Telegram Studio — принимает оплату Telegram Stars,
// сам генерирует лицензионный ключ (через уже существующий keygen.exe) и
// сразу присылает покупателю ключ + установщик. Отдельный инструмент,
// не часть самого продукта — можно останавливать/менять без пересборки
// приложения.
//
// Запуск (вручную, разово):
//   $env:SALES_BOT_TOKEN = "12345:AAAA..."   (токен от @BotFather)
//   node sales-bot/bot.mjs
//
// Запуск с автоматическим перезапуском при падении:
//   powershell -File sales-bot/run-forever.ps1   (токен читает из token.txt рядом)
//
// Аватар бота (sales-bot/avatar.png) Bot API поставить не позволяет —
// один раз вручную: @BotFather → /mybots → этот бот → Edit Bot → Edit Botpic.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

// ── Настройки — читаются из config.json (правит панель управления или
// руками), а не зашиты в код. Файл создаётся с этими значениями по
// умолчанию при первом запуске, если его ещё нет. Меняются только при
// следующем перезапуске бота — панель управления сама перезапускает бота
// после сохранения настроек.
const CONFIG_PATH = "D:/TElega POST/sales-bot/config.json";
const DEFAULT_CONFIG = {
  starsPrice: 1500, // ≈3000 ₽ по курсу ~2 ₽/Star через официальные каналы
  // (App Store/Google Play), проверено на 2026-07-10. Курс Stars плавает,
  // официального фиксированного значения нет.
  rubPerStar: 2.0, // только для отображения в панели управления, на цену не влияет
  adminChatId: "984199643", // личный чат продавца — сюда шлём уведомление о каждой продаже
  supportContact: "продавцу", // ⚠️ впишите сюда свой @username — это увидят покупатели в /help и в сообщениях об ошибках
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    return { ...DEFAULT_CONFIG };
  }
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return { ...DEFAULT_CONFIG, ...saved };
  } catch (err) {
    console.error("Не удалось прочитать config.json, использую значения по умолчанию:", err);
    return { ...DEFAULT_CONFIG };
  }
}

const config = loadConfig();
const STARS_PRICE = config.starsPrice;
const ADMIN_CHAT_ID = config.adminChatId;
const SUPPORT_CONTACT = config.supportContact;

const RELEASE_DIR = "D:/Релиз";
const KEYGEN_PATH = "D:/cargo-tgt/release/keygen.exe";
const LEDGER_PATH = "D:/tstudio-sales-ledger.csv"; // вне репозитория, приватный учёт продаж
const LOG_PATH = "D:/tstudio-sales-bot.log"; // вне репозитория, лог на случай падения/перезапуска

// Скриншоты текущего интерфейса (не старше последнего редизайна!) — лежат
// рядом, в sales-bot/screenshots/. Порядок и подписи — как в галерее /start.
const SCREENSHOTS_DIR = "D:/TElega POST/sales-bot/screenshots";
const SCREENSHOTS = [
  { file: "02_editor_example.png", caption: "Редактор постов: заголовок, форматирование, живое превью справа — точь-в-точь как в Telegram" },
  { file: "06_drag_drop.png", caption: "Перетащите нужный блок из панели прямо в пост — таблица, чек-лист, опрос, аудио и другие" },
  { file: "04_rich_mode.png", caption: "Rich-режим — расширенные посты (Bot API 10.1): коллажи, слайд-шоу, вложенные цитаты" },
  { file: "05_rich_publish.png", caption: "Готовый Rich-пост с заголовками и списком — именно так он придёт подписчикам" },
  { file: "07_rich_with_image.png", caption: "Изображения прямо внутри форматированного текста, а не отдельным вложением" },
  { file: "03_templates.png", caption: "Готовые шаблоны — не начинать с чистого листа каждый раз" },
  { file: "01_editor.png", caption: "Блочный конструктор поста: заголовки, списки, чек-листы, код, аудио, видео, файлы" },
];

const TOKEN = process.env.SALES_BOT_TOKEN;
if (!TOKEN) {
  logError("Не задан SALES_BOT_TOKEN. Установи переменную окружения с токеном от @BotFather и перезапусти.");
  process.exit(1);
}
const API = `https://api.telegram.org/bot${TOKEN}`;

// ── Поиск последнего установщика в папке релизов ────────────────────────
function findLatestInstaller() {
  const re = /^Telegram Studio_(\d+)\.(\d+)\.(\d+)_x64_en-US\.msi$/;
  const candidates = fs.readdirSync(RELEASE_DIR)
    .map((name) => ({ name, m: name.match(re) }))
    .filter((c) => c.m)
    .map((c) => ({
      name: c.name,
      version: c.m.slice(1, 4).map(Number),
    }));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      if (a.version[i] !== b.version[i]) return b.version[i] - a.version[i];
    }
    return 0;
  });
  return path.join(RELEASE_DIR, candidates[0].name);
}

// ── Telegram Bot API helpers ─────────────────────────────────────────────
// Пишем и в консоль, и в файл — если бот упадёт или окно консоли случайно
// закроется, причина всё равно останется в LOG_PATH, а не потеряется.
function log(...args) {
  const line = `${new Date().toLocaleString("ru-RU")} ${args.map(String).join(" ")}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, line + "\n");
  } catch {
    // логирование не должно ронять сам бот
  }
}

function logError(...args) {
  log("ОШИБКА:", ...args);
}

async function api(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) logError(`${method} failed:`, JSON.stringify(data));
  return data;
}

// После первой реальной загрузки Telegram отдаёт file_id, которым можно
// переслать тот же файл в любой чат мгновенно — без повторной загрузки
// байтов с диска. Установщик каждой новой версии лежит под новым именем
// (номер версии в имени файла), так что кэш по filePath сам инвалидируется
// при выходе новой версии — не нужно отдельно чистить его руками.
const documentFileIdCache = new Map();

async function sendDocument(chatId, filePath, caption) {
  const cachedFileId = documentFileIdCache.get(filePath);
  if (cachedFileId) {
    const data = await api("sendDocument", { chat_id: chatId, document: cachedFileId, caption });
    if (data.ok) return data;
    // file_id теоретически может протухнуть (например, файл почистили на
    // стороне Telegram) — не должно случаться на практике, но на всякий
    // случай просто перезаливаем заново, а не проваливаем всю отправку.
    logError("Кэшированный file_id не сработал, перезаливаю файл:", JSON.stringify(data));
    documentFileIdCache.delete(filePath);
  }
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  const res = await fetch(`${API}/sendDocument`, { method: "POST", body: form });
  const data = await res.json();
  if (!data.ok) {
    logError("sendDocument failed:", JSON.stringify(data));
  } else if (data.result?.document?.file_id) {
    documentFileIdCache.set(filePath, data.result.document.file_id);
  }
  return data;
}

// Публичный хостинг для картинок Rich-сообщения — sendRichMessage не
// принимает attach://, только настоящие HTTP(S) URL (Telegram сам
// перехостит картинку на свой CDN сразу при отправке). Тот же сервис и те
// же параметры запроса, что и в src-tauri/src/hosting.rs у самого
// приложения — litterbox.catbox.moe первым, uguu.se как запасной вариант.
async function uploadToLitterbox(filePath) {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("time", "72h"); // максимум litterbox — даёт кэшу uploadPublicFile больше запаса
  form.append("fileToUpload", new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  const res = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", { method: "POST", body: form });
  const url = (await res.text()).trim();
  if (!res.ok || !/^https:\/\/([a-z0-9-]+\.)*catbox\.moe\//.test(url)) {
    throw new Error(`litterbox вернул неожиданный ответ: ${url}`);
  }
  return url;
}

async function uploadToUguu(filePath) {
  const form = new FormData();
  form.append("files[]", new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  const res = await fetch("https://uguu.se/upload", { method: "POST", body: form });
  const data = await res.json();
  const url = data?.files?.[0]?.url;
  if (!res.ok || !url) throw new Error(`uguu.se вернул неожиданный ответ: ${JSON.stringify(data)}`);
  return url;
}

// Демо-файлы (screenshots/demo_*) никогда не меняются между запусками бота,
// а litterbox держит ссылку 72ч — так что незачем перезаливать их на каждый
// /demo. Telegram сам скачивает картинку/аудио и перехостит на свой CDN сразу
// при отправке, так что для готового поста продолжительность жизни ссылки на
// litterbox уже не важна — важно только, чтобы она была жива в момент
// sendRichMessage. Кэш живёт, пока жив процесс бота; после перезапуска первый
// /demo снова платит полную цену заливки, дальше — из кэша.
const uploadCache = new Map();
const UPLOAD_CACHE_TTL_MS = 70 * 60 * 60 * 1000; // с запасом от 72ч litterbox

async function uploadPublicFile(filePath) {
  const cached = uploadCache.get(filePath);
  if (cached && Date.now() - cached.uploadedAt < UPLOAD_CACHE_TTL_MS) {
    return cached.url;
  }
  let url;
  try {
    url = await uploadToLitterbox(filePath);
  } catch (err) {
    logError("litterbox не сработал, пробую uguu.se:", err.message);
    url = await uploadToUguu(filePath);
  }
  uploadCache.set(filePath, { url, uploadedAt: Date.now() });
  return url;
}

// Альбом (swipeable) из нескольких локальных фото — только первая подпись
// становится подписью всего альбома, это ограничение самого Bot API.
async function sendMediaGroup(chatId, items) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  const media = items.map((item, i) => {
    const attachName = `photo${i}`;
    const entry = { type: "photo", media: `attach://${attachName}` };
    if (i === 0 && item.caption) entry.caption = item.caption;
    return entry;
  });
  form.append("media", JSON.stringify(media));
  items.forEach((item, i) => {
    form.append(`photo${i}`, new Blob([fs.readFileSync(item.file)]), path.basename(item.file));
  });
  const res = await fetch(`${API}/sendMediaGroup`, { method: "POST", body: form });
  const data = await res.json();
  if (!data.ok) logError("sendMediaGroup failed:", JSON.stringify(data));
  return data;
}

// ── Логика заказа ────────────────────────────────────────────────────────
async function generateLicenseKey() {
  const { stdout } = await execFileAsync(KEYGEN_PATH, ["1"]);
  return stdout.trim();
}

function logSale(from, starsAmount, key, chargeId) {
  const header = "timestamp,user_id,username,first_name,stars,key,charge_id\n";
  if (!fs.existsSync(LEDGER_PATH)) fs.writeFileSync(LEDGER_PATH, header);
  const row = [
    new Date().toISOString(),
    from.id,
    from.username ?? "",
    (from.first_name ?? "").replace(/,/g, " "),
    starsAmount,
    key,
    chargeId ?? "",
  ].join(",");
  fs.appendFileSync(LEDGER_PATH, row + "\n");
}

// Идемпотентность: Telegram гарантированно доставит апдейт хотя бы раз, но
// не ровно один раз — если бот упадёт между обработкой оплаты и следующим
// getUpdates (который и подтверждает оффсет), при перезапуске тот же
// successful_payment придёт снова. Ищем уже выданный ключ по
// telegram_payment_charge_id в журнале и переиспользуем его вместо
// генерации нового — иначе один платёж мог бы дать покупателю два ключа.
function findExistingSale(chargeId) {
  if (!chargeId || !fs.existsSync(LEDGER_PATH)) return null;
  const lines = fs.readFileSync(LEDGER_PATH, "utf8").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 1; i--) {
    const cols = lines[i].split(",");
    if (cols[6] === chargeId) return cols[5];
  }
  return null;
}

const BUY_KEYBOARD = { inline_keyboard: [[{ text: "💳 Купить", callback_data: "buy" }]] };
const MAIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: "📸 Скриншоты", callback_data: "screenshots" }, { text: "💳 Купить", callback_data: "buy" }],
    [{ text: "❓ Как это работает", callback_data: "help" }, { text: "🔑 Мой ключ", callback_data: "mykey" }],
    [{ text: "🎬 Демо Rich-режима", callback_data: "demo" }, { text: "📥 Обновление", callback_data: "update" }],
  ],
};

// Все продажи на этот Telegram user_id, новые первыми — самообслуживание
// для "потерял ключ", без похода в поддержку. Тот же простой построчный
// CSV-парсинг, что и в findExistingSale — first_name уже без запятых
// (см. logSale), а username/key/chargeId запятых не содержат в принципе.
function findSalesByUser(userId) {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  const lines = fs.readFileSync(LEDGER_PATH, "utf8").split("\n").filter(Boolean);
  const sales = [];
  for (let i = lines.length - 1; i >= 1; i--) {
    const cols = lines[i].split(",");
    if (cols[1] === String(userId)) sales.push({ timestamp: cols[0], key: cols[5] });
  }
  return sales;
}

// Личное уведомление продавцу (не покупателю) — не должно уронить обработку
// заказа, если само уведомление вдруг не отправится.
async function notifyAdmin(text) {
  if (!ADMIN_CHAT_ID) return;
  try {
    await api("sendMessage", { chat_id: ADMIN_CHAT_ID, text });
  } catch (err) {
    logError("notifyAdmin failed:", err);
  }
}

async function handleStart(chatId) {
  log(`/start от chat ${chatId}`);
  await api("sendMessage", {
    chat_id: chatId,
    // HTML, not MarkdownV2 — this string is 100% static (no interpolated user
    // input), so there's nothing to escape and no injection risk; HTML also
    // sidesteps MarkdownV2's reserved-character escaping that handleHelp's
    // comment above warns about.
    parse_mode: "HTML",
    text:
      "<b>Telegram Studio</b> — десктоп-редактор постов для Telegram-каналов: собираете пост в конструкторе из блоков, а не в одном текстовом поле.\n\n" +
      "🧩 <b>Блочный редактор.</b> Заголовки, списки, чек-листы, цитаты, таблицы, код — перетаскиваете блок из панели прямо в текст, живое превью показывает пост таким, каким его увидят подписчики.\n\n" +
      "🎬 <b>Rich-режим.</b> Коллажи и слайд-шоу из фото, аудио, вложенные цитаты — форматы, недоступные в обычной отправке сообщений.\n\n" +
      "📋 <b>Шаблоны и черновики.</b> Рабочий формат сохраняете один раз, дальше — автосейв, без риска потерять текст.\n\n" +
      "⏰ <b>Планирование публикаций.</b> Ставите дату и время — Telegram Studio отправит сам.\n\n" +
      "🔒 <b>Всё локально.</b> Ни сервера, ни аналитики, ни доступа к вашим данным — работает на вашем компьютере.\n\n" +
      "Разовая покупка, не подписка — в отличие от SMMplanner или Novapress: платите один раз, без ежемесячных списаний.",
    reply_markup: MAIN_KEYBOARD,
  });
}

async function handleScreenshots(chatId) {
  log(`Скриншоты для chat ${chatId}`);
  const items = SCREENSHOTS
    .map((s) => ({ file: path.join(SCREENSHOTS_DIR, s.file), caption: s.caption }))
    .filter((s) => {
      if (fs.existsSync(s.file)) return true;
      logError(`Скриншот не найден: ${s.file}`);
      return false;
    });
  if (items.length === 0) {
    await api("sendMessage", { chat_id: chatId, text: "Скриншоты сейчас недоступны — загляните позже." });
    return;
  }
  await sendMediaGroup(chatId, items);
  await api("sendMessage", { chat_id: chatId, text: "Готовы попробовать?", reply_markup: BUY_KEYBOARD });
}

async function handleMyKey(chatId, userId) {
  log(`Запрос ключа для user ${userId}`);
  const sales = findSalesByUser(userId);
  if (sales.length === 0) {
    await api("sendMessage", {
      chat_id: chatId,
      text: `Не нашёл покупок на этот аккаунт. Если вы покупали лицензию под другим Telegram-аккаунтом — напишите ${SUPPORT_CONTACT}.`,
      reply_markup: BUY_KEYBOARD,
    });
    return;
  }
  const formatDate = (iso) =>
    new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const text =
    sales.length === 1
      ? `Ваш ключ активации:\n\n${sales[0].key}\n\nКуплен ${formatDate(sales[0].timestamp)}. Вставьте его в поле активации при первом запуске приложения.`
      : `Ваши ключи активации:\n\n${sales.map((s, i) => `${i + 1}. ${s.key} (куплен ${formatDate(s.timestamp)})`).join("\n")}\n\nВставьте нужный в поле активации при первом запуске приложения.`;
  await api("sendMessage", { chat_id: chatId, text });
}

// Установщик доступен только покупателям — та же проверка по леджеру, что
// у /mykey. Без ключа активации сам файл всё равно бесполезен, но раз
// попросили ограничить именно так — ограничиваем именно так.
async function handleGetUpdate(chatId, userId) {
  log(`Запрос установщика для user ${userId}`);
  const sales = findSalesByUser(userId);
  if (sales.length === 0) {
    await api("sendMessage", {
      chat_id: chatId,
      text: `Установщик доступен только покупателям — не нашёл покупок на этот аккаунт. Если вы покупали лицензию под другим Telegram-аккаунтом — напишите ${SUPPORT_CONTACT}.`,
      reply_markup: BUY_KEYBOARD,
    });
    return;
  }
  const installer = findLatestInstaller();
  if (!installer) {
    await api("sendMessage", { chat_id: chatId, text: `Не нашёл установщик в ${RELEASE_DIR} — напишите ${SUPPORT_CONTACT} напрямую.` });
    return;
  }
  log(`Отправляю установщик: ${installer}`);
  await sendDocument(chatId, installer, "Установщик Telegram Studio (Windows)");
}

// Живой пример Rich-сообщения (Bot API 10.1) прямо в чате — те же теги,
// что генерирует src/lib/richMessageConverter.ts из блоков редактора,
// собранные вручную под один демонстрационный пост. Карты и формулы в
// список не входят: приложение пока не умеет такие блоки (см. Advanced —
// табличка внутри демо сама об этом честно говорит).
// Общий список для handleDemo и warmDemoCache — один источник правды, чтобы
// прогрев не мог незаметно разойтись с тем, что реально шлёт /demo.
const DEMO_ASSET_FILES = ["demo_collage1.jpg", "demo_collage2.jpg", "demo_slide1.jpg", "demo_slide2.jpg", "demo_audio.mp3"];

// Кэш uploadPublicFile живёт в памяти процесса — каждый рестарт бота обнуляет
// его, и без прогрева именно тот, кто первым нажмёт /demo после рестарта,
// платит полную цену пяти загрузок (несколько секунд). Прогреваем сразу при
// старте и затем перепроверяем в цикле раз в ~30с (та же точка, что у
// warmInstallerCache) — если запись протухла (70ч TTL), эта же проверка её
// перезальёт заранее, до того как это попадёт на реального пользователя.
async function warmDemoCache() {
  await Promise.all(DEMO_ASSET_FILES.map((f) => uploadPublicFile(path.join(SCREENSHOTS_DIR, f))));
}

async function handleDemo(chatId) {
  log(`Демо Rich-режима для chat ${chatId}`);
  await api("sendMessage", { chat_id: chatId, text: "Собираю демо-пост… это займёт пару секунд." });
  try {
    const [img1, img2, img3, img4, audioUrl] = await Promise.all(
      DEMO_ASSET_FILES.map((f) => uploadPublicFile(path.join(SCREENSHOTS_DIR, f)))
    );

    const html =
      // Точка-якорь для «Лифта» — та же разметка, что вставляет
      // insertJumpToTopLink() в EditorToolbar.tsx, должна стоять в самом
      // начале документа (позиция 0), а не рядом с заголовком.
      '<a name="top"></a>' +
      "<h2>Демо Rich-режима</h2>" +
      "<p>Так выглядит пост, собранный в Telegram Studio из блоков — без единой строчки HTML или Markdown.</p>" +
      "<p><b>жирный</b> <i>курсив</i> <u>подчёркнутый</u> <s>зачёркнутый</s> <tg-spoiler>спойлер</tg-spoiler> <mark>маркер</mark> и <code>инлайн-код</code></p>" +
      "<blockquote>Обычная цитата — для пояснений и врезок.</blockquote>" +
      "<blockquote>Цитата с <b>форматированием</b> внутри<blockquote>а внутри неё — ещё одна, вложенная</blockquote></blockquote>" +
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
      // zoom=15 подтверждено рабочим на мобильном Telegram живой проверкой
      // (zoom=12 давал серый экран на телефоне при полностью идентичных
      // остальных параметрах — width/height сервер всё равно всегда
      // нормализует в 800x400 сам, не наши явные значения) — держим этот же
      // zoom, что и дефолт самого приложения в BlockMap.tsx.
      '<tg-map lat="55.7558" long="37.6173" zoom="15"></tg-map>' +
      "<p>И формулы, если вдруг это техническая статья:</p>" +
      "<tg-math-block>E = mc^2</tg-math-block>" +
      "<table bordered><tr><th>Блок</th><th>Поддержка</th></tr><tr><td>Фото, видео, аудио, коллажи, слайд-шоу</td><td>Да</td></tr><tr><td>Таблицы, чек-листы, код, раскрывающийся текст</td><td>Да</td></tr><tr><td>Карты, формулы (LaTeX)</td><td>Да</td></tr></table>" +
      "<blockquote>💡 Всё это собирается визуально, перетаскиванием блоков — редактор сам превращает их в нужную разметку.</blockquote>" +
      '<p>А ссылки в тексте — обычным словом, без некрасивого URL целиком: <a href="https://telegram.org">вот так</a>.</p>' +
      '<p>И «Лифт» — для длинных постов, мгновенный переход наверх без прокрутки: <a href="#top">👆 Лифт</a></p>';

    await api("sendRichMessage", { chat_id: chatId, rich_message: { html } });
    await api("sendMessage", { chat_id: chatId, text: "Это был реальный Rich-пост. Хотите собрать свой?", reply_markup: BUY_KEYBOARD });
  } catch (err) {
    logError("Демо Rich-режима не удалось:", err?.stack || err);
    await api("sendMessage", { chat_id: chatId, text: `Не получилось собрать демо — попробуйте ещё раз чуть позже, или напишите ${SUPPORT_CONTACT}.` });
  }
}

async function handleHelp(chatId) {
  log(`/help от chat ${chatId}`);
  await api("sendMessage", {
    chat_id: chatId,
    text:
      "Как это работает:\n" +
      "1. Нажимаете «Купить» — открывается счёт в Telegram Stars.\n" +
      "2. Сразу после оплаты бот присылает лицензионный ключ и установщик (.msi, Windows x64).\n" +
      "3. При первом запуске приложения вставляете ключ в окно активации — готово, дальше всё работает офлайн.\n\n" +
      "Полезно знать:\n" +
      "• Ключ не привязан к конкретному устройству — при переустановке Windows просто введите его снова.\n" +
      "• Потеряли ключ? Пришлю его снова: /mykey или кнопка «🔑 Мой ключ».\n" +
      "• Хотите увидеть Rich-режим в деле — не на скриншоте, а живым сообщением? /demo.\n" +
      "• Вышло обновление, а установщик потеряли? /update пришлёт последнюю версию (только покупателям).\n" +
      `• Если что-то пошло не так — напишите ${SUPPORT_CONTACT} напрямую.\n\n` +
      "Команды: /start — об приложении, /buy — купить лицензию, /mykey — прислать мой ключ ещё раз, /demo — живой пример Rich-поста, /update — прислать последний установщик. Кнопка «📸 Скриншоты» в /start покажет интерфейс.",
  });
}

async function handleBuy(chatId) {
  log(`Выставляю счёт на ${STARS_PRICE} Stars для chat ${chatId}`);
  await api("sendInvoice", {
    chat_id: chatId,
    title: "Telegram Studio — лицензия",
    description: "Лицензионный ключ активации Telegram Studio (десктоп, Windows). Разовая покупка, без подписки.",
    payload: `license-${chatId}-${Date.now()}`,
    provider_token: "", // required field, but must be empty specifically for Telegram Stars (currency XTR)
    currency: "XTR",
    prices: [{ label: "Лицензия Telegram Studio", amount: STARS_PRICE }],
  });
}

async function handlePreCheckout(query) {
  log(`Pre-checkout от ${query.from.username ?? query.from.id} — подтверждаю`);
  await api("answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok: true });
}

async function handleSuccessfulPayment(message) {
  const chatId = message.chat.id;
  const payment = message.successful_payment;
  const chargeId = payment.telegram_payment_charge_id;
  log(`Оплата получена: ${payment.total_amount} Stars от ${message.from.username ?? message.from.id} (charge ${chargeId}) — генерирую ключ`);
  try {
    const existingKey = findExistingSale(chargeId);
    const isRedelivery = existingKey !== null;
    let key;
    if (isRedelivery) {
      key = existingKey;
      log(`Повторная доставка апдейта по уже обработанной оплате (charge ${chargeId}) — переиспользую выданный ключ, новый не генерирую`);
    } else {
      key = await generateLicenseKey();
      log(`Ключ сгенерирован: ${key}`);
      logSale(message.from, payment.total_amount, key, chargeId);
    }

    // Plain text, no parse_mode: MarkdownV2 requires escaping reserved
    // characters ('!', '.', etc.) in the surrounding text, and a broken
    // escape would fail the whole fulfilment message — not worth the risk
    // for a plain, easily copy-pasteable key.
    await api("sendMessage", {
      chat_id: chatId,
      text: `Оплата прошла успешно. Вот ваш ключ активации:\n\n${key}\n\nВставьте его в поле активации при первом запуске приложения.`,
    });

    const installer = findLatestInstaller();
    if (installer) {
      log(`Отправляю установщик: ${installer}`);
      await sendDocument(chatId, installer, "Установщик Telegram Studio (Windows)");
    } else {
      log(`Установщик не найден в ${RELEASE_DIR}!`);
      await api("sendMessage", { chat_id: chatId, text: `Не нашёл установщик в ${RELEASE_DIR} — напишите ${SUPPORT_CONTACT} напрямую.` });
    }

    // Purchasing again right away (e.g. a second license as a gift) shouldn't
    // require re-typing /start — offer the same buy button immediately.
    await api("sendMessage", {
      chat_id: chatId,
      text: "Если нужна ещё одна лицензия (например, в подарок) — можно купить снова:",
      reply_markup: BUY_KEYBOARD,
    });
    log("Заказ выполнен.");

    // Не шлём личное уведомление о продаже повторно — это не новая
    // продажа, а лишь повторная доставка уже учтённого платежа.
    if (!isRedelivery) {
      const buyer = message.from.username ? `@${message.from.username}` : message.from.id;
      await notifyAdmin(`💰 Продажа: ${payment.total_amount} Stars от ${buyer}\nКлюч: ${key}`);
    }
  } catch (err) {
    logError("Fulfilment failed:", err?.stack || err);
    await api("sendMessage", {
      chat_id: chatId,
      text: `Оплата прошла, но при выдаче ключа произошла ошибка — напишите ${SUPPORT_CONTACT} напрямую, разберёмся вручную.`,
    });

    const buyer = message.from.username ? `@${message.from.username}` : message.from.id;
    await notifyAdmin(`⚠️ Оплата ${payment.total_amount} Stars от ${buyer} (charge ${chargeId}) прошла, но выдача ключа упала: ${err?.message ?? err}\nНужно выдать ключ вручную!`);
  }
}

async function handleCallbackQuery(query) {
  log(`Нажата кнопка "${query.data}" от ${query.from.username ?? query.from.id}`);
  const chatId = query.message.chat.id;
  // answerCallbackQuery (снять "часики" с кнопки) и deleteMessage (убрать
  // сообщение с нажатой кнопкой, чтобы переписка не росла бесконечно) —
  // два независимых запроса к Telegram, друг от друга не зависят, ждать их
  // по очереди незачем. api() сама логирует и проглатывает неудачу (например,
  // сообщение уже удалено), так что дальнейшая обработка не прерывается.
  await Promise.all([
    api("answerCallbackQuery", { callback_query_id: query.id }),
    api("deleteMessage", { chat_id: chatId, message_id: query.message.message_id }),
  ]);
  if (query.data === "buy") return handleBuy(chatId);
  if (query.data === "screenshots") return handleScreenshots(chatId);
  if (query.data === "help") return handleHelp(chatId);
  if (query.data === "mykey") return handleMyKey(chatId, query.from.id);
  if (query.data === "demo") return handleDemo(chatId);
  if (query.data === "update") return handleGetUpdate(chatId, query.from.id);
}

function describeUpdate(update) {
  if (update.message?.text) return `сообщение "${update.message.text}"`;
  if (update.callback_query) return `нажатие кнопки "${update.callback_query.data}"`;
  if (update.pre_checkout_query) return "pre-checkout запрос";
  if (update.message?.successful_payment) return "успешная оплата";
  return `необработанный тип апдейта (${Object.keys(update).filter((k) => k !== "update_id").join(", ") || "пусто"})`;
}

async function handleUpdate(update) {
  log(`Получено: ${describeUpdate(update)}`);
  if (update.message?.text === "/start") return handleStart(update.message.chat.id);
  if (update.message?.text === "/buy") return handleBuy(update.message.chat.id);
  if (update.message?.text === "/help") return handleHelp(update.message.chat.id);
  if (update.message?.text === "/mykey") return handleMyKey(update.message.chat.id, update.message.from.id);
  if (update.message?.text === "/demo") return handleDemo(update.message.chat.id);
  if (update.message?.text === "/update") return handleGetUpdate(update.message.chat.id, update.message.from.id);
  if (update.callback_query) return handleCallbackQuery(update.callback_query);
  if (update.pre_checkout_query) return handlePreCheckout(update.pre_checkout_query);
  if (update.message?.successful_payment) return handleSuccessfulPayment(update.message);
}

// ── Оформление профиля бота ──────────────────────────────────────────────
// Каждый сеттер здесь сначала сверяется с текущим значением через getMe/
// getMyDescription/getMyShortDescription — вызывает setMyXxx, только если
// реально нужно что-то поменять. Это не оптимизация ради оптимизации:
// setMyName у Telegram жёстко лимитирован (поймали retry_after ~20 часов
// после нескольких перезапусков подряд во время отладки) — при частых
// рестартах бота (в том числе из панели управления) вызывать его вслепую
// на каждый старт нельзя. Фото профиля Bot API выставить вообще нельзя
// (нет такого метода) — его нужно один раз вручную загрузить через
// @BotFather → выбрать бота → Edit Bot → Edit Botpic, файл рядом:
// sales-bot/avatar.png.
async function setupBotProfile() {
  const desiredName = "Telegram Studio";
  const desiredShortDescription = "Десктоп для постов в Telegram-каналы. Разовая покупка, без подписки, всё локально.";
  const desiredDescription =
    "Telegram Studio — десктоп-приложение для создания и планирования постов в Telegram-каналах.\n\n" +
    "• Rich-режим: коллажи, слайд-шоу, файлы, аудио, вложенные цитаты\n" +
    "• Планирование публикаций, шаблоны, черновики\n" +
    "• Работает полностью локально — без сервера и слежки за данными\n\n" +
    "Разовая покупка — не подписка. Нажмите /start, чтобы посмотреть скриншоты и купить лицензию.";

  const me = await api("getMe", {});
  if (me.ok && me.result.first_name !== desiredName) {
    await api("setMyName", { name: desiredName });
  }

  const shortDesc = await api("getMyShortDescription", {});
  if (shortDesc.ok && shortDesc.result.short_description !== desiredShortDescription) {
    await api("setMyShortDescription", { short_description: desiredShortDescription });
  }

  const desc = await api("getMyDescription", {});
  if (desc.ok && desc.result.description !== desiredDescription) {
    await api("setMyDescription", { description: desiredDescription });
  }
  await api("setMyCommands", {
    commands: [
      { command: "start", description: "О приложении" },
      { command: "buy", description: "Купить лицензию" },
      { command: "mykey", description: "Прислать мой ключ ещё раз" },
      { command: "demo", description: "Живой пример Rich-поста" },
      { command: "update", description: "Прислать последний установщик" },
      { command: "help", description: "Как проходит покупка и активация" },
    ],
  });
}

// ── Long polling ─────────────────────────────────────────────────────────
// Прогревает documentFileIdCache для актуального установщика ДО того, как
// его попросит первый реальный покупатель/`/update` — иначе именно этот
// первый человек после каждого релиза платит ~3с настоящей загрузки, а все
// остальные едут на кэше. Единственный способ получить file_id — реально
// отправить файл в чат (Bot API не даёт "загрузить, не отправляя"), поэтому
// шлём его самому продавцу (ADMIN_CHAT_ID) с пометкой, что это техническое
// сообщение, а не что-то для клиентов.
async function warmInstallerCache() {
  if (!ADMIN_CHAT_ID) return; // некому слать — некуда греть кэш
  const installer = findLatestInstaller();
  // Единственный источник истины — сам кэш: если прогрев не удался (сетевая
  // ошибка и т.п.), sendDocument не заполнит documentFileIdCache, и следующая
  // итерация цикла (~30с) сама попробует снова — без отдельного флага,
  // который мог бы навсегда застрять после единичного сбоя.
  if (!installer || documentFileIdCache.has(installer)) return;
  log(`Новая версия установщика обнаружена, прогреваю кэш: ${installer}`);
  await sendDocument(ADMIN_CHAT_ID, installer, "🔄 Служебное сообщение: новая версия закэширована, раздача покупателям теперь мгновенная.");
}

async function main() {
  await setupBotProfile();
  await Promise.all([warmInstallerCache(), warmDemoCache()]);

  log(`Продающий бот запущен. Цена: ${STARS_PRICE} Stars. Жду сообщения...`);
  let offset = 0;
  while (true) {
    let data;
    try {
      const res = await fetch(`${API}/getUpdates?timeout=30&offset=${offset}`);
      data = await res.json();
    } catch (err) {
      logError("getUpdates failed, retry in 5s:", err.message);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (!data.ok) {
      logError("getUpdates error:", JSON.stringify(data));
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    for (const update of data.result) {
      offset = update.update_id + 1;
      handleUpdate(update).catch((err) => logError("handleUpdate failed:", err?.stack || err));
    }
    warmInstallerCache().catch((err) => logError("warmInstallerCache failed:", err?.stack || err));
    warmDemoCache().catch((err) => logError("warmDemoCache failed:", err?.stack || err));
  }
}

// Не даём одной случайной ошибке (например, в редко используемой ветке)
// уронить весь процесс — бот принимает реальные деньги, и каждая минута
// простоя это упущенные продажи. run-forever.ps1 всё равно перезапустит
// процесс, если он всё же завершится, но лучше просто пережить сбой и
// продолжить принимать заказы.
process.on("uncaughtException", (err) => {
  logError("Необработанное исключение:", err?.stack || err);
});
process.on("unhandledRejection", (err) => {
  logError("Необработанный reject:", err);
});

main();

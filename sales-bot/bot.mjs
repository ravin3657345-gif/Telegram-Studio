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
  { file: "04_rich_mode.png", caption: "Rich-режим — расширенные посты (Bot API 10.1): коллажи, слайд-шоу, вложенные цитаты" },
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

async function sendDocument(chatId, filePath, caption) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  const res = await fetch(`${API}/sendDocument`, { method: "POST", body: form });
  const data = await res.json();
  if (!data.ok) logError("sendDocument failed:", JSON.stringify(data));
  return data;
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
    [{ text: "❓ Как это работает", callback_data: "help" }],
  ],
};

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
    text:
      "Telegram Studio — десктоп-приложение для создания и планирования постов в Telegram-каналах.\n\n" +
      "Что умеет:\n" +
      "• Rich-режим постов: коллажи и слайд-шоу фото, файлы, аудио, вложенные цитаты\n" +
      "• Планирование публикаций по расписанию, шаблоны, черновики\n" +
      "• Работает полностью локально — без сервера и слежки за вашими данными\n\n" +
      "Разовая покупка — не подписка, в отличие от сервисов вроде SMMplanner или Novapress: без ежемесячных платежей.",
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
      `• Если что-то пошло не так — напишите ${SUPPORT_CONTACT} напрямую.\n\n` +
      "Команды: /start — об приложении, /buy — купить лицензию. Кнопка «📸 Скриншоты» в /start покажет интерфейс.",
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
  await api("answerCallbackQuery", { callback_query_id: query.id });
  const chatId = query.message.chat.id;
  if (query.data === "buy") return handleBuy(chatId);
  if (query.data === "screenshots") return handleScreenshots(chatId);
  if (query.data === "help") return handleHelp(chatId);
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
      { command: "help", description: "Как проходит покупка и активация" },
    ],
  });
}

// ── Long polling ─────────────────────────────────────────────────────────
async function main() {
  await setupBotProfile();

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

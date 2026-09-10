# Переезд Telegram-бота на Supabase — пошаговая инструкция

**Дата:** 2026-08-12
**Для кого:** владельцы Telegram-ботов, у которых `api.telegram.org` заблокирован провайдером (Россия), а бот живёт на домашнем ПК или сервере в РФ

**Что вы получите в итоге:**
- ✅ Бот отвечает **без VPN**
- ✅ Бот работает **без включённого компьютера** (Вариант Б)
- ✅ Никакого хостинга покупать не нужно — бесплатный тариф Supabase
- ✅ Тот же путь, по которому мы перенесли наш sales-bot

---

## Содержание

1. [Как это работает](#1-как-это-работает)
2. [Что понадобится](#2-что-понадобится)
3. [Вариант А — бот остаётся у вас, работает через релей (15 минут)](#3-вариант-а--бот-остаётся-у-вас-работает-через-релей)
4. [Вариант Б — полный переезд: бот живёт на Supabase (1–2 часа)](#4-вариант-б--полный-переезд-бот-живёт-на-supabase)
5. [Опционально: база данных, файлы, отложенные задачи](#5-опционально-база-данных-файлы-отложенные-задачи)
6. [Частые ошибки](#6-частые-ошибки)
7. [Чек-лист](#7-чек-лист)
8. [Вопросы и ответы](#8-вопросы-и-ответы)

---

## 1. Как это работает

Блокировка в РФ работает так: провайдер обрывает соединение **по IP-адресу** `api.telegram.org` — любой запрос из домашней сети к этому адресу умирает. А вот к адресам Supabase (это облачная платформа за границей, обёрнутая в Cloudflare) достучаться можно.

Решение — поменять **адрес**, по которому бот ходит в Telegram, с заблокированного на доступный:

```
БЕЗ РЕШЕНИЯ                          С РЕШЕНИЕМ
                                     ┌────────────────────────────┐
┌──────────┐                         │       SUPABASE (облако)     │
│  Ваш бот  │ ── запрос ──✂️❌        │                            │
│  (ПК/сервер)│     api.telegram.org │  ┌──────────────────────┐  │
└──────────┘                         │  │  Edge Function        │  │
                                     │  │  (ваш бот / релей)    │  │
                                     │  └──────────┬───────────┘  │
                                     │             │  запрос      │
                                     │             ▼              │
                                     │  ┌──────────────────────┐  │
                                     │  │   api.telegram.org   │  │
                                     │  └──────────────────────┘  │
                                     └────────────────────────────┘
```

Вариант А: бот остаётся у вас, а запросы к Telegram идут через **релей** на Supabase.
Вариант Б: весь бот переезжает в Supabase как **вебхук-функция** — компьютер можно выключать.

---

## 2. Что понадобится

| Что | Зачем |
|---|---|
| Токен бота от @BotFather | сам бот |
| Аккаунт Supabase (бесплатный) | облако, где будет жить бот |
| Supabase CLI | деплой функций (ставится за минуту) |
| Умение копировать команды в терминал | — |

> **Сколько это стоит:** бесплатный тариф Supabase включает 500 000 вызовов функций в месяц, 500 МБ базы и 1 ГБ файлов. Для небольшого бота этого хватает с запасом. Платный план (от $25/мес) поднимает лимит до 2 млн вызовов. Важно: бесплатный проект **ставится на паузу после 7 дней без активности** — если бот молчит неделю, его «разбудят» первым же сообщением.

---

## 3. Вариант А — бот остаётся у вас, работает через релей

Бот продолжает жить на вашей машине, но вместо `api.telegram.org` ходит в Telegram через маленькую функцию-«пересыльщик» на вашем Supabase. Код бота не переписывается — меняется одна строка (адрес API).

### Шаг 1. Создайте проект Supabase

1. Зайдите на [supabase.com](https://supabase.com) → **Start your project**
2. Введите название проекта и пароль от базы данных, выберите регион (**любой кроме России** — например Frankfurt)
3. Дождитесь создания проекта
4. На странице **Project Settings → API** скопируйте **Project URL** — он выглядит как `https://abcdefghijklmnopqrst.supabase.co`. Запомните кусок `abcdefghijklmnopqrst` — это **Project Ref**, он понадобится дальше

### Шаг 2. Разверните функцию-релей

Создайте на компьютере папку проекта и установите CLI:

```bash
# Windows (через Scoop) или любой ОС через npm:
scoop install supabase
#   или
npm install -g supabase
```

Затем инициализируйте и подключитесь к проекту:

```bash
mkdir my-bot-relay && cd my-bot-relay
supabase init
supabase login
supabase link --project-ref ПРОЕКТ_REF      # например abcdefghijklmnopqrst
```

Создайте функцию-релей:

```bash
supabase functions new tg-relay
```

Замените содержимое файла `supabase/functions/tg-relay/index.ts` на это:

```ts
// Прозрачный релей: любой запрос /bot<TOKEN>/<method>
// пересылается в Telegram дословно.
const TG_API = "https://api.telegram.org";

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Путь вида: https://<ref>.supabase.co/functions/v1/tg-relay/bot<TOKEN>/getMe
  const marker = "/tg-relay";
  const idx = url.pathname.indexOf(marker);
  const path = idx >= 0 ? url.pathname.slice(idx + marker.length) : "";

  if (!path.startsWith("/bot")) {
    return new Response("Ожидается путь /bot<TOKEN>/<method>", { status: 400 });
  }

  // Тело и метод передаём как есть
  const body = req.method === "GET" ? undefined : await req.arrayBuffer();

  const resp = await fetch(TG_API + path + url.search, {
    method: req.method,
    headers: {
      "Content-Type": req.headers.get("Content-Type") ?? "application/json",
    },
    body,
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: {
      "Content-Type": resp.headers.get("Content-Type") ?? "application/json",
    },
  });
});
```

Выключите проверку JWT (Telegram не умеет подписывать Supabase-токены) — добавьте в конец файла `supabase/config.toml`:

```toml
[functions.tg-relay]
verify_jwt = false
```

Задеплойте и проверьте:

```bash
supabase functions deploy tg-relay
curl "https://ПРОЕКТ_REF.supabase.co/functions/v1/tg-relay/bot<ВАШ_ТОКЕН>/getMe"
```

Если в ответе пришло имя вашего бота (`"username": "..."`) — релей работает. 🎉

> **Проверка из России:** команда `curl` выше ходит на ваш Supabase (доступен), а уже Supabase ходит в Telegram (тоже доступен — сервера Supabase за границей). Поэтому она сработает даже при полной блокировке.

### Шаг 3. Переключите бота на релей (одна строка)

| Фреймворк | Было | Стало |
|---|---|---|
| **python-telegram-bot** | `Application.builder()` | `Application.builder().base_url("https://ПРОЕКТ_REF.supabase.co/functions/v1/tg-relay/bot")` |
| **aiogram** | `Bot(token=...)` | `Bot(token=..., base_url="https://ПРОЕКТ_REF.supabase.co/functions/v1/tg-relay/bot")` |
| **grammY** | `new Bot(token)` | `new Bot(token, { client: { apiRoot: "https://ПРОЕКТ_REF.supabase.co/functions/v1/tg-relay" } })` |
| **telegraf** | `new Telegraf(token)` | `new Telegraf(token, { telegram: { apiRoot: "https://ПРОЕКТ_REF.supabase.co/functions/v1/tg-relay" } })` |
| **node-telegram-bot-api** | `new TelegramBot(token)` | `new TelegramBot(token, { baseApiUrl: "https://ПРОЕКТ_REF.supabase.co/functions/v1/tg-relay" })` |

Обратите внимание: фреймворки, у которых адрес по умолчанию заканчивается на `/bot` (python-telegram-bot, aiogram), — добавляйте `/bot` в конец; остальные — без него.

Если бот читает конфиг из `.env` — просто добавьте туда переменную (код не трогаете):

```bash
# для фреймворков, поддерживающих переменную окружения
BOT_API_BASE_URL=https://ПРОЕКТ_REF.supabase.co/functions/v1/tg-relay/bot
```

### Шаг 4. Перезапустите бота

Остановите и запустите бота заново. Готово — он работает без VPN. 🎉

**Плюсы варианта А:** работает для **любого языка** (Python, Node, Go, PHP…), код почти не меняется, 15 минут.
**Минусы:** бот живёт на вашей машине — компьютер должен быть включён; медиа тяжелее ~25 КБ через релей может не пройти (это ограничение блокировки, лечится отправкой по `file_id`).

---

## 4. Вариант Б — полный переезд: бот живёт на Supabase

Бот переезжает в облако целиком — как наш sales-bot. Теперь это **вебхук-функция**: Telegram сам присылает апдейты на адрес функции, функция обрабатывает и отвечает. Ваш компьютер больше не нужен.

```
Пользователь ──► Telegram ──► https://<ref>.supabase.co/functions/v1/bot
                                   │  (ваш код, Deno/TypeScript)
                                   └──► api.telegram.org (ответы, из облака)
```

> **Важное ограничение:** Supabase-функции выполняются на Deno/TypeScript. Если ваш бот написан на **Node.js — переезд почти безболезненный** (большинство кода совместимо). Если на Python/Go/PHP — полный переезд потребует переписывания; для таких ботов используйте Вариант А.

### Шаг 1. Создайте проект и подготовьте CLI

Как в Варианте А, шаги 1–2: создайте проект Supabase, установите CLI, выполните:

```bash
mkdir my-bot && cd my-bot
supabase init
supabase login
supabase link --project-ref ПРОЕКТ_REF
```

### Шаг 2. Создайте функцию-бота

```bash
supabase functions new bot
```

Замените содержимое `supabase/functions/bot/index.ts` на рабочий шаблон:

```ts
// Вебхук-обработчик Telegram-бота.
// Схема — как у нашего sales-bot:
//   1) проверяем секрет (только Telegram может вызывать)
//   2) читаем апдейт
//   3) быстро отвечаем 200 OK
//   4) обрабатываем команду

const BOT_TOKEN = Deno.env.get("BOT_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? "";
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Простая обёртка над Bot API
async function tg(method: string, payload: unknown): Promise<Record<string, unknown>> {
  const resp = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

// Ответ пользователю текстом (+ кнопки)
async function reply(chatId: number, text: string, keyboard?: unknown) {
  await tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

// Экранирование спецсимволов HTML
function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

Deno.serve(async (req) => {
  // 1. Авторизация: заголовок с секретом присылает только Telegram
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  // 2. Читаем апдейт
  const update = await req.json();
  const message = update.message;
  if (!message?.text) return new Response("ok", { status: 200 });

  const chatId = message.chat.id as number;
  const text = String(message.text).trim();

  // 3–4. Обрабатываем и отвечаем
  if (text === "/start") {
    await reply(chatId, "Привет! Я бот, который теперь живёт на Supabase 🚀\nНапишите /help — покажу команды.");
  } else if (text === "/help") {
    await reply(chatId, "Команды:\n/start — приветствие\n/help — справка\nлюбой другой текст — эхо.");
  } else {
    await reply(chatId, `Эхо: <b>${esc(text)}</b>`);
  }

  return new Response("ok", { status: 200 });
});
```

Это каркас. Внутрь вставляете свою логику — точно так же, как она была в обычном боте: `if (message.text === ...)` / обработка callback-кнопок (`update.callback_query`) и т.д.

### Шаг 3. Настройте конфиг и секреты

Добавьте в конец `supabase/config.toml`:

```toml
[functions.bot]
verify_jwt = false
```

> ⚠️ **Это обязательно.** Без этого Telegram будет получать `401 Unauthorized` — функции по умолчанию требуют JWT Supabase, которого у Telegram нет. И не удаляйте эту строку: **каждый** деплой перевключает проверку JWT обратно, если её нет в `config.toml`.

Сохраните токен и секрет вебхука (придумайте длинную случайную строку для секрета):

```bash
supabase secrets set BOT_TOKEN=123456789:AA...  WEBHOOK_SECRET=придумайте-длинную-случайную-строку
```

> Токен хранится в зашифрованном виде в Supabase и не попадает в код — коммитить его в git не нужно.

### Шаг 4. Проверьте локально (по желанию, но полезно)

```bash
supabase start
supabase functions serve bot --env-file .env.local
```

В другом окне отправьте тестовый апдейт:

```bash
curl -X POST "http://127.0.0.1:54321/functions/v1/bot" \
  -H "X-Telegram-Bot-Api-Secret-Token: придумайте-длинную-случайную-строку" \
  -H "Content-Type: application/json" \
  -d '{"message":{"chat":{"id":123},"text":"/start"}}'
```

В консоли `functions serve` появится обработка запроса.

### Шаг 5. Задеплойте

```bash
supabase functions deploy bot
```

### Шаг 6. Подключите вебхук

Если `api.telegram.org` у вас **доступен** (например, настраиваете с заграничного сервера или через VPN):

```bash
curl -X POST "https://api.telegram.org/bot<ВАШ_ТОКЕН>/setWebhook" \
  -F "url=https://ПРОЕКТ_REF.supabase.co/functions/v1/bot" \
  -F "secret_token=придумайте-длинную-случайную-строку"
```

Если **заблокирован** — тот же запрос, но через ваш релей из Варианта А (он уже развёрнут):

```bash
curl -X POST "https://ПРОЕКТ_REF.supabase.co/functions/v1/tg-relay/bot<ВАШ_ТОКЕН>/setWebhook" \
  -F "url=https://ПРОЕКТ_REF.supabase.co/functions/v1/bot" \
  -F "secret_token=придумайте-длинную-случайную-строку"
```

Проверьте, что вебхук встал:

```bash
curl "https://ПРОЕКТ_REF.supabase.co/functions/v1/tg-relay/bot<ВАШ_ТОКЕН>/getWebhookInfo"
```

### Шаг 7. Тест

Напишите боту `/start` в Telegram. Если отвечает — **можно выключать компьютер**. 🎉

---

## 5. Опционально: база данных, файлы, отложенные задачи

Всё, что наш sales-bot хранил в файлах и CSV, мы перенесли в Postgres и Storage Supabase. Вам пригодятся те же приёмы:

**Журнал в Postgres.** В `supabase/functions/bot/index.ts`:

```ts
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,   // настраивается: supabase secrets set
);

// после обработки апдейта:
await sb.from("bot_log").insert({ chat_id: chatId, text, at: new Date().toISOString() });
```

Таблицу создайте в SQL-редакторе Supabase:

```sql
create table bot_log (
  id bigint generated always as identity primary key,
  chat_id bigint,
  text text,
  at timestamptz default now()
);
```

**Медиа и кеш `file_id`.** Отправка фото из функции:

```ts
// файл уже загружен когда-то — Telegram помнит его по file_id,
// повторная отправка — маленький JSON-запрос, ничего не загружается заново
await tg("sendPhoto", { chat_id: chatId, photo: "ВАШ_FILE_ID", caption: "смотри!" });
```

Первую загрузку файла сделайте один раз (например, при деплое скриптом), сохраните `file_id` в таблицу и переиспользуйте — это и быстро, и дёшево. Наш sales-bot именно так раздаёт установщики: загрузил один раз, раздаёт по `file_id`.

**Отложенные задачи (рассылки, напоминания).** Вебхук-функция вызывается только по апдейту, поэтому «будильники» делаются отдельно: создайте функцию-задачу и вызывайте её по расписанию через **pg_cron** (в SQL-редакторе) — она раз в N минут дёргает вашу функцию HTTP-запросом.

---

## 6. Частые ошибки

| Симптом | Причина | Решение |
|---|---|---|
| Telegram отвечает `401 Unauthorized` | Проверка JWT включена | Убедитесь, что в `config.toml` есть `verify_jwt = false` (и передеплойте) |
| Бот отвечает «чужим» людям / кто-то дёргает функцию | Не проверяется секрет вебхука | Сверяйте заголовок `X-Telegram-Bot-Api-Secret-Token` — это первая строка обработчика |
| Бот отвечает дважды на одно сообщение | Telegram ретраит, потому что функция отвечала дольше 2–3 секунд | Отвечайте `200 OK` сразу, а тяжёлую работу запускайте после ответа (`EdgeRuntime.waitUntil(...)`) |
| Бот перестал принимать сообщения | Остался старый режим `getUpdates` | Webhook отменяет поллинг; оставьте один режим — вебхук |
| После обновления кода функция снова отдаёт 401 | Деплой перевключил JWT | Правило выше: `verify_jwt = false` всегда в `config.toml`, а не только в дашборде |
| Бот хранил данные в SQLite/файлах — пропали | Локальные данные не переехали | Переносите на Postgres (supabase-js) и Storage; файлы загрузите в бакет |

---

## 7. Чек-лист

- [ ] Проект Supabase создан, Project Ref под рукой
- [ ] CLI установлен, `supabase login` выполнен
- [ ] Функция `bot` создана, код-шаблон заполнен своей логикой
- [ ] В `config.toml` — `[functions.bot] verify_jwt = false`
- [ ] Секреты заданы: `BOT_TOKEN`, `WEBHOOK_SECRET`
- [ ] Функция задеплоена: `supabase functions deploy bot`
- [ ] Webhook установлен (через релей, если api.telegram.org заблокирован)
- [ ] `getWebhookInfo` показывает `"ok": true`
- [ ] Бот отвечает на `/start`
- [ ] Компьютер можно выключать — бот продолжает работать

---

## 8. Вопросы и ответы

**Это вообще легально?** Да. Telegram Bot API официально разрешает кастомные API-серверы (на этом построена вся экосистема локальных `telegram-bot-api` серверов и прокси). Вы не нарушаете правила — вы просто ходите к API другим адресом.

**Мой бот на Python. Что делать?** Для Python бот остаётся у вас, но работает через релей (Вариант А) — это покрывает 99% проблемы. Полный переезд в облако (Вариант Б) поддерживает только Node.js/TypeScript, потому что Supabase-функции — это Deno.

**Сколько это стоит?** Бесплатно: 500 000 вызовов функций/мес, 500 МБ БД, 1 ГБ файлов, 5 ГБ трафика. Для обычного бота хватает. Если бот очень активный — Pro ($25/мес) поднимает до 2 млн вызовов.

**Почему поллинг дороже вебхука?** Поллинг опрашивает сервер каждые 1–2 секунды — это сотни тысяч вызовов в месяц. Вебхук вызывается **только когда приходит сообщение**. Поэтому в Варианте Б всегда используйте вебхук.

**Мой бот отправляет фото — пройдёт?** Из Supabase — да, запросы идут с заграничных серверов, блокировки нет. Через релей (Вариант А) крупные файлы могут не пройти — тогда отправляйте по `file_id`.

**Можно ли откатиться?** Да. Удалите вебхук (`deleteWebhook`) — бот вернётся к работе на вашей машине как раньше. Никаких данных в Supabase это не трогает.

**Что будет, если я не пользуюсь ботом неделю?** Бесплатный проект Supabase ставится на паузу после 7 дней неактивности. Первое сообщение боту «разбудит» его автоматически — просто первая обработка может занять на пару секунд дольше.

---

*Инструкция построена на живом опыте: наш sales-bot перенесён на Supabase (вебхук-функция, журнал в Postgres, раздача файлов по `file_id`) — он работает из России без VPN и без включённого компьютера продавца.*

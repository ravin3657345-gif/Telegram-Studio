# Аудит функционала для нативного Android-приложения

**Дата:** 2026-08-17
**Исходный продукт:** Telegram Studio (Tauri 2 · Rust · React 18 · TipTap 2 · SQLite)
**Цель:** отдельное Android-приложение «с нуля» (не webview-обёртка, не перенос десктопа)

---

## 1. Вердикт и рекомендация по стеку

Да, отдельное нативное Android-приложение сделать можно и нужно. Десктоп уже умеет собираться под Android как webview (Tauri android + `android-custom/` патчи), но это та же десктопная UI-логика в браузере — неудобно на телефоне.

**Рекомендуемый стек: Kotlin + Jetpack Compose + Room (SQLite) + WorkManager + Ktor/OkHttp.**

Обоснование:

| Критерий | Kotlin/Compose | React Native | Flutter |
|---|---|---|---|
| Нативный UX (жесты, клавиатура, picker) | ✅ лучший | хороший | хороший |
| Rich-редактор на Compose | есть готовые (RichEditor, AnnotatedString) | TipTap можно переиспользовать | flutter_html_editor |
| Фоновый планировщик публикаций | ✅ WorkManager (надежно) | ⚠️ ограничен | ⚠️ ограничен |
| Работа в фоне при закрытом приложении | ✅ Foreground Service | ⚠️ | ⚠️ |
| SQLite | ✅ Room | ✅ | ✅ |
| Переиспользование кода из десктопа | низкое | среднее (TS-утилиты) | низкое |
| Один язык на всю логику | Kotlin (вся бизнес-логика + UI) | TS + нативные модули | Dart |

Ключевой аргумент за Kotlin: **планировщик публикаций**. У десктопа он работает, пока открыто приложение (tokio-таск в трее). На Android «в трее» нет — нужен WorkManager/сервис, а это нативная территория, где RN/Flutter дают худший контроль.

---

## 2. Полный инвентарь функционала

### 2.1 Экраны (маршруты Router.tsx)

| Экран | Десктоп (страница) | Сложность порта | Комментарий |
|---|---|---|---|
| Онбординг | `OnboardingPage` (336 стр.) | 🟢 низкая | Stepper: приветствие → токен бота → канал → готово |
| Дашборд | `DashboardPage` (238 стр.) | 🟢 низкая | Сводка за день: опубликовано/ошибки, каналы |
| Редактор | `EditorPage` (485) + `PostEditor` (719) + `PublishPanel` (951) | 🔴 очень высокая | Сердце продукта, см. раздел 3 |
| Черновики | `DraftsPage` (759) | 🟡 средняя | Список, поиск, фильтры, массовое удаление, дубликаты |
| Шаблоны | `TemplatesPage` (639) | 🟡 средняя | Категории, переменные, примеры, счётчик использований |
| Расписание | `SchedulePage` (524) | 🟡 средняя | Календарная сетка, отмена, «опубликовать сейчас» |
| История | `HistoryPage` (409) | 🟡 средняя | Фильтры, «открыть в Telegram», «создать дубль», **редактирование опубликованного**, **отложенное удаление** |
| Каналы | `ChannelsPage` (553) | 🟢 низкая | CRUD каналов, смена бота у канала |
| Боты | `BotsPage` (463) | 🟢 низкая | CRUD ботов, токен скрыт/маскирован, reveal по явному действию |
| Настройки | `SettingsPage` (605) | 🟢 низкая | Тема, язык (ru/en/es/fr/pl), автосохранение, parse mode, дефолтные бот/канал, экспорт, danger zone |
| Лицензия | `LicenseGate` (компонент) | 🟢 низкая | Активация ключа через Supabase RPC, офлайн-проверка по machine hash |

### 2.2 Бизнес-логика (Rust-команды = полный список IPC-контракта)

**Боты** (`commands/bots.rs`):
- `validate_bot_token(token)` → getMe, rate-limit 5/60 сек
- `get_bots()` — токены возвращаются **маскированными** (безопасность!)
- `reveal_bot_token(botId)` — только по явному действию пользователя
- `add_bot(token)`, `delete_bot(id)`

**Каналы** (`commands/channels.rs`):
- `get_channels(botId?)`, `add_channel(botId, username)` (getChat + проверка админства), `delete_channel(id)`, `update_channel_bot(channelId, botId)`

**Черновики** (`commands/drafts.rs`):
- `get_drafts()`, `get_draft(id)`, `upsert_draft(payload)` (транзакция: drafts + media + buttons), `delete_draft(id)`
- Внутри: `drafts.kind` — `draft` | `template` (шаблоны = черновики)

**Публикация** (`commands/publish.rs`):
- `publish_post(payload)` — текст/фото/видео/альбом/документы + inline-кнопки, мультиканально, с фолбэком по ботам (если один бот не может — пробует следующий)
- `schedule_post(payload)` — отложенная публикация с заменой существующих pending-записей для черновика
- `update_scheduled_post_content(payload)` — автосохранение синхронизирует снапшот запланированного поста
- `get_scheduled_posts()`, `cancel_scheduled_post(id)`
- `publish_rich_post(payload)` — **Rich Message (Bot API 10.1/10.2, sendRichMessage)**
- `schedule_rich_post(payload)`, `republish_rich_post(historyId, ...)`
- `send_poll(payload)` — опросы (анонимность, множественный выбор)

**История** (`commands/history.rs`):
- `get_history()` — LEFT JOIN, COALESCE заголовков каналов
- `schedule_post_delete(historyId, deleteAt)` — отложенное удаление опубликованного (deleteMessage)
- `get_history_for_edit(historyId)` — возвращает контент + **fileId + base64** для повторной отправки
- `edit_published_post(historyId, newText, contentJson)` — editMessageText/editMessageCaption

**Дашборд** (`commands/dashboard.rs`): `get_channel_dashboard()`, `get_today_stats()`

**Шаблоны** (`commands/templates.rs`): `get_templates`, `get_template`, `save_template`, `delete_template`, `record_template_use` (всё через `drafts` с `kind='template'`)

**Сниппеты** (`commands/snippets.rs`): `get_snippets`, `save_snippet`, `delete_snippet` — вставка текста в курсор

**Настройки** (`commands/settings.rs`): `get_settings`, `update_setting(key, value)`

**Лицензия** (`commands/license.rs`): `get_license_status`, `activate_license(key)` — Supabase RPC `redeem_license`, machine hash (SMBIOS + legacy), кэш в БД

**Прочее**: `attachments.rs` — валидация и персист медиа; `winbypass.rs` — **только Windows, в Android НЕ переносится**

### 2.3 Фоновые процессы

| Процесс | Десктоп | Android-аналог |
|---|---|---|
| Планировщик публикаций | tokio-таск, тик 60 сек, пока открыто приложение | **WorkManager** (периодический + точный через AlarmManager/foreground service). ⚠️ Android убивает процессы — нужен сервис для точного времени |
| Ретраи транзиентных ошибок | до 5 попыток, `retry_count`, retry_after уважается (cap 30 c) | Перенести логику `retry.rs` как есть |
| Отложенное удаление постов | тот же тик, `execute_pending_deletes` | В WorkManager-цикл |
| Бэкап БД | ежедневный снапшот `backup.rs` + retention | Room Backup/Restore или копия файла + `Auto Backup` |
| Уведомления | tauri-plugin-notification | NotificationManager + каналы уведомлений (POST_NOTIFICATIONS permission) |

### 2.4 Telegram API поверхность (методы)

Все вызовы идут от имени **ботов** (Bot API, не user API!):

`getMe`, `getChat`, `getChatMemberCount`, `sendMessage` (HTML/MarkdownV2), `sendPhoto`, `sendVideo`, `sendDocument`, `sendMediaGroup` (до 10, чанки), `sendRichMessage` (multipart, tg://id ссылки), `sendPoll`, `editMessageText`, `editMessageCaption`, `deleteMessage`.

Особенности десктопной реализации, которые надо сохранить:
- **Альбомы**: фото/видео группируются, документы всегда по одному; >10 → несколько sendMediaGroup; caption только на первый
- **Inline-кнопки**: только с текстом/одиночным медиа; с альбомом кнопки уходят отдельным sendMessage
- **Rich**: медиа шлётся multipart-ом с `attach://id`, HTML ссылается `tg://photo?id=…`; деградация при отсутствующем медиа (вырезание плейсхолдеров, пустых tg-collage/tg-slideshow)
- **Ретраи**: 2 попытки + задержки 2с/5с, уважение `retry_after`, `is_permanent_telegram_error`
- **Нормализация изображений** (`image_utils.rs`): перекодирование, лимит rich-фото 5 МБ, общий 50 МБ, защита от OOM на base64

### 2.5 Модель данных (SQLite, 11 таблиц)

| Таблица | Назначение | Android |
|---|---|---|
| `bots` | токен (**AES-256-GCM**, см. crypto) | Room + EncryptedSharedPreferences/Keystore для токенов |
| `channels` | каналы, FK bot_id, telegram_id | Room |
| `drafts` | посты; `kind` draft/template; `content_json` (TipTap JSON) | Room |
| `draft_media` | медиа черновика, PK (draft_id, id) | Room + файлы в app dir |
| `draft_buttons` | inline-кнопки (row/col) | Room |
| `scheduled_posts` | расписание; `content_html` снапшот; `publish_mode` normal/rich; `retry_count` | Room |
| `scheduled_media` | медиа для отложенных, на диске | Room + файлы |
| `publication_history` | архив публикаций (без FK — переживает удаление каналов) | Room |
| `settings` | key/value | DataStore Preferences |
| `license` | ключ + machine_hash | Room + Keystore |
| `snippets` | текстовые сниппеты | Room |

Важные инварианты (собраны из истории багов — переносить осознанно):
- `publication_history` **без** FK на channels/bots — удаление канала не должно ломать архив
- `draft_media` PK = `(draft_id, id)` — один fileId может жить в нескольких черновиках (пример-шаблоны)
- `scheduled_posts` для rich-постов хранит HTML с `tg://…?id=` ссылками, байты — на диске

---

## 3. Редактор — самое сложное

### 3.1 «Обычный» режим (normal)
TipTap rich-text → HTML для Telegram. Форматирование: bold, italic, underline, strike, code, codeBlock, spoiler (кастомный), blockquote, списки, ссылки, таблицы, text-align, highlight, color, subscript, superscript, hardBreak, эмодзи-пикер (emoji-mart), счётчик символов (лимит 4096, цветовая индикация), вставка из буфера, drag&drop медиа.

**Порт:** на Compose нужен rich-text редактор. Варианты:
1. **Официальный путь Compose** — `BasicTextField` + `AnnotatedString` + собственные стили (сложно: таблицы, спойлеры)
2. Готовые: `compose-rich-editor` (community), WebView с TipTap (противоречит «с нуля»), `AmrDeveloper/G-Clang` нет...
3. **Прагматично**: собственный лёгкий HTML-редактор на Compose с markdown-подобными жестами + переиспользовать десктопные конвертеры (`htmlConverter.ts`, `richMessageConverter.ts`, `miniHtml.ts`) — их логика переносится на Kotlin или запускается через JS-мост

Минимум для MVP редактора: жирный/курсив/ссылка/спойлер/списки/цитата/счётчик/вставка медиа. Таблицы и цвета — фаза 2.

### 3.2 Rich-режим (блоки)
Десктоп: блочный редактор с палитрой блоков (`BlockPalette`, 687 стр.) — заголовки, коллажи (`tg-collage`), слайдшоу (`tg-slideshow`), сплиты (2-3 колонки, `SplitOverlay`), геометрия блоков (`blockGeometry.ts`), drag&drop блоков (`BlockHoverControls`), цвет текста/фона, вставка фото/видео/аудио. Конвертация в Rich HTML (`richMessageConverter.ts` + `rich_html.rs` в core).

**Порт:** самое дорогое. Рекомендация — **фаза 2+**: сначала обычный режим, потом rich. На Compose это: кастомный LazyColumn из блоков, drag&drop (Compose built-in), канвас для коллажей. Логику геометрии можно переписать на Kotlin (алгоритмы в `blockGeometry.ts` — чистые функции, переносятся 1:1).

### 3.3 Публикация (PublishPanel, 951 стр.)
- Выбор каналов (мультивыбор), выбор бота, дефолтные из настроек
- Кнопки: сейчас / запланировать (DateTimePicker) / опрос
- Подтверждение перед публикацией (настройка)
- Обработка ошибок по каждому каналу отдельно

---

## 4. Безопасность (переносить обязательно)

| Механизм | Десктоп | Android |
|---|---|---|
| Шифрование токенов | AES-256-GCM (`crypto.rs`) | Android Keystore (сильнее: ключ не покидает TEE) |
| Маскирование токенов в UI/IPC | `getBots` возвращает маску, reveal по явному действию | То же в ViewModel/UI |
| Rate-limit валидации токенов | 5/60 сек | То же |
| CSP | WebView CSP | N/A |
| Лицензия | Supabase RPC + machine hash (SMBIOS + legacy) | machine hash на Android: ANDROID_ID/Settings.Secure + Keystore-ключ; RPC тот же |
| Медиа | файлы в AppData | filesDir, content:// через FileProvider |

---

## 5. Локализация и темы

- 5 языков: ru, en, es, fr, pl (`src/lib/locales/`) — на Android: `values-ru`, `values-en`, `values-es`, `values-fr`, `values-pl` (strings.xml)
- Тема: тёмная/светлая/системная + фирменный дизайн (см. `DESIGN.md`, `src/styles/`) — Compose Material 3 + кастомная палитра из `telegramTheme.ts`
- Шрифты: Geist/Manrope/Public Sans → Android-эквиваленты (Google Fonts)

---

## 6. Что НЕ переносится

- **WindowControls, трей, скрытие в трей** — десктоп-концепты
- **winbypass (обход блокировки Telegram через WinDivert)** — Windows-only, на Android недоступно/не нужно (пользователь использует VPN на уровне ОС)
- **Tauri-плагины** (opener, notification, dialog, log) — заменяются нативными API
- **Drag&drop файлов с рабочего стола** — на Android это picker + share sheet
- **Открытие папки медиа в проводнике** — неактуально

---

## 7. Рекомендуемая архитектура Android-приложения

```
app/
├── data/                  # Room DAO/Entity, DataStore, файловый менеджер
├── domain/                # Use cases: PublishPost, SchedulePost, EditPost...
├── core/telegram/         # Ktor-клиент Bot API + конвертеры HTML
│   ├── RichHtmlBuilder    # перенос rich_html.rs / richMessageConverter.ts
│   ├── NormalHtmlBuilder  # перенос htmlConverter.ts / miniHtml.ts
│   └── RetryPolicy        # перенос retry.rs
├── workers/               # WorkManager: SchedulerWorker, DeleteWorker, BackupWorker
├── ui/                    # Compose: навигация, экраны, редактор
└── security/              # Keystore-обёртка токенов, лицензия
```

Ключевые решения:
1. **Room** — схема 1:1 с десктопной (для будущей миграции БД с десктопа, см. раздел 8)
2. **WorkManager** — периодический тик (15 мин, min interval) + **точное время** через `setExactAndAllowWhileIdle` + Foreground Service при активном расписании
3. **Ktor** (или OkHttp) — multipart для медиа, таймауты как на десктопе
4. **Compose Multiplatform не нужен** — целевая платформа только Android; Kotlin/Native общий модуль с десктопом нецелесообразен (десктоп на Rust)
5. MVVM + один Activity, навигация Navigation-Compose

---

## 8. Миграция данных с десктопа (важно для пользователей)

Схема SQLite совместима (та же, 17 миграций). Путь:
- Десктоп: `%APPDATA%/telegram-studio/telegram-studio.db` + `media/`
- Android: экспорт БД + media через десктопный «Экспорт» (JSON) или копию файла БД через облако/USB → импорт в `databases/`
- ⚠️ Токены зашифрованы AES ключом десктопа → при импорте БД нужен ре-энролл: расшифровать при экспорте (функция «экспорт с токенами» под паролем) или перепривязать ботов заново (проще и безопаснее: 2 минуты, токены вводятся заново)

---

## 9. План портирования по фазам

| Фаза | Содержание | Оценка |
|---|---|---|
| 0. Фундамент | Проект, навигация, Room, темы, i18n (5 языков), Keystore | 1–2 нед |
| 1. Боты/каналы + онбординг | CRUD, лицензия, Dashboard | 1 нед |
| 2. Редактор normal | Rich-text (без таблиц/цветов), медиа-пикер, кнопки, счётчик, автосохранение | 2–3 нед |
| 3. Публикация | Мультиканал, альбомы, кнопки, опросы, ретраи | 1–2 нед |
| 4. Планировщик | WorkManager + сервис, расписание-экран, отложенное удаление | 1–2 нед |
| 5. Черновики/шаблоны/сниппеты | Списки, поиск, дубликаты, категории | 1 нед |
| 6. История | Фильтры, редактирование опубликованного (editMessage), «открыть в Telegram» (deep link t.me) | 1 нед |
| 7. Rich-режим | Блочный редактор, коллажи/слайдшоу/сплиты, sendRichMessage | 3–4 нед |
| 8. Polish | Widget, share sheet («Поделиться → создать пост»), бэкапы, тесты | 1–2 нед |

**Итого MVP (фазы 0–4): ~7–10 недель. Полный паритет (фазы 0–8): ~13–16 недель** при одном разработчике.

---

## 10. Открытые вопросы к владельцу продукта

1. Rich-режим — критичен для первой версии или можно MVP без него?
2. Нужна ли миграция данных с десктопа (или Android стартует с чистого листа)?
3. Лицензия: распространяется ли один ключ на обе платформы? (сейчас machine hash завязан на десктоп)
4. Публикация на Google Play или APK напрямую? (Play требует политику для ботов/токенов)
5. Оставляем ли языки es/fr/pl в первой версии?

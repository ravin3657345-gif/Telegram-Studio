# Telegram Studio — Технический документ

**Версия:** 1.0  
**Дата:** 2026-06-20  
**Стек:** Tauri 2 · Rust · React 18 · TypeScript · SQLite · TipTap 2 · Telegram Bot API

---

## Содержание

1. [Архитектура проекта](#1-архитектура-проекта)
2. [Структура папок](#2-структура-папок)
3. [База данных](#3-база-данных)
4. [Компоненты React](#4-компоненты-react)
5. [API-слой (Tauri Commands)](#5-api-слой-tauri-commands)
6. [Описание экранов](#6-описание-экранов)
7. [Последовательность разработки](#7-последовательность-разработки)

---

## 1. Архитектура проекта

### 1.1 Общая схема

```
┌─────────────────────────────────────────────────────────┐
│                   TAURI DESKTOP APP                     │
│                                                         │
│  ┌──────────────────────┐   ┌────────────────────────┐  │
│  │   FRONTEND (WebView) │   │   BACKEND (Rust)       │  │
│  │                      │   │                        │  │
│  │  React 18            │   │  Tauri Commands        │  │
│  │  TypeScript          │◄──►  SQLite (rusqlite)    │  │
│  │  TipTap 2            │   │  Telegram API Client   │  │
│  │  Zustand             │   │  File System Manager   │  │
│  │  TailwindCSS         │   │  Scheduler (tokio)     │  │
│  └──────────────────────┘   └────────────┬───────────┘  │
│                                          │               │
└──────────────────────────────────────────┼───────────────┘
                                           │ HTTPS
                                           ▼
                              ┌─────────────────────────┐
                              │   Telegram Bot API      │
                              │   api.telegram.org      │
                              └─────────────────────────┘
```

### 1.2 Ключевые архитектурные решения

#### Разделение ответственности

| Слой | Технология | Зона ответственности |
|------|-----------|---------------------|
| UI | React + TypeScript | Рендеринг, пользовательский ввод, состояние UI |
| State | Zustand | Глобальное состояние приложения |
| IPC | Tauri Commands | Мост между JS и Rust |
| Business Logic | Rust | Валидация, трансформация данных, планировщик |
| Persistence | SQLite | Хранение всех данных локально |
| External API | Rust (reqwest) | Все запросы к Telegram Bot API |
| File Storage | Rust (std::fs) | Управление медиафайлами в AppData |

#### Почему Rust делает все запросы к Telegram

Токены ботов хранятся в SQLite и никогда не передаются в JS-слой. Rust получает токен из БД, делает запрос к Telegram API и возвращает результат через Tauri Command. Это исключает утечку токенов через DevTools или перехват WebView-трафика.

#### Хранение медиафайлов

Пользователь выбирает файл → Rust копирует его в `AppData/telegram-studio/media/{uuid}.{ext}` → в БД хранится только UUID и метаданные → при публикации Rust читает файл по пути и отправляет в Telegram.

#### Планировщик отложенных публикаций

Tokio-задача запускается при старте приложения, каждую минуту опрашивает таблицу `scheduled_posts` и публикует посты, время которых наступило. Работает в фоне, пока приложение открыто.

### 1.3 Поток данных

```
Пользователь вводит текст
        │
        ▼
TipTap Editor (React)
        │ onChange → debounce 2s
        ▼
Zustand Store (draft state)
        │ autosave trigger
        ▼
invoke("upsert_draft", payload)
        │
        ▼
Rust Command → SQLite UPDATE
        │
        ▼
invoke("publish_post", {draft_id, channel_id})
        │
        ▼
Rust: читает draft + bot_token из SQLite
        │
        ▼
reqwest → Telegram Bot API
        │
        ▼
Запись в publication_history
        │
        ▼
Event("post_published") → React Toast
```

---

## 2. Структура папок

```
telegram-studio/
│
├── src-tauri/                          # Rust backend
│   ├── src/
│   │   ├── main.rs                     # Точка входа Tauri
│   │   ├── lib.rs                      # Регистрация команд и плагинов
│   │   │
│   │   ├── commands/                   # Tauri Commands (IPC-хэндлеры)
│   │   │   ├── mod.rs
│   │   │   ├── bots.rs                 # Управление ботами
│   │   │   ├── channels.rs             # Управление каналами
│   │   │   ├── drafts.rs               # Черновики
│   │   │   ├── media.rs                # Загрузка медиафайлов
│   │   │   ├── publishing.rs           # Публикация постов
│   │   │   ├── scheduler.rs            # Отложенная публикация
│   │   │   ├── history.rs              # История публикаций
│   │   │   └── settings.rs             # Настройки приложения
│   │   │
│   │   ├── db/                         # Слой базы данных
│   │   │   ├── mod.rs                  # Инициализация пула соединений
│   │   │   ├── migrations.rs           # SQL-миграции (встроенные)
│   │   │   ├── models.rs               # Rust-структуры (Bot, Channel, Post...)
│   │   │   ├── queries/
│   │   │   │   ├── bots.rs
│   │   │   │   ├── channels.rs
│   │   │   │   ├── drafts.rs
│   │   │   │   ├── media.rs
│   │   │   │   ├── scheduled.rs
│   │   │   │   └── history.rs
│   │   │
│   │   ├── telegram/                   # Telegram Bot API клиент
│   │   │   ├── mod.rs
│   │   │   ├── client.rs               # HTTP клиент (reqwest)
│   │   │   ├── methods.rs              # sendMessage, sendPhoto, etc.
│   │   │   ├── types.rs                # Telegram API типы
│   │   │   └── markup.rs               # Конвертер TipTap JSON → HTML
│   │   │
│   │   ├── scheduler/                  # Фоновый планировщик
│   │   │   ├── mod.rs
│   │   │   └── worker.rs               # Tokio задача
│   │   │
│   │   └── fs/                         # Файловая система
│   │       ├── mod.rs
│   │       └── media_store.rs          # Управление медиапапкой
│   │
│   ├── icons/                          # Иконки приложения
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── src/                                # React frontend
│   │
│   ├── app/
│   │   ├── App.tsx                     # Корневой компонент
│   │   ├── Router.tsx                  # Маршрутизация (react-router)
│   │   └── Providers.tsx               # Обёртка всех провайдеров
│   │
│   ├── pages/                          # Страницы (экраны)
│   │   ├── OnboardingPage.tsx          # Первый запуск
│   │   ├── EditorPage.tsx              # Главный редактор
│   │   ├── DraftsPage.tsx              # Список черновиков
│   │   ├── HistoryPage.tsx             # История публикаций
│   │   ├── SchedulePage.tsx            # Отложенные публикации
│   │   ├── ChannelsPage.tsx            # Управление каналами и ботами
│   │   └── SettingsPage.tsx            # Настройки
│   │
│   ├── components/                     # UI-компоненты
│   │   │
│   │   ├── layout/
│   │   │   ├── AppShell.tsx            # Обёртка: Sidebar + Content
│   │   │   ├── Sidebar.tsx             # Боковая навигация
│   │   │   ├── SidebarItem.tsx
│   │   │   ├── TopBar.tsx              # Верхняя панель редактора
│   │   │   └── WindowControls.tsx      # Кастомные кнопки окна (Tauri)
│   │   │
│   │   ├── editor/
│   │   │   ├── PostEditor.tsx          # Главный компонент редактора
│   │   │   ├── EditorToolbar.tsx       # Панель форматирования
│   │   │   ├── ToolbarButton.tsx       # Кнопка тулбара
│   │   │   ├── FormatGroup.tsx         # Группа кнопок форматирования
│   │   │   ├── EmojiPicker.tsx         # Пикер эмодзи
│   │   │   ├── LinkDialog.tsx          # Диалог вставки ссылки
│   │   │   ├── MediaUploadZone.tsx     # Зона Drag & Drop
│   │   │   ├── MediaAttachment.tsx     # Одно прикреплённое медиа
│   │   │   ├── MediaGrid.tsx           # Сетка прикреплённых файлов
│   │   │   ├── InlineButtonsEditor.tsx # Редактор inline-кнопок
│   │   │   ├── ButtonRowEditor.tsx     # Одна строка кнопок
│   │   │   ├── ButtonItemEditor.tsx    # Одна кнопка
│   │   │   └── CharCounter.tsx         # Счётчик символов
│   │   │
│   │   ├── preview/
│   │   │   ├── TelegramPreview.tsx     # Предпросмотр поста
│   │   │   ├── PreviewMessage.tsx      # Пузырь сообщения Telegram
│   │   │   ├── PreviewMedia.tsx        # Медиа в превью
│   │   │   └── PreviewButtons.tsx      # Inline-кнопки в превью
│   │   │
│   │   ├── publish/
│   │   │   ├── PublishPanel.tsx        # Панель публикации (правая)
│   │   │   ├── ChannelSelector.tsx     # Выбор канала
│   │   │   ├── BotSelector.tsx         # Выбор бота
│   │   │   ├── PublishButton.tsx       # Кнопка «Опубликовать»
│   │   │   ├── SchedulePicker.tsx      # Дата/время отложенной публ.
│   │   │   └── PublishOptions.tsx      # Доп. опции (pin, silent)
│   │   │
│   │   ├── channels/
│   │   │   ├── BotCard.tsx             # Карточка бота
│   │   │   ├── BotList.tsx
│   │   │   ├── AddBotModal.tsx         # Диалог добавления бота
│   │   │   ├── ChannelCard.tsx         # Карточка канала
│   │   │   ├── ChannelList.tsx
│   │   │   └── AddChannelModal.tsx
│   │   │
│   │   ├── drafts/
│   │   │   ├── DraftCard.tsx
│   │   │   ├── DraftList.tsx
│   │   │   └── DraftPreviewModal.tsx
│   │   │
│   │   ├── history/
│   │   │   ├── HistoryCard.tsx
│   │   │   ├── HistoryList.tsx
│   │   │   └── HistoryFilters.tsx
│   │   │
│   │   ├── schedule/
│   │   │   ├── ScheduledPostCard.tsx
│   │   │   ├── ScheduledList.tsx
│   │   │   └── RescheduleModal.tsx
│   │   │
│   │   └── ui/                         # Базовые UI-примитивы
│   │       ├── Button.tsx
│   │       ├── IconButton.tsx
│   │       ├── Input.tsx
│   │       ├── Textarea.tsx
│   │       ├── Modal.tsx
│   │       ├── Tooltip.tsx
│   │       ├── Toast.tsx
│   │       ├── ToastContainer.tsx
│   │       ├── Spinner.tsx
│   │       ├── Badge.tsx
│   │       ├── Avatar.tsx
│   │       ├── Divider.tsx
│   │       ├── EmptyState.tsx
│   │       ├── ConfirmDialog.tsx
│   │       ├── DateTimePicker.tsx
│   │       ├── Toggle.tsx
│   │       ├── Select.tsx
│   │       └── ContextMenu.tsx
│   │
│   ├── store/                          # Zustand stores
│   │   ├── editorStore.ts              # Состояние редактора
│   │   ├── draftsStore.ts              # Список черновиков
│   │   ├── channelsStore.ts            # Каналы и боты
│   │   ├── schedulerStore.ts           # Запланированные посты
│   │   ├── historyStore.ts             # История
│   │   ├── settingsStore.ts            # Настройки (тема, язык)
│   │   └── uiStore.ts                  # UI-состояние (модалки, тосты)
│   │
│   ├── hooks/                          # Кастомные хуки
│   │   ├── useAutoSave.ts              # Автосохранение с debounce
│   │   ├── useEditor.ts                # Хук для TipTap instance
│   │   ├── useDragDrop.ts              # Drag & Drop файлов
│   │   ├── useChannels.ts              # Загрузка и кэш каналов
│   │   ├── usePublish.ts               # Логика публикации
│   │   ├── useScheduler.ts             # Работа с расписанием
│   │   ├── useHistory.ts               # История публикаций
│   │   ├── useTheme.ts                 # Переключение темы
│   │   └── useTauriEvent.ts            # Подписка на Tauri события
│   │
│   ├── lib/                            # Утилиты и адаптеры
│   │   ├── tauriApi.ts                 # Типизированные invoke-обёртки
│   │   ├── tiptapConfig.ts             # Конфигурация TipTap расширений
│   │   ├── htmlConverter.ts            # TipTap JSON → Telegram HTML
│   │   ├── mediaUtils.ts               # Работа с файлами (тип, размер)
│   │   ├── dateUtils.ts                # Форматирование дат
│   │   └── constants.ts                # Лимиты Telegram, константы
│   │
│   ├── types/                          # TypeScript типы
│   │   ├── bot.ts
│   │   ├── channel.ts
│   │   ├── draft.ts
│   │   ├── media.ts
│   │   ├── post.ts
│   │   ├── schedule.ts
│   │   ├── history.ts
│   │   ├── settings.ts
│   │   └── telegram.ts                 # Типы Telegram API ответов
│   │
│   ├── styles/
│   │   ├── globals.css                 # CSS-переменные, reset
│   │   ├── theme.css                   # Тёмная/светлая тема (CSS vars)
│   │   └── tiptap.css                  # Стили контента TipTap
│   │
│   ├── extensions/                     # TipTap расширения
│   │   ├── Spoiler.ts                  # Кастомное расширение спойлера
│   │   └── TelegramEmoji.ts            # Расширение для Telegram Emoji
│   │
│   └── main.tsx                        # Точка входа React
│
├── public/
│   └── fonts/                          # Локальные шрифты
│
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
└── index.html
```

---

## 3. База данных

### 3.1 Схема SQLite

#### Таблица `bots`

```sql
CREATE TABLE bots (
    id          TEXT PRIMARY KEY,           -- UUID
    token       TEXT NOT NULL UNIQUE,       -- Bot token (зашифрован AES)
    name        TEXT NOT NULL,              -- Имя бота из Telegram
    username    TEXT NOT NULL,              -- @username бота
    avatar_url  TEXT,                       -- URL аватарки (кэш)
    is_active   INTEGER NOT NULL DEFAULT 1, -- 0 = деактивирован
    created_at  TEXT NOT NULL,              -- ISO 8601
    updated_at  TEXT NOT NULL
);
```

#### Таблица `channels`

```sql
CREATE TABLE channels (
    id              TEXT PRIMARY KEY,       -- UUID
    bot_id          TEXT NOT NULL,          -- FK → bots.id
    telegram_id     TEXT NOT NULL,          -- Chat ID из Telegram
    title           TEXT NOT NULL,          -- Название канала
    username        TEXT,                   -- @username (если публичный)
    description     TEXT,
    avatar_path     TEXT,                   -- Локальный путь к аватарке
    member_count    INTEGER,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);
```

#### Таблица `drafts`

```sql
CREATE TABLE drafts (
    id              TEXT PRIMARY KEY,       -- UUID
    title           TEXT,                   -- Заголовок для удобства
    content_json    TEXT NOT NULL,          -- TipTap JSON (контент)
    content_text    TEXT,                   -- Плоский текст (для поиска)
    parse_mode      TEXT NOT NULL DEFAULT 'HTML',  -- HTML | MarkdownV2
    status          TEXT NOT NULL DEFAULT 'draft', -- draft | published | scheduled | deleted
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
```

#### Таблица `draft_media`

```sql
CREATE TABLE draft_media (
    id          TEXT PRIMARY KEY,           -- UUID
    draft_id    TEXT NOT NULL,              -- FK → drafts.id
    file_path   TEXT NOT NULL,              -- Локальный путь в AppData
    file_name   TEXT NOT NULL,              -- Оригинальное имя файла
    mime_type   TEXT NOT NULL,              -- image/jpeg, video/mp4, etc.
    file_size   INTEGER NOT NULL,           -- Размер в байтах
    width       INTEGER,                    -- Для изображений/видео
    height      INTEGER,
    duration    INTEGER,                    -- Для видео/GIF (секунды)
    sort_order  INTEGER NOT NULL DEFAULT 0, -- Порядок в альбоме
    created_at  TEXT NOT NULL,
    FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE
);
```

#### Таблица `draft_buttons`

```sql
CREATE TABLE draft_buttons (
    id          TEXT PRIMARY KEY,
    draft_id    TEXT NOT NULL,
    row_index   INTEGER NOT NULL,           -- Номер строки клавиатуры
    col_index   INTEGER NOT NULL,           -- Номер кнопки в строке
    label       TEXT NOT NULL,              -- Текст кнопки
    url         TEXT,                       -- URL для url-кнопок
    callback    TEXT,                       -- callback_data
    FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE
);
```

#### Таблица `scheduled_posts`

```sql
CREATE TABLE scheduled_posts (
    id              TEXT PRIMARY KEY,
    draft_id        TEXT NOT NULL,
    channel_id      TEXT NOT NULL,
    bot_id          TEXT NOT NULL,
    scheduled_at    TEXT NOT NULL,          -- ISO 8601, время публикации
    status          TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed | cancelled
    error_message   TEXT,                   -- Сообщение об ошибке
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    FOREIGN KEY (draft_id) REFERENCES drafts(id),
    FOREIGN KEY (channel_id) REFERENCES channels(id),
    FOREIGN KEY (bot_id) REFERENCES bots(id)
);
```

#### Таблица `publication_history`

```sql
CREATE TABLE publication_history (
    id              TEXT PRIMARY KEY,
    draft_id        TEXT,                   -- NULL если черновик удалён
    channel_id      TEXT NOT NULL,
    bot_id          TEXT NOT NULL,
    telegram_msg_id INTEGER,                -- ID сообщения в Telegram
    content_json    TEXT NOT NULL,          -- Снимок контента на момент публикации
    status          TEXT NOT NULL,          -- success | failed
    error_message   TEXT,
    published_at    TEXT NOT NULL,
    FOREIGN KEY (channel_id) REFERENCES channels(id),
    FOREIGN KEY (bot_id) REFERENCES bots(id)
);
```

#### Таблица `settings`

```sql
CREATE TABLE settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);

-- Начальные значения
INSERT INTO settings (key, value) VALUES
    ('theme', 'dark'),
    ('language', 'ru'),
    ('autosave_interval', '2000'),
    ('default_parse_mode', 'HTML'),
    ('default_bot_id', ''),
    ('default_channel_id', ''),
    ('show_char_counter', '1'),
    ('confirm_before_publish', '1');
```

### 3.2 Индексы

```sql
CREATE INDEX idx_drafts_status ON drafts(status);
CREATE INDEX idx_drafts_updated ON drafts(updated_at DESC);
CREATE INDEX idx_scheduled_status_time ON scheduled_posts(status, scheduled_at);
CREATE INDEX idx_history_published ON publication_history(published_at DESC);
CREATE INDEX idx_history_channel ON publication_history(channel_id);
CREATE INDEX idx_channels_bot ON channels(bot_id);
CREATE INDEX idx_draft_media_draft ON draft_media(draft_id, sort_order);
CREATE INDEX idx_draft_buttons_draft ON draft_buttons(draft_id, row_index, col_index);
```

---

## 4. Компоненты React

### 4.1 Иерархия компонентов

```
App
└── Providers (ThemeProvider, ToastProvider)
    └── Router
        ├── OnboardingPage              (если нет ботов)
        └── AppShell
            ├── Sidebar
            │   ├── WindowControls
            │   ├── SidebarItem × N
            │   └── ChannelQuickSwitcher
            │
            └── <Outlet> (страницы)
                │
                ├── EditorPage
                │   ├── TopBar
                │   │   ├── DraftTitle (редактируемый)
                │   │   └── SaveIndicator
                │   ├── PostEditor
                │   │   ├── EditorToolbar
                │   │   │   ├── FormatGroup (жирный, курсив, ...)
                │   │   │   ├── EmojiPicker
                │   │   │   ├── LinkDialog
                │   │   │   └── MediaUploadZone (кнопка)
                │   │   ├── TipTap Editor Content
                │   │   ├── MediaGrid
                │   │   │   └── MediaAttachment × N
                │   │   ├── InlineButtonsEditor
                │   │   │   └── ButtonRowEditor × N
                │   │   │       └── ButtonItemEditor × N
                │   │   └── CharCounter
                │   ├── TelegramPreview (правая панель)
                │   │   ├── PreviewMessage
                │   │   ├── PreviewMedia
                │   │   └── PreviewButtons
                │   └── PublishPanel (нижняя/боковая панель)
                │       ├── ChannelSelector
                │       ├── PublishOptions
                │       ├── SchedulePicker
                │       └── PublishButton
                │
                ├── DraftsPage
                │   ├── DraftList
                │   │   └── DraftCard × N
                │   └── EmptyState
                │
                ├── HistoryPage
                │   ├── HistoryFilters
                │   ├── HistoryList
                │   │   └── HistoryCard × N
                │   └── EmptyState
                │
                ├── SchedulePage
                │   ├── ScheduledList
                │   │   └── ScheduledPostCard × N
                │   │       └── RescheduleModal (по клику)
                │   └── EmptyState
                │
                ├── ChannelsPage
                │   ├── BotList
                │   │   ├── BotCard × N
                │   │   └── AddBotModal
                │   └── ChannelList
                │       ├── ChannelCard × N
                │       └── AddChannelModal
                │
                └── SettingsPage
                    ├── ThemeToggle
                    ├── LanguageSelector
                    ├── AutosaveToggle
                    ├── ParseModeSelector
                    └── DangerZone (сброс данных)
```

### 4.2 Детальное описание ключевых компонентов

#### `PostEditor`

**Пропсы:** `draftId: string | null`

**Состояние:**
- TipTap editor instance
- Список прикреплённых медиа
- Конфигурация inline-кнопок
- Статус автосохранения

**Поведение:**
- При монтировании загружает черновик по `draftId` из Zustand
- TipTap onChange → debounce 2000ms → `useAutoSave` → `invoke("upsert_draft")`
- Поддерживает Drag & Drop через `useDragDrop`

#### `EditorToolbar`

Кнопки форматирования (используют TipTap команды):

| Кнопка | TipTap команда | Telegram тег |
|--------|----------------|--------------|
| **B** | `toggleBold` | `<b>` |
| *I* | `toggleItalic` | `<i>` |
| U | `toggleUnderline` | `<u>` |
| ~~S~~ | `toggleStrike` | `<s>` |
| `</>` | `toggleCode` | `<code>` |
| 👁 | `toggleSpoiler` | `<tg-spoiler>` |
| ❝ | `toggleBlockquote` | `<blockquote>` |
| • | `toggleBulletList` | — (в текст) |
| 1. | `toggleOrderedList` | — (в текст) |
| 🔗 | открыть `LinkDialog` | `<a href>` |
| 😀 | открыть `EmojiPicker` | символ |
| 🖼 | открыть файловый диалог | attachment |

#### `TelegramPreview`

Рендерит HTML-строку (конвертированную из TipTap JSON через `htmlConverter.ts`) в стилизованный div, визуально имитирующий пузырь Telegram-сообщения. Обновляется в реальном времени при вводе текста.

#### `InlineButtonsEditor`

Визуальный конструктор inline-клавиатуры:
- Добавление строк кнопок
- Drag & Drop строк для переупорядочивания
- В каждой строке: добавление/удаление кнопок
- Для каждой кнопки: поля Label и URL/callback

#### `MediaUploadZone`

Принимает:
- Клик → системный файловый диалог
- Drag & Drop файлов прямо на редактор
- Вставка из буфера обмена (Ctrl+V)

Ограничения (по лимитам Telegram):
- Фото: до 10 МБ, JPG/PNG/WEBP
- Видео: до 50 МБ, MP4
- GIF: до 50 МБ, GIF/MP4
- Документы: до 50 МБ, любой тип
- Альбом: до 10 медиа

---

## 5. API-слой (Tauri Commands)

### 5.1 Интерфейс в TypeScript (`src/lib/tauriApi.ts`)

```typescript
// Все функции — типизированные обёртки над invoke()

// ─── БОТЫ ───────────────────────────────────────────────
validateAndAddBot(token: string): Promise<Bot>
getBots(): Promise<Bot[]>
deleteBot(botId: string): Promise<void>
refreshBotInfo(botId: string): Promise<Bot>

// ─── КАНАЛЫ ─────────────────────────────────────────────
addChannel(botId: string, channelUsername: string): Promise<Channel>
getChannels(botId?: string): Promise<Channel[]>
deleteChannel(channelId: string): Promise<void>
refreshChannelInfo(channelId: string): Promise<Channel>

// ─── ЧЕРНОВИКИ ──────────────────────────────────────────
createDraft(): Promise<Draft>
upsertDraft(draft: DraftPayload): Promise<Draft>
getDraft(draftId: string): Promise<Draft>
getDrafts(): Promise<DraftSummary[]>
deleteDraft(draftId: string): Promise<void>
duplicateDraft(draftId: string): Promise<Draft>

// ─── МЕДИА ──────────────────────────────────────────────
uploadMedia(filePath: string, draftId: string): Promise<MediaItem>
deleteMedia(mediaId: string): Promise<void>
reorderMedia(draftId: string, order: string[]): Promise<void>

// ─── ПУБЛИКАЦИЯ ─────────────────────────────────────────
publishPost(draftId: string, channelId: string, options?: PublishOptions): Promise<PublicationResult>
schedulePost(draftId: string, channelId: string, scheduledAt: string): Promise<ScheduledPost>
cancelScheduled(scheduledId: string): Promise<void>
reschedulePost(scheduledId: string, newTime: string): Promise<ScheduledPost>

// ─── ИСТОРИЯ ────────────────────────────────────────────
getHistory(filters?: HistoryFilters): Promise<HistoryItem[]>
getHistoryItem(historyId: string): Promise<HistoryItem>

// ─── РАСПИСАНИЕ ─────────────────────────────────────────
getScheduledPosts(): Promise<ScheduledPost[]>

// ─── НАСТРОЙКИ ──────────────────────────────────────────
getSettings(): Promise<AppSettings>
updateSetting(key: string, value: string): Promise<void>
```

### 5.2 Rust команды

#### Команда `validate_and_add_bot`

1. Вызывает `getMe` из Telegram API с переданным токеном
2. Если успешно — шифрует токен (AES-256-GCM) и сохраняет в `bots`
3. Возвращает `Bot` структуру

#### Команда `add_channel`

1. Вызывает `getChat` из Telegram API с `channel_username`
2. Проверяет, что бот является администратором канала (`getChatMember`)
3. Сохраняет канал в `channels`

#### Команда `upsert_draft`

1. Принимает `DraftPayload { id, title, content_json, media, buttons }`
2. Транзакционно обновляет `drafts`, `draft_media`, `draft_buttons`
3. Обновляет `updated_at`

#### Команда `publish_post`

1. Читает черновик и медиа из SQLite
2. Читает `bot_token` из SQLite (только здесь токен покидает БД)
3. Конвертирует `content_json` → Telegram HTML через `markup.rs`
4. Формирует `InlineKeyboardMarkup` из `draft_buttons`
5. Если нет медиа: `sendMessage`
6. Если 1 фото: `sendPhoto`
7. Если несколько медиа: `sendMediaGroup` (если кнопок нет) + отдельный `sendMessage` с кнопками
8. Записывает результат в `publication_history`
9. Обновляет `draft.status = 'published'`

### 5.3 Tauri Events (Backend → Frontend)

```
"draft:autosaved"           { draftId, updatedAt }
"post:published"            { historyId, channelTitle }
"post:publish_failed"       { draftId, error }
"scheduled:sent"            { scheduledId, channelTitle }
"scheduled:failed"          { scheduledId, error }
"bot:connected"             { botId, botName }
"channel:connected"         { channelId, channelTitle }
```

### 5.4 Конвертер TipTap JSON → Telegram HTML

Файл `markup.rs` (Rust) и `htmlConverter.ts` (TypeScript для превью):

| TipTap Node/Mark | Telegram HTML |
|-----------------|---------------|
| `bold` | `<b>text</b>` |
| `italic` | `<i>text</i>` |
| `underline` | `<u>text</u>` |
| `strike` | `<s>text</s>` |
| `code` | `<code>text</code>` |
| `codeBlock` | `<pre>text</pre>` |
| `spoiler` | `<tg-spoiler>text</tg-spoiler>` |
| `blockquote` | `<blockquote>text</blockquote>` |
| `link` | `<a href="url">text</a>` |
| `bulletList` | `• item\n` (plain text) |
| `orderedList` | `1. item\n` (plain text) |
| `hardBreak` | `\n` |
| `paragraph` | `text\n\n` |

---

## 6. Описание экранов

### 6.1 Onboarding (Первый запуск)

**Триггер:** Таблица `bots` пустая при старте приложения.

**Шаги:**
1. **Приветствие** — логотип Telegram Studio, краткое описание
2. **Добавление бота** — поле ввода токена, кнопка «Подключить», инструкция как создать бота через @BotFather
3. **Добавление канала** — ввод @username канала, проверка что бот является админом
4. **Готово** — переход в главный редактор

**Элементы:** Stepper, анимированный логотип, поле токена с маскировкой, кнопка проверки с индикатором загрузки.

---

### 6.2 Editor (Главный редактор)

**Компоновка:** Три колонки — Sidebar | Редактор | Превью + Панель публикации

```
┌──────────┬────────────────────────────┬─────────────────┐
│          │  [Title input............] │   PREVIEW       │
│ SIDEBAR  │ ─────────────────────────── │                 │
│          │  [B][I][U][S][</>][❝][😀] │  ┌───────────┐  │
│ ○ Editor │  [🖼][📎][🎬][📄][⬛]      │  │ Telegram  │  │
│ ○ Drafts │                           │  │ preview   │  │
│ ○ Sched  │  TIPTAP EDITOR CONTENT    │  │ bubble    │  │
│ ○ History│  (rich text, editable)    │  └───────────┘  │
│ ○ Channels│                          │  [Button1][B2]  │
│ ○ Settings│  ── MEDIA GRID ──        │                 │
│          │  [IMG1][IMG2][+]          │  ─────────────  │
│          │                           │  Channel: ▼     │
│          │  ── INLINE BUTTONS ──     │  [📢 My Channel]│
│          │  [Button][+ Add btn] [+row]│  Bot: ▼        │
│          │                           │  [🤖 MyBot]     │
│          │  Chars: 127 / 4096        │  ⏰ Schedule    │
│          │                           │  [Publish Now]  │
└──────────┴────────────────────────────┴─────────────────┘
```

**Функции:**
- Автосохранение каждые 2 секунды после последнего изменения
- Индикатор сохранения в TopBar («Сохранено • 14:32»)
- Выбор канала и бота в PublishPanel
- Переключение: «Опубликовать сейчас» / «Запланировать»
- При выборе расписания: DateTimePicker
- Счётчик символов с цветовой индикацией (зелёный < 3000, жёлтый < 4000, красный > 4096)

---

### 6.3 Drafts (Черновики)

**Компоновка:** Sidebar | Список карточек (2 колонки)

**Карточка черновика:**
- Заголовок (или первые 50 символов текста)
- Превью текста (2 строки)
- Дата последнего изменения
- Количество медиа (иконки)
- Меню: Открыть, Дублировать, Удалить

**Функции:**
- Поиск по тексту
- Сортировка: по дате, по алфавиту
- Контекстное меню по правому клику
- Массовое удаление (чекбоксы)

---

### 6.4 Schedule (Запланированные публикации)

**Компоновка:** Sidebar | Хронологический список

**Карточка запланированного поста:**
- Превью текста
- Канал назначения (иконка + название)
- Дата и время публикации (крупно)
- Обратный отсчёт («через 2 часа 15 мин»)
- Кнопки: Редактировать время, Отменить, Опубликовать сейчас

**Функции:**
- Группировка по датам
- Индикатор «Сегодня», «Завтра», конкретная дата
- Уведомление в трее при успешной публикации

---

### 6.5 History (История публикаций)

**Компоновка:** Sidebar | Фильтры | Список

**Фильтры:**
- По каналу (мультиселект)
- По дате (диапазон)
- По статусу: все / успешно / ошибки

**Карточка истории:**
- Превью текста
- Канал и бот
- Дата и время публикации
- Статус: ✅ Опубликовано / ❌ Ошибка
- При ошибке: текст ошибки
- Кнопка «Открыть в Telegram» (ссылка на сообщение)
- Кнопка «Создать дубль» → открыть в редакторе

---

### 6.6 Channels (Каналы и боты)

**Компоновка:** Sidebar | Две секции (Боты / Каналы)

**Секция «Боты»:**

Карточка бота:
- Аватар и имя бота
- @username
- Статус (активен / ошибка)
- Количество подключённых каналов
- Кнопки: Обновить, Удалить

Кнопка «+ Добавить бота» → модальное окно с полем токена.

**Секция «Каналы»:**

Карточка канала:
- Аватар, название, @username
- Через какой бот подключён
- Количество участников (если доступно)
- Кнопки: Обновить, Удалить

Кнопка «+ Добавить канал» → модальное окно.

---

### 6.7 Settings (Настройки)

**Секции:**

**Внешний вид:**
- Тема: Тёмная / Светлая / Системная (сегментед-контрол)
- Язык: Русский / English

**Редактор:**
- Автосохранение: вкл/выкл + интервал (1–10 сек)
- Формат текста по умолчанию: HTML / MarkdownV2
- Показывать счётчик символов: вкл/выкл

**Публикация:**
- Подтверждение перед публикацией: вкл/выкл
- Бот по умолчанию: выпадающий список
- Канал по умолчанию: выпадающий список

**Данные:**
- Папка медиафайлов: путь + кнопка «Открыть»
- Размер базы данных
- Кнопка «Экспорт черновиков» (JSON)
- Кнопка «Очистить историю»
- Кнопка «Сбросить всё» (с подтверждением)

**О приложении:**
- Версия, ссылки

---

## 7. Последовательность разработки

### Фаза 1 — Фундамент (Неделя 1–2)

**Цель:** Работающий скелет приложения.

1. Инициализация Tauri 2 проекта (`create-tauri-app`)
2. Настройка Vite + React + TypeScript
3. Подключение TailwindCSS
4. Настройка `tauri-plugin-sql` + `rusqlite`
5. Написание SQL-миграций (все таблицы)
6. Реализация DbPool в Rust (AppState)
7. Базовый AppShell (Sidebar + роутинг)
8. Система тем (CSS-переменные, `useTheme`, ThemeProvider)
9. Базовые UI-примитивы: Button, Input, Modal, Toast
10. WindowControls (кастомные кнопки окна Tauri)

**Результат:** Запускающееся приложение с пустым интерфейсом и рабочей БД.

---

### Фаза 2 — Боты и каналы (Неделя 3)

**Цель:** Возможность подключить бота и канал.

1. Rust: `reqwest` клиент для Telegram API
2. Rust: `validate_and_add_bot` (getMe + сохранение в БД)
3. Rust: `add_channel` (getChat + getChatMember + сохранение)
4. Rust: `get_bots`, `get_channels`, `delete_bot`, `delete_channel`
5. React: `ChannelsPage` (оба раздела)
6. React: `AddBotModal`, `AddChannelModal`
7. React: `BotCard`, `ChannelCard`
8. React: `channelsStore` (Zustand)
9. React: `OnboardingPage` (Stepper с добавлением бота/канала)
10. Логика перенаправления на онбординг при пустой БД

**Результат:** Можно подключить бота и канал, данные сохраняются.

---

### Фаза 3 — Редактор (Неделя 4–5)

**Цель:** Полнофункциональный редактор текста.

1. Установка и настройка TipTap 2 (`@tiptap/react`)
2. Подключение расширений: StarterKit, Underline, Link, TextAlign
3. Кастомное расширение `Spoiler`
4. `EditorToolbar` со всеми кнопками форматирования
5. `EmojiPicker` (библиотека `emoji-mart`)
6. `LinkDialog` (ввод URL с валидацией)
7. `CharCounter` (лимит 4096 символов)
8. `tiptapConfig.ts` (конфигурация всех расширений)
9. `htmlConverter.ts` (TipTap JSON → Telegram HTML для превью)
10. `TelegramPreview` (реалтайм предпросмотр)
11. `PostEditor` (основной компонент)
12. `editorStore` (Zustand)

**Результат:** Полнофункциональный редактор с форматированием и превью.

---

### Фаза 4 — Медиа (Неделя 6)

**Цель:** Прикрепление и предпросмотр медиафайлов.

1. Rust: `fs/media_store.rs` (копирование файлов в AppData)
2. Rust: `upload_media`, `delete_media`, `reorder_media` команды
3. React: `MediaUploadZone` (кнопка + Drag & Drop)
4. `useDragDrop` хук (перехват событий drop на окно)
5. Вставка из буфера обмена (paste event)
6. `MediaGrid` (отображение прикреплённых файлов)
7. `MediaAttachment` (превью с кнопкой удаления)
8. `PreviewMedia` в `TelegramPreview`
9. Валидация типов и размеров файлов
10. Прогресс-бар при загрузке больших файлов

**Результат:** Можно прикреплять изображения, видео, GIF, файлы.

---

### Фаза 5 — Inline-кнопки (Неделя 7)

**Цель:** Редактор inline-клавиатуры.

1. `InlineButtonsEditor` (общий компонент)
2. `ButtonRowEditor` (строка кнопок)
3. `ButtonItemEditor` (отдельная кнопка: label + url)
4. Drag & Drop строк (`@dnd-kit/core`)
5. `PreviewButtons` в `TelegramPreview`
6. Rust: сборка `InlineKeyboardMarkup` из `draft_buttons`
7. Валидация URL кнопок

**Результат:** Полноценный редактор inline-кнопок с превью.

---

### Фаза 6 — Черновики и автосохранение (Неделя 8)

**Цель:** Надёжное сохранение работы.

1. Rust: `upsert_draft`, `get_draft`, `get_drafts`, `delete_draft`, `duplicate_draft`
2. `useAutoSave` хук (debounce 2000ms → invoke)
3. `SaveIndicator` в TopBar
4. `DraftsPage`, `DraftList`, `DraftCard`
5. `draftsStore` (Zustand)
6. Открытие черновика в редакторе
7. Восстановление последнего черновика при старте
8. Дублирование, удаление (с подтверждением)
9. Поиск по черновикам

**Результат:** Автосохранение, список черновиков, восстановление.

---

### Фаза 7 — Публикация (Неделя 9)

**Цель:** Публикация постов в Telegram.

1. Rust: `markup.rs` (конвертер JSON → Telegram HTML)
2. Rust: `publish_post` (полный цикл: текст / фото / альбом / файл)
3. Rust: запись в `publication_history`
4. React: `PublishPanel` (выбор канала + кнопка)
5. React: `ChannelSelector`, `BotSelector`
6. React: `PublishOptions` (silent mode, pin)
7. React: `usePublish` хук
8. Обработка ошибок: нет связи, бот не в канале, превышен лимит
9. Toast-уведомления об успехе / ошибке
10. Tauri Events: `post:published`, `post:publish_failed`

**Результат:** Посты публикуются в Telegram каналы.

---

### Фаза 8 — Планировщик (Неделя 10)

**Цель:** Отложенная публикация.

1. Rust: `scheduler/worker.rs` (tokio task, интервал 60 сек)
2. Rust: `schedule_post`, `cancel_scheduled`, `reschedule_post`
3. Rust: Tauri Event при публикации по расписанию
4. React: `DateTimePicker` (кастомный или библиотека)
5. React: `SchedulePicker` в PublishPanel
6. React: `SchedulePage`, `ScheduledList`, `ScheduledPostCard`
7. React: `RescheduleModal`
8. React: `schedulerStore`
9. Системное уведомление (Tauri notification plugin) при публикации

**Результат:** Посты публикуются автоматически в нужное время.

---

### Фаза 9 — История (Неделя 11)

**Цель:** Полная история публикаций.

1. Rust: `get_history` с фильтрами
2. React: `HistoryPage`, `HistoryList`, `HistoryCard`
3. React: `HistoryFilters` (канал, дата, статус)
4. React: `historyStore`
5. Кнопка «Открыть в Telegram» (ссылка `t.me/channel/msg_id`)
6. Кнопка «Создать дубль» (клонирует в новый черновик)

**Результат:** Просмотр всей истории публикаций с фильтрами.

---

### Фаза 10 — Настройки и финальный polish (Неделя 12)

**Цель:** Настройки, UX-детали, стабильность.

1. Rust: `get_settings`, `update_setting`
2. React: `SettingsPage` (все секции)
3. React: `settingsStore`
4. Системная тема (Tauri OS API)
5. Экспорт черновиков в JSON
6. Иконка в системном трее (Tauri tray)
7. Сохранение размера/позиции окна между сессиями
8. Onboarding-тур для новых пользователей
9. Пустые состояния для всех экранов
10. Обработка всех граничных случаев Telegram API
11. Оптимизация: виртуализация длинных списков (`@tanstack/react-virtual`)

---

### Зависимости

```toml
# Cargo.toml (Rust)
tauri = "2"
tauri-plugin-sql = { features = ["sqlite"] }
rusqlite = { features = ["bundled"] }
serde = { features = ["derive"] }
serde_json = "1"
reqwest = { features = ["json", "multipart"] }
tokio = { features = ["full"] }
aes-gcm = "0.10"               # Шифрование токенов
uuid = { features = ["v4"] }
chrono = { features = ["serde"] }
```

```json
// package.json (Node)
{
  "@tiptap/react": "^2",
  "@tiptap/starter-kit": "^2",
  "@tiptap/extension-underline": "^2",
  "@tiptap/extension-link": "^2",
  "@tiptap/extension-placeholder": "^2",
  "@tiptap/extension-character-count": "^2",
  "@dnd-kit/core": "^6",
  "@dnd-kit/sortable": "^7",
  "emoji-mart": "^5",
  "zustand": "^4",
  "react-router-dom": "^6",
  "@tanstack/react-virtual": "^3",
  "date-fns": "^3",
  "tailwindcss": "^3",
  "clsx": "^2",
  "lucide-react": "^0.400"
}
```

---

*Документ покрывает полный цикл разработки Telegram Studio от архитектуры до деплоя. Каждая фаза самодостаточна и даёт работающий инкремент функциональности.*

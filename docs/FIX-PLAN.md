# План исправлений — Telegram Studio

Сводный план по всем находкам двух ревью:
1. **Код-ревью** по скилу `coding-best-practices` (типизация, безопасность, производительность, архитектура).
2. **Дизайн-ревью** по скилу `design` (типографика, контраст, UX-письмо, токены).

## Принципы (главное — ничего не сломать)

- **Каждое изменение маленькое, изолированное, обратимое.** Никаких «больших рефакторингов за один присест».
- **После каждой фазы — зелёные ворота:**
  - `npx tsc --noEmit` → 0 ошибок
  - `npm test` → 197/197 (базовое значение; после добавления тестов — больше)
  - `cargo check` (в `src-tauri`, после Rust-правок) — при первом запуске долго, дальше кэш
  - Ручной smoke: редактор, автосейв, превью, публикация, обе темы, оба скина
- **Ветка `master` содержит чужие незакоммиченные правки — их не трогаем, ничего не ста́жим и не коммитим без явного запроса.**
- Любая правка, меняющая поведение, сначала делается «рядом» (новая функция/токен), затем переключается одной строкой — откат тривиален.

---

## Фаза 0 — Базовые ворота

| Шаг | Что | Проверка |
|---|---|---|
| 0.1 | Зафиксировать текущее состояние | `git status`, запомнить, что трогаем только по списку |
| 0.2 | Прогнать ворота до правок | `tsc --noEmit` (0), `npm test` (197) |
| 0.3 | (Опционально, долго) | `cargo check` в `src-tauri` |

---

## Фаза 1 — Быстрые безопасные правки (риск: очень низкий)

Каждый пункт самодостаточен и откатывается одной командой `git checkout -- <file>`.

| # | Задача | Файлы | Проверка | Откат |
|---|---|---|---|---|
| 1.1 | Удалить мёртвые Tailwind-токены: `fontFamily.sans: Inter`, `fontFamily.mono: JetBrains Mono`, `accent: #2AABEE` (0 использований) | `tailwind.config.ts` | `tsc`, визуально: шрифты/акцент не изменились (они и не использовались) | `git checkout` |
| 1.2 | Удалить мёртвую зависимость `@tauri-apps/plugin-shell` | `package.json`, `package-lock.json` (`npm uninstall @tauri-apps/plugin-shell`) | `npm test`, сборка dev | `npm install @tauri-apps/plugin-shell@^2.0.1` |
| 1.3 | Типизировать `getHistory`: тип `HistoryItem` в `src/types/history.ts`, `Promise<HistoryItem[]>`, убрать `as` в `SchedulePage.tsx` | `src/lib/tauriApi.ts`, `src/pages/SchedulePage.tsx`, `src/types/history.ts`, `src/pages/HistoryPage.tsx` (если использует) | `tsc` (главная проверка — каст убран, тип сходится с Rust-структурой), ручной просмотр истории | `git checkout` |
| 1.4 | Вынести 4 строки валидации медиа из `editorStore` в i18n (fallback = текущий текст) | `src/store/editorStore.ts`, `src/lib/locales/*.ts` (5 файлов) | `tsc`, `npm test`, попытка прикрепить файл >50 МБ (текст из i18n, все языки) | `git checkout` |
| 1.5 | Разобраться с дублем `listItem`: override в `tiptapConfig.ts:66` осознанный — **не удалять**, а выключить `listItem` в `StarterKit.configure()` (проверить, что override полностью заменяет) | `src/lib/tiptapConfig.ts` | `npm test` (ворнинг «Duplicate extension names» исчез), тесты BlockTable + ручная проверка списков | `git checkout` |

---

## Фаза 2 — Безопасность (риск: низкий–средний, требует ручных проверок)

| # | Задача | Файлы | Проверка | Откат |
|---|---|---|---|---|
| 2.1 | Сузить `assetProtocol.scope` с `["**"]` до директории медиа (напр. `$APPDATA/**/media/**`) **и** убедиться, что `convertFileSrc` (`PostEditor.tsx:445`) продолжает работать | `src-tauri/tauri.conf.json` | Запуск приложения; прикрепить фото → превью в редакторе; открыть черновик с медиа | `git checkout` |
| 2.2 | Убрать `blob:` из `script-src` (в коде blob-скриптов нет) | `src-tauri/tauri.conf.json` | Полный smoke редактора (TipTap, вставка картинок/видео через `blob:` — это `img-src`/`media-src`, они остаются), слаш-команды, превью | `git checkout` |
| 2.3 | Починить интерполяцию пути exe в `spawn_elevated_helper` (кавычки/`$` в пути установки) | `src-tauri/src/telegram/winbypass.rs` | Windows-сборка (`cargo check --target x86_64-pc-windows-msvc`), ручной тест UAC-промпта с путём без спецсимволов (поведение не меняется), затем с `'` в пути | откат одной функции |
| 2.4 | Вынести хост-константы (api.telegram.org, supabase) в единый источник — `tstudio_core` (константы + их использование в `winbypass.rs` и `client.rs`) | `src-tauri/core/src/*`, `src-tauri/src/telegram/winbypass.rs`, `src-tauri/src/telegram/client.rs`, `src-tauri/src/commands/winbypass.rs` | `cargo check`, `cargo test` (в core), ручной smoke публикации (прямой путь + релей) | откат по файлам |

> Примечание: саму фичу winbypass (обход DPI) **не трогаем** — только хрупкое цитирование в её запуске. Она документирована в `docs/telegram-blocking-bypass.md`.

---

## Фаза 3 — Дизайн-токены (риск: низкий, визуальная проверка)

| # | Задача | Файлы | Проверка | Откат |
|---|---|---|---|---|
| 3.1 | Контраст `--text-muted` до AA (4.5:1): light `#9b9a97` → ~`#6f6e6b`, dark `#787774` → ~`#8a8a87`. **Обновить и `designs.css` (soft-скин)** — там свои значения muted | `src/styles/theme.css`, `src/styles/designs.css` | Визуально обе темы × оба скина: подписи, таймстампы, метки; проверить, что muted всё ещё различим от secondary/primary | `git checkout` |
| 3.2 | Заменить хардкод-тени `rgba(0,0,0,…)` на `var(--shadow-sm/md/lg)` (~8 мест: NewPostChooserDialog, BlockHoverControls, BlockPalette, EmojiPicker, EditorContextMenu, InlineBubbleMenu, ColorPicker) | перечисленные компоненты | Визуально: модалки/попапы/меню в обеих темах | `git checkout` |
| 3.3 | Цвета EmojiPicker `#f0f0f0`/`#2a2a2a` → токены (`--bg-elevated` и т.п.) | `src/components/editor/EmojiPicker.tsx` | Визуально оба режима | `git checkout` |
| 3.4 | (Опционально) Масштабирование текста: расширить `largeFontEditor` на весь UI или задокументировать как известный гэп | `src/store/settingsStore.ts`, `src/styles/*.css` | Не спешить: сначала обсудить подход | — |

---

## Фаза 4 — Рефакторинг без изменения поведения (риск: средний, только из-за размера)

| # | Задача | Файлы | Проверка | Откат |
|---|---|---|---|---|
| 4.1 | Разбить `publish.rs` (1277 строк) на модули: `publish.rs`, `schedule.rs`, `rich.rs`, `poll.rs` — **чистый перенос кода, без правок логики** | `src-tauri/src/commands/` (модули + `mod.rs`) | `cargo check`, `cargo test` (core), ручной smoke: публикация текста/фото/альбома, расписание, rich-пост, опрос | `git checkout` + перенос назад |
| 4.2 | Типизировать TipTap-расширения: `NodeViewProps` вместо `any` (BlockImage, BlockFAQ, BlockCallout и др.), команды (`toggleBlockquoteExpandable`) через расширение интерфейса `Commands` | `src/extensions/*.tsx`, `src/components/editor/EditorToolbar.tsx`, `EditorContextMenu.tsx`, `PublishPanel.tsx` | `tsc` (главное), `npm test`, ручная проверка блоков | `git checkout` (по файлу) |

---

## Фаза 5 — Оптимизация (риск: средний — меняется поведение автосейва)

| # | Задача | Файлы | Проверка | Откат |
|---|---|---|---|---|
| 5.1 | Кэшировать base64 вложений по `fileId` (сейчас каждый автосейв перекодирует файлы до 50 МБ через `FileReader`); инвалидация при `removeFile`/`clearAll`; при публикации — читать актуальные байты из кэша | `src/hooks/useAutoSave.ts`, `src/lib/fileRegistry.ts`, `src/store/attachmentStore.ts` | `tsc`, `npm test`, ручной: прикрепить большое фото → дождаться 2–3 автосейва (без повторов кодирования), публикация проходит с корректными файлами | `git checkout` |

---

## Фаза 6 — Тесты и финальные ворота

| # | Задача | Файлы | Проверка |
|---|---|---|---|
| 6.1 | Добавить тесты на сторы: `publishStore`, `attachmentStore` (лимиты, дедуп), `settingsStore` (персист/регидрация) | `src/store/*.test.ts` | `npm test` |
| 6.2 | Тест `useAutoSave`-логики (debounce, дедуп ошибок) — через вынесенную чистую функцию | `src/hooks/useAutoSave.test.ts(x)` | `npm test` |
| 6.3 | Финальные ворота: `tsc --noEmit`, `npm test`, `cargo check`, ручной smoke-чеклист (см. Фазу 0) | — | все зелёные |

---

## Что НЕ трогаем (осознанно)

- **Winbypass как фичу** — обход DPI (только фикс цитирования, п. 2.3).
- **Неоморфизм soft-скина** — осознанный визуальный выбор (только контраст muted, п. 3.1).
- **Rust `expect()` в setup** (`lib.rs`) — fail-fast на старте приемлем.
- **Логику лицензий, миграции БД, схему SQLite** — без изменений.
- **Чужие незакоммиченные правки в `master`** — не ста́жим, не коммитим.

## Рекомендуемый порядок

1. Фаза 0 (ворота) → 2. Фаза 1 (1.1–1.4) → 3. Фаза 2 (2.1, 2.2) → 4. Фаза 3 → 5. Фаза 2.3–2.4 (Rust) → 6. Фаза 4 → 7. Фаза 5 → 8. Фаза 6.

Порядок выбран так, чтобы сначала шли правки, которые **не могут ничего сломать** (удаление мёртвого кода, типизация), затем — конфиги с ручной проверкой, и только потом рефакторинг и оптимизация, каждая — с откатом.

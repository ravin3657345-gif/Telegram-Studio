# Кастомные правки Android-проекта (отслеживаются в git)

Папка `src-tauri/gen/android/` — генерируемый Tauri-проект: он в `.gitignore`
и пересоздаётся с нуля при `npx tauri android init`. Поэтому кастомные правки,
которые нельзя выразить в `tauri.conf.json`, хранятся здесь как эталонные
файлы и накладываются скриптом поверх сгенерированного проекта.

## Что здесь лежит

| Файл | Кастомное изменение |
|---|---|
| `MainActivity.kt` | `enableEdgeToEdge()` (контент под статус-баром и жестовой полосой) + `useWideViewPort = true` (WebView уважает `width=device-width`; **без** `loadWithOverviewMode` — это флаг старого 75% зума). |
| `AndroidManifest.xml` | `android:windowSoftInputMode="adjustResize"` у `MainActivity` — нативная подстройка под клавиатуру (ручной `visualViewport` в коде остался только как подстраховка). |

## Как пользоваться

После любой регенерации проекта (или просто для подстраховки перед сборкой):

```bash
npx tauri android init      # регенерирует src-tauri/gen/android/ (стирает правки)
npm run android:patch       # возвращает правки на место
npx tauri android build --target aarch64 --apk
```

Скрипт `scripts/apply-android-patches.ps1` идемпотентен: просто копирует
эталонные файлы в `gen/android` и проверяет, что каждая правка на месте.

## Важно при обновлении Tauri

Если версия Tauri обновится и её шаблон `AndroidManifest.xml` изменится
(новый `activity`, `provider`, разрешение и т.п.), не перезаписывайте его
нашим эталоном вслепую — синхронизируйте новые части шаблона в этот файл,
сохранив нашу строку `windowSoftInputMode="adjustResize"`. Для
`MainActivity.kt` риск минимален (ванильный шаблон — пустой стаб), но при
изменениях — тоже переносите их сюда.

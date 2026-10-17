# M1 — Ядро проекта и редактор карты: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пользователь создаёт проект, рисует карту плитками (кисть, ластик, undo/redo), сохраняет, закрывает и открывает снова без потери данных; формат версионирован и защищён от порчи.

**Architecture:** Три пакета и оболочка. `@nestst/core` — чистая логика без Pixi и без UI: схемы zod, миграции, операции с историей, загрузка и сохранение через интерфейс `ProjectStorage`. `@nestst/runtime` — отрисовка карты на PixiJS (вынесена из прототипа M0). `@nestst/editor` — приложение Tauri + React, использует оба. Оболочка Tauri отдаёт редактору безопасные файловые команды, ограниченные папкой проекта.

**Tech Stack:** TypeScript 7, zod 4, vitest 5, PixiJS 8, React 19, Tauri 2 (+ `tauri-plugin-dialog`), pnpm workspace. Версии берутся из lock-файла M0 (pixi.js 8.22.0, react 19.3.1, zod 4.6.7, vite 8.3.4, vitest 5.0.5, tauri 2.12.x).

**Spec:** `docs/superpowers/specs/2026-10-18-nestst-design.md` (разделы 4, 5, 6 MVP, 9); итоги M0: `docs/m0-report.md` (раздел 7 «Риски для M1»).

## Global Constraints
- Linux (CachyOS), Tauri подтверждён владельцем; путь проекта содержит кириллицу — проекты пользователя тоже могут лежать в путях с кириллицей и пробелами.
- `core` не зависит от Pixi, React, Tauri и Node API; доступ к файлам только через `ProjectStorage`.
- У каждого JSON-файла проекта поле `schemaVersion` (в M1 равно 1); карта имеет `viewMode` (единственное значение `"topdown"`); неизвестные ключи при загрузке сохраняются и записываются обратно (никакой тихой потери данных из более новых файлов).
- Все сообщения пользователю на русском простым языком; идентификаторы английские.
- Никакой тихой перезаписи: запись файла атомарная (временный файл + переименование); при ошибке старый файл остаётся.
- Служебные команды замеров и сбоя графики (`is_bench`, `is_gpufail`, `report_metric`, `exit_app`) не попадают в релиз-сборку редактора.
- Лицензия MIT; секретов в репозитории нет; ИИ в M1 не используется.
- Коммиты оканчиваются строкой `Gikka Ink 2026`; работа в ветке `m1-core`.
- Скорость и память не обещаются: измеряются и записываются в отчёт.

## Решения плана (приняты контролёром, не оговорены в спецификации)
- Формат: `nestst.project.json` (манифест) + `maps/<id>.json` по файлу на карту; `id` — строка `^[a-z0-9][a-z0-9_-]{0,63}$` (защита от выхода из папки проекта).
- Плитки: `0` — пусто, допустимые значения `0..255` (`MAX_TILE_ID = 255`); размеры карты `1..2048`; слоёв `1..16`.
- Набор плиток в M1 встроенный (`tilesetId: "builtin"`, цветные квадраты, как в прототипе); импорт картинок — позднее.
- Предпросмотр игры (движение игрока, коллизии, события) — M2; в M1 «предпросмотр» = отрисовка карты рантаймом внутри редактора.
- Прототипы `prototypes/m0` и `prototypes/m0-electron` не удаляются и не правятся.

## Review Focus
1. Повреждённый или пустой JSON-файл карты/манифеста: загрузка отказывает русским сообщением с именем файла, остальные файлы не затрагиваются (Задача 4).
2. Прерванное сохранение (ошибка записи посреди проекта): проект остаётся читаемым, ни один файл не записан наполовину (каждый целиком старый или целиком новый; смешение старого манифеста с новой картой допустимо и не ломает загрузку) (Задачи 4, 7).
3. Файл из более новой версии формата (`schemaVersion` больше текущей): отказ с понятным текстом «обновите NestST», без искажения файла; неизвестные ключи внутри текущей версии переживают загрузку и сохранение (Задачи 2–3).
4. Операции рисования с координатами вне карты, отрицательными, нецелыми или с id плитки больше 255, а также `undo` на пустой истории: отказ или пустая операция без падения (Задача 5).
5. Имя проекта с кириллицей, пробелами и спецсимволами, пустое имя, и `id` карты с `../` или `/`: проект создаётся и открывается из такой папки, небезопасный `id` отклоняется (Задачи 2, 4, 6).

## Делегирование (экономия токенов)
`worker` (sonnet) — реализация задач; `scout`/haiku — механические шаги; финальное ревью — `architect` (opus); тексты README/отчёта — `gemini` (agy) по желанию. Каждая задача: исполнитель → ревью (sonnet) → при замечаниях одна-две исправительные итерации.

## Файлы
- `package.json`, `pnpm-workspace.yaml` (добавить `packages/*`, `apps/*`), `vitest.workspace.ts`
- `packages/core/`: `package.json`, `src/index.ts`, `src/schema.ts`, `src/errors.ts`, `src/migrate.ts`, `src/history.ts`, `src/mapOps.ts`, `src/project.ts`, `src/storage.ts`, `src/nodeStorage.ts` (только для тестов), `src/*.test.ts`
- `packages/runtime/`: `package.json`, `src/index.ts`, `src/tileMapView.ts`, `src/chunks.ts`, `src/tileset.ts`, `src/chunks.test.ts`
- `apps/editor/`: `package.json`, `index.html`, `vite.config.ts`, `src/main.tsx`, `src/editorStore.ts`, `src/editorStore.test.ts`, `src/components/*`, `src/tauriStorage.ts`, `src-tauri/` (Cargo.toml, `src/lib.rs`, `src/files.rs`, `tauri.conf.json`, `capabilities/default.json`)
- `docs/m1-report.md`

---

### Task 1: Структура монорепозитория
**Files:** Modify `pnpm-workspace.yaml`, `package.json`; Create `vitest.workspace.ts`, `packages/core/package.json`, `packages/runtime/package.json`, `apps/editor/package.json` (пустые каркасы с `name`, `private`, `type: module`, скрипт `test`).

**Interfaces:** Produces: пакеты `@nestst/core`, `@nestst/runtime`, `@nestst/editor`; `pnpm -r test` запускает тесты всех пакетов (в том числе `prototypes/*`); `@nestst/runtime` и `@nestst/editor` зависят от `@nestst/core` через `workspace:*`.

- [ ] **Step 1:** Создать каркасы и зависимости; `pnpm install` без ошибок.
- [ ] **Step 2: Verify:** `pnpm -r test` завершается кодом 0 (прототипные тесты M0 по-прежнему проходят: 23 теста).
- [ ] **Step 3: Commit** — `chore(m1): monorepo packages scaffold`.

### Task 2: Схемы формата проекта
**Files:** Create `packages/core/src/schema.ts`, `packages/core/src/errors.ts`, `packages/core/src/schema.test.ts`; Modify `packages/core/src/index.ts`.

**Interfaces:** Produces:
- `const CURRENT_SCHEMA_VERSION = 1`, `const MAX_TILE_ID = 255`
- zod-схемы и выведенные типы (`z.infer`, без ручных дублей): `TileLayer {id: string; name: string; visible: boolean; tiles: number[]}`, `GameMap {schemaVersion: 1; id: string; name: string; viewMode: 'topdown'; width: number; height: number; tileSize: number; layers: TileLayer[]}`, `ProjectManifest {schemaVersion: 1; name: string; resolution: {width: number; height: number}; tileSize: number; maps: {id: string; file: string}[]; startMapId: string}`
- `class NestError extends Error {code: string; file?: string}` — все сообщения на русском
- `parseMap(raw: unknown, file?: string): GameMap`, `parseManifest(raw: unknown, file?: string): ProjectManifest` — бросают `NestError`
- Схемы используют `.loose()` (неизвестные ключи сохраняются), русские тексты ошибок для **каждого** поля через общую карту ошибок zod (не только `id`/`kind`).

- [ ] **Step 1: Write the failing tests** (`schema.test.ts`): валидная карта 4×3 с двумя слоями проходит; `layers[].tiles.length !== width*height` → сообщение содержит «размер слоя»; `width: 0`, `width: 2049`, нецелое `width`, id плитки `256` и `-1` → `NestError` на русском (проверять, что сообщение не содержит английских слов вроде «Invalid» или «expected»); `viewMode: 'sideview'` → отказ; `id: '../x'`, `id: 'A'`, пустой `id` → отказ; неизвестный ключ `extra: 1` на карте и в слое сохраняется в результате `parseMap`; `maps[].file` должен быть `maps/<id>.json` и `startMapId` обязан быть среди `maps` → отказ с понятным текстом.
- [ ] **Step 2: Run** `pnpm -F @nestst/core test` — FAIL.
- [ ] **Step 3: Implement** схемы и `parseMap`/`parseManifest`; ошибки собираются из первой проблемы с путём к полю по-русски («в карте «<имя>», поле width: должно быть целое число от 1 до 2048»).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(core): versioned project schemas with Russian errors`.

### Task 3: Миграции и защита от более новых версий
**Files:** Create `packages/core/src/migrate.ts`, `packages/core/src/migrate.test.ts`.

**Interfaces:** Consumes: `parseMap`, `parseManifest`, `CURRENT_SCHEMA_VERSION`. Produces: `migrateRaw(kind: 'manifest' | 'map', raw: unknown, steps?: MigrationStep[]): unknown` где `MigrationStep {kind: 'manifest' | 'map'; from: number; to: number; run(raw: Record<string, unknown>): Record<string, unknown>}`; `const MIGRATIONS: MigrationStep[] = []` (пусто в M1); при `schemaVersion` выше текущей — `NestError` с кодом `schema_too_new` и текстом «Файл создан более новой версией NestST (версия формата N). Обновите программу»; при отсутствии/неверном `schemaVersion` — понятная ошибка.

- [ ] **Step 1: Write the failing tests:** цепочка фиктивных шагов `0→1` (на тестовых данных) применяется по порядку; `schemaVersion: 2` → `schema_too_new`, исходный объект не изменён (проверить по глубокому равенству копии); отсутствие версии → ошибка; пропущенный шаг (нет пути `0→1`) → ошибка; неизвестные ключи проходят миграцию.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `migrateRaw` (работает на копии, `structuredClone`). **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(core): schema migrations and too-new-version guard`.

### Task 4: Хранилище, загрузка и сохранение проекта
**Files:** Create `packages/core/src/storage.ts`, `packages/core/src/project.ts`, `packages/core/src/nodeStorage.ts`, `packages/core/src/project.test.ts`.

**Interfaces:** Consumes: `parseMap`, `parseManifest`, `migrateRaw`. Produces:
- `interface ProjectStorage { read(path: string): Promise<string>; writeAtomic(path: string, data: string): Promise<void>; exists(path: string): Promise<boolean> }` — пути относительные, с `/`
- `interface Project { manifest: ProjectManifest; maps: Record<string, GameMap> }`
- `createEmptyProject(name: string): Project` — пустое имя → `NestError`; одна карта `main` 32×24, один слой «Земля», `tileSize: 32`, `resolution {1280, 720}`, `startMapId: 'main'`
- `saveProject(storage: ProjectStorage, project: Project): Promise<void>` — сначала все карты, **манифест последним**; перед записью проверяет все данные схемами
- `loadProject(storage: ProjectStorage): Promise<Project>` — читает манифест, затем карты, каждый файл через `migrateRaw` и `parse*`; ошибки содержат имя файла
- `NodeFsStorage(rootDir: string): ProjectStorage` в `nodeStorage.ts` (для тестов, `node:fs`, запись через временный файл + `rename`) и `MemoryStorage` (Map в памяти, с возможностью «сломать» запись на N-м вызове)

- [ ] **Step 1: Write the failing tests:** (а) круг: `createEmptyProject('Моя игра')` → `saveProject` → `loadProject` равны; то же через `NodeFsStorage` во временной папке с именем «Мой проект с пробелами» (кириллица + пробелы); (б) повреждённый JSON карты → `NestError`, сообщение содержит `maps/main.json`; пустой файл → то же; (в) прерванное сохранение: проект с двумя картами, `MemoryStorage` у которого запись падает на 2-м вызове; после ошибки `saveProject` бросает `NestError`, а `loadProject` всё равно читает проект без ошибок и без битых файлов (каждый файл целиком старый или целиком новый, манифест — старый, так как пишется последним); проверить также, что ни один файл не остался наполовину записанным; (г) манифест ссылается на отсутствующую карту → ошибка с именем файла; (д) неизвестный ключ в манифесте и карте переживает круг; (е) `startMapId` без карты → ошибка; (ж) пустое имя проекта → отказ.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(core): project load/save through ProjectStorage`.

### Task 5: Операции над картой и история (undo/redo)
**Files:** Create `packages/core/src/history.ts`, `packages/core/src/mapOps.ts`, `packages/core/src/mapOps.test.ts`, `packages/core/src/history.test.ts`.

**Interfaces:** Consumes: `GameMap`, `Project`, `MAX_TILE_ID`. Produces:
- `interface TileEdit {layerId: string; x: number; y: number; tile: number}`
- `paintTiles(map: GameMap, edits: TileEdit[]): GameMap` — чистая функция (новый объект); невалидная правка (вне карты, нецелое, отрицательное, `tile` вне `0..255`, неизвестный слой) → `NestError`, карта не меняется; пустой список → та же карта
- `type Command = {label: string; apply(p: Project): Project; revert(p: Project): Project}`, `paintCommand(mapId: string, edits: TileEdit[], before: GameMap): Command`
- `class History { constructor(limit?: number); push(cmd: Command, p: Project): Project; undo(p: Project): Project; redo(p: Project): Project; readonly canUndo: boolean; readonly canRedo: boolean }` — лимит по умолчанию 200, новая правка после `undo` сбрасывает redo

- [ ] **Step 1: Write the failing tests:** рисование и стирание (`tile: 0`) в слое меняют ровно нужные ячейки; координаты `-1`, `width`, `1.5`, `tile: 256`, неизвестный `layerId` → `NestError`, исходная карта не изменилась; `undo` на пустой истории возвращает проект без изменений и `canUndo === false`; push→undo→redo возвращает то же, push после undo очищает redo; лимит 200: 201-я правка вытесняет самую старую без ошибки.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (правки применяются партиями, чтобы один мазок кисти был одним шагом истории). **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(core): tile painting operations with undo/redo history`.

### Task 6: Рантайм карты (PixiJS)
**Files:** Create `packages/runtime/src/chunks.ts`, `chunks.test.ts`, `tileset.ts`, `tileMapView.ts`, `index.ts`; Source reference: `prototypes/m0/src/map/tilemap.ts` (переносить идеи, не копировать валидацию — она теперь в `core`).

**Interfaces:** Consumes: `GameMap` из `@nestst/core`. Produces:
- `visibleChunkRange(view: {x: number; y: number; width: number; height: number; scale: number}, map: {width: number; height: number; tileSize: number}, chunkSize: number, margin: number): {x0: number; y0: number; x1: number; y1: number}` — чистая функция, границы ограничены картой
- `createBuiltinTileset(renderer: Renderer, tileSize: number): Texture[]` (255 цветов детерминированно, индекс = id−1)
- `createTileMapView(app: Application, map: GameMap, tileset: Texture[]): {container: Container; setMap(map: GameMap): void; setCamera(x: number, y: number, scale: number): void; destroy(): void}` — рисует только видимые куски 16×16; куски в запасе вне экрана скрыты (`visible = false`, не нарисованы); `setMap` перерисовывает **только изменившиеся** слои/куски при правке одной ячейки; неизвестный id плитки рисуется заметной плитой-заглушкой, а не `undefined`

- [ ] **Step 1: Write the failing tests** (`chunks.test.ts`): диапазон для карты 1000×1000 при масштабе 1 и 0.25 (при уменьшении диапазон растёт, но не выходит за границы карты); `margin` 0 и 2; карта меньше экрана → диапазон ровно вся карта; отрицательная камера → ограничение 0.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** функции и вид. **Step 4: Run** — PASS.
- [ ] **Step 5: Verify:** `pnpm -F @nestst/runtime build`/`tsc` без ошибок.
- [ ] **Step 6: Commit** — `feat(runtime): tile map view with chunk culling`.

### Task 7: Файловые команды Tauri и безопасность оболочки
**Files:** Create `apps/editor/src-tauri/src/files.rs`, tests inline (`#[cfg(test)]`), `apps/editor/src-tauri/Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, `src/lib.rs`, `src/main.rs`.

**Interfaces:** Produces Tauri-команды: `open_project_dialog() -> Option<String>` и `new_project_dialog() -> Option<String>` (папка через `tauri-plugin-dialog`; корень запоминается в состоянии приложения), `project_read(path: String) -> Result<String, String>`, `project_write_atomic(path: String, data: String) -> Result<(), String>`, `project_exists(path: String) -> Result<bool, String>`. Функция `resolve_in_root(root: &Path, rel: &str) -> Result<PathBuf, String>` — отвергает абсолютные пути, `..`, пустые сегменты, обратный слеш; сообщения на русском. Запись: временный файл рядом + `fsync` + `rename`. `csp` задан строго (`default-src 'self'`, картинки `'self' data: blob:`, без `unsafe-eval`). Команды замеров/сбоя графики из M0 в приложение редактора **не переносятся**.

- [ ] **Step 1: Write the failing Rust tests:** `resolve_in_root` отвергает `../x`, `/etc/passwd`, `a/../../b`, `a\\b`, пустую строку; принимает `maps/main.json`, `maps/кириллица.json`; `project_write_atomic` создаёт недостающие папки, перезаписывает файл целиком, при ошибке (запись в несуществующий корень) оставляет старый файл нетронутым.
- [ ] **Step 2: Run** `cargo test` в `apps/editor/src-tauri` — FAIL (функции нет).
- [ ] **Step 3: Implement** команды и регистрацию плагина dialog; права в `capabilities/default.json` минимальные (только нужные).
- [ ] **Step 4: Run** `cargo test` — PASS; `pnpm -F @nestst/editor tauri build --no-bundle` собирается из кириллического пути.
- [ ] **Step 5: Commit** — `feat(editor): sandboxed Tauri file commands and strict CSP`.

### Task 8: Состояние редактора и экран карты
**Files:** Create `apps/editor/src/tauriStorage.ts`, `editorStore.ts`, `editorStore.test.ts`, `main.tsx`, `components/StartScreen.tsx`, `components/MapEditor.tsx`, `components/Palette.tsx`, `components/Toolbar.tsx`, `components/ErrorBanner.tsx`, `index.html`, `vite.config.ts`.

**Interfaces:** Consumes: `@nestst/core` (`createEmptyProject`, `loadProject`, `saveProject`, `paintTiles`, `paintCommand`, `History`, `NestError`), `@nestst/runtime` (`createTileMapView`, `createBuiltinTileset`), команды Tauri из Задачи 7. Produces:
- `TauriStorage implements ProjectStorage` (`tauriStorage.ts`)
- `createEditorStore(storage: ProjectStorage)` (чистая логика без React, тестируется): состояние `{project: Project | null; currentMapId; tool: 'brush' | 'eraser'; selectedTile: number; dirty: boolean; error: string | null}` и действия `newProject(name)`, `open()`, `save()`, `paintStroke(edits: TileEdit[])`, `undo()`, `redo()`, `selectTool`, `selectTile`; `dirty` истинно после правки и ложно после успешного сохранения; ошибки превращаются в `error` на русском, программа не падает
- UI: стартовый экран (создать, открыть); редактор: карта по центру с зумом колесом и панорамой средней кнопкой/пробелом, палитра плиток слева (255 → показывать первые 32), кисть и ластик, Ctrl+Z/Ctrl+Shift+Z, Ctrl+S, индикатор «есть несохранённые изменения» в заголовке, баннер ошибки с текстом простым языком; при закрытии с несохранёнными изменениями — запрос подтверждения

- [ ] **Step 1: Write the failing tests** (`editorStore.test.ts`, `MemoryStorage` из core, happy-dom не нужен): `newProject` → `dirty` false; `paintStroke` → `dirty` true и `undo` возвращает карту к исходной; `save` → `dirty` false и повторная `open` читает равный проект; ошибка записи (сломанное хранилище) → `error` непустой на русском, `dirty` остаётся true, проект не потерян; `paintStroke` с координатой вне карты → `error`, проект не изменился; `open` по повреждённому файлу → `error` с именем файла, текущий проект не заменён.
- [ ] **Step 2: Run** `pnpm -F @nestst/editor test` — FAIL. **Step 3: Implement** хранилище состояния, затем интерфейс. **Step 4: Run** тесты — PASS; `tsc` чисто.
- [ ] **Step 5: Commit** — `feat(editor): editor store, start screen and tile painting UI`.

### Task 9: Сквозная проверка M1 и отчёт
**Files:** Create `packages/core/src/e2e.test.ts` (сценарий через `NodeFsStorage`), `docs/m1-report.md`; Modify `README.md`.

**Interfaces:** Consumes: всё выше.

- [ ] **Step 1: Write the test** `e2e.test.ts`: создать проект «Тест с пробелами и кириллицей» → нарисовать мазок и стереть часть → `undo` → сохранить в папку с кириллицей и пробелами → загрузить другим экземпляром хранилища → карты равны; повреждение одного `maps/main.json` после сохранения → понятная ошибка с именем файла; проект с неизвестным ключом в карте переживает круг.
- [ ] **Step 2: Run** `pnpm -r test` — PASS (все пакеты) и `cargo test` — PASS.
- [ ] **Step 3:** Собрать `pnpm -F @nestst/editor tauri build --no-bundle` из кириллического пути, запустить приложение и записать в `docs/m1-report.md` на простом русском: что сделано, как запустить, что проверено автоматически, что владельцу нужно проверить глазами (создать проект, порисовать, Ctrl+Z, сохранить, закрыть, открыть), измеренные запуск и память (`scripts/measure.sh` адаптировать под `apps/editor`, если дёшево, иначе указать не измерено), известные ограничения (нет импорта картинок, нет предпросмотра игры, один тип вида).
- [ ] **Step 4:** В `README.md` обновить статус и команды.
- [ ] **Step 5: Commit** — `docs(m1): report, README and end-to-end project test`.

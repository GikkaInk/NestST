# M0 — Прототип рисков: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** За 5 задач проверить на железе пользователя, что связка Tauri + PixiJS + узловой редактор работает, измерить запуск, память и FPS, и принять решение «Tauri или Electron».

**Architecture:** Одноразовый прототип в `prototypes/m0/` (веб-часть на Vite + TypeScript, оболочка Tauri 2). Две проверяемые чистые функции (проверка карты, разбор графа диалога) покрыты тестами и могут уйти в M1; всё остальное — измерительный стенд. Результат — `docs/m0-report.md` с цифрами и решением.

**Tech Stack:** TypeScript, Vite, PixiJS 8, Tauri 2 (+Rust через rustup), React + `@xyflow/react` (только прототип узлового редактора; выбор UI-фреймворка для M1 подтверждается результатом M0), zod, vitest, pnpm. Версии на 2026-10-18: pixi.js 8.22.0, @tauri-apps/cli 2.12.3, vite 8.3.4, typescript 7.0.2, vitest 5.0.5, @xyflow/react 12.12.0, zod 4.6.7. Если пакеты конфликтуют, закрепить совместимые версии и записать в отчёт.

**Spec:** `docs/superpowers/specs/2026-10-18-nestst-design.md` (разделы 3, 4, 9, 10)

## Global Constraints
- Платформа Linux (CachyOS, GTX 1660 Ti, 15 ГБ RAM); `webkit2gtk-4.1`, `gtk3`, `base-devel` уже установлены; Rust не установлен.
- Лицензия MIT; ключи и секреты не попадают в репозиторий и в `prototypes/`. Ключ ИИ живёт вне проекта (файл вне проекта (права 600)) и в M0 не используется.
- Скорость и память не обещаются заранее: все цифры измеряются и записываются как есть.
- Пользователю: отчёты и сообщения простым русским; код и идентификаторы английские. Тексты ошибок для пользователя на русском.
- Путь проекта содержит кириллицу (`~/Проекты/NestST`); всё должно собираться и работать из него.
- Коммиты оканчиваются строкой `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Установка Rust (rustup, ~/.cargo, без sudo) и любые `sudo`-команды выполняются только с явного согласия пользователя.
- Никаких платных ИИ-запросов в M0.

## Review Focus
1. Папка проекта с кириллицей в пути: сборка Tauri и запуск работают (Задача 2).
2. Нет WebGL/сбой GPU-контекста: приложение показывает понятную русскую ошибку, а не белый экран (Задача 3).
3. Карта 1000×1000 тайлов: память и FPS измерены, зависание не допускается (Задача 3).
4. Файл графа диалога с неизвестным типом узла, битой ссылкой `next`, повторяющимся `id` или без стартового узла: разбор отказывает с понятной русской причиной (Задача 4).
5. Пустой граф и граф с циклом (узел ссылается на себя): пустой отклоняется, цикл допускается (диалоги могут возвращаться) без зависания (Задача 4).

## Делегирование (экономия токенов)
Рутина идёт агентам: `scout` — установка, запуск команд, сбор вывода; `worker` — реализация задач 3–4; `gemini` (agy) — черновики текста отчёта и README; `architect` — только финальный разбор решения «Tauri или Electron», если цифры спорные. Контролёр сессии проверяет результат каждой задачи по критерию в её последнем шаге.

## Файлы
- Создать: `.gitignore`, `LICENSE`, `README.md`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- `prototypes/m0/`: `package.json`, `index.html`, `vite.config.ts`, `src/main.tsx`, `src/map/tilemap.ts`, `src/map/tilemap.test.ts`, `src/graph/graph.ts`, `src/graph/graph.test.ts`, `src/graph/GraphView.tsx`, `src/perf/metrics.ts`, `src-tauri/` (создаёт Tauri CLI)
- `scripts/measure.sh`, `docs/m0-report.md`

---

### Task 1: Каркас репозитория
**Files:**
- Create: `.gitignore`, `LICENSE`, `README.md`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`

**Interfaces:**
- Produces: workspace с пакетом `prototypes/*`; команда `pnpm -r test` запускает vitest во всех пакетах.

- [ ] **Step 1:** В `~/Проекты/NestST` выполнить `git init -b main`; `.gitignore` исключает `node_modules`, `dist`, `target`, `*.key`, `.env*`, `.superpowers/`.
- [ ] **Step 2:** `LICENSE` — текст MIT с годом 2026 и именем «NestST contributors». `README.md` — три строки: что это, статус «прототип M0», как запустить (заполнить в Задаче 2).
- [ ] **Step 3:** Корневой `package.json` (private, scripts `test: pnpm -r test`) и `pnpm-workspace.yaml` с `prototypes/*`; `tsconfig.base.json` со `strict: true`, `target: ES2022`, `moduleResolution: bundler`.
- [ ] **Step 4: Verify:** `git status` чистый после коммита, `cat LICENSE | head -1` содержит «MIT License».
- [ ] **Step 5: Commit** — `chore: repository scaffold (MIT, pnpm workspace)` (вместе с уже существующей папкой `docs/`).

### Task 2: Окно Tauri запускается из кириллического пути
**Files:**
- Create: `prototypes/m0/` (package.json, index.html, vite.config.ts, src/main.tsx, src/perf/metrics.ts, src-tauri/ через CLI), `scripts/measure.sh`
- Modify: `README.md` (инструкция запуска)

**Interfaces:**
- Produces: `startApp(): void` в `src/main.tsx` (монтирует страницу, вызывает `markReady()`); `markReady(): void` в `metrics.ts` — вызывает Tauri-команду `report_ready`, которая печатает в stdout `READY <мс от старта процесса>`; `scripts/measure.sh` — запускает собранное приложение, ждёт 10 с и печатает `RSS_MB <сумма по дереву процессов>` и `STARTUP_MS`.

- [ ] **Step 1 (с согласия пользователя):** установить Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y` (в `~/.cargo`, без sudo); проверить `rustc --version`.
- [ ] **Step 2:** В `prototypes/m0` создать Vite + TS проект и `pnpm add -D @tauri-apps/cli` и `pnpm add @tauri-apps/api`; `pnpm tauri init` с окном 1280×800, заголовок «NestST M0».
- [ ] **Step 3:** Реализовать `report_ready` в `src-tauri/src/main.rs` (хранит `Instant` старта процесса, команда печатает `READY` и миллисекунды) и `markReady()` в `src/perf/metrics.ts`.
- [ ] **Step 4:** Написать `scripts/measure.sh`: запуск бинарника из `prototypes/m0/src-tauri/target/release/`, `sleep 10`, суммирование RSS процесса и всех потомков (`ps --ppid` рекурсивно), завершение процесса.
- [ ] **Step 5: Verify:** из `~/Проекты/NestST/prototypes/m0` выполнить `pnpm tauri build --no-bundle`, затем `bash ../../scripts/measure.sh`. Ожидаемо: сборка успешна, окно открывается, вывод содержит строки `STARTUP_MS` и `RSS_MB` с числами. Если сборка падает из-за кириллицы в пути — записать причину и обходной путь в отчёт.
- [ ] **Step 6: Commit** — `feat(m0): Tauri window launches from Cyrillic path`.

### Task 3: Карта на PixiJS (производительность и сбой GPU)
**Files:**
- Create: `prototypes/m0/src/map/tilemap.ts`, `prototypes/m0/src/map/tilemap.test.ts`
- Modify: `prototypes/m0/src/main.tsx`

**Interfaces:**
- Consumes: `markReady()` из Задачи 2.
- Produces (все в `tilemap.ts`):
  - `interface TileMapData { width: number; height: number; tileSize: number; layers: { name: string; tiles: number[] }[] }`
  - `class MapError extends Error` (сообщение на русском)
  - `validateTileMap(data: unknown): TileMapData` — бросает `MapError` при несовпадении `tiles.length` и `width*height`, при `width|height <= 0`, при отсутствии слоёв
  - `generateTestMap(width: number, height: number): TileMapData` — 3 слоя, детерминированный (без случайности)
  - `createTileMapView(app: Application, data: TileMapData, tileset: Texture): { container: Container; destroy(): void }` — отрисовка только видимой части

- [ ] **Step 1: Write the failing tests** в `tilemap.test.ts`: `validateTileMap` отвергает карту, где `tiles.length !== width*height` (сообщение содержит «размер слоя»); отвергает `width: 0`; принимает `generateTestMap(10, 10)`; `generateTestMap(1000, 1000)` возвращает 3 слоя по 1_000_000 тайлов и два вызова с одинаковыми аргументами дают равные данные.
- [ ] **Step 2: Run** `pnpm -F m0 test` — ожидаемо FAIL (модуль не определён).
- [ ] **Step 3: Implement** функции выше. `createTileMapView` строит спрайты только для тайлов в границах камеры и обновляет их при перемещении (подсказка: кэш `Container` по чанкам 16×16).
- [ ] **Step 4: Run** `pnpm -F m0 test` — ожидаемо PASS.
- [ ] **Step 5:** В `main.tsx` создать приложение PixiJS; если создание контекста WebGL не удалось (исключение или `app.renderer` отсутствует), показать на странице текст «Не удалось запустить графику. Обновите драйвер видеокарты или откройте журнал.» (не белый экран); иначе нарисовать `generateTestMap(200, 200)` с тайлсетом из генерируемой на лету текстуры (цветные квадраты), панорамирование мышью, зум колёсиком, счётчик FPS в углу; клавиша `M` переключает на карту 1000×1000.
- [ ] **Step 6: Verify вручную** (в `pnpm tauri dev` и в собранной версии): панорамирование и зум плавные на 200×200; в `1000×1000` приложение не зависает; в углу виден FPS, записать значения для обеих карт. Проверить сообщение об ошибке графики, временно подменив создание контекста исключением, затем убрать подмену.
- [ ] **Step 7: Commit** — `feat(m0): PixiJS tile map with perf counter and GPU error message`.

### Task 4: Узловой редактор диалога и разбор графа
**Files:**
- Create: `prototypes/m0/src/graph/graph.ts`, `prototypes/m0/src/graph/graph.test.ts`, `prototypes/m0/src/graph/GraphView.tsx`
- Modify: `prototypes/m0/src/main.tsx` (переключение между картой и графом клавишей `G`)

**Interfaces:**
- Produces (в `graph.ts`):
  - `type NodeKind = 'line' | 'choice' | 'condition' | 'end'`
  - `interface DialogueNode { id: string; kind: NodeKind; text?: string; next: string[] }`
  - `interface DialogueGraph { schemaVersion: 1; start: string; nodes: DialogueNode[] }`
  - `class DialogueError extends Error` (сообщение на русском)
  - `parseDialogue(json: unknown): DialogueGraph` — проверка через zod
  - `serializeDialogue(graph: DialogueGraph): string` — формат `JSON.stringify(..., null, 2)`
- `GraphView.tsx`: компонент `GraphView({ graph: DialogueGraph, onChange(g: DialogueGraph): void })` на `@xyflow/react`, три демо-узла, перетаскивание, соединение, сохранение в `localStorage` ключом `m0-graph`.

- [ ] **Step 1: Write the failing tests** в `graph.test.ts`: round-trip (`parseDialogue(JSON.parse(serializeDialogue(g)))` равен `g`); отказ с `DialogueError` и текстом, содержащим «неизвестный тип узла» (kind `'foo'`), «ссылается на несуществующий узел» (битый `next`), «повторяется» (одинаковые `id`), «нет стартового узла» (`start` не найден); отказ пустого `nodes: []` с «пустой диалог»; **цикл** (узел `a` с `next: ['a']`) принимается и `parseDialogue` возвращается без зависания.
- [ ] **Step 2: Run** `pnpm -F m0 test` — ожидаемо FAIL.
- [ ] **Step 3: Implement** `graph.ts`; сообщения на русском; проверки выполняются в порядке: схема, повторяющиеся `id`, старт, ссылки `next`.
- [ ] **Step 4: Run** `pnpm -F m0 test` — ожидаемо PASS (и тесты карты из Задачи 3).
- [ ] **Step 5:** Реализовать `GraphView.tsx` и подключить в `main.tsx`; при ошибке чтения из `localStorage` (неверный JSON или `DialogueError`) показать русское сообщение и загрузить демо-граф, не падая.
- [ ] **Step 6: Verify вручную** в окне Tauri: три узла видны и соединяются; закрыть и снова открыть приложение — граф сохранился; отрисовка узлов без артефактов (записать, если WebKitGTK даёт мерцание или неверные шрифты).
- [ ] **Step 7: Commit** — `feat(m0): dialogue node graph prototype with validated parsing`.

### Task 5: Замер и решение «Tauri или Electron»
**Files:**
- Create: `docs/m0-report.md`
- Modify: `README.md` (как запустить, статус)

**Interfaces:**
- Consumes: числа из Задач 2–4 (`STARTUP_MS`, `RSS_MB`, FPS 200×200 и 1000×1000, замечания по отрисовке графа).

- [ ] **Step 1:** Запустить `scripts/measure.sh` три раза, записать медианы `STARTUP_MS` и `RSS_MB` для режимов «карта 200×200» и «граф».
- [ ] **Step 2:** Составить `docs/m0-report.md` (черновик можно поручить `gemini`/agy, затем проверить цифры): таблица измерений с датой, версиями и командой; список замеченных проблем WebKitGTK; ответы на 5 пунктов Review Focus (прошёл/не прошёл); решение.
- [ ] **Step 3:** Критерии решения (предлагаемые, пользователь может поправить): **остаёмся на Tauri**, если (а) сборка и запуск работают из кириллического пути, (б) карта 200×200 панорамируется без заметных рывков (FPS не ниже 50), (в) в узловом редакторе нет сбоев отрисовки, мешающих работе, (г) отсутствуют падения при нескольких запусках подряд. Иначе — **переход на Electron**: собрать тот же веб-код в минимальной оболочке Electron, повторить замеры и сравнить.
- [ ] **Step 4:** Описать в отчёте, что подтверждается и что остаётся допущением; рекомендация по UI-фреймворку для M1 (React + xyflow — оставить или заменить).
- [ ] **Step 5: Verify:** отчёт содержит все числа и решение; каждое утверждение либо измерено, либо помечено допущением; пользователь прочитал и согласен с решением.
- [ ] **Step 6: Commit** — `docs(m0): risk prototype report and Tauri/Electron decision`.

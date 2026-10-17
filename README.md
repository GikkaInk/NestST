# NestST 巣

**A lightweight, open-source 2D game maker for Linux, so anyone can tell their story as a game. No programming required.**

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform: Linux](https://img.shields.io/badge/platform-Linux-informational.svg)
![Status: early development](https://img.shields.io/badge/status-early%20development-orange.svg)

> ⚠️ Early stage. There is no finished editor yet: right now this repo holds the research, the architecture and a working technical prototype. We try to be honest about what is verified and what is not.

## The idea

NestST is for people who have a story but don't want to write code: storytellers, writers, hobbyists, fans of manga and anime. You draw maps, place characters, write branching dialogue and set up events in friendly visual editors. The engine handles the rest.

What we are building:

- **Visual map editor:** tiles, layers, collisions, NPCs, spawn points.
- **Dialogue, quests and events without code:** simple "event → condition → action" blocks.
- **AI image studio:** portraits, icons and sprites, reviewed by you before they enter the project. Opt-in, bring your own key. The editor and your games work fine without AI.
- **Lightweight:** a native Linux app (Tauri); games can run in the browser too.
- **Open:** MIT license, a versioned project format with safe migrations.

The first template is a top-down JRPG. Other game modes (for example a side view) are planned.

## Status

| Milestone | What | State |
|---|---|---|
| M0 | Risk prototype: Tauri + PixiJS + node editor, measurements | ✅ done ([report](docs/m0-report.md)) |
| M1 | Project core (`core`), versioned format, map rendering, map editor with undo/redo | 🚧 in progress (format schemas done) |
| M2 | Events and dialogue, a playable "player → NPC → dialogue" scene | ⏳ |
| M3 | AI studio: generate, review, import | ⏳ |
| M4 | Items, inventory, JRPG template, export | ⏳ |

More: [design spec](docs/superpowers/specs/2026-10-18-nestst-design.md), [research](docs/research.md), [M1 plan](docs/superpowers/plans/2026-10-18-m1-core-and-map-editor.md). *(The in-depth docs are currently written in Russian; they will be translated as the project matures.)*

## Tech

TypeScript, [PixiJS](https://pixijs.com) for rendering, [Tauri 2](https://tauri.app) for the Linux shell, React, zod, vitest, pnpm. Tauri was chosen from prototype measurements ([M0 report](docs/m0-report.md)); we measured Electron too: smoother minimum FPS, but much heavier on memory and disk.

## Run the M0 prototype

Requirements: Rust, Node.js 24+, pnpm, `webkit2gtk-4.1`, `gtk3`.

```bash
pnpm install
cd prototypes/m0
pnpm tauri dev                 # development mode
pnpm tauri build --no-bundle   # release binary: src-tauri/target/release/m0
```

In the window: **M** toggles the map size (200↔1000), **G** switches between the map and the dialogue graph.

Run all tests: `pnpm -r test`.

## Contributing

The project is just taking shape, but ideas and feedback are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [issue templates](.github/ISSUE_TEMPLATE).

## License

[MIT](LICENSE). Your games belong to you.

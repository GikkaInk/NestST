# Lost Cat

A tiny, complete game for NestST. Mira's cat Mochi ran away. Find her, bring her home, and get a reward. It takes about a minute to finish.

This is the first showcase game made for the engine.

## Open it

1. Start NestST.
2. Choose **Open project** and pick this folder (`examples/lost-cat`).
3. Press **Play**.

## How to play

- Move with the arrow keys or WASD.
- Talk to people and read signs with Space, Enter or Z (face them first).
- Press Esc to stop the game.

Talk to Mira, walk east through the garden gate, find Mochi, then go back to Mira.

## How it is built

- **Variables:** `quest-started`, `found-cat` and `quest-done` are flags, `coins` is a number. Dialogs read and change them.
- **Dialogs:** the `mira` graph starts with a branch on `found-cat`. Before you find the cat she asks for help (a choice: accept or "Not now."). After that she checks `quest-done`, gives 5 coins once, and then repeats a short thank-you. `cat` (Mochi) and `sign` are even smaller.
- **Gates:** "Garden gate" in the village and "Gate back" in the garden are touch events with a teleport action. You arrive on the cell next to the other gate, never on it, so you do not bounce back.
- **Solid tiles:** the manifest marks some tiles as impassable. Everything else is walkable.

| Tile | Colour | Meaning | Solid |
| ---- | ------ | ------- | ----- |
| 7 | green | grass | no |
| 17 | tan | path | no |
| 13 | blue | water (pond) | yes |
| 22 | dark brown | house wall | yes |
| 9 | orange | roof | yes |
| 10 | dark green | trees (map border) | yes |
| 27 | pink | flower beds | yes |
| 30 | brown | fence | yes |

## Try this

1. Change Mira's text in the Dialogs tab and play again.
2. Add a second coin reward, for example a coin from Mochi when you find her.
3. Add a new sign in the village: place an interact event with a new dialog.

# Evidence — issue #92: Improved AI game experience

Captured from the real running dev server (`yarn start`) via `chrome-devtools-axi`.

| Screenshot | What it shows |
| --- | --- |
| `01-before-ai-room-only-X.png` | **Before:** a vs-AI room offered only **Play as X** — O was locked to `AI (O)`, so the human could never pick a side. |
| `02-after-ai-room-choose-side.png` | **After:** a vs-AI room now offers **both Play as X and Play as O**; the AI takes whichever seat the human leaves. |
| `03-after-playing-as-O-vs-ai.png` | **After:** choosing **Play as O** seats the AI as X, which opens the game (X already placed top-left, shown in the history). The human O holds the once-per-game **grid shift** (`Use grid shift`). |
| `04-after-playing-as-X-vs-ai.png` | **After:** choosing **Play as X** seats the AI as O, which replies server-side (`AI (O)`), preserving the original flow. |

The AI's use of the grid shift is exercised by the unit tests in
`utils/gameLogic.test.ts` (`chooseAiAction`): it shifts to break an opponent
fork no placement can block, and otherwise spares the shift.

# Acacia Game Engine

## Project overview
A Python engine for the 2-player abstract strategy game "Acacia" designed by Dean Morris
(Wombat Game Factory). The project has two modes:
- **Watch mode**: visual browser-based display of AI agents playing each other, for 
  verifying game logic during development
- **Simulation mode**: headless Monte Carlo runs for game balance testing

## Repository
https://github.com/wombatgamefactory/acacia-game

**Published at** https://wombatgamefactory.github.io/acacia-game/ (GitHub Pages).
The studio site (wombatgamefactory.github.io repo) only *links* here — it holds
no copy of the game, and this repo loads nothing from it. Same arrangement as
bucket-list-game, fancy-that-game and firefly-festival-game.

## The game — Acacia
**Goal**: Be first to form a continuous line of 4 pieces of your colour (vertical, 
horizontal or diagonal), OR be first to place all your pieces on the board.

**Components per player**:
- 8 regular pieces (in player colour)
- 4 pushing pieces (marked with a house symbol)
- 1 yellow koala piece

**Setup**:
- Players take turns; start player places 1 regular piece on any empty space
- All remaining pieces start in each player's personal supply

**On your turn — choose ONE action**:

A. Place a regular piece
   - Place 1 regular piece from supply onto any empty space adjacent to at least 
     one piece already on the board
   - Adjacent = orthogonally or diagonally (any of the 8 surrounding spaces)
   - The adjacent piece can be any colour (yours, opponent's or yellow)

B. Eject and replace
   - Eject one opponent's piece and replace it with a piece from your own supply
   - Can only eject opponent's pieces (never yellow pieces)
   - To eject opponent's regular piece: place your pushing piece there
   - To eject opponent's pushing piece: place your yellow piece there
   - Ejected piece returns to opponent's supply

**Winning**:
- 4 in a row (vertical, horizontal or diagonal) wins immediately
- The line can be any mix of your regular and pushing pieces
- Yellow pieces do not count for either player and break a line
- Placing your last piece onto the board wins immediately

**Board**: 6×6 grid

## Tech stack
- Pure JavaScript (ES6+) — no build step, plain script tags
- HTML5 Canvas for board rendering
- Web Workers for batch analysis simulations
- No server required — runs completely in browser

## Project structure
acacia-game/
├── js/
│   ├── engine/
│   │   ├── constants.js   # PieceType, Player enums
│   │   ├── game.js        # Core logic: board, moves, win conditions
│   │   └── bots.js        # RandomBot, MCTSBot
│   ├── session.js         # Game session state management
│   ├── gameloop.js        # Play/pause/step, human move handling (ticketed loop)
│   ├── board-renderer.js  # Canvas board: layout, baked layers, tokens, animation
│   ├── analysis.js        # Analysis mode wrapper (spawns Web Worker)
│   ├── analysis-worker.js # Web Worker: batch simulations
│   └── utils.js           # Helpers: serialization, median, etc.
├── css/
│   └── acacia-game.css    # Whole game UI (self-contained design system)
├── images/
│   ├── pieces/            # Web sprites actually used by the game (transparent,
│   │                      #   trimmed, ~30-60 KB each)
│   │   ├── owl.png, squirrel.png, koala.png
│   │   └── house_blue_icon.png, house_red_icon.png
│   ├── hero.jpg           # Welcome-card banner (from the box art)
│   ├── backdrop.jpg       # Blurred page backdrop
│   └── piece_*.png, house_*.png, game_box_art.png   # original source art
├── index.html             # The game page (canvas, trays, overlays)
├── acacia-game.html       # Redirect stub → ./ (keeps the old published URL alive)
├── app.js                 # UI layer: trays, status, history, screens, input
├── version.js             # APP_VERSION — bump with each commit
├── CLAUDE.md
├── CONVERT_ACACIA_TO_JS.md  # Conversion specification document
└── README.md

## Presentation notes (2026-07-25 redesign)
- **Sprites**: the game loads `images/pieces/*.png` — owl, squirrel, koala,
  door_blue, door_red. These are derived from the full-size Gemini art in
  `S:\Dropbox\dev\Cardboard\Acacia\AI Art\*_token.png`: white background
  flood-filled to alpha, edge eroded and feathered, trimmed, squared, resized to
  512 px and quantised (~40–50 KB each). Rebuild with Pillow when the art
  changes. Two rules the art has to follow or the pipeline/tokens break:
  the subject must be **isolated on white with a clear margin** (the flood fill
  seeds from the corners), and characters must be **head-and-shoulders busts** —
  full-body figures shrink to a third of the token and stop reading.
  The older `images/piece_*.png` and `house_*.png` files are the superseded
  first-generation art, kept only as source.
- **Canvas**: `BoardRenderer` sizes the canvas to `clientWidth × devicePixelRatio`
  (the old renderer drew at a fixed 540 px and let the browser stretch it — the
  cause of the blurriness). The frame, cells and coordinates are baked into an
  offscreen layer; each token is baked once per size; a frame is only drawn while
  something is actually animating.
- **Board fit**: `fitBoard()` in app.js measures the space the site header, trays
  and status line leave behind and sets `--board-max`. CSS cannot do this on its
  own because the page is embedded in the wombatgamefactory.com shell. Short,
  wide viewports switch to a side-by-side layout (board left, trays right).
- **Theme**: `css/acacia-game.css` defines every value the page needs — palette,
  reset, fonts and the slim site header/footer. Nothing is loaded from the
  website repo at runtime.

## Key design principles
- Pure functional game engine (js/engine/game.js) with frozen immutable objects
- Game state never mutates in place; applyMove() returns new state
- Board is a flat 36-element array (6×6 grid), indexed as `row * 6 + col`
- Cells are `null` or `{player, pieceType}` objects
- Bots (RandomBot, MCTSBot) operate on frozen game state — suitable for Monte Carlo simulation
- GameSession manages mutable UI state (running flag, speed, human player)
- Web Workers isolate analysis mode to keep UI responsive
- All logic in browser — no server needed, works from `file://` (with some browser restrictions on Web Workers)

## Running the game

### Local browser (file://)
```bash
# Open index.html directly in your browser (no server needed)
# Note: Web Workers may not work from file:// in Chrome. Use Firefox or run a local server.
```

### With local server
```bash
# Python 3.6+
python -m http.server 8000

# Then open: http://localhost:8000
```

## Development approach
- Game logic is self-contained in js/engine/ with no dependencies
- Test engine functions directly in browser console: `legalMoves(state)`, `applyMove(state, move)`, etc.
- Bots can be tested independently: `const bot = new RandomBot(Player.P1); bot.chooseMove(state)`
- Watch mode: bot vs bot, configurable speeds, step-by-step execution
- Analysis mode: runs 100s of games headless in a Web Worker, reports win rates and statistics
- Human player mode: drag pieces from supply to board, move validation happens server-side (now client-side)

## Developer
Wombat Game Factory — acacia@wombatgamefactory.com
www.wombatgamefactory.com

## Change History
- **2026-05-14**: Converted from Python FastAPI + WebSocket to pure JavaScript
  - All game logic (js/engine/) working
  - Both RandomBot and MCTSBot ported
  - Web Worker for analysis mode
  - Human player mode with drag-and-drop interface
  - Now runs 100% in browser, deployable to GitHub Pages
- **2026-07-25**: Full presentation redesign (game logic untouched)
  - New sprite pipeline: transparent, trimmed, ~40× smaller piece art
  - New `js/board-renderer.js`: DPI-correct canvas, physical-looking board,
    piece drop / eject / win-line animations, legal-move and last-move hints
  - New `css/acacia-game.css` and page shell: responsive layout that keeps the
    whole game on screen from a 390 px phone to a large desktop
  - Setup screen (mode, side, difficulty), move history, in-game menu,
    balance lab, tap-to-place, drag-and-drop, and keyboard play
  - `gameloop.js` now takes a ticket per loop so restarting mid-game cannot
    leave two loops driving the same session
- **2026-07-25**: New piece art (storybook emblem style, generated with
  /generate-art). Owl, squirrel and koala are head-and-shoulders busts; the
  pushing piece is now a **round door in the player's colour** rather than a
  tree-house — the tree read as confusing next to an acacia-themed board. The
  in-game wording follows the art: the pushing piece is called a **Door** in the
  UI, while the printed rules still say "pushing piece / house symbol".
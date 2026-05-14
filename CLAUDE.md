# Acacia Game Engine

## Project overview
A Python engine for the 2-player abstract strategy game "Acacia" designed by Dean Morris
(Wombat Game Factory). The project has two modes:
- **Watch mode**: visual browser-based display of AI agents playing each other, for 
  verifying game logic during development
- **Simulation mode**: headless Monte Carlo runs for game balance testing

## Repository
https://github.com/wombatgamefactory/acacia-game

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
│   ├── gameloop.js        # Play/pause/step, human move handling
│   ├── analysis.js        # Analysis mode wrapper (spawns Web Worker)
│   ├── analysis-worker.js # Web Worker: batch simulations
│   └── utils.js           # Helpers: serialization, median, etc.
├── images/
│   ├── game_logo.png
│   ├── piece_owl.png, piece_squirrel.png, piece_koala.png
│   └── house_blue.png, house_red.png
├── index.html             # Main page (Canvas + controls)
├── app.js                 # UI glue: event handlers, rendering
├── CLAUDE.md
├── CONVERT_ACACIA_TO_JS.md  # Conversion specification document
└── README.md

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

## Conversion History
- **2026-05-14**: Converted from Python FastAPI + WebSocket to pure JavaScript
  - All game logic (js/engine/) working
  - Both RandomBot and MCTSBot ported
  - Web Worker for analysis mode
  - Human player mode with drag-and-drop interface
  - Now runs 100% in browser, deployable to GitHub Pages
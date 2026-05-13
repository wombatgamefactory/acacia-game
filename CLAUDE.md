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
- Python 3.13
- FastAPI + uvicorn (WebSocket server for watch mode)
- Anthropic Python SDK (Claude API bots)
- Minimal HTML/JS frontend (renders board state from JSON, no game logic in JS)

## Project structure
acacia-game/
├── engine/
│   ├── init.py
│   ├── game.py       # GameState, legal_moves(), apply_move(), is_terminal()
│   └── bots.py       # RandomBot, MCTSBot, ClaudeBot
├── server/
│   ├── main.py       # FastAPI + WebSocket server, streams state to browser
│   └── static/
│       └── index.html  # Board renderer + play/pause/speed controls
├── simulate.py       # Headless batch simulation runner, collects win/score stats
├── requirements.txt
├── CLAUDE.md
└── README.md

## Key design principles
- The game engine (engine/game.py) is completely decoupled from the server and UI
- Game state is a pure Python dataclass — no side effects, no I/O
- apply_move() is a pure function: returns new state, never mutates existing state
- The JS frontend is read-only — it only renders state received from the server
  and sends move commands back; all logic lives in Python
- The same engine powers both watch mode and headless simulation
- Board is 6×6 (36 spaces total)

## Development approach
- Start by fully implementing engine/game.py before touching server or frontend
- Use RandomBot vs RandomBot to verify basic game flow first
- Add win condition checking early and test thoroughly before adding AI bots
- Board size TBC — confirm before implementing GameState

## Developer
Dean Morris — dean.a.morris@gmail.com
Wombat Game Factory — www.wombatgamefactory.com
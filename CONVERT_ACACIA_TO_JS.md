# Acacia Game Engine — Python to Pure JavaScript Conversion Spec

## Overview

This document describes the conversion of the Acacia game engine from a Python FastAPI server + JS frontend to a pure browser-based JavaScript application. The conversion eliminates the WebSocket server entirely, moving all game logic, bot AI, and state management into the browser.

**Scope**: Game engine (engine/game.py) + bot logic (engine/bots.py) + server state management → JavaScript modules running entirely client-side.

---

## 1. Data Structures

### 1.1 Current Python Structure

Python uses:
- **Enums** for `PieceType` (REGULAR, PUSHER, YELLOW) and `Player` (P1, P2)
- **Frozen dataclasses** for immutability: `Supply`, `GameState`, `Move`
- **Tuples** for board representation: `Board = tuple[Cell, ...]` where `Cell = tuple[Player, PieceType] | None`
- **Type hints** throughout

### 1.2 JavaScript Equivalents

#### Enums → Objects with `Object.freeze()`

```javascript
// PieceType
const PieceType = Object.freeze({
  REGULAR: 'regular',
  PUSHER: 'pusher',
  YELLOW: 'yellow'
});

// Player
const Player = Object.freeze({
  P1: 1,
  P2: 2
});
```

**Rationale**: JavaScript doesn't have native enums; frozen objects provide enum-like semantics with string/number values for easy serialization.

#### Dataclasses → Objects with Freezing

Python's frozen dataclasses ensure immutability. JavaScript doesn't guarantee this, so:

```javascript
// Supply (frozen object)
function createSupply(regular, pusher, yellow) {
  return Object.freeze({
    regular,
    pusher,
    yellow
  });
}

// GameState (frozen object)
function createGameState(board, supply, current, turnNumber, winner, isFirstMove) {
  return Object.freeze({
    board,           // Array instead of tuple
    supply,          // [supply_p1, supply_p2]
    current,         // Player enum value
    turnNumber,
    winner,          // Player enum value or null
    isFirstMove
  });
}

// Move
function createMove(action, row, col, pieceType) {
  return Object.freeze({
    action,
    row,
    col,
    pieceType
  });
}
```

#### Board Representation

**Python**: `Board = tuple[Cell, ...]` — a 36-element tuple (6×6 flattened to 1D array)
- Cell: `(Player, PieceType) | None`
- Access: `board[index]` where `index = row * 6 + col`

**JavaScript**: 
```javascript
// Board as array of 36 cells
// Each cell: null | { player: Player enum, pieceType: PieceType enum }
const board = new Array(36).fill(null);
// or for a specific cell:
board[index] = { player: Player.P1, pieceType: PieceType.REGULAR };
```

**Rationale**: 
- Use plain objects `{ player, pieceType }` instead of tuples for readability in JavaScript
- Use arrays instead of tuples (JS doesn't have immutable tuples in ES2024)
- Apply `Object.freeze()` to immutability-critical structures if needed
- Consider using a Uint8Array or Uint16Array for performance if optimizing later

### 1.3 Supply Mutation Pattern

**Python**:
```python
def supply_spend(s: Supply, piece: PieceType) -> Supply:
    if piece == PieceType.REGULAR:
        return Supply(s.regular - 1, s.pusher, s.yellow)
    # ...
```

**JavaScript**:
```javascript
function supplySpend(supply, pieceType) {
  switch (pieceType) {
    case PieceType.REGULAR:
      return createSupply(supply.regular - 1, supply.pusher, supply.yellow);
    case PieceType.PUSHER:
      return createSupply(supply.regular, supply.pusher - 1, supply.yellow);
    case PieceType.YELLOW:
      return createSupply(supply.regular, supply.pusher, supply.yellow - 1);
  }
}

function supplyGain(supply, pieceType) {
  switch (pieceType) {
    case PieceType.REGULAR:
      return createSupply(supply.regular + 1, supply.pusher, supply.yellow);
    case PieceType.PUSHER:
      return createSupply(supply.regular, supply.pusher + 1, supply.yellow);
    case PieceType.YELLOW:
      return createSupply(supply.regular, supply.pusher, supply.yellow + 1);
  }
}
```

**Rationale**: Switch statements are clearer than if-elif chains in JavaScript. Avoid modifying in-place; always return new frozen objects.

---

## 2. Core Game Logic Functions

### 2.1 Board Utilities

These are identical in logic, just JavaScript syntax:

```javascript
// game.js

function index(row, col) {
  return row * 6 + col;
}

function rc(index) {
  return [Math.floor(index / 6), index % 6];
}

function adjacents(row, col) {
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr, c = col + dc;
      if (0 <= r && r < 6 && 0 <= c && c < 6) {
        result.push([r, c]);
      }
    }
  }
  return result;
}

function hasOccupiedNeighbor(board, row, col) {
  for (const [r, c] of adjacents(row, col)) {
    if (board[index(r, c)] !== null) {
      return true;
    }
  }
  return false;
}
```

### 2.2 Win Condition Check

```javascript
function checkWin(board, player) {
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  
  for (const [dr, dc] of directions) {
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        if (r + 3 * dr < 0 || r + 3 * dr >= 6) continue;
        if (c + 3 * dc < 0 || c + 3 * dc >= 6) continue;
        
        let allMatch = true;
        for (let i = 0; i < 4; i++) {
          const idx = index(r + i * dr, c + i * dc);
          const cell = board[idx];
          if (!cell || cell.player !== player || cell.pieceType === PieceType.YELLOW) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) return true;
      }
    }
  }
  return false;
}
```

### 2.3 Core Game Functions

```javascript
// Signature: legalMoves(state: GameState) -> Move[]
function legalMoves(state) {
  const moves = [];
  if (state.winner !== null) return moves;
  
  const currentPlayer = state.current;
  const opponent = currentPlayer === Player.P1 ? Player.P2 : Player.P1;
  const currentSupply = state.supply[currentPlayer === Player.P1 ? 0 : 1];
  const opponentSupply = state.supply[currentPlayer === Player.P1 ? 1 : 0];
  
  // Place regular piece
  if (currentSupply.regular > 0) {
    for (let i = 0; i < 36; i++) {
      if (state.board[i] === null) {
        const [r, c] = rc(i);
        if (state.isFirstMove || hasOccupiedNeighbor(state.board, r, c)) {
          moves.push(createMove('place', r, c, PieceType.REGULAR));
        }
      }
    }
  }
  
  // Eject opponent's regular piece with pusher
  if (currentSupply.pusher > 0) {
    for (let i = 0; i < 36; i++) {
      const cell = state.board[i];
      if (cell && cell.player === opponent && cell.pieceType === PieceType.REGULAR) {
        const [r, c] = rc(i);
        moves.push(createMove('eject', r, c, PieceType.PUSHER));
      }
    }
  }
  
  // Eject opponent's pusher with yellow
  if (currentSupply.yellow > 0) {
    for (let i = 0; i < 36; i++) {
      const cell = state.board[i];
      if (cell && cell.player === opponent && cell.pieceType === PieceType.PUSHER) {
        const [r, c] = rc(i);
        moves.push(createMove('eject', r, c, PieceType.YELLOW));
      }
    }
  }
  
  return moves;
}

// Signature: applyMove(state: GameState, move: Move) -> GameState
function applyMove(state, move) {
  const boardList = [...state.board]; // Shallow copy
  const currentPlayer = state.current;
  const opponent = currentPlayer === Player.P1 ? Player.P2 : Player.P1;
  
  const currentIdx = currentPlayer === Player.P1 ? 0 : 1;
  const opponentIdx = currentPlayer === Player.P1 ? 1 : 0;
  
  const supplyList = [state.supply[0], state.supply[1]];
  const targetIdx = index(move.row, move.col);
  
  if (move.action === 'place') {
    boardList[targetIdx] = { player: currentPlayer, pieceType: move.pieceType };
    supplyList[currentIdx] = supplySpend(supplyList[currentIdx], move.pieceType);
  } else if (move.action === 'eject') {
    const victimCell = boardList[targetIdx];
    const victimPiece = victimCell.pieceType;
    
    boardList[targetIdx] = { player: currentPlayer, pieceType: move.pieceType };
    supplyList[currentIdx] = supplySpend(supplyList[currentIdx], move.pieceType);
    supplyList[opponentIdx] = supplyGain(supplyList[opponentIdx], victimPiece);
  }
  
  const newBoard = boardList;
  
  let winner = null;
  if (checkWin(newBoard, currentPlayer)) {
    winner = currentPlayer;
  } else if (supplyList[currentIdx].regular === 0 && 
             supplyList[currentIdx].pusher === 0 && 
             supplyList[currentIdx].yellow === 0) {
    winner = currentPlayer;
  }
  
  const nextPlayer = opponent;
  
  return createGameState(
    newBoard,
    [supplyList[0], supplyList[1]],
    nextPlayer,
    state.turnNumber + 1,
    winner,
    false
  );
}

// Signature: isTerminal(state: GameState) -> boolean
function isTerminal(state) {
  return state.winner !== null || legalMoves(state).length === 0;
}

// Signature: initialState() -> GameState
function initialState() {
  const board = new Array(36).fill(null);
  const p1Supply = createSupply(8, 4, 1);
  const p2Supply = createSupply(8, 4, 1);
  return createGameState(board, [p1Supply, p2Supply], Player.P1, 1, null, true);
}
```

**Key Differences from Python**:
- No list comprehensions → use `for` loops or `Array.from()`
- `|` (union type) → use `||` or conditional checks
- `is not None` → use `!== null`
- Python's `asdict()` — not needed; plain objects already serializable

---

## 3. Bot Logic

### 3.1 RandomBot

**Python**:
```python
class RandomBot:
    def __init__(self, player: Player, seed: int | None = None):
        self.player = player
        self.rng = random.Random(seed)
    def choose_move(self, state: GameState) -> Move:
        moves = legal_moves(state)
        return self.rng.choice(moves)
```

**JavaScript**:
```javascript
class RandomBot {
  constructor(player, seed = null) {
    this.player = player;
    this.rng = new SeededRandom(seed);
  }
  
  chooseMove(state) {
    const moves = legalMoves(state);
    return moves[Math.floor(this.rng.random() * moves.length)];
  }
}
```

**Note**: JavaScript has no built-in seeded random. Implementation options:
1. Use an external library (e.g., `seedrandom`)
2. Implement a simple LCG (linear congruential generator) for reproducibility
3. For browser-only use, skip seeding and rely on `Math.random()`

### 3.2 MCTSBot

The MCTS algorithm is identical in logic but requires careful translation:

```javascript
class MCTSNode {
  constructor(state, parent = null, move = null) {
    this.state = state;
    this.parent = parent;
    this.move = move;
    this.children = [];
    this.visits = 0;
    this.wins = 0.0;
    this.untriedMoves = legalMoves(state);
  }
}

class MCTSBot {
  constructor(player, iterations = 1000, exploration = Math.sqrt(2)) {
    this.player = player;
    this.iterations = iterations;
    this.c = exploration;
  }
  
  chooseMove(state) {
    const root = new MCTSNode(state);
    
    for (let i = 0; i < this.iterations; i++) {
      let node = this._select(root);
      
      if (isTerminal(node.state)) {
        const result = this._evaluateTerminal(node.state);
        this._backpropagate(node, result);
      } else if (node.untriedMoves.length > 0) {
        node = this._expand(node);
        const result = this._rollout(node.state);
        this._backpropagate(node, result);
      }
    }
    
    const best = root.children.reduce((max, child) => 
      child.visits > max.visits ? child : max
    );
    return best.move;
  }
  
  _select(node) {
    while (!isTerminal(node.state) && node.untriedMoves.length === 0) {
      node = this._bestUct(node);
    }
    return node;
  }
  
  _expand(node) {
    const idx = Math.floor(Math.random() * node.untriedMoves.length);
    const move = node.untriedMoves[idx];
    node.untriedMoves.splice(idx, 1); // Remove from untried
    
    const childState = applyMove(node.state, move);
    const child = new MCTSNode(childState, node, move);
    node.children.push(child);
    return child;
  }
  
  _evaluateTerminal(state) {
    if (state.winner === this.player) return 1.0;
    if (state.winner === null) return 0.5;
    return 0.0;
  }
  
  _rollout(state, maxDepth = 200) {
    let current = state;
    let depth = 0;
    const bot = new RandomBot(current.current);
    
    while (!isTerminal(current) && depth < maxDepth) {
      const move = bot.chooseMove(current);
      current = applyMove(current, move);
      depth++;
    }
    
    if (current.winner === this.player) return 1.0;
    if (current.winner === null) return 0.5;
    return 0.0;
  }
  
  _backpropagate(node, result) {
    while (node !== null) {
      node.visits++;
      if (node.parent === null) {
        node.wins += result;
      } else {
        const mover = node.parent.state.current;
        if (mover === this.player) {
          node.wins += result;
        } else {
          node.wins += (1.0 - result);
        }
      }
      node = node.parent;
    }
  }
  
  _bestUct(node) {
    let bestChild = null;
    let bestUct = -Infinity;
    
    for (const child of node.children) {
      let uct;
      if (child.visits === 0) {
        uct = Infinity;
      } else {
        const exploitation = child.wins / child.visits;
        const exploration = this.c * Math.sqrt(Math.log(node.visits) / child.visits);
        uct = exploitation + exploration;
      }
      
      if (uct > bestUct) {
        bestUct = uct;
        bestChild = child;
      }
    }
    
    return bestChild;
  }
}
```

**Key Differences**:
- `for _ in range(n):` → `for (let i = 0; i < n; i++)`
- `random.choice(list)` → `list[Math.floor(Math.random() * list.length)]`
- `.remove(item)` → `array.splice(array.indexOf(item), 1)`
- `max(...)` → `.reduce((max, x) => x > max ? x : max)`
- Type hints removed; use JSDoc if documenting

---

## 4. Server Logic → Browser State Management

### 4.1 Current Architecture

**Python Server** (FastAPI + WebSocket):
- Maintains `GameSession` with mutable state
- Sends JSON serialized state to browser
- Receives commands (play, pause, step, reset, set_bots) and moves from browser
- Runs game loop in asyncio task, controlling timing

**Browser** (current):
- Read-only; receives state JSON and renders it
- Sends commands/moves via WebSocket
- No game logic

### 4.2 New Browser-Only Architecture

Create a `GameSession` class that replaces the Python server's session management:

```javascript
// session.js

class GameSession {
  constructor() {
    this.state = initialState();
    this.botP1 = new RandomBot(Player.P1);
    this.botP2 = new RandomBot(Player.P2);
    this.running = false;
    this.speedMs = 500;
    this.gameTask = null; // AnimationFrame ID
    this.humanPlayer = null; // null | Player.P1 | Player.P2
    this.pendingMove = null; // null | Move
    this.waitingForHumanMove = false;
  }
  
  reset() {
    this.state = initialState();
    this.running = false;
    this.waitingForHumanMove = false;
    this.pendingMove = null;
    if (this.gameTask !== null) {
      cancelAnimationFrame(this.gameTask);
      this.gameTask = null;
    }
  }
  
  setBots(botType1, botType2) {
    this.botP1 = this._makeBot(botType1, Player.P1);
    this.botP2 = this._makeBot(botType2, Player.P2);
    
    // Determine if there's a human player
    if (botType1 === 'human' || botType2 === 'human') {
      if (botType1 === 'human' && botType2 === 'human') {
        // Both human? Pick P1 as human, make P2 random
        this.botP2 = new RandomBot(Player.P2);
        this.humanPlayer = Player.P1;
      } else if (botType1 === 'human') {
        this.humanPlayer = Player.P1;
      } else {
        this.humanPlayer = Player.P2;
      }
    } else {
      this.humanPlayer = null;
    }
  }
  
  _makeBot(botType, player) {
    if (botType === 'human') return null;
    if (botType === 'random') return new RandomBot(player);
    if (botType === 'mcts') return new MCTSBot(player, 200); // Adjust iterations for browser
    throw new Error(`Unknown bot type: ${botType}`);
  }
  
  applyMove(move) {
    // Validate move is legal
    const legal = legalMoves(this.state);
    if (!legal.some(m => movesEqual(m, move))) {
      throw new Error('Illegal move');
    }
    this.state = applyMove(this.state, move);
  }
  
  requestHumanMove(move) {
    if (this.state.current !== this.humanPlayer) {
      throw new Error('Not your turn');
    }
    this.pendingMove = move;
    // Signal that we have the move; game loop will pick it up
  }
}

// Helper
function movesEqual(m1, m2) {
  return m1.action === m2.action && m1.row === m2.row && 
         m1.col === m2.col && m1.pieceType === m2.pieceType;
}
```

### 4.3 Game Loop (Browser Version)

**Python** uses `asyncio.sleep()` to control pacing. **JavaScript** uses `requestAnimationFrame()` or `setTimeout()`:

```javascript
// gameloop.js

async function runGameLoop(session, onStateUpdate, onGameOver) {
  while (session.running && !isTerminal(session.state)) {
    const currentPlayer = session.state.current;
    
    if (currentPlayer === session.humanPlayer) {
      // Human's turn: wait for input
      session.waitingForHumanMove = true;
      onStateUpdate(session.state);
      
      // Wait for move (polling or event-based)
      await waitForHumanMove(session);
      
      if (session.pendingMove) {
        session.applyMove(session.pendingMove);
        session.pendingMove = null;
      }
    } else {
      // Bot's turn
      const bot = currentPlayer === Player.P1 ? session.botP1 : session.botP2;
      const move = bot.chooseMove(session.state);
      session.applyMove(move);
    }
    
    onStateUpdate(session.state);
    
    if (isTerminal(session.state)) {
      onGameOver(session.state);
      break;
    }
    
    // Sleep between moves (only for bot moves, not human)
    if (session.humanPlayer === null || currentPlayer !== session.humanPlayer) {
      await new Promise(resolve => setTimeout(resolve, session.speedMs));
    }
  }
  
  session.running = false;
}

function waitForHumanMove(session) {
  return new Promise(resolve => {
    const pollInterval = setInterval(() => {
      if (session.pendingMove !== null) {
        clearInterval(pollInterval);
        resolve();
      }
    }, 50); // Poll every 50ms for human move
  });
}
```

**Rationale**: 
- `requestAnimationFrame()` could be used but for game pacing, `setTimeout()` is clearer
- Polling for human move is simple; event-based could use a custom EventEmitter
- No WebSocket needed; state lives in memory

### 4.4 Analysis Mode (Batch Simulation)

The current `run_analysis()` in Python runs many games and reports progress. Move to JavaScript:

```javascript
// analysis.js

async function runAnalysis(iterations, bot1Type, bot2Type, onProgress, onComplete) {
  const results = {
    p1Wins: 0,
    p2Wins: 0,
    botWins: {},
    turns: [],
    winMethods: [],
    bothKoalasUsed: 0
  };
  
  results.botWins[bot1Type] = 0;
  results.botWins[bot2Type] = 0;
  
  for (let i = 0; i < iterations; i++) {
    let state = initialState();
    let bot1 = makeBot(bot1Type, Player.P1);
    let bot2 = makeBot(bot2Type, Player.P2);
    
    // Alternate first player for fairness
    if (bot1Type !== bot2Type && i % 2 === 1) {
      [bot1, bot2] = [bot2, bot1];
      [bot1Type, bot2Type] = [bot2Type, bot1Type];
    }
    
    while (!isTerminal(state)) {
      const bot = state.current === Player.P1 ? bot1 : bot2;
      const move = bot.chooseMove(state);
      state = applyMove(state, move);
    }
    
    // Record results
    if (state.winner === Player.P1) {
      results.p1Wins++;
      results.botWins[bot1Type]++;
    } else if (state.winner === Player.P2) {
      results.p2Wins++;
      results.botWins[bot2Type]++;
    }
    
    results.turns.push(state.turnNumber);
    
    // Determine win method
    if (state.winner) {
      const winnerSupply = state.supply[state.winner === Player.P1 ? 0 : 1];
      const isAllPieces = winnerSupply.regular === 0 && winnerSupply.pusher === 0 && winnerSupply.yellow === 0;
      results.winMethods.push(isAllPieces ? 'all_pieces' : 'four_in_a_row');
    } else {
      results.winMethods.push('stalemate');
    }
    
    if (state.supply[0].yellow === 0 && state.supply[1].yellow === 0) {
      results.bothKoalasUsed++;
    }
    
    // Yield to browser for UI update
    if ((i + 1) % 1 === 0) {
      onProgress(i + 1, iterations);
      await new Promise(resolve => setTimeout(resolve, 0)); // Microtask queue
    }
  }
  
  // Calculate statistics
  const stats = {
    p1Wins: results.p1Wins,
    p2Wins: results.p2Wins,
    p1WinPct: (results.p1Wins / iterations) * 100,
    p2WinPct: (results.p2Wins / iterations) * 100,
    botTypeStats: {},
    fourInARowWins: results.winMethods.filter(m => m === 'four_in_a_row').length,
    avgTurns: results.turns.reduce((a, b) => a + b, 0) / results.turns.length,
    minTurns: Math.min(...results.turns),
    maxTurns: Math.max(...results.turns),
    medianTurns: median(results.turns),
    bothKoalasUsedPct: (results.bothKoalasUsed / iterations) * 100
  };
  
  stats.fourInARowPct = (stats.fourInARowWins / iterations) * 100;
  for (const [botType, wins] of Object.entries(results.botWins)) {
    stats.botTypeStats[botType] = (wins / iterations) * 100;
  }
  
  onComplete(stats);
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
```

**Blocking Concern**: Analysis with 1000s of MCTS iterations will block the browser. Solution:
- Use `await new Promise(resolve => setTimeout(resolve, 0))` to yield after each game
- Or use Web Workers for background computation (more complex)
- Document that analysis mode may freeze UI for long runs

---

## 5. Serialization & UI Communication

### 5.1 Serialization (Python → JSON)

**Python** uses `asdict()` to convert dataclasses. **JavaScript** needs explicit serialization:

```javascript
// serialization.js

function serializeGameState(state) {
  const boardCells = [];
  for (let i = 0; i < state.board.length; i++) {
    const cell = state.board[i];
    if (cell !== null) {
      const [r, c] = rc(i);
      boardCells.push({
        row: r,
        col: c,
        player: state.current === Player.P1 ? 'p1' : 'p2', // Wait, this is wrong
        piece: cell.pieceType
      });
    }
  }
  
  return {
    type: 'state',
    board: boardCells,
    supply: {
      p1: state.supply[0],
      p2: state.supply[1]
    },
    current: state.current === Player.P1 ? 'p1' : 'p2',
    turn: state.turnNumber,
    winner: state.winner ? (state.winner === Player.P1 ? 'p1' : 'p2') : null,
    terminal: isTerminal(state)
  };
}

// Actually for board cells, we need the OWNER, not current player:
function serializeGameState(state) {
  const boardCells = [];
  for (let i = 0; i < state.board.length; i++) {
    const cell = state.board[i];
    if (cell !== null) {
      const [r, c] = rc(i);
      boardCells.push({
        row: r,
        col: c,
        player: cell.player === Player.P1 ? 'p1' : 'p2',
        piece: cell.pieceType
      });
    }
  }
  
  return {
    type: 'state',
    board: boardCells,
    supply: {
      p1: state.supply[0],
      p2: state.supply[1]
    },
    current: state.current === Player.P1 ? 'p1' : 'p2',
    turn: state.turnNumber,
    winner: state.winner ? (state.winner === Player.P1 ? 'p1' : 'p2') : null,
    terminal: isTerminal(state)
  };
}
```

**Rationale**: Objects serialize directly via `JSON.stringify()`. No dataclass decorator needed.

---

## 6. New File Structure

### Current Structure
```
acacia-game/
├── engine/
│   ├── __init__.py
│   ├── game.py
│   └── bots.py
├── server/
│   ├── main.py
│   └── static/
│       └── index.html
├── simulate.py
├── requirements.txt
└── CLAUDE.md
```

### New Structure (Pure JS)

```
acacia-game-js/
├── src/
│   ├── engine/
│   │   ├── game.js          # Core game logic (game state, moves, win conditions)
│   │   ├── bots.js          # RandomBot, MCTSBot
│   │   └── constants.js     # PieceType, Player enums
│   ├── session.js           # GameSession (replaces Python server)
│   ├── gameloop.js          # Game loop control (play, pause, step, analysis)
│   ├── serialization.js     # State serialization for UI
│   ├── analysis.js          # Batch analysis runner
│   └── utils.js             # Helpers (seeded random, median, etc.)
├── static/
│   ├── index.html           # Same as current, slight modifications
│   ├── style.css            # Extracted CSS (optional)
│   ├── app.js               # Main UI glue (replaces WebSocket code)
│   └── /images/             # Existing PNGs
├── package.json             # npm metadata (if publishing as module)
├── .gitignore
└── README.md
```

### What Each File Does

| File | Source | Purpose |
|------|--------|---------|
| `constants.js` | New | Defines PieceType and Player enums |
| `game.js` | engine/game.py | Core game logic: board helpers, legalMoves, applyMove, isTerminal, checkWin |
| `bots.js` | engine/bots.py | RandomBot and MCTSBot classes |
| `session.js` | server/main.py (GameSession) | State management, bot factory, move validation |
| `gameloop.js` | server/main.py (run_game_loop) | Play/pause/step logic, human move waiting |
| `analysis.js` | server/main.py (run_analysis) | Batch simulation runner with progress callbacks |
| `serialization.js` | server/main.py (serialize_state) | GameState → JSON for UI rendering |
| `utils.js` | New | Seeded random (optional), statistics helpers |
| `app.js` | server/static/index.html | UI event handlers, WebSocket → memory |
| `index.html` | server/static/index.html | Same structure, updated script imports |

---

## 7. HTML/CSS — What Changes

### What Stays the Same
- **DOM structure**: Canvas, buttons, panels, supply display
- **CSS**: All styling for dark theme, board, controls, analysis
- **Images**: All PNG assets (owls, squirrels, koalas, houses, logo)
- **Canvas drawing logic**: Piece rendering, grid, legal move highlights

### What Changes
- **No WebSocket**: Remove `const ws = new WebSocket(...)` and handlers
- **Script imports**: Add `<script>` tags for new JS modules:
  ```html
  <script src="/engine/constants.js"></script>
  <script src="/engine/game.js"></script>
  <script src="/engine/bots.js"></script>
  <script src="/session.js"></script>
  <script src="/gameloop.js"></script>
  <script src="/serialization.js"></script>
  <script src="/analysis.js"></script>
  <script src="/utils.js"></script>
  <script src="/app.js"></script>
  ```
- **Module loading order**: Critical — constants.js first, then game logic, then app.js
- **Global variables**: `GameSession`, `runGameLoop`, `runAnalysis` must be available to app.js

### UI Event Handlers (app.js)

Replace WebSocket event handlers with direct function calls:

```javascript
// app.js

let gameSession = new GameSession();

document.getElementById('btnPlay').addEventListener('click', () => {
  if (!gameSession.running && !isTerminal(gameSession.state)) {
    gameSession.running = true;
    runGameLoop(gameSession, onStateUpdate, onGameOver);
    updateGameStatus('Playing...');
  }
});

document.getElementById('btnPause').addEventListener('click', () => {
  gameSession.running = false;
  updateGameStatus('Paused');
});

document.getElementById('btnStep').addEventListener('click', () => {
  if (!gameSession.running && !isTerminal(gameSession.state)) {
    // Step: apply one move
    const currentPlayer = gameSession.state.current;
    const bot = currentPlayer === Player.P1 ? gameSession.botP1 : gameSession.botP2;
    const move = bot.chooseMove(gameSession.state);
    gameSession.applyMove(move);
    onStateUpdate(gameSession.state);
    if (isTerminal(gameSession.state)) {
      onGameOver(gameSession.state);
    }
  }
});

function onStateUpdate(state) {
  renderBoard(state);
  updateSupply(state);
  updateCurrentPlayer(state);
}

function onGameOver(state) {
  const winner = state.winner ? (state.winner === Player.P1 ? 'Player 1' : 'Player 2') : 'Draw';
  updateGameStatus(`Game Over! ${winner} wins`);
}
```

---

## 8. Python-Specific Patterns → JavaScript

### 8.1 Enums

| Python | JavaScript |
|--------|-----------|
| `class PieceType(Enum): REGULAR = auto()` | `const PieceType = { REGULAR: 'regular' }` |
| `enum_value.name` | `enum_value` (already a string/number) |
| `enum_value.value` | `enum_value` |

### 8.2 Dataclasses & Immutability

| Python | JavaScript |
|--------|-----------|
| `@dataclass(frozen=True)` | Constructor + `Object.freeze()` or plain objects |
| `asdict(obj)` | Already a plain object; `JSON.stringify()` ready |
| `field(default_factory=...)` | Constructor param with default |

### 8.3 Type Hints

| Python | JavaScript |
|--------|-----------|
| `def func(x: int) -> str:` | No runtime type checking; use JSDoc: `/** @param {number} x @returns {string} */` |
| `x: int \| None` | `x === null` or `typeof x` checks |
| `Literal["place", "eject"]` | String enum or union type: `'place' \| 'eject'` (JSDoc) |

### 8.4 List/Tuple Operations

| Python | JavaScript |
|--------|-----------|
| `tuple([...])` | Use arrays; freeze if immutable needed |
| `list.remove(item)` | `array.splice(array.indexOf(item), 1)` |
| `list.append(x)` | `array.push(x)` |
| `[x for x in list if cond]` | `list.filter(cond)` |
| `max(list, key=...)` | `.reduce((max, x) => ..., -Infinity)` |

### 8.5 async/await & Concurrency

| Python | JavaScript |
|--------|-----------|
| `async def`, `await` | `async function`, `await` (same syntax!) |
| `asyncio.sleep(s)` | `await new Promise(r => setTimeout(r, s * 1000))` |
| `asyncio.create_task()` | `Promise` or `requestAnimationFrame()` |
| Thread pools / `run_in_executor` | Web Workers (more complex) or setTimeout + yield |

### 8.6 Error Handling

| Python | JavaScript |
|--------|-----------|
| `try: ... except ValueError:` | `try { ... } catch (e) { if (e instanceof TypeError) { ... } }` |
| `raise ValueError(msg)` | `throw new Error(msg)` |
| `logging.error()` | `console.error()` |

### 8.7 Iteration & Loops

| Python | JavaScript |
|--------|-----------|
| `for i in range(n):` | `for (let i = 0; i < n; i++)` |
| `for item in list:` | `for (const item of list)` or `.forEach(item => ...)` |
| `enumerate(list)` | `list.forEach((item, idx) => ...)` |
| `zip(list1, list2)` | `list1.map((x, i) => [x, list2[i]])` |

### 8.8 Dictionaries/Objects

| Python | JavaScript |
|--------|-----------|
| `dict[key]` | `obj[key]` or `obj.key` |
| `key in dict` | `key in obj` or `obj.hasOwnProperty(key)` |
| `.items()` | `Object.entries(obj)` |
| `.values()` | `Object.values(obj)` |
| `.get(key, default)` | `obj[key] ?? default` |

---

## 9. Performance & Optimization Considerations

### 9.1 Board Representation

Current: Array of 36 objects `{ player, pieceType }` or nulls.

**Options**:
1. **Plain array**: Simplest. ~36 * 8 bytes (object overhead) = ~288 bytes. Fine.
2. **Uint8Array**: Each cell = 1 byte (encodes player + piece type). 36 bytes. Fast but complex decoding.
3. **Bitfield**: Pack board into bits. Very compact but harder to debug.

**Recommendation**: Start with plain array for simplicity. Profile later if needed.

### 9.2 MCTS in Browser

MCTS with 1000 iterations will block. Options:

1. **Reduce iterations**: Use 50-100 for browser, 200+ for headless
2. **Web Workers**: Run bot computation off main thread
3. **Async iterations**: Yield every N iterations to let UI update
4. **Time budgeting**: Limit MCTS to X seconds instead of fixed iterations

**Recommendation**: Reduce iterations + add UI feedback ("Bot is thinking...")

### 9.3 Analysis Mode

Thousands of games + MCTS will freeze browser. Options:

1. **Reduce iterations**: 50 MCTS per move in analysis
2. **Web Worker pool**: Spawn multiple workers for parallel games
3. **Sample smaller**: Run 100-500 games instead of 1000+
4. **Async with yields**: `setTimeout(..., 0)` between games

**Recommendation**: Yield control after each game to keep UI responsive.

---

## 10. Testing Strategy

### What to Test

1. **Game logic** (no UI needed):
   - `legalMoves()`: Verify correct move generation for all piece types
   - `applyMove()`: State transitions, piece placement, ejection
   - `checkWin()`: 4-in-a-row detection (all directions)
   - `isTerminal()`: Stalemate detection
   - Initial state setup

2. **Bots**:
   - RandomBot: Always returns legal move
   - MCTSBot: Selects best move (no crash, reasonable performance)

3. **Serialization**:
   - State → JSON → UI rendering consistency

4. **UI** (harder in pure JS):
   - Canvas rendering doesn't crash
   - Drag-drop captures correct row/col
   - Supply updates reflect state

### Testing Approach

- **Jest or Mocha**: Unit tests for game logic
- **Manual browser testing**: UI/interaction
- **No end-to-end WebSocket tests**: No server to test against
- **Headless analysis**: Run simulations to verify game balance

---

## 11. Deployment & Distribution

### Current Setup
- Python server + HTML frontend
- Requires: Python 3.13, FastAPI, uvicorn
- Deploy: Standard Python app deployment

### New Setup
- Pure HTML + JavaScript
- Requires: Nothing (static files only)
- Deploy:
  - GitHub Pages (free static hosting)
  - Any web server (nginx, Apache, S3 + CloudFront)
  - Local: Just open `index.html` in browser (no server needed!)

### Build Considerations

- **Module bundling** (optional): Use Webpack/Vite to bundle modules into single JS file
- **Minification**: Reduce size for distribution
- **Service Worker**: Cache assets for offline play
- **No build step required**: Plain JS works as-is

---

## 12. Migration Checklist

- [ ] Create `src/` directory structure
- [ ] Convert `engine/game.py` → `src/engine/game.js`
- [ ] Implement `PieceType` and `Player` enums in `src/engine/constants.js`
- [ ] Port board utilities (`index`, `rc`, `adjacents`, `hasOccupiedNeighbor`)
- [ ] Implement `checkWin()`
- [ ] Implement `legalMoves()`
- [ ] Implement `applyMove()`
- [ ] Implement `isTerminal()`
- [ ] Implement `initialState()`
- [ ] Convert `engine/bots.py` → `src/engine/bots.js`
  - [ ] RandomBot with optional seeded RNG
  - [ ] MCTSNode and MCTSBot
- [ ] Create `src/session.js` (GameSession class)
- [ ] Create `src/gameloop.js` (play/pause/step logic)
- [ ] Create `src/analysis.js` (batch simulation)
- [ ] Create `src/serialization.js`
- [ ] Create `src/utils.js`
- [ ] Update `static/index.html` with script imports
- [ ] Create `static/app.js` (UI glue, replaces WebSocket)
- [ ] Test game logic (unit tests)
- [ ] Test UI (manual in browser)
- [ ] Test analysis mode
- [ ] Test human player mode
- [ ] Remove Python server code (or leave as legacy)
- [ ] Update README with pure JS instructions

---

## 13. Summary of Key Decisions

| Decision | Rationale |
|----------|-----------|
| Objects + `Object.freeze()` instead of classes | Simpler immutability, easier serialization |
| Arrays instead of tuples | JS doesn't have immutable tuples in standard library |
| String/number enums instead of objects | Cleaner serialization, matches Python enum values |
| `setTimeout()` for game loop | Better control than `requestAnimationFrame()` for pacing |
| No Web Workers (initial) | Simpler implementation; can add later if needed |
| Async/await for game loops | Modern, readable, aligns with Python's async |
| Polling for human moves | Simple; event-based possible but more complex |
| Analysis yields after each game | Keeps UI responsive; no need for Web Workers |
| No TypeScript (initial) | Keep it vanilla JS; can add later |

---

## Appendix: Example Imports in HTML

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Acacia Game</title>
    <style>
        /* ... existing CSS ... */
    </style>
</head>
<body>
    <!-- ... existing HTML ... -->

    <!-- Import order is critical -->
    <script src="/src/engine/constants.js"></script>
    <script src="/src/engine/game.js"></script>
    <script src="/src/engine/bots.js"></script>
    <script src="/src/utils.js"></script>
    <script src="/src/serialization.js"></script>
    <script src="/src/session.js"></script>
    <script src="/src/gameloop.js"></script>
    <script src="/src/analysis.js"></script>
    <script src="/app.js"></script>
</body>
</html>
```

Order matters: Dependencies must be loaded before dependents.


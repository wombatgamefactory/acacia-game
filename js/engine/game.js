// Core game engine: board logic, move validation, win conditions

// Factory functions for immutable objects

function createSupply(regular, pusher, yellow) {
  return Object.freeze({ regular, pusher, yellow });
}

function createGameState(board, supply, current, turnNumber, winner, isFirstMove) {
  return Object.freeze({
    board,
    supply,
    current,
    turnNumber,
    winner,
    isFirstMove
  });
}

function createMove(action, row, col, pieceType) {
  return Object.freeze({ action, row, col, pieceType });
}

// Supply mutation helpers

function supplySpend(supply, pieceType) {
  switch (pieceType) {
    case PieceType.REGULAR:
      return createSupply(supply.regular - 1, supply.pusher, supply.yellow);
    case PieceType.PUSHER:
      return createSupply(supply.regular, supply.pusher - 1, supply.yellow);
    case PieceType.YELLOW:
      return createSupply(supply.regular, supply.pusher, supply.yellow - 1);
    default:
      throw new Error(`Unknown piece type: ${pieceType}`);
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
    default:
      throw new Error(`Unknown piece type: ${pieceType}`);
  }
}

// Board utilities

function index(row, col) {
  return row * 6 + col;
}

function rc(idx) {
  return [Math.floor(idx / 6), idx % 6];
}

function adjacents(row, col) {
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
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

// Win condition check: 4 in a row (vertical, horizontal, diagonal)
// Yellow pieces don't count and break a line

function checkWin(board, player) {
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

  for (const [dr, dc] of directions) {
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        // Check if 4 cells in this direction are all occupied by player's non-yellow pieces
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

// Game state management

function initialState() {
  const board = new Array(36).fill(null);
  const p1Supply = createSupply(8, 4, 1);
  const p2Supply = createSupply(8, 4, 1);
  return createGameState(
    board,
    [p1Supply, p2Supply],
    Player.P1,
    1,
    null,
    true
  );
}

function legalMoves(state) {
  const moves = [];

  if (state.winner !== null) {
    return moves;
  }

  const currentPlayer = state.current;
  const opponent = currentPlayer === Player.P1 ? Player.P2 : Player.P1;
  const currentSupply = state.supply[currentPlayer === Player.P1 ? 0 : 1];

  // Place a regular piece
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
  } else if (
    supplyList[currentIdx].regular === 0 &&
    supplyList[currentIdx].pusher === 0 &&
    supplyList[currentIdx].yellow === 0
  ) {
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

function isTerminal(state) {
  return state.winner !== null || legalMoves(state).length === 0;
}

// Utilities: helpers for stats, serialization, etc.

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Serialize game state to JSON for UI rendering
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

// Game session: state management, bot factory, move validation

class GameSession {
  constructor() {
    this.state = initialState();
    this.botP1 = new RandomBot(Player.P1);
    this.botP2 = new RandomBot(Player.P2);
    this.running = false;
    this.speedMs = 500;
    this.humanPlayer = null; // null | Player.P1 | Player.P2
    this.pendingMove = null; // null | Move
    this.waitingForHuman = false;
  }

  reset() {
    this.state = initialState();
    // Randomize starting player if a human is playing
    if (this.humanPlayer) {
      const startingPlayer = Math.random() < 0.5 ? Player.P1 : Player.P2;
      this.state = createGameState(
        this.state.board,
        this.state.supply,
        startingPlayer,
        this.state.turnNumber,
        this.state.winner,
        this.state.isFirstMove
      );
    }
    this.running = false;
    this.waitingForHuman = false;
    this.pendingMove = null;
  }

  setBots(botType1, botType2) {
    this.botP1 = this._makeBot(botType1, Player.P1);
    this.botP2 = this._makeBot(botType2, Player.P2);

    // Determine if there's a human player
    if (botType1 === 'human' || botType2 === 'human') {
      if (botType1 === 'human' && botType2 === 'human') {
        // Both human? Make P1 human, P2 random
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

  submitHumanMove(move) {
    if (this.state.current !== this.humanPlayer) {
      throw new Error('Not your turn');
    }

    // Validate move is legal
    const legal = legalMoves(this.state);
    if (!legal.some(m => movesEqual(m, move))) {
      throw new Error('Illegal move');
    }

    this.pendingMove = move;
  }

  _makeBot(botType, player) {
    if (botType === 'human') {
      return null;
    } else if (botType === 'random') {
      return new RandomBot(player);
    } else if (botType === 'mcts') {
      // Higher iterations for stronger play
      return new MCTSBot(player, 500);
    } else {
      throw new Error(`Unknown bot type: ${botType}`);
    }
  }
}

// Helper: compare two moves for equality
function movesEqual(m1, m2) {
  return (
    m1.action === m2.action &&
    m1.row === m2.row &&
    m1.col === m2.col &&
    m1.pieceType === m2.pieceType
  );
}

// Bot implementations: RandomBot and MCTSBot

class RandomBot {
  constructor(player) {
    this.player = player;
  }

  chooseMove(state) {
    const moves = legalMoves(state);
    return moves[Math.floor(Math.random() * moves.length)];
  }
}

// MCTS (Monte Carlo Tree Search) Bot

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
    node.untriedMoves.splice(idx, 1);

    const childState = applyMove(node.state, move);
    const child = new MCTSNode(childState, node, move);
    node.children.push(child);
    return child;
  }

  _evaluateTerminal(state) {
    if (state.winner === this.player) {
      return 1.0;
    } else if (state.winner === null) {
      return 0.5;
    } else {
      return 0.0;
    }
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

    if (current.winner === this.player) {
      return 1.0;
    } else if (current.winner === null) {
      return 0.5;
    } else {
      return 0.0;
    }
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
          node.wins += 1.0 - result;
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

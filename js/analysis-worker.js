// Web Worker: runs batch game simulations for analysis mode
// This worker loads the engine code and runs headless games

// Import game engine code into worker
// Paths are relative to HTML document (where Worker was created), not this file
console.log('[Worker] Analysis worker loaded');

try {
  // Paths are relative to this worker file's location (js/)
  importScripts(
    'engine/constants.js',
    'engine/game.js',
    'engine/bots.js'
  );
  console.log('[Worker] Scripts loaded successfully');
} catch (err) {
  console.error('[Worker] Failed to load scripts:', err);
  self.postMessage({
    type: 'error',
    error: `Failed to load scripts: ${err.message}`
  });
  throw err;
}

function makeBot(botType, player) {
  if (botType === 'random') {
    return new RandomBot(player);
  } else if (botType === 'mcts') {
    return new MCTSBot(player, 50); // Reduced iterations for faster analysis
  } else {
    throw new Error(`Unknown bot type: ${botType}`);
  }
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

self.onmessage = function(e) {
  console.log('[Worker] Received message:', e.data);
  const { iterations, bot1Type, bot2Type } = e.data;

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
    let currentBot1 = bot1;
    let currentBot2 = bot2;
    let currentBot1Type = bot1Type;
    let currentBot2Type = bot2Type;

    if (bot1Type !== bot2Type && i % 2 === 1) {
      currentBot1 = bot2;
      currentBot2 = bot1;
      currentBot1Type = bot2Type;
      currentBot2Type = bot1Type;
    }

    // Play game
    while (!isTerminal(state)) {
      const bot = state.current === Player.P1 ? currentBot1 : currentBot2;
      const move = bot.chooseMove(state);
      state = applyMove(state, move);
    }

    // Record results
    if (state.winner === Player.P1) {
      results.p1Wins++;
      results.botWins[currentBot1Type]++;
    } else if (state.winner === Player.P2) {
      results.p2Wins++;
      results.botWins[currentBot2Type]++;
    }

    results.turns.push(state.turnNumber);

    // Determine win method
    if (state.winner) {
      const winnerSupply = state.supply[state.winner === Player.P1 ? 0 : 1];
      const isAllPieces =
        winnerSupply.regular === 0 &&
        winnerSupply.pusher === 0 &&
        winnerSupply.yellow === 0;
      results.winMethods.push(isAllPieces ? 'all_pieces' : 'four_in_a_row');
    } else {
      results.winMethods.push('stalemate');
    }

    // Check if both koalas were used
    if (state.supply[0].yellow === 0 && state.supply[1].yellow === 0) {
      results.bothKoalasUsed++;
    }

    // Send progress update
    if ((i + 1) % Math.max(1, Math.floor(iterations / 10)) === 0 || i === iterations - 1) {
      self.postMessage({
        type: 'progress',
        completed: i + 1,
        total: iterations
      });
    }
  }

  // Calculate final statistics
  const totalGames = iterations;
  const fourInARowWins = results.winMethods.filter(m => m === 'four_in_a_row').length;

  const stats = {
    p1Wins: results.p1Wins,
    p2Wins: results.p2Wins,
    p1WinPct: (results.p1Wins / totalGames) * 100,
    p2WinPct: (results.p2Wins / totalGames) * 100,
    botTypeStats: {},
    fourInARowWins: fourInARowWins,
    fourInARowPct: (fourInARowWins / totalGames) * 100,
    avgTurns: results.turns.reduce((a, b) => a + b, 0) / results.turns.length,
    medianTurns: median(results.turns),
    minTurns: Math.min(...results.turns),
    maxTurns: Math.max(...results.turns),
    bothKoalasUsedPct: (results.bothKoalasUsed / totalGames) * 100
  };

  // Calculate bot type win percentages
  for (const [botType, wins] of Object.entries(results.botWins)) {
    stats.botTypeStats[botType] = (wins / totalGames) * 100;
  }

  self.postMessage({
    type: 'complete',
    stats: stats
  });
};

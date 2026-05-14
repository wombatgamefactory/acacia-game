// Game loop: play, pause, step, human move handling

async function runGameLoop(session, onUpdate, onGameOver) {
  while (session.running && !isTerminal(session.state)) {
    const currentPlayer = session.state.current;

    if (currentPlayer === session.humanPlayer) {
      // Human's turn: wait for input
      session.waitingForHuman = true;
      onUpdate(session.state);

      // Wait for move (polling every 50ms)
      await waitForHumanMove(session);

      if (session.pendingMove) {
        session.state = applyMove(session.state, session.pendingMove);
        session.pendingMove = null;
      }
      session.waitingForHuman = false;
    } else {
      // Bot's turn
      const bot = currentPlayer === Player.P1 ? session.botP1 : session.botP2;
      const move = bot.chooseMove(session.state);
      session.state = applyMove(session.state, move);

      // Sleep between moves (only for bots, not human)
      await new Promise(resolve => setTimeout(resolve, session.speedMs));
    }

    onUpdate(session.state);

    if (isTerminal(session.state)) {
      onGameOver(session.state);
      break;
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
    }, 50);
  });
}

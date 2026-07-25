// Game loop: play, pause, step, human move handling

async function runGameLoop(session, onUpdate, onGameOver) {
  // Each call takes a ticket. Restarting or resetting mid-game starts a new
  // loop, and any older loop retires as soon as it next wakes up.
  const ticket = (session.loopTicket || 0) + 1;
  session.loopTicket = ticket;

  const alive = () => session.running && session.loopTicket === ticket;

  while (alive() && !isTerminal(session.state)) {
    const currentPlayer = session.state.current;

    if (currentPlayer === session.humanPlayer) {
      // Human's turn: wait for input
      session.waitingForHuman = true;
      onUpdate(session.state);

      // Wait for move (polling every 50ms)
      await waitForHumanMove(session, alive);
      if (!alive()) break;

      if (session.pendingMove) {
        session.state = applyMove(session.state, session.pendingMove);
        session.pendingMove = null;
      }
      session.waitingForHuman = false;
    } else {
      // Bot's turn
      const bot = currentPlayer === Player.P1 ? session.botP1 : session.botP2;
      const move = bot.chooseMove(session.state);
      if (!alive()) break;
      session.state = applyMove(session.state, move);

      // Sleep between moves (only for bots, not human)
      await new Promise(resolve => setTimeout(resolve, session.speedMs));
      if (!alive()) break;
    }

    onUpdate(session.state);

    if (isTerminal(session.state)) {
      onGameOver(session.state);
      break;
    }
  }

  if (session.loopTicket === ticket) {
    session.running = false;
    session.waitingForHuman = false;
  }
}

function waitForHumanMove(session, alive) {
  return new Promise(resolve => {
    const pollInterval = setInterval(() => {
      if (session.pendingMove !== null || (alive && !alive())) {
        clearInterval(pollInterval);
        resolve();
      }
    }, 50);
  });
}

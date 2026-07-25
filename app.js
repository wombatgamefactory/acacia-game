/* ==========================================================================
   Acacia — UI layer
   Wires the (unchanged) game engine to the board renderer, the piece trays,
   the status line, the move history and the setup / menu / result screens.
   ========================================================================== */

const PLAYER_NAME = { 1: 'Owls', 2: 'Squirrels' };
const PLAYER_SOLO = { 1: 'owl', 2: 'squirrel' };
const PIECE_LABEL = { regular: 'regular piece', pusher: 'door', yellow: 'koala' };

const CHIP_ART = {
  1: { regular: 'images/pieces/owl.png',      pusher: 'images/pieces/door_blue.png', yellow: 'images/pieces/koala.png' },
  2: { regular: 'images/pieces/squirrel.png', pusher: 'images/pieces/door_red.png',  yellow: 'images/pieces/koala.png' }
};

const session = new GameSession();

const ui = {
  renderer: null,
  state: session.state,
  started: false,
  paused: false,
  selection: null,        // pieceType currently picked up
  drag: null,
  cursor: null,           // keyboard cursor {row, col}
  log: [],
  analysing: false,
  setup: { mode: 'vs-ai', side: 'p2', difficulty: 'easy', strength: 200 }
};

const $ = id => document.getElementById(id);
const cellName = (row, col) => `${'ABCDEF'[col]}${row + 1}`;
const supplyOf = (state, player) => state.supply[player === Player.P1 ? 0 : 1];
const otherPlayer = p => (p === Player.P1 ? Player.P2 : Player.P1);

/* ==========================================================================
   Boot
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  if (typeof APP_VERSION !== 'undefined') {
    const el = $('versionNumber');
    if (el) el.textContent = APP_VERSION;
  }

  ui.renderer = new BoardRenderer($('board'));
  ui.renderer.reset(session.state);

  fitBoard();
  wireBoardFit();
  wireSetupScreen();
  wireMenu();
  wireRules();
  wireBoard();
  wireControls();
  wireAnalysis();

  refresh({ animate: false });
});

/* ==========================================================================
   Board sizing
   --------------------------------------------------------------------------
   CSS alone cannot know how much vertical room the site header, trays, status
   line and buttons leave behind, so the board's max size is measured. This is
   what keeps the whole game on screen at any window size without scrolling.
   ========================================================================== */

function fitBoard() {
  const col = document.querySelector('.game-board-col');
  const stage = document.querySelector('.board-stage');
  if (!col || !stage) return;

  const styles = getComputedStyle(col);
  const rowGap = parseFloat(styles.rowGap) || 0;
  const colGap = parseFloat(styles.columnGap) || 0;
  const sideBySide = styles.display === 'grid';

  const top = stage.getBoundingClientRect().top + window.scrollY;
  let available, width;

  if (sideBySide) {
    // Trays sit beside the board, so only the window height limits it.
    const asideWidth = $('trayTop').getBoundingClientRect().width;
    available = window.innerHeight - top - 18;
    width = col.clientWidth - asideWidth - colGap;
  } else {
    // Anything above the board is already baked into the stage's page offset;
    // only what sits below it still has to be reserved.
    const children = [...col.children];
    const below = children.slice(children.indexOf(stage) + 1)
      .filter(el => el.offsetParent !== null);
    available = window.innerHeight - top - 18 -
      below.reduce((sum, el) => sum + el.getBoundingClientRect().height + rowGap, 0);
    width = col.clientWidth;
  }

  const size = Math.round(Math.max(200, Math.min(width, available, 720)));
  if (Math.abs(size - (ui.boardSize || 0)) < 2) return;

  ui.boardSize = size;
  col.style.setProperty('--board-max', `${size}px`);
}

function wireBoardFit() {
  let raf = null;
  const schedule = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { raf = null; fitBoard(); });
  };
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(schedule);
    document.querySelectorAll('.tray, .status-strip, .btn-row, .game-topbar').forEach(el => ro.observe(el));
  }
  // Fonts landing later can change the height of the furniture around the board.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
}

/* ==========================================================================
   Setup screen
   ========================================================================== */

const MODE_HINT = {
  'vs-ai': 'You take on the computer. Pick your side and how hard it should think.',
  'watch': 'Two bots play each other — handy for watching how the game flows.'
};

const DIFFICULTY_HINT = {
  easy: 'Quick, unpredictable moves. Good for learning the game.',
  hard: 'Searches ahead before every move. It will punish loose lines.'
};

function wireSetupScreen() {
  segmented('modeSegment', 'mode', value => {
    ui.setup.mode = value;
    $('modeHint').textContent = MODE_HINT[value];
    $('sideField').classList.toggle('hidden', value !== 'vs-ai');
    updateStrengthVisibility();
  });

  segmented('sideSegment', 'side', value => { ui.setup.side = value; });

  segmented('difficultySegment', 'difficulty', value => {
    ui.setup.difficulty = value;
    $('difficultyHint').textContent = DIFFICULTY_HINT[value];
    updateStrengthVisibility();
  });

  const slider = $('strengthSlider');
  const paint = () => {
    ui.setup.strength = parseInt(slider.value, 10);
    $('strengthValue').textContent = ui.setup.strength;
    slider.style.setProperty('--fill', `${((slider.value - slider.min) / (slider.max - slider.min)) * 100}%`);
  };
  slider.addEventListener('input', paint);
  paint();

  $('modeHint').textContent = MODE_HINT[ui.setup.mode];
  $('difficultyHint').textContent = DIFFICULTY_HINT[ui.setup.difficulty];

  $('btnStart').addEventListener('click', startGame);
  $('btnWelcomeRules').addEventListener('click', () => openOverlay('rulesOverlay'));
}

function updateStrengthVisibility() {
  const show = ui.setup.difficulty === 'hard';
  $('strengthField').classList.toggle('hidden', !show);
}

/** Small helper for the segmented controls in the setup card. */
function segmented(containerId, dataKey, onChange) {
  const container = $(containerId);
  if (!container) return;
  container.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || !container.contains(btn)) return;
    [...container.querySelectorAll('button')].forEach(b => b.classList.toggle('is-active', b === btn));
    onChange(btn.dataset[dataKey]);
  });
}

function startGame() {
  const { mode, side, difficulty, strength } = ui.setup;
  const botType = difficulty === 'hard' ? 'mcts' : 'random';

  // Think time has to be set before the bots are built.
  session.setMCTSThinkTime(difficulty === 'hard' ? strength : 150);

  if (mode === 'vs-ai') {
    if (side === 'p1') session.setBots('human', botType);
    else session.setBots(botType, 'human');
  } else {
    session.setBots('mcts', 'random');
  }

  closeOverlay('welcomeOverlay');
  beginRound();
}

/** Resets the board and starts the loop. */
function beginRound() {
  session.running = false;
  session.reset();

  ui.state = session.state;
  ui.selection = null;
  ui.cursor = null;
  ui.log = [];
  ui.started = true;
  ui.paused = false;

  ui.renderer.reset(session.state);
  renderLog();

  session.running = true;
  runGameLoop(session, onStateUpdate, onGameOver);

  refresh({ animate: false });
}

/* ==========================================================================
   Game loop callbacks
   ========================================================================== */

function onStateUpdate(state) {
  if (state !== ui.state) {
    appendLogEntry(ui.state, state);
    ui.state = state;
  }
  refresh();
}

function onGameOver(state) {
  ui.state = state;
  ui.selection = null;
  refresh();
  window.setTimeout(() => showResult(state), 900);
}

/* ==========================================================================
   Rendering the surrounding UI
   ========================================================================== */

/**
 * `rebuildTrays: false` keeps the existing chip elements alive (needed while a
 * chip is being dragged — replacing it mid-gesture would kill pointer capture)
 * and only restyles them.
 */
function refresh({ animate = true, rebuildTrays = true } = {}) {
  ui.renderer.setState(ui.state, { animate });
  ui.renderer.setHints(computeHints());
  ui.renderer.setCursor(ui.cursor);
  if (rebuildTrays) renderTrays(); else restyleChips();
  renderStatus();
  renderTurnCard();
  renderControls();
}

/** Reflects the current selection on chips already in the DOM. */
function restyleChips() {
  document.querySelectorAll('.tray-chips .chip').forEach(chip => {
    const selected = chip.dataset.piece === ui.selection && chip.classList.contains('is-playable');
    chip.classList.toggle('is-selected', selected);
    chip.setAttribute('aria-pressed', String(selected));
  });
}

function isHumanTurn() {
  return ui.started &&
    session.humanPlayer !== null &&
    ui.state.current === session.humanPlayer &&
    !isTerminal(ui.state);
}

/** Legal targets for whatever the player currently has picked up. */
function computeHints() {
  if (!isHumanTurn() || !ui.selection) return [];
  return legalMoves(ui.state)
    .filter(m => m.pieceType === ui.selection)
    .map(m => ({ row: m.row, col: m.col, kind: m.action === 'place' ? 'place' : 'eject' }));
}

function trayLayout() {
  // vs computer: the human always sits at the bottom.
  if (session.humanPlayer) {
    return { top: otherPlayer(session.humanPlayer), bottom: session.humanPlayer };
  }
  return { top: Player.P1, bottom: Player.P2 };
}

function renderTrays() {
  const { top, bottom } = trayLayout();
  paintTray($('trayTop'), top, false);
  paintTray($('trayBottom'), bottom, session.humanPlayer === bottom);
}

function paintTray(tray, player, interactive) {
  const active = ui.started && ui.state.current === player && !isTerminal(ui.state);
  const isHuman = session.humanPlayer === player;

  tray.className = `tray ${tray.id === 'trayTop' ? 'tray--opponent' : 'tray--player'} ` +
    (player === Player.P1 ? 'p1' : 'p2') + (active ? ' is-active' : '');

  tray.querySelector('.tray-avatar img').src = CHIP_ART[player].regular;

  const name = isHuman ? 'You' : (session.humanPlayer ? 'Computer' : `Player ${player}`);
  tray.querySelector('.tray-name').textContent = name;

  const sub = tray.querySelector('.tray-state');
  const supply = supplyOf(ui.state, player);
  const left = supply.regular + supply.pusher + supply.yellow;
  if (!ui.started) sub.textContent = `${PLAYER_NAME[player]}`;
  else if (isTerminal(ui.state)) sub.textContent = `${PLAYER_NAME[player]} — ${left} left`;
  else if (active) sub.textContent = isHuman ? 'your move' : 'thinking…';
  else sub.textContent = `${PLAYER_NAME[player]} — ${left} left`;

  const chips = tray.querySelector('.tray-chips');
  const moves = interactive && isHumanTurn() ? legalMoves(ui.state) : [];

  const wanted = [PieceType.REGULAR, PieceType.PUSHER, PieceType.YELLOW]
    .map(type => ({
      type,
      count: type === PieceType.REGULAR ? supply.regular : type === PieceType.PUSHER ? supply.pusher : supply.yellow
    }))
    .filter(entry => entry.count > 0);

  chips.innerHTML = '';
  for (const { type, count } of wanted) {
    const playable = interactive && moves.some(m => m.pieceType === type);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip ' +
      (type === PieceType.YELLOW ? 'chip--koala' : player === Player.P1 ? 'chip--p1' : 'chip--p2') +
      (type === PieceType.PUSHER ? ' chip--pusher' : '') +
      (interactive ? (playable ? ' is-playable' : ' is-disabled') : ' is-readonly') +
      (ui.selection === type && playable ? ' is-selected' : '');
    chip.dataset.piece = type;
    chip.disabled = !playable;
    chip.setAttribute('aria-pressed', String(ui.selection === type));
    chip.setAttribute('aria-label', `${count} ${PIECE_LABEL[type]}${count === 1 ? '' : 's'}`);
    chip.innerHTML =
      `<img src="${CHIP_ART[player][type]}" alt="" draggable="false">` +
      `<span class="chip-count">${count}</span>`;

    if (playable) {
      chip.addEventListener('pointerdown', onChipPointerDown);
      chip.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSelection(type); }
      });
    }
    chips.appendChild(chip);
  }
}

function renderStatus() {
  const strip = $('statusStrip');
  strip.classList.remove('is-hint');

  if (!ui.started) {
    strip.textContent = 'Choose how you want to play';
    return;
  }

  if (isTerminal(ui.state)) {
    strip.textContent = resultHeadline(ui.state);
    return;
  }

  if (isHumanTurn()) {
    strip.classList.add('is-hint');
    if (!ui.selection) {
      strip.textContent = 'Your turn — pick a piece below, then tap a glowing space';
    } else if (ui.selection === PieceType.REGULAR) {
      strip.textContent = 'Tap a glowing space to place your piece';
    } else {
      strip.textContent = `Tap a marked opponent piece to eject it with your ${PIECE_LABEL[ui.selection]}`;
    }
    return;
  }

  if (ui.paused) {
    strip.textContent = 'Paused';
    return;
  }

  const who = session.humanPlayer ? 'The computer' : PLAYER_NAME[ui.state.current];
  strip.innerHTML = `${who} is thinking <span class="thinking-dots"><span></span><span></span><span></span></span>`;
}

function renderTurnCard() {
  const dot = $('turnDot');
  const text = $('turnText');
  const isP1 = ui.state.current === Player.P1;

  dot.className = 'turn-dot ' + (ui.started && !isTerminal(ui.state) ? (isP1 ? 'p1' : 'p2') : '');

  if (!ui.started) {
    text.innerHTML = 'Not started<br><span class="turn-sub">Press start to play</span>';
    return;
  }
  if (isTerminal(ui.state)) {
    text.innerHTML = `${resultHeadline(ui.state)}<br><span class="turn-sub">Turn ${ui.state.turnNumber - 1}</span>`;
    return;
  }
  const who = isHumanTurn() ? 'Your turn' : `${PLAYER_NAME[ui.state.current]} to move`;
  text.innerHTML = `${who}<br><span class="turn-sub">Turn ${ui.state.turnNumber}</span>`;
}

function renderControls() {
  const watching = ui.started && !session.humanPlayer && !isTerminal(ui.state);
  for (const id of ['btnPauseResume', 'btnMenuPause']) {
    const btn = $(id);
    btn.classList.toggle('hidden', !watching);
    btn.textContent = ui.paused ? 'Resume' : 'Pause';
  }

  $('topbarSub').textContent = !ui.started
    ? 'Play online'
    : session.humanPlayer
      ? `You are the ${PLAYER_NAME[session.humanPlayer].toLowerCase()}`
      : 'Bot vs bot';
}

/* ==========================================================================
   Move history
   ========================================================================== */

function appendLogEntry(before, after) {
  if (!before || before.board === after.board) return;

  let placed = null, removed = null;
  for (let i = 0; i < after.board.length; i++) {
    if (before.board[i] === after.board[i]) continue;
    const row = Math.floor(i / 6), col = i % 6;
    if (after.board[i]) placed = { piece: after.board[i], row, col };
    if (before.board[i]) removed = { piece: before.board[i], row, col };
  }
  if (!placed) return;

  const mover = placed.piece.player;
  const at = cellName(placed.row, placed.col);
  let text;
  if (removed) {
    const victim = removed.piece.pieceType === PieceType.YELLOW ? 'koala'
      : removed.piece.pieceType === PieceType.PUSHER ? 'door'
      : PLAYER_SOLO[removed.piece.player];
    const tool = placed.piece.pieceType === PieceType.YELLOW ? 'Koala' : 'Door';
    text = `${tool} ejected a ${victim}`;
  } else {
    const what = placed.piece.pieceType === PieceType.YELLOW ? 'koala'
      : placed.piece.pieceType === PieceType.PUSHER ? 'door'
      : PLAYER_SOLO[mover];
    text = `Placed ${'aeiou'.includes(what[0]) ? 'an' : 'a'} ${what}`;
  }

  ui.log.unshift({ turn: before.turnNumber, player: mover, text, at });
  if (ui.log.length > 60) ui.log.pop();
  renderLog();
}

function renderLog() {
  const list = $('moveLog');
  if (!list) return;
  if (!ui.log.length) {
    list.innerHTML = '<li class="move-log-empty">No moves yet.</li>';
    return;
  }
  list.innerHTML = ui.log.map(entry =>
    `<li class="${entry.player === Player.P1 ? 'p1' : 'p2'}">` +
    `<span class="log-turn">${entry.turn}</span>` +
    `<span>${entry.text}</span>` +
    `<span class="log-cell" style="margin-left:auto">${entry.at}</span>` +
    `</li>`).join('');
}

/* ==========================================================================
   Picking pieces up: tap to select, or drag onto the board
   ========================================================================== */

function toggleSelection(pieceType) {
  ui.selection = ui.selection === pieceType ? null : pieceType;
  refresh({ animate: false, rebuildTrays: false });
}

function onChipPointerDown(e) {
  if (!isHumanTurn()) return;
  const chip = e.currentTarget;
  const pieceType = chip.dataset.piece;
  e.preventDefault();

  ui.drag = {
    pieceType,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
    ghost: null,
    chip,
    wasSelected: ui.selection === pieceType
  };

  if (ui.selection !== pieceType) {
    ui.selection = pieceType;
    refresh({ animate: false, rebuildTrays: false });
  }

  try { chip.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
  chip.addEventListener('pointermove', onChipPointerMove);
  chip.addEventListener('pointerup', onChipPointerUp);
  chip.addEventListener('pointercancel', onChipPointerUp);
}

function onChipPointerMove(e) {
  const drag = ui.drag;
  if (!drag || e.pointerId !== drag.pointerId) return;

  const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
  if (!drag.moved && dist > 8) {
    drag.moved = true;
    drag.ghost = document.createElement('div');
    drag.ghost.className = 'drag-ghost';
    drag.ghost.innerHTML = `<img src="${drag.chip.querySelector('img').src}" alt="">`;
    document.body.appendChild(drag.ghost);
    $('board').classList.add('is-dragging');
  }

  if (drag.moved) {
    drag.ghost.style.left = `${e.clientX}px`;
    drag.ghost.style.top = `${e.clientY}px`;
    const cell = ui.renderer.cellFromPoint(e.clientX, e.clientY);
    ui.renderer.setHover(cell && ui.renderer.hintAt(cell.row, cell.col) ? cell : null);
  }
}

function onChipPointerUp(e) {
  const drag = ui.drag;
  if (!drag || e.pointerId !== drag.pointerId) return;

  drag.chip.removeEventListener('pointermove', onChipPointerMove);
  drag.chip.removeEventListener('pointerup', onChipPointerUp);
  drag.chip.removeEventListener('pointercancel', onChipPointerUp);
  if (drag.ghost) drag.ghost.remove();
  $('board').classList.remove('is-dragging');
  ui.renderer.setHover(null);
  ui.drag = null;

  if (!drag.moved) {
    // A tap: leave the piece selected, or deselect if it already was.
    if (e.type !== 'pointercancel' && drag.wasSelected) ui.selection = null;
    refresh({ animate: false, rebuildTrays: false });
    return;
  }

  const cell = ui.renderer.cellFromPoint(e.clientX, e.clientY);
  if (cell) playAt(cell.row, cell.col, drag.pieceType);
  else refresh({ animate: false, rebuildTrays: false });
}

/* ==========================================================================
   Board interaction
   ========================================================================== */

function wireBoard() {
  const canvas = $('board');

  canvas.addEventListener('pointermove', e => {
    if (!isHumanTurn()) { ui.renderer.setHover(null); canvas.classList.remove('is-interactive'); return; }
    const cell = ui.renderer.cellFromPoint(e.clientX, e.clientY);
    const hint = cell && ui.renderer.hintAt(cell.row, cell.col);
    ui.renderer.setHover(hint ? cell : null);
    canvas.classList.toggle('is-interactive', Boolean(hint) || Boolean(cell && canQuickPlace(cell)));
  });

  canvas.addEventListener('pointerleave', () => ui.renderer.setHover(null));

  canvas.addEventListener('click', e => {
    if (!isHumanTurn()) return;
    const cell = ui.renderer.cellFromPoint(e.clientX, e.clientY);
    if (!cell) { ui.selection = null; refresh({ animate: false }); return; }
    playAt(cell.row, cell.col, ui.selection);
  });

  canvas.addEventListener('keydown', e => {
    if (!isHumanTurn()) return;
    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (step) {
      e.preventDefault();
      const cur = ui.cursor || { row: 2, col: 2 };
      ui.cursor = {
        row: Math.min(5, Math.max(0, cur.row + step[0])),
        col: Math.min(5, Math.max(0, cur.col + step[1]))
      };
      ui.renderer.setCursor(ui.cursor);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (ui.cursor) playAt(ui.cursor.row, ui.cursor.col, ui.selection);
      return;
    }
    const pick = { '1': PieceType.REGULAR, '2': PieceType.PUSHER, '3': PieceType.YELLOW }[e.key];
    if (pick) {
      const moves = legalMoves(ui.state);
      if (moves.some(m => m.pieceType === pick)) toggleSelection(pick);
    }
    if (e.key === 'Escape' && ui.selection) toggleSelection(ui.selection);
  });

  // The keyboard cursor only appears once someone actually uses the arrows.
  canvas.addEventListener('blur', () => { ui.cursor = null; ui.renderer.setCursor(null); });
  canvas.addEventListener('pointerdown', () => { ui.cursor = null; ui.renderer.setCursor(null); });
}

/** True when tapping an empty legal square should simply drop a regular piece. */
function canQuickPlace(cell) {
  if (!isHumanTurn() || ui.selection) return false;
  return legalMoves(ui.state).some(m =>
    m.pieceType === PieceType.REGULAR && m.row === cell.row && m.col === cell.col);
}

function playAt(row, col, pieceType) {
  if (!isHumanTurn()) return;

  let type = pieceType;
  if (!type) {
    // Nothing picked up: a tap on an empty legal square places a regular piece.
    if (canQuickPlace({ row, col })) type = PieceType.REGULAR;
    else {
      const strip = $('statusStrip');
      strip.classList.add('is-hint');
      strip.textContent = ui.state.board[row * 6 + col]
        ? 'Pick a door or koala first, then tap the piece you want to eject'
        : 'Pieces must touch a piece already on the board';
      return;
    }
  }

  const move = legalMoves(ui.state).find(m =>
    m.pieceType === type && m.row === row && m.col === col);

  if (!move) {
    ui.selection = null;
    refresh({ animate: false });
    return;
  }

  try {
    session.submitHumanMove(move);
    ui.selection = null;
    ui.renderer.setHover(null);
    refresh({ animate: false });
  } catch (err) {
    console.error('[Acacia] move rejected:', err);
  }
}

/* ==========================================================================
   Controls, menu, rules, result
   ========================================================================== */

function wireControls() {
  $('btnRestart').addEventListener('click', () => {
    if (!ui.started) { openOverlay('welcomeOverlay'); return; }
    beginRound();
  });

  $('btnChangeSetup').addEventListener('click', backToSetup);

  const togglePause = () => {
    if (isTerminal(ui.state) || !ui.started) return;
    ui.paused = !ui.paused;
    if (ui.paused) {
      session.running = false;
    } else {
      session.running = true;
      runGameLoop(session, onStateUpdate, onGameOver);
    }
    refresh({ animate: false });
  };

  $('btnPauseResume').addEventListener('click', togglePause);
  $('btnMenuPause').addEventListener('click', togglePause);

  $('btnPlayAgain').addEventListener('click', () => {
    closeOverlay('gameOverOverlay');
    beginRound();
  });

  $('btnBackToSetup').addEventListener('click', () => {
    closeOverlay('gameOverOverlay');
    backToSetup();
  });
}

function backToSetup() {
  session.running = false;
  ui.started = false;
  ui.paused = false;
  ui.selection = null;
  session.reset();
  ui.state = session.state;
  ui.log = [];
  ui.renderer.reset(session.state);
  renderLog();
  refresh({ animate: false });
  openOverlay('welcomeOverlay');
}

function wireMenu() {
  $('btnMenu').addEventListener('click', () => openOverlay('menuOverlay'));
  $('menuClose').addEventListener('click', () => closeOverlay('menuOverlay'));
  $('btnMenuNewGame').addEventListener('click', () => { closeOverlay('menuOverlay'); backToSetup(); });
  $('btnMenuRestart').addEventListener('click', () => {
    closeOverlay('menuOverlay');
    if (ui.started) beginRound(); else openOverlay('welcomeOverlay');
  });
  $('btnMenuRules').addEventListener('click', () => { closeOverlay('menuOverlay'); openOverlay('rulesOverlay'); });

  const speed = $('speedSlider');
  const paint = () => {
    session.speedMs = parseInt(speed.value, 10);
    $('speedValue').textContent = session.speedMs;
    speed.style.setProperty('--fill', `${((speed.value - speed.min) / (speed.max - speed.min)) * 100}%`);
  };
  speed.addEventListener('input', paint);
  paint();
}

function wireRules() {
  $('btnRules').addEventListener('click', () => openOverlay('rulesOverlay'));
  $('rulesClose').addEventListener('click', () => closeOverlay('rulesOverlay'));

  // Click the backdrop or press Escape to dismiss any dismissible overlay.
  for (const id of ['rulesOverlay', 'menuOverlay']) {
    $(id).addEventListener('click', e => { if (e.target === $(id)) closeOverlay(id); });
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    for (const id of ['rulesOverlay', 'menuOverlay']) {
      if (!$(id).classList.contains('hidden')) { closeOverlay(id); return; }
    }
  });
}

function openOverlay(id) { $(id).classList.remove('hidden'); }
function closeOverlay(id) { $(id).classList.add('hidden'); }

function resultHeadline(state) {
  if (!state.winner) return 'Draw';
  if (session.humanPlayer) return state.winner === session.humanPlayer ? 'You win!' : 'The computer wins';
  return `${PLAYER_NAME[state.winner]} win`;
}

function showResult(state) {
  const winner = state.winner;
  $('resultTitle').textContent = resultHeadline(state);

  let reason = 'No legal moves remain.';
  if (winner) {
    const line = findWinningLine(state.board, winner);
    reason = line
      ? `Four in a row — ${line.map(([r, c]) => cellName(r, c)).join(' · ')}`
      : 'Every piece placed on the board.';
  }
  $('resultSub').textContent = `${reason} · ${state.turnNumber - 1} turns played`;

  const avatar = $('resultAvatar').querySelector('img');
  avatar.src = CHIP_ART[winner || Player.P1].regular;

  openOverlay('gameOverOverlay');
}

/* ==========================================================================
   Balance lab (web worker)
   ========================================================================== */

function wireAnalysis() {
  $('btnRunAnalysis').addEventListener('click', () => {
    if (ui.analysing) return;
    const btn = $('btnRunAnalysis');
    const iterations = Math.max(1, Math.min(10000, parseInt($('iterationsInput').value, 10) || 20));

    ui.analysing = true;
    btn.disabled = true;
    btn.textContent = 'Running…';
    $('analysisProgress').classList.remove('hidden');
    $('statsGrid').classList.add('hidden');
    $('progressBarFill').style.width = '0%';
    $('progressLabel').textContent = `Starting game 1 of ${iterations}…`;

    runAnalysis(iterations, 'mcts', 'random', ui.setup.strength, onAnalysisProgress, onAnalysisComplete);
  });
}

function onAnalysisProgress(completed, total) {
  $('progressBarFill').style.width = `${Math.round((completed / total) * 100)}%`;
  $('progressLabel').textContent = `Game ${completed} of ${total}`;
}

function onAnalysisComplete(stats) {
  const btn = $('btnRunAnalysis');
  ui.analysing = false;
  btn.disabled = false;
  btn.textContent = 'Run';
  $('analysisProgress').classList.add('hidden');

  if (!stats) {
    $('progressLabel').textContent = 'Analysis failed — a local web server is needed for workers.';
    $('analysisProgress').classList.remove('hidden');
    return;
  }

  const cells = [
    ['Owls win', `${stats.p1WinPct.toFixed(1)}%`],
    ['Squirrels win', `${stats.p2WinPct.toFixed(1)}%`],
    ['Four in a row', `${stats.fourInARowPct.toFixed(1)}%`],
    ['Both koalas used', `${stats.bothKoalasUsedPct.toFixed(1)}%`],
    ['Average turns', stats.avgTurns.toFixed(1)],
    ['Median turns', String(stats.medianTurns)],
    ['Shortest', String(stats.minTurns)],
    ['Longest', String(stats.maxTurns)]
  ];

  if (stats.botTypeStats) {
    for (const [botType, winPct] of Object.entries(stats.botTypeStats)) {
      cells.push([`${botType} bot`, `${winPct.toFixed(1)}%`]);
    }
  }

  $('statsGrid').innerHTML = cells.map(([label, value]) =>
    `<div class="stat-item"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`).join('');
  $('statsGrid').classList.remove('hidden');
}

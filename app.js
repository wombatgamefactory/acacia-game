// Main UI application - wires game engine to HTML/Canvas

const CELL_SIZE = 90;
const BOARD_SIZE = 6;
const PIECE_RADIUS = 30;

let gameSession = new GameSession();
let currentState = gameSession.state;
let gameRunning = false;
let isAnalysing = false;
let dragState = null;
let imageCache = {};

// Welcome screen state
let welcomeMode = 'vs-ai';      // 'vs-ai' | 'watch'
let welcomeDifficulty = 'easy'; // 'easy' | 'hard'
let selectedPiece = null;       // {pieceType, action} | null — for tap-to-select (Phase 3)

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  console.log('[App] Initializing game...');
  const versionElem = document.getElementById('versionNumber');
  if (versionElem) versionElem.textContent = APP_VERSION;
  preloadImages();
  renderBoard();
  updateSupply();
  updateCurrentPlayer();
  initWelcomeScreen();
  console.log('[App] Game initialization complete');
});

// ============ Welcome Screen ============

function initWelcomeScreen() {
  const overlay = document.getElementById('welcomeOverlay');
  if (!overlay) {
    console.warn('[Welcome] welcomeOverlay element not found');
    return; // Welcome screen not available
  }

  // Ensure overlay is visible with inline styles as fallback
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '10000';
  overlay.style.background = 'rgba(0, 0, 0, 0.85)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '1rem';

  console.log('[Welcome] welcomeOverlay found, display:', window.getComputedStyle(overlay).display);
  console.log('[Welcome] welcomeOverlay visible:', overlay.offsetHeight > 0);

  // Ensure welcome card is visible
  const card = overlay.querySelector('.welcome-card');
  if (card) {
    card.style.background = card.style.background || '#1a1a1a';
    card.style.border = card.style.border || '1px solid #444';
    card.style.color = card.style.color || '#f5f5dc';
  }

  const modeButtons = document.querySelectorAll('.welcome-mode-btn');
  const toggleButtons = document.querySelectorAll('.welcome-toggle');

  // Mode toggle buttons
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      welcomeMode = btn.dataset.mode;
      modeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const difficultySection = document.getElementById('welcomeDifficulty');
      if (difficultySection) {
        difficultySection.style.display = welcomeMode === 'vs-ai' ? 'block' : 'none';
      }
    });
  });

  // Difficulty toggle
  toggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      welcomeDifficulty = btn.dataset.difficulty;
      toggleButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Rules modal
  const rulesBtn = document.getElementById('welcomeRulesBtn');
  if (rulesBtn) {
    rulesBtn.addEventListener('click', () => {
      const rulesModal = document.getElementById('rulesModal');
      if (rulesModal) rulesModal.classList.remove('hidden');
    });
  }

  const rulesModalClose = document.getElementById('rulesModalClose');
  if (rulesModalClose) {
    rulesModalClose.addEventListener('click', () => {
      const rulesModal = document.getElementById('rulesModal');
      if (rulesModal) rulesModal.classList.add('hidden');
    });
  }

  // Start game
  const startBtn = document.getElementById('welcomeStartBtn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      applyWelcomeConfig();
      overlay.classList.add('hidden');
      startGameFromWelcome();
    });
  }
}

function applyWelcomeConfig() {
  if (welcomeMode === 'vs-ai') {
    // Human is P1, bot is P2
    const botType = welcomeDifficulty === 'hard' ? 'mcts' : 'random';
    gameSession.setBots('human', botType);
    // Set MCTS think time for harder difficulty
    if (botType === 'mcts') {
      gameSession.setMCTSThinkTime(200);
    }
  } else if (welcomeMode === 'watch') {
    // Watch mode: bot vs bot (MCTS vs Random)
    gameSession.setBots('mcts', 'random');
  }
}

function startGameFromWelcome() {
  gameRunning = true;
  gameSession.running = true;
  currentState = gameSession.state;
  runGameLoop(gameSession, onStateUpdate, onGameOver);
  updateGameStatus(gameSession.humanPlayer ? 'Your turn!' : 'Watching...');
  updateSupply();
  updateCurrentPlayer();
  updateWatchControlsVisibility();
}

// ============ Canvas Rendering ============

async function preloadImages() {
  const imageFiles = [
    'images/piece_owl.png',
    'images/piece_squirrel.png',
    'images/piece_koala.png',
    'images/house_blue.png',
    'images/house_red.png',
    'images/game_logo.png'
  ];
  for (const src of imageFiles) {
    try {
      await loadImage(src);
    } catch (e) {
      console.warn(`Failed to preload image: ${src}`);
    }
  }
}

function getImagePath(piece) {
  if (piece.pieceType === PieceType.REGULAR) {
    return piece.player === Player.P1 ? 'images/piece_owl.png' : 'images/piece_squirrel.png';
  } else if (piece.pieceType === PieceType.PUSHER) {
    return piece.player === Player.P1 ? 'images/house_blue.png' : 'images/house_red.png';
  } else if (piece.pieceType === PieceType.YELLOW) {
    return 'images/piece_koala.png';
  }
  return 'images/piece_owl.png';
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (imageCache[src]) {
      resolve(imageCache[src]);
    } else {
      const img = new Image();
      img.onload = () => {
        imageCache[src] = img;
        resolve(img);
      };
      img.onerror = reject;
      img.src = src;
    }
  });
}

function drawImagePreservingAspectRatio(ctx, img, centerX, centerY, maxWidth, maxHeight) {
  const imgAspect = img.width / img.height;
  const boxAspect = maxWidth / maxHeight;
  let drawWidth, drawHeight;

  if (imgAspect > boxAspect) {
    drawWidth = maxWidth;
    drawHeight = maxWidth / imgAspect;
  } else {
    drawHeight = maxHeight;
    drawWidth = maxHeight * imgAspect;
  }

  const x = centerX - drawWidth / 2;
  const y = centerY - drawHeight / 2;
  ctx.drawImage(img, x, y, drawWidth, drawHeight);
}

async function renderBoard() {
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw grid
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  for (let r = 0; r <= BOARD_SIZE; r++) {
    const y = r * CELL_SIZE;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(BOARD_SIZE * CELL_SIZE, y);
    ctx.stroke();
  }
  for (let c = 0; c <= BOARD_SIZE; c++) {
    const x = c * CELL_SIZE;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, BOARD_SIZE * CELL_SIZE);
    ctx.stroke();
  }

  // Draw legal move highlights (when dragging or selecting)
  const legalMovesForState = legalMoves(currentState);
  const activeFilter = dragState || selectedPiece;
  if (activeFilter && legalMovesForState.length > 0) {
    ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
    for (const move of legalMovesForState) {
      if (move.pieceType === activeFilter.pieceType && move.action === activeFilter.action) {
        const x = move.col * CELL_SIZE;
        const y = move.row * CELL_SIZE;
        ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
      }
    }
  }

  // Draw pieces
  const pieceMap = {};
  currentState.board.forEach((piece, idx) => {
    if (piece) {
      const [r, c] = rc(idx);
      pieceMap[`${r},${c}`] = piece;
    }
  });

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const key = `${r},${c}`;
      const piece = pieceMap[key];

      if (piece) {
        const cx = c * CELL_SIZE + CELL_SIZE / 2;
        const cy = r * CELL_SIZE + CELL_SIZE / 2;

        try {
          const imagePath = getImagePath(piece);
          const img = await loadImage(imagePath);
          drawImagePreservingAspectRatio(ctx, img, cx, cy, PIECE_RADIUS * 2, PIECE_RADIUS * 2);
        } catch (e) {
          console.error('Failed to load image:', e);
          // Fallback circles
          const fallbackColor = piece.pieceType === 'yellow' ? '#ffdd00' : (piece.player === 'p1' ? '#4499ff' : '#ff6666');
          ctx.fillStyle = fallbackColor;
          ctx.beginPath();
          ctx.arc(cx, cy, PIECE_RADIUS, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }
  }
}

function updateSupplyZones() {
  // Phase 2: Populate new supply zone containers with draggable pieces
  const opponentZone = document.getElementById('opponentSupplyZone');
  const playerZone = document.getElementById('playerSupplyZone');

  if (!opponentZone || !playerZone) return;

  const humanIsP1 = gameSession.humanPlayer === Player.P1;
  const humanIsP2 = gameSession.humanPlayer === Player.P2;

  function getPieceImage(player, pieceType) {
    if (pieceType === PieceType.REGULAR) {
      return player === Player.P1 ? 'images/piece_owl.png' : 'images/piece_squirrel.png';
    } else if (pieceType === PieceType.PUSHER) {
      return player === Player.P1 ? 'images/house_blue.png' : 'images/house_red.png';
    } else if (pieceType === PieceType.YELLOW) {
      return 'images/piece_koala.png';
    }
    return 'images/piece_owl.png';
  }

  function buildSupplyHTML(playerIdx, supply, isInteractive) {
    const player = playerIdx === 0 ? Player.P1 : Player.P2;
    const moves = isInteractive && gameRunning && currentState.current === player
      ? legalMoves(currentState)
      : [];

    let html = '<div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">';

    // Regular pieces
    if (supply.regular > 0) {
      const hasMove = moves.some(m => m.pieceType === PieceType.REGULAR && m.action === 'place');
      const isSelected = selectedPiece && selectedPiece.pieceType === PieceType.REGULAR && selectedPiece.action === 'place';
      let classes = isInteractive ? (hasMove ? 'draggable-piece' : 'draggable-piece disabled') : 'draggable-piece disabled';
      if (isSelected) classes += ' selected';
      html += `<div class="${classes}" data-piece="regular" data-action="place" style="display: flex; align-items: center; justify-content: center; padding: 0; position: relative;">
        <img src="${getPieceImage(player, PieceType.REGULAR)}" alt="Regular piece" style="width: 100%; height: 100%; object-fit: contain; padding: 2px;">
        <span style="position: absolute; bottom: 2px; right: 4px; font-size: 11px; color: var(--cream); font-weight: 700; background: rgba(0,0,0,0.5); border-radius: 2px; padding: 1px 3px;">${supply.regular}</span>
      </div>`;
    }

    // House pieces
    if (supply.pusher > 0) {
      const hasMove = moves.some(m => m.pieceType === PieceType.PUSHER && m.action === 'eject');
      const isSelected = selectedPiece && selectedPiece.pieceType === PieceType.PUSHER && selectedPiece.action === 'eject';
      let classes = isInteractive ? (hasMove ? 'draggable-piece' : 'draggable-piece disabled') : 'draggable-piece disabled';
      if (isSelected) classes += ' selected';
      html += `<div class="${classes}" data-piece="pusher" data-action="eject" style="display: flex; align-items: center; justify-content: center; padding: 0; position: relative;">
        <img src="${getPieceImage(player, PieceType.PUSHER)}" alt="House piece" style="width: 100%; height: 100%; object-fit: contain; padding: 2px;">
        <span style="position: absolute; bottom: 2px; right: 4px; font-size: 11px; color: var(--cream); font-weight: 700; background: rgba(0,0,0,0.5); border-radius: 2px; padding: 1px 3px;">${supply.pusher}</span>
      </div>`;
    }

    // Yellow/Koala pieces
    if (supply.yellow > 0) {
      const hasMove = moves.some(m => m.pieceType === PieceType.YELLOW && m.action === 'eject');
      const isSelected = selectedPiece && selectedPiece.pieceType === PieceType.YELLOW && selectedPiece.action === 'eject';
      let classes = isInteractive ? (hasMove ? 'draggable-piece' : 'draggable-piece disabled') : 'draggable-piece disabled';
      if (isSelected) classes += ' selected';
      html += `<div class="${classes}" data-piece="yellow" data-action="eject" style="display: flex; align-items: center; justify-content: center; padding: 0; position: relative;">
        <img src="${getPieceImage(player, PieceType.YELLOW)}" alt="Koala piece" style="width: 100%; height: 100%; object-fit: contain; padding: 2px;">
        <span style="position: absolute; bottom: 2px; right: 4px; font-size: 11px; color: var(--cream); font-weight: 700; background: rgba(0,0,0,0.5); border-radius: 2px; padding: 1px 3px;">${supply.yellow}</span>
      </div>`;
    }

    html += '</div>';
    return html;
  }

  if (humanIsP1 || humanIsP2) {
    // vs-AI mode
    const opponentIdx = humanIsP1 ? 1 : 0;
    const playerIdx = humanIsP1 ? 0 : 1;
    const opponentSupply = currentState.supply[opponentIdx];
    const playerSupply = currentState.supply[playerIdx];

    // Opponent zone (read-only)
    opponentZone.innerHTML = `<span class="supply-zone-label">Opponent</span>` + buildSupplyHTML(opponentIdx, opponentSupply, false);
    opponentZone.className = 'supply-zone supply-zone--opponent ' + (opponentIdx === 0 ? 'p1-accent' : 'p2-accent');

    // Player zone (interactive)
    playerZone.innerHTML = `<span class="supply-zone-label">Your pieces</span>` + buildSupplyHTML(playerIdx, playerSupply, true);
    playerZone.className = 'supply-zone supply-zone--player ' + (playerIdx === 0 ? 'p1-accent' : 'p2-accent');
    if (currentState.current === (playerIdx === 0 ? Player.P1 : Player.P2)) {
      playerZone.classList.add('your-turn');
    }
  } else {
    // Watch mode
    const p1Supply = currentState.supply[0];
    const p2Supply = currentState.supply[1];

    opponentZone.innerHTML = `<span class="supply-zone-label">Player 1</span>` + buildSupplyHTML(0, p1Supply, false);
    opponentZone.className = 'supply-zone supply-zone--opponent p1-accent';

    playerZone.innerHTML = `<span class="supply-zone-label">Player 2</span>` + buildSupplyHTML(1, p2Supply, false);
    playerZone.className = 'supply-zone supply-zone--player p2-accent';
  }

  // Attach drag and tap-to-select handlers to new draggable pieces
  document.querySelectorAll('#opponentSupplyZone .draggable-piece:not(.disabled), #playerSupplyZone .draggable-piece:not(.disabled)').forEach(el => {
    // Tap-to-select handler (click for desktop, after touch ends on mobile)
    el.addEventListener('click', (e) => {
      if (!gameRunning || !gameSession.waitingForHuman) return;

      const pieceType = el.dataset.piece;
      const action = el.dataset.action;

      // Toggle selection: if clicking the same piece, deselect it
      if (selectedPiece && selectedPiece.pieceType === pieceType && selectedPiece.action === action) {
        selectedPiece = null;
      } else {
        selectedPiece = { pieceType, action };
      }

      renderBoard();
      updateSupplyZones();
    });

    // Drag handlers
    el.addEventListener('mousedown', (e) => {
      // Clear selection when starting drag
      selectedPiece = null;
      startDrag(e);
    });
    el.addEventListener('touchstart', (e) => {
      // Clear selection when starting drag
      selectedPiece = null;
      startDrag(e);
    });
  });
}

function updateSupply() {
  updateSupplyZones();
}

function updateCurrentPlayer() {
  const isP1 = currentState.current === Player.P1;
  const isHumanTurn = gameSession.waitingForHuman;
  const playerName = isP1 ? 'Player 1' : 'Player 2';

  // Update turn banner (Phase 2)
  const banner = document.getElementById('turnBanner');
  if (!banner) return; // Element not ready yet

  banner.className = 'turn-banner ' + (isP1 ? 'p1' : 'p2') + (isHumanTurn ? ' your-turn' : '');
  if (isHumanTurn) {
    banner.textContent = 'Your turn — tap a piece, then tap the board';
  } else if (isTerminal(currentState)) {
    if (currentState.winner) {
      const winnerName = currentState.winner === Player.P1 ? 'Player 1' : 'Player 2';
      banner.textContent = `${winnerName} wins!`;
    } else {
      banner.textContent = 'Draw!';
    }
  } else {
    banner.textContent = `${playerName}'s turn`;
  }
}

function updateWatchControlsVisibility() {
  // Phase 2: Toggle watch controls based on game mode
  const isWatchMode = !gameSession.humanPlayer;
  const watchControls = document.getElementById('watchControls');
  const playControls = document.getElementById('playControls');

  if (watchControls) {
    watchControls.classList.toggle('hidden', !isWatchMode);
  }
  if (playControls) {
    playControls.classList.toggle('hidden', isWatchMode);
  }
}

function updateGameStatus(status) {
  const elem = document.getElementById('gameStatus');
  if (elem) elem.textContent = status;
}

// ============ Drag and Drop ============

function startDrag(e) {
  if (e.type === 'mousedown' && e.button !== 0) return;
  if (!gameRunning) return;
  e.preventDefault();
  let el = e.target;
  // If clicked on image, get parent draggable-piece div
  if (el.tagName === 'IMG') {
    el = el.closest('.draggable-piece');
  }
  dragState = {
    pieceType: el.dataset.piece,
    action: el.dataset.action
  };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragDrop);
  document.addEventListener('touchmove', onDragMove, { passive: false });
  document.addEventListener('touchend', onDragDrop);
  // Use 'scroll' instead of 'hidden' to prevent scrollbar flicker
  document.body.style.overflowY = 'scroll';
  document.getElementById('board').classList.add('dragging');
  renderBoard();
}

function onDragMove(e) {
  if (dragState) {
    if (e.type.startsWith('touch')) {
      e.preventDefault();
    }
    renderBoard();
  }
}

function onDragDrop(e) {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragDrop);
  document.removeEventListener('touchmove', onDragMove);
  document.removeEventListener('touchend', onDragDrop);
  document.body.style.overflowY = '';

  document.getElementById('board').classList.remove('dragging');

  if (!dragState) return;

  const canvas = document.getElementById('board');
  const rect = canvas.getBoundingClientRect();

  let x, y;
  if (e.type.startsWith('touch')) {
    const touch = e.changedTouches[0];
    x = touch.clientX - rect.left;
    y = touch.clientY - rect.top;
  } else {
    x = e.clientX - rect.left;
    y = e.clientY - rect.top;
  }

  // Scale coordinates to canvas internal size (account for CSS scaling on mobile)
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  x *= scaleX;
  y *= scaleY;

  const col = Math.floor(x / CELL_SIZE);
  const row = Math.floor(y / CELL_SIZE);

  console.log('Drop at row:', row, 'col:', col, 'dragState:', dragState);

  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
    dragState = null;
    renderBoard();
    return;
  }

  // Check if move is legal
  const moves = legalMoves(currentState);
  console.log('Legal moves:', moves.filter(m => m.pieceType === dragState.pieceType && m.action === dragState.action));

  const matchingMove = moves.find(m =>
    m.pieceType === dragState.pieceType &&
    m.action === dragState.action &&
    m.row === row &&
    m.col === col
  );

  console.log('Matching move:', matchingMove);

  if (matchingMove) {
    try {
      console.log('Submitting move:', matchingMove);
      gameSession.submitHumanMove(matchingMove);
      console.log('Move submitted. pendingMove:', gameSession.pendingMove);
      updateGameStatus('Move sent. Waiting for opponent...');
    } catch (err) {
      console.error('Error submitting move:', err);
      updateGameStatus(`Error: ${err.message}`);
    }
  } else {
    updateGameStatus('Invalid move target');
  }

  dragState = null;
  renderBoard();
}

// ============ Game Loop Callbacks ============

function onStateUpdate(state) {
  currentState = state;
  renderBoard();
  updateSupply();
  updateCurrentPlayer();
}

function onGameOver(state) {
  currentState = state;
  gameRunning = false;
  renderBoard();
  updateSupply();
  updateCurrentPlayer();

  // Show game-over overlay (Phase 5)
  const overlay = document.getElementById('gameOverOverlay');
  const winnerDiv = document.getElementById('gameOverWinner');

  if (state.winner) {
    if (gameSession.humanPlayer) {
      // vs-AI mode: show personalized message
      const isHumanWinner = state.winner === gameSession.humanPlayer;
      winnerDiv.textContent = isHumanWinner ? 'You Win! 🎉' : 'Opponent Wins';
    } else {
      // Watch mode: show player name
      const winnerName = state.winner === Player.P1 ? 'Player 1' : 'Player 2';
      winnerDiv.textContent = `${winnerName} Wins! 🎉`;
    }
  } else {
    winnerDiv.textContent = 'Draw!';
  }

  overlay.classList.remove('hidden');
}

// ============ Game Over Overlay Handler (Phase 5) ============

const playAgainBtn2 = document.getElementById('playAgainBtn2');
if (playAgainBtn2) {
  playAgainBtn2.addEventListener('click', () => {
    document.getElementById('gameOverOverlay').classList.add('hidden');
    performReset();
  });
}

const returnToMenuBtn = document.getElementById('returnToMenuBtn');
if (returnToMenuBtn) {
  returnToMenuBtn.addEventListener('click', () => {
    document.getElementById('gameOverOverlay').classList.add('hidden');
    gameRunning = false;
    gameSession.running = false;
    gameSession.reset();
    currentState = gameSession.state;
    dragState = null;
    selectedPiece = null;
    renderBoard();
    updateSupply();
    updateCurrentPlayer();
    document.getElementById('welcomeOverlay').classList.remove('hidden');
  });
}

// ============ Menu Modal Handler (Phase 4) ============

const menuBtn = document.getElementById('menuBtn');
if (menuBtn) {
  menuBtn.addEventListener('click', () => {
    document.getElementById('menuModal').classList.remove('hidden');
    // Sync the speed slider value
    const menuSlider = document.getElementById('speedSliderMenu');
    if (menuSlider) {
      menuSlider.value = gameSession.speedMs;
    }
  });
}

const menuModalClose = document.getElementById('menuModalClose');
if (menuModalClose) {
  menuModalClose.addEventListener('click', () => {
    document.getElementById('menuModal').classList.add('hidden');
  });
}

const btnNewGame = document.getElementById('btnNewGame');
if (btnNewGame) {
  btnNewGame.addEventListener('click', () => {
    // Stop game, reset, and show welcome overlay
    gameRunning = false;
    gameSession.running = false;
    document.getElementById('menuModal').classList.add('hidden');
    gameSession.reset();
    currentState = gameSession.state;
    dragState = null;
    selectedPiece = null;
    renderBoard();
    updateSupply();
    updateCurrentPlayer();
    document.getElementById('welcomeOverlay').classList.remove('hidden');
  });
}

// Speed slider in menu (Phase 4)
const speedSliderMenu = document.getElementById('speedSliderMenu');
if (speedSliderMenu) {
  speedSliderMenu.addEventListener('input', (e) => {
    gameSession.speedMs = parseInt(e.target.value);
  });
}

// ============ Canvas Click Handler (Tap-to-Place) ============

const boardCanvas = document.getElementById('board');
if (boardCanvas) {
  boardCanvas.addEventListener('click', (e) => {
    if (!selectedPiece || !gameRunning || !gameSession.waitingForHuman) return;

    const canvas = document.getElementById('board');
    const rect = canvas.getBoundingClientRect();

    // Calculate coordinates relative to canvas
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Scale coordinates to canvas internal size (account for CSS scaling on mobile)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;

    const col = Math.floor(scaledX / CELL_SIZE);
    const row = Math.floor(scaledY / CELL_SIZE);

    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
      // Click outside board - clear selection
      selectedPiece = null;
      renderBoard();
      updateSupplyZones();
      return;
    }

    // Find matching move
    const moves = legalMoves(currentState);
    const matchingMove = moves.find(m =>
      m.pieceType === selectedPiece.pieceType &&
      m.action === selectedPiece.action &&
      m.row === row &&
      m.col === col
    );

    if (matchingMove) {
      try {
        gameSession.submitHumanMove(matchingMove);
        updateGameStatus('Move sent. Waiting for opponent...');
        selectedPiece = null;
      } catch (err) {
        console.error('Error submitting move:', err);
        updateGameStatus(`Error: ${err.message}`);
      }
    } else {
      // Tap on non-legal cell - clear selection
      selectedPiece = null;
    }

    renderBoard();
    updateSupplyZones();
  });
}

// ============ Reset Button Handler ============

function performReset() {
  gameRunning = false;
  gameSession.reset();
  currentState = gameSession.state;
  dragState = null;
  selectedPiece = null;
  updateGameStatus('Game reset');
  renderBoard();
  updateSupply();
  updateCurrentPlayer();

  // Auto-restart the game loop if there's a human player
  if (gameSession.humanPlayer) {
    gameRunning = true;
    gameSession.running = true;
    currentState = gameSession.state;
    runGameLoop(gameSession, onStateUpdate, onGameOver);
    updateGameStatus('Your turn!');
    updateWatchControlsVisibility();
  }
}

// Wire new Reset button (Phase 2)
const btnReset2 = document.getElementById('btnReset2');
if (btnReset2) {
  btnReset2.addEventListener('click', performReset);
}

// ============ Analysis ============

function updateAnalysisProgress(completed, total) {
  const progressBar = document.getElementById('progressBarFill');
  const gameStatus = document.getElementById('currentGameStatus');
  const percent = Math.round((completed / total) * 100);

  console.log(`[Analysis] Progress: ${completed}/${total} (${percent}%)`);
  gameStatus.textContent = `Running Game ${completed} of ${total}...`;
  progressBar.style.width = percent + '%';
  progressBar.textContent = percent > 10 ? percent + '%' : '';
}

function displayAnalysisResults(stats) {
  const statsGrid = document.getElementById('statsGrid');
  const analyseProgress = document.getElementById('analyseProgress');
  const runBtn = document.getElementById('btnRunAnalysis');

  if (!stats) {
    console.error('[Analysis] Error - stats is null');
    updateGameStatus('Analysis error');
    runBtn.disabled = false;
    runBtn.textContent = 'Run Analysis';
    isAnalysing = false;
    return;
  }

  console.log('[Analysis] Complete. Stats:', stats);
  analyseProgress.classList.remove('visible');
  isAnalysing = false;
  runBtn.disabled = false;
  runBtn.textContent = 'Run Analysis';

  let html = `
    <div class="stat-item">
        <div class="stat-label">Player 1 Win Rate</div>
        <div class="stat-value">${stats.p1WinPct.toFixed(1)}%</div>
    </div>
    <div class="stat-item p2-stat">
        <div class="stat-label">Player 2 Win Rate</div>
        <div class="stat-value">${stats.p2WinPct.toFixed(1)}%</div>
    </div>
  `;

  if (stats.botTypeStats) {
    for (const [botType, winPct] of Object.entries(stats.botTypeStats)) {
      const displayName = botType.charAt(0).toUpperCase() + botType.slice(1);
      html += `
        <div class="stat-item">
            <div class="stat-label">${displayName} Win Rate</div>
            <div class="stat-value">${winPct.toFixed(1)}%</div>
        </div>
      `;
    }
  }

  html += `
    <div class="stat-item">
        <div class="stat-label">4-in-a-Row Wins</div>
        <div class="stat-value">${stats.fourInARowPct.toFixed(1)}%</div>
    </div>
    <div class="stat-item">
        <div class="stat-label">Both Koalas Used</div>
        <div class="stat-value">${stats.bothKoalasUsedPct.toFixed(1)}%</div>
    </div>
    <div class="stat-item">
        <div class="stat-label">Average Turns</div>
        <div class="stat-value">${stats.avgTurns.toFixed(1)}</div>
    </div>
    <div class="stat-item">
        <div class="stat-label">Median Turns</div>
        <div class="stat-value">${stats.medianTurns}</div>
    </div>
    <div class="stat-item">
        <div class="stat-label">Fewest Turns</div>
        <div class="stat-value">${stats.minTurns}</div>
    </div>
    <div class="stat-item">
        <div class="stat-label">Most Turns</div>
        <div class="stat-value">${stats.maxTurns}</div>
    </div>
  `;

  statsGrid.innerHTML = html;
  statsGrid.classList.add('visible');
}

const btnRunAnalysis = document.getElementById('btnRunAnalysis');
if (btnRunAnalysis) {
  btnRunAnalysis.addEventListener('click', () => {
    const runBtn = document.getElementById('btnRunAnalysis');

    if (isAnalysing) {
      return;
    }

    // Disable button immediately
    isAnalysing = true;
    runBtn.disabled = true;
    runBtn.textContent = 'Running...';

    const iterations = parseInt(document.getElementById('iterationsInput').value) || 20;
    const bot1 = document.getElementById('bot1Select').value;
    const bot2 = document.getElementById('bot2Select').value;

    document.getElementById('analyseProgress').classList.add('visible');
    document.getElementById('statsGrid').classList.remove('visible');

    // Initialize progress display
    document.getElementById('currentGameStatus').textContent = `Starting Game 1 of ${iterations}...`;
    document.getElementById('progressBarFill').style.width = '0%';

    console.log('[Analysis] Starting with iterations:', iterations, 'bots:', bot1, bot2);
    runAnalysis(iterations, bot1, bot2, updateAnalysisProgress, displayAnalysisResults);
  });
}

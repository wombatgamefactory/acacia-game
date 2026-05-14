// Main UI application - wires game engine to HTML/Canvas

const CELL_SIZE = 90;
const BOARD_SIZE = 6;
const PIECE_RADIUS = 30;

let gameSession = new GameSession();
let currentState = gameSession.state;
let gameRunning = false;
let currentMode = 'watch';
let isAnalysing = false;
let dragState = null;
let imageCache = {};

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('versionNumber').textContent = APP_VERSION;
  preloadImages();
  renderBoard();
  updateSupply();
  updateCurrentPlayer();
});

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

  // Draw legal move highlights (when dragging)
  const legalMovesForState = legalMoves(currentState);
  if (dragState && legalMovesForState.length > 0) {
    ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
    for (const move of legalMovesForState) {
      if (move.pieceType === dragState.pieceType && move.action === dragState.action) {
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

function updateSupply() {
  const container = document.getElementById('supplyPanels');
  const p1Supply = currentState.supply[0];
  const p2Supply = currentState.supply[1];

  let html = `
    <div class="supply-panel">
        <h3 style="color: #4499ff;">Player 1 Supply ${gameSession.humanPlayer === Player.P1 ? '(You)' : ''}</h3>
        <div class="supply-items">
            <div class="supply-item"><span>Regular:</span> <strong>${p1Supply.regular}</strong></div>
            <div class="supply-item"><span>Pusher:</span> <strong>${p1Supply.pusher}</strong></div>
            <div class="supply-item"><span>Koala:</span> <strong>${p1Supply.yellow}</strong></div>
        </div>`;

  // Show draggable pieces only when game is running and it's human player's turn
  if (gameRunning && gameSession.humanPlayer === Player.P1 && currentState.current === Player.P1) {
    const moves = legalMoves(currentState);
    if (moves.length > 0) {
      html += '<div class="draggable-pieces" style="margin-top: 10px;">';
      if (p1Supply.regular > 0 && moves.some(m => m.pieceType === 'regular' && m.action === 'place')) {
        html += '<div class="draggable-piece" data-piece="regular" data-action="place">🦉</div>';
      } else {
        html += '<div class="draggable-piece disabled" data-piece="regular">🦉</div>';
      }
      if (p1Supply.pusher > 0 && moves.some(m => m.pieceType === 'pusher' && m.action === 'eject')) {
        html += '<div class="draggable-piece" data-piece="pusher" data-action="eject">🏠</div>';
      } else {
        html += '<div class="draggable-piece disabled" data-piece="pusher">🏠</div>';
      }
      if (p1Supply.yellow > 0 && moves.some(m => m.pieceType === 'yellow' && m.action === 'eject')) {
        html += '<div class="draggable-piece" data-piece="yellow" data-action="eject">🐨</div>';
      } else {
        html += '<div class="draggable-piece disabled" data-piece="yellow">🐨</div>';
      }
      html += '</div>';
    }
  }

  html += `</div>
    <div class="supply-panel">
        <h3 style="color: #ff6666;">Player 2 Supply ${gameSession.humanPlayer === Player.P2 ? '(You)' : ''}</h3>
        <div class="supply-items">
            <div class="supply-item"><span>Regular:</span> <strong>${p2Supply.regular}</strong></div>
            <div class="supply-item"><span>Pusher:</span> <strong>${p2Supply.pusher}</strong></div>
            <div class="supply-item"><span>Koala:</span> <strong>${p2Supply.yellow}</strong></div>
        </div>`;

  if (gameRunning && gameSession.humanPlayer === Player.P2 && currentState.current === Player.P2) {
    const moves = legalMoves(currentState);
    if (moves.length > 0) {
      html += '<div class="draggable-pieces" style="margin-top: 10px;">';
      if (p2Supply.regular > 0 && moves.some(m => m.pieceType === 'regular' && m.action === 'place')) {
        html += '<div class="draggable-piece" data-piece="regular" data-action="place">🐿️</div>';
      } else {
        html += '<div class="draggable-piece disabled" data-piece="regular">🐿️</div>';
      }
      if (p2Supply.pusher > 0 && moves.some(m => m.pieceType === 'pusher' && m.action === 'eject')) {
        html += '<div class="draggable-piece" data-piece="pusher" data-action="eject">🏠</div>';
      } else {
        html += '<div class="draggable-piece disabled" data-piece="pusher">🏠</div>';
      }
      if (p2Supply.yellow > 0 && moves.some(m => m.pieceType === 'yellow' && m.action === 'eject')) {
        html += '<div class="draggable-piece" data-piece="yellow" data-action="eject">🐨</div>';
      } else {
        html += '<div class="draggable-piece disabled" data-piece="yellow">🐨</div>';
      }
      html += '</div>';
    }
  }

  html += '</div>';
  container.innerHTML = html;

  // Attach drag handlers
  document.querySelectorAll('.draggable-piece:not(.disabled)').forEach(el => {
    el.addEventListener('mousedown', startDrag);
  });
}

function updateCurrentPlayer() {
  const elem = document.getElementById('currentPlayer');
  const playerName = currentState.current === Player.P1 ? 'Player 1' : 'Player 2';
  const className = currentState.current === Player.P1 ? 'p1' : 'p2';
  elem.textContent = `${playerName}'s turn`;
  elem.className = `current-player ${className}`;

  updateControlsVisibility();

  if (isTerminal(currentState)) {
    if (currentState.winner) {
      const winnerName = currentState.winner === Player.P1 ? 'Player 1' : 'Player 2';
      updateGameStatus(`Game Over! ${winnerName} wins!`);
    } else {
      updateGameStatus('Game Over! Stalemate');
    }
    document.getElementById('playAgainBtn').style.display = 'block';
  } else {
    document.getElementById('playAgainBtn').style.display = 'none';
  }
}

function updateControlsVisibility() {
  // Disable game control buttons during human's turn (they can still pause/reset)
  const btnPlay = document.getElementById('btnPlay');
  const btnStep = document.getElementById('btnStep');
  const speedSlider = document.getElementById('speedSlider');

  if (gameSession.waitingForHuman) {
    btnPlay.disabled = true;
    btnStep.disabled = true;
    speedSlider.disabled = true;
  } else {
    btnPlay.disabled = false;
    btnStep.disabled = gameRunning || isTerminal(currentState);
    speedSlider.disabled = false;
  }
}

function updateGameStatus(status) {
  document.getElementById('gameStatus').textContent = status;
}

// ============ Drag and Drop ============

function startDrag(e) {
  if (e.button !== 0) return;
  if (!gameRunning) return;
  const el = e.target;
  dragState = {
    pieceType: el.dataset.piece,
    action: el.dataset.action
  };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragDrop);
  document.getElementById('board').classList.add('dragging');
  renderBoard();
}

function onDragMove(e) {
  if (dragState) {
    renderBoard();
  }
}

function onDragDrop(e) {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragDrop);
  document.getElementById('board').classList.remove('dragging');

  if (!dragState) return;

  const canvas = document.getElementById('board');
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const col = Math.floor(x / CELL_SIZE);
  const row = Math.floor(y / CELL_SIZE);

  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
    dragState = null;
    renderBoard();
    return;
  }

  // Check if move is legal
  const moves = legalMoves(currentState);
  const matchingMove = moves.find(m =>
    m.pieceType === dragState.pieceType &&
    m.action === dragState.action &&
    m.row === row &&
    m.col === col
  );

  if (matchingMove) {
    try {
      gameSession.submitHumanMove(matchingMove);
      updateGameStatus('Move sent. Waiting for opponent...');
    } catch (err) {
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
  renderBoard();
  updateSupply();
  updateCurrentPlayer();
  gameRunning = false;
}

// ============ Button Handlers ============

document.getElementById('btnPlay').addEventListener('click', () => {
  if (!gameRunning && !isTerminal(gameSession.state)) {
    gameRunning = true;
    gameSession.running = true;
    currentState = gameSession.state;
    runGameLoop(gameSession, onStateUpdate, onGameOver);
    updateGameStatus('Playing...');
  }
});

document.getElementById('btnPause').addEventListener('click', () => {
  if (gameRunning) {
    gameRunning = false;
    gameSession.running = false;
    updateGameStatus('Paused');
  }
});

document.getElementById('btnStep').addEventListener('click', () => {
  if (!gameRunning && !isTerminal(gameSession.state)) {
    // Single step: apply one move
    const bot = gameSession.state.current === Player.P1 ? gameSession.botP1 : gameSession.botP2;
    if (bot) {
      const move = bot.chooseMove(gameSession.state);
      gameSession.state = applyMove(gameSession.state, move);
      currentState = gameSession.state;
      onStateUpdate(currentState);
      if (isTerminal(currentState)) {
        onGameOver(currentState);
      }
    }
  }
});

document.getElementById('btnReset').addEventListener('click', () => {
  gameRunning = false;
  gameSession.reset();
  currentState = gameSession.state;
  dragState = null;
  updateGameStatus('Game reset');
  renderBoard();
  updateSupply();
  updateCurrentPlayer();
});

document.getElementById('playAgainBtn').addEventListener('click', () => {
  gameRunning = false;
  gameSession.reset();
  currentState = gameSession.state;
  dragState = null;
  updateGameStatus('Game reset');
  renderBoard();
  updateSupply();
  updateCurrentPlayer();
});

document.getElementById('speedSlider').addEventListener('input', (e) => {
  gameSession.speedMs = parseInt(e.target.value);
});

document.getElementById('bot1Select').addEventListener('change', (e) => {
  const bot1 = e.target.value;
  const bot2 = document.getElementById('bot2Select').value;
  gameSession.setBots(bot1, bot2);
  updatePlayerLabels();
  gameSession.reset();
  currentState = gameSession.state;
  updateGameStatus('Bots changed. Game reset.');
  renderBoard();
  updateSupply();
  updateCurrentPlayer();
});

document.getElementById('bot2Select').addEventListener('change', (e) => {
  const bot2 = e.target.value;
  const bot1 = document.getElementById('bot1Select').value;
  gameSession.setBots(bot1, bot2);
  updatePlayerLabels();
  gameSession.reset();
  currentState = gameSession.state;
  updateGameStatus('Bots changed. Game reset.');
  renderBoard();
  updateSupply();
  updateCurrentPlayer();
});

function updatePlayerLabels() {
  document.getElementById('humanHint').style.display = gameSession.humanPlayer ? 'block' : 'none';
}

document.getElementById('modeSelect').addEventListener('change', (e) => {
  currentMode = e.target.value;
  updateModeUI();
});

function updateModeUI() {
  const boardContainer = document.querySelector('.board-container');
  const supplyPanels = document.getElementById('supplyPanels');
  const analysePanel = document.getElementById('analysePanel');
  const infoPanel = document.querySelector('.info-panel');
  const humanOptions = document.querySelectorAll('option[value="human"]');

  if (currentMode === 'watch') {
    boardContainer.style.display = 'flex';
    supplyPanels.style.display = 'flex';
    analysePanel.classList.remove('visible');
    infoPanel.style.display = 'block';
    humanOptions.forEach(opt => opt.disabled = false);
  } else {
    boardContainer.style.display = 'none';
    supplyPanels.style.display = 'none';
    analysePanel.classList.add('visible');
    infoPanel.style.display = 'none';
    humanOptions.forEach(opt => opt.disabled = true);
  }
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

document.getElementById('btnRunAnalysis').addEventListener('click', () => {
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

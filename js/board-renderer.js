/* ==========================================================================
   Acacia board renderer
   --------------------------------------------------------------------------
   Draws the 6x6 board to a canvas at true device resolution (the old renderer
   drew at a fixed 540px and let the browser stretch it, which is why it looked
   soft). Static art is baked into offscreen layers and re-baked only when the
   board is resized, so each animation frame is a handful of drawImage calls.
   ========================================================================== */

const BOARD_N = 6;
const COL_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

const PIECE_ART = {
  p1_regular: 'images/pieces/owl.png',
  p2_regular: 'images/pieces/squirrel.png',
  // Pushing pieces are round doors in the player's colour — they fill the
  // circular token and read instantly at any size.
  p1_pusher:  'images/pieces/door_blue.png',
  p2_pusher:  'images/pieces/door_red.png',
  koala:      'images/pieces/koala.png'
};

// `light`/`ring`/`dark` shade the rim band, which is the piece's main colour
// signal; `rim` is the thin bevel highlight that sits on top of it.
const PLAYER_SKIN = {
  1: { light: '#8fc2ee', ring: '#4a86c8', dark: '#173556', rim: '#c9e3fb',
       face0: 'rgba(243, 249, 255, 0.97)', face1: 'rgba(206, 228, 248, 0.95)' },
  2: { light: '#f9a473', ring: '#cf5a2c', dark: '#5f240c', rim: '#ffd8ba',
       face0: 'rgba(255, 247, 240, 0.97)', face1: 'rgba(250, 219, 199, 0.95)' }
};

const KOALA_SKIN = {
  light: '#efdcb4', ring: '#c2a271', dark: '#4e3d25', rim: '#f6ead0',
  face0: 'rgba(255, 251, 242, 0.97)', face1: 'rgba(233, 223, 203, 0.95)'
};

const FACE_R = 0.78;   // artwork disc, as a fraction of the token radius

/** Path helper — rounded rectangle (Safari/older browsers lack roundRect). */
function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

const easeOutBack = t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;

/** Returns the four cells of a winning line for `player`, or null. */
function findWinningLine(board, player) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    for (let r = 0; r < BOARD_N; r++) {
      for (let c = 0; c < BOARD_N; c++) {
        const er = r + 3 * dr, ec = c + 3 * dc;
        if (er < 0 || er >= BOARD_N || ec < 0 || ec >= BOARD_N) continue;
        const cells = [];
        let ok = true;
        for (let i = 0; i < 4; i++) {
          const rr = r + i * dr, cc = c + i * dc;
          const cell = board[rr * BOARD_N + cc];
          if (!cell || cell.player !== player || cell.pieceType === PieceType.YELLOW) { ok = false; break; }
          cells.push([rr, cc]);
        }
        if (ok) return cells;
      }
    }
  }
  return null;
}

class BoardRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 0;
    this.dpr = 1;

    this.state = null;
    this.prevBoard = null;

    this.hints = [];            // [{row, col, kind: 'place'|'eject'}]
    this.hoverCell = null;      // {row, col}
    this.cursorCell = null;     // keyboard cursor
    this.lastMove = null;       // {row, col}
    this.lastMoveAt = 0;
    this.winLine = null;        // [[r,c] x4]
    this.winStart = 0;

    this.anims = [];            // transient piece animations
    this.introStart = 0;

    this.boardLayer = null;
    this.tokenCache = new Map();
    this.images = {};
    this.noisePattern = null;

    this._frame = this._frame.bind(this);
    this._running = false;

    this._loadArt();

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
    }
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.start();
  }

  // ---- assets ------------------------------------------------------------

  _loadArt() {
    for (const [key, src] of Object.entries(PIECE_ART)) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { this.images[key] = img; this.tokenCache.clear(); };
      img.src = src;
    }
  }

  artFor(piece) {
    if (!piece) return null;
    if (piece.pieceType === PieceType.YELLOW) return this.images.koala;
    const p = piece.player === Player.P1 ? 'p1' : 'p2';
    const t = piece.pieceType === PieceType.PUSHER ? 'pusher' : 'regular';
    return this.images[`${p}_${t}`];
  }

  // ---- geometry ----------------------------------------------------------

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const css = Math.max(1, Math.min(rect.width, rect.height) || rect.width);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (Math.abs(css - this.size) < 0.5 && dpr === this.dpr) return;

    this.size = css;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(css * dpr));
    this.canvas.height = Math.max(1, Math.round(css * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.pad = css * 0.055;
    this.cell = (css - this.pad * 2) / BOARD_N;
    this.gap = this.cell * 0.06;
    this.tokenR = this.cell * 0.395;

    this.boardLayer = null;
    this.tokenCache.clear();
    this.noisePattern = null;
  }

  cellCenter(row, col) {
    return {
      x: this.pad + (col + 0.5) * this.cell,
      y: this.pad + (row + 0.5) * this.cell
    };
  }

  cellRect(row, col) {
    const g = this.gap;
    return {
      x: this.pad + col * this.cell + g / 2,
      y: this.pad + row * this.cell + g / 2,
      w: this.cell - g,
      h: this.cell - g
    };
  }

  /** Maps a client point to a board cell, or null when outside the grid. */
  cellFromPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const scale = this.size / rect.width;
    const x = (clientX - rect.left) * scale;
    const y = (clientY - rect.top) * scale;
    const col = Math.floor((x - this.pad) / this.cell);
    const row = Math.floor((y - this.pad) / this.cell);
    if (row < 0 || row >= BOARD_N || col < 0 || col >= BOARD_N) return null;
    return { row, col };
  }

  // ---- state -------------------------------------------------------------

  setState(state, { animate = true } = {}) {
    const prev = this.state;
    this.state = state;

    if (animate && prev && prev.board !== state.board) {
      const now = performance.now();
      for (let i = 0; i < state.board.length; i++) {
        const before = prev.board[i];
        const after = state.board[i];
        if (before === after) continue;
        const row = Math.floor(i / BOARD_N), col = i % BOARD_N;
        if (before && (!after || before.player !== after.player || before.pieceType !== after.pieceType)) {
          this.anims.push({ kind: 'eject', row, col, piece: before, t0: now, dur: 260 });
        }
        if (after) {
          this.anims.push({ kind: 'place', row, col, piece: after, t0: now + (before ? 110 : 0), dur: 330 });
          this.lastMove = { row, col };
          this.lastMoveAt = now;
        }
      }
    }

    this.winLine = state.winner ? findWinningLine(state.board, state.winner) : null;
    if (this.winLine && !this.winStart) this.winStart = performance.now() + 220;
    if (!this.winLine) this.winStart = 0;

    this.start();
  }

  reset(state) {
    this.state = state;
    this.anims.length = 0;
    this.lastMove = null;
    this.lastMoveAt = 0;
    this.winLine = null;
    this.winStart = 0;
    this.hints = [];
    this.hoverCell = null;
    this.introStart = performance.now();
    this.start();
  }

  setHints(hints) { this.hints = hints || []; this.start(); }
  setHover(cell) {
    const same = (!cell && !this.hoverCell) ||
      (cell && this.hoverCell && cell.row === this.hoverCell.row && cell.col === this.hoverCell.col);
    if (!same) { this.hoverCell = cell; this.start(); }
  }
  setCursor(cell) { this.cursorCell = cell; this.start(); }

  hintAt(row, col) {
    for (const h of this.hints) if (h.row === row && h.col === col) return h;
    return null;
  }

  // ---- baked layers ------------------------------------------------------

  _offscreen() {
    const c = document.createElement('canvas');
    c.width = Math.round(this.size * this.dpr);
    c.height = Math.round(this.size * this.dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return { canvas: c, ctx };
  }

  _getNoise() {
    if (this.noisePattern) return this.noisePattern;
    const tile = document.createElement('canvas');
    tile.width = tile.height = 128;
    const tctx = tile.getContext('2d');
    const data = tctx.createImageData(128, 128);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 90;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
      data.data[i + 3] = 26;
    }
    tctx.putImageData(data, 0, 0);
    this.noisePattern = this.ctx.createPattern(tile, 'repeat');
    return this.noisePattern;
  }

  _bakeBoard() {
    const { canvas, ctx } = this._offscreen();
    const S = this.size;

    // --- outer frame (bark) ---
    const frame = ctx.createLinearGradient(0, 0, S, S);
    frame.addColorStop(0, '#4a3524');
    frame.addColorStop(0.5, '#38271a');
    frame.addColorStop(1, '#241a11');
    roundRectPath(ctx, 0, 0, S, S, S * 0.045);
    ctx.fillStyle = frame;
    ctx.fill();

    // grain
    ctx.save();
    roundRectPath(ctx, 0, 0, S, S, S * 0.045);
    ctx.clip();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = this._getNoise();
    ctx.fillRect(0, 0, S, S);
    ctx.globalAlpha = 1;
    ctx.restore();

    // frame bevel
    roundRectPath(ctx, 0.75, 0.75, S - 1.5, S - 1.5, S * 0.045);
    ctx.strokeStyle = 'rgba(255, 226, 179, 0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // --- recessed playing area ---
    const innerX = this.pad - this.gap * 0.5;
    const innerW = S - innerX * 2;
    roundRectPath(ctx, innerX, innerX, innerW, innerW, S * 0.028);
    ctx.fillStyle = 'rgba(20, 13, 8, 0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // --- cells ---
    for (let r = 0; r < BOARD_N; r++) {
      for (let c = 0; c < BOARD_N; c++) {
        const rect = this.cellRect(r, c);
        const radius = rect.w * 0.16;
        const warm = (r + c) % 2 === 0;

        const g = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
        if (warm) { g.addColorStop(0, '#e4cfa6'); g.addColorStop(1, '#c9ae80'); }
        else      { g.addColorStop(0, '#dcc69c'); g.addColorStop(1, '#c0a476'); }

        roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
        ctx.fillStyle = g;
        ctx.fill();

        // paper grain inside the cell
        ctx.save();
        roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
        ctx.clip();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = this._getNoise();
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.restore();

        // top highlight + bottom shade so the square reads as a physical tile
        ctx.save();
        roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
        ctx.clip();
        const hi = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h * 0.4);
        hi.addColorStop(0, 'rgba(255,255,255,0.5)');
        hi.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hi;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h * 0.4);
        const lo = ctx.createLinearGradient(rect.x, rect.y + rect.h * 0.6, rect.x, rect.y + rect.h);
        lo.addColorStop(0, 'rgba(90,60,30,0)');
        lo.addColorStop(1, 'rgba(90,60,30,0.22)');
        ctx.fillStyle = lo;
        ctx.fillRect(rect.x, rect.y + rect.h * 0.6, rect.w, rect.h * 0.4);
        ctx.restore();

        roundRectPath(ctx, rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, radius);
        ctx.strokeStyle = 'rgba(90, 62, 34, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // --- coordinates ---
    ctx.fillStyle = 'rgba(246, 236, 216, 0.42)';
    ctx.font = `500 ${Math.max(8, S * 0.021)}px 'Oswald', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let c = 0; c < BOARD_N; c++) {
      const { x } = this.cellCenter(0, c);
      ctx.fillText(COL_LABELS[c], x, this.pad * 0.5);
      ctx.fillText(COL_LABELS[c], x, S - this.pad * 0.5);
    }
    for (let r = 0; r < BOARD_N; r++) {
      const { y } = this.cellCenter(r, 0);
      ctx.fillText(String(r + 1), this.pad * 0.5, y);
      ctx.fillText(String(r + 1), S - this.pad * 0.5, y);
    }

    this.boardLayer = canvas;
  }

  /** Bakes one token (disc + rim + artwork) at device resolution. */
  _tokenSprite(piece) {
    const key = `${piece.player}|${piece.pieceType}`;
    const cached = this.tokenCache.get(key);
    if (cached) return cached;

    const r = this.tokenR;
    const px = Math.max(8, Math.ceil(r * 2.3 * this.dpr));
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const ctx = c.getContext('2d');
    const scale = px / (r * 2.3);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const cx = r * 1.15, cy = r * 1.15;
    const isKoala = piece.pieceType === PieceType.YELLOW;
    const skin = isKoala ? KOALA_SKIN : PLAYER_SKIN[piece.player];

    // disc
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.42, r * 0.12, cx, cy, r);
    g.addColorStop(0, skin.light);
    g.addColorStop(0.55, skin.ring);
    g.addColorStop(1, skin.dark);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // inner face so artwork sits on a lighter, faintly player-tinted ground
    const face = ctx.createRadialGradient(cx, cy - r * 0.2, r * 0.1, cx, cy, r * 0.86);
    face.addColorStop(0, skin.face0);
    face.addColorStop(1, skin.face1);
    ctx.beginPath();
    ctx.arc(cx, cy, r * FACE_R, 0, Math.PI * 2);
    ctx.fillStyle = face;
    ctx.fill();

    // artwork — the round door fills the face, characters sit on it
    const art = this.artFor(piece);
    if (art && art.complete && art.naturalWidth) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r * FACE_R, 0, Math.PI * 2);
      ctx.clip();
      const isDoor = piece.pieceType === PieceType.PUSHER;
      const box = isDoor ? r * FACE_R * 2 : r * 1.56;
      ctx.drawImage(art, cx - box / 2, cy - box / 2 - (isDoor ? 0 : r * 0.02), box, box);
      ctx.restore();
    }

    // The rim is a wide bevelled band in the owner's colour — it is what tells
    // you whose piece this is from across the board.
    const band = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    band.addColorStop(0, skin.light);
    band.addColorStop(0.5, skin.ring);
    band.addColorStop(1, skin.dark);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.885, 0, Math.PI * 2);
    ctx.strokeStyle = band;
    ctx.lineWidth = r * 0.215;
    ctx.stroke();

    ctx.beginPath();                     // bevel highlight along the band
    ctx.arc(cx, cy, r * 0.935, 0, Math.PI * 2);
    ctx.strokeStyle = skin.rim;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = r * 0.05;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.beginPath();                     // dark edge where band meets artwork
    ctx.arc(cx, cy, r * 0.782, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(34, 20, 9, 0.4)';
    ctx.lineWidth = r * 0.05;
    ctx.stroke();

    ctx.beginPath();                     // dark outer edge
    ctx.arc(cx, cy, r * 0.978, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(28, 18, 10, 0.6)';
    ctx.lineWidth = r * 0.055;
    ctx.stroke();

    // the koala belongs to a player but scores for nobody, so it keeps a
    // small owner pip while staying visually neutral
    if (isKoala) {
      const owner = PLAYER_SKIN[piece.player];
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.885, r * 0.155, 0, Math.PI * 2);
      ctx.fillStyle = owner.ring;
      ctx.fill();
      ctx.strokeStyle = 'rgba(28, 18, 10, 0.55)';
      ctx.lineWidth = r * 0.05;
      ctx.stroke();
    }

    const sprite = { canvas: c, half: r * 1.15 };
    this.tokenCache.set(key, sprite);
    return sprite;
  }

  drawToken(ctx, piece, x, y, scale = 1, alpha = 1) {
    const sprite = this._tokenSprite(piece);
    const half = sprite.half * scale;
    ctx.save();
    ctx.globalAlpha = alpha;

    // contact shadow
    ctx.save();
    ctx.translate(x, y + this.tokenR * 0.42);
    ctx.scale(1, 0.36);
    ctx.beginPath();
    ctx.arc(0, 0, this.tokenR * 0.95 * scale, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(38, 22, 10, ${0.36 * alpha})`;
    ctx.filter = 'none';
    ctx.fill();
    ctx.restore();

    ctx.drawImage(sprite.canvas, x - half, y - half, half * 2, half * 2);
    ctx.restore();
  }

  // ---- frame loop --------------------------------------------------------

  start() {
    if (this._running) return;
    this._running = true;
    requestAnimationFrame(this._frame);
  }

  _needsFrame() {
    const now = performance.now();
    if (this.anims.length) return true;
    if (this.winLine) return true;
    if (this.hints.length) return true;
    // The "last move" ring only pulses for a few seconds, so the loop can idle.
    if (this.lastMoveAt && now - this.lastMoveAt < 3200) return true;
    if (this.introStart && now - this.introStart < 900) return true;
    return false;
  }

  _frame(now) {
    this.draw(now);
    if (this._needsFrame() && !document.hidden) {
      requestAnimationFrame(this._frame);
    } else {
      this._running = false;
    }
  }

  draw(now = performance.now()) {
    if (!this.size || !this.state) return;
    const ctx = this.ctx;
    const S = this.size;
    if (!this.boardLayer) this._bakeBoard();

    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.boardLayer, 0, 0, S, S);

    const intro = this.introStart ? clamp01((now - this.introStart) / 700) : 1;

    // --- highlights under the pieces ---
    for (const hint of this.hints) {
      const rect = this.cellRect(hint.row, hint.col);
      const hovered = this.hoverCell && this.hoverCell.row === hint.row && this.hoverCell.col === hint.col;
      const pulse = 0.5 + 0.5 * Math.sin(now / 460 + (hint.row + hint.col) * 0.5);
      const radius = rect.w * 0.16;

      ctx.save();
      roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
      ctx.clip();
      const glow = ctx.createRadialGradient(
        rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w * 0.1,
        rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w * 0.75);
      const strength = (hovered ? 0.55 : 0.3) + pulse * 0.12;
      glow.addColorStop(0, `rgba(255, 205, 110, ${strength})`);
      glow.addColorStop(1, 'rgba(255, 175, 60, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();

      roundRectPath(ctx, rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, radius);
      ctx.strokeStyle = hovered ? 'rgba(255, 226, 160, 0.95)' : `rgba(240, 180, 80, ${0.5 + pulse * 0.3})`;
      ctx.lineWidth = hovered ? 3 : 2;
      ctx.stroke();

      if (hint.kind === 'place') {
        const { x, y } = this.cellCenter(hint.row, hint.col);
        ctx.beginPath();
        ctx.arc(x, y, this.tokenR * (hovered ? 0.34 : 0.2 + pulse * 0.04), 0, Math.PI * 2);
        ctx.fillStyle = hovered ? 'rgba(255, 226, 160, 0.85)' : 'rgba(255, 205, 110, 0.55)';
        ctx.fill();
      }
    }

    // --- winning line glow (under the tokens) ---
    if (this.winLine && this.winStart && now > this.winStart) {
      const t = easeOutCubic(clamp01((now - this.winStart) / 520));
      const a = this.cellCenter(this.winLine[0][0], this.winLine[0][1]);
      const d = this.cellCenter(this.winLine[3][0], this.winLine[3][1]);
      const ex = a.x + (d.x - a.x) * t;
      const ey = a.y + (d.y - a.y) * t;
      const pulse = 0.65 + 0.35 * Math.sin(now / 320);

      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(255, 200, 90, ${0.28 * pulse})`;
      ctx.lineWidth = this.tokenR * 2.05;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 233, 170, ${0.85 * pulse})`;
      ctx.lineWidth = this.tokenR * 0.2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.restore();
    }

    // --- eject targets get a rotating marker ring ---
    for (const hint of this.hints) {
      if (hint.kind !== 'eject') continue;
      const { x, y } = this.cellCenter(hint.row, hint.col);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((now / 2600) % (Math.PI * 2));
      ctx.beginPath();
      ctx.setLineDash([this.tokenR * 0.32, this.tokenR * 0.26]);
      ctx.arc(0, 0, this.tokenR * 1.16, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 214, 130, 0.95)';
      ctx.lineWidth = this.tokenR * 0.11;
      ctx.stroke();
      ctx.restore();
    }

    // --- pieces ---
    const animByCell = new Map();
    this.anims = this.anims.filter(anim => now < anim.t0 + anim.dur);
    for (const anim of this.anims) {
      const list = animByCell.get(anim.row * BOARD_N + anim.col) || [];
      list.push(anim);
      animByCell.set(anim.row * BOARD_N + anim.col, list);
    }

    for (let i = 0; i < this.state.board.length; i++) {
      const piece = this.state.board[i];
      const row = Math.floor(i / BOARD_N), col = i % BOARD_N;
      const { x, y } = this.cellCenter(row, col);
      const anims = animByCell.get(i) || [];
      const placing = anims.find(a => a.kind === 'place');
      const ejecting = anims.find(a => a.kind === 'eject');

      if (ejecting) {
        const t = clamp01((now - ejecting.t0) / ejecting.dur);
        const e = easeOutCubic(t);
        ctx.save();
        ctx.translate(x, y - e * this.cell * 0.35);
        ctx.rotate(e * 0.5);
        this.drawToken(ctx, ejecting.piece, 0, 0, 1 - e * 0.55, 1 - e);
        ctx.restore();
      }

      if (!piece) continue;

      if (placing) {
        const t = (now - placing.t0) / placing.dur;
        if (t < 0) continue;                    // still waiting on the eject beat
        const e = clamp01(t);
        const scale = 0.55 + easeOutBack(e) * 0.45;
        this.drawToken(ctx, piece, x, y - (1 - easeOutCubic(e)) * this.cell * 0.28, scale, Math.min(1, e * 2.2));
      } else {
        const introScale = intro < 1
          ? clamp01((intro - (row + col) / 22) * 3.2)
          : 1;
        if (introScale <= 0) continue;
        this.drawToken(ctx, piece, x, y, easeOutBack(introScale) * 0.999 + 0.001, introScale);
      }
    }

    // --- winning tokens get a halo ---
    if (this.winLine && this.winStart && now > this.winStart) {
      const pulse = 0.6 + 0.4 * Math.sin(now / 320);
      for (const [r, c] of this.winLine) {
        const { x, y } = this.cellCenter(r, c);
        ctx.beginPath();
        ctx.arc(x, y, this.tokenR * 1.12, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 226, 150, ${0.9 * pulse})`;
        ctx.lineWidth = this.tokenR * 0.14;
        ctx.stroke();
      }
    }

    // --- last move marker ---
    if (this.lastMove && !this.winLine) {
      const { x, y } = this.cellCenter(this.lastMove.row, this.lastMove.col);
      const age = this.lastMoveAt ? now - this.lastMoveAt : 0;
      const pulse = (age < 3200 ? 0.45 + 0.25 * Math.sin(now / 620) : 0.4);
      ctx.beginPath();
      ctx.arc(x, y, this.tokenR * 1.12, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 226, 160, ${pulse})`;
      ctx.lineWidth = Math.max(1.5, this.tokenR * 0.08);
      ctx.stroke();
    }

    // --- keyboard cursor ---
    if (this.cursorCell) {
      const rect = this.cellRect(this.cursorCell.row, this.cursorCell.col);
      roundRectPath(ctx, rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4, rect.w * 0.2);
      ctx.strokeStyle = 'rgba(246, 236, 216, 0.95)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.introStart && now - this.introStart > 900) this.introStart = 0;
  }
}

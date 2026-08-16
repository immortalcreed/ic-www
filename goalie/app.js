// ================================================================
//  CONFIGURATION — edit these to set up your reveal
// ================================================================

// Path to the image shown UNDERNEATH (the goal / revealed state)
const BASE_IMAGE = 'base.jpg';

// Path to the image that gets TORN AWAY as calls come in
const OVERLAY_IMAGE = 'overlay.jpg';

// Grid dimensions — total sections = COLS × ROWS
const COLS = 20;
const ROWS = 12;

// Milliseconds between each tile rip during a cascade (lower = faster)
const TILE_DELAY = 110;

// Duration of a single rip animation in ms (keep in sync with CSS @keyframes rip)
const RIP_DURATION = 650;

// ================================================================

const TOTAL = COLS * ROWS;

const state = {
    target:   0,
    current:  0,
    revealed: 0,
    order:    [],   // shuffled removal order (tile indices)
    tiles:    [],   // tile DOM elements, indexed row-major (row 0 L→R, then row 1…)
    busy:     false,
};

// ----------------------------------------------------------------
//  Bootstrap
// ----------------------------------------------------------------

function init() {
    const base = document.getElementById('base-layer');
    base.style.backgroundImage    = `url('${BASE_IMAGE}')`;
    base.style.backgroundSize     = 'cover';
    base.style.backgroundPosition = 'center';
    base.style.backgroundRepeat   = 'no-repeat';

    buildTiles();
    updateHUD();
}

// ----------------------------------------------------------------
//  Tile grid
// ----------------------------------------------------------------

function buildTiles() {
    const layer = document.getElementById('overlay-layer');
    layer.innerHTML = '';
    state.tiles = [];

    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const tile = document.createElement('div');
            tile.className = 'tile';

            // Position and size within the overlay layer
            tile.style.left   = `${(col / COLS) * 100}%`;
            tile.style.top    = `${(row / ROWS) * 100}%`;
            tile.style.width  = `${100 / COLS}%`;
            tile.style.height = `${100 / ROWS}%`;

            // Background-size renders the full overlay image across all tiles;
            // background-position shifts it so each tile shows its own slice.
            const bgPosX = COLS > 1 ? (col / (COLS - 1)) * 100 : 50;
            const bgPosY = ROWS > 1 ? (row / (ROWS - 1)) * 100 : 50;

            tile.style.backgroundImage    = `url('${OVERLAY_IMAGE}')`;
            tile.style.backgroundSize     = `${COLS * 100}% ${ROWS * 100}%`;
            tile.style.backgroundPosition = `${bgPosX}% ${bgPosY}%`;

            layer.appendChild(tile);
            state.tiles.push(tile);
        }
    }
}

// ----------------------------------------------------------------
//  Event handlers (called from inline onclick)
// ----------------------------------------------------------------

function handleSetTarget() {
    // const targetVal = parseInt(document.getElementById('in-target').value);
    const targetVal = 8000;

    if (!targetVal || targetVal < 1) {
        document.getElementById('in-target').focus();
        return;
    }

    // Reset everything
    state.target   = targetVal;
    state.current  = 0;
    state.revealed = 0;
    state.order    = shuffle(Array.from({ length: TOTAL }, (_, i) => i));
    state.busy     = false;

    document.getElementById('in-current').value = '';
    document.getElementById('in-current').placeholder = '0';
    document.getElementById('btn-reveal').disabled = false;
    document.getElementById('complete-banner').classList.remove('show');
    document.getElementById('hud-current').classList.remove('complete');

    buildTiles();
    updateHUD();
}

function handleReveal() {
    if (state.busy || state.target === 0) return;

    const currentEl = document.getElementById('in-current');
    const newVal    = parseInt(currentEl.value);

    if (isNaN(newVal) || newVal < 0) {
        currentEl.focus();
        return;
    }

    // Must be greater than what we already logged
    if (newVal <= state.current && state.current > 0) {
        currentEl.value = '';
        currentEl.placeholder = `> ${state.current}`;
        currentEl.focus();
        return;
    }

    const prev       = state.current;
    state.current    = Math.min(newVal, state.target);
    currentEl.value  = '';
    currentEl.placeholder = state.current.toLocaleString();

    updateHUD();

    const targetRevealed = Math.round((state.current / state.target) * TOTAL);
    const toReveal       = Math.max(0, targetRevealed - state.revealed);

    if (toReveal > 0) {
        cascade(toReveal);
    }
}

// ----------------------------------------------------------------
//  Cascade: rip `count` tiles one by one
// ----------------------------------------------------------------

function cascade(count) {
    state.busy = true;
    document.getElementById('btn-reveal').disabled = true;

    let done = 0;

    function next() {
        if (done >= count || state.revealed >= TOTAL) {
            state.busy = false;
            document.getElementById('btn-reveal').disabled = false;
            if (state.revealed >= TOTAL) showComplete();
            return;
        }

        const tileIdx = state.order[state.revealed];
        ripTile(state.tiles[tileIdx]);
        state.revealed++;
        done++;

        setTimeout(next, TILE_DELAY);
    }

    next();
}

// ----------------------------------------------------------------
//  Single tile rip
// ----------------------------------------------------------------

function ripTile(tile) {
    // Random direction, angle, and flight distance
    const angleDeg = (Math.random() - 0.5) * 60;           // –30 … +30°
    const radDir   = Math.random() * 2 * Math.PI;
    const dist     = 300 + Math.random() * 280;
    const tx       = Math.cos(radDir) * dist;
    const ty       = Math.sin(radDir) * dist;

    tile.style.setProperty('--rip-r',   `${angleDeg}deg`);
    tile.style.setProperty('--rip-x',   `${tx}px`);
    tile.style.setProperty('--rip-y',   `${ty}px`);
    tile.style.setProperty('--rip-dur', `${RIP_DURATION}ms`);

    // Apply torn polygon clip-path right before animating
    tile.style.clipPath = tornEdge();

    tile.classList.add('ripping');

    tile.addEventListener('animationend', () => {
        tile.style.visibility = 'hidden';
        tile.classList.remove('ripping');
    }, { once: true });
}

// Generates a polygon that mimics a torn paper edge.
// Each edge has points that vary slightly inward (0–8%) for a ragged look.
function tornEdge() {
    const pts = [];
    const n   = 12;                        // points per edge
    const v   = () => Math.random() * 8;   // 0–8% inward jitter per point

    // Top edge — left to right, y hovers near 0%
    for (let i = 0; i <= n; i++) pts.push(`${(i / n) * 100}% ${v()}%`);
    // Right edge — top to bottom, x hovers near 100%
    for (let i = 1; i <= n; i++) pts.push(`${100 - v()}% ${(i / n) * 100}%`);
    // Bottom edge — right to left, y hovers near 100%
    for (let i = 1; i <= n; i++) pts.push(`${100 - (i / n) * 100}% ${100 - v()}%`);
    // Left edge — bottom to top, x hovers near 0%
    for (let i = 1; i <  n; i++) pts.push(`${v()}% ${100 - (i / n) * 100}%`);

    return `polygon(${pts.join(', ')})`;
}

// ----------------------------------------------------------------
//  HUD
// ----------------------------------------------------------------

function updateHUD() {
    const pct = state.target > 0
        ? Math.round((state.current / state.target) * 100)
        : 0;

    document.getElementById('hud-current').textContent =
        state.current.toLocaleString();
    document.getElementById('hud-target').textContent =
        state.target > 0 ? state.target.toLocaleString() : '—';
    document.getElementById('hud-fill').style.width =
        `${Math.min(100, pct)}%`;
    document.getElementById('hud-pct').textContent =
        state.target > 0 ? `${pct}% of goal` : 'Set a target below';
}

// ----------------------------------------------------------------
//  Completion
// ----------------------------------------------------------------

function showComplete() {
    document.getElementById('hud-current').classList.add('complete');
    const banner = document.getElementById('complete-banner');
    // Force a reflow so the transition fires reliably
    banner.offsetWidth;
    banner.classList.add('show');
}

// ----------------------------------------------------------------
//  UI helpers
// ----------------------------------------------------------------

function togglePanel() {
    document.getElementById('panel').classList.toggle('hidden');
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ----------------------------------------------------------------
//  Start
// ----------------------------------------------------------------

init();

handleSetTarget();
// ================================================================
//  CONFIGURATION — edit these to set up your reveal
// ================================================================

// Path to the image shown UNDERNEATH (the goal / revealed state)
const BASE_IMAGE = 'base.jpg';

// Path to the image that gets TORN AWAY as calls come in
const OVERLAY_IMAGE = 'overlay.jpg';

// Grid dimensions — total sections = COLS × ROWS
const COLS = 32;
const ROWS = 16;

// Milliseconds between each tile rip during a cascade (lower = faster)
const TILE_DELAY = 100;

// Duration of a single rip animation in ms (keep in sync with CSS @keyframes rip)
const RIP_DURATION = 500;

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

    initFireworks();
    buildTiles();
    updateHUD();
}

// ----------------------------------------------------------------
//  Tile grid
// ----------------------------------------------------------------

function buildTiles() {
    const layer = document.getElementById('overlay-layer');
    layer.innerHTML = '';
    layer.style.display              = 'grid';
    layer.style.gridTemplateColumns  = `repeat(${COLS}, 1fr)`;
    layer.style.gridTemplateRows     = `repeat(${ROWS}, 1fr)`;
    state.tiles = [];

    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const tile = document.createElement('div');
            tile.className = 'tile';

            // Grid handles size/position; vw/vh background avoids subpixel rounding.
            tile.style.backgroundImage    = `url('${OVERLAY_IMAGE}')`;
            tile.style.backgroundSize     = '100vw 100vh';
            tile.style.backgroundRepeat   = 'no-repeat';
            tile.style.backgroundPosition =
                `-${col * 100 / COLS}vw -${row * 100 / ROWS}vh`;

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

    closePanel();

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
    banner.offsetWidth; // force reflow
    banner.classList.add('show');
    banner.addEventListener('animationend', () => {
        banner.classList.add('pulsing');
    }, { once: true });
    startFireworks();
}

// ----------------------------------------------------------------
//  UI helpers
// ----------------------------------------------------------------

function openPanel() {
    document.getElementById('panel').removeAttribute('hidden');
    document.getElementById('toggle-btn').classList.add('hidden');
    document.getElementById('in-current').focus();
}

function closePanel() {
    document.getElementById('panel').setAttribute('hidden', '');
    document.getElementById('toggle-btn').classList.remove('hidden');
}

function togglePanel() {
    document.getElementById('panel').hasAttribute('hidden') ? openPanel() : closePanel();
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
//  Fireworks
// ----------------------------------------------------------------

const FW = {
    canvas: null,
    ctx: null,
    active: false,
    rockets: [],
    particles: [],
    animId: null,
};

function initFireworks() {
    FW.canvas = document.getElementById('fireworks-canvas');
    if (!FW.canvas) {
        FW.canvas = document.createElement('canvas');
        FW.canvas.id = 'fireworks-canvas';
        document.body.appendChild(FW.canvas);
    }
    FW.ctx = FW.canvas.getContext('2d');
    const resize = () => {
        FW.canvas.width  = window.innerWidth;
        FW.canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
}

function startFireworks() {
    FW.active    = true;
    FW.rockets   = [];
    FW.particles = [];
    FW.canvas.style.display = 'block';

    function schedule() {
        if (!FW.active) return;
        launchRocket();
        if (Math.random() < 0.6) setTimeout(launchRocket, 180);
        if (Math.random() < 0.3) setTimeout(launchRocket, 360);
        setTimeout(schedule, 350 + Math.random() * 450);
    }

    schedule();
    setTimeout(launchRocket, 80);
    setTimeout(launchRocket, 200);

    if (!FW.animId) FW.animId = requestAnimationFrame(fireworksLoop);

    // runs indefinitely
}

function launchRocket() {
    const w = FW.canvas.width;
    const h = FW.canvas.height;
    FW.rockets.push({
        x:       w * 0.08 + Math.random() * w * 0.84,
        y:       h,
        targetY: h * 0.08 + Math.random() * h * 0.48,
        vx:      (Math.random() - 0.5) * 2.5,
        speed:   10 + Math.random() * 10,
        hue:     Math.random() * 360,
        trail:   [],
    });
}

function explode(x, y, hue) {
    const count = 80 + Math.floor(Math.random() * 60);
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
        const speed = 1.5 + Math.random() * 7;
        FW.particles.push({
            x, y,
            vx:      Math.cos(angle) * speed,
            vy:      Math.sin(angle) * speed - 1.2,
            alpha:   1,
            hue:     hue + (Math.random() - 0.5) * 55,
            size:    2 + Math.random() * 2.5,
            decay:   0.009 + Math.random() * 0.013,
            gravity: 0.055 + Math.random() * 0.04,
            drag:    0.965 + Math.random() * 0.02,
        });
    }
}

function fireworksLoop() {
    const { ctx, canvas, rockets, particles } = FW;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Rockets
    for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        const dy = r.targetY - r.y;
        r.vy = -Math.min(r.speed, Math.abs(dy));
        r.x += r.vx;
        r.y += r.vy;

        r.trail.unshift({ x: r.x, y: r.y });
        if (r.trail.length > 12) r.trail.pop();

        r.trail.forEach((pt, idx) => {
            const a = (1 - idx / r.trail.length) * 0.75;
            const sz = 3 * (1 - idx / r.trail.length);
            ctx.globalAlpha = a;
            ctx.fillStyle   = `hsl(${r.hue}, 100%, 75%)`;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, sz, 0, Math.PI * 2);
            ctx.fill();
        });

        if (r.y <= r.targetY) {
            explode(r.x, r.y, r.hue);
            rockets.splice(i, 1);
        }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vx  *= p.drag;
        p.vy   = p.vy * p.drag + p.gravity;
        p.x   += p.vx;
        p.y   += p.vy;
        p.alpha -= p.decay;

        if (p.alpha <= 0) { particles.splice(i, 1); continue; }

        ctx.globalAlpha = p.alpha;
        ctx.fillStyle   = `hsl(${p.hue}, 100%, 65%)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * Math.min(p.alpha * 1.5, 1), 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.globalAlpha = 1;

    FW.animId = requestAnimationFrame(fireworksLoop);
}

// ----------------------------------------------------------------
//  Start
// ----------------------------------------------------------------

init();

handleSetTarget();
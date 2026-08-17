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

// Milliseconds between each tile rip — starts here, accelerates to MIN by end of cascade
const TILE_DELAY     = 70;
const TILE_DELAY_MIN = 30;

// Duration of a single rip animation in ms — starts here, accelerates to MIN by end of cascade
const RIP_DURATION     = 320;
const RIP_DURATION_MIN = 160;

// ================================================================

const TOTAL = COLS * ROWS;

const state = {
    target:    0,
    current:   0,
    revealed:  0,
    order:     [],   // shuffled removal order (tile indices)
    tiles:     [],   // tile DOM elements, indexed row-major (row 0 L→R, then row 1…)
    busy:      false,
    completed: false,
    animating: false,
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
    initFire();

    // Load persisted state from localStorage; fall back to a fresh session.
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('goalie-state') || '{}'); } catch {}

    if (saved.target) {
        state.target   = saved.target;
        state.current  = saved.current  ?? 0;
        state.revealed = saved.revealed ?? 0;
        state.order    = saved.order    ?? buildOrder();
    } else {
        state.target = 8000;
        state.order  = buildOrder();
        saveState();
    }

    buildTiles();

    // Re-hide tiles already revealed in a previous session.
    for (let i = 0; i < state.revealed; i++) {
        state.tiles[state.order[i]].style.visibility = 'hidden';
    }

    if (saved.completed) showComplete();

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
    state.target    = targetVal;
    state.current   = 0;
    state.revealed  = 0;
    state.order     = buildOrder();
    state.busy      = false;
    state.completed = false;
    state.animating = false;

    document.getElementById('in-current').value = '';
    document.getElementById('in-current').placeholder = '0';
    document.getElementById('btn-reveal').disabled = false;
    const banner = document.getElementById('complete-banner');
    banner.classList.remove('show', 'pulsing');
    document.getElementById('hud-current').classList.remove('complete');
    document.getElementById('hud-pct').classList.remove('goal-reached');

    buildTiles();
    updateHUD();
    saveState();
}

function handleReset() {
    document.getElementById('reset-dialog').showModal();
}

function confirmReset() {
    document.getElementById('reset-dialog').close();
    stopFireworks();
    handleSetTarget();
    closePanel();
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
    state.current    = newVal;
    currentEl.value  = '';
    currentEl.placeholder = state.current.toLocaleString();

    const targetRevealed = Math.round((Math.min(state.current, state.target) / state.target) * TOTAL);
    const toReveal       = Math.max(0, targetRevealed - state.revealed);
    const ripDuration    = toReveal <= 0 ? 0
        : toReveal === 1 ? RIP_DURATION
        : (toReveal - 1) * (TILE_DELAY + TILE_DELAY_MIN) / 2 + RIP_DURATION_MIN;

    // When the new value exceeds the target, compress the cascade so tiles finish
    // when the counter visually crosses the target. sqrt(cascadeScale) gives a
    // gentler compression so the start delay stays perceptible regardless of
    // how large the bonus is. counterDuration is extended to match.
    const cascadeScale = (!state.completed && state.current > state.target && prev < state.target && state.current > prev)
        ? (state.target - prev) / (state.current - prev)
        : 1;
    const delayScale     = Math.sqrt(cascadeScale);
    const barDuration    = ripDuration * delayScale;
    const counterDuration = cascadeScale < 1 ? barDuration / cascadeScale : ripDuration;

    updateHUD(prev, counterDuration, barDuration);

    if (toReveal > 0) {
        cascade(toReveal, delayScale);
    } else {
        saveState();
    }
}

// ----------------------------------------------------------------
//  Cascade: rip `count` tiles one by one
// ----------------------------------------------------------------

function cascade(count, scale = 1) {
    state.busy = true;
    document.getElementById('btn-reveal').disabled = true;
    syncToggleBtn();

    // Pre-calculate each tile's absolute fire time so there's no cumulative drift.
    const schedule = [];
    let accum = 0;
    for (let i = 0; i < count; i++) {
        const frac = count > 1 ? i / (count - 1) : 0;
        schedule.push(accum);
        accum += (TILE_DELAY + (TILE_DELAY_MIN - TILE_DELAY) * frac) * scale;
    }

    const startTime = performance.now();
    let done = 0;

    function tick(now) {
        const elapsed = now - startTime;

        while (done < count && state.revealed < TOTAL && schedule[done] <= elapsed) {
            const frac   = count > 1 ? done / (count - 1) : 0;
            const ripDur = RIP_DURATION + (RIP_DURATION_MIN - RIP_DURATION) * frac;
            ripTile(state.tiles[state.order[state.revealed]], ripDur);
            state.revealed++;
            done++;
        }

        if (done < count && state.revealed < TOTAL) {
            requestAnimationFrame(tick);
        } else {
            state.busy = false;
            document.getElementById('btn-reveal').disabled = false;
            if (state.revealed >= TOTAL) showComplete();
            syncToggleBtn();
            saveState();
        }
    }

    requestAnimationFrame(tick);
}

// ----------------------------------------------------------------
//  Single tile rip
// ----------------------------------------------------------------

function ripTile(tile, ripDur = RIP_DURATION) {
    // Random direction, angle, and flight distance
    const angleDeg = (Math.random() - 0.5) * 60;           // –30 … +30°
    const radDir   = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 2);
    const dist     = 300 + Math.random() * 280;
    const tx       = Math.cos(radDir) * dist;
    const ty       = Math.sin(radDir) * dist;

    tile.style.setProperty('--rip-r',   `${angleDeg}deg`);
    tile.style.setProperty('--rip-x',   `${tx}px`);
    tile.style.setProperty('--rip-y',   `${ty}px`);
    tile.style.setProperty('--rip-dur', `${ripDur}ms`);

    // Apply torn polygon clip-path right before animating
    tile.style.clipPath = tornEdge();

    spawnFire(tile, ripDur);
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

function updateHUD(fromVal, animDuration, barDuration = animDuration) {
    const pct  = state.target > 0 ? (state.current / state.target) * 100 : 0;
    const fill = document.getElementById('hud-fill');

    document.getElementById('hud-target').textContent =
        state.target > 0 ? state.target.toLocaleString() : '—';

    if (fromVal !== undefined && animDuration > 0) {
        const fromPct = state.target > 0 ? (fromVal / state.target) * 100 : 0;
        animateCounter(fromVal, state.current, fromPct, pct, animDuration);
        fill.style.transition = `width ${barDuration}ms linear`;
    } else {
        document.getElementById('hud-current').textContent =
            state.current.toLocaleString();
        const pctEl = document.getElementById('hud-pct');
        pctEl.textContent = state.target > 0 ? `${Math.round(pct)}% of goal` : 'Set a target below';
        pctEl.classList.toggle('goal-reached', state.target > 0 && state.current >= state.target);
        fill.style.transition = 'width 0.9s ease';
        setFillGradient(Math.min(100, pct));
        updateBonus(state.current);
    }

    fill.style.width = `${Math.min(100, pct)}%`;
}

function setFillGradient(pct) {
    const hue = Math.min(240, pct * 2.4);
    document.getElementById('hud-fill').style.background =
        `linear-gradient(90deg, hsl(0,100%,50%), hsl(${hue},100%,60%))`;
}

function updateBonus(current) {
    const bonus  = Math.max(0, current - state.target);
    const bonusEl = document.getElementById('hud-bonus');
    if (bonus > 0 && state.target > 0) {
        bonusEl.style.display = 'block';
        document.getElementById('hud-target-echo').textContent = state.target.toLocaleString();
        document.getElementById('hud-bonus-amt').textContent = bonus.toLocaleString();
        document.getElementById('hud-total-amt').textContent = current.toLocaleString();
    } else {
        bonusEl.style.display = 'none';
    }
}

function animateCounter(from, to, fromPct, toPct, duration) {
    state.animating = true;
    syncToggleBtn();
    const el     = document.getElementById('hud-current');
    const pctEl  = document.getElementById('hud-pct');
    const start  = performance.now();
    function tick(now) {
        const t      = Math.min((now - start) / duration, 1);
        const cur    = Math.round(from + (to - from) * t);
        const curPct = fromPct + (toPct - fromPct) * t;
        el.textContent    = cur.toLocaleString();
        pctEl.textContent = `${Math.round(curPct)}% of goal`;
        setFillGradient(Math.min(100, curPct));
        pctEl.classList.toggle('goal-reached', state.target > 0 && cur >= state.target);
        updateBonus(cur);
        if (!state.completed && state.target > 0 && cur >= state.target) {
            showComplete();
        }
        if (t < 1) {
            requestAnimationFrame(tick);
        } else {
            state.animating = false;
            syncToggleBtn();
        }
    }
    requestAnimationFrame(tick);
}

// ----------------------------------------------------------------
//  Completion
// ----------------------------------------------------------------

function showComplete() {
    if (state.completed) return;
    state.completed = true;
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

function syncToggleBtn() {
    const panelOpen = !document.getElementById('panel').hasAttribute('hidden');
    document.getElementById('toggle-btn').classList.toggle('hidden',
        panelOpen || state.busy || state.animating);
}

function openPanel() {
    document.getElementById('panel').removeAttribute('hidden');
    document.getElementById('btn-reset').classList.remove('hidden');
    syncToggleBtn();
    document.getElementById('in-current').focus();
}

function closePanel() {
    document.getElementById('panel').setAttribute('hidden', '');
    document.getElementById('btn-reset').classList.add('hidden');
    syncToggleBtn();
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

// Tile removal order: prefer tiles furthest from centre, with noise so it
// isn't perfectly spiral. Score = euclidean distance + random(0..8).
// Sorted descending so outer tiles tend to go first.
function buildOrder() {
    const cx = COLS / 2 - 0.5;
    const cy = ROWS / 2 - 0.5;
    return Array.from({ length: TOTAL }, (_, i) => ({
        idx:   i,
        score: Math.hypot(i % COLS - cx, Math.floor(i / COLS) - cy) + Math.random() * 8,
    }))
    .sort((a, b) => b.score - a.score)
    .map(w => w.idx);
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

function stopFireworks() {
    FW.active = false;
    if (FW.animId) { cancelAnimationFrame(FW.animId); FW.animId = null; }
    FW.rockets = [];
    FW.particles = [];
    if (FW.canvas) FW.canvas.style.display = 'none';
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
//  Fire particles
// ----------------------------------------------------------------

const FIRE = {
    canvas: null,
    ctx: null,
    particles: [],
};

function initFire() {
    FIRE.canvas = document.createElement('canvas');
    FIRE.canvas.style.cssText =
        'position:fixed;inset:0;z-index:50;pointer-events:none;';
    document.body.appendChild(FIRE.canvas);
    FIRE.ctx = FIRE.canvas.getContext('2d');
    const resize = () => {
        FIRE.canvas.width  = window.innerWidth;
        FIRE.canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    fireLoop();
}

function spawnFire(tile, ripDur = RIP_DURATION) {
    const end = performance.now() + ripDur;

    function emit() {
        if (performance.now() >= end) return;

        const rect = tile.getBoundingClientRect();
        if (rect.width < 0.5) return;            // tile scaled away, stop

        const cx   = rect.left + rect.width  * 0.5;
        const cy   = rect.top  + rect.height * 0.5;
        const base = Math.max(rect.width, rect.height);
        const count = 2 + Math.floor(Math.random() * 2);

        for (let i = 0; i < count; i++) {
            FIRE.particles.push({
                x:      cx + (Math.random() - 0.5) * rect.width  * 0.7,
                y:      cy + (Math.random() - 0.5) * rect.height * 0.7,
                vx:     (Math.random() - 0.5) * 1.8,
                vy:     -(2.5 + Math.random() * 3.5),
                alpha:  0.75 + Math.random() * 0.25,
                hue:    10 + Math.random() * 30,
                size:   base * 0.18 * (0.5 + Math.random() * 0.8),
                decay:  0.014 + Math.random() * 0.016,
                wobble: Math.random() * Math.PI * 2,
            });
        }

        requestAnimationFrame(emit);
    }

    requestAnimationFrame(emit);
}

function fireLoop() {
    const { ctx, canvas, particles } = FIRE;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.wobble += 0.25;
        p.x      += p.vx + Math.sin(p.wobble) * 0.7;
        p.y      += p.vy;
        p.vy     -= 0.08;            // accelerate upward
        p.size   *= 0.97;
        p.alpha  -= p.decay;

        if (p.alpha <= 0 || p.size < 0.5) { particles.splice(i, 1); continue; }

        // Radial gradient: white-yellow core → orange → red rim → transparent
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0,    `hsla(55, 100%, 95%, ${p.alpha})`);
        g.addColorStop(0.25, `hsla(45, 100%, 70%, ${p.alpha})`);
        g.addColorStop(0.6,  `hsla(${p.hue}, 100%, 52%, ${p.alpha * 0.8})`);
        g.addColorStop(1,    `hsla(${p.hue - 5}, 90%, 35%, 0)`);

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
    }

    requestAnimationFrame(fireLoop);
}

// ----------------------------------------------------------------
//  Server state persistence
// ----------------------------------------------------------------

function saveState() {
    try {
        localStorage.setItem('goalie-state', JSON.stringify({
            target:    state.target,
            current:   state.current,
            revealed:  state.revealed,
            order:     state.order,
            completed: state.completed,
        }));
    } catch {}
}

// ----------------------------------------------------------------
//  Start
// ----------------------------------------------------------------

init();
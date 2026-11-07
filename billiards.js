// Billiards: hand-rolled table physics + canvas rendering. No dependencies.
(() => {
    'use strict';

    // ---------- Table geometry (logical units) ----------
    const W = 1000, H = 500;          // playing surface
    const RAIL = 40;                  // wooden rail drawn around it
    const CW = W + RAIL * 2, CH = H + RAIL * 2;
    const R = 13;                     // ball radius (big enough for the project icons)
    const POCKETS = [
        { x: 0, y: 0, r: 28 }, { x: W / 2, y: -6, r: 24 }, { x: W, y: 0, r: 28 },
        { x: 0, y: H, r: 28 }, { x: W / 2, y: H + 6, r: 24 }, { x: W, y: H, r: 28 },
    ];
    const HEAD_SPOT = { x: W * 0.25, y: H / 2 };
    const FOOT_SPOT = { x: W * 0.72, y: H / 2 };

    // ---------- Physics tuning ----------
    const SUBSTEPS = 8;
    const ROLL_DECEL = 190;           // constant rolling resistance, units/s^2
    const DRAG = 0.22;                // velocity-proportional drag, 1/s
    const BALL_E = 0.94;              // ball-ball restitution
    const RAIL_E = 0.72;              // cushion restitution
    const STOP_SPEED = 6;
    const MAX_SHOT = 3400;            // cue ball speed at full power
    const MAX_PULL = 240;             // drag distance for full power (logical units)

    // each ball is a project: colour + icon instead of a number
    const BALL_DEFS = [
        { n: 1, c: '#E0A955', t: 'solid' },  { n: 2, c: '#e2553f', t: 'solid' },
        { n: 3, c: '#2f6fd6', t: 'solid' },  { n: 4, c: '#7a4cc2', t: 'solid' },
        { n: 5, c: '#1f9a5a', t: 'solid' },  { n: 6, c: '#f5862e', t: 'solid' },
        { n: 7, c: '#9b3324', t: 'solid' },  { n: 8, c: '#161616', t: 'eight' },
        { n: 9, c: '#f4c430', t: 'stripe' }, { n: 10, c: '#2f6fd6', t: 'stripe' },
        { n: 11, c: '#1f9a5a', t: 'stripe' }, { n: 12, c: '#E0A955', t: 'stripe' },
        { n: 13, c: '#5b6b8c', t: 'stripe' }, { n: 14, c: '#3fb6d8', t: 'stripe' },
        { n: 15, c: '#ff9a6b', t: 'stripe' },
    ];
    // every ball is named after something I've made
    const PROJECTS = {
        1: 'Lyrenne', 2: 'Hanko', 3: 'BeQuiet', 4: 'MDickie FaceMod', 5: 'Weekend Warriors 60fps patch',
        6: 'NX Recomp Hub', 7: 'Madeira', 8: 'Commercial software', 9: 'Triiibe internship',
        10: 'EPQ dissertation', 11: 'Battery scholarship', 12: 'Lyrenne for iPad',
        13: 'Lyrenne for Steam Deck', 14: 'Simple-Watermark', 15: 'This portfolio',
    };
    // 8 in the middle of the third row, a stripe and a solid in the back corners
    const RACK = [1, 10, 3, 2, 8, 11, 13, 4, 12, 6, 14, 5, 15, 7, 9];

    // ---------- DOM ----------
    const canvas = document.getElementById('table');
    if (!canvas) return; // stale cached page from the old version
    let ctx = canvas.getContext('2d'); // swapped briefly to draw tray balls
    const gameEl = document.getElementById('game');
    const $ = id => document.getElementById(id);
    const hudShots = $('hud-shots'), hudLeft = $('hud-left'), hudBest = $('hud-best');
    const powerFill = $('power-fill'), tray = $('tray'), toastEl = $('toast');
    const winEl = $('win'), winTitle = $('win-title'), winBest = $('win-best');
    const soundBtn = $('sound-toggle');
    const lastPotted = $('last-potted');

    const store = {
        get(k) { try { return localStorage.getItem(k); } catch { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    };

    // ---------- State ----------
    let balls = [];        // { x, y, vx, vy, n, c, t, cue, roll, dir, sink, gone }
    let cue;
    let moving = false;
    let shots = 0;
    let scratched = false;
    let pottedThisShot = 0;
    let best = parseInt(store.get('billiards-best'), 10) || null;
    let aim = null;        // { sx, sy, x, y }
    let soundOn = store.get('billiards-sound') !== 'off';
    let scale = 1, dpr = 1;

    // ---------- Setup ----------
    function newRack() {
        balls = [];
        cue = makeBall(HEAD_SPOT.x, HEAD_SPOT.y, { n: 0, c: '#f6f1e4', t: 'cue' });
        cue.cue = true;
        balls.push(cue);
        const gap = R * 2 + 0.6;
        let k = 0;
        for (let row = 0; row < 5; row++) {
            for (let i = 0; i <= row; i++) {
                const def = BALL_DEFS[RACK[k++] - 1];
                const x = FOOT_SPOT.x + row * gap * Math.cos(Math.PI / 6);
                const y = FOOT_SPOT.y + (i - row / 2) * gap;
                balls.push(makeBall(x + (Math.random() - .5) * .2, y + (Math.random() - .5) * .2, def));
            }
        }
        shots = 0; moving = false; scratched = false; aim = null;
        tray.innerHTML = '';
        lastPotted.textContent = 'Each ball is one of my projects. Aim at one to see which.';
        toastEl.classList.remove('show');
        winEl.hidden = true;
        updateHud();
    }

    function makeBall(x, y, def) {
        return { x, y, vx: 0, vy: 0, n: def.n, c: def.c, t: def.t, cue: false, roll: Math.random() * 6, dir: 0, sink: null, gone: false };
    }

    const live = () => balls.filter(b => !b.gone && !b.sink);
    const objectBallsLeft = () => balls.filter(b => !b.cue && !b.gone && !b.sink).length;

    function updateHud() {
        hudShots.textContent = shots;
        hudLeft.textContent = objectBallsLeft();
        hudBest.textContent = best ?? '-';
    }

    // ---------- Physics ----------
    function step(dt) {
        const h = dt / SUBSTEPS;
        for (let s = 0; s < SUBSTEPS; s++) {
            const bs = live();
            for (const b of bs) {
                const sp = Math.hypot(b.vx, b.vy);
                if (sp === 0) continue;
                let nsp = sp - (ROLL_DECEL + DRAG * sp) * h;
                if (nsp < 0) nsp = 0;
                const f = nsp / sp;
                b.vx *= f; b.vy *= f;
                b.x += b.vx * h; b.y += b.vy * h;
                b.roll += (nsp * h) / R;
                b.dir = Math.atan2(b.vy, b.vx);
            }
            // pockets before cushions, so balls heading into a mouth drop instead of bouncing
            for (const b of bs) {
                for (const p of POCKETS) {
                    if (Math.hypot(b.x - p.x, b.y - p.y) < p.r) { pot(b, p); break; }
                }
            }
            for (const b of bs) {
                if (b.sink) continue;
                if (b.x < R) { b.x = R; if (b.vx < 0) { hitRail(b.vx); b.vx = -b.vx * RAIL_E; } }
                if (b.x > W - R) { b.x = W - R; if (b.vx > 0) { hitRail(b.vx); b.vx = -b.vx * RAIL_E; } }
                if (b.y < R) { b.y = R; if (b.vy < 0) { hitRail(b.vy); b.vy = -b.vy * RAIL_E; } }
                if (b.y > H - R) { b.y = H - R; if (b.vy > 0) { hitRail(b.vy); b.vy = -b.vy * RAIL_E; } }
            }
            for (let i = 0; i < bs.length; i++) {
                const a = bs[i];
                if (a.sink) continue;
                for (let j = i + 1; j < bs.length; j++) {
                    const b = bs[j];
                    if (b.sink) continue;
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const d2 = dx * dx + dy * dy;
                    if (d2 >= 4 * R * R || d2 === 0) continue;
                    const d = Math.sqrt(d2);
                    const nx = dx / d, ny = dy / d;
                    const push = (2 * R - d) / 2;
                    a.x -= nx * push; a.y -= ny * push;
                    b.x += nx * push; b.y += ny * push;
                    const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
                    if (vn <= 0) continue;
                    const imp = (1 + BALL_E) / 2 * vn;
                    a.vx -= nx * imp; a.vy -= ny * imp;
                    b.vx += nx * imp; b.vy += ny * imp;
                    sound.click(vn);
                }
            }
        }
        // sinking animation
        for (const b of balls) {
            if (!b.sink) continue;
            b.sink.t += dt;
            const k = Math.min(b.sink.t / 0.28, 1);
            b.x += (b.sink.p.x - b.x) * Math.min(1, dt * 18);
            b.y += (b.sink.p.y - b.y) * Math.min(1, dt * 18);
            if (k >= 1) b.gone = true;
        }
        const settled = b => b.gone || (!b.sink && Math.hypot(b.vx, b.vy) < STOP_SPEED);
        if (moving && balls.every(settled)) {
            for (const b of balls) { b.vx = 0; b.vy = 0; }
            moving = false;
            endOfShot();
        }
    }

    function hitRail(v) { sound.rail(Math.abs(v)); }

    function pot(b, p) {
        b.sink = { p, t: 0 };
        b.vx = 0; b.vy = 0;
        sound.pocket();
        if (b.cue) { scratched = true; return; }
        pottedThisShot++;
        const el = trayBall(b);
        el.title = PROJECTS[b.n];
        lastPotted.textContent = `Potted: ${PROJECTS[b.n]}`;
        tray.appendChild(el);
        updateHud();
    }

    function endOfShot() {
        if (scratched) {
            scratched = false;
            respawnCue();
            toast('Scratch', false);
        } else if (pottedThisShot >= 2) {
            toast(`${pottedThisShot} in one shot`, true);
        }
        pottedThisShot = 0;
        updateHud();
        if (objectBallsLeft() === 0) win();
    }

    function respawnCue() {
        cue.gone = false; cue.sink = null; cue.vx = cue.vy = 0;
        let x = HEAD_SPOT.x, y = HEAD_SPOT.y;
        for (let tries = 0; tries < 60; tries++) {
            const clash = balls.some(b => b !== cue && !b.gone && !b.sink && Math.hypot(b.x - x, b.y - y) < 2 * R + 1);
            if (!clash) break;
            y = HEAD_SPOT.y + ((tries % 2) ? 1 : -1) * Math.ceil((tries + 1) / 2) * (R * 2.2);
            if (y < R || y > H - R) { x -= R * 2.2; y = HEAD_SPOT.y; }
        }
        cue.x = x; cue.y = y;
    }

    function win() {
        const isBest = best === null || shots < best;
        if (isBest) { best = shots; store.set('billiards-best', String(best)); }
        winTitle.textContent = `${shots} shot${shots === 1 ? '' : 's'}`;
        winBest.textContent = isBest ? 'New best.' : `Your best is ${best}.`;
        winEl.hidden = false;
        updateHud();
        sound.win();
    }

    let toastTimer = null;
    function toast(msg, good) {
        toastEl.textContent = msg;
        toastEl.classList.toggle('good', !!good);
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
    }

    // ---------- Input ----------
    function toTable(e) {
        const r = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) / r.width * CW - RAIL,
            y: (e.clientY - r.top) / r.height * CH - RAIL,
        };
    }
    function aimVector() {
        if (!aim) return null;
        const dx = aim.sx - aim.x, dy = aim.sy - aim.y;
        const len = Math.hypot(dx, dy);
        if (len < 4) return null;
        return { dx: dx / len, dy: dy / len, power: Math.min(len / MAX_PULL, 1) };
    }

    canvas.addEventListener('pointerdown', e => {
        if (moving || !winEl.hidden) return;
        sound.unlock();
        canvas.setPointerCapture(e.pointerId);
        const p = toTable(e);
        aim = { sx: p.x, sy: p.y, x: p.x, y: p.y };
    });
    canvas.addEventListener('pointermove', e => {
        if (!aim) return;
        const p = toTable(e);
        aim.x = p.x; aim.y = p.y;
        const v = aimVector();
        powerFill.style.width = v ? (v.power * 100).toFixed(1) + '%' : '0%';
    });
    function release() {
        const v = aimVector();
        aim = null;
        powerFill.style.width = '0%';
        if (!v || v.power < 0.03) return;
        const speed = MAX_SHOT * Math.pow(v.power, 1.15);
        cue.vx = v.dx * speed; cue.vy = v.dy * speed;
        moving = true;
        shots++;
        pottedThisShot = 0;
        updateHud();
        sound.cue(v.power);
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', () => { aim = null; powerFill.style.width = '0%'; });
    window.addEventListener('keydown', e => {
        if (e.key === 'Escape' && aim) { aim = null; powerFill.style.width = '0%'; }
    });

    $('reset-button').addEventListener('click', newRack);
    $('play-again').addEventListener('click', newRack);
    function paintSoundBtn() {
        soundBtn.textContent = soundOn ? '🦆 Sound on' : '🦆 Quiet';
        soundBtn.setAttribute('aria-pressed', String(soundOn));
    }
    soundBtn.addEventListener('click', () => {
        soundOn = !soundOn;
        store.set('billiards-sound', soundOn ? 'on' : 'off');
        paintSoundBtn();
        if (soundOn) { sound.unlock(); sound.click(600); }
    });
    paintSoundBtn();

    // ---------- Sound (generated, no files) ----------
    const sound = (() => {
        let ac = null, noise = null, last = 0;
        function unlock() {
            if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
            try {
                ac = new (window.AudioContext || window.webkitAudioContext)();
                noise = ac.createBuffer(1, ac.sampleRate * 0.05, ac.sampleRate);
                const d = noise.getChannelData(0);
                for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
            } catch { ac = null; }
        }
        function burst(freq, q, gain, dur) {
            if (!soundOn || !ac) return;
            const now = ac.currentTime;
            const src = ac.createBufferSource(); src.buffer = noise;
            const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
            const g = ac.createGain();
            g.gain.setValueAtTime(gain, now);
            g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
            src.connect(bp).connect(g).connect(ac.destination);
            src.start(now); src.stop(now + dur);
        }
        function tone(freq, gain, dur, delay = 0) {
            if (!soundOn || !ac) return;
            const now = ac.currentTime + delay;
            const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
            const g = ac.createGain();
            g.gain.setValueAtTime(0.0001, now);
            g.gain.exponentialRampToValueAtTime(gain, now + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
            o.connect(g).connect(ac.destination);
            o.start(now); o.stop(now + dur);
        }
        return {
            unlock,
            click(v) {
                if (!ac) return;
                const t = ac.currentTime;
                if (t - last < 0.012) return;
                last = t;
                burst(3200, 2.5, Math.min(0.9, v / 1600), 0.05);
            },
            rail(v) { if (v > 120) burst(420, 1.2, Math.min(0.5, v / 3000), 0.08); },
            cue(p) { burst(1800, 1.5, 0.25 + p * 0.5, 0.06); },
            pocket() { burst(180, 0.8, 0.7, 0.18); },
            win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, 0.35, i * 0.09)); },
        };
    })();

    // ---------- Rendering: soft and simple ----------
    const COL = {
        rail: '#865230',
        cushion: '#176350', felt: '#1f7a63', pocket: '#16110d',
        ink: 'rgba(14,10,8,.18)', ivory: '#f6f1e4', gold: '#8FB3E8', mint: '#6ee7a0', seal: '#e2553f',
    };
    let fps = 60, fpsFrames = 0, fpsT = performance.now();

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const w = gameEl.clientWidth;
        scale = w / CW;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(w * CH / CW * dpr);
    }

    function rr(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }
    // hairline edge only; shapes are defined by soft shading, not ink
    function outline(w = 2) { ctx.lineWidth = Math.min(w, 1.2) * 0.8; ctx.strokeStyle = COL.ink; ctx.stroke(); }
    function softShadow(blur, oy) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = blur * scale * dpr; ctx.shadowOffsetY = oy * scale * dpr; }
    function noShadow() { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }

    function drawTable(t) {
        // rail: smooth warm wood with a soft top light
        const wood = ctx.createLinearGradient(0, -RAIL, 0, H + RAIL);
        wood.addColorStop(0, '#8a5532'); wood.addColorStop(1, '#5f3720');
        rr(-RAIL, -RAIL, CW, CH, 34); ctx.fillStyle = wood; ctx.fill();
        rr(-RAIL + 1.5, -RAIL + 1.5, CW - 3, CH - 3, 33); ctx.strokeStyle = 'rgba(255,220,180,.16)'; ctx.lineWidth = 1.5; ctx.stroke();

        // sights
        ctx.fillStyle = 'rgba(255,230,190,.55)';
        for (const fx of [0.125, 0.375, 0.625, 0.875]) {
            for (const y of [-RAIL / 2, H + RAIL / 2]) { ctx.beginPath(); ctx.arc(W * fx, y, 2.6, 0, Math.PI * 2); ctx.fill(); }
        }

        // cushion + felt
        rr(-11, -11, W + 22, H + 22, 14); ctx.fillStyle = COL.cushion; ctx.fill();
        const felt = ctx.createRadialGradient(W / 2, H * 0.45, 30, W / 2, H / 2, W * 0.6);
        felt.addColorStop(0, '#24886e'); felt.addColorStop(1, '#1a6b57');
        ctx.fillStyle = felt; ctx.fillRect(0, 0, W, H);
        // soft inner shadow where felt meets cushion
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
        ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 16 * scale * dpr;
        ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 10;
        ctx.strokeRect(-5, -5, W + 10, H + 10);
        ctx.restore();

        // head string
        ctx.save();
        ctx.setLineDash([2, 10]); ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(HEAD_SPOT.x, 14); ctx.lineTo(HEAD_SPOT.x, H - 14); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(255,255,255,.3)';
        for (const s of [HEAD_SPOT, FOOT_SPOT]) { ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill(); }

        // pockets
        for (const p of POCKETS) {
            const g = ctx.createRadialGradient(p.x, p.y - 3, 2, p.x, p.y, p.r + 3);
            g.addColorStop(0, '#000'); g.addColorStop(0.8, '#0e0b09'); g.addColorStop(1, '#2a1a10');
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 3, 0, Math.PI * 2);
            ctx.fillStyle = g; ctx.fill();
        }

    }

    // ---------- Project icons (drawn at the origin, fit in radius s) ----------
    const INK = '#2b2420';
    function glyph(text, s, k = 1, font = "'Space Grotesk', Inter, sans-serif", color = INK) {
        ctx.fillStyle = color;
        ctx.font = `700 ${s * k}px ${font}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, s * 0.08);
    }
    function pen(s, w = 0.18) { ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = s * w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
    const ICONS = {
        1: s => { // Lyrenne: a music note
            pen(s);
            ctx.beginPath(); ctx.ellipse(-s * 0.25, s * 0.45, s * 0.3, s * 0.22, -0.4, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.moveTo(s * 0.03, s * 0.42); ctx.lineTo(s * 0.03, -s * 0.7); ctx.quadraticCurveTo(s * 0.45, -s * 0.5, s * 0.5, -s * 0.15); ctx.stroke();
        },
        2: s => glyph('判', s, 1.35, "'Yu Mincho', 'Noto Serif JP', 'MS Mincho', serif", '#c8402f'), // Hanko seal
        3: s => { // BeQuiet: a rubber duck
            ctx.fillStyle = '#f2b705';
            ctx.beginPath(); ctx.ellipse(s * 0.1, s * 0.3, s * 0.62, s * 0.38, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(-s * 0.2, -s * 0.25, s * 0.36, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ef6c1f';
            ctx.beginPath(); ctx.ellipse(-s * 0.62, -s * 0.2, s * 0.22, s * 0.12, 0.15, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(-s * 0.27, -s * 0.33, s * 0.08, 0, Math.PI * 2); ctx.fill();
        },
        4: s => { // FaceMod: a face
            pen(s, 0.14);
            ctx.beginPath(); ctx.arc(0, 0, s * 0.78, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(-s * 0.27, -s * 0.18, s * 0.1, 0, Math.PI * 2); ctx.arc(s * 0.27, -s * 0.18, s * 0.1, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(0, s * 0.05, s * 0.4, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
        },
        5: s => glyph('60', s, 0.95, "'Space Mono', monospace"),             // 60fps patch
        6: s => glyph('NX', s, 0.9),                                            // NX Recomp Hub
        7: s => { // Madeira: PC games on a phone
            pen(s, 0.14);
            rr(-s * 0.42, -s * 0.72, s * 0.84, s * 1.44, s * 0.18); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, s * 0.5, s * 0.08, 0, Math.PI * 2); ctx.fill();
        },
        8: s => glyph('€', s, 1.25),                                            // commercial software
        9: s => { // Triiibe: social analytics bars
            pen(s, 0.2);
            for (const [i, h] of [[-1, 0.5], [0, 0.95], [1, 1.35]]) {
                ctx.beginPath(); ctx.moveTo(i * s * 0.42, s * 0.6); ctx.lineTo(i * s * 0.42, s * 0.6 - s * h); ctx.stroke();
            }
        },
        10: s => { // EPQ: right-to-repair wrench
            ctx.save(); ctx.rotate(-Math.PI / 4);
            pen(s, 0.26);
            ctx.beginPath(); ctx.moveTo(0, s * 0.75); ctx.lineTo(0, -s * 0.1); ctx.stroke();
            ctx.beginPath(); ctx.arc(0, -s * 0.38, s * 0.36, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = COL.ivory; ctx.fillRect(-s * 0.13, -s * 0.85, s * 0.26, s * 0.45);
            ctx.restore();
        },
        11: s => { // scholarship: swappable battery
            pen(s, 0.13);
            rr(-s * 0.72, -s * 0.4, s * 1.3, s * 0.8, s * 0.15); ctx.stroke();
            ctx.fillRect(s * 0.6, -s * 0.18, s * 0.16, s * 0.36);
            ctx.fillStyle = '#1f9a5a';
            ctx.fillRect(-s * 0.52, -s * 0.2, s * 0.3, s * 0.4); ctx.fillRect(-s * 0.15, -s * 0.2, s * 0.3, s * 0.4);
        },
        12: s => { // Lyrenne for iPad: a tablet with a note
            pen(s, 0.13);
            rr(-s * 0.75, -s * 0.55, s * 1.5, s * 1.1, s * 0.16); ctx.stroke();
            glyph('♪', s, 0.85, "'Segoe UI Symbol', sans-serif");
        },
        13: s => { // Lyrenne for Steam Deck: a handheld
            pen(s, 0.13);
            rr(-s * 0.85, -s * 0.38, s * 1.7, s * 0.76, s * 0.3); ctx.stroke();
            ctx.fillRect(-s * 0.32, -s * 0.2, s * 0.64, s * 0.4);
            ctx.beginPath(); ctx.arc(-s * 0.58, 0, s * 0.08, 0, Math.PI * 2); ctx.arc(s * 0.58, 0, s * 0.08, 0, Math.PI * 2); ctx.fill();
        },
        14: s => { // Simple-Watermark: a droplet
            ctx.fillStyle = '#3fb6d8';
            ctx.beginPath(); ctx.moveTo(0, -s * 0.8);
            ctx.bezierCurveTo(s * 0.25, -s * 0.35, s * 0.55, -s * 0.05, s * 0.55, s * 0.25);
            ctx.arc(0, s * 0.25, s * 0.55, 0, Math.PI);
            ctx.bezierCurveTo(-s * 0.55, -s * 0.05, -s * 0.25, -s * 0.35, 0, -s * 0.8);
            ctx.fill();
        },
        15: s => glyph('</>', s, 0.62, "'Space Mono', monospace"),            // this portfolio
    };

    // a potted ball for the tray, drawn with the same code as the table
    function trayBall(b) {
        const size = 26, k = Math.min(window.devicePixelRatio || 1, 3);
        const c = document.createElement('canvas');
        c.className = 'tray-ball';
        c.width = c.height = Math.round(size * k);
        const main = ctx;
        ctx = c.getContext('2d');
        const f = (size / 2 - 1) / R * k;
        ctx.setTransform(f, 0, 0, f, size * k / 2, size * k / 2);
        drawBall({ ...b, x: 0, y: 0, sink: null, tray: true });
        ctx = main;
        return c;
    }

    function drawBall(b) {
        let r = R, alpha = 1;
        if (b.sink) {
            const k = Math.min(b.sink.t / 0.28, 1);
            r = R * (1 - k * 0.55); alpha = 1 - k;
        }
        const { x, y } = b;
        ctx.save();
        ctx.globalAlpha = alpha;
        if (!b.sink && !b.tray) softShadow(7, 3.5);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = (b.cue || b.t === 'stripe') ? COL.ivory : b.c;
        ctx.fill();
        noShadow();
        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
        if (b.t === 'stripe') { ctx.fillStyle = b.c; ctx.fillRect(x - r, y - r * 0.52, r * 2, r * 1.04); }
        if (!b.cue && r > 7) {
            const s = r * 0.6;
            ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2);
            ctx.fillStyle = COL.ivory; ctx.fill();
            ctx.save();
            ctx.translate(x, y);
            ICONS[b.n](s * 0.82);
            ctx.restore();
        }
        // one soft light from the top left
        const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.05, x, y, r * 1.1);
        g.addColorStop(0, 'rgba(255,255,255,.55)');
        g.addColorStop(0.3, 'rgba(255,255,255,.08)');
        g.addColorStop(1, 'rgba(0,0,0,.28)');
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.restore();
        ctx.restore();
    }

    // first thing the cue ball would touch along (dx, dy)
    function castAim(dx, dy) {
        let tBall = Infinity, target = null;
        for (const b of live()) {
            if (b === cue) continue;
            const fx = cue.x - b.x, fy = cue.y - b.y;
            const bq = fx * dx + fy * dy;
            const cq = fx * fx + fy * fy - 4 * R * R;
            const disc = bq * bq - cq;
            if (disc < 0) continue;
            const t = -bq - Math.sqrt(disc);
            if (t > 0 && t < tBall) { tBall = t; target = b; }
        }
        let tWall = Infinity;
        if (dx > 0) tWall = Math.min(tWall, (W - R - cue.x) / dx);
        if (dx < 0) tWall = Math.min(tWall, (R - cue.x) / dx);
        if (dy > 0) tWall = Math.min(tWall, (H - R - cue.y) / dy);
        if (dy < 0) tWall = Math.min(tWall, (R - cue.y) / dy);
        if (target && tBall < tWall) return { t: tBall, target };
        return { t: tWall, target: null };
    }

    function drawAim() {
        const v = aimVector();
        if (!v) return;
        const { dx, dy, power } = v;
        const hit = castAim(dx, dy);
        const gx = cue.x + dx * hit.t, gy = cue.y + dy * hit.t;

        ctx.save();
        ctx.lineCap = 'round';
        // dotted guide
        ctx.setLineDash([0.1, 11]);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(246,241,228,.6)';
        ctx.beginPath(); ctx.moveTo(cue.x + dx * (R + 8), cue.y + dy * (R + 8)); ctx.lineTo(gx - dx * R, gy - dy * R); ctx.stroke();
        // ghost ball
        ctx.setLineDash([3, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(gx, gy, R, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        if (hit.target) {
            const b = hit.target;
            const nx = (b.x - gx) / (2 * R), ny = (b.y - gy) / (2 * R);
            const L = 30 + 50 * Math.max(0, dx * nx + dy * ny);
            const ex = b.x + nx * (R + L), ey = b.y + ny * (R + L);
            ctx.strokeStyle = COL.gold; ctx.fillStyle = COL.gold; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(b.x + nx * (R + 4), b.y + ny * (R + 4)); ctx.lineTo(ex, ey); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(ex + nx * 7, ey + ny * 7);
            ctx.lineTo(ex - ny * 5, ey + nx * 5);
            ctx.lineTo(ex + ny * 5, ey - nx * 5);
            ctx.closePath(); ctx.fill();
            if (!b.cue) {
                const name = PROJECTS[b.n];
                ctx.font = "600 13px 'Space Grotesk', Inter, sans-serif";
                const w = ctx.measureText(name).width + 16;
                const lx = Math.min(Math.max(b.x, w / 2 + 4), W - w / 2 - 4);
                const ly = b.y - R - 18 < 14 ? b.y + R + 18 : b.y - R - 18;
                rr(lx - w / 2, ly - 11, w, 22, 11);
                ctx.fillStyle = 'rgba(12,11,10,.82)'; ctx.fill();
                ctx.fillStyle = COL.ivory; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(name, lx, ly + 1);
            }
        }
        ctx.restore();

        // cue stick: flat colour bands, pulled back with power
        const back = R + 6 + power * 70;
        const tipX = cue.x - dx * back, tipY = cue.y - dy * back;
        const len = 400;
        const at = k => [tipX - dx * len * k, tipY - dy * len * k];
        ctx.save();
        ctx.lineCap = 'round';
        const seg = (k0, k1, color, w) => {
            const [x0, y0] = at(k0), [x1, y1] = at(k1);
            ctx.strokeStyle = color; ctx.lineWidth = w;
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        };
        softShadow(10, 5); seg(0.02, 1, '#3d2414', 7); noShadow();
        seg(0.02, 0.6, '#f1dcb2', 6);
        seg(0.6, 0.66, COL.gold, 7);
        seg(0.66, 1, '#3d2414', 7.5);
        seg(0, 0.02, '#5aa7d8', 6);
        ctx.restore();
    }

    let lastT = performance.now();
    function frame(now) {
        const dt = Math.max(0, Math.min((now - lastT) / 1000, 1 / 30));
        lastT = now;
        if (now - fpsT > 1500) { fpsT = now; fpsFrames = 0; } // tab was hidden; don't count the gap
        fpsFrames++;
        if (now - fpsT >= 500) { fps = Math.round(fpsFrames * 1000 / (now - fpsT)); fpsFrames = 0; fpsT = now; }
        if (moving || balls.some(b => b.sink && !b.gone)) step(dt);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(scale * dpr, 0, 0, scale * dpr, RAIL * scale * dpr, RAIL * scale * dpr);
        drawTable(now / 1000);
        for (const b of balls) if (b.sink && !b.gone) drawBall(b);
        for (const b of balls) if (!b.sink && !b.gone) drawBall(b);
        if (aim && !moving) drawAim();
        requestAnimationFrame(frame);
    }

    if (location.search.includes('debug')) window.__billiards = { get balls() { return balls; }, get moving() { return moving; } };

    window.addEventListener('resize', resize);
    resize();
    newRack();
    requestAnimationFrame(frame);
})();

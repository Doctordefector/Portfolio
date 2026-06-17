document.addEventListener('DOMContentLoaded', () => {
    const { Engine, Render, Runner, World, Bodies, Body, Events, Vector } = Matter;

    const gameCanvas = document.getElementById('billiard-table');
    const uiCanvas = document.getElementById('ui-canvas');
    const ctx = uiCanvas.getContext('2d');
    const instructionEl = document.getElementById('billiard-instruction');
    const resetButton = document.getElementById('reset-button');

    // ─── Table & Physics ───
    const W = 800;
    const H = 400;
    const BALL_R = 10;
    const CUSHION = 20;
    const POCKET_R = 18;
    const POCKET_MOUTH = POCKET_R * 3.5;
    const MAX_SPEED = 25;

    // ─── Aiming ───
    const HIT_ZONE = BALL_R * 3;
    const MIN_DRAG = 5;
    const MAX_DRAG = 120;
    const FORCE_SCALE = 0.045;
    const MAX_FORCE = 3.5;

    // ─── Cue ball start ───
    const CUE_START = { x: W * 0.25, y: H / 2 };
    const RACK_START = { x: W * 0.7, y: H / 2 };

    // ─── Ball definitions (1–15) ───
    const BALL_DEFS = [
        { num: 1,  color: '#F5D000', type: 'solid' },
        { num: 2,  color: '#003DA5', type: 'solid' },
        { num: 3,  color: '#D42A2A', type: 'solid' },
        { num: 4,  color: '#4B0082', type: 'solid' },
        { num: 5,  color: '#FF6B00', type: 'solid' },
        { num: 6,  color: '#006B3E', type: 'solid' },
        { num: 7,  color: '#8B1A1A', type: 'solid' },
        { num: 8,  color: '#1a1a1a', type: 'eight' },
        { num: 9,  color: '#F5D000', type: 'stripe' },
        { num: 10, color: '#003DA5', type: 'stripe' },
        { num: 11, color: '#D42A2A', type: 'stripe' },
        { num: 12, color: '#4B0082', type: 'stripe' },
        { num: 13, color: '#FF6B00', type: 'stripe' },
        { num: 14, color: '#006B3E', type: 'stripe' },
        { num: 15, color: '#8B1A1A', type: 'stripe' },
    ];

    // Rack order: 8-ball in center of 3rd row
    const RACK_ORDER = [0, 1, 8, 2, 7, 3, 9, 10, 4, 5, 11, 12, 6, 13, 14];

    // ─── State ───
    let engine, render, runner;
    let cueBall;
    let gameBalls = [];   // { body, num, color, type }
    let pocketed = [];
    let isAiming = false;
    let canShoot = true;
    let dragStart = null;
    const mouse = { x: 0, y: 0 };
    let animId = null;
    let listenersAttached = false;
    let flashMsg = '';
    let flashTimer = null;

    // ═══════════════════════════════════
    //  INIT
    // ═══════════════════════════════════
    function init() {
        uiCanvas.width = W;
        uiCanvas.height = H;

        if (engine) {
            Events.off(engine);
            Runner.stop(runner);
            Render.stop(render);
            World.clear(engine.world);
            Engine.clear(engine);
        }
        if (animId) {
            cancelAnimationFrame(animId);
            animId = null;
        }

        engine = Engine.create({
            gravity: { x: 0, y: 0 },
            positionIterations: 10,
            velocityIterations: 10,
            enableSleeping: true,
        });

        render = Render.create({
            canvas: gameCanvas,
            engine,
            options: {
                width: W,
                height: H,
                wireframes: false,
                background: '#0C6B2E',
            },
        });

        runner = Runner.create();

        buildTable();
        rackBalls();
        attachEngineEvents();

        if (!listenersAttached) {
            attachInputListeners();
            listenersAttached = true;
        }

        Render.run(render);
        Runner.run(runner, engine);
        startRenderLoop();

        pocketed = [];
        canShoot = true;
        isAiming = false;
        setInstruction('Drag the cue ball to shoot.');
    }

    function setInstruction(msg) {
        instructionEl.textContent = msg;
    }

    function showFlash(msg, duration) {
        flashMsg = msg;
        if (flashTimer) clearTimeout(flashTimer);
        if (duration > 0) {
            flashTimer = setTimeout(() => { flashMsg = ''; }, duration);
        }
    }

    // ═══════════════════════════════════
    //  TABLE
    // ═══════════════════════════════════
    function buildTable() {
        const cushionColor = '#5C3317';
        const opts = {
            isStatic: true,
            restitution: 0.7,
            friction: 0.05,
            render: { fillStyle: cushionColor },
        };

        World.add(engine.world, [
            // Top cushions (split for center pocket)
            Bodies.rectangle(W / 4, -CUSHION / 2, W / 2 - POCKET_MOUTH, CUSHION, opts),
            Bodies.rectangle(W * 3 / 4, -CUSHION / 2, W / 2 - POCKET_MOUTH, CUSHION, opts),
            // Bottom cushions
            Bodies.rectangle(W / 4, H + CUSHION / 2, W / 2 - POCKET_MOUTH, CUSHION, opts),
            Bodies.rectangle(W * 3 / 4, H + CUSHION / 2, W / 2 - POCKET_MOUTH, CUSHION, opts),
            // Side cushions
            Bodies.rectangle(-CUSHION / 2, H / 2, CUSHION, H - POCKET_MOUTH * 2, opts),
            Bodies.rectangle(W + CUSHION / 2, H / 2, CUSHION, H - POCKET_MOUTH * 2, opts),
        ]);

        const pocketOpts = {
            isStatic: true,
            isSensor: true,
            label: 'pocket',
            render: { fillStyle: '#000' },
        };
        World.add(engine.world, [
            Bodies.circle(0, 0, POCKET_R, pocketOpts),
            Bodies.circle(W / 2, -2, POCKET_R, pocketOpts),
            Bodies.circle(W, 0, POCKET_R, pocketOpts),
            Bodies.circle(0, H, POCKET_R, pocketOpts),
            Bodies.circle(W / 2, H + 2, POCKET_R, pocketOpts),
            Bodies.circle(W, H, POCKET_R, pocketOpts),
        ]);
    }

    // ═══════════════════════════════════
    //  BALLS
    // ═══════════════════════════════════
    function rackBalls() {
        const physics = {
            restitution: 0.9,
            friction: 0.04,
            frictionAir: 0.012,
            sleepThreshold: 40,
            density: 0.002,
        };

        cueBall = Bodies.circle(CUE_START.x, CUE_START.y, BALL_R, {
            ...physics,
            label: 'cue',
            render: { visible: false },
        });

        gameBalls = [];
        const spacing = BALL_R * 2.05;
        let idx = 0;

        for (let row = 0; row < 5; row++) {
            for (let col = 0; col <= row; col++) {
                const def = BALL_DEFS[RACK_ORDER[idx]];
                const x = RACK_START.x + row * spacing * Math.cos(Math.PI / 6);
                const y = RACK_START.y - (row * BALL_R) + (col * spacing);
                const body = Bodies.circle(x, y, BALL_R, {
                    ...physics,
                    label: 'ball-' + def.num,
                    render: { visible: false },
                });
                gameBalls.push({ body, ...def });
                idx++;
            }
        }

        World.add(engine.world, [cueBall, ...gameBalls.map(b => b.body)]);
    }

    // ═══════════════════════════════════
    //  INPUT
    // ═══════════════════════════════════
    function getCoords(e) {
        const rect = gameCanvas.getBoundingClientRect();
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (cx - rect.left) * (W / rect.width),
            y: (cy - rect.top) * (H / rect.height),
        };
    }

    function onAimStart(coords) {
        if (!canShoot) return;
        const dist = Vector.magnitude(Vector.sub(coords, cueBall.position));
        if (dist < HIT_ZONE) {
            isAiming = true;
            dragStart = { ...coords };
            mouse.x = coords.x;
            mouse.y = coords.y;
            window.addEventListener('mousemove', onAimMove);
            window.addEventListener('mouseup', onAimEnd);
            window.addEventListener('touchmove', onAimMove, { passive: false });
            window.addEventListener('touchend', onAimEnd);
        }
    }

    function onAimMove(e) {
        if (!isAiming) return;
        if (e.type === 'touchmove') e.preventDefault();
        const c = getCoords(e);
        mouse.x = c.x;
        mouse.y = c.y;
    }

    function onAimEnd() {
        if (!isAiming || !dragStart) return;

        const drag = Vector.sub(dragStart, mouse);
        const mag = Vector.magnitude(drag);

        if (mag > MIN_DRAG) {
            canShoot = false;
            setInstruction('');
            const power = Math.min(mag / MAX_DRAG, MAX_FORCE);
            const force = Vector.mult(Vector.normalise(drag), power * FORCE_SCALE);
            Body.applyForce(cueBall, cueBall.position, force);
        }

        isAiming = false;
        dragStart = null;
        window.removeEventListener('mousemove', onAimMove);
        window.removeEventListener('mouseup', onAimEnd);
        window.removeEventListener('touchmove', onAimMove);
        window.removeEventListener('touchend', onAimEnd);
    }

    function attachInputListeners() {
        gameCanvas.addEventListener('mousedown', e => onAimStart(getCoords(e)));
        gameCanvas.addEventListener('touchstart', e => {
            e.preventDefault();
            onAimStart(getCoords(e));
        }, { passive: false });
        resetButton.addEventListener('click', init);
    }

    // ═══════════════════════════════════
    //  ENGINE EVENTS
    // ═══════════════════════════════════
    function attachEngineEvents() {
        Events.on(engine, 'afterUpdate', () => {
            const allBodies = [cueBall, ...gameBalls.map(b => b.body)];

            for (const b of allBodies) {
                if (b.speed > MAX_SPEED) {
                    Body.setVelocity(b, Vector.mult(Vector.normalise(b.velocity), MAX_SPEED));
                }
            }

            if (!canShoot) {
                const allSleeping = allBodies.every(b => b.isSleeping);
                if (allSleeping) {
                    canShoot = true;
                    if (gameBalls.length === 0) {
                        setInstruction('You cleared the table!');
                        showFlash('YOU WIN', 0);
                    } else {
                        setInstruction('Your shot.');
                    }
                }
            }
        });

        Events.on(engine, 'collisionStart', event => {
            for (const pair of event.pairs) {
                let ball;
                if (pair.bodyA.label === 'pocket' && pair.bodyA.isSensor) {
                    ball = pair.bodyB;
                } else if (pair.bodyB.label === 'pocket' && pair.bodyB.isSensor) {
                    ball = pair.bodyA;
                }
                if (!ball || ball.isStatic) continue;

                if (ball.label === 'cue') {
                    Body.setPosition(cueBall, { x: CUE_START.x, y: CUE_START.y });
                    Body.setVelocity(cueBall, { x: 0, y: 0 });
                    Body.setAngularVelocity(cueBall, 0);
                    Body.setSleeping(cueBall, false);
                    showFlash('SCRATCH', 2000);
                } else {
                    const i = gameBalls.findIndex(gb => gb.body.id === ball.id);
                    if (i !== -1) {
                        pocketed.push(gameBalls.splice(i, 1)[0]);
                        World.remove(engine.world, ball);
                    }
                }
            }
        });
    }

    // ═══════════════════════════════════
    //  RENDERING
    // ═══════════════════════════════════
    function startRenderLoop() {
        function frame() {
            ctx.clearRect(0, 0, W, H);
            drawAllBalls();
            if (isAiming && dragStart) {
                drawAimLine();
                drawCueStick();
                drawPowerMeter();
            }
            drawPocketedHUD();
            drawFlashMessage();
            animId = requestAnimationFrame(frame);
        }
        animId = requestAnimationFrame(frame);
    }

    // ─── Ball rendering ───
    function drawAllBalls() {
        for (const gb of gameBalls) {
            drawBall(gb.body.position.x, gb.body.position.y, gb.color, gb.num, gb.type);
        }
        drawCueBall(cueBall.position.x, cueBall.position.y);
    }

    function drawCueBall(x, y) {
        ctx.beginPath();
        ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFF0';
        ctx.fill();
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Specular highlight
        const g = ctx.createRadialGradient(x - 2, y - 2, 0, x, y, BALL_R);
        g.addColorStop(0, 'rgba(255,255,255,0.6)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.08)');
        g.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.beginPath();
        ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
    }

    function drawBall(x, y, color, num, type) {
        const r = BALL_R;

        // Base circle
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);

        if (type === 'stripe') {
            // White base
            ctx.fillStyle = '#FFFFF0';
            ctx.fill();
            // Color band across middle
            ctx.save();
            ctx.beginPath();
            ctx.rect(x - r, y - r * 0.5, r * 2, r);
            ctx.clip();
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.restore();
        } else {
            ctx.fillStyle = color;
            ctx.fill();
        }

        // White number circle
        const numR = r * 0.45;
        ctx.beginPath();
        ctx.arc(x, y, numR, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFF0';
        ctx.fill();

        // Number text
        ctx.fillStyle = '#111';
        ctx.font = `bold ${r * 0.7}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(num, x, y + 0.5);

        // Specular highlight
        const g = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.4)');
        g.addColorStop(0.35, 'rgba(255,255,255,0.04)');
        g.addColorStop(1, 'rgba(0,0,0,0.18)');
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();

        // Edge
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
    }

    // ─── Aiming visuals ───
    function drawAimLine() {
        const drag = Vector.sub(dragStart, mouse);
        if (Vector.magnitude(drag) < 1) return;

        const dir = Vector.normalise(drag);
        const end = Vector.add(cueBall.position, Vector.mult(dir, 600));

        // Dotted aim line
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(cueBall.position.x, cueBall.position.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);

        // Ghost ring around cue ball
        ctx.beginPath();
        ctx.arc(cueBall.position.x, cueBall.position.y, BALL_R + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    function drawCueStick() {
        const drag = Vector.sub(dragStart, mouse);
        const mag = Vector.magnitude(drag);
        if (mag < 1) return;

        const dir = Vector.normalise(drag);
        const power = Math.min(mag, MAX_DRAG);
        const tipOffset = BALL_R + 4 + power * 0.5;
        const stickLen = 220;

        const tip = Vector.sub(cueBall.position, Vector.mult(dir, tipOffset));
        const butt = Vector.sub(tip, Vector.mult(dir, stickLen));

        // Shadow
        ctx.beginPath();
        ctx.moveTo(tip.x + 1, tip.y + 1);
        ctx.lineTo(butt.x + 1, butt.y + 1);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Stick body
        const grad = ctx.createLinearGradient(tip.x, tip.y, butt.x, butt.y);
        grad.addColorStop(0, '#F5DEB3');
        grad.addColorStop(0.03, '#DEB887');
        grad.addColorStop(0.5, '#C4956A');
        grad.addColorStop(1, '#8B5E3C');
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(butt.x, butt.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.stroke();

        // Ferrule (silver ring at tip)
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#C0C0C0';
        ctx.fill();

        ctx.lineCap = 'butt';
    }

    function drawPowerMeter() {
        const drag = Vector.sub(dragStart, mouse);
        const mag = Vector.magnitude(drag);
        if (mag < MIN_DRAG) return;

        const power = Math.min(mag / MAX_DRAG, 1);
        const barW = 120;
        const barH = 8;
        const x = W / 2 - barW / 2;
        const y = H - 25;

        // Background
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x - 2, y - 2, barW + 4, barH + 4);

        // Power fill
        const g = ctx.createLinearGradient(x, y, x + barW, y);
        g.addColorStop(0, '#4CAF50');
        g.addColorStop(0.6, '#FFC107');
        g.addColorStop(1, '#F44336');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, barW * power, barH);

        // Border
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 2, y - 2, barW + 4, barH + 4);

        // Label
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(Math.round(power * 100) + '%', W / 2, y - 4);
    }

    // ─── HUD ───
    function drawPocketedHUD() {
        if (pocketed.length === 0) return;

        const startX = 14;
        const y = 14;
        const r = 6;
        const gap = 16;

        // Background strip
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(4, 3, pocketed.length * gap + 12, r * 2 + 10);

        for (let i = 0; i < pocketed.length; i++) {
            const pb = pocketed[i];
            const bx = startX + i * gap;

            ctx.beginPath();
            ctx.arc(bx, y, r, 0, Math.PI * 2);

            if (pb.type === 'stripe') {
                ctx.fillStyle = '#FFFFF0';
                ctx.fill();
                ctx.save();
                ctx.beginPath();
                ctx.rect(bx - r, y - r * 0.45, r * 2, r * 0.9);
                ctx.clip();
                ctx.beginPath();
                ctx.arc(bx, y, r, 0, Math.PI * 2);
                ctx.fillStyle = pb.color;
                ctx.fill();
                ctx.restore();
            } else {
                ctx.fillStyle = pb.color;
                ctx.fill();
            }

            // Mini number
            ctx.beginPath();
            ctx.arc(bx, y, r * 0.42, 0, Math.PI * 2);
            ctx.fillStyle = '#FFFFF0';
            ctx.fill();
            ctx.fillStyle = '#111';
            ctx.font = `bold ${r * 0.75}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(pb.num, bx, y + 0.3);
        }
    }

    function drawFlashMessage() {
        if (!flashMsg) return;

        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = `bold 24px 'Space Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Text shadow
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillText(flashMsg, W / 2 + 1, H / 2 + 1);

        ctx.fillStyle = flashMsg === 'SCRATCH'
            ? '#F44336'
            : '#F5D000';
        ctx.fillText(flashMsg, W / 2, H / 2);
    }

    // ─── Start ───
    init();
});

document.addEventListener('DOMContentLoaded', () => {
    const { Engine, Render, Runner, World, Bodies, Body, Events, Vector } = Matter;

    const gameCanvas = document.getElementById('billiard-table');
    const uiCanvas = document.getElementById('ui-canvas');
    const uiCtx = uiCanvas.getContext('2d');
    const instructionEl = document.getElementById('billiard-instruction');
    const resetButton = document.getElementById('reset-button');

    // --- Constants ---
    const TABLE_WIDTH = 800;
    const TABLE_HEIGHT = 400;
    const BALL_RADIUS = 10;
    const MAX_SPEED = 30;
    const CUE_BALL_HIT_ZONE = BALL_RADIUS * 2.5;
    const MIN_DRAG_THRESHOLD = 5;
    const MAX_DRAG_DISTANCE = 100;
    const FORCE_MULTIPLIER = 0.05;
    const MAX_POWER = 4.0;
    const CUSHION_THICKNESS = 20;
    const POCKET_RADIUS = 18;
    const POCKET_OPENING = POCKET_RADIUS * 3.5;
    const CUE_BALL_START = { x: TABLE_WIDTH * 0.25, y: TABLE_HEIGHT / 2 };
    const RACK_START = { x: TABLE_WIDTH * 0.7, y: TABLE_HEIGHT / 2 };
    const BALL_COLORS = [
        '#FFD700', '#0000FF', '#FF0000', '#800080', '#FFA500',
        '#008000', '#8B4513', '#000000', '#FFD700', '#0000FF',
        '#FF0000', '#800080', '#FFA500', '#008000', '#8B4513'
    ];

    // --- State & Engine ---
    let engine, render, runner;
    let cueBall, balls;
    let isAiming = false, canShoot = true, startDragPos = null;
    const mouse = { x: 0, y: 0 };
    let animFrameId = null;
    let handlersAttached = false;

    function initGame() {
        uiCanvas.width = TABLE_WIDTH;
        uiCanvas.height = TABLE_HEIGHT;

        // Clean up previous instance completely
        if (engine) {
            Events.off(engine);
            Runner.stop(runner);
            Render.stop(render);
            World.clear(engine.world);
            Engine.clear(engine);
        }
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }

        engine = Engine.create({
            gravity: { x: 0, y: 0 },
            positionIterations: 10,
            velocityIterations: 8,
            enableSleeping: true
        });
        render = Render.create({
            canvas: gameCanvas,
            engine: engine,
            options: { width: TABLE_WIDTH, height: TABLE_HEIGHT, wireframes: false, background: '#016A1E' }
        });
        runner = Runner.create();

        createTableAndBalls();
        // Only attach canvas listeners once
        if (!handlersAttached) {
            attachCanvasListeners();
            handlersAttached = true;
        }
        attachEngineEvents();
        startUILoop();

        Render.run(render);
        Runner.run(runner, engine);

        canShoot = true;
        isAiming = false;
        instructionEl.textContent = "Click or tap and drag the cue ball to aim.";
    }

    function createTableAndBalls() {
        const cushionColor = '#A0522D';
        const wallOptions = { isStatic: true, restitution: 0.8, friction: 0.1, render: { fillStyle: cushionColor } };
        World.add(engine.world, [
            Bodies.rectangle(TABLE_WIDTH / 4, -CUSHION_THICKNESS / 2, TABLE_WIDTH / 2 - POCKET_OPENING, CUSHION_THICKNESS, wallOptions),
            Bodies.rectangle(TABLE_WIDTH * 3 / 4, -CUSHION_THICKNESS / 2, TABLE_WIDTH / 2 - POCKET_OPENING, CUSHION_THICKNESS, wallOptions),
            Bodies.rectangle(TABLE_WIDTH / 4, TABLE_HEIGHT + CUSHION_THICKNESS / 2, TABLE_WIDTH / 2 - POCKET_OPENING, CUSHION_THICKNESS, wallOptions),
            Bodies.rectangle(TABLE_WIDTH * 3 / 4, TABLE_HEIGHT + CUSHION_THICKNESS / 2, TABLE_WIDTH / 2 - POCKET_OPENING, CUSHION_THICKNESS, wallOptions),
            Bodies.rectangle(-CUSHION_THICKNESS / 2, TABLE_HEIGHT / 2, CUSHION_THICKNESS, TABLE_HEIGHT - (POCKET_OPENING * 2), wallOptions),
            Bodies.rectangle(TABLE_WIDTH + CUSHION_THICKNESS / 2, TABLE_HEIGHT / 2, CUSHION_THICKNESS, TABLE_HEIGHT - (POCKET_OPENING * 2), wallOptions)
        ]);

        const pocketOptions = { isStatic: true, isSensor: true, render: { fillStyle: '#000000' } };
        World.add(engine.world, [
            Bodies.circle(0, 0, POCKET_RADIUS, pocketOptions),
            Bodies.circle(TABLE_WIDTH / 2, 0, POCKET_RADIUS, pocketOptions),
            Bodies.circle(TABLE_WIDTH, 0, POCKET_RADIUS, pocketOptions),
            Bodies.circle(0, TABLE_HEIGHT, POCKET_RADIUS, pocketOptions),
            Bodies.circle(TABLE_WIDTH / 2, TABLE_HEIGHT, POCKET_RADIUS, pocketOptions),
            Bodies.circle(TABLE_WIDTH, TABLE_HEIGHT, POCKET_RADIUS, pocketOptions)
        ]);

        const ballOptions = { restitution: 0.9, friction: 0.05, frictionAir: 0.015, sleepThreshold: 30 };
        cueBall = Bodies.circle(CUE_BALL_START.x, CUE_BALL_START.y, BALL_RADIUS, {
            ...ballOptions, name: 'cueBall', render: { fillStyle: '#FFFFFF' }
        });
        balls = [cueBall];

        for (let i = 0, ballIndex = 0; i < 5; i++) {
            for (let j = 0; j <= i; j++) {
                const ball = Bodies.circle(
                    RACK_START.x + i * BALL_RADIUS * 1.75,
                    RACK_START.y - (i * BALL_RADIUS) + (j * BALL_RADIUS * 2),
                    BALL_RADIUS,
                    { ...ballOptions, name: 'ball-' + ballIndex, render: { fillStyle: BALL_COLORS[ballIndex] } }
                );
                ballIndex++;
                balls.push(ball);
            }
        }
        World.add(engine.world, balls);
    }

    function getScaledCoordinates(e) {
        const rect = gameCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const scaleX = TABLE_WIDTH / rect.width;
        const scaleY = TABLE_HEIGHT / rect.height;
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }

    function handleAimStart(coords) {
        if (!canShoot) return;
        if (Vector.magnitude(Vector.sub(coords, cueBall.position)) < CUE_BALL_HIT_ZONE) {
            isAiming = true;
            startDragPos = Vector.clone(coords);
            // Initialize mouse to current position so click-release without drag doesn't use stale coords
            mouse.x = coords.x;
            mouse.y = coords.y;
            window.addEventListener('mousemove', handleAimMove);
            window.addEventListener('mouseup', handleAimEnd);
            window.addEventListener('touchmove', handleAimMove, { passive: false });
            window.addEventListener('touchend', handleAimEnd);
        }
    }

    function handleAimMove(e) {
        if (!isAiming) return;
        if (e.type === 'touchmove') e.preventDefault();
        const coords = getScaledCoordinates(e);
        mouse.x = coords.x;
        mouse.y = coords.y;
    }

    function handleAimEnd() {
        if (!isAiming || !startDragPos) return;

        const dragVector = Vector.sub(startDragPos, mouse);
        if (Vector.magnitude(dragVector) > MIN_DRAG_THRESHOLD) {
            canShoot = false;
            instructionEl.textContent = "Shot in progress...";
            const power = Math.min(Vector.magnitude(dragVector) / MAX_DRAG_DISTANCE, MAX_POWER);
            const force = Vector.mult(Vector.normalise(dragVector), power * FORCE_MULTIPLIER);
            Body.applyForce(cueBall, cueBall.position, force);
        }

        isAiming = false;
        startDragPos = null;

        window.removeEventListener('mousemove', handleAimMove);
        window.removeEventListener('mouseup', handleAimEnd);
        window.removeEventListener('touchmove', handleAimMove);
        window.removeEventListener('touchend', handleAimEnd);
    }

    // Canvas listeners - attached once, never duplicated
    function attachCanvasListeners() {
        gameCanvas.addEventListener('mousedown', (e) => handleAimStart(getScaledCoordinates(e)));
        gameCanvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleAimStart(getScaledCoordinates(e));
        }, { passive: false });
        resetButton.addEventListener('click', initGame);
    }

    // Engine events - re-attached per init since engine is recreated
    function attachEngineEvents() {
        Events.on(engine, 'afterUpdate', () => {
            for (const ball of balls) {
                if (ball.speed > MAX_SPEED) {
                    Body.setVelocity(ball, Vector.mult(Vector.normalise(ball.velocity), MAX_SPEED));
                }
            }

            if (canShoot) return;
            const allSleeping = balls.every(b => b.isSleeping);
            if (allSleeping) {
                canShoot = true;
                instructionEl.textContent = "Your shot. Click or tap and drag the cue ball.";
            }
        });

        Events.on(engine, 'collisionStart', (event) => {
            event.pairs.forEach(pair => {
                let pocket, ball;
                if (pair.bodyA.isSensor && !pair.bodyB.isSensor) {
                    pocket = pair.bodyA;
                    ball = pair.bodyB;
                } else if (pair.bodyB.isSensor && !pair.bodyA.isSensor) {
                    pocket = pair.bodyB;
                    ball = pair.bodyA;
                }
                if (ball && !ball.isStatic) {
                    if (ball.name === 'cueBall') {
                        Body.setPosition(cueBall, { x: CUE_BALL_START.x, y: CUE_BALL_START.y });
                        Body.setVelocity(cueBall, { x: 0, y: 0 });
                        Body.setAngularVelocity(cueBall, 0);
                        Body.setSleeping(cueBall, false);
                    } else {
                        World.remove(engine.world, ball);
                        balls = balls.filter(b => b.id !== ball.id);
                    }
                }
            });
        });
    }

    // --- UI rendering loop (decoupled from physics) ---
    function startUILoop() {
        function drawFrame() {
            uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);

            // Ball highlights
            for (const ball of balls) {
                const hx = ball.position.x - 3;
                const hy = ball.position.y - 3;
                const gradient = uiCtx.createRadialGradient(hx, hy, 0, hx, hy, BALL_RADIUS * 0.8);
                gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
                gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                uiCtx.fillStyle = gradient;
                uiCtx.beginPath();
                uiCtx.arc(hx, hy, BALL_RADIUS * 0.8, 0, 2 * Math.PI);
                uiCtx.fill();
            }

            if (isAiming && startDragPos) {
                drawCueAndAimLine();
            }

            animFrameId = requestAnimationFrame(drawFrame);
        }
        animFrameId = requestAnimationFrame(drawFrame);
    }

    function drawCueAndAimLine() {
        const dragVector = Vector.sub(startDragPos, mouse);
        if (Vector.magnitude(dragVector) < 1) return;

        const power = Math.min(Vector.magnitude(dragVector), MAX_DRAG_DISTANCE);
        const direction = Vector.normalise(dragVector);
        const aimLineEnd = Vector.add(cueBall.position, Vector.mult(direction, 500));
        const stickStart = Vector.sub(cueBall.position, Vector.mult(direction, 15 + power * 0.3));
        const stickEnd = Vector.sub(stickStart, Vector.mult(direction, 200));

        // Aim line
        uiCtx.beginPath();
        uiCtx.moveTo(cueBall.position.x, cueBall.position.y);
        uiCtx.lineTo(aimLineEnd.x, aimLineEnd.y);
        uiCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        uiCtx.lineWidth = 1;
        uiCtx.stroke();

        // Cue stick
        const stickGradient = uiCtx.createLinearGradient(stickStart.x, stickStart.y, stickEnd.x, stickEnd.y);
        stickGradient.addColorStop(0, '#D2B48C');
        stickGradient.addColorStop(1, '#8B4513');
        uiCtx.beginPath();
        uiCtx.moveTo(stickStart.x, stickStart.y);
        uiCtx.lineTo(stickEnd.x, stickEnd.y);
        uiCtx.strokeStyle = stickGradient;
        uiCtx.lineWidth = 4;
        uiCtx.stroke();

        // Cue tip
        uiCtx.beginPath();
        uiCtx.arc(stickStart.x, stickStart.y, 2, 0, 2 * Math.PI);
        uiCtx.fillStyle = '#444444';
        uiCtx.fill();
    }

    // --- Start ---
    initGame();
});

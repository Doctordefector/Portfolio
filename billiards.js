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
    
    // --- State & Engine ---
    let engine, render, runner;
    let cueBall, balls;
    let isAiming = false, canShoot = true, startDragPos = null;
    const mouse = { x: 0, y: 0 };

    function initGame() {
        uiCanvas.width = TABLE_WIDTH;
        uiCanvas.height = TABLE_HEIGHT;

        if (engine) {
            Runner.stop(runner);
            Render.stop(render);
            World.clear(engine.world);
            Engine.clear(engine);
        }

        engine = Engine.create({ gravity: { x: 0, y: 0 }, positionIterations: 10, velocityIterations: 8, enableSleeping: true });
        render = Render.create({ canvas: gameCanvas, engine: engine, options: { width: TABLE_WIDTH, height: TABLE_HEIGHT, wireframes: false, background: '#016A1E' } });
        runner = Runner.create();
        
        createTableAndBalls();
        setupEventHandlersAndLoop();
        
        Render.run(render);
        Runner.run(runner, engine);
        
        canShoot = true; isAiming = false;
        instructionEl.textContent = "Click or tap and drag the cue ball to aim.";
    }
    
    function createTableAndBalls() {
        const CUSHION_THICKNESS = 20, POCKET_RADIUS = 18, POCKET_OPENING = POCKET_RADIUS * 3.5;
        const cushionColor = '#A0522D';
        const wallOptions = { isStatic: true, restitution: 0.8, friction: 0.1, render: { fillStyle: cushionColor } };
        World.add(engine.world, [
            Bodies.rectangle(TABLE_WIDTH / 4, -CUSHION_THICKNESS / 2, TABLE_WIDTH / 2 - POCKET_OPENING, CUSHION_THICKNESS, wallOptions), Bodies.rectangle(TABLE_WIDTH * 3 / 4, -CUSHION_THICKNESS / 2, TABLE_WIDTH / 2 - POCKET_OPENING, CUSHION_THICKNESS, wallOptions),
            Bodies.rectangle(TABLE_WIDTH / 4, TABLE_HEIGHT + CUSHION_THICKNESS / 2, TABLE_WIDTH / 2 - POCKET_OPENING, CUSHION_THICKNESS, wallOptions), Bodies.rectangle(TABLE_WIDTH * 3 / 4, TABLE_HEIGHT + CUSHION_THICKNESS / 2, TABLE_WIDTH / 2 - POCKET_OPENING, CUSHION_THICKNESS, wallOptions),
            Bodies.rectangle(-CUSHION_THICKNESS / 2, TABLE_HEIGHT / 2, CUSHION_THICKNESS, TABLE_HEIGHT - (POCKET_OPENING * 2), wallOptions), Bodies.rectangle(TABLE_WIDTH + CUSHION_THICKNESS / 2, TABLE_HEIGHT / 2, CUSHION_THICKNESS, TABLE_HEIGHT - (POCKET_OPENING * 2), wallOptions)
        ]);
        const pocketOptions = { isStatic: true, isSensor: true, render: { fillStyle: '#000000' } };
        World.add(engine.world, [ Bodies.circle(0, 0, POCKET_RADIUS, pocketOptions), Bodies.circle(TABLE_WIDTH / 2, 0, POCKET_RADIUS, pocketOptions), Bodies.circle(TABLE_WIDTH, 0, POCKET_RADIUS, pocketOptions), Bodies.circle(0, TABLE_HEIGHT, POCKET_RADIUS, pocketOptions), Bodies.circle(TABLE_WIDTH / 2, TABLE_HEIGHT, POCKET_RADIUS, pocketOptions), Bodies.circle(TABLE_WIDTH, TABLE_HEIGHT, POCKET_RADIUS, pocketOptions) ]);
        const ballOptions = { restitution: 0.9, friction: 0.05, frictionAir: 0.015, sleepingThreshold: 12 };
        cueBall = Bodies.circle(TABLE_WIDTH * 0.25, TABLE_HEIGHT / 2, BALL_RADIUS, { ...ballOptions, name: 'cueBall', render: { fillStyle: '#FFFFFF' } });
        balls = [cueBall];
        const ballColors = ['#FFD700', '#0000FF', '#FF0000', '#800080', '#FFA500', '#008000', '#8B4513', '#000000', '#FFD700', '#0000FF', '#FF0000', '#800080', '#FFA500', '#008000', '#8B4513'];
        const rackStartX = TABLE_WIDTH * 0.7, rackStartY = TABLE_HEIGHT / 2;
        for (let i = 0, ballIndex = 0; i < 5; i++) {
            for (let j = 0; j <= i; j++) {
                const ballName = 'ball-' + ballIndex++;
                const ball = Bodies.circle(rackStartX + i * BALL_RADIUS * 1.75, rackStartY - (i * BALL_RADIUS) + (j * BALL_RADIUS * 2), BALL_RADIUS, { ...ballOptions, name: ballName, render: { fillStyle: ballColors[ballIndex-1] } });
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

    // --- UPDATED: Event handlers are now split to attach/detach from the window ---
    function handleAimStart(coords) {
        if (!canShoot) return;
        if (Vector.magnitude(Vector.sub(coords, cueBall.position)) < BALL_RADIUS * 2.5) {
            isAiming = true;
            startDragPos = Vector.clone(coords);
            // Attach move and end listeners to the whole window
            window.addEventListener('mousemove', handleAimMove);
            window.addEventListener('mouseup', handleAimEnd);
            window.addEventListener('touchmove', handleAimMove, { passive: false });
            window.addEventListener('touchend', handleAimEnd);
        }
    }

    function handleAimMove(e) {
        if (!isAiming) return;
        if(e.type === 'touchmove') e.preventDefault(); // Prevent scrolling
        const coords = getScaledCoordinates(e);
        mouse.x = coords.x;
        mouse.y = coords.y;
    }

    function handleAimEnd() {
        if (!isAiming || !startDragPos) return;
        
        const dragVector = Vector.sub(startDragPos, mouse);
        if (Vector.magnitude(dragVector) > 5) {
            canShoot = false;
            instructionEl.textContent = "Shot in progress...";
            let power = Vector.magnitude(dragVector) / 100;
            power = Math.min(power, 4.0);
            const force = Vector.mult(Vector.normalise(dragVector), power * 0.05);
            Body.applyForce(cueBall, cueBall.position, force);
        }
        
        isAiming = false;
        startDragPos = null;
        
        // IMPORTANT: Clean up the window listeners
        window.removeEventListener('mousemove', handleAimMove);
        window.removeEventListener('mouseup', handleAimEnd);
        window.removeEventListener('touchmove', handleAimMove);
        window.removeEventListener('touchend', handleAimEnd);
    }
    
    function setupEventHandlersAndLoop() {
        // Listen for the AIM START only on the canvas
        gameCanvas.addEventListener('mousedown', (e) => handleAimStart(getScaledCoordinates(e)));
        gameCanvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleAimStart(getScaledCoordinates(e));
        }, { passive: false });

        Events.on(engine, 'afterUpdate', () => {
            uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
            for (const ball of balls) {
                if (ball.speed > MAX_SPEED) Body.setVelocity(ball, Vector.mult(Vector.normalise(ball.velocity), MAX_SPEED));
                const highlightPos = { x: ball.position.x - 3, y: ball.position.y - 3 };
                const gradient = uiCtx.createRadialGradient(highlightPos.x, highlightPos.y, 0, highlightPos.x, highlightPos.y, BALL_RADIUS * 0.8);
                gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
                gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                uiCtx.fillStyle = gradient;
                uiCtx.beginPath();
                uiCtx.arc(highlightPos.x, highlightPos.y, BALL_RADIUS * 0.8, 0, 2 * Math.PI);
                uiCtx.fill();
            }

            if (isAiming && startDragPos) { drawCueAndAimLine(); }
            
            if (canShoot) return;
            let allBallsSleeping = balls.every(b => b.isSleeping);
            if (allBallsSleeping) {
                canShoot = true;
                instructionEl.textContent = "Your shot. Click or tap and drag the cue ball.";
            }
        });
        
        Events.on(engine, 'collisionStart', (event) => {
            event.pairs.forEach(pair => {
                let ball;
                if (pair.bodyA.isSensor) { ball = pair.bodyB; }
                if (pair.bodyB.isSensor) { ball = pair.bodyA; }
                if (ball && !ball.isStatic) {
                    if (ball.name === 'cueBall') {
                        Body.setPosition(cueBall, { x: TABLE_WIDTH * 0.25, y: TABLE_HEIGHT / 2 });
                        Body.setVelocity(cueBall, { x: 0, y: 0 });
                        Body.setSleeping(cueBall, false);
                    } else {
                        World.remove(engine.world, ball);
                        balls = balls.filter(b => b.id !== ball.id);
                    }
                }
            });
        });
        resetButton.addEventListener('click', initGame);
    }
    
    // --- Start ---
    initGame();
    
    function drawCueAndAimLine() {
        const dragVector = Vector.sub(startDragPos, mouse);
        if (Vector.magnitude(dragVector) < 1) return;
        const power = Math.min(Vector.magnitude(dragVector), 100);
        const aimLineEnd = Vector.add(cueBall.position, Vector.mult(Vector.normalise(dragVector), 500));
        const stickStart = Vector.sub(cueBall.position, Vector.mult(Vector.normalise(dragVector), 15 + power * 0.3));
        const stickEnd = Vector.sub(stickStart, Vector.mult(Vector.normalise(dragVector), 200));
        uiCtx.beginPath();
        uiCtx.moveTo(cueBall.position.x, cueBall.position.y);
        uiCtx.lineTo(aimLineEnd.x, aimLineEnd.y);
        uiCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        uiCtx.lineWidth = 1;
        uiCtx.stroke();
        const stickGradient = uiCtx.createLinearGradient(stickStart.x, stickStart.y, stickEnd.x, stickEnd.y);
        stickGradient.addColorStop(0, '#D2B48C');
        stickGradient.addColorStop(1, '#8B4513');
        uiCtx.beginPath();
        uiCtx.moveTo(stickStart.x, stickStart.y);
        uiCtx.lineTo(stickEnd.x, stickEnd.y);
        uiCtx.strokeStyle = stickGradient;
        uiCtx.lineWidth = 4;
        uiCtx.stroke();
        uiCtx.beginPath();
        uiCtx.arc(stickStart.x, stickStart.y, 2, 0, 2 * Math.PI);
        uiCtx.fillStyle = '#444444';
        uiCtx.fill();
    }
});
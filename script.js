document.addEventListener('DOMContentLoaded', () => {

    // --- Preloader Language Cycler ---
    const greetings = [
        "Hello!", "Привет!", "Γειά σου!", "Привіт!", "Bonjour!", "你好!", "Hallo!"
    ];
    let greetingIndex = 0;
    const preloader = document.getElementById('preloader');
    const helloElement = document.getElementById('language-hello');
    const mainContent = document.getElementById('main-content');
    
    // Speed increased by ~30% from 1200ms
    const GREETING_DURATION = 850; 
    
    let preloaderTimeout; // To hold the timeout for the next greeting
    let isPreloaderActive = true; // Flag to prevent multiple triggers

    // Function to cleanly end the preloader and start the main site
    function endPreloader() {
        // Only run if the preloader is currently active
        if (!isPreloaderActive) return; 
        isPreloaderActive = false;

        // Stop the greeting loop from continuing
        clearTimeout(preloaderTimeout);

        if (preloader) {
            preloader.classList.add('fade-out');
            // Remove the click listener once it's used
            preloader.removeEventListener('click', endPreloader);
        }
        if (mainContent) {
            mainContent.classList.add('loaded');
        }
        
        initializeMainContentScripts();
    }

    // Function to cycle through greetings
    function showNextGreeting() {
        // If we've shown all greetings, end the preloader
        if (greetingIndex >= greetings.length) {
            endPreloader();
            return; // Stop the sequence
        }

        // Display the current greeting
        helloElement.textContent = greetings[greetingIndex];
        helloElement.style.opacity = '1';

        // Set a timeout to fade out the greeting before showing the next one
        setTimeout(() => {
            helloElement.style.opacity = '0';
        }, GREETING_DURATION - 400); // Start fading out 400ms before the end

        greetingIndex++;

        // Schedule the next greeting
        preloaderTimeout = setTimeout(showNextGreeting, GREETING_DURATION);
    }

    // Add the event listener to allow skipping
    if (preloader) {
        preloader.addEventListener('click', endPreloader);
    }

    // Start the greeting sequence
    showNextGreeting();


    function initializeMainContentScripts() {
        // --- Text Scramble Effect ---
        class TextScramble {
            constructor(el) {
                this.el = el;
                this.chars = '!<>-_\\/[]{}—=+*^?#________';
                this.update = this.update.bind(this);
            }
            setText(newText) {
                const oldText = this.el.innerText;
                const length = Math.max(oldText.length, newText.length);
                const promise = new Promise((resolve) => this.resolve = resolve);
                this.queue = [];
                for (let i = 0; i < length; i++) {
                    const from = oldText[i] || '';
                    const to = newText[i] || '';
                    const start = Math.floor(Math.random() * 40);
                    const end = start + Math.floor(Math.random() * 40);
                    this.queue.push({ from, to, start, end });
                }
                cancelAnimationFrame(this.frameRequest);
                this.frame = 0;
                this.update();
                return promise;
            }
            update() {
                let output = '';
                let complete = 0;
                for (let i = 0, n = this.queue.length; i < n; i++) {
                    let { from, to, start, end, char } = this.queue[i];
                    if (this.frame >= end) {
                        complete++;
                        output += to;
                    } else if (this.frame >= start) {
                        if (!char || Math.random() < 0.28) {
                            char = this.randomChar();
                            this.queue[i].char = char;
                        }
                        output += `<span class="dud">${char}</span>`;
                    } else {
                        output += from;
                    }
                }
                this.el.innerHTML = output;
                if (complete === this.queue.length) {
                    this.resolve();
                } else {
                    this.frameRequest = requestAnimationFrame(this.update);
                    this.frame++;
                }
            }
            randomChar() {
                return this.chars[Math.floor(Math.random() * this.chars.length)];
            }
        }
        const heroHeading = document.querySelector('.scramble-text');
        if (heroHeading) {
            const fx = new TextScramble(heroHeading);
            const originalText = heroHeading.textContent;
            setTimeout(() => {
                fx.setText(originalText);
            }, 500);
        }

        // --- Intersection Observer for All Fade-in Elements ---
        const fadeInElements = document.querySelectorAll('.fade-in');
        const observerOptions = {
            root: null,
            rootMargin: '0px',
            threshold: 0.1
        };
        const fadeInObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    // Unobserve to prevent re-triggering the animation
                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);
        fadeInElements.forEach(el => fadeInObserver.observe(el));

        // --- Keypad Logic ---
        const keypad = document.getElementById('keypad-container');
        if (keypad) {
            const display = document.getElementById('keypad-display');
            const buttons = document.querySelectorAll('.keypad-btn');
            const clearBtn = document.getElementById('keypad-clear');
            const backspaceBtn = document.getElementById('keypad-backspace');
            const CORRECT_CODE = '1968';
            let currentInput = '';

            const updateDisplay = () => {
                display.textContent = currentInput;
            };

            const checkCode = () => {
                if (currentInput === CORRECT_CODE) {
                    window.location.href = 'secret.html'; // <-- UPDATED LINE
                }
                // Reset if incorrect and length is 4 or more
                if (currentInput.length >= 4 && currentInput !== CORRECT_CODE) {
                    setTimeout(() => {
                        currentInput = '';
                        updateDisplay();
                    }, 300); // Small delay to show the wrong digit before clearing
                }
            };

            buttons.forEach(button => {
                // Exclude special action buttons from the main digit logic
                if (button.id === 'keypad-clear' || button.id === 'keypad-backspace') return;

                button.addEventListener('click', () => {
                    if (currentInput.length < 4) {
                       currentInput += button.textContent;
                        updateDisplay();
                        checkCode(); 
                    }
                });
            });

            clearBtn.addEventListener('click', () => {
                currentInput = '';
                updateDisplay();
            });

            backspaceBtn.addEventListener('click', () => {
                currentInput = currentInput.slice(0, -1);
                updateDisplay();
            });
        }

        // --- Audio Visualizer (Web Audio API) ---
        initAudioVisualizer();
    }

    function initAudioVisualizer() {
        const equalizer = document.getElementById('equalizer');
        const playBtn = document.getElementById('eq-play');
        const trackName = document.getElementById('eq-track-name');
        const audio = document.getElementById('eq-audio');
        if (!equalizer || !playBtn || !audio) return;

        const bars = equalizer.querySelectorAll('.eq-bar');
        let audioCtx = null;
        let analyser = null;
        let source = null;
        let animId = null;
        let isPlaying = false;

        // Try common filenames — user drops one of these in root
        const TRACKS = ['music.mp3', 'music.wav', 'music.ogg', 'music.m4a', 'music.flac'];

        function stopAnim() {
            if (animId) { cancelAnimationFrame(animId); animId = null; }
            // Reset bars to idle using CSS animation
            bars.forEach(b => b.style.height = '');
        }

        function updateBars() {
            if (!analyser) return;
            const freqData = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(freqData);
            // Map bars across frequency range, picking representative bins
            const step = Math.floor(freqData.length / bars.length);
            for (let i = 0; i < bars.length; i++) {
                const val = freqData[i * step] / 255; // 0..1
                // Scale: min 8%, max 100%
                const h = 8 + val * 92;
                bars[i].style.height = h + '%';
            }
            animId = requestAnimationFrame(updateBars);
        }

        async function initAudioContext() {
            if (audioCtx) return; // already initialized
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 256;
                analyser.smoothingTimeConstant = 0.7;
                source = audioCtx.createMediaElementSource(audio);
                source.connect(analyser);
                analyser.connect(audioCtx.destination);
            } catch (e) {
                console.warn('Audio visualizer: Web Audio API not available', e);
            }
        }

        async function tryLoadTrack() {
            for (const t of TRACKS) {
                try {
                    const resp = await fetch(t, { method: 'HEAD' });
                    if (resp.ok) {
                        audio.src = t;
                        audio.load();
                        trackName.textContent = t;
                        return true;
                    }
                } catch (_) { /* try next */ }
            }
            return false;
        }

        async function togglePlay() {
            if (!audioCtx) await initAudioContext();
            if (!audioCtx || !analyser) return;

            if (isPlaying) {
                audio.pause();
                stopAnim();
                bars.forEach(b => b.style.height = '');
                playBtn.textContent = '▶';
                playBtn.classList.remove('playing');
                isPlaying = false;
                return;
            }

            // If no source loaded yet, try to find a track
            if (!audio.src || audio.src === window.location.href) {
                const found = await tryLoadTrack();
                if (!found) {
                    trackName.textContent = 'drop music.mp3 in root folder';
                    setTimeout(() => { if (!isPlaying) trackName.textContent = ''; }, 3000);
                    return;
                }
            }

            try {
                if (audioCtx.state === 'suspended') await audioCtx.resume();
                await audio.play();
                stopAnim();
                updateBars();
                playBtn.textContent = '⏸';
                playBtn.classList.add('playing');
                isPlaying = true;
            } catch (e) {
                console.warn('Audio play failed:', e);
                trackName.textContent = 'click to start playback';
            }
        }

        playBtn.addEventListener('click', togglePlay);

        // Stop visualizer when audio ends
        audio.addEventListener('ended', () => {
            stopAnim();
            bars.forEach(b => b.style.height = '');
            playBtn.textContent = '▶';
            playBtn.classList.remove('playing');
            isPlaying = false;
        });

        // Auto-detect track on load
        tryLoadTrack().then(found => {
            if (found) trackName.textContent = audio.src.split('/').pop();
        });
    }
});
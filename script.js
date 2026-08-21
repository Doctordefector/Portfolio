document.addEventListener('DOMContentLoaded', () => {

    // --- Preloader Language Cycler ---
    // ponytail: cut from 7 greetings (~6s) to 3 (~2.5s) — visitors bounce on long preloaders
    const greetings = [
        "Hello!", "Привет!", "Γειά σου!"
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

        // --- Inception: recursive site-within-site (Droste effect) ---
        // Each level is a detailed mini-portfolio (hero, skills, work cards, viz,
        // footer) with the next copy nested INLINE mid-page — length comes from
        // real content, not padding, so it reads as a true page-within-a-page.
        const inception = document.getElementById('inception');
        if (inception) {
            const DEPTH = 3;            // ponytail: depth as one knob — deeper levels render sub-60px, invisible
            const label = '<div class="inception-label"></div>';
            const para  = '<div class="inception-bar"></div><div class="inception-bar short"></div><div class="inception-bar"></div>';
            const rule  = '<div class="inception-rule"></div>';
            const cards = '<div class="inception-row">' + '<div class="inception-cardlet"></div>'.repeat(3) + '</div>';
            // %NEST% = where this page embeds the smaller copy of itself
            const page = '<div class="inception-nav">' + '<span></span>'.repeat(5) + '</div>' +
                '<div class="inception-hero">Andrei Chapliuk</div>' +
                '<div class="inception-bar shorter"></div>' +
                label + para + rule + label + cards + rule + label + cards + rule +
                '%NEST%' + rule + label + para + '<div class="inception-foot"></div>';
            let html = '';             // innermost first, then wrap outward
            for (let i = 0; i < DEPTH; i++) {
                html = '<div class="inception-frame"><div class="inception-site">' + page.replace('%NEST%', html) + '</div></div>';
            }
            inception.innerHTML = html;
        }

    }

});

const Splash = {
    screen: null,
    proceedBtn: null,
    starsContainer: null,
    onComplete: null,

    init(onComplete) {
        this.screen = document.getElementById("splash-screen");
        this.proceedBtn = document.getElementById("btn-proceed");
        this.starsContainer = document.getElementById("stars-container");
        this.onComplete = onComplete;

        this.generateParticles();
        this.bindEvents();
    },

    generateParticles() {
        if (!this.starsContainer) return;
        const count = 40;
        for (let i = 0; i < count; i++) {
            const star = document.createElement("div");
            star.className = "star";
            
            // Random styling for floating gold particles
            const size = Math.random() * 3 + 1;
            const left = Math.random() * 100;
            const top = Math.random() * 100;
            const delay = Math.random() * 5;
            const duration = Math.random() * 4 + 4;

            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${left}%`;
            star.style.top = `${top}%`;
            star.style.animationDelay = `${delay}s`;
            star.style.animationDuration = `${duration}s`;

            this.starsContainer.appendChild(star);
        }
    },

    bindEvents() {
        const proceed = () => {
            // Fade out splash screen
            this.screen.style.opacity = "0";
            this.screen.style.transform = "scale(1.05)";
            this.screen.style.pointerEvents = "none";
            
            setTimeout(() => {
                this.screen.classList.add("hidden");
                if (this.onComplete) this.onComplete();
            }, 500);
        };

        this.proceedBtn.addEventListener("click", proceed);
        this.proceedBtn.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                proceed();
            }
        });
        this.screen.addEventListener("click", (e) => {
            // Allow clicking anywhere to skip
            if (e.target !== this.proceedBtn && !this.proceedBtn.contains(e.target)) {
                proceed();
            }
        });
    }
};

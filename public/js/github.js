const GitHubController = {
    isAuthenticated: false,
    user: null,
    scopes: [],

    init() {
        this.bindEvents();
        this.checkAuthState();
    },

    async checkAuthState() {
        try {
            const response = await API.getGitHubProfile();
            if (response.success && response.authenticated) {
                this.isAuthenticated = true;
                this.user = response.user;
                this.scopes = response.scopes;
            } else {
                this.isAuthenticated = false;
                this.user = null;
                this.scopes = [];
            }
            this.updateHeaderBadge();
        } catch (error) {
            console.error("Error checking GitHub auth state:", error);
        }
    },

    bindEvents() {
        // Header button click
        const headerBtn = document.getElementById("btn-github-header");
        if (headerBtn) {
            headerBtn.addEventListener("click", () => {
                this.openModal();
            });
        }

        // Modal close button
        const closeModalBtn = document.getElementById("btn-close-github-modal");
        if (closeModalBtn) {
            closeModalBtn.addEventListener("click", () => {
                this.closeModal();
            });
        }

        // Modal cancel button
        const cancelModalBtn = document.getElementById("btn-cancel-github");
        if (cancelModalBtn) {
            cancelModalBtn.addEventListener("click", () => {
                this.closeModal();
            });
        }

        // Form Submit Sign In
        const submitBtn = document.getElementById("btn-submit-github");
        if (submitBtn) {
            submitBtn.addEventListener("click", () => {
                this.handleSignIn();
            });
        }

        // Sign out button
        const signOutBtn = document.getElementById("btn-signout-github");
        if (signOutBtn) {
            signOutBtn.addEventListener("click", () => {
                this.handleSignOut();
            });
        }

        // Password visibility toggle
        const toggleBtn = document.getElementById("btn-toggle-token-visibility");
        if (toggleBtn) {
            toggleBtn.addEventListener("click", () => {
                const tokenInput = document.getElementById("github-token-input");
                if (tokenInput.type === "password") {
                    tokenInput.type = "text";
                    toggleBtn.innerHTML = `
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                        </svg>
                    `;
                } else {
                    tokenInput.type = "password";
                    toggleBtn.innerHTML = `
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.51-1.26 2.7-2.89 3.44-4.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.01-.17c0-1.66-1.34-3-3-3l-.16.02z"/>
                        </svg>
                    `;
                }
            });
        }
    }

    openModal() {
        const modal = document.getElementById("github-modal");
        if (!modal) return;

        const loginPanel = document.getElementById("github-login-panel");
        const profilePanel = document.getElementById("github-profile-panel");
        const errorMsg = document.getElementById("github-auth-error");

        if (errorMsg) {
            errorMsg.classList.add("hidden");
            errorMsg.textContent = "";
        }

        if (this.isAuthenticated) {
            loginPanel.classList.add("hidden");
            profilePanel.classList.remove("hidden");
            this.renderProfile();
        } else {
            loginPanel.classList.remove("hidden");
            profilePanel.classList.add("hidden");
            // Clear inputs
            document.getElementById("github-token-input").value = "";
            document.getElementById("github-remember-checkbox").checked = false;
        }

        modal.classList.remove("hidden");
        // Force reflow for scale transitions
        modal.offsetHeight;
        modal.classList.add("active");
    },

    closeModal() {
        const modal = document.getElementById("github-modal");
        if (modal) {
            modal.classList.remove("active");
            setTimeout(() => {
                modal.classList.add("hidden");
            }, 300);
        }
    },

    async handleSignIn() {
        const tokenInput = document.getElementById("github-token-input");
        const rememberCheckbox = document.getElementById("github-remember-checkbox");
        const errorMsg = document.getElementById("github-auth-error");
        const loader = document.getElementById("github-auth-loader");
        const submitBtn = document.getElementById("btn-submit-github");

        const token = tokenInput.value.trim();
        const rememberMe = rememberCheckbox.checked;

        if (!token) {
            errorMsg.textContent = "Please enter your Personal Access Token.";
            errorMsg.classList.remove("hidden");
            return;
        }

        errorMsg.classList.add("hidden");
        loader.classList.remove("hidden");
        submitBtn.disabled = true;

        try {
            const response = await API.gitHubSignIn(token, rememberMe);
            if (response.success && response.authenticated) {
                // If not remembered, store session-only token in client-side storage
                if (!rememberMe) {
                    sessionStorage.setItem("github_token", token);
                } else {
                    sessionStorage.removeItem("github_token");
                }

                this.isAuthenticated = true;
                this.user = response.user;
                this.scopes = response.scopes;

                loader.classList.add("hidden");
                this.triggerCelebration();
                
                setTimeout(() => {
                    this.closeModal();
                    this.updateHeaderBadge();
                    Toast.success(`Authenticated as @${this.user.login}`);
                    // Refresh git remote status check if active repo view is open
                    if (typeof StatusView !== "undefined" && StatusView.repoPath) {
                        StatusView.checkGitHubRemote();
                    }
                }, 1000);
            } else {
                throw new Error(response.error || "Authentication failed");
            }
        } catch (error) {
            loader.classList.add("hidden");
            submitBtn.disabled = false;
            errorMsg.textContent = error.message || "Failed to authenticate with GitHub.";
            errorMsg.classList.remove("hidden");
        }
    },

    async handleSignOut() {
        try {
            await API.gitHubSignOut();
            sessionStorage.removeItem("github_token");
            this.isAuthenticated = false;
            this.user = null;
            this.scopes = [];
            this.closeModal();
            this.updateHeaderBadge();
            Toast.success("GitHub account disconnected.");
            if (typeof StatusView !== "undefined" && StatusView.repoPath) {
                StatusView.checkGitHubRemote();
            }
        } catch (error) {
            console.error("Sign out error:", error);
            Toast.error("Failed to sign out.");
        }
    },

    updateHeaderBadge() {
        const headerBtn = document.getElementById("btn-github-header");
        if (!headerBtn) return;

        if (this.isAuthenticated && this.user) {
            headerBtn.innerHTML = `
                <div class="avatar-badge-wrapper">
                    <img src="${escapeHtml(this.user.avatar_url)}" alt="${escapeHtml(this.user.login)}" class="github-avatar-img">
                    <span class="online-indicator"></span>
                </div>
            `;
            headerBtn.title = `Connected as @${this.user.login}`;
        } else {
            headerBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                </svg>
            `;
            headerBtn.title = "Link GitHub Account";
        }
    },

    renderProfile() {
        if (!this.user) return;
        document.getElementById("profile-avatar").src = this.user.avatar_url;
        document.getElementById("profile-name").textContent = this.user.name || this.user.login;
        document.getElementById("profile-username").textContent = `@${this.user.login}`;
        document.getElementById("profile-bio").textContent = this.user.bio || "Stoic systems tracking.";
        document.getElementById("profile-repos-count").textContent = this.user.public_repos;

        // Render Scope lists
        const repoChecked = this.scopes.includes("repo") ? "✓" : "✗";
        const userChecked = this.scopes.includes("read:user") ? "✓" : "✗";
        
        const scopeContainer = document.getElementById("profile-scopes-list");
        scopeContainer.innerHTML = `
            <div class="scope-item ${this.scopes.includes("repo") ? "active" : "missing"}">
                <span class="scope-check">${repoChecked}</span>
                <span class="scope-label">Repository Control (repo)</span>
            </div>
            <div class="scope-item ${this.scopes.includes("read:user") ? "active" : "missing"}">
                <span class="scope-check">${userChecked}</span>
                <span class="scope-label">Profile Read (read:user)</span>
            </div>
        `;
    },

    triggerCelebration() {
        const canvas = document.createElement("canvas");
        canvas.style.position = "fixed";
        canvas.style.top = "0";
        canvas.style.left = "0";
        canvas.style.width = "100vw";
        canvas.style.height = "100vh";
        canvas.style.pointerEvents = "none";
        canvas.style.zIndex = "2000";
        document.body.appendChild(canvas);

        const ctx = canvas.getContext("2d");
        let width = (canvas.width = window.innerWidth);
        let height = (canvas.height = window.innerHeight);

        const particles = [];
        const colors = ["#FFD700", "#FFE082", "#D4AF37", "#B8860B"];

        for (let i = 0; i < 150; i++) {
            particles.push({
                x: width / 2,
                y: height / 2,
                vx: (Math.random() - 0.5) * 12,
                vy: (Math.random() - 0.5) * 12 - 3,
                radius: Math.random() * 4 + 1.5,
                color: colors[Math.floor(Math.random() * colors.length)],
                alpha: 1.0,
                decay: Math.random() * 0.015 + 0.006
            });
        }

        function animate() {
            ctx.clearRect(0, 0, width, height);
            let alive = false;
            for (let p of particles) {
                if (p.alpha > 0) {
                    alive = true;
                    p.x += p.vx;
                    p.y += p.vy;
                    p.vy += 0.08; // gravity
                    p.alpha -= p.decay;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                    ctx.fillStyle = p.color;
                    ctx.globalAlpha = Math.max(0, p.alpha);
                    ctx.shadowBlur = 6;
                    ctx.shadowColor = p.color;
                    ctx.fill();
                }
            }
            if (alive) {
                requestAnimationFrame(animate);
            } else {
                if (canvas.parentNode) {
                    canvas.parentNode.removeChild(canvas);
                }
            }
        }
        animate();
    }
};

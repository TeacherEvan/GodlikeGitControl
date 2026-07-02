const Scan = {
    panel: null,
    backBtn: null,
    pathInput: null,
    startBtn: null,
    loader: null,
    resultsSection: null,
    repoCount: null,
    repoList: null,

    init() {
        this.panel = document.getElementById("scan-view");
        this.backBtn = document.getElementById("btn-scan-back");
        this.pathInput = document.getElementById("scan-path-input");
        this.startBtn = document.getElementById("btn-start-scan");
        this.loader = document.getElementById("scan-loader");
        this.resultsSection = document.getElementById("scan-results-section");
        this.repoCount = document.getElementById("repo-count");
        this.repoList = document.getElementById("repo-list");

        // Default scan path to typical user workspace or root directory
        this.pathInput.value = "/home/ewaldt/Documents";

        this.bindEvents();
    },

    show() {
        document.querySelectorAll(".view-panel").forEach(p => {
            p.classList.add("hidden");
            p.classList.remove("active");
        });
        
        this.panel.classList.remove("hidden");
        this.panel.offsetHeight;
        this.panel.classList.add("active");
    },

    bindEvents() {
        this.backBtn.addEventListener("click", () => {
            Dashboard.show();
        });

        this.startBtn.addEventListener("click", () => {
            this.performScan();
        });
    },

    async performScan() {
        const startPath = this.pathInput.value.trim();
        if (!startPath) {
            Toast.error("Please enter a path to scan");
            return;
        }

        // Show loader, hide results
        this.loader.classList.remove("hidden");
        this.resultsSection.classList.add("hidden");
        this.repoList.innerHTML = "";

        try {
            const data = await API.scanSystem(startPath);
            this.loader.classList.add("hidden");
            
            const repos = data.repos || [];
            this.repoCount.textContent = repos.length;
            
            if (repos.length === 0) {
                this.repoList.innerHTML = `<p class="empty-msg">No Git repositories discovered under this path.</p>`;
            } else {
                repos.forEach(repo => {
                    const card = document.createElement("div");
                    card.className = "repo-card clickable";
                    const escapedName = escapeHtml(repo.name);
                    const escapedPath = escapeHtml(repo.path);
                    const escapedBranch = escapeHtml(repo.branch);
                    card.innerHTML = `
                        <div class="repo-info">
                            <h4>${escapedName}</h4>
                            <p>${escapedPath}</p>
                        </div>
                        <span class="badge branch-badge">${escapedBranch}</span>
                    `;
                    card.addEventListener("click", () => {
                        StatusView.openRepository(repo.path);
                    });
                    this.repoList.appendChild(card);
                });
            }
            
            this.resultsSection.classList.remove("hidden");
            Toast.success(`Scan completed. Discovered ${repos.length} repositories.`);
        } catch (error) {
            this.loader.classList.add("hidden");
            Toast.error(`Scan failed: ${error.message}`);
        }
    }
};

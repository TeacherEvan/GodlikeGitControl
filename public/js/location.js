const LocationBrowser = {
    panel: null,
    backBtn: null,
    pathInput: null,
    openBtn: null,
    currentPathLabel: null,
    upBtn: null,
    listContainer: null,
    currentPath: "/home/ewaldt",

    init() {
        this.panel = document.getElementById("location-view");
        this.backBtn = document.getElementById("btn-location-back");
        this.pathInput = document.getElementById("location-path-input");
        this.openBtn = document.getElementById("btn-open-path");
        this.currentPathLabel = document.getElementById("browser-current-path");
        this.upBtn = document.getElementById("btn-browser-up");
        this.listContainer = document.getElementById("browser-list");

        this.pathInput.value = this.currentPath;

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

        this.loadPath(this.currentPath);
    },

    bindEvents() {
        this.backBtn.addEventListener("click", () => {
            Dashboard.show();
        });

        this.openBtn.addEventListener("click", () => {
            const path = this.pathInput.value.trim();
            if (path) {
                StatusView.openRepository(path);
            }
        });

        this.upBtn.addEventListener("click", () => {
            this.navigateUp();
        });
    },

    async loadPath(path) {
        this.listContainer.innerHTML = `<div style="padding:20px; text-align:center;"><div class="spinner" style="margin:0 auto 10px;"></div>Loading files...</div>`;
        
        try {
            const response = await API.browseDirectory(path);
            const data = response.data;
            
            this.currentPath = data.currentPath;
            this.currentPathLabel.textContent = this.currentPath;
            this.pathInput.value = this.currentPath;
            this.listContainer.innerHTML = "";

            const items = data.items || [];
            if (items.length === 0) {
                this.listContainer.innerHTML = `<p class="empty-msg">Directory is empty.</p>`;
                return;
            }

            items.forEach(item => {
                const el = document.createElement("div");
                let classes = "browser-item";
                let icon = "";
                
                if (item.isDir) {
                    if (item.name === ".git") {
                        classes += " git-repo";
                        icon = `<span style="font-size: 14px; margin-right: 4px;">🗂</span>`;
                    } else {
                        classes += " directory";
                        icon = `<span style="font-size: 14px; margin-right: 4px;">📁</span>`;
                    }
                } else {
                    icon = `<span style="font-size: 14px; margin-right: 4px;">📄</span>`;
                }

                el.className = classes;
                
                // Escape item properties to prevent XSS
                const escapedName = escapeHtml(item.name);
                el.innerHTML = `${icon}<span>${escapedName}</span>`;
                
                el.addEventListener("click", () => {
                    if (item.isDir) {
                        if (item.name === ".git") {
                            StatusView.openRepository(this.currentPath);
                        } else {
                            this.loadPath(item.path);
                        }
                    } else {
                        // Click file - toast alert instead of opening repo to avoid confusion (resolves unintuitive click finding)
                        Toast.info(`File: ${escapedName} (Use repository dashboard to stage and track changes)`);
                    }
                });

                this.listContainer.appendChild(el);
            });

        } catch (error) {
            const escapedError = escapeHtml(error.message);
            this.listContainer.innerHTML = `<p class="empty-msg" style="color:var(--color-deleted);">${escapedError}</p>`;
            Toast.error(`Failed to browse directory: ${escapedError}`);
        }
    },

    navigateUp() {
        const parent = this.currentPathLabel.textContent;
        const parts = parent.split("/");
        if (parts.length > 2) {
            parts.pop();
            const parentPath = parts.join("/");
            this.loadPath(parentPath || "/");
        } else if (parts.length === 2 && parts[1] !== "") {
            this.loadPath("/");
        }
    }
};

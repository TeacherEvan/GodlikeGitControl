// HTML Escaping Utility for XSS Prevention
function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return "";
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

const StatusView = {
    panel: null,
    backBtn: null,
    refreshBtn: null,
    repoTitle: null,
    repoPathLabel: null,
    branchBadge: null,
    syncLabel: null,
    
    stagedCount: null,
    stagedList: null,
    unstagedCount: null,
    unstagedList: null,
    untrackedCount: null,
    untrackedList: null,
    
    commitLogsList: null,
    commitPanelBtn: null,
    
    currentRepoPath: "",
    refreshInterval: null,
    isLoading: false,

    init() {
        this.panel = document.getElementById("status-view");
        this.backBtn = document.getElementById("btn-status-back");
        this.refreshBtn = document.getElementById("btn-status-refresh");
        this.repoTitle = document.getElementById("repo-title");
        this.repoPathLabel = document.getElementById("repo-path-display");
        this.branchBadge = document.getElementById("status-branch");
        this.syncLabel = document.getElementById("status-sync");
        
        this.stagedCount = document.getElementById("staged-count");
        this.stagedList = document.getElementById("staged-file-list");
        this.unstagedCount = document.getElementById("unstaged-count");
        this.unstagedList = document.getElementById("unstaged-file-list");
        this.untrackedCount = document.getElementById("untracked-count");
        this.untrackedList = document.getElementById("untracked-file-list");
        
        this.commitLogsList = document.getElementById("commit-logs-list");
        this.commitPanelBtn = document.getElementById("btn-open-commit-panel");

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
        
        this.startAutoRefresh();
    },

    bindEvents() {
        this.backBtn.addEventListener("click", () => {
            this.stopAutoRefresh();
            Dashboard.show();
        });

        this.refreshBtn.addEventListener("click", () => {
            this.refresh();
        });

        this.commitPanelBtn.addEventListener("click", () => {
            CommitPanel.open();
        });
    },

    startAutoRefresh() {
        this.stopAutoRefresh();
        this.refreshInterval = setInterval(() => {
            this.refresh(true);
        }, 10000);
    },

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    },

    async openRepository(path) {
        this.currentRepoPath = path;
        this.repoPathLabel.textContent = path;
        this.repoTitle.textContent = path.split("/").pop() || "Repository";
        
        this.show();
        this.refresh();
    },

    // UI Lock helper (resolves lack of UI lock finding)
    setUILocked(locked) {
        this.isLoading = locked;
        const inputs = this.panel.querySelectorAll("input[type='checkbox'], button");
        inputs.forEach(input => {
            if (locked) {
                input.setAttribute("disabled", "true");
            } else {
                input.removeAttribute("disabled");
            }
        });
        if (locked) {
            this.panel.classList.add("ui-loading");
        } else {
            this.panel.classList.remove("ui-loading");
        }
    },

    async refresh(isSilent = false) {
        if (!this.currentRepoPath || this.isLoading) return;

        if (!isSilent) {
            this.refreshBtn.classList.add("spinning");
            this.refreshBtn.style.transform = "rotate(360deg)";
            this.refreshBtn.style.transition = "transform 0.6s ease";
        }

        this.setUILocked(true);

        try {
            const statusResponse = await API.getStatus(this.currentRepoPath);
            const st = statusResponse.status;

            this.branchBadge.textContent = escapeHtml(st.branch);
            
            const stagedAdded = st.staged.add || [];
            const stagedDeleted = st.staged.delete || [];
            const stagedModified = st.staged.modify || [];
            const totalStaged = stagedAdded.length + stagedDeleted.length + stagedModified.length;
            this.stagedCount.textContent = totalStaged;
            this.renderStagedList(stagedAdded, stagedDeleted, stagedModified);

            const unstaged = st.unstaged || [];
            this.unstagedCount.textContent = unstaged.length;
            this.renderUnstagedList(unstaged);

            const untracked = st.untracked || [];
            this.untrackedCount.textContent = untracked.length;
            this.renderUntrackedList(untracked);

            if (totalStaged > 0) {
                this.commitPanelBtn.removeAttribute("disabled");
                this.commitPanelBtn.style.opacity = "1";
            } else {
                this.commitPanelBtn.setAttribute("disabled", "true");
                this.commitPanelBtn.style.opacity = "0.5";
            }

            await this.loadCommitLog();

            if (!isSilent) {
                Toast.success("Status updated");
            }
        } catch (error) {
            Toast.error(`Failed to load repository: ${error.message}`);
        } finally {
            this.setUILocked(false);
            if (!isSilent) {
                setTimeout(() => {
                    this.refreshBtn.style.transform = "none";
                    this.refreshBtn.style.transition = "none";
                }, 600);
            }
        }
    },

    renderStagedList(added, deleted, modified) {
        this.stagedList.innerHTML = "";
        
        if (added.length === 0 && deleted.length === 0 && modified.length === 0) {
            this.stagedList.innerHTML = `<p class="empty-msg">No files staged for commit.</p>`;
            return;
        }

        const addFileRow = (file, badgeText, badgeClass) => {
            const row = document.createElement("div");
            row.className = "file-item";
            
            // XSS Prevention: Safe HTML composition with escaped values
            const escapedFile = escapeHtml(file);
            const escapedBadgeClass = escapeHtml(badgeClass);
            const escapedBadgeText = escapeHtml(badgeText);
            
            row.innerHTML = `
                <div class="file-item-left">
                    <input type="checkbox" class="file-checkbox staged-checkbox" checked data-file="${escapedFile}">
                    <span class="file-name staged-name" data-file="${escapedFile}">${escapedFile}</span>
                </div>
                <span class="file-badge ${escapedBadgeClass}">${escapedBadgeText}</span>
            `;
            
            const checkbox = row.querySelector(".staged-checkbox");
            checkbox.addEventListener("change", async () => {
                this.setUILocked(true);
                try {
                    await API.unstageFiles(this.currentRepoPath, [file]);
                    this.refresh();
                } catch (e) {
                    Toast.error(`Failed to unstage: ${e.message}`);
                    this.setUILocked(false);
                }
            });

            row.querySelector(".staged-name").addEventListener("click", () => {
                DiffView.showDiff(this.currentRepoPath, file, true);
            });

            this.stagedList.appendChild(row);
        };

        added.forEach(f => addFileRow(f, "A", "badge-s"));
        modified.forEach(f => addFileRow(f, "M", "badge-m"));
        deleted.forEach(f => addFileRow(f, "D", "badge-u"));
    },

    renderUnstagedList(unstaged) {
        this.unstagedList.innerHTML = "";

        if (unstaged.length === 0) {
            this.unstagedList.innerHTML = `<p class="empty-msg">No unstaged modifications.</p>`;
            return;
        }

        unstaged.forEach(file => {
            const row = document.createElement("div");
            row.className = "file-item";
            
            const escapedFile = escapeHtml(file);
            row.innerHTML = `
                <div class="file-item-left">
                    <input type="checkbox" class="file-checkbox unstaged-checkbox" data-file="${escapedFile}">
                    <span class="file-name unstaged-name" data-file="${escapedFile}">${escapedFile}</span>
                </div>
                <span class="file-badge badge-m">M</span>
            `;

            const checkbox = row.querySelector(".unstaged-checkbox");
            checkbox.addEventListener("change", async () => {
                this.setUILocked(true);
                try {
                    await API.stageFiles(this.currentRepoPath, [file]);
                    this.refresh();
                } catch (e) {
                    Toast.error(`Failed to stage: ${e.message}`);
                    this.setUILocked(false);
                }
            });

            row.querySelector(".unstaged-name").addEventListener("click", () => {
                DiffView.showDiff(this.currentRepoPath, file, false);
            });

            this.unstagedList.appendChild(row);
        });
    },

    renderUntrackedList(untracked) {
        this.untrackedList.innerHTML = "";

        if (untracked.length === 0) {
            this.untrackedList.innerHTML = `<p class="empty-msg">No untracked files.</p>`;
            return;
        }

        untracked.forEach(file => {
            const row = document.createElement("div");
            row.className = "file-item";
            
            const escapedFile = escapeHtml(file);
            row.innerHTML = `
                <div class="file-item-left">
                    <input type="checkbox" class="file-checkbox untracked-checkbox" data-file="${escapedFile}">
                    <span class="file-name untracked-name" data-file="${escapedFile}">${escapedFile}</span>
                </div>
                <span class="file-badge badge-u">U</span>
            `;

            const checkbox = row.querySelector(".untracked-checkbox");
            checkbox.addEventListener("change", async () => {
                this.setUILocked(true);
                try {
                    await API.stageFiles(this.currentRepoPath, [file]);
                    this.refresh();
                } catch (e) {
                    Toast.error(`Failed to stage: ${e.message}`);
                    this.setUILocked(false);
                }
            });

            row.querySelector(".untracked-name").addEventListener("click", () => {
                DiffView.showDiff(this.currentRepoPath, file, false);
            });

            this.untrackedList.appendChild(row);
        });
    },

    async loadCommitLog() {
        this.commitLogsList.innerHTML = "";
        try {
            const data = await API.getLog(this.currentRepoPath);
            const commits = data.commits || [];
            
            if (commits.length === 0) {
                this.commitLogsList.innerHTML = `<p class="empty-msg">No commits recorded yet.</p>`;
                return;
            }

            commits.forEach(c => {
                const item = document.createElement("div");
                item.className = "commit-log-item";
                
                const timeStr = new Date(c.time * 1000).toLocaleString();
                const shortSha = c.id.substring(0, 7);

                // Sanitizing commit properties to prevent Stored XSS
                const escapedSha = escapeHtml(shortSha);
                const escapedTime = escapeHtml(timeStr);
                const escapedMessage = escapeHtml(c.message);

                item.innerHTML = `
                    <div class="commit-log-meta">
                        <span class="commit-sha">${escapedSha}</span>
                        <span>${escapedTime}</span>
                    </div>
                    <div class="commit-message">${escapedMessage}</div>
                `;
                this.commitLogsList.appendChild(item);
            });

        } catch (e) {
            this.commitLogsList.innerHTML = `<p class="empty-msg">Error loading commits: ${e.message}</p>`;
        }
    }
};

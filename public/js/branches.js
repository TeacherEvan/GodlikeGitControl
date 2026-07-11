// Branch Manager + Commit History controllers
const BranchesView = {
    panel: null,
    listEl: null,
    countEl: null,
    activeBadge: null,
    createInput: null,
    createBtn: null,
    currentRepoPath: "",

    init() {
        this.panel = document.getElementById("branches-view");
        this.listEl = document.getElementById("branch-list");
        this.countEl = document.getElementById("branch-count");
        this.activeBadge = document.getElementById("branches-active-badge");
        this.createInput = document.getElementById("branch-create-input");
        this.createBtn = document.getElementById("btn-create-branch");

        this.createBtn.addEventListener("click", () => this.createBranch());
        this.createInput.addEventListener("keydown", e => {
            if (e.key === "Enter") this.createBranch();
        });
    },

    async openRepository(path) {
        this.currentRepoPath = path;
        await this.refresh();
    },

    async refresh() {
        if (!this.currentRepoPath) return;
        try {
            const data = await API.getBranches(this.currentRepoPath);
            if (!data.success) return;
            const branches = data.branches || [];
            this.countEl.textContent = branches.length;

            const head = branches.find(b => b.is_head);
            const activeName = head ? head.name : "—";
            if (this.activeBadge) this.activeBadge.textContent = activeName;

            this.listEl.innerHTML = "";
            if (branches.length === 0) {
                this.listEl.innerHTML = `<p class="empty-msg">No branches found.</p>`;
                return;
            }
            branches.forEach(b => this.renderBranchRow(b));
        } catch (e) {
            Toast.error(`Failed to load branches: ${e.message}`);
        }
    },

    renderBranchRow(b) {
        const row = document.createElement("div");
        row.className = "branch-chip-row" + (b.is_head ? " current" : "");

        const chip = document.createElement("div");
        chip.className = "branch-chip";
        chip.innerHTML = `
            <span class="branch-name">${escapeHtml(b.name)}</span>
            ${b.is_head ? '<span class="badge branch-badge text-gold">HEAD</span>' : ""}
        `;
        chip.addEventListener("click", () => {
            if (!b.is_head) this.switchBranch(b.name);
        });

        const actions = document.createElement("div");
        actions.className = "branch-actions";

        if (!b.is_head) {
            const switchBtn = document.createElement("button");
            switchBtn.className = "ghost-btn";
            switchBtn.textContent = "Switch";
            switchBtn.addEventListener("click", () => this.switchBranch(b.name));
            actions.appendChild(switchBtn);

            const delBtn = document.createElement("button");
            delBtn.className = "ghost-btn";
            delBtn.textContent = "Delete";
            delBtn.style.color = "var(--color-deleted)";
            delBtn.addEventListener("click", () => this.deleteBranch(b.name));
            actions.appendChild(delBtn);
        } else {
            const cur = document.createElement("span");
            cur.className = "ghost-btn";
            cur.style.color = "var(--gold-primary)";
            cur.style.borderColor = "var(--gold-primary)";
            cur.textContent = "Active";
            actions.appendChild(cur);
        }

        row.appendChild(chip);
        row.appendChild(actions);
        this.listEl.appendChild(row);
    },

    async createBranch() {
        const name = this.createInput.value.trim();
        if (!name) {
            Toast.error("Branch name required.");
            return;
        }
        try {
            await API.createBranch(this.currentRepoPath, name);
            Toast.success(`Created branch '${name}'`);
            this.createInput.value = "";
            await this.refresh();
            if (window.BranchGraph && BranchGraph.currentRepoPath) {
                BranchGraph.setRepo(this.currentRepoPath);
                await BranchGraph.refresh();
            }
            if (window.StatusView) {
                StatusView.branchBadge.textContent = name;
            }
        } catch (e) {
            Toast.error(`Create failed: ${e.message}`);
        }
    },

    async switchBranch(name) {
        try {
            Toast.info(`Switching to '${name}'...`);
            await API.switchBranch(this.currentRepoPath, name);
            Toast.success(`Switched to '${name}'`);
            await this.refresh();
            if (window.StatusView) {
                StatusView.branchBadge.textContent = name;
                StatusView.refresh(true);
            }
            if (window.BranchGraph && BranchGraph.currentRepoPath) {
                BranchGraph.setRepo(this.currentRepoPath);
                await BranchGraph.refresh();
            }
        } catch (e) {
            Toast.error(`Switch failed: ${e.message}`);
        }
    },

    async deleteBranch(name) {
        if (!window.confirm(`Delete branch '${name}'? This cannot be undone.`)) return;
        try {
            await API.deleteBranch(this.currentRepoPath, name);
            Toast.success(`Deleted branch '${name}'`);
            await this.refresh();
            if (window.BranchGraph && BranchGraph.currentRepoPath) {
                BranchGraph.setRepo(this.currentRepoPath);
                await BranchGraph.refresh();
            }
        } catch (e) {
            Toast.error(`Delete failed: ${e.message}`);
        }
    }
};

const HistoryView = {
    panel: null,
    listEl: null,
    refreshBtn: null,
    currentRepoPath: "",

    init() {
        this.panel = document.getElementById("history-view");
        this.listEl = document.getElementById("history-logs-list");
        this.refreshBtn = document.getElementById("btn-history-refresh");
        if (this.refreshBtn) {
            this.refreshBtn.addEventListener("click", () => this.refresh());
        }
    },

    openRepository(path) {
        this.currentRepoPath = path;
        this.refresh();
    },

    async refresh() {
        if (!this.currentRepoPath) return;
        try {
            const data = await API.getLog(this.currentRepoPath);
            const commits = data.commits || [];
            this.listEl.innerHTML = "";
            if (commits.length === 0) {
                this.listEl.innerHTML = `<p class="empty-msg">No commits recorded yet.</p>`;
                return;
            }
            commits.forEach(c => {
                const item = document.createElement("div");
                item.className = "commit-log-item";
                const timeStr = new Date(c.time * 1000).toLocaleString();
                item.innerHTML = `
                    <div class="commit-log-meta">
                        <span class="commit-sha">${escapeHtml(c.id.substring(0, 7))}</span>
                        <span>${escapeHtml(timeStr)}</span>
                    </div>
                    <div class="commit-message">${escapeHtml(c.message)}</div>
                `;
                this.listEl.appendChild(item);
            });
        } catch (e) {
            this.listEl.innerHTML = `<p class="empty-msg">Error loading history: ${e.message}</p>`;
        }
    }
};

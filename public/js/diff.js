const DiffView = {
    panel: null,
    backBtn: null,
    filenameLabel: null,
    contentPre: null,
    currentRepoPath: "",

    init() {
        this.panel = document.getElementById("diff-view");
        this.backBtn = document.getElementById("btn-diff-back");
        this.filenameLabel = document.getElementById("diff-filename");
        this.contentPre = document.getElementById("diff-content-pre");

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
            StatusView.show();
        });
    },

    async showDiff(repoPath, fileName, staged = false) {
        this.currentRepoPath = repoPath;
        this.filenameLabel.textContent = `${fileName} ${staged ? '(Staged)' : '(Modified)'}`;
        this.contentPre.innerHTML = `<div class="spinner" style="margin:20px auto;"></div>Loading diff...`;

        this.show();

        try {
            const data = await API.getDiff(repoPath, fileName, staged);
            const rawDiff = data.diff;

            if (!rawDiff || rawDiff.trim() === "") {
                this.contentPre.innerHTML = `<span style="color:var(--text-secondary); font-style:italic;">No changes to show. File is identical or untracked.</span>`;
                return;
            }

            this.contentPre.innerHTML = this.formatDiff(rawDiff);
        } catch (error) {
            this.contentPre.innerHTML = `<span style="color:var(--color-deleted);">Error loading diff: ${error.message}</span>`;
            Toast.error(`Failed to load diff: ${error.message}`);
        }
    },

    // Render a diff directly into an arbitrary container element (inline view).
    async renderInline(container, repoPath, fileName, staged = false) {
        container.innerHTML = `<pre><span style="color:var(--text-secondary);font-style:italic;">Loading diff…</span></pre>`;
        try {
            const data = await API.getDiff(repoPath, fileName, staged);
            const rawDiff = data.diff || "";
            if (!rawDiff.trim()) {
                container.innerHTML = `<pre><span style="color:var(--text-secondary);font-style:italic;">No diff (untracked or identical file).</span></pre>`;
                return;
            }
            container.innerHTML = `<pre>${this.formatDiff(rawDiff)}</pre>`;
        } catch (error) {
            container.innerHTML = `<pre style="color:var(--color-deleted);">Error: ${escapeHtml(error.message)}</pre>`;
        }
    },

    formatDiff(rawDiff) {
        const lines = rawDiff.split("\n");
        return lines.map(line => {
            // Escape HTML tags to prevent broken injection
            const escapedLine = line
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            if (escapedLine.startsWith("+") && !escapedLine.startsWith("+++")) {
                return `<div class="diff-line-added">${escapedLine}</div>`;
            } else if (escapedLine.startsWith("-") && !escapedLine.startsWith("---")) {
                return `<div class="diff-line-removed">${escapedLine}</div>`;
            } else if (escapedLine.startsWith("@@")) {
                return `<div class="diff-line-header">${escapedLine}</div>`;
            }
            return `<div>${escapedLine}</div>`;
        }).join("");
    }
};

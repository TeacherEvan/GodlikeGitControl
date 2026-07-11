// In-app git terminal — git-scoped, bound to the currently open repository.
// Runs over the existing /api/git/terminal endpoint (no shell, server-enforced).
const TerminalView = {
    panel: null,
    output: null,
    input: null,
    currentRepoPath: "",
    history: [],
    historyIndex: 0,

    init() {
        this.panel = document.getElementById("terminal-card");
        this.output = document.getElementById("terminal-output");
        this.input = document.getElementById("terminal-input");

        if (!this.panel || !this.output || !this.input) return;

        this.input.addEventListener("keydown", (e) => this.onKey(e));
        this.output.addEventListener("click", () => this.input.focus());
    },

    setRepoPath(path) {
        this.currentRepoPath = path || "";
    },

    isOpen() {
        return this.panel && !this.panel.classList.contains("hidden");
    },

    toggle() {
        if (!this.panel) return;
        if (this.panel.classList.contains("hidden")) {
            this.panel.classList.remove("hidden");
            this.printLine(
                "Git terminal ready. Only `git` commands are permitted for this repository.",
                "term-intro"
            );
            this.printLine("Type `help` for commands. Ctrl+L clears.", "term-intro");
            this.input.focus();
        } else {
            this.panel.classList.add("hidden");
        }
    },

    onKey(e) {
        if (e.key === "Enter") {
            e.preventDefault();
            const cmd = this.input.value;
            this.input.value = "";
            if (cmd.trim()) {
                this.history.push(cmd);
                this.historyIndex = this.history.length;
                this.runCommand(cmd.trim());
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (this.history.length && this.historyIndex > 0) {
                this.historyIndex--;
                this.input.value = this.history[this.historyIndex];
            }
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (this.historyIndex < this.history.length - 1) {
                this.historyIndex++;
                this.input.value = this.history[this.historyIndex];
            } else {
                this.historyIndex = this.history.length;
                this.input.value = "";
            }
        } else if (e.ctrlKey && (e.key === "l" || e.key === "L")) {
            e.preventDefault();
            this.clear();
        }
    },

    async runCommand(command) {
        this.printLine(`$ ${command}`, "term-cmd");

        if (command === "clear" || command === "cls") {
            this.clear();
            return;
        }
        if (command === "help") {
            this.printLine(
                "Git terminal — examples: git status | git log --oneline | git diff | git add <file> | git commit -m <msg>",
                "term-intro"
            );
            return;
        }

        try {
            const data = await API.gitTerminal(this.currentRepoPath, command);
            if (!data.success) {
                this.printLine(data.error || "Command rejected.", "term-err");
                return;
            }
            if (data.stdout) {
                this.printRaw(data.stdout, "term-out");
            }
            if (data.stderr) {
                this.printRaw(data.stderr, "term-err");
            }
            if (!data.stdout && !data.stderr) {
                this.printLine("(no output)", "term-muted");
            }
            if (data.returncode !== 0) {
                this.printLine(`[exit ${data.returncode}]`, "term-err");
            }
            // A successful git mutation may change staged/unstaged state.
            if (window.StatusView && StatusView.isOpen && StatusView.isOpen()) {
                StatusView.refresh(true);
            }
        } catch (err) {
            this.printLine(err.message || "Terminal request failed.", "term-err");
        }
    },

    printLine(text, cls) {
        const div = document.createElement("div");
        div.className = `term-line ${cls || ""}`;
        div.textContent = text;
        this.output.appendChild(div);
        this.scroll();
    },

    printRaw(text, cls) {
        const lines = text.replace(/\n$/, "").split("\n");
        lines.forEach((ln) => this.printLine(ln, cls));
    },

    clear() {
        this.output.innerHTML = "";
    },

    scroll() {
        this.output.scrollTop = this.output.scrollHeight;
    }
};

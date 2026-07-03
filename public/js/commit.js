const CommitPanel = {
    modal: null,
    closeBtn: null,
    cancelBtn: null,
    submitBtn: null,
    messageInput: null,
    previousActiveElement: null,

    init() {
        this.modal = document.getElementById("commit-modal");
        this.closeBtn = document.getElementById("btn-close-commit");
        this.cancelBtn = document.getElementById("btn-cancel-commit");
        this.submitBtn = document.getElementById("btn-submit-commit");
        this.messageInput = document.getElementById("commit-message-input");

        this.bindEvents();
    },

    open() {
        this.previousActiveElement = document.activeElement;
        this.messageInput.value = "";
        this.modal.classList.remove("hidden");
        this.messageInput.focus();
    },

    close() {
        this.modal.classList.add("hidden");
        if (this.previousActiveElement) {
            this.previousActiveElement.focus();
        }
    },

    bindEvents() {
        this.closeBtn.addEventListener("click", () => this.close());
        this.cancelBtn.addEventListener("click", () => this.close());
        
        this.submitBtn.addEventListener("click", () => {
            this.performCommit();
        });

        // Focus trap & escape key handler
        this.modal.addEventListener("keydown", (e) => {
            if (e.key === "Tab") {
                const focusableElements = [
                    this.closeBtn,
                    this.messageInput,
                    this.cancelBtn,
                    this.submitBtn
                ];
                
                const activeEl = document.activeElement;
                const first = focusableElements[0];
                const last = focusableElements[focusableElements.length - 1];

                if (e.shiftKey) { // Shift + Tab
                    if (activeEl === first || !focusableElements.includes(activeEl)) {
                        last.focus();
                        e.preventDefault();
                    }
                } else { // Tab
                    if (activeEl === last || !focusableElements.includes(activeEl)) {
                        first.focus();
                        e.preventDefault();
                    }
                }
            } else if (e.key === "Escape") {
                this.close();
            }
        });
    },

    async performCommit() {
        const message = this.messageInput.value.trim();
        if (!message) {
            Toast.error("Commit message cannot be empty");
            return;
        }

        this.submitBtn.setAttribute("disabled", "true");
        this.submitBtn.textContent = "Committing...";

        try {
            await API.commitChanges(StatusView.currentRepoPath, message);
            Toast.success("Changes committed successfully");
            this.close();
            StatusView.refresh();
        } catch (error) {
            Toast.error(`Commit failed: ${error.message}`);
        } finally {
            this.submitBtn.removeAttribute("disabled");
            this.submitBtn.textContent = "Commit";
        }
    }
};

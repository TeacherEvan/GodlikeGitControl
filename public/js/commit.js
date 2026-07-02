const CommitPanel = {
    modal: null,
    closeBtn: null,
    cancelBtn: null,
    submitBtn: null,
    messageInput: null,

    init() {
        this.modal = document.getElementById("commit-modal");
        this.closeBtn = document.getElementById("btn-close-commit");
        this.cancelBtn = document.getElementById("btn-cancel-commit");
        this.submitBtn = document.getElementById("btn-submit-commit");
        this.messageInput = document.getElementById("commit-message-input");

        this.bindEvents();
    },

    open() {
        this.messageInput.value = "";
        this.modal.classList.remove("hidden");
    },

    close() {
        this.modal.classList.add("hidden");
    },

    bindEvents() {
        this.closeBtn.addEventListener("click", () => this.close());
        this.cancelBtn.addEventListener("click", () => this.close());
        
        this.submitBtn.addEventListener("click", () => {
            this.performCommit();
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

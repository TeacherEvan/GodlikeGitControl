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

        const termBtn = document.getElementById("btn-toggle-terminal");
        if (termBtn) {
            termBtn.addEventListener("click", () => TerminalView.toggle());
        }

        // GitHub Operation Bindings
        const pushBtn = document.getElementById("btn-github-push");
        if (pushBtn) {
            pushBtn.addEventListener("click", async () => {
                this.setUILocked(true);
                Toast.info("Pushing to GitHub...");
                try {
                    await API.gitHubPush(this.currentRepoPath);
                    Toast.success("Successfully pushed to GitHub!");
                    this.checkGitHubSyncStatus();
                    this.refresh();
                } catch (err) {
                    Toast.error(err.message || "Failed to push.");
                } finally {
                    this.setUILocked(false);
                }
            });
        }

        const pullBtn = document.getElementById("btn-github-pull");
        if (pullBtn) {
            pullBtn.addEventListener("click", async () => {
                this.setUILocked(true);
                Toast.info("Pulling from GitHub...");
                try {
                    await API.gitHubPull(this.currentRepoPath);
                    Toast.success("Successfully pulled from GitHub!");
                    this.checkGitHubSyncStatus();
                    this.refresh();
                } catch (err) {
                    Toast.error(err.message || "Failed to pull.");
                } finally {
                    this.setUILocked(false);
                }
            });
        }

        const pubTrigger = document.getElementById("btn-github-publish-trigger");
        if (pubTrigger) {
            pubTrigger.addEventListener("click", () => {
                document.getElementById("github-unlinked-view").classList.add("hidden");
                const form = document.getElementById("github-publish-form");
                form.classList.remove("hidden");
                document.getElementById("github-publish-name").value = this.repoTitle.textContent;
            });
        }

        const pubCancel = document.getElementById("btn-github-publish-cancel");
        if (pubCancel) {
            pubCancel.addEventListener("click", () => {
                document.getElementById("github-publish-form").classList.add("hidden");
                document.getElementById("github-unlinked-view").classList.remove("hidden");
            });
        }

        const pubSubmit = document.getElementById("btn-github-publish-submit");
        if (pubSubmit) {
            pubSubmit.addEventListener("click", async () => {
                const name = document.getElementById("github-publish-name").value.trim();
                const isPrivate = document.getElementById("github-publish-private").checked;
                if (!name) {
                    Toast.error("Repository name is required.");
                    return;
                }
                this.setUILocked(true);
                Toast.info("Publishing repo to GitHub...");
                try {
                    await API.gitHubPublish(this.currentRepoPath, name, isPrivate);
                    Toast.success("Repository successfully published!");
                    document.getElementById("github-publish-form").classList.add("hidden");
                    this.checkGitHubRemote();
                } catch (err) {
                    Toast.error(err.message || "Failed to publish.");
                } finally {
                    this.setUILocked(false);
                }
            });
        }

        const signinTrigger = document.getElementById("btn-github-signin-link-trigger");
        if (signinTrigger) {
            signinTrigger.addEventListener("click", () => {
                GitHubController.openModal();
            });
        }

        const tabPrs = document.getElementById("tab-btn-prs");
        const tabIssues = document.getElementById("tab-btn-issues");
        if (tabPrs && tabIssues) {
            tabPrs.addEventListener("click", () => {
                tabPrs.classList.add("active");
                tabIssues.classList.remove("active");
                document.getElementById("github-prs-list").classList.remove("hidden");
                document.getElementById("github-issues-list").classList.add("hidden");
            });
            tabIssues.addEventListener("click", () => {
                tabIssues.classList.add("active");
                tabPrs.classList.remove("active");
                document.getElementById("github-issues-list").classList.remove("hidden");
                document.getElementById("github-prs-list").classList.add("hidden");
            });
        }
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

        TerminalView.setRepoPath(path);
        const terminalRepo = document.getElementById("terminal-repo");
        if (terminalRepo) terminalRepo.textContent = path.split("/").pop() || "Repository";

        this.show();
        this.refresh();
        this.checkGitHubRemote();
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
            this.checkGitHubRemote();

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
    },

    async checkGitHubRemote() {
        const syncSection = document.getElementById("github-sync-section");
        const unlinkedView = document.getElementById("github-unlinked-view");
        const linkedView = document.getElementById("github-linked-view");
        const syncBadge = document.getElementById("github-sync-badge");

        if (!this.currentRepoPath) return;

        try {
            const data = await API.getGitHubRemote(this.currentRepoPath);
            if (data.success && data.hasRemote && data.isGitHub) {
                syncSection.classList.remove("hidden");
                unlinkedView.classList.add("hidden");
                linkedView.classList.remove("hidden");

                const remoteLink = document.getElementById("github-remote-link");
                remoteLink.href = data.remoteUrl;
                remoteLink.textContent = `${data.owner}/${data.repo}`;

                const opsSignedIn = document.getElementById("github-ops-signed-in");
                const opsSignedOut = document.getElementById("github-ops-signed-out");

                if (GitHubController.isAuthenticated) {
                    opsSignedIn.classList.remove("hidden");
                    opsSignedOut.classList.add("hidden");
                    this.checkGitHubSyncStatus();
                    this.loadGitHubIssuesPRs();
                } else {
                    opsSignedIn.classList.add("hidden");
                    opsSignedOut.classList.remove("hidden");
                    syncBadge.textContent = "Sign in to sync";
                    syncBadge.className = "badge branch-badge";
                    document.getElementById("github-issues-prs-section").classList.add("hidden");
                }
            } else if (data.success && !data.hasRemote) {
                syncSection.classList.remove("hidden");
                unlinkedView.classList.remove("hidden");
                linkedView.classList.add("hidden");
                syncBadge.textContent = "Unlinked";
                syncBadge.className = "badge branch-badge";
                document.getElementById("github-issues-prs-section").classList.add("hidden");
            } else {
                syncSection.classList.add("hidden");
            }
        } catch (error) {
            console.error("Error checking GitHub remote:", error);
            syncSection.classList.add("hidden");
        }
    },

    async checkGitHubSyncStatus() {
        const syncBadge = document.getElementById("github-sync-badge");
        try {
            const response = await API.getGitHubSyncStatus(this.currentRepoPath);
            if (response.success && response.sync) {
                const s = response.sync;
                syncBadge.textContent = s.status;
                
                if (s.status === "Synced") {
                    syncBadge.className = "badge branch-badge text-gold";
                    syncBadge.style.borderColor = "var(--gold-primary)";
                    syncBadge.style.background = "rgba(212, 175, 55, 0.1)";
                    syncBadge.textContent = "Synced";
                } else if (s.status === "Ahead") {
                    syncBadge.className = "badge branch-badge";
                    syncBadge.style.borderColor = "var(--color-added)";
                    syncBadge.style.background = "rgba(76, 175, 80, 0.1)";
                    syncBadge.textContent = `Ahead by ${s.count}`;
                } else if (s.status === "Behind") {
                    syncBadge.className = "badge branch-badge";
                    syncBadge.style.borderColor = "var(--color-modified)";
                    syncBadge.style.background = "rgba(255, 193, 7, 0.1)";
                    syncBadge.textContent = `Behind by ${s.count}`;
                } else if (s.status === "Diverged") {
                    syncBadge.className = "badge branch-badge";
                    syncBadge.style.borderColor = "var(--color-deleted)";
                    syncBadge.style.background = "rgba(244, 67, 54, 0.1)";
                    syncBadge.textContent = "Diverged";
                } else {
                    syncBadge.className = "badge branch-badge";
                    syncBadge.style.borderColor = "var(--border-gold)";
                    syncBadge.style.background = "transparent";
                    syncBadge.textContent = s.status;
                }
            }
        } catch (error) {
            console.error("Error checking sync status:", error);
            syncBadge.textContent = "Error";
        }
    },

    async loadGitHubIssuesPRs() {
        const issuesPrsSection = document.getElementById("github-issues-prs-section");
        const prsList = document.getElementById("github-prs-list");
        const issuesList = document.getElementById("github-issues-list");

        try {
            const data = await API.getGitHubIssuesPRs(this.currentRepoPath);
            if (data.success) {
                issuesPrsSection.classList.remove("hidden");

                prsList.innerHTML = "";
                const prs = data.prs || [];
                if (prs.length === 0) {
                    prsList.innerHTML = `<p class="empty-msg" style="padding: 10px 0;">No active PRs found.</p>`;
                } else {
                    prs.forEach(pr => {
                        const item = document.createElement("div");
                        item.className = "issue-pr-item";
                        item.innerHTML = `
                            <span class="issue-pr-number">#${pr.number}</span>
                            <div class="issue-pr-title-wrapper">
                                <a href="${pr.html_url}" target="_blank" class="issue-pr-title">${escapeHtml(pr.title)}</a>
                                <div class="issue-pr-meta">Opened by @${escapeHtml(pr.user)}</div>
                            </div>
                        `;
                        prsList.appendChild(item);
                    });
                }

                issuesList.innerHTML = "";
                const issues = data.issues || [];
                if (issues.length === 0) {
                    issuesList.innerHTML = `<p class="empty-msg" style="padding: 10px 0;">No open issues found.</p>`;
                } else {
                    issues.forEach(issue => {
                        const item = document.createElement("div");
                        item.className = "issue-pr-item";
                        item.innerHTML = `
                            <span class="issue-pr-number">#${issue.number}</span>
                            <div class="issue-pr-title-wrapper">
                                <a href="${issue.html_url}" target="_blank" class="issue-pr-title">${escapeHtml(issue.title)}</a>
                                <div class="issue-pr-meta">Opened by @${escapeHtml(issue.user)}</div>
                            </div>
                        `;
                        issuesList.appendChild(item);
                    });
                }
            }
        } catch (error) {
            console.error("Error loading Issues/PRs:", error);
            issuesPrsSection.classList.add("hidden");
        }
    }
};

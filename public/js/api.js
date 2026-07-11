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

const API = {
    baseUrl: "", // Relative path handles sandbox mapping perfectly

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const defaultHeaders = {
            "Content-Type": "application/json"
        };
        
        const token = sessionStorage.getItem("github_token");
        if (token) {
            defaultHeaders["X-GitHub-Token"] = token;
        }
        
        const config = {
            ...options,
            headers: {
                ...defaultHeaders,
                ...options.headers
            }
        };

        try {
            const response = await fetch(url, config);
            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || `HTTP error! status: ${response.status}`);
            }
            return data;
        } catch (error) {
            console.error(`API Error on ${endpoint}:`, error);
            throw error;
        }
    },

    // Scan for repositories
    async scanSystem(path) {
        const query = path ? `?path=${encodeURIComponent(path)}` : "";
        return this.request(`/api/fs/scan${query}`);
    },

    // Browse directory tree
    async browseDirectory(path) {
        const query = path ? `?path=${encodeURIComponent(path)}` : "";
        return this.request(`/api/fs/browse${query}`);
    },

    // Get repository status
    async getStatus(path) {
        return this.request(`/api/git/status?path=${encodeURIComponent(path)}`);
    },

    // Get repository commits
    async getLog(path) {
        return this.request(`/api/git/log?path=${encodeURIComponent(path)}`);
    },

    // Get unified diff for a file
    async getDiff(path, fileName, staged = false) {
        const query = `?path=${encodeURIComponent(path)}&file=${encodeURIComponent(fileName)}&staged=${staged}`;
        return this.request(`/api/git/diff${query}`);
    },

    // Stage files
    async stageFiles(path, files) {
        return this.request("/api/git/stage", {
            method: "POST",
            body: JSON.stringify({ path, files })
        });
    },

    // Unstage files
    async unstageFiles(path, files) {
        return this.request("/api/git/unstage", {
            method: "POST",
            body: JSON.stringify({ path, files })
        });
    },

    // Commit changes
    async commitChanges(path, message) {
        return this.request("/api/git/commit", {
            method: "POST",
            body: JSON.stringify({ path, message })
        });
    },

    // GitHub Auth & Profile
    async getGitHubProfile() {
        return this.request("/api/github/profile");
    },

    async gitHubSignIn(token, rememberMe) {
        return this.request("/api/github/signin", {
            method: "POST",
            body: JSON.stringify({ token, rememberMe })
        });
    },

    async gitHubSignOut() {
        return this.request("/api/github/signout", {
            method: "POST"
        });
    },

    // GitHub Remote Link Info
    async getGitHubRemote(path) {
        return this.request(`/api/github/remote?path=${encodeURIComponent(path)}`);
    },

    // Sync status (ahead/behind branch head SHA comparison)
    async getGitHubSyncStatus(path) {
        return this.request(`/api/github/sync_status?path=${encodeURIComponent(path)}`);
    },

    // Issues & PRs list
    async getGitHubIssuesPRs(path) {
        return this.request(`/api/github/issues_prs?path=${encodeURIComponent(path)}`);
    },

    // Push to GitHub
    async gitHubPush(path) {
        return this.request("/api/github/push", {
            method: "POST",
            body: JSON.stringify({ path })
        });
    },

    // Pull from GitHub
    async gitHubPull(path) {
        return this.request("/api/github/pull", {
            method: "POST",
            body: JSON.stringify({ path })
        });
    },

    // Publish local repository to GitHub
    async gitHubPublish(path, name, private) {
        return this.request("/api/github/publish", {
            method: "POST",
            body: JSON.stringify({ path, name, private })
        });
    },

    // In-app git terminal (git-scoped, repo-bound)
    async gitTerminal(path, command) {
        return this.request("/api/git/terminal", {
            method: "POST",
            body: JSON.stringify({ path, command })
        });
    }
};

const API = {
    baseUrl: "", // Relative path handles sandbox mapping perfectly

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const defaultHeaders = {
            "Content-Type": "application/json"
        };
        
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
    }
};

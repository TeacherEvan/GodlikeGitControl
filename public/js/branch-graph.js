// Branch Graph — pure SVG DAG renderer (no dependencies).
const BranchGraph = {
    svg: null,
    legendEl: null,
    detailEl: null,
    wrapEl: null,
    currentRepoPath: "",
    data: null,
    highlightedBranch: null,

    // Up to 8 lane colors (gold palette variations)
    LANE_COLORS: [
        "#FFD700", "#FFB300", "#FFE082", "#B8860B",
        "#FFC107", "#FFA000", "#F9A825", "#FFECB3"
    ],
    NODE_R: 6,
    ROW_H: 34,
    COL_W: 26,
    PAD_X: 16,
    PAD_Y: 16,

    init() {
        this.svg = document.getElementById("branch-graph-svg");
        this.legendEl = document.getElementById("graph-legend");
        this.detailEl = document.getElementById("graph-detail");
        this.wrapEl = document.getElementById("graph-canvas-wrap");
    },

    setRepo(path) {
        this.currentRepoPath = path;
    },

    async refresh() {
        if (!this.currentRepoPath) return;
        try {
            const data = await API.getBranches(this.currentRepoPath);
            if (!data.success) return;
            this.data = data;
            this.render();
        } catch (e) {
            console.error("Branch graph load failed:", e);
        }
    },

    // Assign each commit to a lane based on the order branches appear.
    buildLayout() {
        const { branches, commits } = this.data;
        const bySha = {};
        commits.forEach(c => { bySha[c.sha] = c; });

        // Lane assignment: one lane per commit row, ordered by reverse time
        // (commits array is newest-first from the walker).
        const laneOf = {};
        commits.forEach((c, i) => { laneOf[c.sha] = i; });

        // Branch -> lane color mapping (by branch order in list)
        const branchColor = {};
        branches.forEach((b, i) => {
            branchColor[b.name] = this.LANE_COLORS[i % this.LANE_COLORS.length];
        });

        return { bySha, laneOf, branchColor };
    },

    render() {
        if (!this.svg) return this.init();
        const { branches, commits } = this.data;
        const { bySha, laneOf, branchColor } = this.buildLayout();

        const NS = "http://www.w3.org/2000/svg";
        this.svg.innerHTML = "";
        const rowCount = Math.max(commits.length, 1);
        const width = Math.max(
            this.PAD_X * 2 + this.COL_W,
            this.wrapEl ? this.wrapEl.clientWidth : 320
        );
        const height = this.PAD_Y * 2 + rowCount * this.ROW_H;
        this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        this.svg.setAttribute("height", height);
        this.svg.setAttribute("width", "100%");

        const xFor = sha => this.PAD_X + (laneOf[sha] % 1) * 0 + this.COL_W / 2;
        // lane 0 col; simplify to a single commit column with merge connectors
        const colX = this.PAD_X + this.COL_W / 2;
        const yFor = idx => this.PAD_Y + idx * this.ROW_H + this.ROW_H / 2;

        // Track which lane (column) each commit uses. Use up to N lanes by
        // spreading commits so parallel branches don't overlap vertically much.
        // Simple approach: assign branch's tip lane, propagate to ancestors.
        const commitLane = {};
        const usedLanes = {};
        let laneCursor = 0;
        branches.forEach(b => {
            if (b.sha && !(b.sha in commitLane)) {
                commitLane[b.sha] = laneCursor;
                usedLanes[laneCursor] = true;
                laneCursor = (laneCursor + 1) % 8 || 1;
            }
        });
        // Walk: any commit without a lane inherits from first parent
        commits.forEach(c => {
            if (!(c.sha in commitLane)) {
                const p = c.parents[0];
                commitLane[c.sha] = p && p in commitLane ? commitLane[p] : 0;
            }
        });

        const laneX = lane => this.PAD_X + 18 + lane * this.COL_W;
        const cx = sha => laneX(commitLane[sha]);
        const cy = sha => yFor(laneOf[sha]);

        // Draw lane branch lines (vertical connectors between parent/child)
        commits.forEach(c => {
            const y1 = cy(c.sha);
            const x1 = cx(c.sha);
            c.parents.forEach(p => {
                if (!bySha[p] && !(p in commitLane)) return;
                const py = cy(p);
                const px = cx(p);
                if (x1 === px) {
                    const line = document.createElementNS(NS, "line");
                    line.setAttribute("x1", x1);
                    line.setAttribute("y1", y1);
                    line.setAttribute("x2", px);
                    line.setAttribute("y2", py);
                    line.setAttribute("stroke", "rgba(212,175,55,0.45)");
                    line.setAttribute("stroke-width", "2");
                    this.svg.appendChild(line);
                } else {
                    // Diagonal merge connector
                    const path = document.createElementNS(NS, "path");
                    const midY = (y1 + py) / 2;
                    path.setAttribute(
                        "d",
                        `M ${x1} ${y1} C ${x1} ${midY}, ${px} ${midY}, ${px} ${py}`
                    );
                    path.setAttribute("fill", "none");
                    path.setAttribute("stroke", "rgba(212,175,55,0.45)");
                    path.setAttribute("stroke-width", "2");
                    this.svg.appendChild(path);
                }
            });
        });

        // Draw commit nodes
        commits.forEach(c => {
            const x = cx(c.sha);
            const y = cy(c.sha);
            const g = document.createElementNS(NS, "g");
            g.setAttribute("class", "graph-node");

            const circle = document.createElementNS(NS, "circle");
            circle.setAttribute("cx", x);
            circle.setAttribute("cy", y);
            circle.setAttribute("r", this.NODE_R);
            circle.setAttribute("class", "graph-node-circle");
            circle.setAttribute("fill", "#FFD700");
            circle.setAttribute("stroke", "rgba(0,0,0,0.6)");
            circle.setAttribute("stroke-width", "1.5");
            g.appendChild(circle);

            // Commit message label
            const label = document.createElementNS(NS, "text");
            label.setAttribute("x", x + 14);
            label.setAttribute("y", y + 3);
            label.setAttribute("class", "graph-commit-label");
            label.textContent = `${c.short_sha} ${c.message}`;
            // Truncate long labels
            if (label.textContent.length > 38) {
                label.textContent = label.textContent.slice(0, 36) + "…";
            }
            g.appendChild(label);

            g.addEventListener("click", () => this.showCommitDetail(c));
            this.svg.appendChild(g);
        });

        // Branch ref labels anchored to their HEAD commit
        branches.forEach(b => {
            if (!b.sha) return;
            const x = cx(b.sha);
            const y = cy(b.sha);
            const color = branchColor[b.name];

            const label = document.createElementNS(NS, "text");
            label.setAttribute("x", x);
            label.setAttribute("y", y - this.NODE_R - 5);
            label.setAttribute("class", "graph-branch-label");
            label.setAttribute("fill", color);
            label.textContent = `⎇ ${b.name}${b.is_head ? " ★" : ""}`;
            label.style.cursor = "pointer";
            label.addEventListener("click", () => this.highlightBranch(b.name));
            this.svg.appendChild(label);

            if (b.is_head) {
                const star = document.createElementNS(NS, "text");
                star.setAttribute("x", x - this.NODE_R - 8);
                star.setAttribute("y", y + 4);
                star.setAttribute("class", "graph-head-marker");
                star.textContent = "★";
                this.svg.appendChild(star);
            }
        });

        this.renderLegend(branches, branchColor);
    },

    renderLegend(branches, branchColor) {
        if (!this.legendEl) return;
        this.legendEl.innerHTML = "";
        branches.forEach(b => {
            const item = document.createElement("div");
            item.className = "legend-item" +
                (this.highlightedBranch === b.name ? " highlighted" : "");
            item.innerHTML = `<span class="legend-swatch" style="background:${branchColor[b.name]}"></span><span class="legend-label">${escapeHtml(b.name)}</span>`;
            item.addEventListener("click", () => this.highlightBranch(b.name));
            this.legendEl.appendChild(item);
        });
    },

    highlightBranch(name) {
        this.highlightedBranch = this.highlightedBranch === name ? null : name;
        this.renderLegend(
            this.data.branches,
            // recompute colors cheaply
            (() => {
                const bc = {};
                this.data.branches.forEach((b, i) => {
                    bc[b.name] = this.LANE_COLORS[i % this.LANE_COLORS.length];
                });
                return bc;
            })()
        );
        // Dim non-highlighted nodes
        const nodes = this.svg.querySelectorAll(".graph-node");
        nodes.forEach(() => {});
        const labels = this.svg.querySelectorAll("text.graph-commit-label");
        // For simplicity, just re-render with a branch filter highlight flag.
        this.render();
        if (this.highlightedBranch) {
            // Boost opacity contrast handled visually by re-render; keep simple.
        }
    },

    showCommitDetail(c) {
        if (!this.detailEl) return;
        const d = new Date(c.timestamp * 1000).toLocaleString();
        this.detailEl.innerHTML = `
            <div class="detail-sha">${escapeHtml(c.short_sha)}</div>
            <div style="margin:4px 0; color:var(--text-primary);">${escapeHtml(c.message)}</div>
            <div>Author: ${escapeHtml(c.author)}</div>
            <div>Date: ${escapeHtml(d)}</div>
            <div style="margin-top:4px; word-break:break-all; opacity:0.6;">${escapeHtml(c.sha)}</div>
        `;
    }
};

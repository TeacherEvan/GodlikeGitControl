const HardwareMonitor = {
    panel: null,
    backBtn: null,
    
    cpuCircle: null,
    cpuPctText: null,
    ramCircle: null,
    ramPctText: null,
    
    diskList: null,
    
    sysOs: null,
    sysRelease: null,
    sysArch: null,
    sysUptime: null,
    sysCpuModel: null,
    
    // Canvas elements
    cpuCanvas: null,
    cpuCtx: null,
    ramCanvas: null,
    ramCtx: null,
    
    // Data history
    cpuHistory: [],
    ramHistory: [],
    maxHistoryPoints: 30,
    
    updateInterval: null,

    init() {
        this.panel = document.getElementById("hardware-view");
        this.backBtn = document.getElementById("btn-hardware-back");
        
        this.cpuCircle = document.getElementById("cpu-circle");
        this.cpuPctText = document.getElementById("cpu-pct-val");
        this.ramCircle = document.getElementById("ram-circle");
        this.ramPctText = document.getElementById("ram-pct-val");
        
        this.diskList = document.getElementById("disk-list");
        
        this.sysOs = document.getElementById("sys-os");
        this.sysRelease = document.getElementById("sys-release");
        this.sysArch = document.getElementById("sys-arch");
        this.sysUptime = document.getElementById("sys-uptime");
        this.sysCpuModel = document.getElementById("sys-cpu-model");

        this.cpuCanvas = document.getElementById("cpu-history-chart");
        this.cpuCtx = this.cpuCanvas.getContext("2d");
        
        this.ramCanvas = document.getElementById("ram-history-chart");
        this.ramCtx = this.ramCanvas.getContext("2d");

        // Initialize history arrays with zeros
        this.cpuHistory = Array(this.maxHistoryPoints).fill(0);
        this.ramHistory = Array(this.maxHistoryPoints).fill(0);

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

        // Resize canvases to fit container bounding box
        this.resizeCanvases();

        // Fetch immediately, then start interval
        this.fetchMetrics();
        
        this.stopPolling();
        this.updateInterval = setInterval(() => {
            this.fetchMetrics();
        }, 1000);
    },

    stopPolling() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    },

    bindEvents() {
        this.backBtn.addEventListener("click", () => {
            this.stopPolling();
            Dashboard.show();
        });
        
        window.addEventListener("resize", () => {
            if (this.panel.classList.contains("active")) {
                this.resizeCanvases();
            }
        });
    },

    resizeCanvases() {
        // Handle canvas DPI scaling
        const scaleCanvas = (canvas) => {
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * window.devicePixelRatio;
            canvas.height = rect.height * window.devicePixelRatio;
            const ctx = canvas.getContext("2d");
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        };
        scaleCanvas(this.cpuCanvas);
        scaleCanvas(this.ramCanvas);
    },

    async fetchMetrics() {
        try {
            const data = await API.request("/api/system/hardware");
            const metrics = data.hardware;

            this.updateGauges(metrics.cpu.overallPercent, metrics.memory.percent);
            this.updateDiskList(metrics.disks);
            this.updateSystemInfo(metrics.system, metrics.cpu.model);
            
            // Push values to history
            this.cpuHistory.push(metrics.cpu.overallPercent);
            if (this.cpuHistory.length > this.maxHistoryPoints) this.cpuHistory.shift();

            this.ramHistory.push(metrics.memory.percent);
            if (this.ramHistory.length > this.maxHistoryPoints) this.ramHistory.shift();

            // Render graphs
            this.drawChart(this.cpuCanvas, this.cpuCtx, this.cpuHistory, { stroke: "#FFD700", fillStart: "rgba(255, 215, 0, 0.15)" });
            this.drawChart(this.ramCanvas, this.ramCtx, this.ramHistory, { stroke: "#FFE082", fillStart: "rgba(255, 224, 130, 0.15)" });

        } catch (e) {
            console.error("Failed to fetch hardware metrics:", e);
        }
    },

    updateGauges(cpuVal, ramVal) {
        this.cpuPctText.textContent = Math.round(cpuVal);
        this.ramPctText.textContent = Math.round(ramVal);

        this.cpuCircle.setAttribute("stroke-dasharray", `${Math.round(cpuVal)}, 100`);
        this.ramCircle.setAttribute("stroke-dasharray", `${Math.round(ramVal)}, 100`);
    },

    updateDiskList(disks) {
        this.diskList.innerHTML = "";
        if (!disks || disks.length === 0) {
            this.diskList.innerHTML = `<p class="empty-msg">No partitions found.</p>`;
            return;
        }

        disks.forEach(disk => {
            const totalGB = (disk.total / (1024 ** 3)).toFixed(1);
            const usedGB = (disk.used / (1024 ** 3)).toFixed(1);
            
            const item = document.createElement("div");
            item.className = "disk-item";
            item.innerHTML = `
                <div class="disk-meta">
                    <span class="disk-name">${disk.mountpoint} (${disk.fstype})</span>
                    <span>${usedGB} GB / ${totalGB} GB (${disk.percent}%)</span>
                </div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fg" style="width: ${disk.percent}%"></div>
                </div>
            `;
            this.diskList.appendChild(item);
        });
    },

    updateSystemInfo(sys, cpuModel) {
        this.sysOs.textContent = sys.os;
        this.sysRelease.textContent = sys.release;
        this.sysArch.textContent = sys.machine;
        this.sysCpuModel.textContent = cpuModel;

        let sec = sys.uptime;
        const days = Math.floor(sec / (24 * 3600));
        sec %= (24 * 3600);
        const hours = Math.floor(sec / 3600);
        sec %= 3600;
        const mins = Math.floor(sec / 60);
        const secs = sec % 60;

        let uptimeStr = "";
        if (days > 0) uptimeStr += `${days}d `;
        if (hours > 0 || days > 0) uptimeStr += `${hours}h `;
        uptimeStr += `${mins}m ${secs}s`;
        this.sysUptime.textContent = uptimeStr;
    },

    drawChart(canvas, ctx, history, colors) {
        const width = canvas.width / window.devicePixelRatio;
        const height = canvas.height / window.devicePixelRatio;

        ctx.clearRect(0, 0, width, height);

        // Draw horizontal grid lines
        ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
        ctx.lineWidth = 1;
        for (let y = 0.25; y < 1; y += 0.25) {
            ctx.beginPath();
            ctx.moveTo(0, height * y);
            ctx.lineTo(width, height * y);
            ctx.stroke();
        }

        // Draw Y-axis Labels (resolves missing chart legends finding)
        ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
        ctx.font = "8px 'Inter', sans-serif";
        ctx.fillText("100%", width - 28, 10);
        ctx.fillText("50%", width - 23, height / 2 + 3);
        ctx.fillText("0%", width - 18, height - 5);

        // Draw line path
        ctx.beginPath();
        const step = (width - 32) / (this.maxHistoryPoints - 1); // Save 32px right margin for Y-axis labels
        
        history.forEach((val, i) => {
            const x = i * step;
            const y = height - 5 - ((val / 100) * (height - 10));
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        // Set gold glow drop-shadow
        ctx.shadowColor = colors.stroke;
        ctx.shadowBlur = 6;
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 2.2;
        ctx.stroke();

        ctx.shadowBlur = 0;

        // Draw filled gradient area under the line
        ctx.lineTo((this.maxHistoryPoints - 1) * step, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, colors.fillStart);
        grad.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = grad;
        ctx.fill();
    }
};

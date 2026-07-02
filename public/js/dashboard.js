const Dashboard = {
    panel: null,
    scanBtn: null,
    locationBtn: null,

    init() {
        this.panel = document.getElementById("main-dashboard");
        this.scanBtn = document.getElementById("btn-scan-menu");
        this.locationBtn = document.getElementById("btn-location-menu");
        this.hardwareBtn = document.getElementById("btn-hardware-menu");

        this.bindEvents();
    },

    show() {
        // Deactivate all panels and activate main dashboard
        document.querySelectorAll(".view-panel").forEach(p => {
            p.classList.add("hidden");
            p.classList.remove("active");
        });
        
        this.panel.classList.remove("hidden");
        // Force reflow for transitions
        this.panel.offsetHeight;
        this.panel.classList.add("active");
    },

    bindEvents() {
        this.scanBtn.addEventListener("click", () => {
            Scan.show();
        });

        this.locationBtn.addEventListener("click", () => {
            LocationBrowser.show();
        });

        this.hardwareBtn.addEventListener("click", () => {
            HardwareMonitor.show();
        });
    }
};

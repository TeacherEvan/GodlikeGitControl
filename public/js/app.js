document.addEventListener("DOMContentLoaded", () => {
    // 1. Initialize Toast System
    Toast.init();

    // 2. Initialize Views and Controllers
    Dashboard.init();
    Scan.init();
    LocationBrowser.init();
    StatusView.init();
    DiffView.init();
    CommitPanel.init();
    HardwareMonitor.init();
    GitHubController.init();
    TerminalView.init();

    // 3. Bind global layout events
    const homeBtn = document.getElementById("btn-home");
    homeBtn.addEventListener("click", () => {
        // Stop status and hardware auto-refresh/polling and go back to dashboard
        StatusView.stopAutoRefresh();
        HardwareMonitor.stopPolling();
        Dashboard.show();
    });

    // 4. Initialize Splash Screen
    Splash.init(() => {
        // Show main shell
        const appShell = document.getElementById("app-shell");
        appShell.classList.remove("hidden");
        // Trigger dashboard entry
        Dashboard.show();
        Toast.success("Dashboard loaded");
    });
});

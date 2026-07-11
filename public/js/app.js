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
    BranchesView.init();
    HistoryView.init();
    BranchGraph.init();

    // 3. Sidebar navigation wiring
    const appShell = document.getElementById("app-shell");
    const headerBranchBadge = document.getElementById("header-branch-badge");

    function setActiveView(viewId) {
        document.querySelectorAll(".view-panel").forEach(p => {
            p.classList.add("hidden");
            p.classList.remove("active");
        });
        const target = document.getElementById(viewId);
        if (target) {
            target.classList.remove("hidden");
            target.offsetHeight; // reflow
            target.classList.add("active");
        }
        document.querySelectorAll(".sidebar-item").forEach(item => {
            item.classList.toggle("active", item.dataset.view === viewId);
        });
    }

    document.querySelectorAll(".sidebar-item").forEach(item => {
        item.addEventListener("click", () => {
            const view = item.dataset.view;
            if (view === "status-view" && StatusView.currentRepoPath) {
                StatusView.show();
            } else if (view === "branches-view" && StatusView.currentRepoPath) {
                setActiveView("branches-view");
                BranchesView.refresh();
            } else if (view === "history-view" && StatusView.currentRepoPath) {
                setActiveView("history-view");
                HistoryView.refresh();
            } else if (view === "hardware-view") {
                HardwareMonitor.show();
            } else if (view === "main-dashboard") {
                Dashboard.show();
            }
        });
    });

    // Sidebar collapse toggle
    const sidebarToggle = document.getElementById("btn-toggle-sidebar");
    if (sidebarToggle) {
        sidebarToggle.addEventListener("click", () => {
            appShell.classList.toggle("sidebar-collapsed");
        });
    }

    // Branch graph drawer toggle
    const graphToggle = document.getElementById("btn-toggle-graph");
    const graphClose = document.getElementById("btn-close-graph");
    function toggleGraph(open) {
        const willOpen = open !== undefined ? open : !appShell.classList.contains("graph-open");
        appShell.classList.toggle("graph-open", willOpen);
        if (willOpen && StatusView.currentRepoPath) {
            BranchGraph.setRepo(StatusView.currentRepoPath);
            BranchGraph.refresh();
        }
    }
    if (graphToggle) graphToggle.addEventListener("click", () => toggleGraph());
    if (graphClose) graphClose.addEventListener("click", () => toggleGraph(false));

    // Helper to update global header branch badge
    function updateHeaderBranch(name) {
        if (headerBranchBadge) {
            headerBranchBadge.textContent = name;
            headerBranchBadge.classList.remove("hidden");
        }
    }

    // Hook repository opening so new views + graph track the active repo.
    const origOpen = StatusView.openRepository.bind(StatusView);
    StatusView.openRepository = async function (path) {
        await origOpen(path);
        BranchesView.openRepository(path);
        HistoryView.openRepository(path);
        BranchGraph.setRepo(path);
        updateHeaderBranch(StatusView.branchBadge.textContent);
    };

    // 4. Bind global layout events
    const homeBtn = document.getElementById("btn-home");
    homeBtn.addEventListener("click", () => {
        StatusView.stopAutoRefresh();
        HardwareMonitor.stopPolling();
        // Collapse back to dashboard; keep graph state
        setActiveView("main-dashboard");
        Dashboard.show();
        if (headerBranchBadge) headerBranchBadge.classList.add("hidden");
    });

    // 5. Initialize Splash Screen
    Splash.init(() => {
        appShell.classList.remove("hidden");
        Dashboard.show();
        Toast.success("Dashboard loaded");
    });
});

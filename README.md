# God's Git-Control (GodlikeGitControl)

A cinematic, gold-stoic themed Progressive Web App (PWA) and native desktop window for viewing and controlling local Git repository status.

Built with a lightweight Python backend using the pure-Python Git client `dulwich` and a vanilla HTML/CSS/JS frontend SPA. A native desktop launcher (`app_window.py`, pywebview) wraps the same backend in a standalone window.

## Features
- **Cinematic Welcome screen** on launch with golden particle effects and transitions.
- **System Scan**: Discovers Git repositories under the home directory (up to 4 levels deep).
- **Go to Location**: Navigate to any directory path on the local system and verify if it is a Git repository.
- **Git status details**: Displays staged, unstaged, modified, and untracked files with status badges.
- **Git action triggers**: Stage individual or all files, unstage files, and commit directly from the UI.
- **Commit history viewer**: Displays recent commits.
- **File Diff viewer**: View diffs of changed files with line-by-line colored diffs.
- **GitHub Integration**: Sign in with a Personal Access Token, link a remote, push/pull, publish a new repo, and view open issues/PRs. Tokens are scrubbed from `.git/config` after push/pull; optionally persisted to `~/.config/ggc/credentials.json` (chmod 600) only when "Remember Me" is checked.
- **System Hardware Monitor**: Real-time CPU, memory, disk, and uptime metrics via the `/api/system/hardware` endpoint.
- **In-App Git Terminal**: A git-scoped terminal bound to the currently-open repository. Runs arbitrary `git` commands (log/diff/blame/stash/etc.) over `/api/git/terminal`; rejects non-git commands, path overrides (`-C`, `--git-dir`, ...), and unsafe repo paths. No shell, server-enforced.

## Installation & Running

Dependencies are managed in a Python virtual environment. `install.sh` creates the `venv` and installs everything pinned in `requirements.txt` (dulwich, psutil, pywebview, PyQt5, PyQtWebEngine, qtpy).

```bash
./install.sh
```

### Option A — Native desktop window
Launches the backend and opens a standalone pywebview window:

```bash
./venv/bin/python3 app_window.py
```

### Option B — Server only (PWA / browser)
Start the backend server, then open the app in a browser:

```bash
./venv/bin/python3 server.py
```

The server listens on `127.0.0.1:3002` by default. Override with the `GGC_PORT` environment variable:

```bash
GGC_PORT=8080 ./venv/bin/python3 server.py
```

## Development Architecture

- **Backend**: `server.py` handles API endpoints and serves frontend assets. Endpoint groups:
  - Filesystem: `/api/fs/scan`, `/api/fs/browse`
  - Git: `/api/git/status`, `/api/git/log`, `/api/git/diff`, `/api/git/terminal`
  - System: `/api/system/hardware`
  - GitHub: `/api/github/profile`, `/api/github/remote`, `/api/github/sync_status`, `/api/github/issues_prs` (with shared `_resolve_github_repo` guard; all REST calls routed through `_github_api`)
  - Security: path-traversal guards (`is_safe_path`), CSRF origin check, JSON-only POST, git lock for concurrency, and token redaction in exceptions.
- **Native launcher**: `app_window.py` spawns `server.py` as a subprocess and opens it in a pywebview window (Qt WebEngine backend).
- **Frontend SPA**:
  - `public/index.html`: Shell & view container setup.
  - `public/style.css`: Custom animations, color schemes (gold-stoic), responsive design, and glassmorphism styling.
  - `public/js/`: Modular JS controllers — `app.js` (router/splash), `dashboard.js`, `status.js`, `diff.js`, `github.js`, `hardware.js`, `terminal.js`, `api.js` (HTTP layer).
  - `public/sw.js`: PWA service worker (offline asset caching).

## Documentation

Feature and design plans live in [`docs/plans/`](docs/plans/). Completed plans are moved to [`docs/plans/.archive/`](docs/plans/.archive/) with a status badge.

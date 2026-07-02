# God's Git-Control (GodlikeGitControl)

A cinematic, gold-stoic themed Progressive Web App (PWA) for viewing and controlling local Git repository status.

Built with a lightweight Python backend using the pure-Python Git client `dulwich` and a vanilla HTML/CSS/JS frontend SPA.

## Features
- **Cinematic Welcome screen** on launch with golden particle effects and transitions.
- **System Scan**: Discovers Git repositories under the home directory (up to 4 levels deep).
- **Go to Location**: Navigate to any directory path on the local system and verify if it is a Git repository.
- **Git status details**: Displays staged, unstaged, modified, and untracked files with status badges.
- **Git action triggers**: Stage individual or all files, unstage files, and commit directly from the UI.
- **Commit history viewer**: Displays recent commits.
- **File Diff viewer**: View diffs of changed files with line-by-line colored diffs.

## Installation & Running

1. Install backend dependencies (Dulwich pure-python git client):
   ```bash
   pip3 install dulwich --break-system-packages
   ```

2. Start the application backend server:
   ```bash
   python3 server.py
   ```

3. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## Development Architecture

- **Backend**: `server.py` handles API endpoints (scan, browse, status, log, diff, stage, unstage, commit) and serves frontend assets.
- **Frontend SPA**:
  - `public/index.html`: Shell & View container setup.
  - `public/style.css`: Custom animations, color schemes (gold-stoic), responsive design, and glassmorphism styling.
  - `public/js/`: Modular JS controllers handling API requests, views, routing, and splash transitions.

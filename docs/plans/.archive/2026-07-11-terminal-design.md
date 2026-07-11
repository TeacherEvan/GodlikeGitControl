# Design: In-App Git Terminal

Date: 2026-07-11

## Context

GodlikeGitControl is a local web UI for git + hardware. The backend (`server.py`)
already exposes stage/unstage/commit/diff over HTTP, and the frontend
(`StatusView` + `DiffView`) already wires those up — staging/unstaging on file
checkboxes and opening a diff viewer per file. That part of the request already
works and is left intact.

The missing piece is an **in-app terminal** so the user can run arbitrary git
commands against the open repository from the UI.

## Decision (scope)

Git-only terminal scoped to the currently-open repository. Rationale:
- The app already enforces security gates (path safety, CSRF origin check,
  JSON-only POST). A full shell would need a WebSocket + xterm.js and a large
  new attack surface.
- A git-scoped terminal covers the real use case (inspect log/diff/blame,
  cherry-pick, stash, etc.) without arbitrary command execution.

## Backend

- New helper `run_git_terminal(repo_path, command)` in `server.py`:
  - Validate `command` is non-empty and starts with `git`.
  - Parse with `shlex.split` (no shell). Reject if first token != `git`.
  - Drop/block path-override & escape args: `-C`, `--git-dir`, `--work-tree`,
    `--namespace`, `--upload-pack`, `--receive-pack`, `--exec-path`.
  - Run `subprocess.run(["git", "-C", repo_path, *args], cwd=repo_path,
    capture_output=True, text=True, shell=False, timeout=30)`.
  - Return `{command, stdout, stderr, returncode}`. Cap output at 200KB
    (truncate with a marker) to avoid memory blowups.
  - Called under `git_lock` (serialize with other git ops — same as other
    endpoints; resolves concurrency).
- New route `POST /api/git/terminal` -> `_api_git_terminal`. Reuses existing
  `handle_api_post` path-safety + CSRF + JSON guards. Body `{path, command}`.

## Frontend

- New `public/js/terminal.js` controller `TerminalView`:
  - `output` <pre>, `input` text field, prompt `$`.
  - Enter runs command via `API.gitTerminal(path, command)`; appends
    `$ command`, stdout (neutral), stderr (red), or error. Auto-scroll.
  - Up/Down arrow history; `clear` and Ctrl+L clear; `help` prints usage.
  - Only git commands allowed (server enforces + friendly client hint).
- `public/index.html`: add a "Terminal" button to the status action bar and a
  terminal `section-card` (hidden by default) inside `status-view`, after the
  commit history card.
- `public/js/api.js`: add `gitTerminal(path, command)`.
- `public/js/app.js`: call `TerminalView.init()`.

## Tests

Extend `tests/test_suite.py`:
- `test_09_git_terminal`:
  - `git status` returns success and output mentions the branch.
  - A non-git command (`echo hi`) is rejected (success=false / 4xx).
  - A blocked arg (`git -C /etc status`) is rejected.
  - Path-traversal repo path is rejected (400) — reuses `is_safe_path`.

## Threat model

- `shell=False`: no shell metacharacter injection.
- `-C`/git-dir overrides blocked: command cannot escape the validated repo.
- 30s timeout + 200KB output cap: prevents hangs / memory exhaustion.
- Inherits the app's existing CSRF + path-safety gates.
- Known residual: `git -c` config can set e.g. `core.pager`; with captured
  output (no TTY) and local repo scope this is acceptable; documented, not
  blocked to keep `-c` useful for legit diff/log options.

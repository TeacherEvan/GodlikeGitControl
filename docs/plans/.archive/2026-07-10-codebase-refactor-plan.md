**Status:** ✅ **Archived — Implemented & Verified** (2026-07-10)

# GodlikeGitControl — Codebase Refactor & Hardening Plan

Date: 2026-07-10
Scope: `server.py`, `sync_github.py`, `tests/test_suite.py`, packaging hygiene.
No public API behavior changes except two security/robustness fixes (credential not persisted in `.git/config`; tests no longer touch real creds).

## Context

A full read of the codebase surfaced 10 findings. The code is functionally complete and
reasonably secure (path-traversal guards, CSRF origin checks, token redaction in exceptions,
concurrency lock all present). The work here is: (1) fix two real correctness/safety defects,
(2) remove dead code, (3) apply DRY/perf refactors with no behavior change, (4) add reproducible
packaging. Every change is backed by a test that fails before and passes after (TDD).

## Findings addressed

| ID | Severity | Finding | Action |
|----|----------|---------|--------|
| BUG#1 | High | Tests are not hermetic: `test_08` signout deletes the real `~/.config/ggc/credentials.json`, and step 1 fails whenever a token is saved. | T1: run test server with isolated `HOME`; add regression guard. |
| BUG#2 | High | `link_and_push_github_repo` persists `https://user:token@github.com/...` in `.git/config` (token at rest). | T3: scrub token from remote URL after push/pull. |
| #3 | Low | `sync_github.py` is dead (0 references); duplicates server logic. | T7: delete it. |
| #4 | Med | 4 GitHub API funcs repeat urllib boilerplate. | T4: `_github_api()` helper. |
| #5 | Med | `push_to_github`/`pull_from_github` near-duplicate. | T3: `_sync_with_github()`. |
| #6 | Med | 3 github handlers share 12-line guard preamble. | T5: guard helper. |
| #7 | Med | `scan_for_repos` holds `git_lock` during the whole `os.walk`. | T6: release lock around walk. |
| #8 | Low | push/pull re-fetch GitHub profile (network) just for username. | T3: derive username from remote owner. |
| #9 | Med | No pinned dependency manifest (deps only in install.sh). | T2: `requirements.txt`. |
| #10 | Low | `tests/performance_report.json` committed/modified noise. | T2: gitignore. |

## Task breakdown (each: write failing test -> implement -> green -> commit)

### T1 — Hermetic tests (BUG#1)
- In `tests/test_suite.py::setUpClass`, build an isolated config dir under `cls.temp_dir`
  (e.g. `cls.temp_dir/ggc_home`) and pass `HOME=<that dir>` in the spawned server's env so
  `get_config_path()` -> `<temp>/ggc_home/.config/ggc/credentials.json`, never the real one.
- Add a regression test `test_09_credentials_isolation` that (a) confirms the real
  `~/.config/ggc/credentials.json` is untouched by the suite run, and (b) asserts the server
  uses the isolated path (signin/persist/signout leaves only the temp file, which tearDown
  already deletes).
- Also add `test_10_profile_unauthenticated_clean` (no token -> `authenticated:false`) to lock
  the previously-flaky assertion.

### T2 — Packaging hygiene (#9, #10)
- Add `requirements.txt` pinned to the versions in `venv` (dulwich, psutil, pywebview, PyQt5,
  PyQtWebEngine, qtpy).
- Add `tests/performance_report.json` to `.gitignore`.

### T3 — Merge push/pull + credential scrub (#2, #5, #8)
- New `_sync_with_github(repo_path, token, op)` where `op in ("push","pull")`; builds the
  authenticated URL, derives `username` from the remote owner (no `fetch_github_profile` call),
  runs `porcelain.push`/`porcelain.pull`, redacts the token in exceptions, then scrubs the
  token from `origin.url` in `.git/config` (reset to `https://github.com/owner/repo.git`).
- `push_to_github`/`pull_from_github` become thin wrappers; `link_and_push_github_repo` sets the
  config then calls `push_to_github` (which now scrubs after).
- Test: a unit test on a temp repo + patched `porcelain.push`/`porcelain.pull` asserting the
  remote URL is token-free after the call.

### T4 — GitHub API helper (#4)
- New `_github_api(method, url, token=None, body=None, timeout=5.0) -> dict|bytes` centralizing
  auth/accept/UA headers + JSON decode + redaction of token from error strings.
- Refactor `fetch_github_profile`, `fetch_github_branch_head`, `fetch_github_issues_prs`,
  `create_github_repo_api` to use it (GGC_TESTING short-circuits unchanged).

### T5 — Shared github-handler guard (#6)
- New `_resolve_github_repo(self, repo_path) -> (token, url, parsed) | sends error & returns None`
  used by `_api_github_sync_status`, `_api_github_issues_prs` (and could back `_api_github_remote`).
- Behavior identical; reduces ~36 lines to ~12.

### T6 — Scan lock (#7)
- In `scan_for_repos`, drop `with git_lock:`; read `.git` dirs / `active_branch` without the
  global lock (the walk only reads, never mutates). Keep per-repo `Repo` open inside the loop.
- Test: `test_11_scan_no_lock` — run `scan_for_repos` while asserting another git op thread
  proceeds (lock not held). Simpler: assert scan returns expected repos; concurrency already
  covered by T07.

### T7 — Remove dead code (#3)
- Delete `sync_github.py`. Confirm no references (already verified: 0).

## Verification
- `python -m pytest tests/test_suite.py -q` must be fully green (target: all pass, was 1 fail).
- `ruff check .` (if available) clean or no new errors.
- Manual: `python server.py` still boots on 127.0.0.1:3002.

## Out of scope (YAGNI)
- Adding new features. Rewriting to a web framework. Changing the GUI layer.

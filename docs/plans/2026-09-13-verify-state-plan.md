# Plan: GodlikeGitControl — State Verification & Baseline (2026-09-13)

**Status:** ACTIVE — authored from live code state (no prior open plan; all prior
plans archived under `docs/plans/.archive/` with Implemented & Verified).

## Context

The surgical-implementation dispatcher scanned `docs/`, `docs/plans/`, and the repo
root: zero open plan files. All six prior plans are archived as implemented &
verified. The prior code-review (`docs/plans/REVIEW-2026-09-12.txt`) returned
APPROVE with one WARN (broad `except Exception` swallows), which the
immediately-preceding commit `fe037ef` partially addressed (cpu_polling_daemon +
is_safe_path now log via `logging.exception`).

This plan does NOT re-derive finished work. It codifies the current verified
state, closes the remaining review WARN, and re-runs the gate to produce
evidence. Scope is bounded: no new features, no API changes.

## Objectives

| ID | Objective | Validation | Evidence |
|----|-----------|------------|----------|
| OBJ-001 | Confirm workspace identity + clean tree | whoami/hostname/pwd/git remote/git branch; `git status -s` empty | terminal block |
| OBJ-002 | Baseline test suite green | `pytest tests/test_suite.py` exits 0, >=18 real tests, no tautologies | pytest log |
| OBJ-003 | No bare `except Exception:` (no `as e`/`as exc`) | `grep -n "except Exception *:" server.py` returns zero non-`as` hits | grep |
| OBJ-004 | Silent `pass` swallows enumerated | List of every `except Exception as e: pass` site with rationale | plan Findings |
| OBJ-005 | `docs/.scratch-audit/` gitignored | `git check-ignore -v docs/.scratch-audit/` matches `.gitignore:32` | check-ignore |
| OBJ-006 | Token scrub finally logs failures | `_scrub_remote_token` no longer swallows config-write failures | server.py:1163 |
| OBJ-007 | No dead code / stub markers | `rg -i 'todo|fixme|placeholder|not yet implemented' server.py public/js` clean | rg |
| OBJ-008 | Remote HEAD == local HEAD | `git ls-remote origin HEAD` == `git rev-parse HEAD` | ls-remote |
| OBJ-009 | Consistency gate PASS | All planning artifacts agree; <=5 replan cycles | reviewer check |
| OBJ-010 | Final audit + debrief | `docs/plans/2026-09-13-DEBRIEF.txt` written, status READY/WARNINGS | artifact |

## Findings (silent swallow sites)

| Line | Function | Rationale for keeping |
|------|----------|----------------------|
| 159 | repo discovery | dulwich read failure on a non-repo dir is expected; skip |
| 182 | os.walk dir read | permission error on a subdir is expected; skip |
| 557 | hardware probe fallback | optional probe; return None is the defined fallback |
| 574 | `platform.processor()` | Windows-only API; None is acceptable |
| 603/605 | disk enumeration | per-disk probe failure; skip disk |
| 679 | credentials file read | absent file is the not-remembered case |
| 711 | signout file delete | already-best-effort cleanup |
| 723 | `os.makedirs` race | exists-ok pattern |

All eight are best-effort/optional-fallback sites where the silent swallow is
the correct behavior. No functional change proposed for these.

## Verification

1. `whoami && hostname && pwd && git remote -v && git branch --show-current`
2. `git status -s` (expect empty)
3. `python3 -m pytest tests/test_suite.py -q`
4. `grep -n "except Exception *:" server.py | grep -v "as e\|as exc"` (expect empty)
5. `git check-ignore -v docs/.scratch-audit/`
6. `git ls-remote origin HEAD` vs `git rev-parse HEAD`
7. `rg -i 'todo|fixme|placeholder|not yet implemented' server.py public/js` (expect clean)

## Definition of Done

- All ten objectives ticked with evidence.
- Working tree clean (or only this plan + debrief added, committed scoped).
- No push unless PUSH=1.

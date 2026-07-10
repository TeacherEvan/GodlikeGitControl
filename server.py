import os
import json
import urllib.parse
import urllib.request
import urllib.error
import http.server
import socketserver
import io
import time
import platform
import threading
from typing import List, Dict, Tuple, Optional, Any, Union
import psutil
from dulwich.repo import Repo
from dulwich.index import IndexEntry
import dulwich.porcelain as porcelain

PORT = int(os.environ.get("GGC_PORT", 3002))
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")

# Thread-safe cached CPU tracking daemon
cached_cpu_pct = 0.0


def cpu_polling_daemon():
    global cached_cpu_pct
    # Initialize baseline
    psutil.cpu_percent(interval=0.1)
    while True:
        time.sleep(1.0)
        try:
            cached_cpu_pct = psutil.cpu_percent(interval=None)
        except Exception:
            pass


# Global lock to serialize git repository accesses (resolves F-01 concurrency issue)
git_lock = threading.RLock()


def is_safe_path(path_str: Optional[str]) -> bool:
    """Check if the provided path is safe and not pointing to a system directory.

    Args:
        path_str: The directory path to check.

    Returns:
        True if the path is safe, False otherwise.
    """
    if not path_str or "\x00" in path_str:
        return False
    try:
        # Normalize separators to prevent bypasses and false positives (resolves F-02, F-05)
        normalized = path_str.replace("\\", "/")
        real_path = os.path.realpath(normalized)
        blocked_prefixes = [
            "/etc",
            "/proc",
            "/sys",
            "/dev",
            "/boot",
            "/var/log",
            "/var/cache",
            "/root",
            "/bin",
            "/sbin",
            "/lib",
            "/lib64",
            "/usr/bin",
            "/usr/sbin",
        ]
        for prefix in blocked_prefixes:
            if real_path == prefix or real_path.startswith(prefix + "/"):
                return False
        return True
    except Exception:
        return False


def is_safe_relative_path(path_str: Optional[str]) -> bool:
    """Check if the provided file path is a safe relative path.

    Args:
        path_str: The relative file path to check.

    Returns:
        True if the path is relative and safe (does not escape directory boundaries), False otherwise.
    """
    if not path_str or "\x00" in path_str:
        return False
    # Normalize Windows separators (resolves F-02)
    normalized = path_str.replace("\\", "/")
    if normalized.startswith("/") or os.path.isabs(path_str):
        return False
    parts = normalized.split("/")
    if ".." in parts:
        return False
    return True


# Module-Level Business Logic Helpers (resolving static method review findings)
def unstage_file(repo: Repo, path_str: Union[str, bytes]) -> None:
    """Unstage a staged file in the git repository index.

    Args:
        repo: The dulwich Repo object.
        path_str: The file path to unstage.
    """
    with git_lock:
        path_bytes = path_str.encode("utf-8") if isinstance(path_str, str) else path_str
        index = repo.open_index()
        try:
            head_commit: Any = repo[repo.head()]
            head_tree: Any = repo[head_commit.tree]
            mode, sha = head_tree.lookup_path(repo.object_store.__getitem__, path_bytes)
            index[path_bytes] = IndexEntry(
                int(time.time()), int(time.time()), 0, 0, mode, 0, 0, 0, sha, 0
            )
        except Exception:
            try:
                del index[path_bytes]
            except KeyError:
                pass
        index.write()


def scan_for_repos(start_path: str, max_depth: int = 4) -> List[Dict[str, str]]:
    """Scan directory tree for git repositories.

    Args:
        start_path: Root path to begin the scan.
        max_depth: Maximum directory depth for scanning.

    Returns:
        List of dictionaries containing name, path, and active branch of each found repo.

    Note:
        Scanning only reads repository metadata and never mutates; the global
        git_lock is intentionally NOT held during the (potentially long) os.walk
        so concurrent git operations are not blocked for the whole traversal.
    """
    repos = []
    start_path = os.path.abspath(start_path)
    if os.path.exists(os.path.join(start_path, ".git")):
        try:
            r = Repo(start_path)
            branch = porcelain.active_branch(r).decode("utf-8")
            repos.append(
                {
                    "name": os.path.basename(start_path),
                    "path": start_path,
                    "branch": branch,
                }
            )
        except Exception:
            pass
        return repos

    base_depth = start_path.count(os.path.sep)
    for root, dirs, files in os.walk(start_path, followlinks=False):
        cur_depth = root.count(os.path.sep)
        if cur_depth - base_depth >= max_depth:
            dirs[:] = []
            continue

        if ".git" in dirs:
            repo_path = root
            try:
                r = Repo(repo_path)
                branch = porcelain.active_branch(r).decode("utf-8")
                repos.append(
                    {
                        "name": os.path.basename(repo_path) or repo_path,
                        "path": repo_path,
                        "branch": branch,
                    }
                )
            except Exception:
                pass
            dirs.remove(".git")
    return repos


def browse_directory(path: str) -> Dict[str, Any]:
    """List subdirectories and files within the directory path.

    Args:
        path: Path to browse.

    Returns:
        A dictionary containing the current path, parent path, and sorted items list.
    """
    path = os.path.abspath(path)
    if not os.path.exists(path) or not os.path.isdir(path):
        raise Exception("Invalid directory path")

    items = []
    try:
        for entry in os.scandir(path):
            if entry.name.startswith(".") and entry.name != ".git":
                continue
            items.append(
                {"name": entry.name, "isDir": entry.is_dir(), "path": entry.path}
            )
    except PermissionError:
        raise Exception("Permission denied browsing " + path)

    return {
        "currentPath": path,
        "parentPath": os.path.dirname(path),
        "items": sorted(items, key=lambda x: (not x["isDir"], x["name"].lower())),
    }


def get_git_status(repo_path: str) -> Dict[str, Any]:
    """Get the current git status of the repository.

    Args:
        repo_path: Path to the git repository.

    Returns:
        A dictionary containing branch name, dirty status, staged changes, unstaged changes, and untracked files.
    """
    with git_lock:
        r = Repo(repo_path)
        try:
            branch = porcelain.active_branch(r).decode("utf-8")
        except Exception:
            branch = "DETACHED"

        st = porcelain.status(r)

        staged_added = [f.decode("utf-8") for f in st.staged.get("add", [])]
        staged_deleted = [f.decode("utf-8") for f in st.staged.get("delete", [])]
        staged_modified = [f.decode("utf-8") for f in st.staged.get("modify", [])]

        unstaged = [f.decode("utf-8") for f in st.unstaged]
        untracked = [f.decode("utf-8") for f in st.untracked]

        is_dirty = bool(
            staged_added or staged_deleted or staged_modified or unstaged or untracked
        )

        return {
            "branch": branch,
            "isDirty": is_dirty,
            "staged": {
                "add": staged_added,
                "delete": staged_deleted,
                "modify": staged_modified,
            },
            "unstaged": unstaged,
            "untracked": untracked,
        }


def get_git_log(repo_path: str, count: int = 20) -> List[Dict[str, Any]]:
    """Retrieve the recent commit logs of the repository.

    Args:
        repo_path: Path to the git repository.
        count: Maximum number of commits to retrieve.

    Returns:
        A list of commit details containing ID, message, author, and timestamp.
    """
    with git_lock:
        r = Repo(repo_path)
        commits = []
        try:
            walker = r.get_walker(max_entries=count)
            for entry in walker:
                c = entry.commit
                commits.append(
                    {
                        "id": c.id.decode("utf-8"),
                        "message": c.message.decode("utf-8").strip(),
                        "author": c.author.decode("utf-8"),
                        "time": c.commit_time,
                    }
                )
        except KeyError:
            pass
        return commits


def get_git_diff(repo_path: str, file_name: str, staged: bool = False) -> str:
    """Get the diff of a specific file in the repository.

    Args:
        repo_path: Path to the git repository.
        file_name: Name of the file relative to the repository.
        staged: If True, returns staged diff; otherwise unstaged diff.

    Returns:
        The unified diff as a string.
    """
    with git_lock:
        r = Repo(repo_path)
        out = io.BytesIO()
        porcelain.diff(
            r, outstream=out, staged=staged, paths=[file_name.encode("utf-8")]
        )
        return out.getvalue().decode("utf-8")


def _get_cpu_freq() -> Optional[Dict[str, float]]:
    """Retrieve CPU frequency statistics.

    Returns:
        Dictionary with current, min, and max frequency, or None if unavailable.
    """
    try:
        freq = psutil.cpu_freq()
        if freq:
            return {
                "current": round(freq.current, 1),
                "min": round(freq.min, 1) if freq.min else 0.0,
                "max": round(freq.max, 1) if freq.max else 0.0,
            }
    except Exception:
        pass
    return None


def _get_cpu_model() -> str:
    """Retrieve the processor model name.

    Returns:
        Processor model name as a string.
    """
    if platform.system() == "Linux":
        try:
            with open("/proc/cpuinfo", "r") as f:
                for line in f:
                    if "model name" in line:
                        return line.split(":")[1].strip()
        except Exception:
            pass
    return platform.processor() or "Generic Processor"


def _get_disk_info() -> List[Dict[str, Any]]:
    """Retrieve details for non-boot local disk partitions.

    Returns:
        List of partition detail dictionaries containing device, mountpoint, fstype, and usage stats.
    """
    disks = []
    try:
        for part in psutil.disk_partitions(all=False):
            if "loop" in part.device or part.mountpoint.startswith("/boot"):
                continue
            try:
                usage = psutil.disk_usage(part.mountpoint)
                disks.append(
                    {
                        "device": part.device,
                        "mountpoint": part.mountpoint,
                        "fstype": part.fstype,
                        "total": usage.total,
                        "used": usage.used,
                        "free": usage.free,
                        "percent": usage.percent,
                    }
                )
            except Exception:
                pass
    except Exception:
        pass
    return disks


def get_system_hardware() -> Dict[str, Any]:
    """Compile comprehensive system hardware status metrics.

    Returns:
        Dictionary of CPU, memory, disk, and OS uptime details.
    """
    global cached_cpu_pct

    cpu_count = psutil.cpu_count(logical=True) or 1
    cpu_freq = _get_cpu_freq()
    cpu_model = _get_cpu_model()

    mem = psutil.virtual_memory()
    memory_info = {
        "total": mem.total,
        "available": mem.available,
        "used": mem.used,
        "percent": mem.percent,
    }

    disks = _get_disk_info()
    uptime_seconds = time.time() - psutil.boot_time()

    return {
        "cpu": {
            "model": cpu_model,
            "cores": cpu_count,
            "overallPercent": cached_cpu_pct,  # Returns thread-cached non-blocking value instantly
            "frequency": cpu_freq,
        },
        "memory": memory_info,
        "disks": disks,
        "system": {
            "os": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "uptime": int(uptime_seconds),
        },
    }


# --- GitHub Integration Business Logic Helpers ---
session_token = None


def get_config_path() -> str:
    """Get the absolute path to the local credentials config file.

    Returns:
        The configuration file path.
    """
    return os.path.expanduser("~/.config/ggc/credentials.json")


def load_saved_token() -> Optional[str]:
    """Load the saved GitHub token from local storage or memory.

    Returns:
        The token string if found, otherwise None.
    """
    global session_token
    if session_token:
        return session_token
    config_path = get_config_path()
    if os.path.exists(config_path):
        try:
            with open(config_path, "r") as f:
                data = json.load(f)
                return data.get("token")
        except Exception:
            pass
    return None


def save_token(token: str, remember_me: bool) -> None:
    """Save the GitHub token to local storage or memory.

    Args:
        token: The GitHub Personal Access Token.
        remember_me: If True, saves to file system; if False, saves to in-memory session.
    """
    global session_token
    if remember_me:
        config_path = get_config_path()
        try:
            os.makedirs(os.path.dirname(config_path), exist_ok=True)
            # Open with secure permissions 0o600 from creation (resolves SEC-02)
            flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
            mode = 0o600
            fd = os.open(config_path, flags, mode)
            with open(fd, "w") as f:
                json.dump({"token": token}, f)
        except Exception as e:
            raise Exception(f"Failed to save credentials locally: {e}")
    else:
        session_token = token
        # Clean up any existing config file to avoid confusion
        config_path = get_config_path()
        if os.path.exists(config_path):
            try:
                os.remove(config_path)
            except Exception:
                pass


def delete_saved_token() -> None:
    """Delete the saved GitHub token from local storage and memory."""
    global session_token
    session_token = None
    config_path = get_config_path()
    if os.path.exists(config_path):
        try:
            os.remove(config_path)
        except Exception:
            pass


def _github_api(
    method: str,
    url: str,
    token: Optional[str] = None,
    body: Optional[Dict[str, Any]] = None,
    timeout: float = 5.0,
    capture_headers: bool = False,
) -> Any:
    """Perform a GitHub REST API call with the standard auth/accept/UA headers.

    Args:
        method: HTTP method (GET, POST, ...).
        url: Fully-qualified GitHub API URL.
        token: Optional bearer token; redacted from any raised error string.
        body: Optional JSON-serializable request body (forces Content-Type: application/json).
        timeout: Socket timeout in seconds.
        capture_headers: If True, return (parsed_json, headers_dict) instead of parsed_json.

    Returns:
        Parsed JSON (dict/list) on success, or (parsed_json, headers) when capture_headers.

    Raises:
        Exception: with the raw token redacted (SEC-01) for transport/HTTP errors.
    """
    data_bytes = None
    if body is not None:
        data_bytes = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data_bytes, method=method)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    req.add_header("User-Agent", "GodlikeGitControl-Server")
    if data_bytes is not None:
        req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw) if raw else None
            if capture_headers:
                return parsed, dict(response.headers)
            return parsed
    except urllib.error.HTTPError as e:
        # Surface the status; redact token from reason text (SEC-01)
        reason = str(e.reason).replace(token or "", "[REDACTED]") if token else str(e.reason)
        try:
            err_body = json.loads(e.read().decode("utf-8"))
            detail = err_body.get("message", reason)
        except Exception:
            detail = reason
        raise Exception(f"GitHub API Error: {e.code} - {detail}")
    except Exception as e:
        msg = str(e).replace(token or "", "[REDACTED]") if token else str(e)
        raise Exception(f"Failed to reach GitHub API: {msg}")


def fetch_github_profile(token: str) -> Dict[str, Any]:
    """Fetch the GitHub profile details for the given token.

    Args:
        token: The GitHub Personal Access Token.

    Returns:
        Profile details dictionary containing authentication status, user information, and OAuth scopes.
    """
    if os.environ.get("GGC_TESTING") == "true":
        if token == "invalid-token":
            return {"authenticated": False, "error": "Invalid token or unauthorized"}
        return {
            "authenticated": True,
            "user": {
                "login": "stoic-test",
                "name": "Stoic Test User",
                "avatar_url": "https://avatars.githubusercontent.com/u/12345?v=4",
                "html_url": "https://github.com/stoic-test",
                "public_repos": 5,
                "bio": "Testing git control",
            },
            "scopes": ["repo", "read:user"],
        }
    try:
        data, headers = _github_api(
            "GET", "https://api.github.com/user", token, capture_headers=True
        )
        scopes_header = headers.get("X-OAuth-Scopes", "")
        scopes = [s.strip() for s in scopes_header.split(",") if s.strip()]
        return {
            "authenticated": True,
            "user": {
                "login": data.get("login"),
                "name": data.get("name") or data.get("login"),
                "avatar_url": data.get("avatar_url"),
                "html_url": data.get("html_url"),
                "public_repos": data.get("public_repos", 0),
                "bio": data.get("bio") or "",
            },
            "scopes": scopes,
        }
    except Exception as e:
        msg = str(e)
        if "401" in msg or "403" in msg:
            return {"authenticated": False, "error": "Invalid token or unauthorized"}
        raise


def _get_token_from_request(handler: Any) -> Optional[str]:
    """Retrieve the GitHub token from the request headers or local storage.

    Args:
        handler: The HTTP request handler instance.

    Returns:
        The token string if found, otherwise None.
    """
    token = handler.headers.get("X-GitHub-Token")
    if not token:
        token = load_saved_token()
    return token


def get_repo_remote_url(repo_path: str) -> Optional[str]:
    """Retrieve the URL of the remote origin for the repository.

    Args:
        repo_path: Path to the git repository.

    Returns:
        The remote URL as a string, or None if not configured.
    """
    with git_lock:
        try:
            r = Repo(repo_path)
            config = r.get_config()
            try:
                url_bytes = config.get((b"remote", b"origin"), b"url")
                return url_bytes.decode("utf-8")
            except KeyError:
                return None
        except Exception:
            return None


def parse_github_remote(url: Optional[str]) -> Optional[Dict[str, str]]:
    """Parse a GitHub remote URL into owner and repository name.

    Args:
        url: Remote URL string.

    Returns:
        A dictionary with "owner" and "repo" keys if valid, otherwise None.
    """
    if not url:
        return None
    url_str = url.strip()
    if "github.com" not in url_str:
        return None

    path = ""
    if url_str.startswith("git@github.com:"):
        path = url_str.split("git@github.com:")[1]
    elif url_str.startswith("git@github.com/"):
        path = url_str.split("git@github.com/")[1]
    elif "github.com/" in url_str:
        path = url_str.split("github.com/")[1]

    if path:
        if path.endswith(".git"):
            path = path[:-4]
        parts = path.split("/")
        if len(parts) >= 2:
            return {"owner": parts[0], "repo": parts[1]}
    return None


def get_local_active_branch_and_sha(repo_path: str) -> Tuple[str, Optional[str]]:
    """Get the active local branch name and its head SHA.

    Args:
        repo_path: Path to the git repository.

    Returns:
        A tuple of (active_branch_name, head_sha).
    """
    with git_lock:
        r = Repo(repo_path)
        try:
            active_branch_bytes = porcelain.active_branch(r)
            active_branch = active_branch_bytes.decode("utf-8")
        except Exception:
            active_branch = "master"
        try:
            head_sha = r.head().decode("utf-8")
        except Exception:
            head_sha = None
        return active_branch, head_sha


def fetch_github_branch_head(
    token: str, owner: str, repo: str, branch: str
) -> Optional[str]:
    """Fetch the latest commit SHA for a specific branch from the GitHub API.

    Args:
        token: GitHub Personal Access Token.
        owner: Repository owner.
        repo: Repository name.
        branch: Branch name.

    Returns:
        The head commit SHA string if found, otherwise None.
    """
    if os.environ.get("GGC_TESTING") == "true":
        return "1234567890abcdef1234567890abcdef12345678"
    url = f"https://api.github.com/repos/{owner}/{repo}/branches/{urllib.parse.quote(branch)}"
    try:
        data = _github_api("GET", url, token)
        return data.get("commit", {}).get("sha") if data else None
    except Exception as e:
        msg = str(e)
        if "404" in msg:
            return None
        raise


def is_ancestor(repo: Repo, ancestor_sha: str, descendant_sha: str) -> bool:
    """Check if one commit is an ancestor of another in the repository history.

    Args:
        repo: Dulwich Repo instance.
        ancestor_sha: The commit SHA we want to check as ancestor.
        descendant_sha: The commit SHA we want to check as descendant.

    Returns:
        True if ancestor_sha is a parent/ancestor of descendant_sha, False otherwise.
    """
    try:
        ancestor_bytes = ancestor_sha.encode("utf-8")
        descendant_bytes = descendant_sha.encode("utf-8")
        if ancestor_bytes == descendant_bytes:
            return True

        visited = set()
        queue = [descendant_bytes]
        while queue:
            curr = queue.pop(0)
            if curr == ancestor_bytes:
                return True
            if curr in visited:
                continue
            visited.add(curr)
            try:
                commit: Any = repo[curr]
                for parent in commit.parents:
                    if parent not in visited:
                        queue.append(parent)
            except KeyError:
                pass
        return False
    except Exception:
        return False


def count_commits_between(repo: Repo, base_sha: str, target_sha: str) -> int:
    """Count the number of commits between base_sha and target_sha.

    Args:
        repo: Dulwich Repo instance.
        base_sha: The starting/older commit SHA.
        target_sha: The ending/newer commit SHA.

    Returns:
        The number of commits separating them (minimum 1 if diverged/not ancestor).
    """
    try:
        base_bytes = base_sha.encode("utf-8")
        target_bytes = target_sha.encode("utf-8")
        if base_bytes == target_bytes:
            return 0

        visited = set()
        queue = [(target_bytes, 0)]
        while queue:
            curr, count = queue.pop(0)
            if curr == base_bytes:
                return count
            if curr in visited:
                continue
            visited.add(curr)
            try:
                commit: Any = repo[curr]
                for parent in commit.parents:
                    if parent not in visited:
                        queue.append((parent, count + 1))
            except KeyError:
                pass
        return 1
    except Exception:
        return 1


def calculate_sync_status(
    repo_path: str, token: str, owner: str, repo: str
) -> Dict[str, Any]:
    """Calculate whether the local repository branch is synced, ahead, behind, or diverged.

    Args:
        repo_path: Path to the local git repository.
        token: GitHub Personal Access Token.
        owner: Repository owner.
        repo: Repository name.

    Returns:
        A dictionary containing the status, message, and details (ahead/behind counts).
    """
    with git_lock:
        r = Repo(repo_path)
        branch, local_sha = get_local_active_branch_and_sha(repo_path)
        if not local_sha:
            return {"status": "Empty", "message": "No commits in local repository"}

        remote_sha = fetch_github_branch_head(token, owner, repo, branch)
        if not remote_sha:
            return {
                "status": "NotOnRemote",
                "message": f"Branch '{branch}' not found on remote",
                "localSha": local_sha,
            }

        if local_sha == remote_sha:
            return {
                "status": "Synced",
                "message": "Up to date with GitHub",
                "localSha": local_sha,
                "remoteSha": remote_sha,
            }

        if is_ancestor(r, remote_sha, local_sha):
            ahead_count = count_commits_between(r, remote_sha, local_sha)
            return {
                "status": "Ahead",
                "message": f"Ahead of GitHub by {ahead_count} commit(s)",
                "count": ahead_count,
                "localSha": local_sha,
                "remoteSha": remote_sha,
            }
        elif is_ancestor(r, local_sha, remote_sha):
            behind_count = count_commits_between(r, local_sha, remote_sha)
            return {
                "status": "Behind",
                "message": f"Behind GitHub by {behind_count} commit(s)",
                "count": behind_count,
                "localSha": local_sha,
                "remoteSha": remote_sha,
            }
        else:
            return {
                "status": "Diverged",
                "message": "Local and remote branch have diverged",
                "localSha": local_sha,
                "remoteSha": remote_sha,
            }


def fetch_github_issues_prs(token: str, owner: str, repo: str) -> Dict[str, Any]:
    """Fetch open issues and pull requests from GitHub for the repository.

    Args:
        token: GitHub Personal Access Token.
        owner: Repository owner.
        repo: Repository name.

    Returns:
        A dictionary with "issues" and "prs" lists.
    """
    if os.environ.get("GGC_TESTING") == "true":
        return {
            "issues": [
                {
                    "number": 1,
                    "title": "Test Issue 1",
                    "html_url": "https://github.com/issues/1",
                    "user": "stoic-test",
                    "created_at": "2026-07-03T12:00:00Z",
                }
            ],
            "prs": [
                {
                    "number": 2,
                    "title": "Test PR 1",
                    "html_url": "https://github.com/pulls/2",
                    "user": "stoic-test",
                    "created_at": "2026-07-03T12:00:00Z",
                }
            ],
        }
    url = f"https://api.github.com/repos/{owner}/{repo}/issues?state=open&per_page=10"
    try:
        items = _github_api("GET", url, token)
        if not items:
            return {"issues": [], "prs": []}
        issues: List[Dict[str, Any]] = []
        prs: List[Dict[str, Any]] = []
        for item in items:
            is_pr = "pull_request" in item
            obj = {
                "number": item.get("number"),
                "title": item.get("title"),
                "html_url": item.get("html_url"),
                "user": item.get("user", {}).get("login"),
                "created_at": item.get("created_at"),
            }
            if is_pr:
                if len(prs) < 3:
                    prs.append(obj)
            else:
                if len(issues) < 3:
                    issues.append(obj)
        return {"issues": issues, "prs": prs}
    except Exception as e:
        raise Exception(f"Failed to fetch issues/PRs from GitHub: {e}")


def _scrub_remote_token(repo_path: str, parsed: Dict[str, str]) -> None:
    """Reset origin.url in .git/config to a token-free HTTPS URL (resolves BUG#2).

    The authenticated URL carrying the PAT is only used for the network call; the
    persisted remote must never contain the credential at rest.
    """
    try:
        r = Repo(repo_path)
        config = r.get_config()
        clean_url = (
            f"https://github.com/{parsed['owner']}/{parsed['repo']}.git".encode("utf-8")
        )
        config.set((b"remote", b"origin"), b"url", clean_url)
        config.write_to_path()
    except Exception:
        pass


def _build_auth_url(parsed: Dict[str, str], token: str) -> str:
    """Build the authenticated remote URL used for the network call."""
    return f"https://{parsed['owner']}:{token}@github.com/{parsed['owner']}/{parsed['repo']}.git"


def _sync_with_github(repo_path: str, token: str, op: str) -> None:
    """Push or pull local changes to/from the remote GitHub repository.

    Args:
        repo_path: Path to the local git repository.
        token: GitHub Personal Access Token.
        op: Either "push" or "pull".

    Note:
        The username is derived from the remote owner (resolves #8 — no extra
        profile network call). The PAT is redacted from exception strings (SEC-01)
        and scrubbed from .git/config afterwards (BUG#2).
    """
    if os.environ.get("GGC_TESTING") == "true":
        return
    if op not in ("push", "pull"):
        raise Exception(f"Unsupported sync operation: {op}")
    with git_lock:
        r = Repo(repo_path)
        url = get_repo_remote_url(repo_path)
        if not url:
            raise Exception("No remote URL configured.")
        parsed = parse_github_remote(url)
        if not parsed:
            raise Exception("Remote is not a GitHub repository.")

        auth_url = _build_auth_url(parsed, token)
        try:
            branch_bytes = porcelain.active_branch(r)
        except Exception:
            branch_bytes = b"master"

        refspec = f"refs/heads/{branch_bytes.decode('utf-8')}:refs/heads/{branch_bytes.decode('utf-8')}".encode(
            "utf-8"
        )
        try:
            if op == "push":
                porcelain.push(r, auth_url, refspec)
            else:
                porcelain.pull(r, auth_url, refspec)
        except Exception as e:
            # Redact raw token from any returned exception string (resolves SEC-01)
            raise Exception(str(e).replace(token, "[REDACTED]")) from e
        finally:
            # Always scrub the token from persisted config, even on failure (BUG#2)
            _scrub_remote_token(repo_path, parsed)


def push_to_github(repo_path: str, token: str) -> None:
    """Push local changes to the remote GitHub repository.

    Args:
        repo_path: Path to the local git repository.
        token: GitHub Personal Access Token.
    """
    _sync_with_github(repo_path, token, "push")


def pull_from_github(repo_path: str, token: str) -> None:
    """Pull remote changes from the GitHub repository.

    Args:
        repo_path: Path to the local git repository.
        token: GitHub Personal Access Token.
    """
    _sync_with_github(repo_path, token, "pull")


def create_github_repo_api(token: str, name: str, private: bool) -> str:
    """Call the GitHub API to create a new repository.

    Args:
        token: GitHub Personal Access Token.
        name: Name of the repository to create.
        private: Whether the repository should be private.

    Returns:
        The repository's HTTP clone URL.
    """
    if os.environ.get("GGC_TESTING") == "true":
        return f"https://github.com/stoic-test/{name}.git"
    url = "https://api.github.com/user/repos"
    body = {
        "name": name,
        "private": private,
        "description": "Created via God's Git-Control",
    }
    try:
        data = _github_api("POST", url, token, body)
        return data["clone_url"]
    except Exception as e:
        msg = str(e)
        if "GitHub API Error" in msg:
            raise
        raise Exception(f"GitHub repo creation failed: {msg}")


def link_and_push_github_repo(repo_path: str, clone_url: str, token: str) -> None:
    """Set the remote origin URL of a repository and push local branch to it.

    Args:
        repo_path: Path to the local repository.
        clone_url: Clone URL of the newly created remote repository.
        token: GitHub Personal Access Token.
    """
    with git_lock:
        r = Repo(repo_path)
        config = r.get_config()
        config.set((b"remote", b"origin"), b"url", clone_url.encode("utf-8"))
        config.set(
            (b"remote", b"origin"), b"fetch", b"+refs/heads/*:refs/remotes/origin/*"
        )
        config.write_to_path()
        push_to_github(repo_path, token)


# Threaded HTTP Server (resolves single-threaded blocking findings)
class ThreadingTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True


class GitControlRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    # Removed Access-Control-Allow-Origin: * to resolve the unrestricted CORS vulnerability

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)

        if path.startswith("/api/"):
            self.handle_api_get(path, query)
        else:
            if path == "/sw.js":
                self.path = "/sw.js"
            super().do_GET()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        if path.startswith("/api/"):
            content_type = self.headers.get("Content-Type", "")
            if not content_type.startswith("application/json"):
                self.send_json(
                    {
                        "success": False,
                        "error": "Content-Type must be application/json",
                    },
                    400,
                )
                return

            origin = self.headers.get("Origin")
            referer = self.headers.get("Referer")
            allowed_hosts = ["localhost", "127.0.0.1"]

            # Requiring at least one of Origin or Referer to prevent header-stripping CSRF bypass (resolves F-03)
            if not origin and not referer:
                self.send_json(
                    {
                        "success": False,
                        "error": "Missing Origin and Referer headers (CSRF protection)",
                    },
                    400,
                )
                return

            def is_allowed(url_str):
                if not url_str:
                    return True
                parsed = urllib.parse.urlparse(url_str)
                hostname = parsed.hostname
                return hostname in allowed_hosts

            if not is_allowed(origin) or not is_allowed(referer):
                self.send_json(
                    {
                        "success": False,
                        "error": "Unauthorized origin (CSRF protection)",
                    },
                    403,
                )
                return

            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            try:
                body = json.loads(post_data.decode("utf-8")) if post_data else {}
            except Exception:
                body = {}
            self.handle_api_post(path, body)
        else:
            self.send_error(404, "Not Found")

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def handle_api_get(self, path, query):
        try:
            routes = {
                "/api/fs/scan": self._api_fs_scan,
                "/api/fs/browse": self._api_fs_browse,
                "/api/git/status": self._api_git_status,
                "/api/git/log": self._api_git_log,
                "/api/git/diff": self._api_git_diff,
                "/api/system/hardware": self._api_system_hardware,
                "/api/github/profile": self._api_github_profile,
                "/api/github/remote": self._api_github_remote,
                "/api/github/sync_status": self._api_github_sync_status,
                "/api/github/issues_prs": self._api_github_issues_prs,
            }
            handler = routes.get(path)
            if handler:
                handler(query)
            else:
                self.send_json({"success": False, "error": "Endpoint not found"}, 404)
        except Exception as e:
            self.send_json({"success": False, "error": str(e)}, 500)

    def _api_fs_scan(self, query):
        scan_path = query.get("path", [os.path.expanduser("~")])[0]
        if not is_safe_path(scan_path):
            return self.send_json(
                {"success": False, "error": "Invalid or unauthorized path"}, 400
            )
        repos = scan_for_repos(scan_path)
        self.send_json({"success": True, "repos": repos})

    def _api_fs_browse(self, query):
        browse_path = query.get("path", [os.path.expanduser("~")])[0]
        if not is_safe_path(browse_path):
            return self.send_json(
                {"success": False, "error": "Invalid or unauthorized path"}, 400
            )
        data = browse_directory(browse_path)
        self.send_json({"success": True, "data": data})

    def _api_git_status(self, query):
        repo_path = query.get("path", [""])[0]
        if not repo_path:
            return self.send_json(
                {"success": False, "error": "Path parameter required"}, 400
            )
        if not is_safe_path(repo_path):
            return self.send_json(
                {"success": False, "error": "Invalid or unauthorized path"}, 400
            )

        status_info = get_git_status(repo_path)
        self.send_json({"success": True, "status": status_info})

    def _api_git_log(self, query):
        repo_path = query.get("path", [""])[0]
        if not repo_path:
            return self.send_json(
                {"success": False, "error": "Path parameter required"}, 400
            )
        if not is_safe_path(repo_path):
            return self.send_json(
                {"success": False, "error": "Invalid or unauthorized path"}, 400
            )

        commits = get_git_log(repo_path)
        self.send_json({"success": True, "commits": commits})

    def _api_git_diff(self, query):
        repo_path = query.get("path", [""])[0]
        file_name = query.get("file", [""])[0]
        staged_str = query.get("staged", ["false"])[0]
        staged = staged_str.lower() == "true"

        if not repo_path or not file_name:
            return self.send_json(
                {"success": False, "error": "Path and file parameters required"}, 400
            )
        if not is_safe_path(repo_path):
            return self.send_json(
                {"success": False, "error": "Invalid or unauthorized path"}, 400
            )
        if not is_safe_relative_path(file_name):
            return self.send_json(
                {"success": False, "error": "Invalid or unauthorized file path"}, 400
            )

        diff_content = get_git_diff(repo_path, file_name, staged)
        self.send_json({"success": True, "diff": diff_content})

    def _api_system_hardware(self, query):
        hardware_info = get_system_hardware()
        self.send_json({"success": True, "hardware": hardware_info})

    def _api_github_profile(self, query):
        token = _get_token_from_request(self)
        if not token:
            return self.send_json({"success": True, "authenticated": False})
        try:
            result = fetch_github_profile(token)
            self.send_json({"success": True, **result})
        except Exception as e:
            self.send_json({"success": False, "error": str(e)}, 500)

    def _resolve_github_repo(self, repo_path: str):
        """Validate a repo path and resolve its authenticated GitHub remote.

        Performs the shared guard preamble used by the github status/issues handlers:
        path presence, path safety, token presence, remote presence, GitHub-ness.
        On any failure sends the appropriate JSON error and returns None; otherwise
        returns the (token, parsed_remote) tuple.
        """
        if not repo_path:
            self.send_json({"success": False, "error": "Path parameter required"}, 400)
            return None
        if not is_safe_path(repo_path):
            self.send_json(
                {"success": False, "error": "Invalid or unauthorized path"}, 400
            )
            return None

        token = _get_token_from_request(self)
        if not token:
            self.send_json(
                {"success": False, "error": "GitHub authentication required"}, 401
            )
            return None

        url = get_repo_remote_url(repo_path)
        if not url:
            self.send_json({"success": False, "error": "No remote configured"}, 400)
            return None

        parsed = parse_github_remote(url)
        if not parsed:
            self.send_json(
                {"success": False, "error": "Remote is not a GitHub repository"}, 400
            )
            return None
        return token, parsed

    def _api_github_remote(self, query):
        repo_path = query.get("path", [""])[0]
        if not repo_path:
            return self.send_json(
                {"success": False, "error": "Path parameter required"}, 400
            )
        if not is_safe_path(repo_path):
            return self.send_json(
                {"success": False, "error": "Invalid or unauthorized path"}, 400
            )

        url = get_repo_remote_url(repo_path)
        if not url:
            return self.send_json({"success": True, "hasRemote": False})

        parsed = parse_github_remote(url)
        if parsed:
            self.send_json(
                {
                    "success": True,
                    "hasRemote": True,
                    "isGitHub": True,
                    "remoteUrl": url,
                    "owner": parsed["owner"],
                    "repo": parsed["repo"],
                }
            )
        else:
            self.send_json(
                {
                    "success": True,
                    "hasRemote": True,
                    "isGitHub": False,
                    "remoteUrl": url,
                }
            )

    def _api_github_sync_status(self, query):
        repo_path = query.get("path", [""])[0]
        resolved = self._resolve_github_repo(repo_path)
        if not resolved:
            return
        token, parsed = resolved

        try:
            status = calculate_sync_status(
                repo_path, token, parsed["owner"], parsed["repo"]
            )
            self.send_json({"success": True, "sync": status})
        except Exception as e:
            self.send_json({"success": False, "error": str(e)}, 500)

    def _api_github_issues_prs(self, query):
        repo_path = query.get("path", [""])[0]
        resolved = self._resolve_github_repo(repo_path)
        if not resolved:
            return
        token, parsed = resolved

        try:
            data = fetch_github_issues_prs(token, parsed["owner"], parsed["repo"])
            self.send_json({"success": True, **data})
        except Exception as e:
            self.send_json({"success": False, "error": str(e)}, 500)

    def handle_api_post(self, path, body):
        try:
            if path == "/api/github/signin":
                return self._api_github_signin(body)
            elif path == "/api/github/signout":
                return self._api_github_signout(body)

            repo_path = body.get("path")
            if not repo_path:
                return self.send_json(
                    {"success": False, "error": "Path parameter required"}, 400
                )
            if not is_safe_path(repo_path):
                return self.send_json(
                    {"success": False, "error": "Invalid or unauthorized path"}, 400
                )

            routes = {
                "/api/git/stage": self._api_git_stage,
                "/api/git/unstage": self._api_git_unstage,
                "/api/git/commit": self._api_git_commit,
                "/api/github/push": self._api_github_push,
                "/api/github/pull": self._api_github_pull,
                "/api/github/publish": self._api_github_publish,
            }
            handler = routes.get(path)
            if handler:
                handler(repo_path, body)
            else:
                self.send_json({"success": False, "error": "Endpoint not found"}, 404)
        except Exception as e:
            self.send_json({"success": False, "error": str(e)}, 500)

    def _api_git_stage(self, repo_path, body):
        files = body.get("files", [])
        if not files:
            return self.send_json(
                {"success": False, "error": "Files parameter required"}, 400
            )
        for f in files:
            if not is_safe_relative_path(f):
                return self.send_json(
                    {"success": False, "error": "Invalid or unauthorized file path"},
                    400,
                )

        with git_lock:
            r = Repo(repo_path)
            rel_files = [f.encode("utf-8") for f in files]
            porcelain.add(r, rel_files)
        self.send_json({"success": True})

    def _api_git_unstage(self, repo_path, body):
        files = body.get("files", [])
        if not files:
            return self.send_json(
                {"success": False, "error": "Files parameter required"}, 400
            )
        for f in files:
            if not is_safe_relative_path(f):
                return self.send_json(
                    {"success": False, "error": "Invalid or unauthorized file path"},
                    400,
                )

        with git_lock:
            r = Repo(repo_path)
            for f in files:
                unstage_file(r, f)
        self.send_json({"success": True})

    def _api_git_commit(self, repo_path, body):
        message = body.get("message")
        if not message:
            return self.send_json(
                {"success": False, "error": "Commit message required"}, 400
            )

        with git_lock:
            r = Repo(repo_path)
            try:
                author = porcelain.get_user_identity(r.get_config_stack())
            except Exception:
                author = b"Godlike Controller <git@god.control>"

            porcelain.commit(r, message=message.encode("utf-8"), author=author)
        self.send_json({"success": True})

    def _api_github_signin(self, body):
        token = body.get("token")
        remember_me = body.get("rememberMe", False)
        if not token:
            return self.send_json({"success": False, "error": "Token is required"}, 400)
        try:
            result = fetch_github_profile(token)
            if not result.get("authenticated"):
                return self.send_json(
                    {
                        "success": False,
                        "error": result.get("error", "Authentication failed"),
                    },
                    401,
                )
            save_token(token, remember_me)
            self.send_json({"success": True, **result})
        except Exception as e:
            self.send_json({"success": False, "error": str(e)}, 500)

    def _api_github_signout(self, body):
        try:
            delete_saved_token()
            self.send_json({"success": True})
        except Exception as e:
            self.send_json({"success": False, "error": str(e)}, 500)

    def _api_github_push(self, repo_path, body):
        token = body.get("token") or _get_token_from_request(self)
        if not token:
            return self.send_json(
                {"success": False, "error": "GitHub authentication required"}, 401
            )
        try:
            push_to_github(repo_path, token)
            self.send_json({"success": True})
        except Exception as e:
            self.send_json({"success": False, "error": str(e)}, 500)

    def _api_github_pull(self, repo_path, body):
        token = body.get("token") or _get_token_from_request(self)
        if not token:
            return self.send_json(
                {"success": False, "error": "GitHub authentication required"}, 401
            )
        try:
            pull_from_github(repo_path, token)
            self.send_json({"success": True})
        except Exception as e:
            self.send_json({"success": False, "error": str(e)}, 500)

    def _api_github_publish(self, repo_path, body):
        token = body.get("token") or _get_token_from_request(self)
        name = body.get("name")
        private = body.get("private", False)
        if not token:
            return self.send_json(
                {"success": False, "error": "GitHub authentication required"}, 401
            )
        if not name:
            return self.send_json(
                {"success": False, "error": "Repository name is required"}, 400
            )
        try:
            clone_url = create_github_repo_api(token, name, private)
            link_and_push_github_repo(repo_path, clone_url, token)
            self.send_json({"success": True, "cloneUrl": clone_url})
        except Exception as e:
            self.send_json({"success": False, "error": str(e)}, 500)


if __name__ == "__main__":
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    # Start CPU caching thread only when running the server main program (resolves F-06)
    threading.Thread(target=cpu_polling_daemon, daemon=True).start()
    handler = GitControlRequestHandler
    with ThreadingTCPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"God's Git-Control Server starting on http://127.0.0.1:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer shutting down.")

import os
import json
import urllib.parse
import http.server
import socketserver
import io
import time
import platform
import threading
import psutil
from dulwich.repo import Repo
from dulwich.index import IndexEntry
import dulwich.porcelain as porcelain

PORT = 3002
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

# Start CPU caching thread
threading.Thread(target=cpu_polling_daemon, daemon=True).start()

# Module-Level Business Logic Helpers (resolving static method review findings)
def unstage_file(repo, path_str):
    path_bytes = path_str.encode('utf-8') if isinstance(path_str, str) else path_str
    index = repo.open_index()
    try:
        head_commit = repo[repo.head()]
        head_tree = repo[head_commit.tree]
        mode, sha = head_tree.lookup_path(repo.object_store.__getitem__, path_bytes)
        index[path_bytes] = IndexEntry(
            int(time.time()),
            int(time.time()),
            0,
            0,
            mode,
            0,
            0,
            0,
            sha,
            0
        )
    except Exception:
        try:
            del index[path_bytes]
        except KeyError:
            pass
    index.write()

def scan_for_repos(start_path, max_depth=4):
    repos = []
    start_path = os.path.abspath(start_path)
    if os.path.exists(os.path.join(start_path, ".git")):
        try:
            r = Repo(start_path)
            branch = porcelain.active_branch(r).decode('utf-8')
            repos.append({"name": os.path.basename(start_path), "path": start_path, "branch": branch})
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
                branch = porcelain.active_branch(r).decode('utf-8')
                repos.append({
                    "name": os.path.basename(repo_path) or repo_path,
                    "path": repo_path,
                    "branch": branch
                })
            except Exception:
                pass
            dirs.remove(".git")
    return repos

def browse_directory(path):
    path = os.path.abspath(path)
    if not os.path.exists(path) or not os.path.isdir(path):
        raise Exception("Invalid directory path")

    items = []
    try:
        for entry in os.scandir(path):
            if entry.name.startswith(".") and entry.name != ".git":
                continue
            items.append({
                "name": entry.name,
                "isDir": entry.is_dir(),
                "path": entry.path
            })
    except PermissionError:
        raise Exception("Permission denied browsing " + path)

    return {
        "currentPath": path,
        "parentPath": os.path.dirname(path),
        "items": sorted(items, key=lambda x: (not x["isDir"], x["name"].lower()))
    }

def get_git_status(repo_path):
    r = Repo(repo_path)
    try:
        branch = porcelain.active_branch(r).decode('utf-8')
    except Exception:
        branch = "DETACHED"

    st = porcelain.status(r)
    
    staged_added = [f.decode('utf-8') for f in st.staged.get('add', [])]
    staged_deleted = [f.decode('utf-8') for f in st.staged.get('delete', [])]
    staged_modified = [f.decode('utf-8') for f in st.staged.get('modify', [])]
    
    unstaged = [f.decode('utf-8') for f in st.unstaged]
    untracked = [f.decode('utf-8') for f in st.untracked]

    is_dirty = bool(staged_added or staged_deleted or staged_modified or unstaged or untracked)

    return {
        "branch": branch,
        "isDirty": is_dirty,
        "staged": {
            "add": staged_added,
            "delete": staged_deleted,
            "modify": staged_modified
        },
        "unstaged": unstaged,
        "untracked": untracked
    }

def get_git_log(repo_path, count=20):
    r = Repo(repo_path)
    commits = []
    try:
        walker = r.get_walker(max_entries=count)
        for entry in walker:
            c = entry.commit
            commits.append({
                "id": c.id.decode('utf-8'),
                "message": c.message.decode('utf-8').strip(),
                "author": c.author.decode('utf-8'),
                "time": c.commit_time
            })
    except KeyError:
        pass
    return commits

def get_git_diff(repo_path, file_name, staged=False):
    r = Repo(repo_path)
    out = io.BytesIO()
    porcelain.diff(r, outstream=out, staged=staged, paths=[file_name.encode('utf-8')])
    return out.getvalue().decode('utf-8')

def get_system_hardware():
    global cached_cpu_pct
    
    cpu_count = psutil.cpu_count(logical=True)
    cpu_freq = None
    try:
        freq = psutil.cpu_freq()
        if freq:
            cpu_freq = {
                "current": round(freq.current, 1),
                "min": round(freq.min, 1) if freq.min else 0,
                "max": round(freq.max, 1) if freq.max else 0
            }
    except Exception:
        pass

    cpu_model = "Unknown CPU"
    if platform.system() == "Linux":
        try:
            with open("/proc/cpuinfo", "r") as f:
                for line in f:
                    if "model name" in line:
                        cpu_model = line.split(":")[1].strip()
                        break
        except Exception:
            pass
    else:
        cpu_model = platform.processor() or "Generic Processor"

    mem = psutil.virtual_memory()
    memory_info = {
        "total": mem.total,
        "available": mem.available,
        "used": mem.used,
        "percent": mem.percent
    }

    disks = []
    try:
        for part in psutil.disk_partitions(all=False):
            if "loop" in part.device or part.mountpoint.startswith("/boot"):
                continue
            try:
                usage = psutil.disk_usage(part.mountpoint)
                disks.append({
                    "device": part.device,
                    "mountpoint": part.mountpoint,
                    "fstype": part.fstype,
                    "total": usage.total,
                    "used": usage.used,
                    "free": usage.free,
                    "percent": usage.percent
                })
            except Exception:
                pass
    except Exception:
        pass

    uptime_seconds = time.time() - psutil.boot_time()
    
    return {
        "cpu": {
            "model": cpu_model,
            "cores": cpu_count,
            "overallPercent": cached_cpu_pct, # Returns thread-cached non-blocking value instantly
            "frequency": cpu_freq
        },
        "memory": memory_info,
        "disks": disks,
        "system": {
            "os": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "uptime": int(uptime_seconds)
        }
    }

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
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                body = json.loads(post_data.decode('utf-8')) if post_data else {}
            except Exception:
                body = {}
            self.handle_api_post(path, body)
        else:
            self.send_error(404, "Not Found")

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def handle_api_get(self, path, query):
        try:
            if path == "/api/fs/scan":
                scan_path = query.get("path", [os.path.expanduser("~")])[0]
                repos = scan_for_repos(scan_path)
                self.send_json({"success": True, "repos": repos})

            elif path == "/api/fs/browse":
                browse_path = query.get("path", [os.path.expanduser("~")])[0]
                data = browse_directory(browse_path)
                self.send_json({"success": True, "data": data})

            elif path == "/api/git/status":
                repo_path = query.get("path", [""])[0]
                if not repo_path:
                    return self.send_json({"success": False, "error": "Path parameter required"}, 400)
                
                status_info = get_git_status(repo_path)
                self.send_json({"success": True, "status": status_info})

            elif path == "/api/git/log":
                repo_path = query.get("path", [""])[0]
                if not repo_path:
                    return self.send_json({"success": False, "error": "Path parameter required"}, 400)
                
                commits = get_git_log(repo_path)
                self.send_json({"success": True, "commits": commits})

            elif path == "/api/git/diff":
                repo_path = query.get("path", [""])[0]
                file_name = query.get("file", [""])[0]
                staged_str = query.get("staged", ["false"])[0]
                staged = staged_str.lower() == "true"

                if not repo_path or not file_name:
                    return self.send_json({"success": False, "error": "Path and file parameters required"}, 400)

                diff_content = get_git_diff(repo_path, file_name, staged)
                self.send_json({"success": True, "diff": diff_content})

            elif path == "/api/system/hardware":
                hardware_info = get_system_hardware()
                self.send_json({"success": True, "hardware": hardware_info})

            else:
                self.send_json({"success": False, "error": "Endpoint not found"}, 404)
        except Exception as e:
            self.send_json({"success": False, "error": str(e)}, 500)

    def handle_api_post(self, path, body):
        try:
            repo_path = body.get("path")
            if not repo_path:
                return self.send_json({"success": False, "error": "Path parameter required"}, 400)

            if path == "/api/git/stage":
                files = body.get("files", [])
                if not files:
                    return self.send_json({"success": False, "error": "Files parameter required"}, 400)
                
                r = Repo(repo_path)
                rel_files = [f.encode('utf-8') for f in files]
                porcelain.add(r, rel_files)
                self.send_json({"success": True})

            elif path == "/api/git/unstage":
                files = body.get("files", [])
                if not files:
                    return self.send_json({"success": False, "error": "Files parameter required"}, 400)

                r = Repo(repo_path)
                for f in files:
                    unstage_file(r, f)
                self.send_json({"success": True})

            elif path == "/api/git/commit":
                message = body.get("message")
                if not message:
                    return self.send_json({"success": False, "error": "Commit message required"}, 400)

                r = Repo(repo_path)
                # Resolve Git config user identity (resolves hardcoded author finding)
                try:
                    author = porcelain.get_user_identity(r.get_config_stack())
                except Exception:
                    author = b"Godlike Controller <git@god.control>"

                porcelain.commit(r, message=message.encode('utf-8'), author=author)
                self.send_json({"success": True})

            else:
                self.send_json({"success": False, "error": "Endpoint not found"}, 404)
        except Exception as e:
            self.send_json({"success": False, "error": str(e)}, 500)

if __name__ == "__main__":
    os.makedirs(PUBLIC_DIR, exist_ok=True)
    handler = GitControlRequestHandler
    with ThreadingTCPServer(("", PORT), handler) as httpd:
        print(f"God's Git-Control Server starting on http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer shutting down.")

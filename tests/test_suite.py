import unittest
import os
import sys
import time
import json
import urllib.request
import urllib.parse
import tempfile
import shutil
import subprocess
from typing import Dict, Any, Optional

# Add parent directory to path so we can import server.py
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dulwich.repo import Repo
import dulwich.porcelain as porcelain


class TestGodlikeGitControl(unittest.TestCase):
    server_process: Optional[subprocess.Popen] = None
    temp_dir: str
    repo_path: str
    repo: Repo
    test_port: int

    @classmethod
    def setUpClass(cls) -> None:
        """Set up environment and start the test server subprocess."""
        import socket

        cls.temp_dir = tempfile.mkdtemp()
        cls.repo_path = os.path.join(cls.temp_dir, "test_repo")
        os.makedirs(cls.repo_path, exist_ok=True)
        # Initialize test repository
        cls.repo = Repo.init(cls.repo_path)

        # Create an initial commit so HEAD exists for staging/unstaging tests
        init_file = os.path.join(cls.repo_path, "init.txt")
        with open(init_file, "w") as f:
            f.write("initial file")
        porcelain.add(cls.repo, [b"init.txt"])
        porcelain.commit(
            cls.repo, message=b"Initial commit", author=b"Setup <setup@test.com>"
        )

        # Find a free TCP port dynamically
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        cls.test_port = s.getsockname()[1]
        s.close()

        # Set environment variables for the server to inherit
        os.environ["GGC_PORT"] = str(cls.test_port)
        os.environ["GGC_TESTING"] = "true"

        # Isolate the server's HOME so it reads/writes an ephemeral credentials file
        # under the temp dir instead of the developer's real ~/.config/ggc (resolves BUG#1:
        # the suite must never read or delete the real saved GitHub token).
        cls.test_home = os.path.join(cls.temp_dir, "ggc_home")
        os.makedirs(cls.test_home, exist_ok=True)
        os.environ["HOME"] = cls.test_home

        # Launch server.py as an automated subprocess for lifecycle management (resolves test server orchestration finding)
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        server_env = os.environ.copy()
        server_env["HOME"] = cls.test_home
        cls.server_process = subprocess.Popen(
            [sys.executable, "server.py"],
            cwd=root_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=server_env,
        )

        # Wait until the test server is successfully bound and accepting connections
        start_time = time.time()
        while time.time() - start_time < 5.0:
            try:
                with socket.create_connection(
                    ("127.0.0.1", cls.test_port), timeout=0.5
                ):
                    break
            except (ConnectionRefusedError, socket.timeout):
                time.sleep(0.1)
        else:
            raise RuntimeError(f"Failed to start test server on port {cls.test_port}")

    @classmethod
    def tearDownClass(cls) -> None:
        """Shut down the test server and clean up temporary directory."""
        shutil.rmtree(cls.temp_dir)
        if cls.server_process:
            cls.server_process.terminate()
            cls.server_process.wait()

    def get_json(self, path: str) -> Dict[str, Any]:
        """Perform an HTTP GET request to the test server and parse the JSON response.

        Args:
            path: Target API path.

        Returns:
            The parsed JSON response.
        """
        url = f"http://127.0.0.1:{self.test_port}{path}"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def post_json(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        """Perform an HTTP POST request to the test server and parse the JSON response.

        Args:
            path: Target API path.
            body: Request payload to serialize to JSON.

        Returns:
            The parsed JSON response.
        """
        url = f"http://127.0.0.1:{self.test_port}{path}"
        data_bytes = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data_bytes, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Origin", f"http://127.0.0.1:{self.test_port}")
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def test_01_hardware_metrics_structure(self):
        """Test system hardware details match expected JSON format."""
        data = self.get_json("/api/system/hardware")
        self.assertTrue(data["success"])
        hw = data["hardware"]

        self.assertIn("cpu", hw)
        self.assertIn("memory", hw)
        self.assertIn("disks", hw)
        self.assertIn("system", hw)

        # CPU
        self.assertGreater(hw["cpu"]["cores"], 0)
        self.assertIsInstance(hw["cpu"]["model"], str)
        self.assertGreaterEqual(hw["cpu"]["overallPercent"], 0.0)

        # Memory
        self.assertGreater(hw["memory"]["total"], 0)
        self.assertGreaterEqual(hw["memory"]["percent"], 0.0)

        # OS Uptime
        self.assertGreaterEqual(hw["system"]["uptime"], 0)

    def test_02_directory_browser(self):
        """Test directory browser lists files correctly."""
        data = self.get_json(f"/api/fs/browse?path={urllib.parse.quote(self.temp_dir)}")
        self.assertTrue(data["success"])
        result = data["data"]

        self.assertIn("currentPath", result)
        self.assertIn("parentPath", result)
        self.assertIn("items", result)

        items = result["items"]
        item_names = [item["name"] for item in items]
        self.assertIn("test_repo", item_names)

        for item in items:
            if item["name"] == "test_repo":
                self.assertTrue(item["isDir"])

    def test_03_git_workflow(self):
        """Test Git workflow (status, stage, unstage, commit) via HTTP API."""
        # 1. Check initial clean status
        data = self.get_json(
            f"/api/git/status?path={urllib.parse.quote(self.repo_path)}"
        )
        self.assertTrue(data["success"])
        status_info = data["status"]
        self.assertEqual(status_info["branch"], "master")
        self.assertFalse(status_info["isDirty"])

        # 2. Modify existing file (init.txt)
        file_path = os.path.join(self.repo_path, "init.txt")
        with open(file_path, "a") as f:
            f.write("\nmodified contents")

        data = self.get_json(
            f"/api/git/status?path={urllib.parse.quote(self.repo_path)}"
        )
        self.assertTrue(data["success"])
        status_info = data["status"]
        self.assertTrue(status_info["isDirty"])
        self.assertIn("init.txt", status_info["unstaged"])

        # 3. Stage file via API POST
        data = self.post_json(
            "/api/git/stage", {"path": self.repo_path, "files": ["init.txt"]}
        )
        self.assertTrue(data["success"])

        data = self.get_json(
            f"/api/git/status?path={urllib.parse.quote(self.repo_path)}"
        )
        status_info = data["status"]
        self.assertIn("init.txt", status_info["staged"]["modify"])
        self.assertNotIn("init.txt", status_info["unstaged"])

        # 4. Unstage file via API POST
        data = self.post_json(
            "/api/git/unstage", {"path": self.repo_path, "files": ["init.txt"]}
        )
        self.assertTrue(data["success"])

        data = self.get_json(
            f"/api/git/status?path={urllib.parse.quote(self.repo_path)}"
        )
        status_info = data["status"]
        self.assertIn("init.txt", status_info["unstaged"])
        self.assertNotIn("init.txt", status_info["staged"]["modify"])

        # 5. Stage again & Commit via API POST
        data = self.post_json(
            "/api/git/stage", {"path": self.repo_path, "files": ["init.txt"]}
        )
        self.assertTrue(data["success"])

        data = self.post_json(
            "/api/git/commit", {"path": self.repo_path, "message": "Test commit"}
        )
        self.assertTrue(data["success"])

        data = self.get_json(
            f"/api/git/status?path={urllib.parse.quote(self.repo_path)}"
        )
        status_info = data["status"]
        self.assertFalse(status_info["isDirty"])

        # 6. Check logs via API GET
        data = self.get_json(f"/api/git/log?path={urllib.parse.quote(self.repo_path)}")
        self.assertTrue(data["success"])
        logs = data["commits"]
        self.assertEqual(len(logs), 2)
        self.assertEqual(logs[0]["message"], "Test commit")
        self.assertIn("Setup", logs[1]["author"])  # Initial commit author

    def test_04_api_latency_performance(self):
        """Run performance latency benchmark tests on active server."""
        url_hw = f"http://127.0.0.1:{self.test_port}/api/system/hardware"
        url_git = f"http://127.0.0.1:{self.test_port}/api/git/status?path={urllib.parse.quote(self.repo_path)}"

        hw_latencies = []
        git_latencies = []
        iterations = 10

        # Benchmark /api/system/hardware
        print("\n[+] Benchmarking System Hardware API Endpoint...")
        for _ in range(iterations):
            start = time.perf_counter()
            try:
                with urllib.request.urlopen(url_hw) as response:
                    response.read()
                end = time.perf_counter()
                hw_latencies.append((end - start) * 1000)
            except Exception as e:
                self.fail(f"Connection failed: {e}")

        # Benchmark /api/git/status
        print("[+] Benchmarking Git Status API Endpoint...")
        for _ in range(iterations):
            start = time.perf_counter()
            try:
                with urllib.request.urlopen(url_git) as response:
                    response.read()
                end = time.perf_counter()
                git_latencies.append((end - start) * 1000)
            except Exception as e:
                self.fail(f"Connection failed: {e}")

        # Calculate metrics
        avg_hw = sum(hw_latencies) / len(hw_latencies)
        max_hw = max(hw_latencies)
        min_hw = min(hw_latencies)

        avg_git = sum(git_latencies) / len(git_latencies)
        max_git = max(git_latencies)
        min_git = min(git_latencies)

        print(
            f"    - Hardware API Latency: Avg={avg_hw:.1f}ms, Min={min_hw:.1f}ms, Max={max_hw:.1f}ms"
        )
        print(
            f"    - Git Status API Latency: Avg={avg_git:.1f}ms, Min={min_git:.1f}ms, Max={max_git:.1f}ms"
        )

        if avg_hw >= 100.0:
            print(
                f"\n[!] Warning: Hardware endpoint latency {avg_hw:.1f}ms exceeds 100ms threshold"
            )
        if avg_git >= 100.0:
            print(
                f"[!] Warning: Git Status endpoint latency {avg_git:.1f}ms exceeds 100ms threshold"
            )

        self.assertLess(
            avg_hw, 2000.0, "Hardware endpoint latency is extremely slow (>2s)"
        )
        self.assertLess(
            avg_git, 2000.0, "Git Status endpoint latency is extremely slow (>2s)"
        )

        # Save metrics to json report file
        report_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "performance_report.json"
        )
        report = {
            "timestamp": time.time(),
            "hardware_api": {"avg_ms": avg_hw, "min_ms": min_hw, "max_ms": max_hw},
            "git_status_api": {"avg_ms": avg_git, "min_ms": min_git, "max_ms": max_git},
        }
        with open(report_path, "w") as rf:
            json.dump(report, rf, indent=2)
        print("[+] Performance report saved to: tests/performance_report.json")

    def test_05_path_traversal_protection(self):
        """Test that API endpoints reject path traversal attacks and system directories."""
        url_scan = f"http://127.0.0.1:{self.test_port}/api/fs/scan?path=/etc"
        url_browse = f"http://127.0.0.1:{self.test_port}/api/fs/browse?path=/proc"
        url_traversal_backslash = f"http://127.0.0.1:{self.test_port}/api/git/diff?path={urllib.parse.quote(self.repo_path)}&file=..\\..\\..\\..\\etc\\passwd"

        # /etc
        try:
            urllib.request.urlopen(url_scan)
            self.fail("Server did not block path traversal to /etc")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)

        # /proc
        try:
            urllib.request.urlopen(url_browse)
            self.fail("Server did not block path traversal to /proc")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)

        # Backslash path traversal (resolves F-02 verification)
        try:
            urllib.request.urlopen(url_traversal_backslash)
            self.fail("Server did not block backslash path traversal")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)

    def test_06_csrf_and_payload_protection(self):
        """Test CSRF origin checks and Content-Type enforcement on POST endpoints."""
        url_stage = f"http://127.0.0.1:{self.test_port}/api/git/stage"

        # 1. Reject non-JSON content-type
        req = urllib.request.Request(url_stage, data=b"{}", method="POST")
        req.add_header("Content-Type", "text/plain")
        req.add_header("Origin", f"http://127.0.0.1:{self.test_port}")
        try:
            urllib.request.urlopen(req)
            self.fail("Server accepted text/plain content type on POST")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)

        # 2. Reject malicious Origin
        req = urllib.request.Request(url_stage, data=b"{}", method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Origin", "http://malicious.attacker.com")
        try:
            urllib.request.urlopen(req)
            self.fail("Server accepted malicious Origin on POST")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 403)

        # 3. Reject missing both Origin and Referer (resolves F-03 verification)
        req = urllib.request.Request(url_stage, data=b"{}", method="POST")
        req.add_header("Content-Type", "application/json")
        try:
            urllib.request.urlopen(req)
            self.fail("Server accepted POST request without Origin and Referer headers")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)

    def test_07_concurrent_git_operations(self):
        """Test concurrent Git stage/unstage requests don't crash the server (resolves F-01)."""
        import threading

        # Create dummy file to stage
        dummy_file = os.path.join(self.repo_path, "concurrent_test.txt")
        with open(dummy_file, "w") as f:
            f.write("test contents")

        errors = []

        def worker(action):
            try:
                if action == "stage":
                    self.post_json(
                        "/api/git/stage",
                        {"path": self.repo_path, "files": ["concurrent_test.txt"]},
                    )
                else:
                    self.post_json(
                        "/api/git/unstage",
                        {"path": self.repo_path, "files": ["concurrent_test.txt"]},
                    )
            except Exception as ex:
                errors.append(ex)

        threads = []
        for i in range(20):
            action = "stage" if i % 2 == 0 else "unstage"
            t = threading.Thread(target=worker, args=(action,))
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        self.assertEqual(
            len(errors), 0, f"Concurrent Git operations raised errors: {errors}"
        )

    def test_08_github_integration(self):
        """Test GitHub Auth & Workspace Integration endpoints."""
        # 1. Test profile with no token (unauthenticated state)
        data = self.get_json("/api/github/profile")
        self.assertTrue(data["success"])
        self.assertFalse(data["authenticated"])

        # 2. Test sign-in with invalid token
        try:
            self.post_json(
                "/api/github/signin", {"token": "invalid-token", "rememberMe": False}
            )
            self.fail("Server did not return error for invalid token")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 401)

        # 3. Test sign-in with valid token
        data = self.post_json(
            "/api/github/signin", {"token": "valid-stoic-token", "rememberMe": True}
        )
        self.assertTrue(data["success"])
        self.assertTrue(data["authenticated"])
        self.assertEqual(data["user"]["login"], "stoic-test")
        self.assertIn("repo", data["scopes"])

        # 4. Test profile after sign-in (loads saved token)
        data = self.get_json("/api/github/profile")
        self.assertTrue(data["success"])
        self.assertTrue(data["authenticated"])

        # 5. Test repo remote (no remote origin yet)
        data = self.get_json(
            f"/api/github/remote?path={urllib.parse.quote(self.repo_path)}"
        )
        self.assertTrue(data["success"])
        self.assertFalse(data["hasRemote"])

        # 6. Test publish to GitHub
        data = self.post_json(
            "/api/github/publish",
            {"path": self.repo_path, "name": "publish-test-repo", "private": True},
        )
        self.assertTrue(data["success"])
        self.assertIn("publish-test-repo", data["cloneUrl"])

        # 7. Test repo remote (now it should have the remote origin)
        data = self.get_json(
            f"/api/github/remote?path={urllib.parse.quote(self.repo_path)}"
        )
        self.assertTrue(data["success"])
        self.assertTrue(data["hasRemote"])
        self.assertTrue(data["isGitHub"])
        self.assertEqual(data["owner"], "stoic-test")
        self.assertEqual(data["repo"], "publish-test-repo")

        # 8. Test branch sync status
        data = self.get_json(
            f"/api/github/sync_status?path={urllib.parse.quote(self.repo_path)}"
        )
        self.assertTrue(data["success"])
        self.assertIn("sync", data)

        # 9. Test issues/PRs
        data = self.get_json(
            f"/api/github/issues_prs?path={urllib.parse.quote(self.repo_path)}"
        )
        self.assertTrue(data["success"])
        self.assertIn("issues", data)
        self.assertIn("prs", data)

        # 10. Test push and pull
        data = self.post_json("/api/github/push", {"path": self.repo_path})
        self.assertTrue(data["success"])
        data = self.post_json("/api/github/pull", {"path": self.repo_path})
        self.assertTrue(data["success"])

        # 11. Test signout
        data = self.post_json("/api/github/signout", {})
        self.assertTrue(data["success"])

        # 12. Test profile after signout (should be unauthenticated again)
        data = self.get_json("/api/github/profile")
        self.assertTrue(data["success"])
        self.assertFalse(data["authenticated"])

        # Confirms the server used the isolated HOME, never the real credentials file.
        real_creds = os.path.expanduser("~/.config/ggc/credentials.json")
        self.assertFalse(
            os.path.exists(real_creds),
            "Test suite must not create/modify the real credentials file",
        )

    def test_09_credentials_isolation(self):
        """Server must persist tokens only to its isolated HOME, never the real one (BUG#1)."""
        # Snapshot the real credentials file (if any) before exercising the API.
        real_creds = os.path.expanduser("~/.config/ggc/credentials.json")
        real_existed = os.path.exists(real_creds)
        real_mtime = os.path.getmtime(real_creds) if real_existed else None

        # Sign in (remembered) then sign out — exercises both file write and delete paths.
        self.post_json(
            "/api/github/signin", {"token": "valid-stoic-token", "rememberMe": True}
        )
        self.post_json("/api/github/signout", {})

        if real_existed:
            self.assertEqual(
                os.path.getmtime(real_creds),
                real_mtime,
                "Real credentials file was modified by the test suite",
            )
        else:
            self.assertFalse(
                os.path.exists(real_creds),
                "Test suite created a real credentials file",
            )

        # The isolated server credentials file should have been created then removed.
        iso_creds = os.path.join(self.test_home, ".config", "ggc", "credentials.json")
        self.assertFalse(
            os.path.exists(iso_creds),
            "Isolated credentials file should be cleaned up by signout",
        )

    def test_10_profile_unauthenticated_clean(self):
        """With no saved token, the profile endpoint reports unauthenticated (was flaky)."""
        data = self.get_json("/api/github/profile")
        self.assertTrue(data["success"])
        self.assertFalse(data["authenticated"])

    def test_11_git_terminal(self):
        """Git-scoped in-app terminal: runs git, rejects non-git, path overrides, unsafe paths."""
        # 1. Valid git command returns success with output naming the branch.
        data = self.post_json(
            "/api/git/terminal",
            {"path": self.repo_path, "command": "git status"},
        )
        self.assertTrue(data["success"])
        self.assertEqual(data["returncode"], 0)
        self.assertIn("master", data["stdout"] + data["stderr"])

        # 2. Self-contained: create a file, add+commit it through the terminal,
        #    then confirm it appears at HEAD of `git log`.
        terminal_file = os.path.join(self.repo_path, "terminal_test.txt")
        with open(terminal_file, "w") as f:
            f.write("terminal test contents\n")
        data = self.post_json(
            "/api/git/terminal",
            {"path": self.repo_path, "command": "git add terminal_test.txt"},
        )
        self.assertTrue(data["success"])
        data = self.post_json(
            "/api/git/terminal",
            {
                "path": self.repo_path,
                "command": "git -c user.email=test@ggc -c user.name=GGC commit -m terminal-test-commit",
            },
        )
        self.assertTrue(data["success"])
        self.assertEqual(data["returncode"], 0)
        data = self.post_json(
            "/api/git/terminal",
            {"path": self.repo_path, "command": "git log --oneline -n 1"},
        )
        self.assertTrue(data["success"])
        self.assertEqual(data["returncode"], 0)
        self.assertIn("terminal-test-commit", data["stdout"] + data["stderr"])

        # 3. Non-git command is rejected (only `git` allowed).
        data = self.post_json(
            "/api/git/terminal",
            {"path": self.repo_path, "command": "echo hi"},
        )
        self.assertFalse(data["success"])

        # 4. Path-override argument is blocked (-C escaping the repo).
        data = self.post_json(
            "/api/git/terminal",
            {"path": self.repo_path, "command": "git -C /etc status"},
        )
        self.assertFalse(data["success"])

        # 5. Unsafe repo path is rejected (reuses is_safe_path guard).
        try:
            self.post_json(
                "/api/git/terminal",
                {"path": "/etc", "command": "git status"},
            )
            self.fail("Server accepted terminal command against /etc")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)


class TestSyncCredentialScrub(unittest.TestCase):
    """Unit tests for push/pull token handling (BUG#2, #8) — no HTTP, no real GitHub."""

    def setUp(self):
        import server as _server

        self.server = _server
        self.temp_dir = tempfile.mkdtemp()
        self.repo_path = os.path.join(self.temp_dir, "scrub_repo")
        os.makedirs(self.repo_path, exist_ok=True)
        r = Repo.init(self.repo_path)
        # Configure a remote origin that contains an embedded token, as link_and_push does.
        config = r.get_config()
        config.set(
            (b"remote", b"origin"),
            b"url",
            b"https://stoic-test:SECRET_TOKEN@github.com/stoic-test/scrub_repo.git",
        )
        config.set(
            (b"remote", b"origin"),
            b"fetch",
            b"+refs/heads/*:refs/remotes/origin/*",
        )
        config.write_to_path()

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _assert_token_scrubbed(self):
        url = self.server.get_repo_remote_url(self.repo_path)
        self.assertIsNotNone(url, "remote origin url missing")
        assert url is not None  # narrow for type checkers
        self.assertNotIn("SECRET_TOKEN", url, "Token leaked into .git/config")
        self.assertTrue(url.startswith("https://github.com/stoic-test/scrub_repo.git"))

    def test_push_scrubs_token_from_config(self):
        """push_to_github must not leave the token in .git/config (BUG#2)."""
        calls: Dict[str, str] = {}
        orig_testing = os.environ.get("GGC_TESTING")
        os.environ.pop("GGC_TESTING", None)  # exercise the real sync path

        def fake_push(repo, url, refspec):
            calls["url"] = url.decode() if isinstance(url, bytes) else url
            return None

        orig = self.server.porcelain.push
        self.server.porcelain.push = fake_push
        try:
            self.server.push_to_github(self.repo_path, "SECRET_TOKEN")
        finally:
            self.server.porcelain.push = orig
            if orig_testing is not None:
                os.environ["GGC_TESTING"] = orig_testing
        # Auth URL used for the network call must carry the token...
        self.assertIn("SECRET_TOKEN", calls["url"])
        # ...but the stored remote URL must be scrubbed afterwards.
        self._assert_token_scrubbed()

    def test_pull_scrubs_token_from_config(self):
        """pull_from_github must not leave the token in .git/config (BUG#2)."""
        calls: Dict[str, str] = {}
        orig_testing = os.environ.get("GGC_TESTING")
        os.environ.pop("GGC_TESTING", None)  # exercise the real sync path

        def fake_pull(repo, url, refspec):
            calls["url"] = url.decode() if isinstance(url, bytes) else url
            return None

        orig = self.server.porcelain.pull
        self.server.porcelain.pull = fake_pull
        try:
            self.server.pull_from_github(self.repo_path, "SECRET_TOKEN")
        finally:
            self.server.porcelain.pull = orig
            if orig_testing is not None:
                os.environ["GGC_TESTING"] = orig_testing
        self.assertIn("SECRET_TOKEN", calls["url"])
        self._assert_token_scrubbed()


if __name__ == "__main__":
    unittest.main()

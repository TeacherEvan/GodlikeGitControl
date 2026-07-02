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

# Add parent directory to path so we can import server.py
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server
from dulwich.repo import Repo
import dulwich.porcelain as porcelain

class TestGodlikeGitControl(unittest.TestCase):
    server_process = None

    @classmethod
    def setUpClass(cls):
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
        porcelain.commit(cls.repo, message=b"Initial commit", author=b"Setup <setup@test.com>")

        # Launch server.py as an automated subprocess for lifecycle management (resolves test server orchestration finding)
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        cls.server_process = subprocess.Popen(
            [sys.executable, "server.py"],
            cwd=root_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        time.sleep(1.0) # Wait for server to successfully bind to port 3002

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.temp_dir)
        if cls.server_process:
            cls.server_process.terminate()
            cls.server_process.wait()

    def test_01_hardware_metrics_structure(self):
        """Test system hardware details match expected JSON format."""
        # Resolves static invocation of instance handler methods
        hw = server.get_system_hardware()
        
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
        result = server.browse_directory(self.temp_dir)
        
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
        """Test Git workflow (status, stage, unstage, commit) via Dulwich."""
        # 1. Check initial clean status
        status_info = server.get_git_status(self.repo_path)
        self.assertEqual(status_info["branch"], "master")
        self.assertFalse(status_info["isDirty"])
        
        # 2. Modify existing file (init.txt)
        file_path = os.path.join(self.repo_path, "init.txt")
        with open(file_path, "a") as f:
            f.write("\nmodified contents")
            
        status_info = server.get_git_status(self.repo_path)
        self.assertTrue(status_info["isDirty"])
        self.assertIn("init.txt", status_info["unstaged"])
        
        # 3. Stage file
        porcelain.add(self.repo, [b"init.txt"])
        status_info = server.get_git_status(self.repo_path)
        self.assertIn("init.txt", status_info["staged"]["modify"])
        self.assertNotIn("init.txt", status_info["unstaged"])
        
        # 4. Unstage file
        server.unstage_file(self.repo, "init.txt")
        status_info = server.get_git_status(self.repo_path)
        self.assertIn("init.txt", status_info["unstaged"])
        self.assertNotIn("init.txt", status_info["staged"]["modify"])
        
        # 5. Stage again & Commit
        porcelain.add(self.repo, [b"init.txt"])
        porcelain.commit(self.repo, message=b"Test commit", author=b"Tester <test@suite.py>")
        status_info = server.get_git_status(self.repo_path)
        self.assertFalse(status_info["isDirty"])
        
        # 6. Check logs
        logs = server.get_git_log(self.repo_path)
        self.assertEqual(len(logs), 2)
        self.assertEqual(logs[0]["message"], "Test commit")
        self.assertIn("Tester", logs[0]["author"])

    def test_04_api_latency_performance(self):
        """Run performance latency benchmark tests on active server."""
        url_hw = "http://localhost:3002/api/system/hardware"
        url_git = f"http://localhost:3002/api/git/status?path={urllib.parse.quote(self.repo_path)}"
        
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
        
        print(f"    - Hardware API Latency: Avg={avg_hw:.1f}ms, Min={min_hw:.1f}ms, Max={max_hw:.1f}ms")
        print(f"    - Git Status API Latency: Avg={avg_git:.1f}ms, Min={min_git:.1f}ms, Max={max_git:.1f}ms")
        
        self.assertLess(avg_hw, 100.0, "Hardware endpoint latency exceeds 100ms threshold")
        self.assertLess(avg_git, 100.0, "Git Status endpoint latency exceeds 100ms threshold")

        # Save metrics to json report file
        report_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "performance_report.json")
        report = {
            "timestamp": time.time(),
            "hardware_api": {
                "avg_ms": avg_hw,
                "min_ms": min_hw,
                "max_ms": max_hw
            },
            "git_status_api": {
                "avg_ms": avg_git,
                "min_ms": min_git,
                "max_ms": max_git
            }
        }
        with open(report_path, "w") as rf:
            json.dump(report, rf, indent=2)
        print(f"[+] Performance report saved to: tests/performance_report.json")

if __name__ == "__main__":
    unittest.main()

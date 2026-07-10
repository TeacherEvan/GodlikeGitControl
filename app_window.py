import os
import sys
import time
import subprocess
import webview
import socket


def start_server() -> subprocess.Popen:
    """Start the background Python server process.

    Returns:
        The subprocess.Popen instance for the running server.
    """
    root_dir = os.path.dirname(os.path.abspath(__file__))
    return subprocess.Popen(
        [sys.executable, os.path.join(root_dir, "server.py")],
        cwd=root_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


if __name__ == "__main__":
    # Start the backend server
    server_proc = start_server()

    # Wait for the backend server to start by polling the TCP port (resolves F-07)
    start_time = time.time()
    while time.time() - start_time < 5.0:
        try:
            with socket.create_connection(("127.0.0.1", 3002), timeout=0.5):
                break
        except (ConnectionRefusedError, socket.timeout):
            time.sleep(0.1)

    try:
        # Launch pywebview native window loaded with the local address
        # Behaves as a standalone window without browser controls
        window = webview.create_window(
            title="God's Git-Control",
            url="http://localhost:3002",
            width=1000,
            height=700,
            resizable=True,
            min_size=(800, 600),
        )
        webview.start()
    except Exception as e:
        print(f"[-] Native window error: {e}")
    finally:
        # Ensure server process is terminated upon exit
        server_proc.terminate()
        server_proc.wait()

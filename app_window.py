import os
import sys
import time
import subprocess
import webview

def start_server():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    return subprocess.Popen(
        [sys.executable, os.path.join(root_dir, "server.py")],
        cwd=root_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

if __name__ == "__main__":
    # Start the backend server
    server_proc = start_server()
    time.sleep(1.2) # Allow backend to fully start on port 3002
    
    try:
        # Launch pywebview native window loaded with the local address
        # Behaves as a standalone window without browser controls
        window = webview.create_window(
            title="God's Git-Control",
            url="http://localhost:3002",
            width=1000,
            height=700,
            resizable=True,
            min_size=(800, 600)
        )
        webview.start()
    except Exception as e:
        print(f"[-] Native window error: {e}")
    finally:
        # Ensure server process is terminated upon exit
        server_proc.terminate()
        server_proc.wait()

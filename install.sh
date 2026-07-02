#!/bin/bash
set -e

echo "================================================="
echo " Installing God's Git-Control App..."
echo "================================================="

# Resolve real user home directory for non-hidden folders (like Desktop)
REAL_USER="$USER"
REAL_DESKTOP="/home/$REAL_USER/Desktop"
echo "[+] Target Desktop Screen Directory: $REAL_DESKTOP"

# 1. Check Python3
if ! command -v python3 &> /dev/null; then
    echo "[-] Error: python3 is not installed on the system."
    exit 1
fi

# 2. Install dependencies via pip
echo "[+] Installing system dependencies (dulwich, psutil)..."
python3 -m pip install --user --break-system-packages dulwich psutil || {
    echo "[!] Standard pip install failed, attempting local venv fallback..."
    python3 -m venv venv
    source venv/bin/activate
    pip install dulwich psutil
}

# 3. Setup Systemd Service (in writable snap-local $HOME)
echo "[+] Configuring systemd user service..."
SYSTEMD_DIR="$HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_DIR"

cat <<EOF > "$SYSTEMD_DIR/gods-git-control.service"
[Unit]
Description=God's Git-Control Server Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/python3 $(pwd)/server.py
Restart=on-failure

[Install]
WantedBy=default.target
EOF

# Load and start user systemd service (suppress error if systemd is restricted)
systemctl --user daemon-reload || true
systemctl --user enable gods-git-control.service || true
systemctl --user restart gods-git-control.service || true
echo "[+] Systemd user service configuration loaded."

# 4. Install Application Menu Launcher (in writable snap-local $HOME)
echo "[+] Installing Application Menu Launcher..."
DESKTOP_DIR="$HOME/.local/share/applications"
mkdir -p "$DESKTOP_DIR"

cp gods-git-control.desktop "$DESKTOP_DIR/"
chmod +x "$DESKTOP_DIR/gods-git-control.desktop"
echo "[+] Application Menu Launcher added."

# 5. Install Desktop Screen Shortcut (in real user Desktop directory)
if [ -d "$REAL_DESKTOP" ]; then
    echo "[+] Creating Desktop Screen Shortcut..."
    cp gods-git-control.desktop "$REAL_DESKTOP/"
    chmod +x "$REAL_DESKTOP/gods-git-control.desktop"
    
    # Try to mark the launcher trusted under GNOME desktop environment
    if command -v gio &> /dev/null; then
        gio set "$REAL_DESKTOP/gods-git-control.desktop" metadata::trusted true || true
    fi
    echo "[+] Desktop Screen Shortcut created at $REAL_DESKTOP/gods-git-control.desktop"
fi

echo "================================================="
echo " Installation Complete!"
echo "================================================="
echo "The application is ready."
echo "You can launch the app from your Desktop or Applications menu,"
echo "or open http://localhost:3002 in your browser."
echo "================================================="

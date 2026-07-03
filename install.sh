#!/bin/bash
set -e

echo "================================================="
echo " Installing God's Git-Control App..."
echo "================================================="

# Resolve real user home directory (handles sudo/non-sudo gracefully)
REAL_USER="${SUDO_USER:-$USER}"
if command -v getent &> /dev/null; then
    REAL_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)
fi
REAL_HOME="${REAL_HOME:-$HOME}"
REAL_DESKTOP="$REAL_HOME/Desktop"
SYSTEMD_DIR="$REAL_HOME/.config/systemd/user"

echo "[+] Target Desktop Screen Directory: $REAL_DESKTOP"

run_user_systemctl() {
    if [ -n "$SUDO_USER" ]; then
        sudo -u "$REAL_USER" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u $REAL_USER)/bus" systemctl --user "$@"
    else
        systemctl --user "$@"
    fi
}

# 1. Check Python3
if ! command -v python3 &> /dev/null; then
    echo "[-] Error: python3 is not installed on the system."
    exit 1
fi

# 2. Install dependencies via pip (adding pywebview for native window wrapper)
echo "[+] Installing system dependencies (dulwich, psutil, pywebview)..."
python3 -m pip install --user --break-system-packages dulwich psutil pywebview || {
    echo "[!] Standard pip install failed, attempting local venv fallback..."
    python3 -m venv venv
    if [ -n "$SUDO_USER" ]; then
        chown -R "$REAL_USER:$REAL_USER" venv
    fi
    source venv/bin/activate
    pip install dulwich psutil pywebview
    if [ -n "$SUDO_USER" ]; then
        chown -R "$REAL_USER:$REAL_USER" venv
    fi
}

# 3. Setup Systemd Service (in writable snap-local $REAL_HOME)
echo "[+] Configuring systemd user service..."
mkdir -p "$SYSTEMD_DIR"
if [ -n "$SUDO_USER" ]; then
    chown -R "$REAL_USER:$REAL_USER" "$REAL_HOME/.config" 2>/dev/null || true
fi

PYTHON_EXEC="/usr/bin/python3"
if [ -d "venv" ]; then
    PYTHON_EXEC="$(pwd)/venv/bin/python3"
fi

cat <<EOF > "$SYSTEMD_DIR/gods-git-control.service"
[Unit]
Description=God's Git-Control Server Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
ExecStart=$PYTHON_EXEC $(pwd)/server.py
Restart=on-failure

[Install]
WantedBy=default.target
EOF

if [ -n "$SUDO_USER" ]; then
    chown "$REAL_USER:$REAL_USER" "$SYSTEMD_DIR/gods-git-control.service"
fi

# Load and start user systemd service (suppress error if systemd is restricted)
run_user_systemctl daemon-reload || true
run_user_systemctl enable gods-git-control.service || true
run_user_systemctl restart gods-git-control.service || true
echo "[+] Systemd user service configuration loaded."

# 4. Install Application Menu Launcher (in writable snap-local $REAL_HOME)
echo "[+] Installing Application Menu Launcher..."
DESKTOP_DIR="$REAL_HOME/.local/share/applications"
mkdir -p "$DESKTOP_DIR"
if [ -n "$SUDO_USER" ]; then
    chown -R "$REAL_USER:$REAL_USER" "$REAL_HOME/.local" 2>/dev/null || true
fi

WINDOW_PYTHON_EXEC="python3"
if [ -d "venv" ]; then
    WINDOW_PYTHON_EXEC="$(pwd)/venv/bin/python3"
fi

sed "s|Exec=.*|Exec=$WINDOW_PYTHON_EXEC $(pwd)/app_window.py|g" gods-git-control.desktop > "$DESKTOP_DIR/gods-git-control.desktop"
chmod +x "$DESKTOP_DIR/gods-git-control.desktop"
if [ -n "$SUDO_USER" ]; then
    chown "$REAL_USER:$REAL_USER" "$DESKTOP_DIR/gods-git-control.desktop"
fi
echo "[+] Application Menu Launcher added."

# 5. Install Desktop Screen Shortcut (in real user Desktop directory)
if [ -d "$REAL_DESKTOP" ]; then
    echo "[+] Creating Desktop Screen Shortcut..."
    sed "s|Exec=.*|Exec=$WINDOW_PYTHON_EXEC $(pwd)/app_window.py|g" gods-git-control.desktop > "$REAL_DESKTOP/gods-git-control.desktop"
    chmod +x "$REAL_DESKTOP/gods-git-control.desktop"
    if [ -n "$SUDO_USER" ]; then
        chown "$REAL_USER:$REAL_USER" "$REAL_DESKTOP/gods-git-control.desktop"
    fi
    
    # Try to mark the launcher trusted under GNOME desktop environment
    if command -v gio &> /dev/null; then
        if [ -n "$SUDO_USER" ]; then
            sudo -u "$REAL_USER" gio set "$REAL_DESKTOP/gods-git-control.desktop" metadata::trusted true || true
        else
            gio set "$REAL_DESKTOP/gods-git-control.desktop" metadata::trusted true || true
        fi
    fi
    echo "[+] Desktop Screen Shortcut created at $REAL_DESKTOP/gods-git-control.desktop"
fi

echo "================================================="
echo " Installation Complete!"
echo "================================================="
echo "The application is ready."
echo "You can launch the app directly as a standalone window"
echo "from your Desktop launcher or system Applications menu."
echo "================================================="

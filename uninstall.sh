#!/bin/bash
set -e

echo "================================================="
echo " Uninstalling God's Git-Control App..."
echo "================================================="

REAL_USER="$USER"
REAL_DESKTOP="/home/$REAL_USER/Desktop"
SYSTEMD_DIR="$HOME/.config/systemd/user"
DESKTOP_DIR="$HOME/.local/share/applications"

# 1. Stop and disable systemd user service
echo "[+] Stopping and disabling systemd user service..."
systemctl --user stop gods-git-control.service || true
systemctl --user disable gods-git-control.service || true

# 2. Delete systemd service file
if [ -f "$SYSTEMD_DIR/gods-git-control.service" ]; then
    rm "$SYSTEMD_DIR/gods-git-control.service"
    echo "[+] Removed systemd service file."
fi

# Reload systemd daemon
systemctl --user daemon-reload || true

# 3. Delete application menu launcher
if [ -f "$DESKTOP_DIR/gods-git-control.desktop" ]; then
    rm "$DESKTOP_DIR/gods-git-control.desktop"
    echo "[+] Removed Application Menu Launcher."
fi

# 4. Delete Desktop screen shortcut
if [ -f "$REAL_DESKTOP/gods-git-control.desktop" ]; then
    rm "$REAL_DESKTOP/gods-git-control.desktop"
    echo "[+] Removed Desktop screen shortcut."
fi

# 5. Optional configuration cleanup
CONFIG_DIR="$HOME/.config/ggc"
if [ -d "$CONFIG_DIR" ]; then
    echo "[?] Do you want to remove configuration files and credentials? (y/N)"
    # Read response with 5-second timeout, default to no
    if read -t 5 -p "> " response; then
        if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
            rm -rf "$CONFIG_DIR"
            echo "[+] Configuration directory removed."
        else
            echo "[+] Kept configuration and credential files."
        fi
    else
        echo -e "\n[+] Timeout: Kept configuration and credential files."
    fi
fi

echo "================================================="
echo " Uninstall Complete!"
echo "================================================="

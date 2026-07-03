#!/bin/bash
set -e

echo "================================================="
echo " Uninstalling God's Git-Control App..."
echo "================================================="

# Resolve real user home directory (handles sudo/non-sudo gracefully)
REAL_USER="${SUDO_USER:-$USER}"
if command -v getent &> /dev/null; then
    REAL_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)
fi
REAL_HOME="${REAL_HOME:-$HOME}"
REAL_DESKTOP="$REAL_HOME/Desktop"
SYSTEMD_DIR="$REAL_HOME/.config/systemd/user"
DESKTOP_DIR="$REAL_HOME/.local/share/applications"

run_user_systemctl() {
    if [ -n "$SUDO_USER" ]; then
        sudo -u "$REAL_USER" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u $REAL_USER)/bus" systemctl --user "$@"
    else
        systemctl --user "$@"
    fi
}

# 1. Stop and disable systemd user service
echo "[+] Stopping and disabling systemd user service..."
run_user_systemctl stop gods-git-control.service || true
run_user_systemctl disable gods-git-control.service || true

# 2. Delete systemd service file
if [ -f "$SYSTEMD_DIR/gods-git-control.service" ]; then
    rm "$SYSTEMD_DIR/gods-git-control.service"
    echo "[+] Removed systemd service file."
fi

# Reload systemd daemon
run_user_systemctl daemon-reload || true

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
CONFIG_DIR="$REAL_HOME/.config/ggc"
if [ -d "$CONFIG_DIR" ]; then
    echo "[?] Do you want to remove configuration files and credentials? (y/N)"
    # Read response with 5-second timeout, default to no
    if [ -n "$SUDO_USER" ]; then
        # If run as sudo, prompt/read as real user
        if sudo -u "$REAL_USER" read -t 5 -p "> " response; then
            if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
                rm -rf "$CONFIG_DIR"
                echo "[+] Configuration directory removed."
            else
                echo "[+] Kept configuration and credential files."
            fi
        else
            echo -e "\n[+] Timeout: Kept configuration and credential files."
        fi
    else
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
fi

echo "================================================="
echo " Uninstall Complete!"
echo "================================================="

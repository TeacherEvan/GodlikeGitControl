#!/bin/bash
set -e

echo "================================================="
echo " Reinstalling God's Git-Control App..."
echo "================================================="

# 1. Run uninstall script (if it exists)
if [ -f "./uninstall.sh" ]; then
    echo "[+] Running uninstall..."
    bash ./uninstall.sh <<< "no" # Pass "no" to keep configuration files during reinstall
fi

# 2. Run install script
if [ -f "./install.sh" ]; then
    echo "[+] Running install..."
    bash ./install.sh
fi

echo "================================================="
echo " Reinstallation Complete!"
echo "================================================="

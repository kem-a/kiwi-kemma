#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later

# uninstall-extra.sh - Uninstall the Kiwi titlebuttons hover module

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Kiwi Extension - Titlebuttons Hover Module Uninstaller${NC}"
echo "======================================================="

# Paths to the module and configuration
ENV_DIR="$HOME/.config/environment.d"
MODULE_PATH="$ENV_DIR/libtitlebuttons_hover.so"
CONF_FILE="$ENV_DIR/10-gtk3-titlebuttons.conf"

# Check if module exists
if [[ ! -f "$MODULE_PATH" ]] && [[ ! -f "$CONF_FILE" ]]; then
    echo -e "${YELLOW}Module not found${NC}"
    echo "The titlebuttons hover module is not currently installed."
    exit 0
fi

# Remove the module and configuration
echo "Removing titlebuttons hover module..."

if [[ -f "$MODULE_PATH" ]]; then
    if rm -f "$MODULE_PATH"; then
        echo -e "${GREEN}✓ Module removed from $MODULE_PATH${NC}"
    else
        echo -e "${RED}✗ Failed to remove module${NC}"
        exit 1
    fi
fi

if [[ -f "$CONF_FILE" ]]; then
    if rm -f "$CONF_FILE"; then
        echo -e "${GREEN}✓ Configuration removed from $CONF_FILE${NC}"
    else
        echo -e "${RED}✗ Failed to remove configuration${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${GREEN}Uninstallation completed successfully!${NC}"
echo ""
echo -e "${YELLOW}Note:${NC}"
echo "1. You need to log out and log back in for changes to take effect"
echo "2. The Kiwi extension will continue to work without the hover effect"
echo "3. You can reinstall the module anytime by running ./install-extra.sh"

echo ""
echo -e "${GREEN}Uninstallation complete!${NC}"

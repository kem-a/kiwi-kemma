#!/bin/bash

# install-extra.sh - Install the Kiwi titlebuttons hover module

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Kiwi Extension - Titlebuttons Hover Module Installer${NC}"
echo "=================================================="

# Check if we're in the right directory
if [[ ! -f "titlebuttons_hover.c" ]]; then
    echo -e "${RED}Error: titlebuttons_hover.c not found in current directory${NC}"
    echo "Please run this script from the kiwi-kemma/extras directory"
    exit 1
fi

# Check if pre-compiled module exists
PRECOMPILED_MODULE="libtitlebuttons_hover.so"

if [[ ! -f "$PRECOMPILED_MODULE" ]]; then
    echo -e "${RED}Error: Pre-compiled module 'libtitlebuttons_hover.so' not found${NC}"
    echo ""
    echo "Please compile the module first using:"
    echo "  ./compile-extra.sh"
    echo ""
    echo "Then run this installation script again."
    exit 1
fi

echo -e "${GREEN}✓ Found pre-compiled module${NC}"

# Create environment.d directory and install module
ENV_DIR="$HOME/.config/environment.d"
MODULE_PATH="$ENV_DIR/libtitlebuttons_hover.so"
CONF_FILE="$ENV_DIR/10-gtk3-titlebuttons.conf"

echo "Creating environment.d directory..."
mkdir -p "$ENV_DIR"

echo "Installing module to $MODULE_PATH..."
if cp libtitlebuttons_hover.so "$MODULE_PATH"; then
    echo -e "${GREEN}✓ Module installed successfully${NC}"
else
    echo -e "${RED}✗ Failed to copy module to environment directory${NC}"
    exit 1
fi

# Set proper permissions
chmod 644 "$MODULE_PATH"

# Create GTK modules configuration
echo "Creating GTK modules configuration..."
cat > "$CONF_FILE" << EOF
# GTK3 Titlebuttons Hover Module for Kiwi Extension
GTK_MODULES=$MODULE_PATH
EOF

if [[ $? -eq 0 ]]; then
    echo -e "${GREEN}✓ GTK modules configuration created${NC}"
else
    echo -e "${RED}✗ Failed to create GTK modules configuration${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Installation completed successfully!${NC}"
echo ""
echo -e "${YELLOW}Important:${NC}"
echo "1. You need to restart computer for the changes to take effect"
echo "2. The titlebuttons hover effect will work with GTK3 applications"
echo "3. The module is now installed system-wide via environment.d"
echo ""
echo "Files installed:"
echo "  Module: $MODULE_PATH"
echo "  Config: $CONF_FILE"

echo ""
echo -e "${GREEN}Installation complete! Enjoy your enhanced Kiwi experience! 🥝${NC}"

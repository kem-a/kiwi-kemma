#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later

# compile-extra.sh - Compile the Kiwi titlebuttons hover module from source

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Kiwi Extension - Titlebuttons Hover Module Compiler${NC}"
echo "=================================================="

# Check if we're in the right directory
if [[ ! -f "titlebuttons_hover.c" ]]; then
    echo -e "${RED}Error: titlebuttons_hover.c not found in current directory${NC}"
    echo "Please run this script from the kiwi-kemma/extras directory"
    exit 1
fi

# Check for required dependencies
echo "Checking compilation dependencies..."

# Check for compiler
if ! command -v gcc &> /dev/null; then
    echo -e "${RED}Error: gcc compiler not found${NC}"
    echo "Please install gcc:"
    echo "  Ubuntu/Debian: sudo apt install gcc"
    echo "  Fedora: sudo dnf install gcc"
    echo "  Arch: sudo pacman -S gcc"
    exit 1
fi

# Check for pkg-config
if ! command -v pkg-config &> /dev/null; then
    echo -e "${RED}Error: pkg-config not found${NC}"
    echo "Please install pkg-config:"
    echo "  Ubuntu/Debian: sudo apt install pkg-config"
    echo "  Fedora: sudo dnf install pkg-config"
    echo "  Arch: sudo pacman -S pkg-config"
    exit 1
fi

# Check for GTK3 development files
if ! pkg-config --exists gtk+-3.0; then
    echo -e "${RED}Error: GTK3 development files not found${NC}"
    echo "Please install GTK3 development packages:"
    echo "  Ubuntu/Debian: sudo apt install libgtk-3-dev"
    echo "  Fedora: sudo dnf install gtk3-devel"
    echo "  Arch: sudo pacman -S gtk3"
    exit 1
fi

echo -e "${GREEN}✓ All compilation dependencies found${NC}"

# Remove existing compiled module if present
if [[ -f "libtitlebuttons_hover.so" ]]; then
    echo "Removing existing compiled module..."
    rm -f libtitlebuttons_hover.so
fi

# Compile the module
echo "Compiling titlebuttons hover module from source..."
if gcc -shared -fPIC -o libtitlebuttons_hover.so titlebuttons_hover.c $(pkg-config --cflags --libs gtk+-3.0); then
    echo -e "${GREEN}✓ Compilation successful${NC}"
else
    echo -e "${RED}✗ Compilation failed${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}Compilation completed successfully!${NC}"
echo ""
echo "The compiled module 'libtitlebuttons_hover.so' is ready."
echo "You can now run './install-extra.sh' to install it."

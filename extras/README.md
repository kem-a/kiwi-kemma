# Kiwi Extras - Native Titlebuttons Hover Module

## Why This Module Is Not Included

The GNOME Extensions platform has security policies that prevent the distribution of compiled native libraries (`.so` files) through the official extensions repository. This is because:

1. **Security Concerns**: Native libraries can execute arbitrary code and potentially compromise system security
2. **Sandboxing Limitations**: Extensions are designed to run in a sandboxed environment, and native libraries bypass these protections
3. **Cross-platform Compatibility**: Native libraries are platform-specific and would not work across different architectures
4. **Review Process**: The GNOME Extensions review team cannot easily audit compiled binaries for malicious code

## What This Module Does

The `titlebuttons_hover` module provides a macOS-like hover effect for window titlebuttons in GTK3 only applications. When you hover over any titlebutton (minimize, maximize, close), all titlebuttons in that window get highlighted, creating a visual effect similar to macOS window controls. GTK4 apps are not affected and works fine with extension.

## Installation

### Quick Installation (Recommended)

Use the pre-compiled module included in this folder:

```bash
git clone https://github.com/kem-a/kiwi-kemma && cd kiwi-kemma/extras
./install-extra.sh
```

**No compilation dependencies required!** The installer uses the included pre-compiled module.

### Compilation from Source (Optional)

If you prefer to compile from source or the pre-compiled version doesn't work:

1. **Compile the module**:
   ```bash
   git clone https://github.com/kem-a/kiwi-kemma && cd kiwi-kemma/extras
   ./compile-extra.sh
   ```

2. **Install the compiled module**:
   ```bash
   ./install-extra.sh
   ```

#### Prerequisites for Compilation

Only needed if compiling from source:
- `gcc` or `clang` compiler
- `gtk3-devel` (Red Hat/Fedora) or `libgtk-3-dev` (Debian/Ubuntu)
- `pkg-config`

#### Ubuntu/Debian:
```bash
sudo apt install gcc libgtk-3-dev pkg-config
```

#### Fedora:
```bash
sudo dnf install gcc gtk3-devel pkg-config
```

#### Arch Linux:
```bash
sudo pacman -S gcc gtk3 pkg-config
```

#### Compile from Source

To replace the pre-compiled module with your own compilation:

```bash
./compile-extra.sh           # Compile from source (replaces pre-compiled module)
./install-extra.sh           # Install the compiled module
```

### Manual Compilation

If you prefer to compile manually:

```bash
# Compile the module
gcc -shared -fPIC -o libtitlebuttons_hover.so titlebuttons_hover.c `pkg-config --cflags --libs gtk+-3.0`

# Install to environment.d directory
mkdir -p ~/.config/environment.d
cp libtitlebuttons_hover.so ~/.config/environment.d/

# Create GTK modules configuration
cat > ~/.config/environment.d/10-gtk3-titlebuttons.conf << EOF
GTK_MODULES=$HOME/.config/environment.d/libtitlebuttons_hover.so
EOF

# Log out and log back in to apply changes
```

## Uninstallation

To remove the titlebuttons hover module:

```bash
./uninstall-extra.sh
```

Or manually:

```bash
rm ~/.config/environment.d/libtitlebuttons_hover.so
rm ~/.config/environment.d/10-gtk3-titlebuttons.conf
```

## Troubleshooting

### Module Not Loading
- Ensure you have logged out and logged back in after installation
- Check that the files exist:
  - `~/.config/environment.d/libtitlebuttons_hover.so`
  - `~/.config/environment.d/10-gtk3-titlebuttons.conf`
- Verify that all dependencies are installed
- Check environment variable: `echo $GTK_MODULES`

### Compilation Errors
- Make sure you have the development headers for GTK3 installed
- Check that `pkg-config` can find GTK3: `pkg-config --exists gtk+-3.0`

### No Visual Effect
- The module only works with applications that use GTK3 window decorations
- Some applications (like Wayland-native apps) may not be affected
- Try testing with standard GNOME applications like Files or Text Editor

## Technical Details

The module works by:
1. Being loaded system-wide via GTK_MODULES environment variable
2. Scanning for GTK HeaderBar widgets containing titlebuttons  
3. Monitoring mouse enter/leave events on titlebuttons
4. Adding/removing a CSS class (`titlebuttons-hover`) to the headerbar when any button is hovered
5. The Kiwi extension provides CSS rules that style this class

The module is installed to `~/.config/environment.d/libtitlebuttons_hover.so` and loaded via a configuration file that sets the `GTK_MODULES` environment variable. This approach allows for seamless integration with the existing GTK theming system while providing the macOS-like hover effect.

<!-- Row 1: install & reach -->
![Install on GNOME Extensions](https://img.shields.io/badge/Install_on-GNOME_Extensions-blue?logo=gnome)![EGO Downloads](https://img.shields.io/gnome-extensions/dt/kiwi@kemma?logo=gnome&label=EGO%20downloads)![Shell 48–49](https://img.shields.io/badge/GNOME_Shell-48%E2%80%9350-informational?logo=gnome)![License](https://img.shields.io/github/license/kem-a/kiwi-kemma)![Latest release](https://img.shields.io/github/v/release/kem-a/kiwi-kemma?semver)![Stars](https://img.shields.io/github/stars/kem-a/kiwi-kemma?style=social)

# <img width="48" height="48" alt="kiwi_logo" src="https://github.com/user-attachments/assets/f7820666-899a-46b8-b022-d5349bb1731b" /> Kiwi (is not Apple)

Kiwi is a GNOME Shell extension that mimics various macOS features. This extension provides a collection of small quality-of-life functionalities such as moving windows to new workspaces, adding the username to the quick menu, focusing launched windows, and more.

<img src="https://extensions.gnome.org/extension-data/screenshots/screenshot_8276_to4T5k0.png" />

## Panel

- **Panel Transparency**: Make the top panel transparent, with optional blur and opaque mode when a window is maximized.
- **Show Panel in Fullscreen on Hover**: Show the panel when the mouse is near the top edge in fullscreen. Bugged for GTK4 apps.
- **Show Window Title**: Display the current window title in the top panel, with a tiling layouts menu.
- **Move Calendar to Right**: Move the calendar to the right side and move notifications and media controls to Quick Settings.
- **Battery Percentage**: Show battery percentage in the top bar when below 20%.
- **Caps Lock and Num Lock**: Show a Caps Lock and Num Lock icon in the top panel.
- **Custom Do Not Disturb Button**: Replace the system Do Not Disturb button with Kiwi's own.
- **Hide Activities Button**: Hide the Activities button in the top panel.
- **Add Username**: Add the username to the quick settings menu.
- **Panel Styling**: Tighter button spacing, smaller status icons, no dropdown arrows and a transparent panel in the overview.
- **Menu and App Styling**: Narrower shell menu items with accent colored hover and selection, plus GTK/Adwaita app fixes.
- **Style Keyboard Indicator**: Uppercase and border the keyboard/input source indicator, or hide it.

## Dock

Requires [Dash to Dock](https://extensions.gnome.org/extension/307/), except Launchpad Application.

- **Minimize Windows to Dock**: Park minimized windows as thumbnails after the apps and before the trash, macOS style.
- **Downloads Folder in Dock**: Add a Downloads folder before the trash that fans its newest files out over the desktop, macOS stack style.
- **Launchpad Application**: Add a custom Launchpad icon to the dock that opens the application overview.
- **Dock Styling**: Tighter icon spacing, no icon highlight and darker icons while pressed.
- **Dock Blur**: Blur the background behind the dock.
- **Adaptive Dock Colors**: Flip running indicators and separators between light and dark to suit whatever is behind the dock.

## Buttons

- **macOS Window Buttons**: Replace window control buttons with macOS style. Default, Alternative and Glass styles in two sizes, plus Firefox and Thunderbird styling.
- **Show Window Controls on Panel**: Move window controls to the top panel for maximized windows and remove their titlebars for maximum space.

## Options

- **Overview Wallpaper Blur**: Use the blurred current wallpaper as overview background.
- **Seamless Overview Zoom**: Zoom the whole desktop, including the strip behind the panel, in and out of the overview.
- **Focus on Overview Exit**: Focus the window under the cursor when leaving the overview, like macOS Mission Control.
- **Skip to Desktop**: Do not show the overview when logging in.
- **Hide Minimized Windows**: Hide minimized windows in the overview.
- **Move Window to New Workspace**: Move fullscreen windows to a new workspace.
- **Reduce App Animations**: Mimic macOS window opening and closing with a subtle scale and fade.
- **Focus New Windows**: Focus newly launched windows instead of showing window-ready notifications.
- **Transparent Move**: Make windows slightly transparent while moving.
- **Multilingual UI**: Fully translatable interface, easy to extend via `po/` files.

<details>
<summary><H2>Recommended Gnome Shell Extensions</H2> <b>(click to open)</b></summary>

- [**Kiwi Menu**](https://extensions.gnome.org/extension/8697/) by kem-a (Me)
- [**Dash to Dock**](https://extensions.gnome.org/extension/307/) by michele_g
- [**Superbar**](https://github.com/Furkan-rgb/superbar) by Furkan-rgb
- [**Compiz alike magic lamp effect**](https://extensions.gnome.org/extension/3740/) by hermes83
- [**AppIndicator Support**](https://extensions.gnome.org/extension/615/) by 3v1n0
- [**Blur My Shell**](https://github.com/aunetx/blur-my-shell) by aunetx
- [**Light Style**](https://extensions.gnome.org/extension/6198/) by fmuellner
- [**Weather or Not**](https://extensions.gnome.org/extension/5660/) by somepaulo
</details>

## Known Issues

- in multimonitor setup sometimes max number of workspaces are created. See issue #49.
- *move to fullscreen* can behave unexpectedly due to built in GNOME dynamic workspace management. Disabling it might help.
- Advanced triple button hover effect will not work for GTK3 flatpak apps due to sandboxing
- Electron apps now by default have wayland enabled which causes to use CSD and thus many title bar issues, like blurry icons or completely different window control icons. There is no CSS fix beyond avoiding forced Wayland or passing `--ozone-platform=x11` argument to force `Xwayland` usage.
- similarly to electron apps also KDE apps by default uses CSD on wayland causing the same issues. To force `Xwayland` usage for KDE apps have to pass environmental variable `QT_QPA_PLATFORM=xcb`.

<details>
<summary><H2>Flatpak theming</H2> <b>(click to open)</b></summary>
Run this command to override `xdg-config` and theme window control buttons for Flatpak apps:

```sh
flatpak override --user --filesystem=xdg-config/gtk-3.0:ro
flatpak override --user --filesystem=xdg-config/gtk-4.0:ro
flatpak override --user --filesystem=xdg-config/environment.d/:ro
flatpak override --user --filesystem=$HOME/.local/share/gnome-shell/extensions/kiwi@kemma/:ro
```
</details>

## Contributing Translations

Want to help translate Kiwi to your language? See the [translation guide](translating/README.md) for instructions.

## Advanced

The `advanced/` folder contains additional features that cannot be distributed through the GNOME Extensions platform due to security policies:

- **Titlebuttons Hover Effect**: Provides macOS-like hover effects for window controls for GTK3 apps
- Requires manual compilation and installation
- See [advanced/README.md](advanced/README.md) for detailed installation instructions
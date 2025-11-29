<!-- Row 1: install & reach -->
[![Install on GNOME Extensions](https://img.shields.io/badge/Install_on-GNOME_Extensions-blue?logo=gnome)](https://extensions.gnome.org/extension/8276/kiwi-is-not-apple/)
[![EGO Downloads](https://img.shields.io/gnome-extensions/dt/kiwi@kemma?logo=gnome&label=EGO%20downloads)](https://extensions.gnome.org/extension/8276/kiwi-is-not-apple/)
![Shell 45–49](https://img.shields.io/badge/GNOME_Shell-45–49-informational?logo=gnome)
[![License](https://img.shields.io/github/license/kem-a/kiwi-kemma)](https://github.com/kem-a/kiwi-kemma/blob/main/LICENSE)
[![Latest release](https://img.shields.io/github/v/release/kem-a/kiwi-kemma?semver)](https://github.com/kem-a/kiwi-kemma/releases/latest)
[![Stars](https://img.shields.io/github/stars/kem-a/kiwi-kemma?style=social)](https://github.com/kem-a/kiwi-kemma/stargazers)


# <img width="48" height="48" alt="kiwi_logo" src="https://github.com/user-attachments/assets/f7820666-899a-46b8-b022-d5349bb1731b" /> Kiwi is not Apple 

Kiwi is a GNOME Shell extension that mimics various macOS features. This extension provides a collection of small quality-of-life functionalities such as moving windows to new workspaces, adding the username to the quick menu, focusing launched windows, and more.


## Features

- **Set Panel Transparnecy**: Make the top panel transparent or opaque when window touches it
- **Window Control Button Style**: Set macOS window control button styles. Move to top panel for maximized windows and remove window titlebars for maximum space.
- **Move Window to New Workspace**: Automatically move fullscreen app to new workspace.
- **Focus Launched Window**: Focus on newly launched windows. Removes the annoying window-ready notification.
- **Transparent Move**: Make windows slightly transparent when moving.
- **Battery Percentage**: Show battery percentage in the system menu when below 20%.
- **Move calendar to the right**: Move calendar to right side and hide and add notifications and media controls to Quick Settings.
- **Show Window title**: Display current window title in the top panel
- **Show Panel on Hover**: Show panel when mouse is near top edge in fullscreen. Bugged for GTK4 apps.
- **Hide Minimized Windows**: Hide minimized windows in the overview
- **Overview Wallpaper Background blur**. Use blurred current wallpaper as overview background (requires **ImageMagick**).

## Extras
- **Lock Icon**: Display Caps Lock or Num Lock icon in the GNOME top panel.
- **Add Username to Quick Menu**: Display the username in the quick settings menu.
- **Skip Overview on Login**: Do not show the overview when logging into GNOME; go directly to the desktop.
- **Hide Activities Button**: Hide the Activities button in the top panel
- **Style Keyboard Indicator**. Style keyboard/input source indicator in panel by converting to uppercase and adding border. Also can hide it.

  
## Recommended Extensions for better experience

<details> <summary> Details <b>(click to open)</b> </summary>

- **[Dash to Dock](https://extensions.gnome.org/extension/307/)** by michele_g
- **[Compiz alike magic lamp effect](https://extensions.gnome.org/extension/3740/)** by hermes83
- **[Kiwi Menu](https://extensions.gnome.org/extension/8697/)** by Arnis Kemlers
- **[AppIndicator Support](https://extensions.gnome.org/extension/615/)** by 3v1n0
- **[Gtk4 Desktop Icons NG (DING)](https://extensions.gnome.org/extension/5263/)** by smedius
- **[Clipboard Indicator](https://extensions.gnome.org/extension/779/)** by Tudmotu
- **[Light Style](https://extensions.gnome.org/extension/6198/)** by fmuellner
- **[Weather or Not](https://extensions.gnome.org/extension/5660/)** by somepaulo
</details>

## Visual experience
<img width="3072" height="1920" alt="Screenshot From 2025-08-23 23-29-58" src="https://github.com/user-attachments/assets/99ddf567-2002-454d-92dd-b7460631ae44" />

## Flatpak theming

Run this command to override `xdg-config` and theme window control buttons for Flatpak apps:

```sh
flatpak override --user --filesystem=xdg-config/gtk-3.0:ro
flatpak override --user --filesystem=xdg-config/gtk-4.0:ro
flatpak override --user --filesystem=xdg-config/environment.d/:ro
flatpak override --user --filesystem=$HOME/.local/share/gnome-shell/extensions/kiwi@kemma/:ro
```

## Known Issues

- vertical multimonitor setup is not supported. Mouse cross blocked.
- Wacky behavior of move to fullscreen due to built in GNOME dynamic workspace management. Disabling it might help.
- Advanced triple button hover effect for GTK3 flatpak apps does not work due to sandboxing
- Electron apps launched with `--ozone-platform=wayland` use libdecor titlebars, so Kiwi's macOS buttons still apply but appear blurry and only react per-button; there is no CSS fix beyond avoiding forced Wayland or providing larger assets.

## Installing from Source

1. Clone the repository:
    ```sh
    git clone https://github.com/kem-a/kiwi-kemma.git
    ```

2. Copy the extension to the GNOME Shell extensions directory:
    ```sh
    cp -r kiwi-kemma ~/.local/share/gnome-shell/extensions/kiwi@kemma
    ```

3. Log out and log in to GNOME 

4. Enable the extension using GNOME Tweaks or Extensions app.

## Advanced

The `advanced/` folder contains additional features that cannot be distributed through the GNOME Extensions platform due to security policies:

- **Titlebuttons Hover Effect**: Provides macOS-like hover effects for window controls for GTK3 apps
- Requires manual compilation and installation
- See [advanced/README.md](advanced/README.md) for detailed installation instructions

## License
GPL-3.0-or-later. See [LICENSE](./LICENSE).


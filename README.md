<!-- Row 1: install & reach -->
[![Install on GNOME Extensions](https://img.shields.io/badge/Install_on-GNOME_Extensions-blue?logo=gnome)](https://extensions.gnome.org/extension/8276/kiwi-is-not-apple/)
[![EGO Downloads](https://img.shields.io/gnome-extensions/dt/kiwi@kemma?logo=gnome&label=EGO%20downloads)](https://extensions.gnome.org/extension/8276/kiwi-is-not-apple/)
![Shell 48–49](https://img.shields.io/badge/GNOME_Shell-48–49-informational?logo=gnome)
[![License](https://img.shields.io/github/license/kem-a/kiwi-kemma)](https://github.com/kem-a/kiwi-kemma/blob/main/LICENSE)
[![Latest release](https://img.shields.io/github/v/release/kem-a/kiwi-kemma?semver)](https://github.com/kem-a/kiwi-kemma/releases/latest)
[![Stars](https://img.shields.io/github/stars/kem-a/kiwi-kemma?style=social)](https://github.com/kem-a/kiwi-kemma/stargazers)


# <img width="48" height="48" alt="kiwi_logo" src="https://github.com/user-attachments/assets/f7820666-899a-46b8-b022-d5349bb1731b" /> Kiwi is not Apple 

Kiwi is a GNOME Shell extension that mimics various macOS features. This extension provides a collection of small quality-of-life functionalities such as moving windows to new workspaces, adding the username to the quick menu, focusing launched windows, and more.


## Features

- **Under the hood restyling**: very minimal Gnome shell and GTK/Adwaita app restyling keeping maximum look and compatibility. Reduced menu item spacing; menu item accent colors; uniform top panel status icon padding and more...
- **Window Control Button Style**: Set macOS window control button styles and sizes.
- **Firefox Styling**: Apply macOS window control styling for Firefox.
- **Show Window Controls in Panel**: Move buttons to top panel for maximized windows and remove window titlebars for maximum space.
- **Show Window title**: Display current window title in the top panel
- **Show Panel on Hover**: Show panel when mouse is near top edge in fullscreen. Bugged for GTK4 apps.
- **Move Window to New Workspace**: Automatically move fullscreen app to new workspace.
- **Set Panel Transparnecy**: Make the top panel transparent or opaque when window touches it
- **Transparent Move**: Make windows slightly transparent when moving.
- **Battery Percentage**: Show battery percentage in the system menu when below 20% and on battery.
- **Move calendar to the right**: Move calendar to right side and hide and add notifications and media controls to Quick Settings.
- **Overview Wallpaper Background blur**. Use blurred current wallpaper as overview background (requires **ImageMagick**).
- **Multilingual UI**: Ships with translations for 16 languages (de, es, et, fa, fi, fr, it, ko, lt, lv, nb, nl, pl, pt, sv, zh_CN) and is easy to extend via `po/` files.

<details> <summary> <H3> Extras </H3> <b>(click to open)</b> </summary>

- **Add Username to Quick Menu**: Display the username in the quick settings menu.
- **Caps Lock Icon**: Display Caps Lock or Num Lock icon in the GNOME top panel.
- **Hide Activities Button**: Hide the Activities button in the top panel
- **Hide Minimized Windows**: Hide minimized windows in the overview
- **Skip Overview on Login**: Do not show the overview when logging into GNOME; go directly to the desktop.
- **Launchpad Applications**: Add custom launch applications icon to the dock. Move it freely to any place.
- **Style Keyboard Indicator**. Style keyboard/input source indicator in panel by converting to uppercase and adding border. Also can hide it.
- **Focus Launched Window**: Focus on newly launched windows. Removes the annoying window-ready notification.
</details>
  
## Recommended Extensions for better experience

- **[Dash to Dock](https://extensions.gnome.org/extension/307/)** by michele_g
- **[Compiz alike magic lamp effect](https://extensions.gnome.org/extension/3740/)** by hermes83
- **[Kiwi Menu](https://extensions.gnome.org/extension/8697/)** by kem-a (Me)
- **[AppIndicator Support](https://extensions.gnome.org/extension/615/)** by 3v1n0
- **[Gtk4 Desktop Icons NG (DING)](https://extensions.gnome.org/extension/5263/)** by smedius
- **[Clipboard Indicator](https://extensions.gnome.org/extension/779/)** by Tudmotu
- **[Light Style](https://extensions.gnome.org/extension/6198/)** by fmuellner
- **[Weather or Not](https://extensions.gnome.org/extension/5660/)** by somepaulo

## Known Issues

- vertical multimonitor setup is not supported. Mouse cross blocked.
- Wacky behavior of move to fullscreen due to built in GNOME dynamic workspace management. Disabling it might help.
- Advanced triple button hover effect for GTK3 flatpak apps does not work due to sandboxing
- Electron apps launched with `--ozone-platform=wayland` use libdecor titlebars, so Kiwi's macOS buttons still apply but appear blurry and only react per-button; there is no CSS fix beyond avoiding forced Wayland or providing larger assets.

<details> <summary> <H2>Flatpak theming</H2> <b>(click to open)</b> </summary>
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

## License
GPL-3.0-or-later. See [LICENSE](./LICENSE).


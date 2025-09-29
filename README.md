# <img width="64" height="64" alt="Kiwi_logo (Edited)" src="https://github.com/user-attachments/assets/c321e6d1-a1b1-4a11-b7c2-c374c84d449b" /> Kiwi
<img width="600" height="490" alt="Kiwi_thumbnail" src="https://github.com/user-attachments/assets/982ee8f2-a05f-4099-bd46-4bacdf06edea" align="right" />
Kiwi is a GNOME Shell extension that mimics various macOS features. This extension provides a collection of small quality-of-life functionalities such as moving windows to new workspaces, adding the username to the quick menu, focusing launched windows, and more.



## Features

- **Move Window to New Workspace**: Automatically move fullscreen app to new workspace.
- **Add Username to Quick Menu**: Display the username in the quick settings menu.
- **Focus Launched Window**: Focus on newly launched windows. Removes the annoying window-ready notification.
- **Lock Icon**: Display Caps Lock or Num Lock icon in the GNOME top panel.
- **Transparent Move**: Make windows slightly transparent when moving.
- **Battery Percentage**: Show battery percentage in the system menu when below 25%.
- **Move calendar to the right**: Move calendar to right side and hide notifications.
- **Show Window title**: Display current window title in the top panel
- **Show Panel on Hover**: Show panel when mouse is near top edge in fullscreen
- **Hide Minimized Windows**: Hide minimized windows in the overview
- **Hide Activities Button**: Hide the Activities button in the top panel
- **Skip Overview on Login**: Do not show the overview when logging into GNOME; go directly to the desktop.
- **Set Panel Transparnecy**: Make the top panel transparent or opaque when window touches it
- **Window Control Button Style**: Set macOS window control button styles. Move to top panel for maximized windows and remove window titlebars for maximum space.

## Recommended Extensions for better experience

<details> <summary> Details <b>(click to open)</b> </summary>

- **[Dash to Dock](https://extensions.gnome.org/extension/307/dash-to-dock/)** by michele_g
- **[AppIndicator Support](https://extensions.gnome.org/extension/615/appindicator-support/)** by 3v1n0
- **[Compiz alike magic lamp effect](https://extensions.gnome.org/extension/3740/compiz-alike-magic-lamp-effect/)** by hermes83
- **[Gtk4 Desktop Icons NG (DING)](https://extensions.gnome.org/extension/5263/gtk4-desktop-icons-ng-ding/)** by smedius
- **[Clipboard Indicator](https://extensions.gnome.org/extension/779/clipboard-indicator/)** by Tudmotu
- **[Logo Menu](https://extensions.gnome.org/extension/4451/logo-menu/)** by Aryan Kaushik
</details>

## Visual experience
<img width="3072" height="1920" alt="Screenshot From 2025-08-23 23-29-58" src="https://github.com/user-attachments/assets/99ddf567-2002-454d-92dd-b7460631ae44" />

## Flatpak theming

Run this command to override `xdg-config` and theme window control buttons for Flatpak apps:

```sh
flatpak override --user --filesystem=xdg-config/gtk-3.0:ro
flatpak override --user --filesystem=xdg-config/gtk-4.0:ro
```

## Known Issues

- GTK4 apps in fullscreen: the top panel works but may be buggy and can conflict with the app’s own headerbar reveal logic.

## Installation

You can install the extension from the GNOME Extensions website:

[Kiwi on GNOME Extensions](https://extensions.gnome.org/extension/8276/kiwi-is-not-apple/)

## Installing from Source

1. Clone the repository:
    ```sh
    git clone https://github.com/kem-a/kiwi-kemma.git
    ```

2. Copy the extension to the GNOME Shell extensions directory:
    ```sh
    cp -r kiwi-kemma ~/.local/share/gnome-shell/extensions/kiwi@kemma
    ```

3. Restart GNOME Shell (press `Alt+F2`, type `r`, and press `Enter`).

4. Enable the extension using GNOME Tweaks or Extensions app.

## Advanced

The `advanced/` folder contains additional features that cannot be distributed through the GNOME Extensions platform due to security policies:

- **Titlebuttons Hover Effect**: Provides macOS-like hover effects for window controls
- Requires manual compilation and installation
- See [advanced/README.md](advanced/README.md) for detailed installation instructions

### Building

To build the extension, compile the GSettings schema:
```sh
glib-compile-schemas schemas/
```

## License
GPL-3.0-or-later. See [LICENSE](./LICENSE).


# Kiwi

Kiwi is a GNOME Shell extension that mimics various macOS features. This extension provides a collection of small quality-of-life functionalities such as moving windows to new workspaces, adding the username to the quick menu, focusing launched windows, and more.


## Features

- **Move Window to New Workspace**: Automatically move fullscreen app to new workspaces.
- **Add Username to Quick Menu**: Display the username in the quick settings menu.
- **Focus Launched Window**: Focus on newly launched windows. Removes the annoying window-ready notification.
- **Lock Icon**: Display Caps Lock or Num Lock icon in the GNOME top panel.
- **Transparent Move**: Make windows slightly transparent when moving.
- **Battery Percentage**: Show battery percentage in the system menu when below 25%.

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

### Building

To build the extension, compile the GSettings schema:
```sh
glib-compile-schemas schemas/
```

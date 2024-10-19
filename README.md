# Kiwi is not an Apple

Kiwi is a GNOME Shell extension that mimics various macOS features. This extension provides several functionalities such as moving windows to new workspaces, adding the username to the quick menu, focusing launched windows, and more.

## Features

- **Move Window to New Workspace**: Automatically move windows to new workspaces.
- **Add Username to Quick Menu**: Display the username in the quick settings menu.
- **Focus Launched Window**: Focus on newly launched windows.
- **Lock Icon**: Enable or disable the lock icon.
- **Transparent Move**: Enable or disable transparent window movement.
- **Battery Percentage**: Show or hide the battery percentage in the system menu.

## Installation

You can install the extension from the GNOME Extensions website:

[Kiwi is not an Apple on GNOME Extensions](https://extensions.gnome.org/extension/kiwi-is-not-an-apple/)

## Installing from Source

1. Clone the repository:
    ```sh
    git clone https://github.com/kem-a/kiwi-kemma.git
    ```

2. Navigate to the cloned directory:
    ```sh
    cd kiwi-kemma
    ```

3. Copy the extension to the GNOME Shell extensions directory:
    ```sh
    cp -r kiwi@kemma ~/.local/share/gnome-shell/extensions/
    ```

4. Restart GNOME Shell (press `Alt+F2`, type `r`, and press `Enter`).

5. Enable the extension using GNOME Tweaks or Extensions app.

### Building

To build the extension, compile the GSettings schema:
```sh
glib-compile-schemas schemas/

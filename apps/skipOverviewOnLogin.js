// SPDX-License-Identifier: GPL-3.0-or-later
// Prevents GNOME Shell from opening the overview automatically on login.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

let startupId = 0;

export function enable() {
    // Only login needs this: the startup animation ends in the overview. Later
    // calls (settings changes, unlock) must leave an open overview alone.
    if (!Main.layoutManager._startingUp || startupId)
        return;

    startupId = Main.layoutManager.connect('startup-complete', () => {
        Main.layoutManager.disconnect(startupId);
        startupId = 0;

        if (Main.overview.visible)
            Main.overview.hide();
    });
}

export function disable() {
    if (startupId) {
        Main.layoutManager.disconnect(startupId);
        startupId = 0;
    }
}

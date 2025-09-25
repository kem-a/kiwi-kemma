// SPDX-License-Identifier: GPL-3.0-or-later
// Prevents GNOME Shell from opening the overview automatically on login.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

let startupId = 0;
let originalShow = null;
let firstLogin = true;

export function enable() {
    // Override the overview's show method during startup to prevent any showing
    if (firstLogin && !originalShow) {
        originalShow = Main.overview.show;
        Main.overview.show = function(...args) {
            if (firstLogin && Main.layoutManager?._startingUp) {
                // Do nothing - completely prevent showing during startup
                return;
            }
            // Call original show method if not during first startup
            return originalShow.apply(this, args);
        };
    }

    // If shell is still starting up, wait for startup-complete
    if (Main.layoutManager?._startingUp) {
        if (startupId)
            return; // already connected

        startupId = Main.layoutManager.connect('startup-complete', () => {
            try {
                // Restore original show method after startup
                if (originalShow) {
                    Main.overview.show = originalShow;
                    originalShow = null;
                }
                firstLogin = false;
                
                // Hide if somehow still visible
                if (Main.overview.visible)
                    Main.overview.hide();
            } finally {
                if (startupId) {
                    Main.layoutManager.disconnect(startupId);
                    startupId = 0;
                }
            }
        });
        return;
    }

    // Otherwise, if already in overview, hide immediately
    if (Main.overview.visible) {
        Main.overview.hide();
        firstLogin = false;
    }
}

export function disable() {
    if (startupId) {
        try { Main.layoutManager.disconnect(startupId); } catch (_) { /* ignore */ }
        startupId = 0;
    }
    
    // Restore original show method if we overrode it
    if (originalShow) {
        Main.overview.show = originalShow;
        originalShow = null;
    }
    
    firstLogin = true;
}

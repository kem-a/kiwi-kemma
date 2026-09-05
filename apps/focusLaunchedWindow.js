// SPDX-License-Identifier: GPL-3.0-or-later
// Automatically focuses newly launched windows instead of showing alerts.

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// A window denied focus asks for attention as it maps, so only a request that
// lands right after the window appears is a launch. A later one is the app
// calling for the user, and is left to the dock indicator and its animations.
const LAUNCH_GRACE_US = 1000 * 1000;

export class FocusMyWindow {
    enable() {
        this._createdId = global.display.connect('window-created', (display, window) => {
            window._kiwiCreatedAt = GLib.get_monotonic_time();
        });

        this._attentionId = global.display.connect('window-demands-attention', (display, window) => {
            const createdAt = window._kiwiCreatedAt;
            if (createdAt && GLib.get_monotonic_time() - createdAt < LAUNCH_GRACE_US)
                Main.activateWindow(window);
        });
    }

    disable() {
        if (this._createdId) {
            global.display.disconnect(this._createdId);
            this._createdId = null;
        }
        if (this._attentionId) {
            global.display.disconnect(this._attentionId);
            this._attentionId = null;
        }
    }
}

let focusMyWindowInstance = null;

export function enable() {
    if (!focusMyWindowInstance) {
        focusMyWindowInstance = new FocusMyWindow();
        focusMyWindowInstance.enable();
    }
}

export function disable() {
    if (focusMyWindowInstance) {
        focusMyWindowInstance.disable();
        focusMyWindowInstance = null;
    }
}


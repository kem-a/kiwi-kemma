// SPDX-License-Identifier: GPL-3.0-or-later
// Adds Caps Lock and Num Lock indicators to the top panel.

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export const LockIcon = GObject.registerClass(
class LockIcon extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Lock Indicator', false);

        this.keymap = Clutter.get_default_backend().get_default_seat().get_keymap();

        // Get extension object for accessing icons
        const extensionObject = Main.extensionManager.lookup('kiwi@kemma');

        // Create icons
        this._numLockIcon = new St.Icon({
            gicon: Gio.FileIcon.new(Gio.File.new_for_path(extensionObject.dir.get_child('icons/num-lock-symbolic.svg').get_path())),
            style_class: 'system-status-icon',
        });

        this._capsLockIcon = new St.Icon({
            gicon: Gio.FileIcon.new(Gio.File.new_for_path(extensionObject.dir.get_child('icons/caps-lock-symbolic.svg').get_path())),
            style_class: 'system-status-icon',
        });

        // Create a layout container to hold both icons
        this._lockKeysLayout = new St.BoxLayout({
            vertical: false,
            style_class: 'lockkeys-container',
        });
        this._lockKeysLayout.add_child(this._numLockIcon);
        this._lockKeysLayout.add_child(this._capsLockIcon);
        this.add_child(this._lockKeysLayout);

        // Delay the state initialization to ensure the keymap is fully ready
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._updateLockState();

            // Connect to keymap state change after initial state has been set
            this._keymapChangedId = this.keymap.connect('state-changed', () => {
                this._updateLockState();
            });

            this._timeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateLockState() {
        const capsLockEnabled = this.keymap.get_caps_lock_state();
        const numLockEnabled = this.keymap.get_num_lock_state();
        
        if (capsLockEnabled !== this._capsLockEnabled) {
            this._capsLockEnabled = capsLockEnabled;
            this._animateIcon(this._capsLockIcon, capsLockEnabled);
        }
        if (numLockEnabled !== this._numLockEnabled) {
            this._numLockEnabled = numLockEnabled;
            this._animateIcon(this._numLockIcon, numLockEnabled);
        }
    }

    _animateIcon(icon, show) {
        icon.remove_all_transitions();

        let [, naturalWidth] = icon.get_preferred_width(-1);

        if (show) {
            icon.visible = true;
            icon.opacity = 0;
            icon.translation_x = naturalWidth;

            icon.ease({
                opacity: 255,
                translation_x: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            icon.opacity = 255;
            icon.translation_x = 0;

            icon.ease({
                opacity: 0,
                translation_x: naturalWidth,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    icon.visible = false;
                },
            });
        }
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        if (this._keymapChangedId) {
            this.keymap.disconnect(this._keymapChangedId);
            this._keymapChangedId = null;
        }
        super.destroy();
    }
});

let lockIcon = null;

export function enable() {
    if (!lockIcon) {
        lockIcon = new LockIcon();
        Main.panel.addToStatusArea('lock-indicator', lockIcon, 0, 'right');
    }
}

export function disable() {
    if (lockIcon) {
        lockIcon.destroy();
        lockIcon = null;
    }
}

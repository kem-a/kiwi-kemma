// lockIcon.js
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import Gdk from 'gi://Gdk';

export const LockIcon = GObject.registerClass(
class LockIcon extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Lock Indicator', false);

        this._capsLockIcon = new St.Icon({
            icon_name: 'caps-lock-enabled-symbolic',
            style_class: 'system-status-icon',
        });

        this._numLockIcon = new St.Icon({
            icon_name: 'num-lock-enabled-symbolic',
            style_class: 'system-status-icon',
        });

        this._capsLockIcon.visible = false;
        this._numLockIcon.visible = false;

        this.add_child(this._capsLockIcon);
        this.add_child(this._numLockIcon);

        this._updateLockState();
    }

    _updateLockState() {
        const display = Gdk.Display.get_default();
        if (!display) {
            log('Failed to get default display');
            return;
        }

        const keymap = display.get_keymap();
        if (!keymap) {
            log('Failed to get keymap from display');
            return;
        }

        const capsLockEnabled = keymap.get_caps_lock_state();
        const numLockEnabled = keymap.get_num_lock_state();

        this._capsLockIcon.visible = capsLockEnabled;
        this._numLockIcon.visible = numLockEnabled;
    }

    enable() {
        Main.panel.addToStatusArea('lock-indicator', this, 1, 'right');

        const display = Gdk.Display.get_default();
        if (!display) {
            log('Failed to get default display');
            return;
        }

        const keymap = display.get_keymap();
        if (!keymap) {
            log('Failed to get keymap from display');
            return;
        }

        this._keymapChangedId = keymap.connect('state-changed', () => {
            this._updateLockState();
        });
    }

    disable() {
        const display = Gdk.Display.get_default();
        if (display) {
            const keymap = display.get_keymap();
            if (keymap && this._keymapChangedId) {
                keymap.disconnect(this._keymapChangedId);
                this._keymapChangedId = null;
            }
        }

        this.destroy();
    }
});

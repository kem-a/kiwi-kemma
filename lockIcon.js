// lockIcon.js
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export const LockIcon = GObject.registerClass(
class LockIcon extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Lock Indicator', false);

        this.keymap = Clutter.get_default_backend().get_default_seat().get_keymap();

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

        const layoutManager = new St.BoxLayout({
            vertical: false,
            style_class: 'lockkeys-container',
        });
        layoutManager.add_child(this._capsLockIcon);
        layoutManager.add_child(this._numLockIcon);
        this.add_child(layoutManager);

        this._updateLockState();

        this._keymapChangedId = this.keymap.connect('state-changed', () => {
            this._updateLockState();
        });
    }

    _updateLockState() {
        const capsLockEnabled = this.keymap.get_caps_lock_state();
        const numLockEnabled = this.keymap.get_num_lock_state();

        this._capsLockIcon.visible = capsLockEnabled;
        this._numLockIcon.visible = numLockEnabled;
    }

    destroy() {
        if (this._keymapChangedId) {
            this.keymap.disconnect(this._keymapChangedId);
            this._keymapChangedId = null;
        }
        super.destroy();
    }
});

let lockIcon;

export function enable() {
    lockIcon = new LockIcon();
    Main.panel.addToStatusArea('lock-indicator', lockIcon, 1, 'right');
}

export function disable() {
    if (lockIcon) {
        lockIcon.destroy();
        lockIcon = null;
    }
}

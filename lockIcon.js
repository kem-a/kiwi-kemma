// lockIcon.js
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const extensionObject = Main.extensionManager.lookup('kiwi@kemma');

export const LockIcon = GObject.registerClass(
class LockIcon extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Lock Indicator', false);

        this.keymap = Clutter.get_default_backend().get_default_seat().get_keymap();

        this._numLockIcon = new St.Icon({
            gicon: Gio.FileIcon.new(Gio.File.new_for_path(extensionObject.dir.get_child('icons/num-lock-symbolic.svg').get_path())),
            style_class: 'system-status-icon',
        });

        this._capsLockIcon = new St.Icon({
            gicon: Gio.FileIcon.new(Gio.File.new_for_path(extensionObject.dir.get_child('icons/caps-lock-symbolic.svg').get_path())),
            style_class: 'system-status-icon',
        });
        
        this._numLockContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: false,
            y_expand: false,
            clip_to_allocation: true,
        });
        this._numLockContainer.add_child(this._numLockIcon);

        this._capsLockContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: false,
            y_expand: false,
            clip_to_allocation: true,
        });
        this._capsLockContainer.add_child(this._capsLockIcon);

        const layoutManager = new St.BoxLayout({
            vertical: false,
            style_class: 'lockkeys-container',
        });
        layoutManager.add_child(this._numLockContainer);
        layoutManager.add_child(this._capsLockContainer);
        this.add_child(layoutManager);

        this._capsLockEnabled = this.keymap.get_caps_lock_state();
        this._numLockEnabled = this.keymap.get_num_lock_state();

        this._initializeIcon(this._numLockContainer, this._numLockIcon, this._numLockEnabled);
        this._initializeIcon(this._capsLockContainer, this._capsLockIcon, this._capsLockEnabled);
        this._updateLockState();

        this._keymapChangedId = this.keymap.connect('state-changed', () => {
            this._updateLockState();
        });
    }

    _initializeIcon(container, icon, enabled) {
        container.visible = enabled;
        icon.translation_x = enabled ? 0 : icon.width;

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            let [, naturalWidth] = icon.get_preferred_width(-1);
            container.set_width(naturalWidth);

            if (enabled) {
                icon.translation_x = 0;
            } else {
                icon.translation_x = naturalWidth;
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    _updateLockState() {
        const capsLockEnabled = this.keymap.get_caps_lock_state();
        const numLockEnabled = this.keymap.get_num_lock_state();

        if (capsLockEnabled !== this._capsLockEnabled) {
            this._capsLockEnabled = capsLockEnabled;
            this._animateIcon(this._capsLockContainer, this._capsLockIcon, capsLockEnabled);
        }
        if (numLockEnabled !== this._numLockEnabled) {
            this._numLockEnabled = numLockEnabled;
            this._animateIcon(this._numLockContainer, this._numLockIcon, numLockEnabled);
        }
    }

    _animateIcon(container, icon, show) {
        icon.remove_all_transitions();

        if (show) {
            container.visible = true;
        }

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            let [, naturalWidth] = icon.get_preferred_width(-1);
            container.set_width(naturalWidth);

            if (show) {
                icon.translation_x = naturalWidth;
                icon.ease({
                    translation_x: 0,
                    duration: 250,
                    mode: Clutter.AnimationMode.LINEAR,
                    onComplete: () => {
                        icon.translation_x = 0;
                    },
                });
            } else {
                icon.ease({
                    translation_x: naturalWidth,
                    duration: 250,
                    mode: Clutter.AnimationMode.LINEAR,
                    onComplete: () => {
                        icon.translation_x = naturalWidth;
                        container.visible = false;
                    },
                });
            }
            return GLib.SOURCE_REMOVE;
        });
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

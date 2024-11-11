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
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            //this._capsLockEnabled = this.keymap.get_caps_lock_state();
            //this._numLockEnabled = this.keymap.get_num_lock_state();

            this._updateLockState();

            // Connect to keymap state change after initial state has been set
            this._keymapChangedId = this.keymap.connect('state-changed', () => {
                this._updateLockState();
            });

            return GLib.SOURCE_REMOVE;
        });
    }

    _updateLockState() {
        const capsLockEnabled = this.keymap.get_caps_lock_state();
        const numLockEnabled = this.keymap.get_num_lock_state();
        
        log(`Caps Lock is ${capsLockEnabled ? 'enabled' : 'disabled'}`);
        log(`Num Lock is ${numLockEnabled ? 'enabled' : 'disabled'}`);
        if (capsLockEnabled !== this._capsLockEnabled) {
            this._capsLockEnabled = capsLockEnabled;
            this._capsLockIcon.visible = capsLockEnabled;
            this._animateIcon(this._lockKeysLayout, this._capsLockIcon, capsLockEnabled);
            this._capsLockIcon.visible = capsLockEnabled;
        }
        if (numLockEnabled !== this._numLockEnabled) {
            this._numLockEnabled = numLockEnabled;
            this._numLockIcon.visible = numLockEnabled;
            this._animateIcon(this._lockKeysLayout, this._numLockIcon, numLockEnabled);
            this._numLockIcon.visible = numLockEnabled;
        }
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            //this._numLockIcon.visible = numLockEnabled;
            //this._capsLockIcon.visible = capsLockEnabled;
        });
    }

    _animateIcon(container, icon, show) {
        icon.remove_all_transitions();
        container.remove_all_transitions();

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            let [, naturalWidth] = icon.get_preferred_width(-1);
            let totalWidth = naturalWidth;

            if (this._capsLockEnabled && this._numLockEnabled) {
                totalWidth = 2 * naturalWidth;
            }

            this.visible = true;
            if (show) {
                container.visible = true;
                container.ease({
                    width: totalWidth,
                    duration: 250,
                    mode: Clutter.AnimationMode.LINEAR,
                    onComplete: () => {
                        container.translation_x = 0;
                    },
                });

                icon.translation_x = naturalWidth;
                log(`Icon width: ${naturalWidth}`);
                icon.ease({
                    translation_x: 0,
                    duration: 250,
                    mode: Clutter.AnimationMode.LINEAR,
                    onComplete: () => {
                        icon.translation_x = 0;
                    },
                });
            } else {
                container.ease({
                    width: this._capsLockEnabled || this._numLockEnabled ? naturalWidth : 0,
                    duration: 250,
                    mode: Clutter.AnimationMode.LINEAR,
                    onComplete: () => {
                        container.visible = this._capsLockEnabled || this._numLockEnabled;
                        if (!this._capsLockEnabled && !this._numLockEnabled) {
                            this.visible = false;
                        }
                    },
                });
                
                icon.ease({
                    translation_x: naturalWidth,
                    duration: 250,
                    mode: Clutter.AnimationMode.LINEAR,
                    onComplete: () => {
                        icon.translation_x = naturalWidth;
                        log(`Icon width on complete: ${naturalWidth}`);
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

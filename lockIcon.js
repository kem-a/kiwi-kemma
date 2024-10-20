// lockIcon.js
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
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

        // Create individual containers for each icon to handle animations separately
        this._capsLockContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: false,
            y_expand: false,
            clip_to_allocation: true, // Ensure clipping
        });
        this._capsLockContainer.add_child(this._capsLockIcon);

        this._numLockContainer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: false,
            y_expand: false,
            clip_to_allocation: true, // Ensure clipping
        });
        this._numLockContainer.add_child(this._numLockIcon);

        const layoutManager = new St.BoxLayout({
            vertical: false,
            style_class: 'lockkeys-container',
        });
        layoutManager.add_child(this._capsLockContainer);
        layoutManager.add_child(this._numLockContainer);
        this.add_child(layoutManager);

        // Initialize the lock states
        this._capsLockEnabled = this.keymap.get_caps_lock_state();
        this._numLockEnabled = this.keymap.get_num_lock_state();

        // Set initial properties for the icons
        this._initializeIcon(this._capsLockContainer, this._capsLockIcon, this._capsLockEnabled);
        this._initializeIcon(this._numLockContainer, this._numLockIcon, this._numLockEnabled);

        // Connect to the keymap state-changed signal
        this._keymapChangedId = this.keymap.connect('state-changed', () => {
            this._updateLockState();
        });
    }

    _initializeIcon(container, icon, enabled) {
        // Set container visibility immediately
        container.visible = enabled;

        // Set initial translation_x based on the enabled state
        icon.translation_x = enabled ? 0 : icon.width;

        // Wait for the actor to be allocated to get its width
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            // Get the natural width of the icon
            let [, naturalWidth] = icon.get_preferred_width(-1);

            // Set the container's width to the icon's width
            container.set_width(naturalWidth);

            // Adjust translation_x if necessary
            if (enabled) {
                icon.translation_x = 0;
            } else {
                icon.translation_x = naturalWidth;
            }

            return GLib.SOURCE_REMOVE; // Remove the idle callback
        });
    }

    _updateLockState() {
        const capsLockEnabled = this.keymap.get_caps_lock_state();
        const numLockEnabled = this.keymap.get_num_lock_state();

        if (capsLockEnabled !== this._capsLockEnabled) {
            this._animateIcon(this._capsLockContainer, this._capsLockIcon, capsLockEnabled);
            this._capsLockEnabled = capsLockEnabled;
        }
        if (numLockEnabled !== this._numLockEnabled) {
            this._animateIcon(this._numLockContainer, this._numLockIcon, numLockEnabled);
            this._numLockEnabled = numLockEnabled;
        }
    }

    _animateIcon(container, icon, show) {
        // Stop any existing animations
        icon.remove_all_transitions();

        // Wait for the actor to be allocated to get its width
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            // Get the natural width of the icon
            let [, naturalWidth] = icon.get_preferred_width(-1);

            // Set the container's width to the icon's width
            container.set_width(naturalWidth);

            if (show) {
                // Ensure the container is visible
                container.visible = true;

                // Start the icon off-screen to the right
                icon.translation_x = naturalWidth;

                // Animate the icon sliding in from right to left
                icon.ease({
                    translation_x: 0,
                    duration: 250, // Duration remains 250 milliseconds
                    mode: Clutter.AnimationMode.LINEAR,
                    onComplete: () => {
                        icon.translation_x = 0;
                    },
                });
            } else {
                // Animate the icon sliding out to the right
                icon.ease({
                    translation_x: naturalWidth,
                    duration: 250, // Duration remains 250 milliseconds
                    mode: Clutter.AnimationMode.LINEAR,
                    onComplete: () => {
                        icon.translation_x = naturalWidth;
                        container.visible = false;
                    },
                });
            }
            return GLib.SOURCE_REMOVE; // Remove the idle callback
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
        Main.panel.addToStatusArea('lock-indicator', lockIcon, 1, 'right');
    }
}

export function disable() {
    if (lockIcon) {
        lockIcon.destroy();
        lockIcon = null;
    }
}

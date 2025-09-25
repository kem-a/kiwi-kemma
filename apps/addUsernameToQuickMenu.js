// SPDX-License-Identifier: GPL-3.0-or-later
// Shows the logged-in user's name in the quick settings indicators.

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GObject from 'gi://GObject';

export const AddUsernameToQuickMenu = GObject.registerClass(
class AddUsernameToQuickMenu extends St.Widget {
    _init() {
        super._init({
            layout_manager: new Clutter.BinLayout(),
            x_expand: false,
            y_expand: false,
            clip_to_allocation: true, // Ensure clipping
            style_class: 'username-container',
        });

        this._usernameLabel = new St.Label({
            text: GLib.get_real_name() + '  ',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            x_expand: false,
            y_expand: false,
            style_class: 'username-label',
        });
        this.add_child(this._usernameLabel);

        // Initially hide the actor
        this.visible = false;

        // Start with the label translated fully to the right
        this._usernameLabel.translation_x = this._usernameLabel.width;
    }

    animateIn() {
        // Ensure the actor is visible
        this.visible = true;

        // Wait for the actor to be allocated to get its width
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            // Get the full width of the label
            let [, naturalWidth] = this._usernameLabel.get_preferred_width(-1);

            // Set the container's width to the label's width
            this.set_width(naturalWidth);

            // Start the label off-screen to the right
            this._usernameLabel.translation_x = naturalWidth;

            // Animate the label sliding in from right to left
            this._usernameLabel.ease({
                translation_x: 0,
                duration: 250, // Set duration to 1000 milliseconds
                mode: Clutter.AnimationMode.LINEAR, // Constant speed
                onComplete: () => {
                    this._usernameLabel.translation_x = 0;
                },
            });

            return GLib.SOURCE_REMOVE; // Stop the idle callback
        });
    }

    animateOut(callback) {
        // Get the full width of the label
        let [, naturalWidth] = this._usernameLabel.get_preferred_width(-1);

        // Stop any existing animations
        this._usernameLabel.remove_all_transitions();

        // Animate the label sliding out to the right
        this._usernameLabel.ease({
            translation_x: naturalWidth,
            duration: 250, // Set duration to 1000 milliseconds
            mode: Clutter.AnimationMode.LINEAR, // Constant speed
            onComplete: () => {
                this._usernameLabel.translation_x = naturalWidth;
                this.visible = false;

                if (callback) {
                    callback();
                }
            },
        });
    }

    destroy() {
        super.destroy();
    }
});

let addUsernameInstance;

export function enable() {
    if (!addUsernameInstance) {
        addUsernameInstance = new AddUsernameToQuickMenu();
        const QuickSettingsMenu = Main.panel.statusArea.quickSettings;

        // Insert your instance into the indicators container at the first position
        QuickSettingsMenu._indicators.insert_child_at_index(addUsernameInstance, 0);

        // Animate the username sliding in
        addUsernameInstance.animateIn();
    }
}

export function disable() {
    if (addUsernameInstance) {
        // Animate the username sliding out, then remove it
        addUsernameInstance.animateOut(() => {
            const QuickSettingsMenu = Main.panel.statusArea.quickSettings;
            QuickSettingsMenu._indicators.remove_child(addUsernameInstance);
            addUsernameInstance.destroy();
            addUsernameInstance = null;
        });
    }
}

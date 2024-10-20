// addUsernameToQuickMenu.js
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GObject from 'gi://GObject';

export const AddUsernameToQuickMenu = GObject.registerClass(
class AddUsernameToQuickMenu extends St.BoxLayout {
    _init() {
        super._init({
            vertical: false,
            x_expand: false,
            y_expand: false,
            style_class: 'username-container',
        });

        const usernameLabel = new St.Label({
            text: GLib.get_real_name() + '  ',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
            x_expand: false,
            y_expand: false,
            style_class: 'username-label',
        });
        this.add_child(usernameLabel);
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

        // Insert your instance into the indicators container
        QuickSettingsMenu._indicators.insert_child_at_index(addUsernameInstance, 0);
    }
}

export function disable() {
    if (addUsernameInstance) {
        const QuickSettingsMenu = Main.panel.statusArea.quickSettings;
        QuickSettingsMenu._indicators.remove_child(addUsernameInstance);
        addUsernameInstance.destroy();
        addUsernameInstance = null;
    }
}

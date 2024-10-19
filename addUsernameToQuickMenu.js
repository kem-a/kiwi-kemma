// addUsernameToQuickMenu.js
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import { SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GObject from 'gi://GObject';

export const AddUsernameToQuickMenu = GObject.registerClass(
class AddUsernameToQuickMenu extends SystemIndicator {
    _init() {
        super._init();

        // Create the text label for a new indicator (child)
        this._indicator = this._addIndicator();
        const usernameLabel = new St.Label({
            text: GLib.get_real_name() + '  ',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(usernameLabel);
    }

    enable() {
        const QuickSettingsMenu = Main.panel.statusArea.quickSettings;
        QuickSettingsMenu.addExternalIndicator(this);
    }

    disable() {
        this.destroy();
    }
});


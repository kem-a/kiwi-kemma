import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class KiwiPreferences extends ExtensionPreferences {
    constructor(metadata) {
        super(metadata);
    }

    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.title = 'Kiwi is not an Apple';

        const page = new Adw.PreferencesPage({
            title: 'Settings',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'Kiwi',
        });
        page.add(group);

        const switchList = [
            { key: 'move-window-to-new-workspace', title: _("Move Window to New Workspace") },
            { key: 'add-username-to-quick-menu', title: _("Add Username to Quick Menu") },
            { key: 'focus-launched-window', title: _("Focus Launched Window") },
            { key: 'lock-icon', title: _("Lock Icon") },
            { key: 'transparent-move', title: _("Transparent Move") },
            { key: 'battery-percentage', title: _("Battery Percentage") },
        ];

        switchList.forEach((item) => {
            const switchRow = new Adw.SwitchRow({
                title: item.title,
                active: settings.get_boolean(item.key),
            });
            group.add(switchRow);
            window._settings.bind(item.key, switchRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        });

        // About Tab
        const aboutPage = new Adw.PreferencesPage({
            title: 'About',
            icon_name: 'help-about-symbolic',
        });
        window.add(aboutPage);

        const aboutGroup = new Adw.PreferencesGroup();
        aboutPage.add(aboutGroup);

        const aboutLabel1 = new Gtk.Label({
            label: 'Kiwi is not an Apple v0-alpha',
            xalign: 0,
        });
        aboutGroup.add(aboutLabel1);

        const aboutLabel2 = new Gtk.Label({
            label: 'by Kemma',
            xalign: 0,
        });
        aboutGroup.add(aboutLabel2);

        const aboutLink = new Gtk.LinkButton({
            label: 'GitHub: https://github.com/kem-a/kiwi-kemma',
            uri: 'https://github.com/kem-a/kiwi-kemma',
        });
        aboutGroup.add(aboutLink);
    }
}

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
            title: _('Kiwi'),
            description: _('Kiwi is not an Apple is a collection of MacOS like features for GNOME'),
        });
        page.add(group);

        const switchList = [
            { key: 'move-window-to-new-workspace', title: _("Move Window to New Workspace"), subtitle: _("Move fullscreen window to a new workspace") },
            { key: 'add-username-to-quick-menu', title: _("Add Username"), subtitle: _("Add username to the quick menu") },
            { key: 'focus-launched-window', title: _("Focus Launched Window"), subtitle: _("Focus the window when launched") },
            { key: 'lock-icon', title: _("Caps Lock and Num Lock"), subtitle: _("Show Caps Lock and Num Lock icon") },
            { key: 'transparent-move', title: _("Transparent Move"), subtitle: _("Move window with transparency") },
            { key: 'battery-percentage', title: _("Battery Percentage"), subtitle: _("Show battery percentage in the top bar when below 25%") },
        ];

        switchList.forEach((item) => {
            const switchRow = new Adw.SwitchRow({
                title: item.title,
                subtitle: item.subtitle,
                active: settings.get_boolean(item.key),
            });
            group.add(switchRow);
            window._settings.bind(item.key, switchRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        });

        // About Page
        const aboutPage = new Adw.PreferencesPage({
            title: 'About',
            icon_name: 'help-about-symbolic',
        });
        window.add(aboutPage);

        const stack = new Gtk.Stack();
        stack.set_transition_type(Gtk.StackTransitionType.SLIDE_LEFT_RIGHT);

        const aboutDialog = new Gtk.AboutDialog({
            program_name: 'Kiwi is not an Apple',
            version: 'v0-alpha',
            comments: 'Kiwi is not an Apple is a collection of MacOS like features for GNOME',
            authors: ['Kemma'],
            website: 'https://github.com/kem-a/kiwi-kemma',
            website_label: 'GitHub: https://github.com/kem-a/kiwi-kemma',
            license_type: Gtk.License.MIT_X11,
        });

        const aboutBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });

        aboutBox.append(new Gtk.Label({
            label: `<b>${aboutDialog.program_name}</b>`,
            use_markup: true,
            halign: Gtk.Align.START,
        }));

        aboutBox.append(new Gtk.Label({
            label: `Version: ${aboutDialog.version}`,
            halign: Gtk.Align.START,
        }));

        aboutBox.append(new Gtk.Label({
            label: aboutDialog.comments,
            halign: Gtk.Align.START,
        }));

        aboutBox.append(new Gtk.Label({
            label: `Authors: ${aboutDialog.authors.join(', ')}`,
            halign: Gtk.Align.START,
        }));

        const websiteLink = new Gtk.LinkButton({
            label: aboutDialog.website_label,
            uri: aboutDialog.website,
        });
        aboutBox.append(websiteLink);

        const licenseLink = new Gtk.LinkButton({
            label: 'MIT License',
            uri: 'https://github.com/kem-a/kiwi-kemma?tab=MIT-1-ov-file#readme',
        });
        aboutBox.append(licenseLink);

        stack.add_titled(aboutBox, 'about', 'About');

        const creditsBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });

        creditsBox.append(new Gtk.Label({
            label: `Special thanks to all contributors and the GNOME community.`,
            halign: Gtk.Align.START,
        }));

        stack.add_titled(creditsBox, 'credits', 'Credits');

        const stackSwitcher = new Gtk.StackSwitcher({
            stack: stack,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.START,
        });

        const aboutGroup = new Adw.PreferencesGroup();
        aboutGroup.add(stackSwitcher);
        aboutGroup.add(stack);
        aboutPage.add(aboutGroup);
    }
}

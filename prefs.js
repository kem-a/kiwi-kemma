import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
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
            { key: 'move-calendar-right', title: _("Move Calendar to Right"), subtitle: _("Move calendar to right side and hide notifications") },
            { key: 'show-window-title', title: _("Show Window Title"), subtitle: _("Display current window title in the top panel") },
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

        const buttonTypeGroup = new Adw.PreferencesGroup({
            title: _('Window Control Button Style'),
            description: _('Select the style of window control buttons'),
        });
        page.add(buttonTypeGroup);

        // Add window controls switch to button style group
        const windowControlsSwitch = new Adw.SwitchRow({
            title: _("Show Window Controls"),
            subtitle: _("Display window control buttons in the top panel"),
            active: settings.get_boolean('show-window-controls'),
        });
        buttonTypeGroup.add(windowControlsSwitch);
        settings.bind('show-window-controls', windowControlsSwitch, 'active', 
            Gio.SettingsBindFlags.DEFAULT);

        // Add show on maximize switch
        const showOnMaxSwitch = new Adw.SwitchRow({
            title: _("Show Controls on Maximize"),
            subtitle: _("Show window controls when window is maximized"),
            active: settings.get_boolean('show-controls-on-maximize'),
            sensitive: settings.get_boolean('show-window-controls'),
        });
        buttonTypeGroup.add(showOnMaxSwitch);
        settings.bind('show-controls-on-maximize', showOnMaxSwitch, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-window-controls', showOnMaxSwitch, 'sensitive',
            Gio.SettingsBindFlags.GET);

        const buttonTypeModel = new Gtk.StringList();
        buttonTypeModel.append('titlebuttons');
        buttonTypeModel.append('titlebuttons-alt');

        const buttonTypeCombo = new Adw.ComboRow({
            title: _('Button Type'),
            subtitle: _('Choose the button icon set'),
            model: buttonTypeModel,
            selected: settings.get_string('button-type') === 'titlebuttons' ? 0 : 1,
            sensitive: settings.get_boolean('show-window-controls'),
        });
        buttonTypeGroup.add(buttonTypeCombo);

        // Bind combo sensitivity to switch state
        settings.bind('show-window-controls', buttonTypeCombo, 'sensitive',
            Gio.SettingsBindFlags.GET);

        buttonTypeCombo.connect('notify::selected', (combo) => {
            settings.set_string('button-type', combo.selected_item.get_string());
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

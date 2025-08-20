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
        window.title = 'Kiwi is not Apple';

        // Settings Page
        const settingsPage = new Adw.PreferencesPage({
            title: 'Settings',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(settingsPage);

        const group = new Adw.PreferencesGroup({
            title: _('Kiwi'),
            description: _('Kiwi is not Apple is a collection of macOS-like features for GNOME'),
        });
        settingsPage.add(group);

        // Add panel transparency group
        const transparencyGroup = new Adw.PreferencesGroup({
            title: _('Panel Transparency'),
            description: _('Configure panel transparency settings'),
        });
        settingsPage.add(transparencyGroup);

        // Enable transparency switch
        const transparencySwitch = new Adw.SwitchRow({
            title: _("Enable Panel Transparency"),
            subtitle: _("Make the top panel transparent"),
            active: settings.get_boolean('panel-transparency'),
        });
        transparencyGroup.add(transparencySwitch);
        settings.bind('panel-transparency', transparencySwitch, 'active', 
            Gio.SettingsBindFlags.DEFAULT);

        // Transparency level spinbox
        const transparencySpinRow = new Adw.SpinRow({
            title: _("Transparency Level"),
            subtitle: _("Set panel transparency (0-100)"),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 1,
                page_increment: 10,
                value: settings.get_int('panel-transparency-level'),
            }),
            sensitive: settings.get_boolean('panel-transparency'),
        });
        transparencyGroup.add(transparencySpinRow);
        settings.bind('panel-transparency-level', transparencySpinRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-transparency', transparencySpinRow, 'sensitive',
            Gio.SettingsBindFlags.GET);

        // Opaque on window touch switch
        const opaqueOnWindowSwitch = new Adw.SwitchRow({
            title: _("Opaque When Window Touches"),
            subtitle: _("Make panel opaque when a window touches it"),
            active: settings.get_boolean('panel-opaque-on-window'),
            sensitive: settings.get_boolean('panel-transparency'),
        });
        transparencyGroup.add(opaqueOnWindowSwitch);
        settings.bind('panel-opaque-on-window', opaqueOnWindowSwitch, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-transparency', opaqueOnWindowSwitch, 'sensitive',
            Gio.SettingsBindFlags.GET);

        const switchList = [
            { key: 'move-window-to-new-workspace', title: _("Move Window to New Workspace"), subtitle: _("Move fullscreen window to a new workspace") },
            { key: 'add-username-to-quick-menu', title: _("Add Username"), subtitle: _("Add username to the quick menu") },
            { key: 'focus-launched-window', title: _("Focus Launched Window"), subtitle: _("Focus the window when launched") },
            { key: 'lock-icon', title: _("Caps Lock and Num Lock"), subtitle: _("Show Caps Lock and Num Lock icon") },
            { key: 'transparent-move', title: _("Transparent Move"), subtitle: _("Move window with transparency") },
            { key: 'battery-percentage', title: _("Battery Percentage"), subtitle: _("Show battery percentage in the top bar when below 25%") },
            { key: 'move-calendar-right', title: _("Move Calendar to Right (BUGGED)"), subtitle: _("Move calendar to right side and hide notifications") },
            { key: 'show-window-title', title: _("Show Window Title"), subtitle: _("Display current window title in the top panel") },
            { key: 'panel-hover-fullscreen', title: _("Show Panel on Hover"), subtitle: _("Show panel when mouse is near top edge in fullscreen") },
            { key: 'hide-minimized-windows', title: _("Hide Minimized Windows"), subtitle: _("Hide minimized windows in the overview") },
            { key: 'hide-activities-button', title: _("Hide Activities Button"), subtitle: _("Hide the Activities button in the top panel") },
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
            description: _('Select the style of window control buttons. You need to log out for the effect to apply to all apps.'),
        });
        settingsPage.add(buttonTypeGroup);

        // Add primary enable application window buttons switch (first option)
        const appWindowButtonsSwitch = new Adw.SwitchRow({
            title: _("Enable Application Window Buttons"),
            subtitle: _("Show window control buttons in application windows"),
            active: settings.get_boolean('enable-app-window-buttons'),
        });
        buttonTypeGroup.add(appWindowButtonsSwitch);
        settings.bind('enable-app-window-buttons', appWindowButtonsSwitch, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        // Add merged window controls switch for panel
        const windowControlsPanelSwitch = new Adw.SwitchRow({
            title: _("Show Window Controls on Panel"),
            subtitle: _("Display window control buttons in the top panel when window is maximized"),
            active: settings.get_boolean('show-window-controls'),
            sensitive: settings.get_boolean('enable-app-window-buttons'),
        });
        buttonTypeGroup.add(windowControlsPanelSwitch);
        settings.bind('show-window-controls', windowControlsPanelSwitch, 'active', 
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-app-window-buttons', windowControlsPanelSwitch, 'sensitive',
            Gio.SettingsBindFlags.GET);

        const buttonTypeModel = new Gtk.StringList();
        buttonTypeModel.append('titlebuttons');
        buttonTypeModel.append('titlebuttons-alt');
        buttonTypeModel.append('titlebuttons-png');

        let selectedIndex = 0;
        const currentButtonType = settings.get_string('button-type');
        if (currentButtonType === 'titlebuttons-alt') selectedIndex = 1;
        else if (currentButtonType === 'titlebuttons-png') selectedIndex = 2;

        const buttonTypeCombo = new Adw.ComboRow({
            title: _('Button Type'),
            subtitle: _('Choose the button icon set'),
            model: buttonTypeModel,
            selected: selectedIndex,
            sensitive: settings.get_boolean('enable-app-window-buttons'),
        });
        buttonTypeGroup.add(buttonTypeCombo);

        // Bind combo sensitivity to primary app buttons switch
        settings.bind('enable-app-window-buttons', buttonTypeCombo, 'sensitive',
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

        const aboutGroup = new Adw.PreferencesGroup();
        const aboutBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });

        aboutBox.append(new Gtk.Label({
            label: '<b>Kiwi is not Apple</b>',
            use_markup: true,
            halign: Gtk.Align.START,
        }));

        aboutBox.append(new Gtk.Label({
            label: 'Version: v0.5.0-beta',
            halign: Gtk.Align.START,
        }));

        aboutBox.append(new Gtk.Label({
            label: 'Kiwi is not Apple is a collection of macOS-like features for GNOME',
            halign: Gtk.Align.START,
        }));

        aboutBox.append(new Gtk.Label({
            label: 'Authors: Kemma',
            halign: Gtk.Align.START,
        }));

        const websiteLink = new Gtk.LinkButton({
            label: 'GitHub: https://github.com/kem-a/kiwi-kemma',
            uri: 'https://github.com/kem-a/kiwi-kemma',
        });
        aboutBox.append(websiteLink);

        const licenseLink = new Gtk.LinkButton({
            label: 'MIT License',
            uri: 'https://github.com/kem-a/kiwi-kemma?tab=MIT-1-ov-file#readme',
        });
        aboutBox.append(licenseLink);

        aboutGroup.add(aboutBox);
        aboutPage.add(aboutGroup);

        // Credits Page
        const creditsPage = new Adw.PreferencesPage({
            title: 'Credits',
            icon_name: 'emblem-favorite-symbolic',
        });
        window.add(creditsPage);

        const creditsGroup = new Adw.PreferencesGroup();
        const creditsBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });

        creditsBox.append(new Gtk.Label({
            label: 'Special thanks to all contributors and the GNOME community.',
            halign: Gtk.Align.START,
        }));

        creditsGroup.add(creditsBox);
        creditsPage.add(creditsGroup);
    }
}

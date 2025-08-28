import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
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

        // Settings Page (added after About page to change order)
        const settingsPage = new Adw.PreferencesPage({
            title: 'Settings',
            icon_name: 'preferences-system-symbolic',
        });

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
            { key: 'move-calendar-right', title: _("Move Calendar to Right"), subtitle: _("Move calendar to right side and hide notifications") },
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

        // Now add Settings page
        window.add(settingsPage);

        // Extras Page
        const extrasPage = new Adw.PreferencesPage({
            title: 'Extras',
            icon_name: 'application-x-addon-symbolic',
        });
        window.add(extrasPage);

        // Extras Page Content
        const extrasGroup = new Adw.PreferencesGroup({
            title: _('Optional Native Modules'),
            description: _('Enhanced features that require manual installation due to GNOME Extensions platform limitations'),
        });
        extrasPage.add(extrasGroup);

        const extrasInfoBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 15,
            margin_top: 15,
            margin_bottom: 15,
            margin_start: 15,
            margin_end: 15,
        });

        // Warning icon and title
        const warningHeaderBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            halign: Gtk.Align.START,
        });

        warningHeaderBox.append(new Gtk.Image({
            icon_name: 'dialog-information-symbolic',
            icon_size: Gtk.IconSize.LARGE,
        }));

        warningHeaderBox.append(new Gtk.Label({
            label: '<b>Titlebuttons Hover Effect for GTK3 apps</b>',
            use_markup: true,
            halign: Gtk.Align.START,
        }));

        extrasInfoBox.append(warningHeaderBox);

        // Explanation text
        const explanationLabel = new Gtk.Label({
            label: 'The titlebuttons hover module provides macOS-like hover effects for window controls in GTK3 applications. GTK3 apps cannot natively show hover effects on all three window controls simultaneously, requiring this additional module to achieve the desired behavior. This module cannot be distributed through the GNOME Extensions platform due to security policies regarding native libraries.',
            wrap: true,
            halign: Gtk.Align.START,
            xalign: 0,
        });
        extrasInfoBox.append(explanationLabel);

        // Installation instructions
        const installLabel = new Gtk.Label({
            label: '<b>Manual Installation Available:</b>\nIf you want this enhanced feature, you can compile and install it manually from the source code.',
            use_markup: true,
            wrap: true,
            halign: Gtk.Align.START,
            xalign: 0,
        });
        extrasInfoBox.append(installLabel);

        // GitHub link button
        const githubLinkBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            halign: Gtk.Align.START,
        });

        const githubButton = new Gtk.LinkButton({
            label: 'View Installation Guide on GitHub',
            uri: 'https://github.com/kem-a/kiwi-kemma/tree/main/extras',
        });
        githubButton.add_css_class('suggested-action');

        githubLinkBox.append(new Gtk.Image({
            icon_name: 'folder-download-symbolic',
            icon_size: Gtk.IconSize.NORMAL,
        }));
        githubLinkBox.append(githubButton);

        extrasInfoBox.append(githubLinkBox);

        extrasGroup.add(extrasInfoBox);

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
            label: 'Version: v0.8.0-beta',
            halign: Gtk.Align.START,
        }));

        aboutBox.append(new Gtk.Label({
            label: 'Kiwi is not Apple, but it is a collection of macOS-like features for GNOME',
            halign: Gtk.Align.START,
        }));

        aboutBox.append(new Gtk.Label({
            label: 'Authors: Kemma',
            halign: Gtk.Align.START,
        }));

        // Create GitHub link with icon and text
        const githubBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.START,
        });
        githubBox.append(new Gtk.Image({
            file: `${this.path}/icons/github-symbolic.svg`,
            icon_size: Gtk.IconSize.NORMAL,
        }));
        const websiteLink = new Gtk.LinkButton({
            label: 'Follow me on Github',
            uri: 'https://github.com/kem-a/kiwi-kemma',
        });
        githubBox.append(websiteLink);
        aboutBox.append(githubBox);

        // Create bug report link with icon and text
        const bugBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.START,
        });
        bugBox.append(new Gtk.Image({
            file: `${this.path}/icons/bug-symbolic.svg`,
            icon_size: Gtk.IconSize.NORMAL,
        }));
        const bugLink = new Gtk.LinkButton({
            label: 'Report a Bug',
            uri: 'https://github.com/kem-a/kiwi-kemma/issues',
        });
        bugBox.append(bugLink);
        aboutBox.append(bugBox);

        // Create license link with icon and text
        const licenseBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.START,
        });
        licenseBox.append(new Gtk.Image({
            file: `${this.path}/icons/text-symbolic.svg`,
            icon_size: Gtk.IconSize.NORMAL,
        }));
        const licenseLink = new Gtk.LinkButton({
            label: 'MIT License',
            uri: 'https://github.com/kem-a/kiwi-kemma?tab=MIT-1-ov-file#readme',
        });
        licenseBox.append(licenseLink);
        licenseBox.append(licenseLink);
        aboutBox.append(licenseBox);

        // Create a container for the main content and coffee button
        const aboutMainContainer = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 20,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });

        // Add the main about content
        aboutMainContainer.append(aboutBox);

        // Create bottom row with coffee button on the right
        const bottomRow = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            halign: Gtk.Align.FILL,
            hexpand: true,
        });

        // Spacer to push button to the right
        const spacer = new Gtk.Box({
            hexpand: true,
        });
        bottomRow.append(spacer);

        // Create coffee button with icon and text
        const coffeeButton = new Gtk.Button({
            css_classes: ['suggested-action'],
            halign: Gtk.Align.END,
        });

        const coffeeBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
        });

        coffeeBox.append(new Gtk.Image({
            file: `${this.path}/icons/coffee-icon-symbolic.svg`,
            icon_size: Gtk.IconSize.NORMAL,
        }));

        coffeeBox.append(new Gtk.Label({
            label: 'Buy Me a Coffee',
        }));

        coffeeButton.set_child(coffeeBox);
        coffeeButton.connect('clicked', () => {
            Gtk.show_uri(null, 'https://revolut.me/r/VD0Q6SxGWP', Gdk.CURRENT_TIME);
        });

        bottomRow.append(coffeeButton);
        aboutMainContainer.append(bottomRow);

        aboutGroup.add(aboutMainContainer);
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
            label: 'Special thanks to all contributors and the GNOME community ♥️♥️♥️',
            halign: Gtk.Align.START,
        }));

        creditsGroup.add(creditsBox);
        creditsPage.add(creditsGroup);

        // Recommended Extensions Section
        const recommendationsGroup = new Adw.PreferencesGroup({
            title: _('Recommended Extensions'),
            description: _('Extensions that work great with Kiwi is not Apple'),
        });
        creditsPage.add(recommendationsGroup);

        const recommendationsBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });

        const recommendations = [
            { title: 'Dash2Dock Animated', author: 'by icedman', url: 'https://extensions.gnome.org/extension/4994/dash2dock-lite/' },
            { title: 'Logo Menu', author: 'Aryan Kaushik', url: 'https://extensions.gnome.org/extension/4451/logo-menu/' },
            { title: 'AppIndicator Support', author: 'by 3v1n0', url: 'https://extensions.gnome.org/extension/615/appindicator-support/' },
            { title: 'Compiz alike magic lamp effect', author: 'by hermes83', url: 'https://extensions.gnome.org/extension/3740/compiz-alike-magic-lamp-effect/' },
            { title: 'Quick Settings Tweaks', author: 'by qwreey', url: 'https://extensions.gnome.org/extension/5446/quick-settings-tweaker/' },
            { title: 'Gtk4 Desktop Icons NG (DING)', author: 'by smedius', url: 'https://extensions.gnome.org/extension/5263/gtk4-desktop-icons-ng-ding/' },
            { title: 'Clipboard Indicator', author: 'by Tudmotu', url: 'https://extensions.gnome.org/extension/779/clipboard-indicator/' },
        ];

        recommendations.forEach((rec) => {
            const extBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                halign: Gtk.Align.START,
            });

            const linkButton = new Gtk.LinkButton({
                label: rec.title,
                uri: rec.url,
                halign: Gtk.Align.START,
            });
            extBox.append(linkButton);

            const authorLabel = new Gtk.Label({
                label: rec.author,
                halign: Gtk.Align.START,
                css_classes: ['dim-label'],
            });
            authorLabel.add_css_class('caption');
            extBox.append(authorLabel);

            recommendationsBox.append(extBox);
        });

        recommendationsGroup.add(recommendationsBox);
    }
}

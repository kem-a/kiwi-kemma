import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class KiwiPreferences extends ExtensionPreferences {
    constructor(metadata) {
        super(metadata);
    }

    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.title = 'Kiwi is not Apple';
        //window.set_default_size(750, 600);

        //
        // About Page (First Page)
        //
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

        // Create horizontal box for logo and title
        const titleBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 15,
            halign: Gtk.Align.START,
        });

        // Add Kiwi logo in front of title
        try {
            const logoPath = this.path + '/icons/kiwi_logo.png';
            const logoFile = Gio.File.new_for_path(logoPath);
            if (logoFile.query_exists(null)) {
                const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(logoPath, 128, 128, true);
                const texture = Gdk.Texture.new_for_pixbuf(pixbuf);
                
                const logoImage = new Gtk.Image({
                    gicon: texture,
                    valign: Gtk.Align.CENTER,
                    halign: Gtk.Align.CENTER,
                    pixel_size: 64,
                });
                
                titleBox.append(logoImage);
            }
        } catch (e) {
            console.error('Failed to load Kiwi logo:', e);
        }

        // Add title label after the logo
        const titleLabel = new Gtk.Label({
            label: '<span size="large" weight="bold">Kiwi</span>',
            use_markup: true,
            valign: Gtk.Align.CENTER,
        });
        titleBox.append(titleLabel);
        aboutBox.append(titleBox);

        const description = this.metadata['description'] ?? _('No description available');
        aboutBox.append(new Gtk.Label({
            label: description,
            halign: Gtk.Align.START,
            wrap: true,
            xalign: 0,
        }));

        const versionName = this.metadata['version-name'] ?? (this.metadata.version ? `v${this.metadata.version}` : _('Unknown'));
        aboutBox.append(new Gtk.Label({
            label: `Version: ${versionName}`,
            halign: Gtk.Align.START,
        }));

        aboutBox.append(new Gtk.Label({
            label: 'Authors: Arnis Kemlers (kem-a)',
            halign: Gtk.Align.START,
        }));

        // Add spacer after authors section
        aboutBox.append(new Gtk.Label({
            label: '',
            margin_top: 20,
        }));

        // Create a horizontal container for links and QR section
        const linksAndQrContainer = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 40,
            halign: Gtk.Align.FILL,
            hexpand: true,
        });

        // Create container for links
        const linksContainer = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            halign: Gtk.Align.START,
        });

        // Create GitHub link with icon and text
        const githubBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.START,
        });
        githubBox.append(new Gtk.Image({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this.path}/icons/github-symbolic.svg`) }),
            icon_size: Gtk.IconSize.NORMAL,
        }));
        const websiteLink = new Gtk.LinkButton({
            label: 'Follow me on Github',
            uri: 'https://github.com/kem-a/kiwi-kemma',
        });
        githubBox.append(websiteLink);
        linksContainer.append(githubBox);

        // Create bug report link with icon and text
        const bugBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.START,
        });
        bugBox.append(new Gtk.Image({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this.path}/icons/bug-symbolic.svg`) }),
            icon_size: Gtk.IconSize.NORMAL,
        }));
        const bugLink = new Gtk.LinkButton({
            label: 'Report a Bug',
            uri: 'https://github.com/kem-a/kiwi-kemma/issues',
        });
        bugBox.append(bugLink);
        linksContainer.append(bugBox);

        // Create license link with icon and text
        const licenseBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.START,
        });
        licenseBox.append(new Gtk.Image({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this.path}/icons/text-symbolic.svg`) }),
            icon_size: Gtk.IconSize.NORMAL,
        }));
        const licenseLink = new Gtk.LinkButton({
            label: 'MIT License',
            uri: 'https://github.com/kem-a/kiwi-kemma?tab=MIT-1-ov-file#readme',
        });
        licenseBox.append(licenseLink);
        linksContainer.append(licenseBox);

        // Add links container to the horizontal layout
        linksAndQrContainer.append(linksContainer);

        // Add the links and QR container to the main aboutBox
        aboutBox.append(linksAndQrContainer);

        // Create a horizontal container for main content and QR section
        const aboutMainContainer = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 20,
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
        });

        // Create a vertical container for the main about content
        const aboutContentContainer = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            hexpand: true,
        });
        aboutContentContainer.append(aboutBox);

        // Add the main about content
        aboutMainContainer.append(aboutContentContainer);

        // Create support section with QR code above coffee button
        const supportSection = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            halign: Gtk.Align.END,
            valign: Gtk.Align.START,
            hexpand: true,
        });

        // Add QR code image
        try {
            const qrPath = this.path + '/icons/qr.png';
            const qrFile = Gio.File.new_for_path(qrPath);
            if (qrFile.query_exists(null)) {
                const qrPixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(qrPath, 128, 128, true);
                const qrTexture = Gdk.Texture.new_for_pixbuf(qrPixbuf);
                
                const qrImage = new Gtk.Image({
                    gicon: qrTexture,
                    halign: Gtk.Align.CENTER,
                    pixel_size: 128,
                });
                
                // Create a container to ensure proper sizing
                const qrContainer = new Gtk.Box({
                    orientation: Gtk.Orientation.VERTICAL,
                    width_request: 128,
                    height_request: 128,
                    halign: Gtk.Align.CENTER,
                });
                qrContainer.append(qrImage);
                
                supportSection.append(qrContainer);
            }
        } catch (e) {
            console.error('Failed to load QR code image:', e);
        }

        // Create coffee button with icon and text
        const coffeeButton = new Gtk.Button({
            css_classes: ['suggested-action'],
            halign: Gtk.Align.CENTER,
        });

        const coffeeBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
        });

        coffeeBox.append(new Gtk.Image({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this.path}/icons/coffee-icon-symbolic.svg`) }),
            icon_size: Gtk.IconSize.NORMAL,
        }));

        coffeeBox.append(new Gtk.Label({
            label: 'Buy Me a Coffee',
        }));

        coffeeButton.set_child(coffeeBox);
        coffeeButton.connect('clicked', () => {
            Gtk.show_uri(null, 'https://revolut.me/arnisk', Gdk.CURRENT_TIME);
        });

        supportSection.append(coffeeButton);
        linksAndQrContainer.append(supportSection);

        aboutGroup.add(aboutMainContainer);
        aboutPage.add(aboutGroup);

        //
        // Options Page
        //
        const settingsPage = new Adw.PreferencesPage({
            title: 'Options',
            icon_name: 'preferences-other-symbolic',
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
            { key: 'focus-launched-window', title: _("Focus Launched Window"), subtitle: _("Focus the window when launched") },
            { key: 'transparent-move', title: _("Transparent Move"), subtitle: _("Move window with transparency") },
            { key: 'battery-percentage', title: _("Battery Percentage"), subtitle: _("Show battery percentage in the top bar when below 25%") },
            { key: 'move-calendar-right', title: _("Move Calendar to Right"), subtitle: _("Move calendar to right side and hide notifications") },
            { key: 'show-window-title', title: _("Show Window Title"), subtitle: _("Display current window title in the top panel") },
            { key: 'panel-hover-fullscreen', title: _("Show Panel on Hover"), subtitle: _("Show panel when mouse is near top edge in fullscreen. Bugged for GTK4 apps.") },
            { key: 'overview-wallpaper-background', title: _("Overview Wallpaper Background"), subtitle: _("Use blurred current wallpaper as overview background (requires ImageMagick)") },
            { key: 'hide-minimized-windows', title: _("Hide Minimized Windows"), subtitle: _("Hide minimized windows in the overview") },
        ];

        switchList.forEach((item) => {
            const switchRow = new Adw.SwitchRow({
                title: item.title,
                subtitle: item.subtitle,
                active: settings.get_boolean(item.key),
            });
            if (item.key === 'overview-wallpaper-background') {
                // Disable toggle if ImageMagick (convert) is not available
                const convertPath = GLib.find_program_in_path('convert');
                if (!convertPath) {
                    switchRow.set_subtitle(_('ImageMagick not installed (install package "imagemagick" to enable)'));
                    switchRow.set_sensitive(false);
                }
            }
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

        let selectedIndex = 0;
        const currentButtonType = settings.get_string('button-type');
        if (currentButtonType === 'titlebuttons-alt') selectedIndex = 1;

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

        // Add Options page
        window.add(settingsPage);
        
        //
        // Extras Page
        //
        const extrasPage = new Adw.PreferencesPage({
            title: 'Extras',
            icon_name: 'application-x-addon-symbolic',
        });
        window.add(extrasPage);

        const extrasGroup = new Adw.PreferencesGroup({
            title: _('Extra Features'),
            description: _('Additional customization options and utilities'),
        });
        extrasPage.add(extrasGroup);

        const extrasSwitchList = [
            { key: 'add-username-to-quick-menu', title: _("Add Username"), subtitle: _("Add username to the quick menu") },
            { key: 'lock-icon', title: _("Caps Lock and Num Lock"), subtitle: _("Show Caps Lock and Num Lock icon") },
            { key: 'hide-activities-button', title: _("Hide Activities Button"), subtitle: _("Hide the Activities button in the top panel") },
            { key: 'skip-overview-on-login', title: _("Skip Overview on Login"), subtitle: _("Do not show the overview when logging in. Still visible animation") },
        ];

        extrasSwitchList.forEach((item) => {
            const switchRow = new Adw.SwitchRow({
                title: item.title,
                subtitle: item.subtitle,
                active: settings.get_boolean(item.key),
            });
            extrasGroup.add(switchRow);
            window._settings.bind(item.key, switchRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        });

        //
        // Advanced Page
        //
        const advancedPage = new Adw.PreferencesPage({
            title: 'Advanced',
            icon_name: 'applications-utilities-symbolic',
        });
        window.add(advancedPage);

        // Advanced Page Content
        const advancedGroup = new Adw.PreferencesGroup({
            title: _('Optional Native Modules'),
            description: _('Enhanced features that require manual installation due to GNOME Extensions platform limitations'),
        });
        advancedPage.add(advancedGroup);

        const advancedInfoBox = new Gtk.Box({
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

        advancedInfoBox.append(warningHeaderBox);

        // Explanation text
        const explanationLabel = new Gtk.Label({
            label: 'The titlebuttons hover module provides macOS-like hover effects for window controls in GTK3 applications. GTK3 apps cannot natively show hover effects on all three window controls simultaneously, requiring this additional module to achieve the desired behavior. This module cannot be distributed through the GNOME Extensions platform due to security policies regarding native libraries.',
            wrap: true,
            halign: Gtk.Align.START,
            xalign: 0,
        });
        advancedInfoBox.append(explanationLabel);

        // Installation instructions
        const installLabel = new Gtk.Label({
            label: '<b>Manual Installation Available:</b>\nIf you want this enhanced feature, you can compile and install it manually from the source code.',
            use_markup: true,
            wrap: true,
            halign: Gtk.Align.START,
            xalign: 0,
        });
        advancedInfoBox.append(installLabel);

        // GitHub link button
        const githubLinkBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            halign: Gtk.Align.START,
        });

        const githubButton = new Gtk.LinkButton({
            label: 'View Installation Guide on GitHub',
            uri: 'https://github.com/kem-a/kiwi-kemma/tree/main/advanced',
        });
        githubButton.add_css_class('suggested-action');

        githubLinkBox.append(new Gtk.Image({
            icon_name: 'software-update-available-symbolic',
            icon_size: Gtk.IconSize.NORMAL,
        }));
        githubLinkBox.append(githubButton);
        advancedInfoBox.append(githubLinkBox);
        advancedGroup.add(advancedInfoBox);

        //
        // Credits Page
        //
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
            { title: 'Dash to Dock', author: 'by michele_g', url: 'https://extensions.gnome.org/extension/307/dash-to-dock/' },
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

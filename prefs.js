/*
 * Kiwi is not Apple – macOS-inspired enhancements for GNOME Shell.
 * Copyright (C) 2025  Arnis Kemlers
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
        window.set_default_size(550, 600);
        window.set_size_request(550, 600);

        // Ensure custom CSS for version pill is loaded once per display
        if (!window._kiwiVersionCssProvider) {
            const cssProvider = new Gtk.CssProvider();
            const cssData = `
.kiwi-version-button {
    padding: 6px 14px;
    min-height: 0;
    border-radius: 999px;
    border: none;
    background-color: alpha(@accent_bg_color, 0.18);
    color: @accent_color;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}

.kiwi-version-button:hover {
    background-color: alpha(@accent_bg_color, 0.26);
}

.kiwi-version-button:active {
    background-color: alpha(@accent_bg_color, 0.34);
}
`;
            cssProvider.load_from_data(cssData, -1);
            const display = Gdk.Display.get_default();
            if (display)
                Gtk.StyleContext.add_provider_for_display(display, cssProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
            window._kiwiVersionCssProvider = cssProvider;
        }

        //
        // About Page (First Page)
        //
        const aboutPage = new Adw.PreferencesPage({
            title: 'About',
            icon_name: 'help-about-symbolic',
        });
        window.add(aboutPage);

        // Header group with centered logo, title, author, and version
        const headerGroup = new Adw.PreferencesGroup();
        const headerBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 16,
            margin_bottom: 8,
            margin_start: 16,
            margin_end: 16,
            halign: Gtk.Align.CENTER,
        });

        // Logo centered
        try {
            const logoPath = this.path + '/icons/kiwi_logo.png';
            const logoFile = Gio.File.new_for_path(logoPath);
            if (logoFile.query_exists(null)) {
                const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(logoPath, 128, 128, true);
                const texture = Gdk.Texture.new_for_pixbuf(pixbuf);
                const logoImage = new Gtk.Image({
                    // Gtk4: use paintable for Gdk.Texture
                    paintable: texture,
                    pixel_size: 128,
                    halign: Gtk.Align.CENTER,
                });
                headerBox.append(logoImage);
            }
        } catch (e) {
            console.error('Failed to load Kiwi logo:', e);
        }

        // Title
        const titleLabel = new Gtk.Label({
            label: '<span size="xx-large" weight="bold">Kiwi is not Apple</span>',
            use_markup: true,
            halign: Gtk.Align.CENTER,
        });
        headerBox.append(titleLabel);

        // Author
        const authorLabel = new Gtk.Label({
            label: 'Arnis Kemlers (kem-a)',
            halign: Gtk.Align.CENTER,
        });
        headerBox.append(authorLabel);

        // Version pill
        const versionName = this.metadata['version-name'] ?? (this.metadata.version ? `${this.metadata.version}` : _('Unknown'));
        const versionButton = new Gtk.Button({
            label: versionName,
            halign: Gtk.Align.CENTER,
            margin_top: 4,
        });
        versionButton.add_css_class('pill');
        versionButton.add_css_class('kiwi-version-button');
        versionButton.connect('clicked', () => {
            const display = Gdk.Display.get_default();
            const clipboard = display?.get_clipboard?.();
            clipboard?.set_text?.(versionName);
        });
        headerBox.append(versionButton);

        headerGroup.add(headerBox);
        aboutPage.add(headerGroup);

        // Content group with two columns: links (left) and QR + coffee (right)
        const contentGroup = new Adw.PreferencesGroup();
        const contentGrid = new Gtk.Grid({
            column_spacing: 24,
            row_spacing: 12,
            margin_top: 8,
            margin_bottom: 16,
            margin_start: 16,
            margin_end: 16,
            hexpand: true,
        });

        // Left column: link groups styled with ActionRows
        const leftColumn = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            hexpand: true,
            halign: Gtk.Align.FILL,
        });

        // First card: Website and Report an Issue
        const linksCard = new Adw.PreferencesGroup();
        const websiteRow = new Adw.ActionRow({
            title: _('Website'),
            activatable: true,
        });
        websiteRow.add_suffix(new Gtk.Image({ icon_name: 'external-link-symbolic' }));
        websiteRow.connect('activated', () => Gtk.show_uri(null, 'https://github.com/kem-a/kiwi-kemma', Gdk.CURRENT_TIME));
        linksCard.add(websiteRow);

        const issueRow = new Adw.ActionRow({
            title: _('Report an Issue'),
            activatable: true,
        });
        issueRow.add_suffix(new Gtk.Image({ icon_name: 'external-link-symbolic' }));
        issueRow.connect('activated', () => Gtk.show_uri(null, 'https://github.com/kem-a/kiwi-kemma/issues', Gdk.CURRENT_TIME));
        linksCard.add(issueRow);
        leftColumn.append(linksCard);

        // Second card: Legal
        const legalCard = new Adw.PreferencesGroup();
        const legalRow = new Adw.ActionRow({
            title: _('Legal'),
            activatable: true,
        });
        legalRow.add_suffix(new Gtk.Image({ icon_name: 'go-next-symbolic' }));
        legalRow.connect('activated', () => Gtk.show_uri(null, 'https://github.com/kem-a/kiwi-kemma?tab=License-1-ov-file#readme', Gdk.CURRENT_TIME));
        legalCard.add(legalRow);
        leftColumn.append(legalCard);

        contentGrid.attach(leftColumn, 0, 0, 1, 1);

        // Right column: QR + coffee button
        const rightColumn = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.START,
        });

        try {
            const qrPath = this.path + '/icons/qr.png';
            const qrFile = Gio.File.new_for_path(qrPath);
            if (qrFile.query_exists(null)) {
                const qrPixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(qrPath, 128, 128, true);
                const qrTexture = Gdk.Texture.new_for_pixbuf(qrPixbuf);
                const qrImage = new Gtk.Image({
                    paintable: qrTexture,
                    pixel_size: 128,
                    halign: Gtk.Align.CENTER,
                });
                rightColumn.append(qrImage);
            }
        } catch (e) {
            console.error('Failed to load QR code image:', e);
        }

        const coffeeButton = new Gtk.Button({
            halign: Gtk.Align.CENTER,
        });
        const coffeeHBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        coffeeHBox.append(new Gtk.Image({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this.path}/icons/coffee-icon-symbolic.svg`) }),
            icon_size: Gtk.IconSize.NORMAL,
        }));
        coffeeHBox.append(new Gtk.Label({
            label: _('Buy Me a Coffee'),
            halign: Gtk.Align.CENTER,
        }));
        coffeeButton.set_child(coffeeHBox);
        coffeeButton.add_css_class('suggested-action');
        coffeeButton.add_css_class('pill');
        coffeeButton.connect('clicked', () => {
            Gtk.show_uri(null, 'https://revolut.me/arnisk', Gdk.CURRENT_TIME);
        });
        rightColumn.append(coffeeButton);

        contentGrid.attach(rightColumn, 1, 0, 1, 1);

        contentGroup.add(contentGrid);
        aboutPage.add(contentGroup);

        //
        // Options Page
        //
        const settingsPage = new Adw.PreferencesPage({
            title: 'Options',
            icon_name: 'preferences-other-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: _('Kiwi'),
            description: _("Kiwi is not like Apple, it's free open source project that brings macOS-like feel for GNOME"),
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
            description: _('Choose the window control button style. Log out to apply it across all apps.'),
        });
        settingsPage.add(buttonTypeGroup);

        // Main toggle as an expander with sub-options
        const buttonsExpander = new Adw.ExpanderRow({
            title: _("Enable macOS Window Buttons"),
            subtitle: _("Show window control buttons in application windows"),
            expanded: settings.get_boolean('enable-app-window-buttons'),
            show_enable_switch: true,
            enable_expansion: settings.get_boolean('enable-app-window-buttons'),
        });
        buttonTypeGroup.add(buttonsExpander);
        // Keep expander in sync with setting
        settings.bind('enable-app-window-buttons', buttonsExpander, 'expanded', Gio.SettingsBindFlags.GET);
        buttonsExpander.enable_expansion = settings.get_boolean('enable-app-window-buttons');
        buttonsExpander.connect('notify::enable-expansion', () => {
            const enabled = buttonsExpander.enable_expansion;
            if (settings.get_boolean('enable-app-window-buttons') !== enabled)
                settings.set_boolean('enable-app-window-buttons', enabled);
        });

        // Add merged window controls switch for panel
        const windowControlsPanelSwitch = new Adw.SwitchRow({
            title: _("Show Window Controls on Panel"),
            subtitle: _("Display window control buttons in the top panel when window is maximized"),
            active: settings.get_boolean('show-window-controls'),
        });
        buttonsExpander.add_row(windowControlsPanelSwitch);
        settings.bind('show-window-controls', windowControlsPanelSwitch, 'active', 
            Gio.SettingsBindFlags.DEFAULT);
        // No need to manage visibility; expander controls reveal

        // Firefox styling switch (moved here from Extras)
        const firefoxStylingSwitch = new Adw.SwitchRow({
            title: _("Firefox Styling"),
            subtitle: _("Apply macOS window control styling for Firefox"),
            active: settings.get_boolean('enable-firefox-styling'),
        });
        buttonsExpander.add_row(firefoxStylingSwitch);
        settings.bind('enable-firefox-styling', firefoxStylingSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        // No need to manage visibility; expander controls reveal

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
            // Nested under expander; visibility controlled by expander state
        });
        buttonsExpander.add_row(buttonTypeCombo);

        // No need to bind visibility; expander controls reveal

        buttonTypeCombo.connect('notify::selected', (combo) => {
            settings.set_string('button-type', combo.selected_item.get_string());
        });

        // When the main switch is turned off, also turn off sub-toggles to avoid complications
        settings.connect('changed::enable-app-window-buttons', () => {
            const enabled = settings.get_boolean('enable-app-window-buttons');
            if (!enabled) {
                if (settings.get_boolean('show-window-controls'))
                    settings.set_boolean('show-window-controls', false);
                if (settings.get_boolean('enable-firefox-styling'))
                    settings.set_boolean('enable-firefox-styling', false);
            }
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
            { key: 'skip-overview-on-login', title: _("Skip to Desktop"), subtitle: _("Do not show the overview when logging in. Animation is still visible") },
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

        // Keyboard indicator feature with sub-options
        const kbExpander = new Adw.ExpanderRow({
            title: _("Style Keyboard Indicator"),
            subtitle: _("Slightly style keyboard/input source indicator by converting to uppercase and adding border"),
            expanded: settings.get_boolean('keyboard-indicator'),
            show_enable_switch: true,
            enable_expansion: settings.get_boolean('keyboard-indicator'),
        });

        // We need individual child rows for toggles
        const hideRow = new Adw.SwitchRow({
            title: _("Hide keyboard indicator"),
            subtitle: _("Completely hide the indicator from the panel"),
            active: settings.get_boolean('hide-keyboard-indicator'),
            sensitive: settings.get_boolean('keyboard-indicator'),
        });
        kbExpander.add_row(hideRow);
        extrasGroup.add(kbExpander);

        // Bindings
        // Keep expander expansion in sync
        settings.bind('keyboard-indicator', kbExpander, 'expanded', Gio.SettingsBindFlags.GET);
        // Reflect settings to the enable switch and write back on change
        kbExpander.enable_expansion = settings.get_boolean('keyboard-indicator');
        kbExpander.connect('notify::enable-expansion', () => {
            const enabled = kbExpander.enable_expansion;
            if (settings.get_boolean('keyboard-indicator') !== enabled)
                settings.set_boolean('keyboard-indicator', enabled);
        });

        // Sub-options
        settings.bind('hide-keyboard-indicator', hideRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('keyboard-indicator', hideRow, 'sensitive', Gio.SettingsBindFlags.GET);

        //
        // Advanced Page
        //
        const advancedPage = new Adw.PreferencesPage({
            title: 'Advanced',
            icon_name: 'applications-utilities-symbolic',
        });
        window.add(advancedPage);

        // Advanced Page Content
        const advancedGroup = new Adw.PreferencesGroup();
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
            label: 'The titlebuttons hover module provides macOS-like hover effects for window controls in GTK3 applications. GTK3 apps cannot natively show hover effects on all three window controls simultaneously, requiring this custom library to achieve the desired behavior.\n\nThis binary code cannot be distributed through the GNOME Extensions platform due to security policies regarding native libraries, but manual installation is possible.',
            wrap: true,
            halign: Gtk.Align.START,
            xalign: 0,
        });
        advancedInfoBox.append(explanationLabel);
        advancedGroup.add(advancedInfoBox);

        // Installation instructions
        // Link row in libadwaita style (like GTK4 "Website" row)
        const advancedLinksGroup = new Adw.PreferencesGroup();
        const guideRow = new Adw.ActionRow({
            title: _('Installation Guide on GitHub'),
            subtitle: _('Open the advanced module build instructions'),
            activatable: true,
        });
        guideRow.add_suffix(new Gtk.Image({
            icon_name: 'external-link-symbolic',
        }));
        guideRow.connect('activated', () => {
            Gtk.show_uri(null, 'https://github.com/kem-a/kiwi-kemma/tree/main/advanced', Gdk.CURRENT_TIME);
        });
        advancedLinksGroup.add(guideRow);
        advancedPage.add(advancedLinksGroup);

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
            description: _('Extensions that work great with Kiwi'),
        });
        creditsPage.add(recommendationsGroup);

        const recommendationsBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            margin_top: 5,
            margin_bottom: 5,
            margin_start: 10,
            margin_end: 10,
        });

        const recommendations = [
            { title: 'Dash to Dock', author: 'by michele_g', url: 'https://extensions.gnome.org/extension/307/dash-to-dock/' },
            { title: 'Compiz alike magic lamp effect', author: 'by hermes83', url: 'https://extensions.gnome.org/extension/3740/compiz-alike-magic-lamp-effect/' },
            { title: 'Logo Menu', author: 'Aryan Kaushik', url: 'https://extensions.gnome.org/extension/4451/logo-menu/' },
            { title: 'AppIndicator Support', author: 'by 3v1n0', url: 'https://extensions.gnome.org/extension/615/appindicator-support/' },
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

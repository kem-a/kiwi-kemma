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

    _createLinkRow(title, url, subtitle = null) {
        const row = new Adw.ActionRow({
            title,
            activatable: true,
        });

        if (subtitle)
            row.subtitle = subtitle;

        row.add_suffix(new Gtk.Image({ icon_name: 'external-link-symbolic' }));
        row.connect('activated', () => Gtk.show_uri(null, url, Gdk.CURRENT_TIME));

        return row;
    }

    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        const extensionTitle = _('Kiwi is not Apple');
        window.title = extensionTitle;
        window.set_default_size(500, 710);
        window.set_size_request(420, 550);
        // Enable built-in libadwaita search (adds search button automatically)
        if (window.set_search_enabled)
            window.set_search_enabled(true);

        // Add custom icons path to GTK icon theme search path
        const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        const iconsPath = GLib.build_filenamev([this.path, 'icons']);
        iconTheme.add_search_path(iconsPath);

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

                .kiwi-version-button:hover, .kiwi-coffee-button:hover  {
                    background-color: alpha(@accent_bg_color, 0.26);
                }

                .kiwi-version-button:active, .kiwi-coffee-button:active  {
                    background-color: alpha(@accent_bg_color, 0.34);
                }

                .kiwi-coffee-button {
                    background-color: alpha(@accent_bg_color, 0.18);
                    color: @accent_color;
                    font-weight: 600;
                    padding: 6px 14px;
                    margin: 0;
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
            title: _('About'),
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
            label: `<span size="xx-large" weight="bold">${GLib.markup_escape_text(extensionTitle, -1)}</span>`,
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
        const metadataVersionName = this.metadata['version-name'];
        const metadataVersionRaw = this.metadata.version;
        const metadataVersionString = typeof metadataVersionRaw === 'number'
            ? (Number.isFinite(metadataVersionRaw) ? `${metadataVersionRaw}` : '')
            : typeof metadataVersionRaw === 'string'
                ? metadataVersionRaw.trim()
                : '';
        const hasValidNumericVersion = metadataVersionString.length > 0 && !Number.isNaN(Number(metadataVersionString));
        let versionLabel = metadataVersionName ?? (hasValidNumericVersion ? metadataVersionString : _('Unknown'));
        if (metadataVersionName && hasValidNumericVersion)
            versionLabel = `${metadataVersionName} (${metadataVersionString})`;
        const versionButton = new Gtk.Button({
            label: versionLabel,
            halign: Gtk.Align.CENTER,
            margin_top: 4,
            tooltip_text: _('Change log'),
        });
        versionButton.add_css_class('pill');
        versionButton.add_css_class('kiwi-version-button');
        const releasesBaseUrl = 'https://github.com/kem-a/kiwi-kemma/releases';
        versionButton.connect('clicked', () => {
            let targetUrl = releasesBaseUrl;
            if (metadataVersionName && metadataVersionName !== _('Unknown'))
                targetUrl = `${releasesBaseUrl}/tag/v${encodeURIComponent(metadataVersionName)}`;

            Gtk.show_uri(null, targetUrl, Gdk.CURRENT_TIME);
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

        // Separate cards: Website and Report an Issue
        const websiteCard = new Adw.PreferencesGroup();
        websiteCard.add(this._createLinkRow(_('Website'), 'https://github.com/kem-a/kiwi-kemma'));
        leftColumn.append(websiteCard);

        const issueCard = new Adw.PreferencesGroup();
        issueCard.add(this._createLinkRow(_('Report an Issue'), 'https://github.com/kem-a/kiwi-kemma/issues'));
        leftColumn.append(issueCard);

        // Combined Credits & Legal group
        const infoGroup = new Adw.PreferencesGroup();
        infoGroup.add(this._createLinkRow(_('Credits'), 'https://github.com/kem-a/kiwi-kemma/graphs/contributors'));

        const legalRow = new Adw.ActionRow({
            title: _('Legal'),
            activatable: true,
        });
        legalRow.add_suffix(new Gtk.Image({ icon_name: 'go-next-symbolic' }));
        legalRow.connect('activated', () => {
            // Create a dialog with slide-up presentation
            const legalDialog = new Adw.Dialog({
                content_width: 450,
                content_height: 600,
                presentation_mode: Adw.DialogPresentationMode.BOTTOM_SHEET,
            });

            const legalToolbar = new Adw.ToolbarView();
            const legalHeader = new Adw.HeaderBar({
                show_title: true,
                title_widget: new Adw.WindowTitle({ title: _('Legal') }),
            });
            legalToolbar.add_top_bar(legalHeader);

            const legalContent = new Adw.PreferencesPage();

            // License section
            const licenseGroup = new Adw.PreferencesGroup({
                title: _('License'),
                description: _('Kiwi is not Apple is free and open source software'),
            });
            
            // GPL License link
            licenseGroup.add(this._createLinkRow(
                _('GNU General Public License v3.0'),
                'https://github.com/kem-a/kiwi-kemma?tab=GPL-3.0-1-ov-file',
                _('View the full license text on GitHub')
            ));
            
            legalContent.add(licenseGroup);

            // Copyright section
            const copyrightGroup = new Adw.PreferencesGroup({
                title: _('Copyright'),
                description: _('Copyright © 2025 Arnis Kemlers\n\nThis program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.'),
            });
            legalContent.add(copyrightGroup);

            const scroller = new Gtk.ScrolledWindow({ vexpand: true, hexpand: true });
            scroller.set_child(legalContent);
            legalToolbar.set_content(scroller);
            legalDialog.set_child(legalToolbar);

            // Present the dialog
            legalDialog.present(window);
        });
        infoGroup.add(legalRow);

        leftColumn.append(infoGroup);

        contentGrid.attach(leftColumn, 0, 0, 1, 1);

        // Right column: QR + coffee button
        const rightColumn = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            halign: Gtk.Align.FILL,
            valign: Gtk.Align.START,
            margin_top: 35,
            hexpand: true,
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
                const qrBox = new Gtk.Box({
                    halign: Gtk.Align.CENTER,
                    valign: Gtk.Align.CENTER,
                    margin_bottom: 12,
                });
                qrBox.append(qrImage);
                rightColumn.append(qrBox);
            }
        } catch (e) {
            console.error('Failed to load QR code image:', e);
        }

        const coffeeButton = new Gtk.Button({
            halign: Gtk.Align.CENTER,
            tooltip_text: _('Support the project'),
        });
        coffeeButton.add_css_class('pill');
        coffeeButton.add_css_class('kiwi-coffee-button');

        const coffeeContent = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
        });
        coffeeContent.append(new Gtk.Image({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this.path}/icons/coffee-icon-symbolic.svg`) }),
        }));
        coffeeContent.append(new Gtk.Label({
            label: _('Buy Me a Coffee'),
        }));
        coffeeButton.set_child(coffeeContent);
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
            title: _('Options'),
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
            description: _('Configure panel transparency and appearance'),
        });
        settingsPage.add(transparencyGroup);

        // Panel transparency expander with sub-options
        const transparencyExpander = new Adw.ExpanderRow({
            title: _("Panel Transparency"),
            subtitle: _("Make the top panel transparent"),
            expanded: settings.get_boolean('panel-transparency'),
            show_enable_switch: true,
            enable_expansion: settings.get_boolean('panel-transparency'),
        });

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
        transparencyExpander.add_row(transparencySpinRow);

        // Opaque on window touch switch
        const opaqueOnWindowSwitch = new Adw.SwitchRow({
            title: _("Opaque When Window Touches"),
            subtitle: _("Make panel opaque when a window touches it"),
            active: settings.get_boolean('panel-opaque-on-window'),
            sensitive: settings.get_boolean('panel-transparency'),
        });
        transparencyExpander.add_row(opaqueOnWindowSwitch);

        // Panel color inherit fix
        const panelColorFixRow = new Adw.SwitchRow({
            title: _("Panel Color Fix"),
            subtitle: _("Fix white panel on some themes (e.g., Ubuntu Yaru)"),
            active: settings.get_boolean('panel-color-inherit'),
        });
        transparencyExpander.add_row(panelColorFixRow);

        transparencyGroup.add(transparencyExpander);

        // Bindings for expander
        settings.bind('panel-transparency', transparencyExpander, 'expanded', Gio.SettingsBindFlags.GET);
        transparencyExpander.enable_expansion = settings.get_boolean('panel-transparency');
        transparencyExpander.connect('notify::enable-expansion', () => {
            const enabled = transparencyExpander.enable_expansion;
            if (settings.get_boolean('panel-transparency') !== enabled)
                settings.set_boolean('panel-transparency', enabled);
        });

        // Bindings for sub-options
        settings.bind('panel-transparency-level', transparencySpinRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-transparency', transparencySpinRow, 'sensitive',
            Gio.SettingsBindFlags.GET);
        settings.bind('panel-opaque-on-window', opaqueOnWindowSwitch, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-transparency', opaqueOnWindowSwitch, 'sensitive',
            Gio.SettingsBindFlags.GET);
        settings.bind('panel-color-inherit', panelColorFixRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const switchList = [
            { key: 'move-window-to-new-workspace', title: _("Move Window to New Workspace"), subtitle: _("Move fullscreen window to a new workspace") },
            { key: 'transparent-move', title: _("Transparent Move"), subtitle: _("Move window with transparency") },
            { key: 'battery-percentage', title: _("Battery Percentage"), subtitle: _("Show battery percentage in the top bar when below 20%") },
            { key: 'move-calendar-right', title: _("Move Calendar to Right"), subtitle: _("Move calendar to right side and hide notifications") },
            { key: 'show-window-title', title: _("Show Window Title"), subtitle: _("Display current window title in the top panel") },
            { key: 'panel-hover-fullscreen', title: _("Show Panel on Hover"), subtitle: _("Show panel when mouse is near top edge in fullscreen. Bugged for GTK4 apps.") },
            { key: 'overview-wallpaper-background', title: _("Overview Wallpaper Blur"), subtitle: _("Use blurred current wallpaper as overview background (requires ImageMagick)") },
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
            subtitle: _("Apply macOS window control styling for Firefox. Recommended to use with vertical tabs."),
            active: settings.get_boolean('enable-firefox-styling'),
        });
        buttonsExpander.add_row(firefoxStylingSwitch);
        settings.bind('enable-firefox-styling', firefoxStylingSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        // No need to manage visibility; expander controls reveal

        // Button Type toggle group with round style
        const buttonTypeRow = new Adw.ActionRow({
            title: _('Button Type'),
            subtitle: _('Choose the button icon set'),
        });

        const buttonTypeToggleGroup = new Adw.ToggleGroup({
            homogeneous: true,
            valign: Gtk.Align.CENTER,
        });
        buttonTypeToggleGroup.add_css_class('round');

        const defaultToggle = new Adw.Toggle({
            label: _('Default'),
            name: 'titlebuttons',
        });
        const altToggle = new Adw.Toggle({
            label: _('Alternative'),
            name: 'titlebuttons-alt',
        });

        buttonTypeToggleGroup.add(defaultToggle);
        buttonTypeToggleGroup.add(altToggle);
        buttonTypeToggleGroup.set_active_name(settings.get_string('button-type'));

        buttonTypeRow.add_suffix(buttonTypeToggleGroup);
        buttonsExpander.add_row(buttonTypeRow);

        buttonTypeToggleGroup.connect('notify::active-name', (group) => {
            settings.set_string('button-type', group.active_name);
        });

        // Button Size toggle group with round style
        const buttonSizeRow = new Adw.ActionRow({
            title: _('Button Size'),
            subtitle: _('Choose button size'),
        });

        const buttonSizeToggleGroup = new Adw.ToggleGroup({
            homogeneous: true,
            valign: Gtk.Align.CENTER,
        });
        buttonSizeToggleGroup.add_css_class('round');

        const smallToggle = new Adw.Toggle({
            label: _('Small'),
            name: 'small',
        });
        const normalToggle = new Adw.Toggle({
            label: _('Normal'),
            name: 'normal',
        });

        buttonSizeToggleGroup.add(smallToggle);
        buttonSizeToggleGroup.add(normalToggle);
        buttonSizeToggleGroup.set_active_name(settings.get_string('button-size'));

        buttonSizeRow.add_suffix(buttonSizeToggleGroup);
        buttonsExpander.add_row(buttonSizeRow);

        buttonSizeToggleGroup.connect('notify::active-name', (group) => {
            settings.set_string('button-size', group.active_name);
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
            title: _('Extras'),
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
            { key: 'hide-minimized-windows', title: _("Hide Minimized Windows"), subtitle: _("Hide minimized windows in the overview") },
            { key: 'skip-overview-on-login', title: _("Skip to Desktop"), subtitle: _("Do not show the overview when logging in. Animation is still visible") },
            { key: 'enable-launchpad-app', title: _("Launchpad Application"), subtitle: _("Add custom Launchpad icon to dock that opens application overview. Recommended to hide default app launcher.") },
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

        const syncKeyboardIndicatorExpansion = () => {
            const styleEnabled = settings.get_boolean('keyboard-indicator');
            const hideEnabled = settings.get_boolean('hide-keyboard-indicator');
            kbExpander.expanded = styleEnabled && hideEnabled;
        };

        syncKeyboardIndicatorExpansion();
        settings.connect('changed::keyboard-indicator', syncKeyboardIndicatorExpansion);
        settings.connect('changed::hide-keyboard-indicator', syncKeyboardIndicatorExpansion);

        //
        // Advanced Page
        //
        const advancedPage = new Adw.PreferencesPage({
            title: _('Advanced'),
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

        const hoverTitle = _('Titlebuttons Hover Effect for GTK3 apps');
        warningHeaderBox.append(new Gtk.Label({
            label: `<b>${GLib.markup_escape_text(hoverTitle, -1)}</b>`,
            use_markup: true,
            halign: Gtk.Align.START,
        }));

        advancedInfoBox.append(warningHeaderBox);

        // Explanation text
        const explanationLabel = new Gtk.Label({
            label: _('The titlebuttons hover module provides macOS-like hover effects for window controls in GTK3 applications. GTK3 apps cannot natively show hover effects on all three window controls simultaneously, requiring this custom library to achieve the desired behavior.\n\nThis binary code cannot be distributed through the GNOME Extensions platform due to security policies regarding native libraries, but manual installation is possible.'),
            wrap: true,
            halign: Gtk.Align.START,
            xalign: 0,
        });
        advancedInfoBox.append(explanationLabel);
        advancedGroup.add(advancedInfoBox);

        // Installation instructions
        // Link row in libadwaita style (like GTK4 "Website" row)
        const advancedLinksGroup = new Adw.PreferencesGroup();
        advancedLinksGroup.add(this._createLinkRow(
            _('Installation Guide on GitHub'),
            'https://github.com/kem-a/kiwi-kemma/tree/main/advanced',
            _('Open the advanced module build instructions')
        ));
        advancedPage.add(advancedLinksGroup);

        const moreGroup = new Adw.PreferencesGroup({
            title: _('Even more...'),
        });

        moreGroup.add(this._createLinkRow(
            _('MacTahoe Icon Pack'),
            'https://github.com/vinceliuice/MacTahoe-icon-theme',
            _('macOS Tahoe icon theme for Linux')
        ));
        moreGroup.add(this._createLinkRow(
            _('GDM Wallpaper'),
            'https://github.com/kem-a/gnome-gdm-wallpaper',
            _('Set custom GDM login screen wallpaper')
        ));
        advancedPage.add(moreGroup);

        const recommendedGroup = new Adw.PreferencesGroup();
        advancedPage.add(recommendedGroup);

        const recommendedExpander = new Adw.ExpanderRow({
            title: _('Recommended Extensions'),
            subtitle: _('Extensions that are compatible with Kiwi'),
            expanded: false,
        });
        recommendedGroup.add(recommendedExpander);

        const recommendedExtensions = [
            { title: 'Dash to Dock', author: 'michele_g', url: 'https://extensions.gnome.org/extension/307/' },
            { title: 'Compiz alike magic lamp effect', author: 'hermes83', url: 'https://extensions.gnome.org/extension/3740/' },
            { title: 'Kiwi Menu', author: 'Arnis K (Me)', url: 'https://extensions.gnome.org/extension/8697/' },
            { title: 'AppIndicator Support', author: '3v1n0', url: 'https://extensions.gnome.org/extension/615/' },
            { title: 'Clipboard Indicator', author: 'Tudmotu', url: 'https://extensions.gnome.org/extension/779/' },
            { title: 'Gtk4 Desktop Icons NG (DING)', author: 'smedius', url: 'https://extensions.gnome.org/extension/5263/' },
            { title: 'Light Style', author: 'fmuellner', url: 'https://extensions.gnome.org/extension/6198/' },
            { title: 'Weather or Not', author: 'somepaulo', url: 'https://extensions.gnome.org/extension/5660/' },
        ];

        recommendedExtensions.forEach((rec) => {
            recommendedExpander.add_row(this._createLinkRow(rec.title, rec.url, rec.author));
        });
    }
}

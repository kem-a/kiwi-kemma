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

const D2D_UUIDS = ['dash-to-dock@micxgx.gmail.com', 'ubuntu-dock@ubuntu.com'];
const EXTENSION_ACTIVE = 1;
// The shell's own end of the extensions interface. Prefs runs in the process
// that owns org.gnome.Shell.Extensions, so asking that name is asking ourselves.
const SHELL = {
    name: 'org.gnome.Shell',
    path: '/org/gnome/Shell',
    iface: 'org.gnome.Shell.Extensions',
};

export default class KiwiPreferences extends ExtensionPreferences {
    constructor(metadata) {
        super(metadata);
    }

    _createLinkRow(title, url, subtitle = null, prefixGicon = null) {
        const row = new Adw.ActionRow({
            title,
            activatable: true,
        });

        if (subtitle)
            row.subtitle = subtitle;

        if (prefixGicon)
            row.add_prefix(new Gtk.Image({ gicon: prefixGicon }));

        row.add_suffix(new Gtk.Image({ icon_name: 'external-link-symbolic' }));
        row.connect('activated', () => Gtk.show_uri(null, url, Gdk.CURRENT_TIME));

        return row;
    }

    _addSwitchRows(settings, group, items) {
        return items.map((item) => {
            const switchRow = new Adw.SwitchRow({
                title: item.title,
                subtitle: item.subtitle,
                active: settings.get_boolean(item.key),
            });
            group.add(switchRow);
            settings.bind(item.key, switchRow, 'active', Gio.SettingsBindFlags.DEFAULT);
            return switchRow;
        });
    }

    /**
     * Hand back whether Dash-to-Dock is installed and running. The question goes
     * to the shell, and it is asked rather than waited for: a call of our own is
     * what would answer it if it went to the name this process owns. An answer
     * that never comes leaves the options alone rather than greying them out.
     *
     * @param callback called with true while the dock is there
     */
    _withDockActive(callback) {
        Gio.DBus.session.call(
            SHELL.name, SHELL.path, SHELL.iface, 'ListExtensions', null, null,
            Gio.DBusCallFlags.NONE, -1, null, (bus, result) => {
                let active = true;
                try {
                    const [extensions] = bus.call_finish(result).recursiveUnpack();
                    active = D2D_UUIDS.some(uuid =>
                        extensions[uuid]?.state === EXTENSION_ACTIVE);
                } catch (e) {
                    console.error('Kiwi: could not read the dock extension state:', e);
                }
                callback(active);
            });
    }

    // Dropdown row for a string-enum setting; values[] maps list position to key value.
    _createEnumComboRow(settings, title, subtitle, key, values, labels) {
        const row = new Adw.ComboRow({
            title,
            subtitle,
            model: Gtk.StringList.new(labels),
        });

        const index = values.indexOf(settings.get_string(key));
        row.selected = index < 0 ? 0 : index;

        row.connect('notify::selected', (r) => {
            settings.set_string(key, values[r.selected]);
        });

        return row;
    }

    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        const extensionTitle = _('Kiwi (is not Apple)');
        window.title = extensionTitle;
        window.set_default_size(510, 710);
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
            const cssPath = GLib.build_filenamev([this.path, 'css', 'prefs.css']);
            cssProvider.load_from_path(cssPath);
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

        // Logo centered — Gtk.Picture scales with the window (matches kiwi-menu)
        try {
            const logoPath = this.path + '/icons/kiwi_logo.png';
            const logoFile = Gio.File.new_for_path(logoPath);
            if (logoFile.query_exists(null)) {
                const logoImage = new Gtk.Picture({
                    file: logoFile,
                    width_request: 128,
                    height_request: 128,
                    content_fit: Gtk.ContentFit.CONTAIN,
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
        // Uses a horizontal Box that flips to vertical via Adw.Breakpoint when narrow.
        const contentGroup = new Adw.PreferencesGroup();
        const contentBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 24,
            margin_top: 8,
            margin_bottom: 16,
            margin_start: 16,
            margin_end: 16,
            hexpand: true,
            homogeneous: true,
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
                content_width: 420,
                content_height: 560,
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
                description: _('Kiwi is free and open source software'),
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
                description: `${_('Copyright')} © 2025 Arnis Kemlers\n\n${_('This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.')}`,
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

        contentBox.append(leftColumn);

        // Right column: QR + coffee button
        const rightColumn = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.START,
            margin_top: 35,
            hexpand: true,
        });

        // QR code button linking to Ko-fi
        const qrButton = new Gtk.Button({
            halign: Gtk.Align.CENTER,
            tooltip_text: 'Ko-fi',
        });
        qrButton.add_css_class('flat');
        const qrImage = new Gtk.Image({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this.path}/icons/qrcode-symbolic.svg`) }),
            pixel_size: 128,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        qrButton.set_child(qrImage);
        qrButton.connect('clicked', () => {
            Gtk.show_uri(null, 'https://ko-fi.com/arnisk', Gdk.CURRENT_TIME);
        });
        const qrBox = new Gtk.Box({
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            margin_bottom: 12,
        });
        qrBox.append(qrButton);
        rightColumn.append(qrBox);

        const coffeeButton = new Gtk.Button({
            halign: Gtk.Align.CENTER,
            tooltip_text: _('Become a sponsor on GitHub'),
        });
        coffeeButton.add_css_class('pill');
        coffeeButton.add_css_class('kiwi-coffee-button');

        const coffeeContent = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
        });
        coffeeContent.append(new Gtk.Image({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this.path}/icons/github-symbolic.svg`) }),
        }));
        coffeeContent.append(new Gtk.Label({
            label: _('Support Me ♡'),
        }));
        coffeeButton.set_child(coffeeContent);
        coffeeButton.connect('clicked', () => {
            Gtk.show_uri(null, 'https://github.com/sponsors/kem-a', Gdk.CURRENT_TIME);
        });
        rightColumn.append(coffeeButton);

        contentBox.append(rightColumn);

        contentGroup.add(contentBox);
        aboutPage.add(contentGroup);

        // Responsive breakpoint: stack columns vertically when window is narrow.
        const aboutBreakpoint = new Adw.Breakpoint({
            condition: Adw.BreakpointCondition.parse('max-width: 500sp'),
        });
        aboutBreakpoint.add_setter(contentBox, 'orientation', Gtk.Orientation.VERTICAL);
        aboutBreakpoint.add_setter(contentBox, 'homogeneous', false);
        aboutBreakpoint.add_setter(rightColumn, 'margin-top', 0);
        window.add_breakpoint(aboutBreakpoint);

        //
        // Panel Page
        //
        const panelPage = new Adw.PreferencesPage({
            title: _('Panel'),
            icon_name: 'focus-top-bar-symbolic',
        });
        window.add(panelPage);

        const transparencyGroup = new Adw.PreferencesGroup({
            title: _('Panel Transparency'),
            description: _('Configure panel transparency and appearance'),
        });
        panelPage.add(transparencyGroup);

        // Panel transparency expander with sub-options
        const transparencyHasNonDefault =
            settings.get_int('panel-transparency-level') !== 50 ||
            settings.get_boolean('panel-opaque-on-window') ||
            settings.get_boolean('panel-blur') ||
            settings.get_boolean('panel-color-inherit') ||
            settings.get_boolean('panel-invert-tray-icons');
        const transparencyExpander = new Adw.ExpanderRow({
            title: _("Panel Transparency"),
            subtitle: _("Make the top panel transparent"),
            expanded: settings.get_boolean('panel-transparency') && transparencyHasNonDefault,
            show_enable_switch: true,
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

        // Panel blur
        const panelBlurRow = new Adw.SwitchRow({
            title: _("Panel Blur"),
            subtitle: _("Blur the background behind the panel"),
            active: settings.get_boolean('panel-blur'),
            sensitive: settings.get_boolean('panel-transparency'),
        });
        transparencyExpander.add_row(panelBlurRow);

        // Panel color inherit fix
        const panelColorFixRow = new Adw.SwitchRow({
            title: _("Panel Color Fix"),
            subtitle: _("Fix white panel on some themes (e.g., Ubuntu Yaru)"),
            active: settings.get_boolean('panel-color-inherit'),
        });
        transparencyExpander.add_row(panelColorFixRow);

        // Tray icon inversion for light wallpapers
        const invertTrayIconsRow = new Adw.SwitchRow({
            title: _("Invert Tray Icons on Light Wallpapers"),
            subtitle: _("Darken white monochrome tray icons when the panel adapts to a light wallpaper. Colored icons are left untouched"),
            active: settings.get_boolean('panel-invert-tray-icons'),
            sensitive: settings.get_boolean('panel-transparency'),
        });
        transparencyExpander.add_row(invertTrayIconsRow);

        transparencyGroup.add(transparencyExpander);

        // Bindings for expander
        settings.bind('panel-transparency', transparencyExpander, 'enable-expansion',
            Gio.SettingsBindFlags.DEFAULT);

        // Bindings for sub-options
        settings.bind('panel-transparency-level', transparencySpinRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-transparency', transparencySpinRow, 'sensitive',
            Gio.SettingsBindFlags.GET);
        settings.bind('panel-opaque-on-window', opaqueOnWindowSwitch, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-transparency', opaqueOnWindowSwitch, 'sensitive',
            Gio.SettingsBindFlags.GET);
        settings.bind('panel-blur', panelBlurRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-transparency', panelBlurRow, 'sensitive',
            Gio.SettingsBindFlags.GET);
        settings.bind('panel-color-inherit', panelColorFixRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-invert-tray-icons', invertTrayIconsRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-transparency', invertTrayIconsRow, 'sensitive',
            Gio.SettingsBindFlags.GET);

        const windowTitleGroup = new Adw.PreferencesGroup({
            title: _('Panel Items'),
            description: _('Choose what the top panel and its menus show'),
        });
        panelPage.add(windowTitleGroup);

        // Tiling lives under the window title because the layouts are reached from its
        // menu; without the title in the panel there is no way to open them.
        const windowTitleExpander = new Adw.ExpanderRow({
            title: _("Show Window Title"),
            subtitle: _("Display current window title in the top panel"),
            show_enable_switch: true,
        });
        windowTitleGroup.add(windowTitleExpander);
        settings.bind('show-window-title', windowTitleExpander, 'enable-expansion',
            Gio.SettingsBindFlags.DEFAULT);

        // Both sub-options are stored as positive keys, so their rows invert them.
        const titleIconRow = new Adw.SwitchRow({
            title: _("Hide App Icon"),
            subtitle: _("Do not show the application icon next to the window title"),
        });
        windowTitleExpander.add_row(titleIconRow);
        settings.bind('show-window-title-icon', titleIconRow, 'active',
            Gio.SettingsBindFlags.DEFAULT | Gio.SettingsBindFlags.INVERT_BOOLEAN);

        const tilingTitleMenuRow = new Adw.SwitchRow({
            title: _("Disable Window Tiling"),
            subtitle: _("Drop the tiling layouts from the window title menu, and stop restoring tiled windows when their titlebar is dragged"),
        });
        windowTitleExpander.add_row(tilingTitleMenuRow);
        settings.bind('show-tiling-title-menu', tilingTitleMenuRow, 'active',
            Gio.SettingsBindFlags.DEFAULT | Gio.SettingsBindFlags.INVERT_BOOLEAN);

        // Keep the expander closed while both sub-options sit at their default (off) state.
        const syncWindowTitleExpansion = () => {
            const titleEnabled = settings.get_boolean('show-window-title');
            const hasSubOption = !settings.get_boolean('show-window-title-icon') ||
                !settings.get_boolean('show-tiling-title-menu');
            windowTitleExpander.expanded = titleEnabled && hasSubOption;
        };

        syncWindowTitleExpansion();
        settings.connect('changed::show-window-title', syncWindowTitleExpansion);
        settings.connect('changed::show-window-title-icon', syncWindowTitleExpansion);
        settings.connect('changed::show-tiling-title-menu', syncWindowTitleExpansion);

        this._addSwitchRows(settings, windowTitleGroup, [
            { key: 'panel-hover-fullscreen', title: _("Show Panel in Fullscreen on Hover"), subtitle: _("Show panel when mouse is near top edge in fullscreen. Bugged for GTK4 apps.") },
        ]);

        // Expander with notification indicator style sub-option
        const calendarHasNonDefault =
            settings.get_boolean('keep-notification-panel') ||
            settings.get_string('notification-indicator-style') !== 'default';
        const calendarExpander = new Adw.ExpanderRow({
            title: _("Move Calendar to Right"),
            subtitle: _("Move calendar to right side and hide notifications"),
            expanded: settings.get_boolean('move-calendar-right') && calendarHasNonDefault,
            show_enable_switch: true,
        });
        windowTitleGroup.add(calendarExpander);
        settings.bind('move-calendar-right', calendarExpander, 'enable-expansion',
            Gio.SettingsBindFlags.DEFAULT);

        const keepPanelRow = new Adw.SwitchRow({
            title: _("Keep GNOME Notification Panel"),
            subtitle: _("Don't split notification and calendar layout"),
        });
        calendarExpander.add_row(keepPanelRow);
        settings.bind('keep-notification-panel', keepPanelRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        const indicatorStyleRow = this._createEnumComboRow(
            settings,
            _('Indicator Style'),
            _('Notification dot recolor'),
            'notification-indicator-style',
            ['default', 'accent', 'symbolic'],
            [_('Default'), _('Accent'), _('Symbolic')]
        );
        calendarExpander.add_row(indicatorStyleRow);

        // Battery percentage clashes with GNOME's own top bar percentage, so
        // the row is greyed out while that setting is on
        const batteryRow = new Adw.SwitchRow({
            title: _("Battery Percentage"),
            active: settings.get_boolean('battery-percentage'),
        });
        windowTitleGroup.add(batteryRow);
        settings.bind('battery-percentage', batteryRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        const interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        window._kiwiInterfaceSettings = interfaceSettings;
        const syncBatteryRow = () => {
            const gnomeShowsPercentage = interfaceSettings.get_boolean('show-battery-percentage');
            batteryRow.sensitive = !gnomeShowsPercentage;
            batteryRow.subtitle = gnomeShowsPercentage
                ? _("Unavailable while GNOME Settings shows the battery percentage in the top bar")
                : _("Show battery percentage in the top bar when below 20%");
        };
        syncBatteryRow();
        interfaceSettings.connect('changed::show-battery-percentage', syncBatteryRow);

        this._addSwitchRows(settings, windowTitleGroup, [
            { key: 'lock-icon', title: _("Caps Lock and Num Lock"), subtitle: _("Show Caps Lock and Num Lock icon") },
            { key: 'custom-dnd-button', title: _("Custom Do Not Disturb Button"), subtitle: _("Replace the system Do Not Disturb button with Kiwi's custom implementation") },
            { key: 'hide-activities-button', title: _("Hide Activities Button"), subtitle: _("Hide the Activities button in the top panel") },
            { key: 'hide-media-player', title: _("Hide Media Player"), subtitle: _("Hide the Media Player in Quick Settings") },
            { key: 'hide-media-indicator', title: _("Hide Media Status Indicator"), subtitle: _("Hide the Media Status indicator in the quick menu while media is playing") },
            { key: 'add-username-to-quick-menu', title: _("Add Username"), subtitle: _("Add username to the quick menu") },
        ]);

        const panelStylingGroup = new Adw.PreferencesGroup({
            title: _('Styling'),
            description: _('Restyle stock GNOME Shell elements and GTK apps. Log out and back in for changes to take effect'),
        });
        panelPage.add(panelStylingGroup);

        this._addSwitchRows(settings, panelStylingGroup, [
            { key: 'panel-styling', title: _("Panel Styling"), subtitle: _("Tighter button spacing, smaller status icons, no dropdown arrows and a transparent panel in the overview") },
            { key: 'popup-menu-styling', title: _("Menu and App Styling"), subtitle: _("Narrower shell menu items with accent-colored hover and selection, plus the GTK app fixes") },
        ]);

        // Keyboard indicator feature with sub-options
        const kbHasNonDefault = settings.get_boolean('hide-keyboard-indicator');
        const kbExpander = new Adw.ExpanderRow({
            title: _("Style Keyboard Indicator"),
            subtitle: _("Slightly style keyboard/input source indicator by converting to uppercase and adding border"),
            expanded: settings.get_boolean('keyboard-indicator') && kbHasNonDefault,
            show_enable_switch: true,
        });

        // We need individual child rows for toggles
        const hideRow = new Adw.SwitchRow({
            title: _("Hide keyboard indicator"),
            subtitle: _("Completely hide the indicator from the panel"),
            active: settings.get_boolean('hide-keyboard-indicator'),
            sensitive: settings.get_boolean('keyboard-indicator'),
        });
        kbExpander.add_row(hideRow);
        panelStylingGroup.add(kbExpander);

        settings.bind('keyboard-indicator', kbExpander, 'enable-expansion',
            Gio.SettingsBindFlags.DEFAULT);

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
        // Dock Page
        //
        const dockPage = new Adw.PreferencesPage({
            title: _('Dock'),
            icon_name: 'kiwi-dock-symbolic',
        });
        window.add(dockPage);

        // Everything here but the Launchpad app hangs off Dash-to-Dock, and does
        // nothing at all while it is not there. Those rows are held shut rather
        // than left looking as though they still do something.
        const dockBanner = new Adw.Banner({
            title: _("These options need the Dash to Dock extension installed and enabled"),
        });
        const dockBannerGroup = new Adw.PreferencesGroup();
        dockBannerGroup.add(dockBanner);
        dockPage.add(dockBannerGroup);
        const dockRows = [];

        const dockGroup = new Adw.PreferencesGroup({
            title: _('Dock Items'),
            description: _('Add extra items to Dash-to-Dock'),
        });
        dockPage.add(dockGroup);

        dockRows.push(...this._addSwitchRows(settings, dockGroup, [
            { key: 'minimize-to-dock', title: _("Minimize Windows to Dock"), subtitle: _("Park minimized windows as thumbnails in Dash-to-Dock, after the apps and before the trash") },
        ]));

        const downloadsExpander = new Adw.ExpanderRow({
            title: _("Downloads Folder in Dock"),
            subtitle: _("Add a Downloads folder before the trash that fans its newest files out over the desktop"),
            show_enable_switch: true,
        });
        dockGroup.add(downloadsExpander);
        dockRows.push(downloadsExpander);
        settings.bind('downloads-in-dock', downloadsExpander, 'enable-expansion',
            Gio.SettingsBindFlags.DEFAULT);

        const downloadsBehindRow = new Adw.SwitchRow({
            title: _("Stack Behind Folder"),
            subtitle: _("Show the newest files sticking out of the folder icon instead of piled on top of it"),
        });
        downloadsExpander.add_row(downloadsBehindRow);
        settings.bind('downloads-behind-folder', downloadsBehindRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Nothing to show once the only sub-option is off, so keep the expander closed.
        const syncDownloadsExpansion = () => {
            downloadsExpander.expanded = settings.get_boolean('downloads-in-dock') &&
                settings.get_boolean('downloads-behind-folder');
        };

        syncDownloadsExpansion();
        settings.connect('changed::downloads-in-dock', syncDownloadsExpansion);
        settings.connect('changed::downloads-behind-folder', syncDownloadsExpansion);

        // Launchpad Application with custom icon option
        const launchpadHasNonDefault = settings.get_string('launchpad-app-custom-icon') !== '';
        const launchpadExpander = new Adw.ExpanderRow({
            title: _("Launchpad Application"),
            subtitle: _("Add custom Launchpad icon to dock that opens application overview. Recommended to hide default app launcher."),
            expanded: settings.get_boolean('enable-launchpad-app') && launchpadHasNonDefault,
            show_enable_switch: true,
        });

        settings.bind('enable-launchpad-app', launchpadExpander, 'enable-expansion',
            Gio.SettingsBindFlags.DEFAULT);

        const customIconPath = settings.get_string('launchpad-app-custom-icon');
        const launchpadIconRow = new Adw.ActionRow({
            title: _("Custom Icon"),
            subtitle: customIconPath
                ? GLib.path_get_basename(customIconPath)
                : _("Using default icon"),
            sensitive: settings.get_boolean('enable-launchpad-app'),
        });
        settings.bind('enable-launchpad-app', launchpadIconRow, 'sensitive', Gio.SettingsBindFlags.GET);

        const clearIconButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _("Reset to default icon"),
            visible: customIconPath !== '',
        });
        clearIconButton.add_css_class('flat');
        clearIconButton.connect('clicked', () => {
            settings.set_string('launchpad-app-custom-icon', '');
        });

        const browseButton = new Gtk.Button({
            icon_name: 'document-open-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _("Browse for icon"),
        });
        browseButton.add_css_class('flat');
        browseButton.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({
                title: _("Select Launchpad Icon"),
            });

            const filter = new Gtk.FileFilter();
            filter.set_name(_("Images (PNG, SVG)"));
            filter.add_mime_type('image/png');
            filter.add_mime_type('image/svg+xml');

            const filters = Gio.ListStore.new(Gtk.FileFilter);
            filters.append(filter);
            dialog.set_filters(filters);
            dialog.set_default_filter(filter);

            dialog.open(window, null, (source, result) => {
                try {
                    const file = source.open_finish(result);
                    if (!file)
                        return;

                    const filePath = file.get_path();
                    const lowerPath = filePath.toLowerCase();

                    if (!lowerPath.endsWith('.png') && !lowerPath.endsWith('.svg')) {
                        return;
                    }

                    // Validate PNG dimensions
                    if (lowerPath.endsWith('.png')) {
                        try {
                            const pixbuf = GdkPixbuf.Pixbuf.new_from_file(filePath);
                            if (pixbuf.get_width() > 512 || pixbuf.get_height() > 512) {
                                const errorDialog = new Adw.AlertDialog({
                                    heading: _("Icon Too Large"),
                                    body: _("The selected image exceeds 512×512 pixels. Please choose a smaller image."),
                                });
                                errorDialog.add_response('ok', _("OK"));
                                errorDialog.present(window);
                                return;
                            }
                        } catch (e) {
                            console.error('Launchpad: Failed to validate icon:', e);
                            return;
                        }
                    }

                    settings.set_string('launchpad-app-custom-icon', filePath);
                } catch (e) {
                    // User cancelled the dialog
                }
            });
        });

        launchpadIconRow.add_suffix(clearIconButton);
        launchpadIconRow.add_suffix(browseButton);
        launchpadExpander.add_row(launchpadIconRow);
        dockGroup.add(launchpadExpander);

        settings.connect('changed::launchpad-app-custom-icon', () => {
            const path = settings.get_string('launchpad-app-custom-icon');
            launchpadIconRow.subtitle = path
                ? GLib.path_get_basename(path)
                : _("Using default icon");
            clearIconButton.visible = path !== '';
        });

        const dockStylingGroup = new Adw.PreferencesGroup({
            title: _('Styling'),
        });
        dockPage.add(dockStylingGroup);

        dockRows.push(...this._addSwitchRows(settings, dockStylingGroup, [
            { key: 'dock-styling', title: _("Dock Styling"), subtitle: _("Tighten icon spacing, drop the icon highlight and darken icons while pressed") },
            { key: 'dock-blur', title: _("Dock Blur"), subtitle: _("Blur the background behind Dash-to-Dock. Recommended fixed dock opacity 10% - 30%, min 1%.") },
            { key: 'dock-adaptive-colors', title: _("Adaptive Dock Colors"), subtitle: _("Flip the running indicators and separators to suit whatever is behind the dock, wallpaper or window") },
        ]));

        // The dock can be installed or turned on while this window is open
        const syncDockRows = () => this._withDockActive((active) => {
            dockBanner.revealed = !active;
            dockRows.forEach(row => (row.sensitive = active));
        });
        syncDockRows();

        const dockStateId = Gio.DBus.session.signal_subscribe(
            SHELL.name, SHELL.iface, 'ExtensionStateChanged',
            SHELL.path, null, Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                if (D2D_UUIDS.includes(params.deepUnpack()[0]))
                    syncDockRows();
            });
        window.connect('close-request', () => Gio.DBus.session.signal_unsubscribe(dockStateId));

        //
        // Window Controls Page
        //
        const windowControlsPage = new Adw.PreferencesPage({
            title: _('Buttons'),
            icon_name: 'kiwi-buttons-symbolic',
        });
        window.add(windowControlsPage);

        const buttonTypeGroup = new Adw.PreferencesGroup({
            title: _('Window Control Button Style'),
            description: _('Choose the window control button style. Log out to apply it across all apps.'),
        });
        windowControlsPage.add(buttonTypeGroup);

        // Main toggle as an expander with sub-options. The button type and size
        // pickers are the point of this page, so the expander stays open for as
        // long as the feature is on, whatever the sub-options are set to.
        const buttonsExpander = new Adw.ExpanderRow({
            title: _("Enable macOS Window Buttons"),
            subtitle: _("Replace window control buttons in application windows with macOS style"),
            expanded: settings.get_boolean('enable-app-window-buttons'),
            show_enable_switch: true,
            enable_expansion: settings.get_boolean('enable-app-window-buttons'),
        });
        buttonTypeGroup.add(buttonsExpander);
        buttonsExpander.connect('notify::enable-expansion', () => {
            const enabled = buttonsExpander.enable_expansion;
            if (settings.get_boolean('enable-app-window-buttons') !== enabled)
                settings.set_boolean('enable-app-window-buttons', enabled);
        });

        const syncButtonsExpansion = () => {
            buttonsExpander.expanded = settings.get_boolean('enable-app-window-buttons');
        };

        syncButtonsExpansion();
        settings.connect('changed::enable-app-window-buttons', syncButtonsExpansion);

        const buttonTypeRow = this._createEnumComboRow(
            settings,
            _('Button Type'),
            _('Choose the button icon set'),
            'button-type',
            ['titlebuttons', 'titlebuttons-alt'],
            [_('Default'), _('Alternative')]
        );
        buttonsExpander.add_row(buttonTypeRow);

        const buttonSizeRow = this._createEnumComboRow(
            settings,
            _('Button Size'),
            _('Choose button size'),
            'button-size',
            ['small', 'normal'],
            [_('Small'), _('Normal')]
        );
        buttonsExpander.add_row(buttonSizeRow);

        // Firefox styling switch
        const firefoxStylingSwitch = new Adw.SwitchRow({
            title: _("Firefox Styling"),
            subtitle: _("Apply macOS window control styling for Firefox. Recommended to use with vertical tabs."),
            active: settings.get_boolean('enable-firefox-styling'),
        });
        buttonsExpander.add_row(firefoxStylingSwitch);
        settings.bind('enable-firefox-styling', firefoxStylingSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

        // Thunderbird styling switch
        const thunderbirdStylingSwitch = new Adw.SwitchRow({
            title: _("Thunderbird Styling"),
            subtitle: _("Apply macOS window control styling for Thunderbird."),
            active: settings.get_boolean('enable-thunderbird-styling'),
        });
        buttonsExpander.add_row(thunderbirdStylingSwitch);
        settings.bind('enable-thunderbird-styling', thunderbirdStylingSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        // No need to manage visibility; expander controls reveal

        // When the main switch is turned off, also turn off Firefox styling
        settings.connect('changed::enable-app-window-buttons', () => {
            const enabled = settings.get_boolean('enable-app-window-buttons');
            if (!enabled) {
                if (settings.get_boolean('enable-firefox-styling'))
                    settings.set_boolean('enable-firefox-styling', false);
                if (settings.get_boolean('enable-thunderbird-styling'))
                    settings.set_boolean('enable-thunderbird-styling', false);
            }
        });

        // Panel window controls with "Only when Fullscreen" sub-option
        const panelControlsGroup = new Adw.PreferencesGroup();
        windowControlsPage.add(panelControlsGroup);

        const controlsHasNonDefault = settings.get_boolean('show-window-controls-fullscreen-only');
        const controlsExpander = new Adw.ExpanderRow({
            title: _("Show Window Controls on Panel"),
            subtitle: _("Display close, minimize, maximize buttons in the top panel when window is maximized"),
            expanded: settings.get_boolean('show-window-controls') && controlsHasNonDefault,
            show_enable_switch: true,
            enable_expansion: settings.get_boolean('show-window-controls'),
        });
        panelControlsGroup.add(controlsExpander);

        controlsExpander.connect('notify::enable-expansion', () => {
            const v = controlsExpander.enable_expansion;
            if (settings.get_boolean('show-window-controls') !== v)
                settings.set_boolean('show-window-controls', v);
        });

        const fullscreenOnlyRow = new Adw.SwitchRow({
            title: _("Only when Fullscreen"),
            subtitle: _("Hide titlebars and show panel controls only for fullscreen windows, not maximized"),
        });
        controlsExpander.add_row(fullscreenOnlyRow);
        settings.bind('show-window-controls-fullscreen-only', fullscreenOnlyRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        //
        // Options Page
        //
        const settingsPage = new Adw.PreferencesPage({
            title: _('Options'),
            icon_name: 'preferences-other-symbolic',
        });
        window.add(settingsPage);

        const group = new Adw.PreferencesGroup({
            title: _('Kiwi'),
            description: _("Kiwi is not like Apple, it's free open source project that brings macOS-like feel for GNOME"),
        });
        settingsPage.add(group);

        this._addSwitchRows(settings, group, [
            { key: 'overview-wallpaper-background', title: _("Overview Wallpaper Blur"), subtitle: _("Use blurred current wallpaper as overview background") },
            { key: 'skip-overview-on-login', title: _("Skip to Desktop"), subtitle: _("Do not show the overview when logging in. Animation is still visible") },
            { key: 'hide-minimized-windows', title: _("Hide Minimized Windows"), subtitle: _("Hide minimized windows in the overview") },
            { key: 'move-window-to-new-workspace', title: _("Move Window to New Workspace"), subtitle: _("Move fullscreen window to a new workspace") },
            { key: 'reduce-window-animations', title: _("Reduce App Animations"), subtitle: _("Mimic macOS window opening and closing with a subtle scale and fade") },
            { key: 'transparent-move', title: _("Transparent Move"), subtitle: _("Move window with transparency") },
        ]);

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
            wrap: true,
            xalign: 0,
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
        const githubGicon = new Gio.FileIcon({
            file: Gio.File.new_for_path(`${this.path}/icons/github-symbolic.svg`),
        });

        const advancedLinksGroup = new Adw.PreferencesGroup();
        advancedLinksGroup.add(this._createLinkRow(
            _('Installation Guide on GitHub'),
            'https://github.com/kem-a/kiwi-kemma/tree/main/advanced',
            _('Open the advanced module build instructions'),
            githubGicon
        ));
        advancedPage.add(advancedLinksGroup);

        const moreGroup = new Adw.PreferencesGroup({
            title: _('More of my work...'),
        });

        const moreProjects = [
            { title: _('Kiwi Menu'), subtitle: _('MacOS style menu for GNOME'), url: 'https://github.com/kem-a/Kiwi-Menu' },
            { title: _('AppManager'), subtitle: _('MacOS style AppImage installer and management application'), url: 'https://github.com/kem-a/AppManager' },
            { title: _('Catalina Reloaded Icon Pack'), subtitle: _('macOS Tahoe icon theme for Linux'), url: 'https://github.com/kem-a/Catalina-reloaded' },
            { title: _('GDM Wallpaper'), subtitle: _('Set custom GDM login screen wallpaper'), url: 'https://github.com/kem-a/gnome-gdm-wallpaper' },
        ];

        moreProjects.forEach((project) => {
            moreGroup.add(this._createLinkRow(project.title, project.url, project.subtitle));
        });
        advancedPage.add(moreGroup);

        const recommendedGroup = new Adw.PreferencesGroup();
        advancedPage.add(recommendedGroup);

        const recommendedExpander = new Adw.ExpanderRow({
            title: _('Other Recommended Extensions'),
            subtitle: _('Extensions that are compatible with Kiwi'),
            expanded: false,
        });
        recommendedGroup.add(recommendedExpander);

        const recommendedExtensions = [
            { title: 'Dash to Dock', author: 'michele_g', url: 'https://extensions.gnome.org/extension/307/' },
            { title: 'Superbar', author: 'Furkan-rgb', url: 'https://github.com/Furkan-rgb/superbar' },
            { title: 'Compiz alike magic lamp effect', author: 'hermes83', url: 'https://extensions.gnome.org/extension/3740/' }, 
            { title: 'AppIndicator Support', author: '3v1n0', url: 'https://extensions.gnome.org/extension/615/' },
            { title: 'Clipboard Indicator', author: 'Tudmotu', url: 'https://extensions.gnome.org/extension/779/' },
            { title: 'Light Style', author: 'fmuellner', url: 'https://extensions.gnome.org/extension/6198/' },
            { title: 'Weather or Not', author: 'somepaulo', url: 'https://extensions.gnome.org/extension/5660/' },
            { title: 'Blur My Shell', author: 'aunetx', url: 'https://github.com/aunetx/blur-my-shell' },
        ];

        recommendedExtensions.forEach((rec) => {
            recommendedExpander.add_row(this._createLinkRow(rec.title, rec.url, rec.author));
        });

        const resetGroup = new Adw.PreferencesGroup();
        advancedPage.add(resetGroup);

        const resetButton = new Gtk.Button({
            label: _('Restore Defaults'),
            halign: Gtk.Align.CENTER,
            margin_top: 12,
            margin_bottom: 12,
            tooltip_text: _('Reset every Kiwi setting to its default value'),
        });
        resetButton.add_css_class('pill');
        resetButton.add_css_class('destructive-action');
        resetButton.connect('clicked', () => {
            const confirmDialog = new Adw.AlertDialog({
                heading: _('Restore Default Settings?'),
                body: _('Every Kiwi setting will be reset to its default value. This cannot be undone.'),
            });
            confirmDialog.add_response('cancel', _('Cancel'));
            confirmDialog.add_response('reset', _('Restore Defaults'));
            confirmDialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
            confirmDialog.set_default_response('cancel');
            confirmDialog.set_close_response('cancel');
            confirmDialog.connect('response', (dialog, response) => {
                if (response !== 'reset')
                    return;

                settings.settings_schema.list_keys().forEach((key) => settings.reset(key));
            });
            confirmDialog.present(window);
        });
        resetGroup.add(resetButton);
    }
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Generates GTK CSS imports for window controls and titlebar tweaks based on settings.
//
// Imports are written only to the user's ~/.config/gtk-{3,4}.0/gtk.css so the
// extension never writes inside its own installation directory. This keeps
// system-wide installs (e.g. /usr/share/gnome-shell/extensions, owned by root)
// working. See https://github.com/kem-a/kiwi-kemma/issues/86

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MARKER_BEGIN = '/* Kiwi (is not Apple) - managed imports: begin */';
const MARKER_END = '/* Kiwi (is not Apple) - managed imports: end */';

// Matches the whole managed block, including the markers themselves.
const MANAGED_BLOCK_REGEX = /\/\* Kiwi \(is not Apple\) - managed imports: begin \*\/[\s\S]*?\/\* Kiwi \(is not Apple\) - managed imports: end \*\/\n?/g;

// Matches any single-line @import pointing into the extension, in any quoting
// style. Cleans up the unmarked imports written by versions <= 1.9.1.
const LEGACY_IMPORT_REGEX = /^[^\n]*@import[^\n]*kiwi@kemma[^\n]*\n?/gm;

const SETTINGS_KEYS = [
    'enable-app-window-buttons', 'button-type', 'button-size',
    'show-window-controls', 'show-window-controls-fullscreen-only', 'popup-menu-styling',
];

let gtkThemeManager = null;

class GtkThemeManager {
    constructor(ext) {
        this._extension = ext;
        this._settings = null;
        this._settingsChangedId = null;
        this._cancellable = null;
    }

    // Absolute file:// URI for a stylesheet shipped in the extension's css folder.
    _cssUri(name) {
        const path = GLib.build_filenamev([this._extension.path, 'css', name]);
        return Gio.File.new_for_path(path).get_uri();
    }

    // Stylesheets to pull in for a given GTK major version ('3' or '4').
    _stylesheetsFor(version) {
        const enableAppButtons = this._settings.get_boolean('enable-app-window-buttons');
        const showControlsOnPanel = this._settings.get_boolean('show-window-controls');
        const fullscreenOnly = this._settings.get_boolean('show-window-controls-fullscreen-only');
        const buttonType = this._settings.get_string('button-type');
        const buttonSize = this._settings.get_string('button-size');
        const appFixes = this._settings.get_boolean('popup-menu-styling');

        const sheets = [];

        // Titlebutton styling only if app window buttons are enabled
        if (enableAppButtons) {
            if (buttonType === 'titlebuttons-alt') {
                sheets.push(`titlebuttons-alt${version}.css`);
            } else {
                sheets.push(`titlebuttons${version}.css`);
                // Glass only overrides the images of the default set
                if (buttonType === 'titlebuttons-glass')
                    sheets.push(`titlebuttons-glass${version}.css`);
            }

            if (buttonSize === 'small') {
                sheets.push(`titlebuttons-size-small${version}.css`);
                if (buttonType === 'titlebuttons-glass')
                    sheets.push(`titlebuttons-glass-size-small${version}.css`);
            }
        }

        // Hide the titlebar when window controls live in the panel
        if (showControlsOnPanel) {
            if (fullscreenOnly)
                sheets.push(`hide-titlebar-fullscreen${version}.css`);
            else
                sheets.push(`hide-titlebar${version}.css`);
        }

        // App fixes go last so they can override the above
        if (appFixes)
            sheets.push(`fixes${version}.css`);

        return sheets;
    }

    _buildManagedBlock(version) {
        const sheets = this._stylesheetsFor(version);
        if (!sheets.length)
            return '';

        const imports = sheets.map(name => `@import url("${this._cssUri(name)}");`);
        return `${MARKER_BEGIN}\n${imports.join('\n')}\n${MARKER_END}\n`;
    }

    async updateGtkCss() {
        // A newer run supersedes this one, so a stale block is never written last
        this._cancellable?.cancel();
        this._cancellable = new Gio.Cancellable();
        await this._syncFiles({3: this._buildManagedBlock('3'), 4: this._buildManagedBlock('4')}, this._cancellable);
    }

    // Writes each version's block; a cancelled run stops before touching another file
    async _syncFiles(blocks, cancellable) {
        for (const version of ['3', '4']) {
            const filePath = GLib.build_filenamev([GLib.get_user_config_dir(), `gtk-${version}.0`, 'gtk.css']);
            try {
                await this.processUserGtkFile(filePath, blocks[version], cancellable);
            } catch (error) {
                if (error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                console.error(`[Kiwi] Error processing GTK file ${filePath}: ${error}`);
            }
        }
    }

    // Replaces our managed block in the user's gtk.css, leaving their own rules
    // untouched. An empty block removes our imports entirely.
    async processUserGtkFile(filePath, managedBlock, cancellable) {
        const file = Gio.File.new_for_path(filePath);
        const exists = file.query_exists(null);

        if (!exists && !managedBlock)
            return;

        let original = '';
        if (exists) {
            const [contents] = await file.load_contents_async(cancellable);
            // Throw on non-UTF-8 so the file is left alone, not rewritten lossy
            original = new TextDecoder('utf-8', {fatal: true}).decode(contents);
        }

        // Strip any previous block, plus unmarked imports from older versions
        const userContent = original
            .replace(MANAGED_BLOCK_REGEX, '')
            .replace(LEGACY_IMPORT_REGEX, '');

        // Our imports come first so user rules can still override them
        const newContent = managedBlock + userContent;
        if (newContent === original)
            return;

        // Nothing but our own content was in there. A symlinked file belongs to
        // the user's setup, so it is emptied rather than deleted.
        const isSymlink = exists && file.query_info('standard::is-symlink',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null).get_is_symlink();
        if (!newContent.trim() && !isSymlink) {
            file.delete(null);
            return;
        }

        GLib.mkdir_with_parents(file.get_parent().get_path(), 0o755);
        // No REPLACE_DESTINATION: it would turn a symlink into a regular file
        file.replace_contents(newContent, null, false, Gio.FileCreateFlags.NONE, null);
    }

    async removeUserGtkConfig() {
        await this._syncFiles({3: '', 4: ''}, null);
    }

    enable() {
        this._settings = this._extension.getSettings();
        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            if (SETTINGS_KEYS.includes(key)) {
                this.updateGtkCss().catch(error => {
                    console.error(`[Kiwi] Error in settings changed handler: ${error}`);
                });
            }
        });

        // Initial update
        this.updateGtkCss().catch(error => {
            console.error(`[Kiwi] Error in initial update: ${error}`);
        });
    }

    disable() {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = null;
        this._settings = null;
        // Stop pending updates so none writes after the cleanup below
        this._cancellable.cancel();
        this._cancellable = null;

        // Remove our imports from user GTK config files
        this.removeUserGtkConfig().catch(error => {
            console.error(`[Kiwi] Error in disable cleanup: ${error}`);
        });

        this._extension = null;
    }
}

export function enable(ext) {
    Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
    if (!gtkThemeManager) {
        gtkThemeManager = new GtkThemeManager(ext);
        gtkThemeManager.enable();
    }
}

export function disable() {
    if (gtkThemeManager) {
        gtkThemeManager.disable();
        gtkThemeManager = null;
    }
}

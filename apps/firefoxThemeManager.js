// SPDX-License-Identifier: GPL-3.0-or-later
// Syncs Firefox userChrome.css imports with the extension's window control settings.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

let _manager = null;
const KIWI_MARKER_FILENAME = '.kiwi-managed';

class FirefoxThemeManager {
    constructor() {
        this._settings = null;
        this._settingsChangedId = null;
    }

    enable() {
        if (!this._settings) {
            this._settings = Extension.lookupByUUID('kiwi@kemma').getSettings();
            this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
                if (key === 'enable-firefox-styling' || key === 'enable-app-window-buttons' || key === 'button-type' || key === 'button-size' || key === 'show-window-controls') {
                    this.updateFirefoxCss().catch(e => console.error(`[Kiwi] FirefoxTheme update error: ${e}`));
                }
            });
            this.updateFirefoxCss().catch(e => console.error(`[Kiwi] FirefoxTheme initial update error: ${e}`));
        }
    }

    disable() {
        if (this._settings && this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
            this._settings = null;
        }
        // Remove our import and files
        this.removeFirefoxCss().catch(e => console.error(`[Kiwi] FirefoxTheme disable cleanup error: ${e}`));
    }

    async updateFirefoxCss() {
        // Respect master toggle
        if (!this._settings || !this._settings.get_boolean('enable-firefox-styling')) {
            await this.removeFirefoxCss();
            return;
        }
        const enableAppButtons = this._settings.get_boolean('enable-app-window-buttons');
        const showControlsOnPanel = this._settings.get_boolean('show-window-controls');
        const buttonType = this._settings.get_string('button-type'); // 'titlebuttons' | 'titlebuttons-alt'
        const buttonSize = this._settings.get_string('button-size'); // 'small' | 'normal'

        // If neither feature is active, restore original chrome and exit
        if (!enableAppButtons && !showControlsOnPanel) {
            await this.removeFirefoxCss();
            return;
        }

        const profile = this._getDefaultProfileFromInstallsIni();
        if (!profile)
            return;

        const ext = Extension.lookupByUUID('kiwi@kemma');
        const iconsRoot = `${ext.path}/icons`;

        try {
            const chromeDir = GLib.build_filenamev([profile, 'chrome']);
            const chromeGFile = Gio.File.new_for_path(chromeDir);
            const bakDir = `${chromeDir}.bak`;
            const bakGFile = Gio.File.new_for_path(bakDir);
            const chromeExists = chromeGFile.query_exists(null);
            const chromeIsKiwiManaged = chromeExists && this._isChromeManagedByKiwi(chromeDir);

            if (chromeExists) {
                if (chromeIsKiwiManaged) {
                    try { this._deleteDirRecursive(chromeGFile); } catch (e) { /* ignore */ }
                } else if (!bakGFile.query_exists(null)) {
                    chromeGFile.move(bakGFile, Gio.FileCopyFlags.NONE, null, null);
                } else {
                    try { this._deleteDirRecursive(chromeGFile); } catch (e) { /* ignore */ }
                }
            }

            // Create a fresh chrome directory managed by Kiwi
            GLib.mkdir_with_parents(chromeDir, 0o755);

            // Build userChrome.css content with @imports
            const imports = [];
            if (enableAppButtons) {
                const themingPath = `${iconsRoot}/firefoxWindowControls.css`;
                const altThemingPath = `${iconsRoot}/firefoxWindowControls.alt.css`;
                if (buttonType === 'titlebuttons-alt')
                    imports.push(`@import url("file://${altThemingPath}");`);
                else
                    imports.push(`@import url("file://${themingPath}");`);

                // Add small size overrides if selected
                if (buttonSize === 'small') {
                    const smallSizePath = `${iconsRoot}/firefoxWindowControls-size-small.css`;
                    imports.push(`@import url("file://${smallSizePath}");`);
                }
            }
            if (showControlsOnPanel) {
                const hiddenPath = `${iconsRoot}/firefoxWindowControlsHidden.css`;
                imports.push(`@import url("file://${hiddenPath}");`);
            }

            const userChromeContent = imports.join('\n') + (imports.length ? '\n' : '');

            const userChromePath = GLib.build_filenamev([chromeDir, 'userChrome.css']);
            const userChromeFile = Gio.File.new_for_path(userChromePath);
            userChromeFile.replace_contents(userChromeContent, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);

            this._markChromeAsKiwiManaged(chromeDir);

            // Ensure legacy userChrome loading is enabled
            this._ensureLegacyPref(profile);
        } catch (e) {
            console.error(`[Kiwi] FirefoxTheme write failed for profile ${profile}: ${e}`);
        }
    }

    async removeFirefoxCss() {
        try {
            const profile = this._getDefaultProfileFromInstallsIni();
            if (!profile)
                return;

            const chromeDir = GLib.build_filenamev([profile, 'chrome']);
            const chromeGFile = Gio.File.new_for_path(chromeDir);

            if (chromeGFile.query_exists(null)) {
                this._deleteDirRecursive(chromeGFile);
            }

            const bakDir = `${chromeDir}.bak`;
            const bakGFile = Gio.File.new_for_path(bakDir);
            if (bakGFile.query_exists(null)) {
                bakGFile.move(chromeGFile, Gio.FileCopyFlags.NONE, null, null);
            }
        } catch (e) {
            // ignore cleanup errors
        }
    }

    _markChromeAsKiwiManaged(chromeDirPath) {
        try {
            const markerPath = GLib.build_filenamev([chromeDirPath, KIWI_MARKER_FILENAME]);
            const markerFile = Gio.File.new_for_path(markerPath);
            markerFile.replace_contents('Kiwi managed chrome folder\n', null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            // ignore marker failures
        }
    }

    _isChromeManagedByKiwi(chromeDirPath) {
        try {
            const markerPath = GLib.build_filenamev([chromeDirPath, KIWI_MARKER_FILENAME]);
            return Gio.File.new_for_path(markerPath).query_exists(null);
        } catch (e) {
            return false;
        }
    }

    // no-op retained for API stability; import construction now done directly when writing userChrome.css
    async _ensureUserChromeImport(_chromeDir) { /* moved to updateFirefoxCss */ }

    _ensureLegacyPref(profileDir) {
        try {
            const userJsPath = GLib.build_filenamev([profileDir, 'user.js']);
            const file = Gio.File.new_for_path(userJsPath);
            let content = '';
            if (file.query_exists(null))
                content = this._readFileSync(file);

            const prefLine = 'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);';
            if (!content.includes(prefLine)) {
                content = (content.trim() ? content.trim() + '\n' : '') + `// Added by Kiwi extension to enable userChrome.css\n${prefLine}\n`;
                file.replace_contents(content, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            }
        } catch (e) {
            // non-fatal
        }
    }

    _getDefaultProfileFromInstallsIni() {
        try {
            const home = GLib.get_home_dir();
            const baseDir = `${home}/.mozilla/firefox`;
            const installsIni = Gio.File.new_for_path(`${baseDir}/installs.ini`);
            if (!installsIni.query_exists(null))
                return null;

            const instText = this._readFileSync(installsIni);
            const lines = instText.split(/\r?\n/);
            const sections = [];
            let s = { name: '', data: {} };
            for (const line of lines) {
                const t = line.trim();
                if (!t) continue;
                if (t.startsWith('[') && t.endsWith(']')) {
                    if (s.name) sections.push(s);
                    s = { name: t.slice(1, -1), data: {} };
                } else if (t.includes('=')) {
                    const i = t.indexOf('=');
                    const k = t.slice(0, i);
                    const v = t.slice(i + 1);
                    s.data[k] = v;
                }
            }
            if (s.name) sections.push(s);

            // Prefer a section with Locked=1 and Default=..., else any with Default
            let chosen = sections.find(sec => sec.data.Default && sec.data.Locked === '1');
            if (!chosen)
                chosen = sections.find(sec => sec.data.Default);
            if (!chosen)
                return null;

            const path = chosen.data.Default;
            const abs = GLib.build_filenamev([baseDir, path]);
            return Gio.File.new_for_path(abs).query_exists(null) ? abs : null;
        } catch (e) {
            return null;
        }
    }

    _deleteDirRecursive(dirFile) {
        const enumerator = dirFile.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const child = dirFile.get_child(info.get_name());
            const type = info.get_file_type();
            if (type === Gio.FileType.DIRECTORY) {
                this._deleteDirRecursive(child);
            } else {
                child.delete(null);
            }
        }
        enumerator.close(null);
        dirFile.delete(null);
    }

    _readFileSync(file) {
        const [, bytes] = file.load_contents(null);
        return new TextDecoder().decode(bytes);
    }

    // removed async reader; only sync reads are used for small files
}

export function enable() {
    if (!_manager) {
        _manager = new FirefoxThemeManager();
        _manager.enable();
    }
}

export function disable() {
    if (_manager) {
        _manager.disable();
        _manager = null;
    }
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Shared base class for managing Mozilla app (Firefox/Thunderbird) userChrome.css
// imports aligned with the extension's window control settings.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const KIWI_MARKER_FILENAME = '.kiwi-managed';

/**
 * MozillaThemeManager — reusable manager for injecting Kiwi window‐control
 * CSS into any Mozilla application that supports userChrome.css.
 *
 * @param {object} ext       – GNOME Shell Extension instance
 * @param {object} config
 * @param {string} config.settingsKey    – GSettings boolean key that toggles this app's styling
 * @param {string} config.profileBaseDir – relative path under $HOME (e.g. '.mozilla/firefox')
 * @param {string} config.cssPrefix      – CSS filename prefix (e.g. 'firefoxWindowControls')
 * @param {string} config.logPrefix      – label used in log messages
 */
export class MozillaThemeManager {
    constructor(ext, config) {
        this._extension = ext;
        this._config = config;
        this._settings = null;
        this._settingsChangedId = null;
    }

    enable() {
        if (!this._settings) {
            this._settings = this._extension.getSettings();
            this._settingsChangedId = this._settings.connect('changed', (_settings, key) => {
                if (key === this._config.settingsKey || key === 'enable-app-window-buttons' || key === 'window-button-style' || key === 'button-type' || key === 'button-size' || key === 'show-window-controls') {
                    this.updateCss().catch(e => console.error(`[Kiwi] ${this._config.logPrefix} update error: ${e}`));
                }
            });
            this.updateCss().catch(e => console.error(`[Kiwi] ${this._config.logPrefix} initial update error: ${e}`));
        }
    }

    disable() {
        if (this._settings && this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
            this._settings = null;
        }
        this.removeCss().catch(e => console.error(`[Kiwi] ${this._config.logPrefix} disable cleanup error: ${e}`));
        this._extension = null;
    }

    async updateCss() {
        if (!this._settings) {
            await this.removeCss();
            return;
        }
        const enableStyling = this._settings.get_boolean(this._config.settingsKey);
        const windowButtonStyle = this._settings.get_string('window-button-style');
        const enableAppButtons = windowButtonStyle !== 'off';
        const showControlsOnPanel = this._settings.get_boolean('show-window-controls');
        const buttonType = this._settings.get_string('button-type');
        const buttonSize = this._settings.get_string('button-size');

        if (!enableStyling && !showControlsOnPanel) {
            await this.removeCss();
            return;
        }

        const profile = this._getDefaultProfile();
        if (!profile)
            return;

        const ext = this._extension;
        const iconsRoot = `${ext.path}/icons`;
        const prefix = this._config.cssPrefix;

        try {
            const chromeDir = GLib.build_filenamev([profile, 'chrome']);
            const chromeGFile = Gio.File.new_for_path(chromeDir);
            const bakDir = `${chromeDir}.bak`;
            const bakGFile = Gio.File.new_for_path(bakDir);
            const chromeExists = chromeGFile.query_exists(null);
            const chromeIsKiwiManaged = chromeExists && this._isChromeManagedByKiwi(chromeDir);

            if (chromeExists) {
                if (chromeIsKiwiManaged) {
                    try { this._deleteDirRecursive(chromeGFile); } catch (_e) { /* ignore */ }
                } else if (!bakGFile.query_exists(null)) {
                    chromeGFile.move(bakGFile, Gio.FileCopyFlags.NONE, null, null);
                } else {
                    try { this._deleteDirRecursive(chromeGFile); } catch (_e) { /* ignore */ }
                }
            }

            GLib.mkdir_with_parents(chromeDir, 0o755);

            const imports = [];
            if (enableStyling && enableAppButtons) {
                const themingPath = `${iconsRoot}/${prefix}.css`;
                const altThemingPath = `${iconsRoot}/${prefix}.alt.css`;
                if (buttonType === 'titlebuttons-alt')
                    imports.push(`@import url("file://${altThemingPath}");`);
                else
                    imports.push(`@import url("file://${themingPath}");`);

                if (buttonSize === 'small') {
                    const smallSizePath = `${iconsRoot}/${prefix}-size-small.css`;
                    imports.push(`@import url("file://${smallSizePath}");`);
                }
            }
            if (showControlsOnPanel) {
                const hiddenPath = `${iconsRoot}/${prefix}Hidden.css`;
                imports.push(`@import url("file://${hiddenPath}");`);
            }

            const userChromeContent = imports.join('\n') + (imports.length ? '\n' : '');

            const userChromePath = GLib.build_filenamev([chromeDir, 'userChrome.css']);
            const userChromeFile = Gio.File.new_for_path(userChromePath);
            userChromeFile.replace_contents(userChromeContent, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);

            this._markChromeAsKiwiManaged(chromeDir);
            this._ensureLegacyPref(profile);
        } catch (e) {
            console.error(`[Kiwi] ${this._config.logPrefix} write failed for profile ${profile}: ${e}`);
        }
    }

    async removeCss() {
        try {
            const profile = this._getDefaultProfile();
            if (!profile)
                return;

            const chromeDir = GLib.build_filenamev([profile, 'chrome']);
            const chromeGFile = Gio.File.new_for_path(chromeDir);

            if (chromeGFile.query_exists(null))
                this._deleteDirRecursive(chromeGFile);

            const bakDir = `${chromeDir}.bak`;
            const bakGFile = Gio.File.new_for_path(bakDir);
            if (bakGFile.query_exists(null))
                bakGFile.move(chromeGFile, Gio.FileCopyFlags.NONE, null, null);
        } catch (_e) {
            // ignore cleanup errors
        }
    }

    _markChromeAsKiwiManaged(chromeDirPath) {
        try {
            const markerPath = GLib.build_filenamev([chromeDirPath, KIWI_MARKER_FILENAME]);
            const markerFile = Gio.File.new_for_path(markerPath);
            markerFile.replace_contents('Kiwi managed chrome folder\n', null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (_e) {
            // ignore marker failures
        }
    }

    _isChromeManagedByKiwi(chromeDirPath) {
        try {
            const markerPath = GLib.build_filenamev([chromeDirPath, KIWI_MARKER_FILENAME]);
            return Gio.File.new_for_path(markerPath).query_exists(null);
        } catch (_e) {
            return false;
        }
    }

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
        } catch (_e) {
            // non-fatal
        }
    }

    /**
     * Locate the default profile directory.
     * Tries installs.ini first, falls back to profiles.ini.
     */
    _getDefaultProfile() {
        const home = GLib.get_home_dir();
        const baseDir = GLib.build_filenamev([home, ...this._config.profileBaseDir.split('/')]);

        return this._getProfileFromInstallsIni(baseDir)
            ?? this._getProfileFromProfilesIni(baseDir);
    }

    _getProfileFromInstallsIni(baseDir) {
        try {
            const installsIni = Gio.File.new_for_path(`${baseDir}/installs.ini`);
            if (!installsIni.query_exists(null))
                return null;

            const sections = this._parseIniFile(installsIni);

            let chosen = sections.find(sec => sec.data.Default && sec.data.Locked === '1');
            if (!chosen)
                chosen = sections.find(sec => sec.data.Default);
            if (!chosen)
                return null;

            const path = chosen.data.Default;
            const abs = GLib.build_filenamev([baseDir, path]);
            return Gio.File.new_for_path(abs).query_exists(null) ? abs : null;
        } catch (_e) {
            return null;
        }
    }

    _getProfileFromProfilesIni(baseDir) {
        try {
            const profilesIni = Gio.File.new_for_path(`${baseDir}/profiles.ini`);
            if (!profilesIni.query_exists(null))
                return null;

            const sections = this._parseIniFile(profilesIni);

            // Find the profile marked as Default=1
            let chosen = sections.find(sec => sec.name.startsWith('Profile') && sec.data.Default === '1');
            if (!chosen)
                chosen = sections.find(sec => sec.name.startsWith('Profile') && sec.data.Path);
            if (!chosen)
                return null;

            const path = chosen.data.Path;
            const isRelative = chosen.data.IsRelative === '1';
            const abs = isRelative ? GLib.build_filenamev([baseDir, path]) : path;
            return Gio.File.new_for_path(abs).query_exists(null) ? abs : null;
        } catch (_e) {
            return null;
        }
    }

    _parseIniFile(file) {
        const text = this._readFileSync(file);
        const lines = text.split(/\r?\n/);
        const sections = [];
        let s = {name: '', data: {}};
        for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            if (t.startsWith('[') && t.endsWith(']')) {
                if (s.name) sections.push(s);
                s = {name: t.slice(1, -1), data: {}};
            } else if (t.includes('=')) {
                const i = t.indexOf('=');
                s.data[t.slice(0, i)] = t.slice(i + 1);
            }
        }
        if (s.name) sections.push(s);
        return sections;
    }

    _deleteDirRecursive(dirFile) {
        const enumerator = dirFile.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const child = dirFile.get_child(info.get_name());
            if (info.get_file_type() === Gio.FileType.DIRECTORY)
                this._deleteDirRecursive(child);
            else
                child.delete(null);
        }
        enumerator.close(null);
        dirFile.delete(null);
    }

    _readFileSync(file) {
        const [, bytes] = file.load_contents(null);
        return new TextDecoder().decode(bytes);
    }
}

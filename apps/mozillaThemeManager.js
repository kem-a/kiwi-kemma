// SPDX-License-Identifier: GPL-3.0-or-later
// Shared base class for managing Mozilla app (Firefox/Thunderbird) userChrome.css
// imports aligned with the extension's window control settings.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const KIWI_MARKER_FILENAME = '.kiwi-managed';
const BLOCK_BEGIN = '/* --- Kiwi window controls (managed by Kiwi, do not edit) --- */';
const BLOCK_END = '/* --- end Kiwi --- */';
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BLOCK_RE = new RegExp(`${escapeRe(BLOCK_BEGIN)}[\\s\\S]*?${escapeRe(BLOCK_END)}\\n?`, 'g');
// Leading comments and @charset/@import rules; Kiwi's imports go after them so they win conflicts
const PRELUDE_RE = /^(?:\s+|\/\*[\s\S]*?\*\/|@(?:charset|import)\b[^;]*;)*/;

/**
 * MozillaThemeManager — reusable manager for injecting Kiwi window‐control
 * CSS into any Mozilla application that supports userChrome.css.
 *
 * @param {object} ext       – GNOME Shell Extension instance
 * @param {object} config
 * @param {string} config.settingsKey    – GSettings boolean key that toggles this app's styling
 * @param {string} config.profileBaseDir – relative path under $HOME (e.g. '.mozilla/firefox')
 * @param {string} config.xdgProfileDir  – relative path under $XDG_CONFIG_HOME (e.g. 'mozilla/firefox')
 * @param {string} config.cssPrefix      – CSS filename prefix (e.g. 'firefoxWindowControls')
 * @param {string} config.logPrefix      – label used in log messages
 */
export class MozillaThemeManager {
    constructor(ext, config) {
        this._extension = ext;
        this._config = config;
        this._settings = null;
        this._settingsChangedId = null;
        this._cancellable = null;
    }

    enable() {
        this._cancellable = new Gio.Cancellable();
        this._settings = this._extension.getSettings();
        this._settingsChangedId = this._settings.connect('changed', (_settings, key) => {
            if (key === this._config.settingsKey || key === 'enable-app-window-buttons' || key === 'button-type' || key === 'button-size' || key === 'show-window-controls') {
                this.updateCss().catch(e => console.error(`[Kiwi] ${this._config.logPrefix} update error: ${e}`));
            }
        });
        this.updateCss().catch(e => console.error(`[Kiwi] ${this._config.logPrefix} initial update error: ${e}`));
    }

    disable() {
        this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = null;
        this._settings = null;
        // Stop pending updates so none writes after the cleanup below
        this._cancellable.cancel();
        this._cancellable = null;
        this.removeCss().catch(e => console.error(`[Kiwi] ${this._config.logPrefix} disable cleanup error: ${e}`));
        this._extension = null;
    }

    async updateCss() {
        const cancellable = this._cancellable;
        const enableStyling = this._settings.get_boolean(this._config.settingsKey);
        const enableAppButtons = this._settings.get_boolean('enable-app-window-buttons');
        const showControlsOnPanel = this._settings.get_boolean('show-window-controls');
        const buttonType = this._settings.get_string('button-type');
        const buttonSize = this._settings.get_string('button-size');
        const cssRoot = `${this._extension.path}/css`;
        const prefix = this._config.cssPrefix;

        try {
            if (!enableStyling && !showControlsOnPanel) {
                await this.removeCss(cancellable);
                return;
            }

            const profile = await this._getDefaultProfile(cancellable);
            if (!profile) {
                console.debug(`[Kiwi] ${this._config.logPrefix} no profile found`);
                return;
            }

            const imports = [];
            if (enableStyling && enableAppButtons) {
                const themingPath = `${cssRoot}/${prefix}.css`;
                const altThemingPath = `${cssRoot}/${prefix}.alt.css`;
                const glassThemingPath = `${cssRoot}/${prefix}.glass.css`;
                if (buttonType === 'titlebuttons-alt') {
                    imports.push(`@import url("file://${altThemingPath}");`);
                } else {
                    imports.push(`@import url("file://${themingPath}");`);
                    // Glass only overrides the images of the default set
                    if (buttonType === 'titlebuttons-glass')
                        imports.push(`@import url("file://${glassThemingPath}");`);
                }

                if (buttonSize === 'small') {
                    const smallSizePath = `${cssRoot}/${prefix}-size-small.css`;
                    imports.push(`@import url("file://${smallSizePath}");`);
                }
            }
            if (showControlsOnPanel) {
                const hiddenPath = `${cssRoot}/${prefix}Hidden.css`;
                imports.push(`@import url("file://${hiddenPath}");`);
            }

            await this._writeKiwiBlock(profile, imports, cancellable);
            await this._ensureLegacyPref(profile, cancellable);
        } catch (e) {
            if (!(e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)))
                console.error(`[Kiwi] ${this._config.logPrefix} update failed: ${e}`);
        }
    }

    async removeCss(cancellable = null) {
        const profile = await this._getDefaultProfile(cancellable);
        if (profile)
            await this._writeKiwiBlock(profile, [], cancellable);
    }

    // Rewrites only Kiwi's marked block in userChrome.css, the rest of chrome/ belongs to the user
    async _writeKiwiBlock(profile, imports, cancellable) {
        const chromeDir = GLib.build_filenamev([profile, 'chrome']);
        this._migrateLegacyChrome(chromeDir);

        const file = Gio.File.new_for_path(GLib.build_filenamev([chromeDir, 'userChrome.css']));
        const exists = file.query_exists(null);
        if (!exists && !imports.length)
            return;

        const original = exists ? await this._readFileAsync(file, cancellable) : '';
        let text = original.replace(BLOCK_RE, '');
        if (imports.length) {
            const at = text.match(PRELUDE_RE)[0].length;
            text = `${text.slice(0, at)}${BLOCK_BEGIN}\n${imports.join('\n')}\n${BLOCK_END}\n${text.slice(at)}`;
        } else if (text === original) {
            return;
        } else if (!text.trim()) {
            // The file held only Kiwi's block, so Kiwi created it
            file.delete(null);
            const chrome = file.get_parent();
            if (this._isEmptyDir(chrome))
                chrome.delete(null);
            return;
        }
        GLib.mkdir_with_parents(chromeDir, 0o755);
        file.replace_contents(text, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    }

    // Kiwi 2.3.x and older owned chrome/ and parked the user's folder in chrome.bak
    _migrateLegacyChrome(chromeDir) {
        if (!this._isChromeManagedByKiwi(chromeDir))
            return;

        const chrome = Gio.File.new_for_path(chromeDir);
        chrome.get_child(KIWI_MARKER_FILENAME).delete(null);
        const generated = chrome.get_child('userChrome.css');
        if (generated.query_exists(null))
            generated.delete(null);

        const bak = Gio.File.new_for_path(`${chromeDir}.bak`);
        if (!bak.query_exists(null))
            return;

        if (this._isEmptyDir(chrome)) {
            chrome.delete(null);
            bak.move(chrome, Gio.FileCopyFlags.NONE, null, null);
        } else {
            console.warn(`[Kiwi] ${this._config.logPrefix} ${chromeDir} has extra files, left ${chromeDir}.bak in place`);
        }
    }

    _isEmptyDir(dir) {
        const children = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        const isEmpty = children.next_file(null) === null;
        children.close(null);
        return isEmpty;
    }

    _isChromeManagedByKiwi(chromeDirPath) {
        const markerPath = GLib.build_filenamev([chromeDirPath, KIWI_MARKER_FILENAME]);
        return Gio.File.new_for_path(markerPath).query_exists(null);
    }

    async _ensureLegacyPref(profileDir, cancellable) {
        try {
            const userJsPath = GLib.build_filenamev([profileDir, 'user.js']);
            const file = Gio.File.new_for_path(userJsPath);
            let content = '';
            if (file.query_exists(null))
                content = await this._readFileAsync(file, cancellable);

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
    async _getDefaultProfile(cancellable) {
        // Legacy $HOME dir wins when present, same as Mozilla; else XDG config dir (Firefox 147+)
        const baseDirs = [
            GLib.build_filenamev([GLib.get_home_dir(), ...this._config.profileBaseDir.split('/')]),
            GLib.build_filenamev([GLib.get_user_config_dir(), ...this._config.xdgProfileDir.split('/')]),
        ];

        for (const baseDir of baseDirs) {
            const profile = (await this._getProfileFromInstallsIni(baseDir, cancellable))
                ?? (await this._getProfileFromProfilesIni(baseDir, cancellable));
            if (profile)
                return profile;
        }
        return null;
    }

    async _getProfileFromInstallsIni(baseDir, cancellable) {
        try {
            const installsIni = Gio.File.new_for_path(`${baseDir}/installs.ini`);
            if (!installsIni.query_exists(null))
                return null;

            const sections = await this._parseIniFile(installsIni, cancellable);

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

    async _getProfileFromProfilesIni(baseDir, cancellable) {
        try {
            const profilesIni = Gio.File.new_for_path(`${baseDir}/profiles.ini`);
            if (!profilesIni.query_exists(null))
                return null;

            const sections = await this._parseIniFile(profilesIni, cancellable);

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

    async _parseIniFile(file, cancellable) {
        const text = await this._readFileAsync(file, cancellable);
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

    _readFileAsync(file, cancellable) {
        return new Promise((resolve, reject) => {
            file.load_contents_async(cancellable, (fileObj, res) => {
                try {
                    const [, bytes] = fileObj.load_contents_finish(res);
                    // Throw on non-UTF-8 so the file is left alone, not rewritten lossy
                    resolve(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }
}

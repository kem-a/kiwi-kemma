// firefoxThemeManager.js - Manages Firefox userChrome.css based on settings
// - Uses extension's window control button assets when "Enable Application Window Buttons" is ON
// - Hides Firefox window control buttons when maximized if "Show Window Controls on Panel" is ON

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

let _manager = null;

class FirefoxThemeManager {
    constructor() {
        this._settings = null;
        this._settingsChangedId = null;
    }

    enable() {
        if (!this._settings) {
            this._settings = Extension.lookupByUUID('kiwi@kemma').getSettings();
            this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
                if (key === 'enable-app-window-buttons' || key === 'button-type' || key === 'show-window-controls') {
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
        const enableAppButtons = this._settings.get_boolean('enable-app-window-buttons');
        const showControlsOnPanel = this._settings.get_boolean('show-window-controls');
        const buttonType = this._settings.get_string('button-type'); // 'titlebuttons' | 'titlebuttons-alt'

        const profiles = this._getFirefoxProfiles();
        if (profiles.length === 0)
            return; // Nothing to do

        // If neither feature is active, restore original chrome and exit
        if (!enableAppButtons && !showControlsOnPanel) {
            await this.removeFirefoxCss();
            return;
        }

        const ext = Extension.lookupByUUID('kiwi@kemma');
        const iconsRoot = `${ext.path}/icons`;

    // Only apply to the default profile (first element returned is default when present)
    const targets = profiles.length > 0 ? [profiles[0]] : [];
    for (const profile of targets) {
            try {
                const chromeDir = GLib.build_filenamev([profile, 'chrome']);
                const chromeGFile = Gio.File.new_for_path(chromeDir);

                // If chrome exists, back it up to chrome.bak (once)
                if (chromeGFile.query_exists(null)) {
                    const bakDir = `${chromeDir}.bak`;
                    const bakGFile = Gio.File.new_for_path(bakDir);
                    if (!bakGFile.query_exists(null)) {
                        // Move (rename) chrome -> chrome.bak
                        chromeGFile.move(bakGFile, Gio.FileCopyFlags.NONE, null, null);
                    } else {
                        // If backup already exists, remove current chrome to recreate cleanly
                        try { this._deleteDirRecursive(chromeGFile); } catch (e) { /* ignore */ }
                    }
                }

                // Create a fresh chrome directory managed by Kiwi
                GLib.mkdir_with_parents(chromeDir, 0o755);

                // Build userChrome.css content with @imports
                const imports = [];
                if (enableAppButtons) {
                    // Import the theming CSS from the extension icons directory; its url()s are relative to itself
                    const themingPath = `${iconsRoot}/firefoxWindowControls.css`;
                    const altThemingPath = `${iconsRoot}/firefoxWindowControls.alt.css`;
                    if (buttonType === 'titlebuttons-alt')
                        imports.push(`@import url("file://${altThemingPath}");`);
                    else
                        imports.push(`@import url("file://${themingPath}");`);
                }
                if (showControlsOnPanel) {
                    const hiddenPath = `${iconsRoot}/firefoxWindowControlsHidden.css`;
                    imports.push(`@import url("file://${hiddenPath}");`);
                }

                // If no features active, still create chrome/ with empty userChrome so legacy pref can be set; or restore backup in remove path.
                const userChromeContent = imports.join('\n') + (imports.length ? '\n' : '');

                const userChromePath = GLib.build_filenamev([chromeDir, 'userChrome.css']);
                const userChromeFile = Gio.File.new_for_path(userChromePath);
                userChromeFile.replace_contents(userChromeContent, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);

                // Ensure legacy userChrome loading is enabled
                await this._ensureLegacyPref(profile);
            } catch (e) {
                console.error(`[Kiwi] FirefoxTheme write failed for profile ${profile}: ${e}`);
            }
        }
    }

    async removeFirefoxCss() {
    const profiles = this._getFirefoxProfiles();
    const targets = profiles.length > 0 ? [profiles[0]] : [];
    for (const profile of targets) {
            try {
                const chromeDir = GLib.build_filenamev([profile, 'chrome']);
                const chromeGFile = Gio.File.new_for_path(chromeDir);

                // Remove managed chrome dir
                if (chromeGFile.query_exists(null)) {
                    this._deleteDirRecursive(chromeGFile);
                }

                // If backup exists, restore it
                const bakDir = `${chromeDir}.bak`;
                const bakGFile = Gio.File.new_for_path(bakDir);
                if (bakGFile.query_exists(null)) {
                    bakGFile.move(chromeGFile, Gio.FileCopyFlags.NONE, null, null);
                }
            } catch (e) {
                // ignore profile removal errors
            }
        }
    }

    // no-op retained for API stability; import construction now done directly when writing userChrome.css
    async _ensureUserChromeImport(_chromeDir) { /* moved to updateFirefoxCss */ }

    async _ensureLegacyPref(profileDir) {
        try {
            const userJsPath = GLib.build_filenamev([profileDir, 'user.js']);
            const file = Gio.File.new_for_path(userJsPath);
            let content = '';
            if (file.query_exists(null))
                content = await this._readFile(file);

            const prefLine = 'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);';
            if (!content.includes(prefLine)) {
                content = (content.trim() ? content.trim() + '\n' : '') + `// Added by Kiwi extension to enable userChrome.css\n${prefLine}\n`;
                file.replace_contents(content, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            }
        } catch (e) {
            // non-fatal
        }
    }

    _getFirefoxProfiles() {
        try {
            const home = GLib.get_home_dir();
            const profilesIni = Gio.File.new_for_path(`${home}/.mozilla/firefox/profiles.ini`);
            if (!profilesIni.query_exists(null))
                return [];
            const text = this._readFileSync(profilesIni);
            const lines = text.split(/\r?\n/);
            const sections = [];
            let section = { name: '', data: {} };
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                    if (section.name)
                        sections.push(section);
                    section = { name: trimmed.slice(1, -1), data: {} };
                } else if (trimmed.includes('=')) {
                    const idx = trimmed.indexOf('=');
                    const k = trimmed.slice(0, idx);
                    const v = trimmed.slice(idx + 1);
                    section.data[k] = v;
                }
            }
            if (section.name)
                sections.push(section);

            const baseDir = `${home}/.mozilla/firefox`;

            // Try installs.ini first (some Firefox versions move Install sections there)
            try {
                const installsIni = Gio.File.new_for_path(`${home}/.mozilla/firefox/installs.ini`);
                if (installsIni.query_exists(null)) {
                    const instText = this._readFileSync(installsIni);
                    const instLines = instText.split(/\r?\n/);
                    const instSections = [];
                    let s = { name: '', data: {} };
                    for (const line of instLines) {
                        const t = line.trim();
                        if (!t) continue;
                        if (t.startsWith('[') && t.endsWith(']')) {
                            if (s.name) instSections.push(s);
                            s = { name: t.slice(1, -1), data: {} };
                        } else if (t.includes('=')) {
                            const i = t.indexOf('=');
                            const k = t.slice(0, i);
                            const v = t.slice(i + 1);
                            s.data[k] = v;
                        }
                    }
                    if (s.name) instSections.push(s);

                    const inst = instSections.find(sec => sec.name.startsWith('Install') && sec.data.Default);
                    if (inst) {
                        const path = inst.data.Default;
                        const abs = GLib.build_filenamev([baseDir, path]);
                        if (Gio.File.new_for_path(abs).query_exists(null))
                            return [abs];
                    }
                }
            } catch (e) { /* ignore and fallback to profiles.ini */ }

            // 1) Prefer [Install*] section with Locked=1 and Default=<path> (if present in profiles.ini)
            const install = sections.find(s => s.name.startsWith('Install') && (s.data.Locked === '1' || s.data.Default) && s.data.Default);
            if (install) {
                const path = install.data.Default;
                const abs = GLib.build_filenamev([baseDir, path]);
                if (Gio.File.new_for_path(abs).query_exists(null))
                    return [abs];
            }

            // 2) Fall back to [Profile*] with Default=1
            const profileDefault = sections.find(s => s.name.startsWith('Profile') && s.data.Default === '1' && s.data.Path);
            if (profileDefault) {
                const abs = profileDefault.data.IsRelative === '1' ? GLib.build_filenamev([baseDir, profileDefault.data.Path]) : profileDefault.data.Path;
                if (Gio.File.new_for_path(abs).query_exists(null))
                    return [abs];
            }

            // 3) As last resort, collect all existing profiles
            const all = sections
                .filter(s => s.name.startsWith('Profile') && s.data.Path)
                .map(s => s.data.IsRelative === '1' ? GLib.build_filenamev([baseDir, s.data.Path]) : s.data.Path)
                .filter(p => Gio.File.new_for_path(p).query_exists(null));
            return all;
        } catch (e) {
            return [];
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

    async _readFile(file) {
        const [success, contents] = await new Promise((resolve, reject) => {
            file.load_contents_async(null, (source, result) => {
                try {
                    const [s, c] = source.load_contents_finish(result);
                    resolve([s, c]);
                } catch (err) {
                    reject(err);
                }
            });
        });
        if (!success)
            return '';
        return new TextDecoder().decode(contents);
    }
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

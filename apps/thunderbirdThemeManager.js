// SPDX-License-Identifier: GPL-3.0-or-later
// Syncs Thunderbird userChrome.css imports with the extension's window control settings.

import {MozillaThemeManager} from './mozillaThemeManager.js';

let _manager = null;

export function enable(ext) {
    if (!_manager) {
        _manager = new MozillaThemeManager(ext, {
            settingsKey: 'enable-thunderbird-styling',
            profileBaseDir: '.thunderbird',
            cssPrefix: 'thunderbirdWindowControls',
            logPrefix: 'ThunderbirdTheme',
        });
        _manager.enable();
    }
}

export function disable() {
    if (_manager) {
        _manager.disable();
        _manager = null;
    }
}

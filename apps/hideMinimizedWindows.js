// SPDX-License-Identifier: GPL-3.0-or-later
// Filters minimized windows out of overview and switcher lists.

import { InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js';
import { Workspace } from 'resource:///org/gnome/shell/ui/workspace.js';
import {
    GroupCyclerPopup,
    WindowCyclerPopup,
    WindowSwitcherPopup,
} from 'resource:///org/gnome/shell/ui/altTab.js';

let _injectionManager = null;

function _filterMinimized(original) {
    return function (...args) {
        return original.apply(this, args).filter(w => !w.minimized);
    };
}

export function enable() {
    if (_injectionManager) return;
    _injectionManager = new InjectionManager();

    _injectionManager.overrideMethod(Workspace.prototype, '_isOverviewWindow',
        original => function (win) {
            return original.call(this, win) && !win.minimized;
        });
    _injectionManager.overrideMethod(WindowCyclerPopup.prototype, '_getWindows', _filterMinimized);
    _injectionManager.overrideMethod(GroupCyclerPopup.prototype, '_getWindows', _filterMinimized);
    _injectionManager.overrideMethod(WindowSwitcherPopup.prototype, '_getWindowList', _filterMinimized);
}

export function disable() {
    _injectionManager?.clear();
    _injectionManager = null;
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Filters minimized windows out of overview and switcher lists.

import { Workspace } from 'resource:///org/gnome/shell/ui/workspace.js';
import {
    GroupCyclerPopup,
    WindowCyclerPopup,
    WindowSwitcherPopup,
} from 'resource:///org/gnome/shell/ui/altTab.js';

const isOverviewWindow = Workspace.prototype._isOverviewWindow;
const groupGetWindows = GroupCyclerPopup.prototype._getWindows;
const windowGetWindows = WindowCyclerPopup.prototype._getWindows;
const windowSwitcherWindows = WindowSwitcherPopup.prototype._getWindowList;

let connected = false;

function _filterWindows(windows) {
    return windows.filter(w => !w.minimized);
}

export function enable() {
    if (connected) return;
    connected = true;

    Workspace.prototype._isOverviewWindow = (win) => {
        const show = isOverviewWindow(win);
        let meta = win;
        if (win.get_meta_window)
            meta = win.get_meta_window();
        return show && !meta.minimized;
    };

    WindowCyclerPopup.prototype._getWindows = function() {
        return _filterWindows(windowGetWindows.bind(this)());
    };

    GroupCyclerPopup.prototype._getWindows = function() {
        return _filterWindows(groupGetWindows.bind(this)());
    };

    WindowSwitcherPopup.prototype._getWindowList = function() {
        return _filterWindows(windowSwitcherWindows.bind(this)());
    };
}

export function disable() {
    if (!connected) return;
    connected = false;

    Workspace.prototype._isOverviewWindow = isOverviewWindow;
    WindowCyclerPopup.prototype._getWindows = windowGetWindows;
    GroupCyclerPopup.prototype._getWindows = groupGetWindows;
    WindowSwitcherPopup.prototype._getWindowList = windowSwitcherWindows;
}

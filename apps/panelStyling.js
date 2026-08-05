// SPDX-License-Identifier: GPL-3.0-or-later
// Gates the panel and popup-menu rules in stylesheet.css. Both sets reach stock
// shell elements, so they only apply while their style class is present.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const PANEL_CLASS = 'kiwi-panel-styled';
const POPUP_CLASS = 'kiwi-popup-styled';

export function enable() {
    Main.panel.add_style_class_name(PANEL_CLASS);
}

export function disable() {
    Main.panel.remove_style_class_name(PANEL_CLASS);
}

// Menus live under the UI group rather than the panel, so the gate goes there.
export function enableMenus() {
    Main.uiGroup.add_style_class_name(POPUP_CLASS);
}

export function disableMenus() {
    Main.uiGroup.remove_style_class_name(POPUP_CLASS);
}

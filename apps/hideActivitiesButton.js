// SPDX-License-Identifier: GPL-3.0-or-later
// Hides the Activities button in the top panel while the feature is enabled.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

let _activitiesButton = null;

export function enable() {
    _activitiesButton = Main.panel.statusArea.activities;
    if (_activitiesButton?.visible) {
        _activitiesButton.hide();
    }
}

export function disable() {
    if (_activitiesButton && !_activitiesButton.visible) {
        _activitiesButton.show();
    }
    _activitiesButton = null;
}

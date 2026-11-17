// SPDX-License-Identifier: GPL-3.0-or-later
// Kiwi Extension - Helpers for removing GNOME Shell's built-in DND UI that was added in GNOME 49
// This module removes system DND elements to avoid duplicate UI elements when Kiwi's own DND elements

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

export const SHELL_HAS_SYSTEM_DND = parseInt(Config.PACKAGE_VERSION) >= 49;

const _suppressedActors = {
    toggle: null,
    indicator: null,
};

let _dateMenuIndicatorState = null;
let _dateMenuIndicatorSignals = null;

// The shell's own DND indicator; its quickSettingsItems[0] is the DND toggle.
// Built with the other indicators once their async setup is done.
function getDndIndicator() {
    return Main.panel.statusArea.quickSettings._doNotDisturb;
}

function suppressActor(key, actor) {
    const parent = actor.get_parent();
    if (!parent)
        return false;

    _suppressedActors[key] = {
        actor,
        parent,
        index: parent.get_children().indexOf(actor),
    };

    parent.remove_child(actor);
    actor.hide();

    return true;
}

function restoreActor(key) {
    const suppressed = _suppressedActors[key];
    if (!suppressed)
        return null;

    const { actor, parent, index } = suppressed;
    parent.insert_child_at_index(actor, Math.min(index, parent.get_n_children()));
    _suppressedActors[key] = null;
    return actor;
}

export function suppressBuiltinDndToggle() {
    if (!SHELL_HAS_SYSTEM_DND)
        return true;

    if (_suppressedActors.toggle)
        return true;

    const indicator = getDndIndicator();
    if (!indicator)
        return false;

    return suppressActor('toggle', indicator.quickSettingsItems[0]);
}

export function restoreBuiltinDndToggle() {
    if (!SHELL_HAS_SYSTEM_DND)
        return;

    restoreActor('toggle')?.show();
}

export function suppressBuiltinDndIndicator() {
    if (_suppressedActors.indicator)
        return true;

    // Shell 48 has none; on 49+ it may not be built yet
    const indicator = getDndIndicator();
    if (!indicator)
        return !SHELL_HAS_SYSTEM_DND;

    return suppressActor('indicator', indicator);
}

export function restoreBuiltinDndIndicator() {
    // Shown again only if DND is on, as the shell decides
    restoreActor('indicator')?._syncIndicatorsVisible();
}

export function hideDateMenuIndicator() {
    const indicator = Main.panel.statusArea.dateMenu._indicator;

    if (!_dateMenuIndicatorState) {
        _dateMenuIndicatorState = {
            reactive: indicator.reactive,
            opacity: indicator.opacity,
        };
    }

    enforceDateMenuIndicatorHidden(indicator);

    if (!_dateMenuIndicatorSignals) {
        _dateMenuIndicatorSignals = [
            indicator.connect('notify::visible', () => enforceDateMenuIndicatorHidden(indicator)),
            indicator.connect('notify::opacity', () => enforceDateMenuIndicatorHidden(indicator)),
            indicator.connect('show', () => enforceDateMenuIndicatorHidden(indicator)),
        ];
    }
}

export function restoreDateMenuIndicator() {
    if (!_dateMenuIndicatorState)
        return;

    const indicator = Main.panel.statusArea.dateMenu._indicator;
    if (_dateMenuIndicatorSignals) {
        for (const id of _dateMenuIndicatorSignals)
            indicator.disconnect(id);
        _dateMenuIndicatorSignals = null;
    }

    indicator.opacity = _dateMenuIndicatorState.opacity;
    indicator.reactive = _dateMenuIndicatorState.reactive;
    // Visibility follows unread count and DND, which may have changed meanwhile
    indicator._sync();

    _dateMenuIndicatorState = null;
}

function enforceDateMenuIndicatorHidden(indicator) {
    indicator.reactive = false;
    indicator.hide();
    indicator.opacity = 0;
}

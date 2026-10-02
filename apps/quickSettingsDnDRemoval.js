// SPDX-License-Identifier: GPL-3.0-or-later
// Kiwi Extension - Helpers for removing GNOME Shell's built-in DND UI that was added in GNOME 49
// This module removes system DND elements to avoid duplicate UI elements when Kiwi's own DND elements

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

export const SHELL_HAS_SYSTEM_DND = parseInt(Config.PACKAGE_VERSION) >= 49;

const DND_ICON_NAMES = new Set([
    'weather-clear-night-symbolic',
    'weather-clear-night',
    'notifications-disabled-symbolic',
    'notifications-disabled',
    'notifications-none-symbolic',
    'notifications-none',
].map(name => name.toLowerCase()));

const _suppressedActors = {
    toggle: null,
    indicator: null,
};

let _dateMenuIndicatorState = null;
let _dateMenuIndicatorSignals = null;

function matchesDndIconName(iconName) {
    if (!iconName)
        return false;

    return DND_ICON_NAMES.has(`${iconName}`.toLowerCase());
}

function actorContainsDndIcon(actor, depth = 0) {
    if (depth > 4)
        return false;

    if (matchesDndIconName(actor.icon_name))
        return true;

    return actor.get_children().some(child => actorContainsDndIcon(child, depth + 1));
}

function isDoNotDisturbToggle(actor) {
    const accessibleName = actor.accessible_name?.toLowerCase() ?? '';
    if (accessibleName.includes('do not disturb'))
        return true;

    const title = `${actor.title ?? actor.text ?? ''}`.toLowerCase();
    if (title.includes('do not disturb'))
        return true;

    if (actorContainsDndIcon(actor))
        return true;

    const styleClass = actor.style_class ?? '';
    if (styleClass.includes('dnd') || styleClass.includes('do-not-disturb'))
        return true;

    return actor.constructor.name.toLowerCase().includes('disturb');
}

function suppressActor(key, actor, { preserveVisibility = false } = {}) {
    const parent = actor.get_parent();
    if (!parent)
        return false;

    _suppressedActors[key] = {
        actor,
        parent,
        index: parent.get_children().indexOf(actor),
        state: preserveVisibility ? {
            visible: actor.visible,
            reactive: actor.reactive,
            opacity: actor.opacity,
        } : null,
    };

    parent.remove_child(actor);
    actor.hide();

    return true;
}

function restoreActor(key) {
    const suppressed = _suppressedActors[key];
    if (!suppressed)
        return;

    const { actor, parent, index, state } = suppressed;
    parent.insert_child_at_index(actor, Math.min(index, parent.get_n_children()));

    if (state) {
        actor.reactive = state.reactive;
        actor.opacity = state.opacity;
        actor.visible = state.visible;
    } else {
        actor.show();
    }

    _suppressedActors[key] = null;
}

export function suppressBuiltinDndToggle() {
    if (!SHELL_HAS_SYSTEM_DND)
        return true;

    if (_suppressedActors.toggle)
        return true;

    const grid = Main.panel.statusArea.quickSettings.menu._grid;
    const toggle = grid.get_children().find(child => isDoNotDisturbToggle(child));
    if (!toggle)
        return true;

    return suppressActor('toggle', toggle);
}

export function restoreBuiltinDndToggle() {
    if (!SHELL_HAS_SYSTEM_DND)
        return;

    restoreActor('toggle');
}

export function suppressBuiltinDndIndicator() {
    if (_suppressedActors.indicator)
        return true;

    const indicators = Main.panel.statusArea.quickSettings._indicators;
    const indicator = indicators.get_children().find(child => {
        const styleClass = child.style_class ?? '';
        if (styleClass.includes('kiwi-dnd-indicator'))
            return false;

        return actorContainsDndIcon(child) || styleClass.includes('dnd');
    });

    if (!indicator)
        return true;

    return suppressActor('indicator', indicator, { preserveVisibility: true });
}

export function restoreBuiltinDndIndicator() {
    restoreActor('indicator');
}

export function hideDateMenuIndicator() {
    const indicator = Main.panel.statusArea.dateMenu._indicator;

    if (!_dateMenuIndicatorState) {
        _dateMenuIndicatorState = {
            visible: indicator.visible,
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
    indicator.visible = _dateMenuIndicatorState.visible;

    _dateMenuIndicatorState = null;
}

function enforceDateMenuIndicatorHidden(indicator) {
    indicator.reactive = false;
    indicator.hide();
    indicator.opacity = 0;
}

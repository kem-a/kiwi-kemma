// SPDX-License-Identifier: GPL-3.0-or-later
// Kiwi Extension - Helpers for removing GNOME Shell's built-in DND UI that was added in GNOME 49
// This module removes system DND elements to avoid duplicate UI elements when Kiwi's own DND elements

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

const versionParts = String(Config.PACKAGE_VERSION ?? '0').split('.');
const majorVersion = Number.parseInt(versionParts[0], 10);
export const SHELL_HAS_SYSTEM_DND = Number.isFinite(majorVersion) && majorVersion >= 49;

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

let _dateMenuIndicator = null;
let _dateMenuIndicatorState = null;
let _dateMenuIndicatorSignals = null;

function matchesDndIconName(iconName) {
    if (!iconName)
        return false;

    return DND_ICON_NAMES.has(`${iconName}`.toLowerCase());
}

function actorContainsDndIcon(actor, depth = 0) {
    if (!actor || depth > 4)
        return false;

    const iconName = actor.icon_name ?? actor.get_icon_name?.();
    if (matchesDndIconName(iconName))
        return true;

    if (typeof actor.get_children === 'function') {
        const children = actor.get_children();
        if (children) {
            for (const child of children) {
                if (actorContainsDndIcon(child, depth + 1))
                    return true;
            }
        }
    }

    return false;
}

function resolveClutterActor(candidate) {
    if (!candidate)
        return null;

    if (candidate instanceof Clutter.Actor)
        return candidate;

    if (candidate.actor instanceof Clutter.Actor)
        return candidate.actor;

    if (candidate._actor instanceof Clutter.Actor)
        return candidate._actor;

    if (typeof candidate.get_actor === 'function') {
        const actor = candidate.get_actor();
        if (actor instanceof Clutter.Actor)
            return actor;
    }

    if (typeof candidate.get_child === 'function') {
        try {
            const child = candidate.get_child();
            if (child instanceof Clutter.Actor)
                return child;
        } catch (error) {
            // Ignore failures resolving nested actors
        }
    }

    return null;
}

function isDoNotDisturbToggle(actor) {
    if (!actor)
        return false;

    const accessibleName = actor.accessible_name?.toLowerCase?.() ?? '';
    if (accessibleName.includes('do not disturb'))
        return true;

    const title = actor.title ?? actor.get_title?.() ?? actor.text ?? '';
    const titleLower = title.toLowerCase?.() ?? `${title}`.toLowerCase();
    if (titleLower.includes('do not disturb'))
        return true;

    if (actorContainsDndIcon(actor))
        return true;

    const styleClass = actor.get_style_class_name?.() ?? actor.style_class ?? '';
    if (styleClass.includes('dnd') || styleClass.includes('do-not-disturb'))
        return true;

    const ctorName = actor.constructor?.name?.toLowerCase?.() ?? '';
    if (ctorName.includes('disturb'))
        return true;

    return false;
}

function isKiwiIndicator(actor) {
    if (!actor)
        return false;

    if (actor.has_style_class_name?.('kiwi-dnd-indicator'))
        return true;

    const styleClass = actor.get_style_class_name?.() ?? actor.style_class ?? '';
    return styleClass.includes('kiwi-dnd-indicator');
}

function suppressActor(key, actor, { preserveVisibility = false } = {}) {
    if (!actor || _suppressedActors[key])
        return false;

    const parent = actor.get_parent?.();
    if (!parent || typeof parent.get_children !== 'function')
        return false;

    const children = parent.get_children();
    const index = children.indexOf(actor);

    _suppressedActors[key] = {
        actor,
        parent,
        index,
        state: preserveVisibility ? {
            visible: actor.visible,
            reactive: actor.reactive,
            opacity: actor.opacity,
        } : null,
    };

    parent.remove_child(actor);
    actor.hide?.();
    actor.visible = false;

    return true;
}

function restoreActor(key, fallbackParent) {
    const suppressed = _suppressedActors[key];
    if (!suppressed)
        return false;

    let { actor, parent, index, state } = suppressed;
    if (!parent || typeof parent.get_children !== 'function')
        parent = fallbackParent?.() ?? null;

    if (parent) {
        const children = parent.get_children?.() ?? [];
        const insertIndex = index >= 0 ? Math.min(index, children.length) : children.length;
        if (typeof parent.insert_child_at_index === 'function')
            parent.insert_child_at_index(actor, insertIndex);
        else
            parent.add_child?.(actor);

        if (state) {
            if (state.reactive !== undefined)
                actor.reactive = state.reactive;
            if (state.opacity !== undefined && actor.opacity !== undefined)
                actor.opacity = state.opacity;
            if (state.visible)
                actor.show?.();
            else
                actor.hide?.();
            actor.visible = state.visible;
        } else {
            actor.show?.();
            actor.visible = true;
        }
    }

    _suppressedActors[key] = null;
    return true;
}

function getQuickSettingsGrid() {
    const quickSettings = Main.panel.statusArea.quickSettings;
    if (!quickSettings)
        return null;

    return quickSettings.menu?._grid ?? quickSettings._grid ?? null;
}

export function suppressBuiltinDndToggle() {
    if (!SHELL_HAS_SYSTEM_DND)
        return true;

    if (_suppressedActors.toggle)
        return true;

    const quickSettings = Main.panel.statusArea.quickSettings;
    const menu = quickSettings?.menu;
    if (!quickSettings || !menu)
        return false;

    let toggle = resolveClutterActor(menu._dndToggle ?? quickSettings._dndToggle);
    if (!toggle) {
        const grid = getQuickSettingsGrid();
        const candidates = grid?.get_children?.() ?? [];
        const match = candidates.find(child => isDoNotDisturbToggle(child)) ?? null;
        toggle = resolveClutterActor(match);
    }

    if (!toggle)
        return true;

    return suppressActor('toggle', toggle);
}

export function restoreBuiltinDndToggle() {
    if (!SHELL_HAS_SYSTEM_DND)
        return;

    restoreActor('toggle', () => getQuickSettingsGrid());
}

export function suppressBuiltinDndIndicator() {
    if (_suppressedActors.indicator)
        return true;

    const quickSettings = Main.panel.statusArea.quickSettings;
    if (!quickSettings)
        return false;

    const indicators = quickSettings._indicators;
    if (!indicators)
        return true;

    let indicator = resolveClutterActor(quickSettings._dndIndicator ?? quickSettings.menu?._dndIndicator);

    if (!indicator) {
        const children = indicators.get_children?.() ?? [];
        indicator = children.find(child => {
            if (!child || isKiwiIndicator(child))
                return false;

            if (actorContainsDndIcon(child))
                return true;

            const styleClass = child.get_style_class_name?.() ?? child.style_class ?? '';
            return styleClass.includes('dnd');
        }) ?? null;
    }

    if (!indicator)
        return true;

    return suppressActor('indicator', indicator, { preserveVisibility: true });
}

export function restoreBuiltinDndIndicator() {
    restoreActor('indicator', () => Main.panel.statusArea.quickSettings?._indicators ?? null);
}

function getDateMenuIndicator() {
    if (_dateMenuIndicator)
        return _dateMenuIndicator;

    const dateMenu = Main.panel.statusArea?.dateMenu;
    if (!dateMenu)
        return null;

    const indicator = dateMenu._indicator ?? null;
    if (indicator)
        _dateMenuIndicator = indicator;

    return _dateMenuIndicator;
}

export function hideDateMenuIndicator() {
    const indicator = getDateMenuIndicator();
    if (!indicator)
        return;

    if (!_dateMenuIndicatorState) {
        _dateMenuIndicatorState = {
            visible: indicator.visible,
            reactive: indicator.reactive,
            opacity: indicator.opacity,
        };
    }

    enforceDateMenuIndicatorHidden(indicator);

    if (!_dateMenuIndicatorSignals) {
        _dateMenuIndicatorSignals = [];
        _dateMenuIndicatorSignals.push(indicator.connect('notify::visible', () => enforceDateMenuIndicatorHidden(indicator)));
        _dateMenuIndicatorSignals.push(indicator.connect('notify::opacity', () => enforceDateMenuIndicatorHidden(indicator)));
        _dateMenuIndicatorSignals.push(indicator.connect('show', () => enforceDateMenuIndicatorHidden(indicator)));
    }
}

export function restoreDateMenuIndicator() {
    const indicator = getDateMenuIndicator();
    if (!indicator || !_dateMenuIndicatorState)
        return;

    if (_dateMenuIndicatorSignals) {
        for (const id of _dateMenuIndicatorSignals) {
            try {
                indicator.disconnect(id);
            } catch (error) {
                logError(error, '[kiwi] Failed to disconnect date menu indicator signal');
            }
        }
        _dateMenuIndicatorSignals = null;
    }

    if (_dateMenuIndicatorState.opacity !== undefined && indicator.opacity !== undefined)
        indicator.opacity = _dateMenuIndicatorState.opacity;

    indicator.reactive = _dateMenuIndicatorState.reactive ?? true;

    if (_dateMenuIndicatorState.visible) {
        if (indicator.show)
            indicator.show();
        indicator.visible = true;
    } else {
        if (indicator.hide)
            indicator.hide();
        indicator.visible = false;
    }

    _dateMenuIndicatorState = null;
    _dateMenuIndicator = null;
}

function enforceDateMenuIndicatorHidden(indicator) {
    if (!indicator)
        return;

    indicator.reactive = false;
    if (indicator.hide)
        indicator.hide();
    indicator.visible = false;
    if (indicator.opacity !== undefined)
        indicator.opacity = 0;
}


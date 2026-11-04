// SPDX-License-Identifier: GPL-3.0-or-later
// Keep left-side window controls and the title together, ahead of Global Menu.

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { ExtensionState } from 'resource:///org/gnome/shell/misc/extensionUtils.js';

const GLOBAL_MENU_UUID = 'global-menu@unmade.space';
const indicators = new Map();
let signals = [];
let syncIdleId = null;

function syncLayout() {
    const box = Main.panel._leftBox;
    const group = ['window-controls', 'window-title']
        .map(role => indicators.get(role)?.container)
        .filter(actor => actor?.get_parent() === box);
    if (!group.length)
        return;

    let anchor = null;
    if (Main.extensionManager.lookup(GLOBAL_MENU_UUID)?.state === ExtensionState.ACTIVE) {
        // Global Menu registers separate status-area buttons for its app name,
        // fallback menus and native/shortcut menus. Anchor before the first one,
        // including hidden buttons so changing apps does not change the order.
        const menuActors = new Set(Object.entries(Main.panel.statusArea)
            .filter(([role]) => role === GLOBAL_MENU_UUID || role.startsWith(`${GLOBAL_MENU_UUID}-`))
            .map(([, indicator]) => indicator.container));
        anchor = box.get_children().find(actor => menuActors.has(actor)) ?? null;
    }

    // Work backwards from the menu (or the end of the left box). Only move our
    // actors, and only when needed, so repeated notifications settle immediately.
    for (const actor of group.reverse()) {
        if (actor.get_next_sibling() !== anchor) {
            if (anchor)
                box.set_child_below_sibling(actor, anchor);
            else
                box.set_child_above_sibling(actor, null);
        }
        anchor = actor;
    }
}

function queueSync() {
    if (syncIdleId)
        return;

    // addToStatusArea parents the actor before recording its role. Wait until
    // registration and any menu rebuild have finished before looking it up.
    syncIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        syncIdleId = null;
        syncLayout();
        return GLib.SOURCE_REMOVE;
    });
}

export function registerIndicator(role, indicator) {
    indicators.set(role, indicator);
    if (!signals.length) {
        const box = Main.panel._leftBox;
        signals = [
            [box, box.connect('child-added', queueSync)],
            [box, box.connect('child-removed', queueSync)],
            [Main.extensionManager, Main.extensionManager.connect('extension-state-changed',
                (_manager, extension) => {
                    if (extension.uuid === GLOBAL_MENU_UUID)
                        queueSync();
                })],
        ];
    }
    syncLayout();
}

export function unregisterIndicator(role) {
    indicators.delete(role);
    if (indicators.size) {
        queueSync();
        return;
    }

    for (const [object, id] of signals)
        object.disconnect(id);
    signals = [];
    if (syncIdleId) {
        GLib.Source.remove(syncIdleId);
        syncIdleId = null;
    }
}

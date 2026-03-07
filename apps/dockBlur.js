// SPDX-License-Identifier: GPL-3.0-or-later
// Adds a blur effect behind Dash-to-Dock / Ubuntu Dock background.
// Approach based on blur-my-shell: insert blur inside the dock's own actor tree,
// sized to the dash-background pill, with a custom Clutter.Effect for repaint.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';

let dockSearchId = null;
let dashes = []; // array of per-dash state objects

// Custom Clutter.Effect that emits a signal on every vfunc_paint, used
// to force the blur effect to repaint (workaround for GNOME Shell #2857)
const RepaintSignalEffect = GObject.registerClass({
    GTypeName: 'KiwiRepaintSignalEffect',
    Signals: { 'repaint': {} },
}, class RepaintSignalEffect extends Clutter.Effect {
    vfunc_paint(node, paintContext, paintFlags) {
        this.emit('repaint');
        super.vfunc_paint(node, paintContext, paintFlags);
    }
});

function _findDockContainers() {
    // Dash-to-Dock adds containers with name 'dashtodockContainer' to Main.uiGroup
    return Main.uiGroup.get_children().filter(child =>
        child.name === 'dashtodockContainer'
    );
}

function _tryBlurDock(dockContainer) {
    // Navigate into the dock actor tree:
    // dashtodockContainer → _slider → child (dashtodockBox) → dash
    const slider = dockContainer._slider;
    if (!slider) return;
    const dashBox = slider.get_child();
    if (!dashBox) return;

    // Find the 'dash' actor
    const dash = dashBox.get_children().find(c => c.name === 'dash');
    if (!dash) return;

    // Check if we already blurred this dash
    if (dashBox.get_children().some(c => c.name === 'kiwi-dock-blur-group'))
        return;

    // Find the dash-background (the translucent pill)
    const dashBackground = dash.get_children().find(c =>
        c.get_style_class_name?.()?.includes('dash-background')
    );
    if (!dashBackground) return;

    // Create blur infrastructure
    const backgroundGroup = new Meta.BackgroundGroup({
        name: 'kiwi-dock-blur-group',
        width: 0,
        height: 0,
    });

    const blurWidget = new St.Widget({ name: 'kiwi-dock-blur' });

    const blurEffect = new Shell.BlurEffect({
        mode: Shell.BlurMode.BACKGROUND,
        radius: 30,
        brightness: 1.0,
    });
    blurWidget.add_effect(blurEffect);
    backgroundGroup.insert_child_at_index(blurWidget, 0);

    // Border overlay matching the dash-background pill shape
    const themeNode = dashBackground.get_theme_node();
    const borderRadius = themeNode
        ? themeNode.get_border_radius(St.Corner.TOPLEFT)
        : 14;
    const borderWidget = new St.Widget({
        name: 'kiwi-dock-blur-border',
        style: `border: 1px solid rgba(255, 255, 255, 0.2); border-radius: ${borderRadius}px;`,
    });
    backgroundGroup.add_child(borderWidget);

    // Insert at index 0 of dashBox (behind the dash content)
    dashBox.insert_child_at_index(backgroundGroup, 0);

    // Repaint signal effect — attached to the blur widget itself,
    // triggers queue_repaint on the blur effect every paint cycle
    const repaintEffect = new RepaintSignalEffect();
    const repaintId = repaintEffect.connect('repaint', () => {
        try { blurEffect.queue_repaint(); } catch (_) {}
    });
    blurWidget.add_effect(repaintEffect);

    // Size and position the blur and border widgets to match the dash-background
    const updateSize = () => {
        if (!blurWidget || !dashBackground) return;
        const w = dashBackground.width;
        const h = dashBackground.height;
        const x = dashBackground.x;
        const y = dashBackground.y + dash.y;
        blurWidget.set_size(w, h);
        blurWidget.set_position(x, y);
        borderWidget.set_size(w, h);
        borderWidget.set_position(x, y);
    };
    updateSize();

    const signals = [];
    signals.push({ actor: dash, id: dash.connect('notify::width', updateSize) });
    signals.push({ actor: dash, id: dash.connect('notify::height', updateSize) });
    signals.push({ actor: dash, id: dash.connect('notify::y', updateSize) });
    signals.push({ actor: dash, id: dash.connect('notify::x', updateSize) });
    signals.push({ actor: dashBackground, id: dashBackground.connect('notify::width', updateSize) });
    signals.push({ actor: dashBackground, id: dashBackground.connect('notify::height', updateSize) });
    signals.push({ actor: dashBackground, id: dashBackground.connect('notify::x', updateSize) });
    signals.push({ actor: dashBackground, id: dashBackground.connect('notify::y', updateSize) });
    signals.push({ actor: dockContainer, id: dockContainer.connect('notify::width', updateSize) });
    signals.push({ actor: dockContainer, id: dockContainer.connect('notify::height', updateSize) });

    const info = {
        dockContainer,
        dashBox,
        dash,
        dashBackground,
        backgroundGroup,
        blurWidget,
        blurEffect,
        repaintEffect,
        repaintId,
        signals,
        destroyId: null,
    };

    // Auto-cleanup if the dash is destroyed (user disables dock extension)
    info.destroyId = dash.connect('destroy', () => _removeDashBlur(info, false));

    dashes.push(info);
}

function _removeDashBlur(info, disconnectDestroy = true) {
    // Disconnect size signals
    for (const { actor, id } of info.signals) {
        try { actor.disconnect(id); } catch (_) {}
    }
    info.signals = [];

    if (disconnectDestroy && info.destroyId && info.dash) {
        try { info.dash.disconnect(info.destroyId); } catch (_) {}
    }
    info.destroyId = null;

    // Disconnect repaint signal
    if (info.repaintEffect && info.repaintId) {
        try { info.repaintEffect.disconnect(info.repaintId); } catch (_) {}
    }

    // Remove blur group from dock tree
    if (info.backgroundGroup && info.dashBox) {
        try { info.dashBox.remove_child(info.backgroundGroup); } catch (_) {}
    }
    if (info.backgroundGroup) {
        info.backgroundGroup.destroy_all_children();
        info.backgroundGroup.destroy();
    }
    info.backgroundGroup = null;
    info.blurWidget = null;
    info.blurEffect = null;
    info.repaintEffect = null;

    // Remove from dashes array
    const idx = dashes.indexOf(info);
    if (idx >= 0) dashes.splice(idx, 1);
}

function _blurExistingDocks() {
    _findDockContainers().forEach(container => _tryBlurDock(container));
}

function _removeAllBlurs() {
    // Copy array since _removeDashBlur mutates it
    [...dashes].forEach(info => _removeDashBlur(info));
}

let childAddedId = null;

export function enable() {
    // Watch for new dock containers being added (e.g., dock enabled after us)
    childAddedId = Main.uiGroup.connect('child-added', (_group, actor) => {
        if (actor.name === 'dashtodockContainer')
            _tryBlurDock(actor);
    });

    // Blur any already-existing docks
    _blurExistingDocks();

    // If no docks found yet, retry a few times (dock may load after us)
    if (dashes.length === 0) {
        let attempts = 0;
        dockSearchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            attempts++;
            _blurExistingDocks();
            if (dashes.length > 0 || attempts >= 10) {
                dockSearchId = null;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }
}

export function disable() {
    if (dockSearchId) {
        GLib.source_remove(dockSearchId);
        dockSearchId = null;
    }

    if (childAddedId) {
        Main.uiGroup.disconnect(childAddedId);
        childAddedId = null;
    }

    _removeAllBlurs();
}

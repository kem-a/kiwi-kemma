// SPDX-License-Identifier: GPL-3.0-or-later
// Dash-to-Dock icon styling: tighter spacing and no highlight behind the icons
// (those rules live in stylesheet.css behind the .kiwi-dock-styled class), plus
// a darken effect on the icon while it is pressed and name tooltips that follow
// the session's light or dark scheme.

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const STYLE_CLASS = 'kiwi-dock-styled';
const LABEL_CLASS = 'kiwi-dock-label';
const DARK_CLASS = 'dark';
const EFFECT_NAME = 'kiwi-press-darken';
const PRESS_BRIGHTNESS = -0.60;

let childAddedId = null;
let colorSchemeId = null;
let boxSignals = []; // [[dash._box, signal id]]

function _dockContainers() {
    return Main.uiGroup.get_children().filter(child =>
        child.name === 'dashtodockContainer'
    );
}

// dashtodockContainer → _slider → child (dashtodockBox) → dash → _box
function _dashBox(container) {
    const dashBox = container._slider?.get_child();
    const dash = dashBox?.get_children().find(c => c.name === 'dash');
    return dash?._box ?? null;
}

function _prefersDark() {
    return St.Settings.get().colorScheme === St.SystemColorScheme.PREFER_DARK;
}

/** Every tooltip on screen. A DashItemContainer hands its label to the shell's
 *  chrome rather than keeping it, so they all sit here side by side - the app
 *  icons', show-apps', and the ones on the items kiwi puts in the dock: the
 *  downloads stack, the minimized windows, the trash.
 */
function _dashLabels() {
    return Main.uiGroup.get_children().filter(child =>
        child.has_style_class_name?.('dash-label')
    );
}

function _syncLabel(label) {
    label.add_style_class_name(LABEL_CLASS);
    if (_prefersDark())
        label.add_style_class_name(DARK_CLASS);
    else
        label.remove_style_class_name(DARK_CLASS);
}

function _syncAllLabels() {
    _dashLabels().forEach(_syncLabel);
}

function _syncDarken(button) {
    if (button.pressed) {
        const effect = new Clutter.BrightnessContrastEffect({ name: EFFECT_NAME });
        effect.set_brightness(PRESS_BRIGHTNESS);
        button.add_effect(effect);
    } else {
        button.remove_effect_by_name(EFFECT_NAME);
    }
}

function _wireItem(item) {
    const button = item.child;
    if (!(button instanceof St.Button) || button._kiwiPressId)
        return;
    button._kiwiPressId = button.connect('notify::pressed', () => _syncDarken(button));
}

function _unwireItem(item) {
    const button = item.child;
    if (!button?._kiwiPressId)
        return;
    button.disconnect(button._kiwiPressId);
    button._kiwiPressId = 0;
    button.remove_effect_by_name(EFFECT_NAME);
}

function _applyDock(container) {
    container.add_style_class_name(STYLE_CLASS);

    const box = _dashBox(container);
    if (!box)
        return;

    box.get_children().forEach(_wireItem);
    // Dash-to-Dock rebuilds its items on every redisplay
    boxSignals.push([box, box.connect('child-added', (_box, item) => _wireItem(item))]);
}

export function enable() {
    // Settings changes re-run the whole apply pass; don't stack signals
    if (childAddedId)
        return;

    // A dock created after us (extension enabled later, monitor added), and the
    // tooltip of every item that joins the dock from here on
    childAddedId = Main.uiGroup.connect('child-added', (_group, actor) => {
        if (actor.name === 'dashtodockContainer')
            _applyDock(actor);
        else if (actor.has_style_class_name?.('dash-label'))
            _syncLabel(actor);
    });

    colorSchemeId = St.Settings.get().connect('notify::color-scheme', _syncAllLabels);

    _dockContainers().forEach(_applyDock);
    _syncAllLabels();
}

export function disable() {
    if (childAddedId) {
        Main.uiGroup.disconnect(childAddedId);
        childAddedId = null;
    }

    if (colorSchemeId) {
        St.Settings.get().disconnect(colorSchemeId);
        colorSchemeId = null;
    }

    for (const [box, id] of boxSignals) {
        // A dock torn down since (monitor removed, Dash-to-Dock disabled) is gone
        try { box.disconnect(id); } catch (_) {}
    }
    boxSignals = [];

    for (const label of _dashLabels()) {
        label.remove_style_class_name(LABEL_CLASS);
        label.remove_style_class_name(DARK_CLASS);
    }

    for (const container of _dockContainers()) {
        container.remove_style_class_name(STYLE_CLASS);
        _dashBox(container)?.get_children().forEach(_unwireItem);
    }
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Leaving the overview focuses the window under the pointer instead of the
// previously focused one, like macOS Mission Control.

import Clutter from 'gi://Clutter';

import { InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { ControlsManager } from 'resource:///org/gnome/shell/ui/overviewControls.js';

let _injectionManager = null;
let _overviewShowingId = 0;
let _overviewHidingId = 0;
let _stageEventId = 0;
let _hoveredWindow = null;

// The pointer lands on a child of a preview (the clone, the icon, the caption),
// so walk up until an ancestor names the window it stands for.
function _windowForActor(actor) {
    for (let a = actor; a; a = a.get_parent()) {
        if (a.metaWindow)
            return a.metaWindow;
    }
    return null;
}

function _onStageEvent(stage, event) {
    const type = event.type();
    if (type !== Clutter.EventType.MOTION && type !== Clutter.EventType.ENTER)
        return Clutter.EVENT_PROPAGATE;

    const window = _windowForActor(stage.get_event_actor(event));
    if (window === _hoveredWindow)
        return Clutter.EVENT_PROPAGATE;

    _hoveredWindow = window;
    // Raising here keeps the preview that should lead the exit animation on top
    if (window)
        window.raise();

    return Clutter.EVENT_PROPAGATE;
}

function _focusHoveredWindow() {
    const window = _hoveredWindow;
    _hoveredWindow = null;
    if (!window)
        return;

    try {
        window.activate(global.get_current_time());
    } catch (e) {
        console.error(`Kiwi: could not focus the window under the cursor: ${e.message}`);
    }
}

function _startHoverTracking() {
    if (!_stageEventId)
        _stageEventId = global.stage.connect('captured-event', _onStageEvent);
}

function _stopHoverTracking() {
    if (_stageEventId) {
        global.stage.disconnect(_stageEventId);
        _stageEventId = 0;
    }
    _hoveredWindow = null;
}

export function enable() {
    if (_injectionManager)
        return;

    _injectionManager = new InjectionManager();
    // Focus has to be committed before the exit animation starts. Activating on
    // 'hiding'/'hidden' lets the shell refocus the old window and flip mid-flight.
    _injectionManager.overrideMethod(ControlsManager.prototype, 'prepareToLeaveOverview',
        original => function (...args) {
            const result = original.apply(this, args);
            _focusHoveredWindow();
            return result;
        });

    _overviewShowingId = Main.overview.connect('showing', _startHoverTracking);
    _overviewHidingId = Main.overview.connect('hiding', _stopHoverTracking);

    if (Main.overview.visible)
        _startHoverTracking();
}

export function disable() {
    _stopHoverTracking();

    if (_overviewShowingId) {
        Main.overview.disconnect(_overviewShowingId);
        _overviewShowingId = 0;
    }
    if (_overviewHidingId) {
        Main.overview.disconnect(_overviewHidingId);
        _overviewHidingId = 0;
    }

    if (_injectionManager) {
        _injectionManager.clear();
        _injectionManager = null;
    }
}

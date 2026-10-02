// SPDX-License-Identifier: GPL-3.0-or-later
// Reveals the top panel on fullscreen hover with fine-grained animation control.

// DONT remove _ghostMenu hack - it is needed to keep panel visible for GTK4 apps

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

// Animation and trigger constants
const ANIM_IN_MS = 300;
const ANIM_OUT_MS = 300;
const TRIGGER_EDGE_PX = 1; // pixels from top edge. Set it to 1px (default: 16) to reveal GTK4 app built in
// fullscreen headerbar like gnome text editor. Feels bugged so... 
// There is a hacky workaround to draw a tiny popup menu to force top panel stay visible (line 190+)
const HIDE_DELAY_MS = 300; // delay before hiding after leaving/closing

let fullscreenWindows = new Set();
let windowSignals = new Map();
let windowCreatedHandler = null;
let workspaceChangedHandler = null;
let overviewShowingHandler = null;
let overviewHiddenHandler = null;
let wsHasFullscreen = false;
let hotCorner = null;
let _enabled = false;
let _hideTimeoutId = null;
let _panelRevealed = false;
let _animating = false;
let _panelBoxEnterId = null;
let _panelBoxLeaveId = null;
let _panelBoxButtonReleaseId = null;
let _stageButtonReleaseId = null;
let _periodCheckId = null;
let _recomputeIdleId = null;
let _ghostMenu = null;
let _originalTrackFullscreen = null;

function _getPanelBox() {
    return Main.layoutManager.panelBox;
}

function _getPanelHeight() {
    return Main.panel.height || 40;
}

function _cancelPanelTransitions() {
    _getPanelBox().remove_all_transitions();
}

function _isMenuOpen() {
    return Object.values(Main.panel.statusArea).some(indicator => indicator?.menu?.isOpen);
}

function _cancelHideTimeout() {
    if (_hideTimeoutId) {
        GLib.Source.remove(_hideTimeoutId);
        _hideTimeoutId = null;
    }
}

function _cancelPeriodicCheck() {
    if (_periodCheckId) {
        GLib.Source.remove(_periodCheckId);
        _periodCheckId = null;
    }
}

function _startPeriodicCheck() {
    _cancelPeriodicCheck();
    _periodCheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        if (!_enabled || !wsHasFullscreen) {
            _periodCheckId = null;
            return GLib.SOURCE_REMOVE;
        }
        
        // Only hide if no menu is open AND pointer is away from panel area
        if (!_isMenuOpen() && _panelRevealed) {
            const [, mouseY] = global.get_pointer();
            const panelHeight = _getPanelHeight();
            // Give more tolerance - only hide if pointer is well below panel
            if (mouseY > panelHeight + 50) {
                _hidePanelAnimated();
                _periodCheckId = null;
                return GLib.SOURCE_REMOVE;
            }
        }
        
        return GLib.SOURCE_CONTINUE;
    });
}

function _scheduleHideAfterDelay(force = false) {
    if (!wsHasFullscreen) return;
    _cancelHideTimeout();
    _hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY_MS, () => {
        _hideTimeoutId = null;
        if (!_enabled) return GLib.SOURCE_REMOVE;
        if (force) {
            _hidePanelAnimated();
        } else {
            const [, mouseY] = global.get_pointer();
            const panelHeight = _getPanelHeight();
            if (mouseY > panelHeight + 4)
                _hidePanelAnimated();
        }
        return GLib.SOURCE_REMOVE;
    });
}

function _showPanelAnimated() {
    if (!_enabled) return;
    if (_panelRevealed || _animating) return; // Prevent jitter
    const panelBox = _getPanelBox();
    _cancelPanelTransitions();
    const h = _getPanelHeight();
    panelBox.translation_y = -h;
    _setPanelAutoHide(false);
    _animating = true;
    _panelRevealed = true;
    _startPeriodicCheck(); // Start watching for when to hide
    panelBox.ease({
        translation_y: 0,
        duration: ANIM_IN_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
            _animating = false;
            _openGhostMenu();
        },
    });
}

function _hidePanelAnimated() {
    if (!_enabled) return;
    if (!_panelRevealed || _animating) return; // Prevent jitter
    const panelBox = _getPanelBox();
    _cancelPanelTransitions();
    _cancelPeriodicCheck(); // Stop periodic checking
    _animating = true;
    _closeGhostMenu();
    panelBox.ease({
        translation_y: -_getPanelHeight(),
        duration: ANIM_OUT_MS,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onComplete: () => {
            _animating = false;
            _panelRevealed = false;
            _setPanelAutoHide(true);
            panelBox.translation_y = 0;
        },
    });
}

function _openGhostMenu() {
    if (_ghostMenu) return;
    // Anchor far off-screen so it doesn't interfere with hover/clicks
    // but still registers as an "open menu" with panel menu manager
    let anchor = new St.Widget({ 
        width: 1, 
        height: 1, 
        opacity: 0,
        reactive: false  // Don't intercept any input events
    });
    // Position off-screen to the right
    anchor.set_position(global.stage.width + 100, 0);
    Main.uiGroup.add_child(anchor);
    _ghostMenu = new PopupMenu.PopupMenu(anchor, 0.5, St.Side.TOP);
    // Register with panel menu manager so Shell treats it as an open menu
    Main.panel.menuManager.addMenu(_ghostMenu);
    _ghostMenu.actor.opacity = 0;
    _ghostMenu.actor.reactive = false;
    Main.uiGroup.add_child(_ghostMenu.actor);
    _ghostMenu.open();
    _ghostMenu._ghostAnchor = anchor;
}

function _closeGhostMenu() {
    if (_ghostMenu) {
        _ghostMenu.close();
        Main.panel.menuManager.removeMenu(_ghostMenu);
        if (_ghostMenu.actor.get_parent())
            _ghostMenu.actor.get_parent().remove_child(_ghostMenu.actor);
        if (_ghostMenu._ghostAnchor && _ghostMenu._ghostAnchor.get_parent())
            _ghostMenu._ghostAnchor.get_parent().remove_child(_ghostMenu._ghostAnchor);
        _ghostMenu = null;
    }
}

// Instead of manipulating panel translation, we work with GNOME Shell's
// built-in panel visibility system by temporarily modifying trackFullscreen
function _setPanelAutoHide(enable) {
    if (!_enabled) return;

    const lm = Main.layoutManager;
    const panelBox = lm.panelBox;
    const record = lm._trackedActors.find(a => a.actor === panelBox);
    if (!record) return;

    // Store original value on first use
    if (_originalTrackFullscreen === null) {
        _originalTrackFullscreen = record.trackFullscreen;
    }

    if (enable) {
        // Enable auto-hide: let GNOME Shell hide panel in fullscreen
        record.trackFullscreen = true;
    } else {
        // Disable auto-hide: keep panel visible even in fullscreen
        record.trackFullscreen = false;
        // Force panel to be visible
        panelBox.visible = true;
    }

    // Trigger visibility update
    lm._updateVisibility();
}

function _createHoverArea() {
    // Get primary monitor geometry for proper positioning
    let primaryMonitor = global.display.get_primary_monitor();
    let geometry = global.display.get_monitor_geometry(primaryMonitor);
    
    const hoverArea = new Clutter.Actor({
        name: 'panel-hover-area',
        reactive: true,
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: TRIGGER_EDGE_PX, // Small hover area at top of screen
        opacity: 0,
    });

    // No Meta.Barrier needed - the Clutter.Actor hover area is sufficient
    // for detecting pointer entry. Barriers cause issues:
    // 1. Block vertical pointer movement across monitor bounds
    // 2. Create "sticky" pointer behavior due to hit box implementation
    // 3. Not needed since we want hover-based reveal, not pressure-based

    hoverArea.connect('enter-event', () => {
        if (wsHasFullscreen) {
            _showPanelAnimated();
        }
    });

    hoverArea.connect('leave-event', () => {
        if (wsHasFullscreen) {
            _scheduleHideAfterDelay();
        }
    });

    hoverArea.connect('destroy', () => {
        // Clear any pending timeout
        _cancelHideTimeout();
    });

    return hoverArea;
}

function _connectWindowSignals(window) {
    if (windowSignals.has(window))
        return;

    let fullscreenId = window.connect('notify::fullscreen', () => {
        _recomputeFullscreenState();
    });

    let unmanagedId = window.connect('unmanaged', () => {
        _disconnectWindowSignals(window);
    });

    windowSignals.set(window, {
        fullscreen: fullscreenId,
        unmanaged: unmanagedId,
    });

    if (window.is_fullscreen())
        _recomputeFullscreenState();
}

function _disconnectWindowSignals(window) {
    if (!windowSignals.has(window))
        return;

    let signalIds = windowSignals.get(window);
    window.disconnect(signalIds.fullscreen);
    window.disconnect(signalIds.unmanaged);
    windowSignals.delete(window);

    if (fullscreenWindows.has(window)) {
        fullscreenWindows.delete(window);
        _recomputeFullscreenState();
    }
}

function _onWindowCreated(display, window) {
    _connectWindowSignals(window);
}

function _recomputeFullscreenState() {
    if (!_enabled) return;

    fullscreenWindows.clear();
    for (const w of global.workspace_manager.get_active_workspace().list_windows()) {
        if (w.is_fullscreen())
            fullscreenWindows.add(w);
    }

    wsHasFullscreen = fullscreenWindows.size > 0;

    // Update panel behavior based on fullscreen state and overview visibility
    // Track idle source so it can be cancelled on disable
    if (_recomputeIdleId) {
        GLib.Source.remove(_recomputeIdleId);
        _recomputeIdleId = null;
    }
    _recomputeIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        if (!_enabled) { _recomputeIdleId = null; return GLib.SOURCE_REMOVE; }

        _panelRevealed = false;
        _animating = false;
        // Auto-hide behind the hover area only in fullscreen outside the overview
        if (!Main.overview.visible && wsHasFullscreen) {
            _setPanelAutoHide(true);
            hotCorner.show();
        } else {
            _setPanelAutoHide(false);
            hotCorner.hide();
        }
        _recomputeIdleId = null;
        return GLib.SOURCE_REMOVE;
    });
}

function _onWorkspaceChanged() {
    _recomputeFullscreenState();
}

function _onOverviewShowing() {
    if (!_enabled) return;
    // In overview, always show panel
    _setPanelAutoHide(false);
    hotCorner.hide();
}

function _onOverviewHidden() {
    if (!_enabled) return;
    // When overview hides, recompute fullscreen state
    _recomputeFullscreenState();
}

export function enable() {
    // extension.js re-runs this on any settings change, and the reset below is a
    // full teardown: dropping the chrome recomputes the input region and every
    // window on the system gets re-connected. Only pay that when not already up.
    if (_enabled)
        return;
    disable(); // Clean reset
    _enabled = true;
    _originalTrackFullscreen = null; // Reset for fresh start
    
    hotCorner = _createHoverArea();
    Main.layoutManager.addChrome(hotCorner, {
        trackFullscreen: false, // We manage visibility ourselves
        affectsStruts: false,
    });

    // Connect to existing windows
    global.get_window_actors().forEach(actor => {
        let window = actor.meta_window;
        _connectWindowSignals(window);
    });

    // Connect to events
    windowCreatedHandler = global.display.connect('window-created', _onWindowCreated);
    workspaceChangedHandler = global.workspace_manager.connect('active-workspace-changed', _onWorkspaceChanged);
    overviewShowingHandler = Main.overview.connect('showing', _onOverviewShowing);
    overviewHiddenHandler = Main.overview.connect('hidden', _onOverviewHidden);

    // Hide when leaving panel area in fullscreen
    const panelBox = _getPanelBox();
    _panelBoxEnterId = panelBox.connect('enter-event', () => {
        _cancelHideTimeout();
    });
    _panelBoxLeaveId = panelBox.connect('leave-event', () => {
        if (wsHasFullscreen)
            _scheduleHideAfterDelay();
    });
    // If a panel button was clicked but doesn't open a menu, hide after release
    _panelBoxButtonReleaseId = panelBox.connect('button-release-event', () => {
        if (wsHasFullscreen)
            _scheduleHideAfterDelay(true);
    });

    // Global stage capture to detect clicks outside panel
    _stageButtonReleaseId = global.stage.connect('button-release-event', (stage, event) => {
        if (!wsHasFullscreen || !_panelRevealed) return Clutter.EVENT_PROPAGATE;

        // Check if any menu is actually open before hiding
        if (_isMenuOpen()) return Clutter.EVENT_PROPAGATE;

        const [, stageY] = event.get_coords();
        const panelHeight = _getPanelHeight();

        // If click is well below panel area, schedule hide
        if (stageY > panelHeight + 20) {
            _scheduleHideAfterDelay(true);
        }

        return Clutter.EVENT_PROPAGATE;
    });

    _recomputeFullscreenState();
}

export function disable() {
    _enabled = false;

    // Clear any pending timeout
    _cancelHideTimeout();
    _cancelPeriodicCheck();
    _closeGhostMenu();
    if (_recomputeIdleId) {
        GLib.Source.remove(_recomputeIdleId);
        _recomputeIdleId = null;
    }

    // Destroy hover area
    if (hotCorner) {
        hotCorner.destroy();
        hotCorner = null;
    }

    // Disconnect event handlers
    if (windowCreatedHandler) {
        global.display.disconnect(windowCreatedHandler);
        windowCreatedHandler = null;
    }
    if (workspaceChangedHandler) {
        global.workspace_manager.disconnect(workspaceChangedHandler);
        workspaceChangedHandler = null;
    }
    if (overviewShowingHandler) {
        Main.overview.disconnect(overviewShowingHandler);
        overviewShowingHandler = null;
    }
    if (overviewHiddenHandler) {
        Main.overview.disconnect(overviewHiddenHandler);
        overviewHiddenHandler = null;
    }
    // Disconnect panel box signals
    const panelBox = _getPanelBox();
    if (_panelBoxEnterId) { panelBox.disconnect(_panelBoxEnterId); _panelBoxEnterId = null; }
    if (_panelBoxLeaveId) { panelBox.disconnect(_panelBoxLeaveId); _panelBoxLeaveId = null; }
    if (_panelBoxButtonReleaseId) { panelBox.disconnect(_panelBoxButtonReleaseId); _panelBoxButtonReleaseId = null; }
    
    // Disconnect stage capture
    if (_stageButtonReleaseId) {
        global.stage.disconnect(_stageButtonReleaseId);
        _stageButtonReleaseId = null;
    }

    // Disconnect window signals
    windowSignals.forEach((signalIds, window) => {
        window.disconnect(signalIds.fullscreen);
        window.disconnect(signalIds.unmanaged);
    });
    
    windowSignals.clear();
    fullscreenWindows.clear();
    wsHasFullscreen = false;
    _panelRevealed = false;
    _animating = false;

    // Restore panel to its original state - this must be done BEFORE setting _enabled to false
    // but we already set it to false above, so we need to do manual restoration
    _cancelPanelTransitions();
    panelBox.translation_y = 0;
    panelBox.visible = true;

    // Restore trackFullscreen to its original value, or default to true if not stored
    const lm = Main.layoutManager;
    const record = lm._trackedActors.find(a => a.actor === panelBox);
    if (record)
        record.trackFullscreen = _originalTrackFullscreen ?? true;
    lm._updateVisibility();

    // Reset stored values
    _originalTrackFullscreen = null;
}
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
let activeWorkspaceHasFullscreen = false;
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

function _debug(msg) {
    try { log(`[PanelHover] ${msg}`); } catch (_) {}
}

function _getPanelBox() {
    return Main.layoutManager?.panelBox ?? null;
}

function _getPanelHeight() {
    return Main.panel?.height || 40;
}

function _cancelPanelTransitions() {
    try { _getPanelBox()?.remove_all_transitions?.(); } catch (_) {}
}

function _cancelHideTimeout() {
    if (_hideTimeoutId) {
        try { GLib.Source.remove(_hideTimeoutId); } catch (_) {}
        _hideTimeoutId = null;
    }
}

function _cancelPeriodicCheck() {
    if (_periodCheckId) {
        try { GLib.Source.remove(_periodCheckId); } catch (_) {}
        _periodCheckId = null;
    }
}

function _startPeriodicCheck() {
    _cancelPeriodicCheck();
    _periodCheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        if (!_enabled || !activeWorkspaceHasFullscreen) {
            _periodCheckId = null;
            return GLib.SOURCE_REMOVE;
        }
        
        // Check if any menu is actually open (more thorough check)
        let menuActuallyOpen = false;
        try {
            if (Main.panel?.menuManager) {
                // Check if menuManager reports any menu as open
                if (Main.panel.menuManager._activeMenu) {
                    menuActuallyOpen = true;
                }
                // Also check for any visible popups in the status area
                const statusArea = Main.panel.statusArea;
                if (statusArea) {
                    for (const indicator of Object.values(statusArea)) {
                        if (indicator?.menu?.isOpen) {
                            menuActuallyOpen = true;
                            break;
                        }
                    }
                }
            }
        } catch (_) {}
        
        // Only hide if no menu is open AND pointer is away from panel area
        if (!menuActuallyOpen && _panelRevealed) {
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
    if (!activeWorkspaceHasFullscreen) return;
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
    if (!panelBox) return;
    _cancelPanelTransitions();
    const h = _getPanelHeight();
    panelBox.translation_y = -h;
    _setPanelAutoHide(false);
    _animating = true;
    _panelRevealed = true;
    _startPeriodicCheck(); // Start watching for when to hide
    try {
        panelBox.ease?.({
            translation_y: 0,
            duration: ANIM_IN_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                _animating = false;
                _openGhostMenu();
            },
        });
    } catch (_) {
        panelBox.translation_y = 0;
        _animating = false;
        _openGhostMenu();
    }
}

function _hidePanelAnimated() {
    if (!_enabled) return;
    if (!_panelRevealed || _animating) return; // Prevent jitter
    const panelBox = _getPanelBox();
    if (!panelBox) return;
    _cancelPanelTransitions();
    _cancelPeriodicCheck(); // Stop periodic checking
    _animating = true;
    _closeGhostMenu();
    try {
        panelBox.ease?.({
            translation_y: -_getPanelHeight(),
            duration: ANIM_OUT_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                _animating = false;
                _panelRevealed = false;
                _setPanelAutoHide(true);
                try { panelBox.translation_y = 0; } catch (_) {}
            },
        });
    } catch (_) {
        _setPanelAutoHide(true);
        try { panelBox.translation_y = 0; } catch (_) {}
        _animating = false;
        _panelRevealed = false;
    }
}

function _openGhostMenu() {
    if (_ghostMenu) return;
    try {
        const panelBox = _getPanelBox();
        if (!panelBox) return;
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
    try { Main.panel?.menuManager?.addMenu?.(_ghostMenu); } catch (_) {}
    _ghostMenu.actor.opacity = 0;
    _ghostMenu.actor.reactive = false;
    Main.uiGroup.add_child(_ghostMenu.actor);
    _ghostMenu.open();
    _ghostMenu._ghostAnchor = anchor;
    } catch (e) { _debug('Failed to open ghost menu: ' + e); }
}

function _closeGhostMenu() {
    if (_ghostMenu) {
        try {
            _ghostMenu.close();
            try { Main.panel?.menuManager?.removeMenu?.(_ghostMenu); } catch (_) {}
            if (_ghostMenu.actor.get_parent())
                _ghostMenu.actor.get_parent().remove_child(_ghostMenu.actor);
            if (_ghostMenu._ghostAnchor && _ghostMenu._ghostAnchor.get_parent())
                _ghostMenu._ghostAnchor.get_parent().remove_child(_ghostMenu._ghostAnchor);
        } catch (_) {}
        _ghostMenu = null;
    }
}

// Instead of manipulating panel translation, we work with GNOME Shell's
// built-in panel visibility system by temporarily modifying trackFullscreen
function _setPanelAutoHide(enable) {
    if (!_enabled) return;
    
    try {
        const lm = Main.layoutManager;
        const panelBox = lm?.panelBox;
        if (!lm || !panelBox) return;
        
        const tracked = lm._trackedActors;
        if (!Array.isArray(tracked)) return;
        
        const record = tracked.find(a => a && a.actor === panelBox);
        if (!record || typeof record.trackFullscreen !== 'boolean') return;

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
        lm._updateVisibility?.();
    } catch (e) {
        _debug(`setPanelAutoHide error: ${e}`);
    }
}

function _createHoverArea() {
    if (!_enabled) return null;
    
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
        if (activeWorkspaceHasFullscreen) {
            _showPanelAnimated();
        }
    });

    hoverArea.connect('leave-event', () => {
        if (activeWorkspaceHasFullscreen) {
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
        _onWindowFullscreenChanged(window);
    });

    let unmanagedId = window.connect('unmanaged', () => {
        _disconnectWindowSignals(window);
    });

    windowSignals.set(window, {
        fullscreen: fullscreenId,
        unmanaged: unmanagedId,
    });

    if (window.is_fullscreen())
        _onWindowFullscreenChanged(window);
}

function _disconnectWindowSignals(window) {
    if (!windowSignals.has(window))
        return;

    let signalIds = windowSignals.get(window);
    try { window.disconnect(signalIds.fullscreen); } catch (_) {}
    try { window.disconnect(signalIds.unmanaged); } catch (_) {}
    windowSignals.delete(window);

    if (fullscreenWindows.has(window)) {
        fullscreenWindows.delete(window);
        _recomputeFullscreenState();
    }
}

function _onWindowCreated(display, window) {
    if (!window) return;
    _connectWindowSignals(window);
}

function _onWindowFullscreenChanged(window) {
    if (window.is_fullscreen()) {
        fullscreenWindows.add(window);
        _recomputeFullscreenState();
    } else {
        fullscreenWindows.delete(window);
        _recomputeFullscreenState();
    }
}

function _recomputeFullscreenState() {
    if (!_enabled) return;
    
    fullscreenWindows.clear();
    try {
        const ws = global.workspace_manager.get_active_workspace();
        const windows = ws?.list_windows?.() || [];
        for (const w of windows) {
            try {
                if (w.is_fullscreen())
                    fullscreenWindows.add(w);
            } catch (_) {}
        }
    } catch (e) {
        _debug(`Error listing windows: ${e}`);
    }

    const hasFS = fullscreenWindows.size > 0;
    activeWorkspaceHasFullscreen = hasFS;
    
    // Update panel behavior based on fullscreen state and overview visibility
    // Track idle source so it can be cancelled on disable
    if (_recomputeIdleId) {
        try { GLib.Source.remove(_recomputeIdleId); } catch (_) {}
        _recomputeIdleId = null;
    }
    _recomputeIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        if (!_enabled) { _recomputeIdleId = null; return GLib.SOURCE_REMOVE; }
        
        try {
            if (Main.overview.visible) {
                // In overview, always show panel regardless of fullscreen
                _panelRevealed = false;
                _animating = false;
                _setPanelAutoHide(false);
                if (hotCorner) hotCorner.hide();
            } else if (activeWorkspaceHasFullscreen) {
                // In fullscreen, enable auto-hide and show hover area
                _panelRevealed = false;
                _animating = false;
                _setPanelAutoHide(true);
                if (hotCorner) hotCorner.show();
            } else {
                // Normal mode, panel always visible
                _panelRevealed = false;
                _animating = false;
                _setPanelAutoHide(false);
                if (hotCorner) hotCorner.hide();
            }
        } catch (e) {
            _debug(`Idle fullscreen state error: ${e}`);
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
    if (hotCorner) hotCorner.hide();
}

function _onOverviewHidden() {
    if (!_enabled) return;
    // When overview hides, recompute fullscreen state
    _recomputeFullscreenState();
}

export function enable() {
    disable(); // Clean reset
    _enabled = true;
    _originalTrackFullscreen = null; // Reset for fresh start
    
    try {
        hotCorner = _createHoverArea();
        if (hotCorner) {
            Main.layoutManager.addChrome(hotCorner, {
                trackFullscreen: false, // We manage visibility ourselves
                affectsStruts: false,
                affectsInputRegion: true,
            });
        }
    } catch (e) {
        _debug(`Failed to construct hover area: ${e}`);
    }

    // Connect to existing windows
    try {
        global.get_window_actors().forEach(actor => {
            let window = actor.meta_window;
            _connectWindowSignals(window);
        });
    } catch (e) { _debug(`Enumerating windows failed: ${e}`); }

    // Connect to events
    try { windowCreatedHandler = global.display.connect('window-created', _onWindowCreated); } catch (e) { _debug(`window-created connect failed: ${e}`); }
    try { workspaceChangedHandler = global.workspace_manager.connect('active-workspace-changed', _onWorkspaceChanged); } catch (e) { _debug(`workspace change connect failed: ${e}`); }
    try { overviewShowingHandler = Main.overview.connect('showing', _onOverviewShowing); } catch (e) { _debug(`overview showing connect failed: ${e}`); }
    try { overviewHiddenHandler = Main.overview.connect('hidden', _onOverviewHidden); } catch (e) { _debug(`overview hidden connect failed: ${e}`); }

    // Hide when leaving panel area in fullscreen
    try {
        const panelBox = _getPanelBox();
        if (panelBox) {
            _panelBoxEnterId = panelBox.connect('enter-event', () => {
                _cancelHideTimeout();
            });
            _panelBoxLeaveId = panelBox.connect('leave-event', () => {
                if (activeWorkspaceHasFullscreen)
                    _scheduleHideAfterDelay();
            });
            // If a panel button was clicked but doesn't open a menu, hide after release
            _panelBoxButtonReleaseId = panelBox.connect('button-release-event', () => {
                if (activeWorkspaceHasFullscreen)
                    _scheduleHideAfterDelay(true);
            });
        }
    } catch (e) { _debug(`panelBox signals failed: ${e}`); }

    // Global stage capture to detect clicks outside panel
    try {
        _stageButtonReleaseId = global.stage.connect('button-release-event', (stage, event) => {
            if (!activeWorkspaceHasFullscreen || !_panelRevealed) return Clutter.EVENT_PROPAGATE;
            
            // Check if any menu is actually open before hiding
            let menuActuallyOpen = false;
            try {
                if (Main.panel?.menuManager?._activeMenu) {
                    menuActuallyOpen = true;
                }
                const statusArea = Main.panel.statusArea;
                if (statusArea) {
                    for (const indicator of Object.values(statusArea)) {
                        if (indicator?.menu?.isOpen) {
                            menuActuallyOpen = true;
                            break;
                        }
                    }
                }
            } catch (_) {}
            
            if (menuActuallyOpen) return Clutter.EVENT_PROPAGATE;
            
            const [stageX, stageY] = event.get_coords();
            const panelHeight = _getPanelHeight();
            
            // If click is well below panel area, schedule hide
            if (stageY > panelHeight + 20) {
                _scheduleHideAfterDelay(true);
            }
            
            return Clutter.EVENT_PROPAGATE;
        });
    } catch (e) { _debug(`stage capture failed: ${e}`); }
    
    _recomputeFullscreenState();
}

export function disable() {
    _enabled = false;

    // Clear any pending timeout
    _cancelHideTimeout();
    _cancelPeriodicCheck();
    _closeGhostMenu();
    if (_recomputeIdleId) {
        try { GLib.Source.remove(_recomputeIdleId); } catch (_) {}
        _recomputeIdleId = null;
    }

    // Destroy hover area
    try {
        if (hotCorner) {
            hotCorner.destroy();
            hotCorner = null;
        }
    } catch (e) { _debug(`Destroy hotCorner failed: ${e}`); }

    // Disconnect event handlers
    if (windowCreatedHandler) {
        try { global.display.disconnect(windowCreatedHandler); } catch (_) {}
        windowCreatedHandler = null;
    }
    if (workspaceChangedHandler) {
        try { global.workspace_manager.disconnect(workspaceChangedHandler); } catch (_) {}
        workspaceChangedHandler = null;
    }
    if (overviewShowingHandler) {
        try { Main.overview.disconnect(overviewShowingHandler); } catch (_) {}
        overviewShowingHandler = null;
    }
    if (overviewHiddenHandler) {
        try { Main.overview.disconnect(overviewHiddenHandler); } catch (_) {}
        overviewHiddenHandler = null;
    }
    // Disconnect panel box signals
    try {
        const panelBox = _getPanelBox();
        if (panelBox) {
            if (_panelBoxEnterId) { try { panelBox.disconnect(_panelBoxEnterId); } catch (_) {} _panelBoxEnterId = null; }
            if (_panelBoxLeaveId) { try { panelBox.disconnect(_panelBoxLeaveId); } catch (_) {} _panelBoxLeaveId = null; }
            if (_panelBoxButtonReleaseId) { try { panelBox.disconnect(_panelBoxButtonReleaseId); } catch (_) {} _panelBoxButtonReleaseId = null; }
        }
    } catch (_) {}
    
    // Disconnect stage capture
    if (_stageButtonReleaseId && global.stage) {
        try { global.stage.disconnect(_stageButtonReleaseId); } catch (_) {}
        _stageButtonReleaseId = null;
    }

    // Disconnect window signals
    try {
        windowSignals.forEach((signalIds, window) => {
            try { window.disconnect(signalIds.fullscreen); } catch (_) {}
            try { window.disconnect(signalIds.unmanaged); } catch (_) {}
        });
    } catch (e) { _debug(`Disconnect window signals failed: ${e}`); }
    
    windowSignals.clear();
    fullscreenWindows.clear();
    activeWorkspaceHasFullscreen = false;
    _panelRevealed = false;
    _animating = false;

    // Restore panel to its original state - this must be done BEFORE setting _enabled to false
    // but we already set it to false above, so we need to do manual restoration
    try {
        const panelBox = _getPanelBox();
        if (panelBox) {
            // Cancel any ongoing animations
            _cancelPanelTransitions();
            
            // Reset panel position immediately
            panelBox.translation_y = 0;
            panelBox.visible = true;
            
            // Restore trackFullscreen property to its original value
            const lm = Main.layoutManager;
            if (lm) {
                const tracked = lm._trackedActors;
                if (Array.isArray(tracked)) {
                    const record = tracked.find(a => a && a.actor === panelBox);
                    if (record && typeof record.trackFullscreen === 'boolean') {
                        // Restore original value, or default to true if not stored
                        record.trackFullscreen = _originalTrackFullscreen !== null ? _originalTrackFullscreen : true;
                    }
                }
                // Trigger visibility update
                lm._updateVisibility?.();
            }
        }
    } catch (e) {
        _debug(`Panel restoration failed: ${e}`);
    }

    // Reset stored values
    _originalTrackFullscreen = null;
}
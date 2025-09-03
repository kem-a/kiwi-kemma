import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

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

function _debug(msg) {
    try { log(`[PanelHover] ${msg}`); } catch (_) {}
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
    
    const stageWidth = global.stage?.width ?? 1920;
    
    const hoverArea = new Clutter.Actor({
        name: 'panel-hover-area',
        reactive: true,
        x: 0,
        y: 0,
        width: stageWidth,
        height: 8, // Small hover area at top of screen
        opacity: 0,
    });

    // Create pressure barrier for reveal
    let primaryMonitor = global.display.get_primary_monitor();
    let geometry = global.display.get_monitor_geometry(primaryMonitor);

    const barrier = new Meta.Barrier({
        backend: global.backend,
        x1: geometry.x,
        x2: geometry.x + geometry.width,
        y1: geometry.y,
        y2: geometry.y,
        directions: Meta.BarrierDirection.POSITIVE_Y,
    });

    hoverArea._barrier = barrier;
    
    try {
        hoverArea._barrierSignalId = barrier.connect('hit', () => {
            if (activeWorkspaceHasFullscreen) {
                _setPanelAutoHide(false); // Show panel
            }
        });
    } catch (e) {}

    hoverArea.connect('enter-event', () => {
        if (activeWorkspaceHasFullscreen) {
            _setPanelAutoHide(false); // Show panel
        }
    });

    hoverArea.connect('leave-event', () => {
        if (activeWorkspaceHasFullscreen) {
            // Clear any existing timeout
            if (_hideTimeoutId) {
                GLib.Source.remove(_hideTimeoutId);
                _hideTimeoutId = null;
            }
            
            // Delay hiding to allow interaction with panel
            _hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                _hideTimeoutId = null; // Clear the ID when timeout executes
                if (!_enabled) return GLib.SOURCE_REMOVE;
                
                const [, mouseY] = global.get_pointer();
                const panelHeight = Main.panel?.height || 40;
                
                if (mouseY > panelHeight + 4) {
                    _setPanelAutoHide(true); // Hide panel
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    });

    hoverArea.connect('destroy', () => {
        // Clear any pending timeout
        if (_hideTimeoutId) {
            GLib.Source.remove(_hideTimeoutId);
            _hideTimeoutId = null;
        }
        
        if (hoverArea._barrier) {
            if (hoverArea._barrierSignalId) {
                try { hoverArea._barrier.disconnect(hoverArea._barrierSignalId); } catch (_) {}
            }
            try { hoverArea._barrier.destroy(); } catch (_) {}
        }
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
    if (hasFS === activeWorkspaceHasFullscreen)
        return; // no change

    activeWorkspaceHasFullscreen = hasFS;
    
    // Update panel behavior based on fullscreen state and overview visibility
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        if (!_enabled) return GLib.SOURCE_REMOVE;
        
        try {
            if (Main.overview.visible) {
                // In overview, always show panel regardless of fullscreen
                _setPanelAutoHide(false);
                if (hotCorner) hotCorner.hide();
            } else if (activeWorkspaceHasFullscreen) {
                // In fullscreen, enable auto-hide and show hover area
                _setPanelAutoHide(true);
                if (hotCorner) hotCorner.show();
            } else {
                // Normal mode, panel always visible
                _setPanelAutoHide(false);
                if (hotCorner) hotCorner.hide();
            }
        } catch (e) {
            _debug(`Idle fullscreen state error: ${e}`);
        }
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
    
    _recomputeFullscreenState();
}

export function disable() {
    _enabled = false;

    // Clear any pending timeout
    if (_hideTimeoutId) {
        GLib.Source.remove(_hideTimeoutId);
        _hideTimeoutId = null;
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

    // Restore default panel behavior
    _setPanelAutoHide(false);
}
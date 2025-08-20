import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import GObject from 'gi://GObject';

let fullscreenWindows = new Set(); // Track fullscreen windows only on active workspace now
let windowSignals = new Map();
let windowCreatedHandler = null;
let workspaceChangedHandler = null;
let activeWorkspaceHasFullscreen = false;
let _panelTrackingOverridden = false;
let _originalTrackFullscreen = null;
let panelHideTimeoutId = null;
let hotCorner = null;
let panelContainer = null;
let panelLeaveSignalId = null;

function _getPanelContainer() {
    if (!panelContainer) {
        panelContainer = Main.panel ?? Main.panelManager?.primaryPanel?.widget ?? Main.layoutManager.panelBox;
    }
    return panelContainer;
}

function _applyPanelTranslation(y, animate = true) {
    const actors = new Set();
    const container = _getPanelContainer();
    if (container)
        actors.add(container);
    if (Main.layoutManager?.panelBox)
        actors.add(Main.layoutManager.panelBox);
    if (Main.panelManager?.primaryPanel?.widget)
        actors.add(Main.panelManager.primaryPanel.widget);
    for (let actor of actors) {
        try {
            actor.remove_all_transitions?.();
            if (!animate) {
                actor.translation_y = y;
            } else {
                actor.ease({
                    translation_y: y,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        } catch (e) {}
    }
}

function showPanel() {
    const container = _getPanelContainer();
    if (!container) return;
    container.show?.();
    try {
        const uiGroup = Main.layoutManager?.uiGroup;
        const windowGroup = global.window_group;
        if (uiGroup && windowGroup && container.get_parent()) {
            let top = container;
            while (top.get_parent() && top.get_parent() !== uiGroup)
                top = top.get_parent();
            uiGroup.set_child_above_sibling(top, windowGroup);
        }
    } catch (e) {}
    _applyPanelTranslation(0);
    if (!panelLeaveSignalId && container) {
        try {
            panelLeaveSignalId = container.connect('leave-event', () => {
                _maybeScheduleHideAfterPanelLeave();
                return Clutter.EVENT_PROPAGATE;
            });
        } catch (e) {}
    }
}

function hidePanel() {
    const container = _getPanelContainer();
    if (!container) return;
    const panelHeight = Main.panel?.height || container.height || 40;
    _applyPanelTranslation(-panelHeight);
}

function _maybeScheduleHideAfterPanelLeave() {
    if (!activeWorkspaceHasFullscreen)
        return;
    if (panelHideTimeoutId) {
        GLib.source_remove(panelHideTimeoutId);
        panelHideTimeoutId = null;
    }
    // Delay slightly to allow entering menus beneath panel edge
    panelHideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 450, () => {
        const [, y] = global.get_pointer();
        const ph = Main.panel?.height || _getPanelContainer()?.height || 40;
        if (y > ph + 4) {
            hidePanel();
        }
        panelHideTimeoutId = null;
        return GLib.SOURCE_REMOVE;
    });
}

const PanelEdge = GObject.registerClass(
class PanelEdge extends Clutter.Actor {
    _init() {
        const stageWidth = global.stage?.width ?? global.display?.get_monitor_geometry(global.display.get_primary_monitor())?.width ?? 1920;
        super._init({
            name: 'panel-edge-detector',
            reactive: true,
            x: 0,
            y: 0,
            width: stageWidth,
            height: 12,
            opacity: 0,
        });

        // Monitor geometry for placing the pointer barrier
        let primaryMonitor = global.display.get_primary_monitor();
        let geometry = global.display.get_monitor_geometry(primaryMonitor);

        // Create a pointer barrier for pressure-based reveal
        // In newer GNOME Shell versions, Meta.Barrier constructor has changed
        this._barrier = new Meta.Barrier({
            backend: global.backend,
            x1: geometry.x,
            x2: geometry.x + geometry.width,
            y1: geometry.y,
            y2: geometry.y,
            directions: Meta.BarrierDirection.POSITIVE_Y,
        });

        try {
            this._barrierSignalId = this._barrier.connect('hit', () => this._onTrigger());
        } catch (e) {}

        // Keep actor above fullscreen windows
        global.window_group.set_child_above_sibling(this, null);

        // Hover detection (simple enter/leave)
        this.connect('enter-event', this._onEnter.bind(this));
        this.connect('leave-event', this._onLeave.bind(this));
    }

    destroy() {
        if (this._barrier) {
            if (this._barrierSignalId) {
                try { this._barrier.disconnect(this._barrierSignalId); } catch (_) {}
                this._barrierSignalId = null;
            }
            try { this._barrier.destroy(); } catch (_) {}
            this._barrier = null;
        }
        super.destroy();
    }

    _onTrigger() {
    if (activeWorkspaceHasFullscreen) {
            this._showPanel();
        }
    }

    _onEnter() {
    if (activeWorkspaceHasFullscreen) {
            this._showPanel();
        }
    }

    _onLeave() {
    if (activeWorkspaceHasFullscreen) {
            if (panelHideTimeoutId) {
                GLib.source_remove(panelHideTimeoutId);
            }
            panelHideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                const [, mouseY] = global.get_pointer();
                if (mouseY > Main.panel.height) {
                    this._hidePanel();
                }
                panelHideTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _showPanel() {
        showPanel();
    }

    _hidePanel() {
        hidePanel();
    }
});

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
}

function _onWindowCreated(display, window) {
    if (!window)
        return;
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
    // Rebuild fullscreenWindows to only include windows on active workspace
    const ws = global.workspace_manager.get_active_workspace();
    const windows = ws.list_windows?.() || [];
    const fsSet = new Set(windows.filter(w => w.is_fullscreen()));
    fullscreenWindows = fsSet; // replace

    const hasFS = fsSet.size > 0;
    if (hasFS !== activeWorkspaceHasFullscreen) {
        activeWorkspaceHasFullscreen = hasFS;
        if (hasFS) {
            _overridePanelTracking(true);
            hidePanel();
            _ensureHotCornerVisible();
        } else {
            _overridePanelTracking(false);
            showPanel();
            _hideHotCorner();
        }
    }
}

function _overridePanelTracking(disableTracking) {
    // Access private tracking data; may change across GNOME versions.
    const lm = Main.layoutManager;
    if (!lm?._trackedActors)
        return;
    const panelBox = lm.panelBox;
    const record = lm._trackedActors.find(a => a.actor === panelBox);
    if (!record)
        return;
    if (disableTracking) {
        if (_panelTrackingOverridden)
            return;
        _originalTrackFullscreen = record.trackFullscreen;
        record.trackFullscreen = false; // stop auto hiding
        panelBox.show();
        _panelTrackingOverridden = true;
    } else {
        if (!_panelTrackingOverridden)
            return;
        record.trackFullscreen = _originalTrackFullscreen ?? true;
        _panelTrackingOverridden = false;
        _originalTrackFullscreen = null;
        // Let layout manager re-evaluate (may hide if still fullscreen)
        try { lm._updateVisibility(); } catch (_) {}
    }
}

function _onWorkspaceChanged() {
    _recomputeFullscreenState();
}

function _ensureHotCornerVisible() {
    if (hotCorner)
        hotCorner.show();
}

function _hideHotCorner() {
    if (hotCorner)
        hotCorner.hide();
}

export function enable() {
    log('[PanelHover] Enabling extension');
    disable();
    // Create edge actor once; visibility managed based on fullscreen state
    hotCorner = new PanelEdge();
    Main.layoutManager.addChrome(hotCorner, {
        trackFullscreen: true,
        affectsStruts: false,
        affectsInputRegion: true,
    });

    // Connect to existing windows
    global.get_window_actors().forEach(actor => {
        let window = actor.meta_window;
        _connectWindowSignals(window);
    });

    windowCreatedHandler = global.display.connect('window-created', _onWindowCreated);
    workspaceChangedHandler = global.workspace_manager.connect('active-workspace-changed', _onWorkspaceChanged);
    _recomputeFullscreenState();
}

export function disable() {
    log('[PanelHover] Disabling extension');

    if (hotCorner) {
        hotCorner.destroy();
        hotCorner = null;
    }
    if (panelLeaveSignalId && panelContainer) {
        try { panelContainer.disconnect(panelLeaveSignalId); } catch (_) {}
        panelLeaveSignalId = null;
    }

    if (windowCreatedHandler) {
        global.display.disconnect(windowCreatedHandler);
        windowCreatedHandler = null;
    }
    if (workspaceChangedHandler) {
        global.workspace_manager.disconnect(workspaceChangedHandler);
        workspaceChangedHandler = null;
    }

    if (panelHideTimeoutId) {
        GLib.source_remove(panelHideTimeoutId);
        panelHideTimeoutId = null;
    }

    // Disconnect window signals
    windowSignals.forEach((signalIds, window) => {
        try { window.disconnect(signalIds.fullscreen); } catch (_) {}
        try { window.disconnect(signalIds.unmanaged); } catch (_) {}
    });
    windowSignals.clear();
    fullscreenWindows.clear();
    activeWorkspaceHasFullscreen = false;
    _overridePanelTracking(false);

    // Restore panel
    showPanel();
    panelContainer = null;
}
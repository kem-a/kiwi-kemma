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
let _enabled = false; // hard guard so stale async callbacks bail out

function _debug(msg) {
    try { log(`[PanelHover] ${msg}`); } catch (_) {}
}

function _getPanelContainer() {
    if (!panelContainer) {
        panelContainer = Main.panel ?? Main.panelManager?.primaryPanel?.widget ?? Main.layoutManager.panelBox;
    }
    return panelContainer;
}

function _applyPanelTranslation(y, animate = true) {
    if (!_enabled)
        return;
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
            if (!actor || actor.get_stage?.() == null)
                continue; // actor already destroyed / unmapped
            actor.remove_all_transitions?.();
            if (!animate) {
                actor.translation_y = y;
            } else {
                actor.ease?.({
                    translation_y: y,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        } catch (e) {
            _debug(`Translation error: ${e}`);
        }
    }
}

function showPanel() {
    if (!_enabled)
        return;
    const container = _getPanelContainer();
    if (!container) return;
    try { container.show?.(); } catch (_) {}
    try {
        const uiGroup = Main.layoutManager?.uiGroup;
        const windowGroup = global.window_group;
        if (uiGroup && windowGroup && container.get_parent()) {
            let top = container;
            while (top.get_parent() && top.get_parent() !== uiGroup)
                top = top.get_parent();
            uiGroup.set_child_above_sibling(top, windowGroup);
        }
    } catch (e) { _debug(`showPanel stacking error: ${e}`); }
    _applyPanelTranslation(0);
    if (!panelLeaveSignalId && container) {
        try {
            panelLeaveSignalId = container.connect('leave-event', () => {
                _maybeScheduleHideAfterPanelLeave();
                return Clutter.EVENT_PROPAGATE;
            });
        } catch (e) { _debug(`leave-event connect failed: ${e}`); }
    }
}

function hidePanel() {
    if (!_enabled)
        return;
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
        if (!_enabled) {
            panelHideTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        }
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
        if (!_enabled) return;
        if (activeWorkspaceHasFullscreen) {
            this._showPanel();
        }
    }

    _onEnter() {
        if (!_enabled) return;
        if (activeWorkspaceHasFullscreen) {
            this._showPanel();
        }
    }

    _onLeave() {
        if (!_enabled) return;
        if (activeWorkspaceHasFullscreen) {
            if (panelHideTimeoutId) {
                GLib.source_remove(panelHideTimeoutId);
            }
            panelHideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                if (!_enabled) {
                    panelHideTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                }
                const [, mouseY] = global.get_pointer();
                try {
                    if (mouseY > (Main.panel?.height ?? 0)) {
                        this._hidePanel();
                    }
                } catch (e) { _debug(`leave hidePanel error: ${e}`); }
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

    // If the window we tracked was fullscreen, ensure we recompute state so the panel is restored.
    try {
        if (fullscreenWindows.has(window)) {
            fullscreenWindows.delete(window);
            _recomputeFullscreenState();
        } else {
            // Even if not in set (race), schedule a recompute to be safe.
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { if (_enabled) _recomputeFullscreenState(); return GLib.SOURCE_REMOVE; });
        }
    } catch (_) {}
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
    if (!_enabled)
        return;
    // Rebuild fullscreenWindows IN-PLACE to avoid replacing the Set object while
    // signals referencing the old object may still be firing.
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
    // Defer UI manipulations to idle to avoid running inside Shell layout cycles
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        if (!_enabled)
            return GLib.SOURCE_REMOVE;
        try {
            if (activeWorkspaceHasFullscreen) {
                _overridePanelTracking(true);
                hidePanel();
                _ensureHotCornerVisible();
            } else {
                _overridePanelTracking(false);
                showPanel();
                _hideHotCorner();
            }
        } catch (e) {
            _debug(`Idle fullscreen state error: ${e}`);
        }
        return GLib.SOURCE_REMOVE;
    });
}

function _overridePanelTracking(disableTracking) {
    if (!_enabled)
        return;
    // Access private Shell internals carefully; abort on mismatch.
    try {
        const lm = Main.layoutManager;
        const panelBox = lm?.panelBox;
        if (!lm || !panelBox)
            return;
        const tracked = lm._trackedActors; // private
        if (!Array.isArray(tracked))
            return;
        const record = tracked.find(a => a && a.actor === panelBox);
        if (!record || typeof record.trackFullscreen !== 'boolean')
            return;

        if (disableTracking) {
            if (_panelTrackingOverridden)
                return;
            _originalTrackFullscreen = record.trackFullscreen;
            record.trackFullscreen = false;
            try { panelBox.show?.(); } catch (_) {}
            _panelTrackingOverridden = true;
        } else {
            if (!_panelTrackingOverridden)
                return;
            record.trackFullscreen = _originalTrackFullscreen ?? true;
            _panelTrackingOverridden = false;
            _originalTrackFullscreen = null;
            try { lm._updateVisibility?.(); } catch (e) { _debug(`_updateVisibility failed: ${e}`); }
        }
    } catch (e) {
        _debug(`overridePanelTracking error: ${e}`);
        _panelTrackingOverridden = false;
        _originalTrackFullscreen = null;
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
    _debug('Enabling');
    disable(); // hard reset any prior state (defensive)
    _enabled = true;
    try {
        hotCorner = new PanelEdge();
        Main.layoutManager.addChrome(hotCorner, {
            trackFullscreen: true,
            affectsStruts: false,
            affectsInputRegion: true,
        });
    } catch (e) {
        _debug(`Failed to construct edge actor: ${e}`);
    }

    // Connect to existing windows
    try {
        global.get_window_actors().forEach(actor => {
            let window = actor.meta_window;
            _connectWindowSignals(window);
        });
    } catch (e) { _debug(`Enumerating windows failed: ${e}`); }

    try { windowCreatedHandler = global.display.connect('window-created', _onWindowCreated); } catch (e) { _debug(`window-created connect failed: ${e}`); }
    try { workspaceChangedHandler = global.workspace_manager.connect('active-workspace-changed', _onWorkspaceChanged); } catch (e) { _debug(`workspace change connect failed: ${e}`); }
    _recomputeFullscreenState();
}

export function disable() {
    _enabled = false;
    _debug('Disabling');

    try {
        if (hotCorner) {
            hotCorner.destroy();
            hotCorner = null;
        }
    } catch (e) { _debug(`Destroy hotCorner failed: ${e}`); }

    if (panelLeaveSignalId && panelContainer) {
        try { panelContainer.disconnect(panelLeaveSignalId); } catch (_) {}
        panelLeaveSignalId = null;
    }

    if (windowCreatedHandler) {
        try { global.display.disconnect(windowCreatedHandler); } catch (_) {}
        windowCreatedHandler = null;
    }
    if (workspaceChangedHandler) {
        try { global.workspace_manager.disconnect(workspaceChangedHandler); } catch (_) {}
        workspaceChangedHandler = null;
    }

    if (panelHideTimeoutId) {
        try { GLib.source_remove(panelHideTimeoutId); } catch (_) {}
        panelHideTimeoutId = null;
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
    _overridePanelTracking(false);

    // Restore panel (force translation reset without animation)
    try { showPanel(); } catch (_) {}
    panelContainer = null;
}
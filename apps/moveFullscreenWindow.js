// moveFullscreenWindow.js
// NOTE: Previous implementation stored raw Meta.Workspace objects on windows and
// removed "empty" workspaces immediately on fullscreen exit. Under certain
// timing (e.g. exiting fullscreen via F11 / custom restore button) Mutter could
// still reference a soon-to-be-removed workspace, leading to an assertion:
// meta_workspace_index: assertion 'ret >= 0' failed and subsequent segfault.
//
// This rewrite stores only workspace indices, validates existence before use,
// and defers removal of the temporary fullscreen workspace safely via idle so
// we never activate / remove the same workspace inside the notify::fullscreen
// emission stack.

import GLib from 'gi://GLib';

class MoveFullscreenWindow {
    constructor() {
        this._windowSignals = new Map();
        this._windowAddedId = null;
    this._pendingIsolation = new Map(); // window -> timeout id
    }

    _onWindowCreated(display, window) {
        this._connectWindowSignals(window);
    }

    _connectWindowSignals(window) {
        if (this._windowSignals.has(window)) {
            // Already connected
            return;
        }

        // Connect to notify::fullscreen signal
        let fullscreenId = window.connect('notify::fullscreen', () => {
            this._onWindowFullscreenChanged(window);
        });

        // Handle when the window is unmanaged (closed)
        let unmanagedId = window.connect('unmanaged', () => {
            // Defer all workspace manipulations; doing them synchronously during
            // the unmanaged emission can race with Mutter internals and cause
            // panel / layout corruption.
            const origIndex = window._originalWorkspaceIndex;
            const tempIndex = window._fullscreenTempWorkspaceIndex;
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                try {
                    const wm = global.workspace_manager;
                    if (wm) {
                        if (origIndex !== undefined && origIndex !== null && origIndex >= 0 && origIndex < wm.n_workspaces) {
                            const ws = wm.get_workspace_by_index(origIndex);
                            if (ws) {
                                // Only activate if different from current to avoid redundant layout passes
                                if (!ws.active)
                                    ws.activate(global.get_current_time());
                            }
                        }
                        // Safe removal of temporary workspace if it still exists, is empty, not index 0 and not active
                        if (tempIndex !== undefined && tempIndex !== null && tempIndex >= 0 && tempIndex < wm.n_workspaces) {
                            try {
                                const tws = wm.get_workspace_by_index(tempIndex);
                                if (tws && !tws.active && tws.index() !== 0 && tws.list_windows().length === 0) {
                                    wm.remove_workspace(tws, global.get_current_time());
                                }
                            } catch (_) {}
                        }
                    }
                } catch (_) {}
                return GLib.SOURCE_REMOVE;
            });
            this._disconnectWindowSignals(window);
        });

        this._windowSignals.set(window, {
            fullscreen: fullscreenId,
            unmanaged: unmanagedId,
        });

        // Store original workspace index (not the object) only once
        if (window._originalWorkspaceIndex === undefined || window._originalWorkspaceIndex === null) {
            try {
                window._originalWorkspaceIndex = window.get_workspace()?.index?.();
            } catch (_) {
                window._originalWorkspaceIndex = null;
            }
        }

        // Check initial fullscreen state
        if (window.is_fullscreen()) {
            this._onWindowFullscreenChanged(window);
        }
    }

    _disconnectWindowSignals(window) {
        if (this._windowSignals.has(window)) {
            let signalIds = this._windowSignals.get(window);
            window.disconnect(signalIds.fullscreen);
            window.disconnect(signalIds.unmanaged);
            this._windowSignals.delete(window);
        }
    }

    _onWindowFullscreenChanged(window) {
        try {
            if (window.is_fullscreen()) {
                this._scheduleIsolation(window);
            } else {
                this._cancelPendingIsolation(window);
                this._restoreWindowToOriginalWorkspace(window);
            }
        } catch (e) {
            // Defensive: never let an exception propagate into Shell
            try { log(`[MoveFullscreen] Error handling fullscreen change: ${e}`); } catch (_) {}
        }
    }

    _scheduleIsolation(window) {
        // Already isolated or already pending -> do nothing
        if (window._isolated || this._pendingIsolation.has(window))
            return;

        // Ensure original workspace index captured early
        if (window._originalWorkspaceIndex === undefined || window._originalWorkspaceIndex === null) {
            try { window._originalWorkspaceIndex = window.get_workspace()?.index?.(); } catch (_) { window._originalWorkspaceIndex = null; }
        }

        const DELAY_MS = 650; // debounce: if user closes quickly, we skip isolation
        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DELAY_MS, () => {
            this._pendingIsolation.delete(window);
            if (!window.is_fullscreen()) {
                return GLib.SOURCE_REMOVE; // user exited before delay elapsed
            }
            try { this._moveWindowToNewWorkspace(window); } catch (e) { try { log(`[MoveFullscreen] isolation failed: ${e}`); } catch (_) {} }
            return GLib.SOURCE_REMOVE;
        });
        this._pendingIsolation.set(window, sourceId);
    }

    _cancelPendingIsolation(window) {
        const id = this._pendingIsolation.get(window);
        if (id) {
            try { GLib.source_remove(id); } catch (_) {}
            this._pendingIsolation.delete(window);
        }
    }

    _moveWindowToNewWorkspace(window) {
        const wm = global.workspace_manager;
        if (!wm)
            return;

        if (window._isolated) // already done
            return;

        // If the window is already alone on its workspace, skip creating a new one
        try {
            const currentWs = window.get_workspace();
            if (currentWs?.list_windows?.().filter(w => !w.skip_taskbar).length === 1) {
                return; // already isolated
            }
        } catch (_) {}

        // Create a new workspace at the end (append)
        let newWorkspace = null;
        try {
            newWorkspace = wm.append_new_workspace(false, wm.n_workspaces);
        } catch (_) {
            return; // bail if API mismatch / failure
        }

        // Record the temp workspace index so we can safely remove later
        try { window._fullscreenTempWorkspaceIndex = newWorkspace.index(); } catch (_) { window._fullscreenTempWorkspaceIndex = null; }

        try { window.change_workspace(newWorkspace); } catch (_) {}
        try { newWorkspace.activate(global.get_current_time()); } catch (_) {}
        window._isolated = true;
    }

    _restoreWindowToOriginalWorkspace(window) {
        const wm = global.workspace_manager;
        if (!wm)
            return;

        // If window was never isolated (debounced or skipped), nothing to do.
        if (!window._isolated) {
            window._fullscreenTempWorkspaceIndex = null;
            return;
        }

        const origIndex = window._originalWorkspaceIndex;
        if (origIndex !== undefined && origIndex !== null && origIndex >= 0) {
            // If index now outside range, clamp
            let targetIndex = Math.min(origIndex, wm.n_workspaces - 1);
            if (targetIndex >= 0) {
                let targetWs = null;
                try { targetWs = wm.get_workspace_by_index(targetIndex); } catch (_) {}
                if (targetWs) {
                    try { window.change_workspace(targetWs); } catch (_) {}
                    try { targetWs.activate(global.get_current_time()); } catch (_) {}
                }
            }
        }

        // Clear stored original index now that we're back
        window._originalWorkspaceIndex = null;

        // Defer removal of the temp workspace (if any) to idle to avoid running
        // inside notify::fullscreen emission. Only remove if it's empty and not the last remaining base workspace (index 0).
        const tempIndex = window._fullscreenTempWorkspaceIndex;
        window._fullscreenTempWorkspaceIndex = null;
        if (tempIndex !== undefined && tempIndex !== null) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                try {
                    if (tempIndex < wm.n_workspaces) {
                        const ws = wm.get_workspace_by_index(tempIndex);
                        // If tempIndex now refers to a different workspace because of shifts, we still only remove if empty and not index 0
                        if (ws && ws.index() !== 0 && ws.list_windows().length === 0) {
                            wm.remove_workspace(ws, global.get_current_time());
                        }
                    }
                } catch (_) {}
                return GLib.SOURCE_REMOVE;
            });
        }
    window._isolated = false;
    }

    _removeEmptyWorkspaces() {
        // Legacy no-op retained for backward compatibility; empty workspaces
        // are now only removed in a controlled deferred path above.
    }
}

let moveFullscreenWindowInstance = null;

export function enable() {
    if (!moveFullscreenWindowInstance) {
        moveFullscreenWindowInstance = new MoveFullscreenWindow();

        // Connect to window-created signal
        moveFullscreenWindowInstance._windowAddedId = global.display.connect(
            'window-created',
            moveFullscreenWindowInstance._onWindowCreated.bind(moveFullscreenWindowInstance)
        );

        // For existing windows, connect to fullscreen changes
        global.get_window_actors().forEach(actor => {
            let window = actor.meta_window;
            moveFullscreenWindowInstance._connectWindowSignals(window);
        });
    }
}

export function disable() {
    if (moveFullscreenWindowInstance) {
        // Disconnect signal from global display
        if (moveFullscreenWindowInstance._windowAddedId) {
            global.display.disconnect(moveFullscreenWindowInstance._windowAddedId);
            moveFullscreenWindowInstance._windowAddedId = null;
        }

        // Clean up pending isolation timeouts
        for (let [window, timeoutId] of moveFullscreenWindowInstance._pendingIsolation) {
            try {
                GLib.source_remove(timeoutId);
            } catch (_) {}
        }
        moveFullscreenWindowInstance._pendingIsolation.clear();

        // Disconnect signals for each window
        for (let [window, signalIds] of moveFullscreenWindowInstance._windowSignals) {
            window.disconnect(signalIds.fullscreen);
            window.disconnect(signalIds.unmanaged);
        }
        moveFullscreenWindowInstance._windowSignals.clear();

        moveFullscreenWindowInstance = null;
    }
}

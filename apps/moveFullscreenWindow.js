// SPDX-License-Identifier: GPL-3.0-or-later
// Fullscreen Window Workspace Manager
//
// Moves fullscreen windows to dedicated workspaces (appended to the right) and
// manages workspace lifecycle inspired by GNOME Shell's WorkspaceTracker.
//
// Key behaviors:
// 1. Main workspace (index 0) is always preserved - at least one main workspace exists
// 2. Fullscreen windows are isolated to workspaces appended to the RIGHT
// 3. When exiting fullscreen, windows return to their original workspace
// 4. New windows opening on a fullscreen workspace are redirected to main (index 0)
// 5. Empty non-main workspaces are cleaned up (deferred to idle for safety)
//
// Safety notes:
// - Store workspace indices (numbers), never raw Meta.Workspace objects
// - Defer workspace removal to GLib.idle_add to avoid Mutter race conditions
// - Validate indices against wm.n_workspaces before use
// - All operations wrapped in try/catch to prevent Shell crashes

import GLib from 'gi://GLib';

// Minimum number of workspaces to maintain (main + 1 empty)
const MIN_WORKSPACES = 2;

// Always keep at least one empty workspace after the last workspace with windows
const KEEP_EMPTY_WORKSPACE_AT_END = true;

// Debounce delay before isolating fullscreen window (ms)
const FULLSCREEN_ISOLATION_DELAY = 650;

// Delay before restoring window to original workspace after exiting fullscreen (ms)
// Allows window resize animation to complete
const FULLSCREEN_RESTORE_DELAY = 650;

// Grace period after leaving workspace before cleaning it (ms)
const WORKSPACE_CLEANUP_DELAY = 800;

/**
 * FullscreenWorkspaceManager - Manages fullscreen window isolation and workspace lifecycle
 *
 * Workspace layout:
 * [Main WS 0] [WS 1] [WS 2] ... [Empty WS N]
 *
 * Rules:
 * - Main workspace (index 0) always exists
 * - Fullscreen windows move to first available workspace to the right if current has other windows
 * - If current workspace (index > 0) has no other windows, fullscreen stays there
 * - If on main workspace (index 0), always move to the right (keep main for normal windows)
 * - Always keep exactly 1 empty workspace at the end
 * - Remove any other empty workspaces
 */
class FullscreenWorkspaceManager {
    constructor() {
        // Track signal connections per window: window -> { fullscreen, unmanaged }
        this._windowSignals = new Map();

        // Track pending isolation timeouts: window -> sourceId
        this._pendingIsolation = new Map();

        // Track pending restore timeouts: window -> sourceId
        this._pendingRestore = new Map();

        // Track fullscreen workspaces: workspaceIndex -> fullscreenWindow
        this._fullscreenWorkspaces = new Map();

        // Track pending cleanup timeouts: workspaceIndex -> sourceId
        this._pendingCleanup = new Map();

        // Global signal IDs
        this._windowCreatedId = null;
        this._workspacesChangedId = null;
        this._workspaceSwitchedId = null;

        // Pending workspace check idle source
        this._checkWorkspacesId = 0;
    }

    // =========================================================================
    // Workspace Management (inspired by GNOME WorkspaceTracker)
    // =========================================================================

    /**
     * Get the workspace manager
     */
    _getWorkspaceManager() {
        return global.workspace_manager;
    }

    /**
     * Get the main workspace (always index 0)
     */
    _getMainWorkspace() {
        const wm = this._getWorkspaceManager();
        if (!wm || wm.n_workspaces < 1)
            return null;
        return wm.get_workspace_by_index(0);
    }

    /**
     * Check if a workspace has a fullscreen window
     */
    _isFullscreenWorkspace(workspaceIndex) {
        return this._fullscreenWorkspaces.has(workspaceIndex);
    }

    /**
     * Get the fullscreen window on a workspace (if any)
     */
    _getFullscreenWindowOnWorkspace(workspaceIndex) {
        return this._fullscreenWorkspaces.get(workspaceIndex) || null;
    }

    /**
     * Find the first empty workspace to the right of the given index
     * Returns null if no empty workspace found
     */
    _findFirstEmptyWorkspaceAfter(startIndex) {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return null;

        for (let i = startIndex + 1; i < wm.n_workspaces; i++) {
            try {
                const ws = wm.get_workspace_by_index(i);
                if (ws && ws.list_windows().filter(w => !w.skip_taskbar).length === 0) {
                    return ws;
                }
            } catch (_) {}
        }
        return null;
    }

    /**
     * Find the index of the last workspace that has windows
     * Returns -1 if no workspace has windows (shouldn't happen normally)
     */
    _findLastOccupiedWorkspaceIndex() {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return -1;

        for (let i = wm.n_workspaces - 1; i >= 0; i--) {
            try {
                const ws = wm.get_workspace_by_index(i);
                if (ws && ws.list_windows().filter(w => !w.skip_taskbar).length > 0) {
                    return i;
                }
            } catch (_) {}
        }
        return -1;
    }

    /**
     * Ensure there's at least one empty workspace after the last occupied one
     * and that we never have less than MIN_WORKSPACES (2)
     */
    _ensureEmptyWorkspaceAtEnd() {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return;

        // First ensure we have at least MIN_WORKSPACES (2)
        while (wm.n_workspaces < MIN_WORKSPACES) {
            try {
                wm.append_new_workspace(false, global.get_current_time());
            } catch (_) {
                break;
            }
        }

        if (!KEEP_EMPTY_WORKSPACE_AT_END)
            return;

        const lastOccupied = this._findLastOccupiedWorkspaceIndex();
        
        // If there's no empty workspace after the last occupied one, create one
        // lastOccupied is the index, so if n_workspaces == lastOccupied + 1, we need one more
        if (lastOccupied >= 0 && wm.n_workspaces <= lastOccupied + 1) {
            try {
                wm.append_new_workspace(false, global.get_current_time());
            } catch (_) {}
        }
    }

    /**
     * Queue a workspace check (deferred to avoid signal recursion)
     */
    _queueCheckWorkspaces() {
        if (this._checkWorkspacesId !== 0)
            return;

        this._checkWorkspacesId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._checkWorkspacesId = 0;
            this._checkWorkspaces();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Check workspaces state.
     * This is only called on n-workspaces change to ensure +1 empty exists.
     * Actual cleanup is done via _scheduleWorkspaceCleanup when leaving workspaces.
     */
    _checkWorkspaces() {
        // Just ensure we have +1 empty workspace at the end
        this._ensureEmptyWorkspaceAtEnd();
    }

    /**
     * Handle workspace switch - schedule cleanup of the workspace we left
     */
    _onWorkspaceSwitched(wm, from, to, _direction) {
        // Schedule cleanup of the workspace we just left (if not main and different from current)
        if (from !== to && from > 0) {
            this._scheduleWorkspaceCleanup(from);
        }
        
        // Cancel any pending cleanup for the workspace we're entering
        this._cancelWorkspaceCleanup(to);
    }

    /**
     * Schedule cleanup of a workspace after a delay (600ms)
     * Only called when leaving a workspace or exiting fullscreen
     */
    _scheduleWorkspaceCleanup(workspaceIndex) {
        // Cancel any existing cleanup for this index
        this._cancelWorkspaceCleanup(workspaceIndex);

        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WORKSPACE_CLEANUP_DELAY, () => {
            this._pendingCleanup.delete(workspaceIndex);
            this._cleanupWorkspaceIfEmpty(workspaceIndex);
            return GLib.SOURCE_REMOVE;
        });

        this._pendingCleanup.set(workspaceIndex, sourceId);
    }

    /**
     * Clean up a specific workspace if it's empty
     * Never removes if it would leave us with less than MIN_WORKSPACES (2)
     */
    _cleanupWorkspaceIfEmpty(workspaceIndex) {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return;

        // Don't remove main workspace (index 0)
        if (workspaceIndex <= 0)
            return;

        // Never go below MIN_WORKSPACES (2)
        if (wm.n_workspaces <= MIN_WORKSPACES)
            return;

        // Check if index is still valid
        if (workspaceIndex >= wm.n_workspaces)
            return;

        try {
            const ws = wm.get_workspace_by_index(workspaceIndex);
            if (!ws)
                return;

            const windows = ws.list_windows().filter(w => !w.skip_taskbar);
            
            // Only remove if empty and not active
            if (windows.length === 0 && !ws.active) {
                // Check if this is the last workspace - if so, keep it as the +1 empty
                const lastOccupied = this._findLastOccupiedWorkspaceIndex();
                if (workspaceIndex === lastOccupied + 1 && wm.n_workspaces === workspaceIndex + 1) {
                    // This is the +1 empty workspace at the end, keep it
                    return;
                }

                // Double-check we won't go below MIN_WORKSPACES after removal
                if (wm.n_workspaces - 1 < MIN_WORKSPACES)
                    return;

                this._fullscreenWorkspaces.delete(workspaceIndex);
                wm.remove_workspace(ws, global.get_current_time());
                this._shiftFullscreenIndicesAfterRemove(workspaceIndex);
            }
        } catch (_) {}

        // Ensure we still have +1 empty at the end and MIN_WORKSPACES
        this._ensureEmptyWorkspaceAtEnd();
    }

    /**
     * Cancel pending cleanup for a workspace
     */
    _cancelWorkspaceCleanup(workspaceIndex) {
        const sourceId = this._pendingCleanup.get(workspaceIndex);
        if (sourceId) {
            try {
                GLib.source_remove(sourceId);
            } catch (_) {}
            this._pendingCleanup.delete(workspaceIndex);
        }
    }

    // =========================================================================
    // Window Signal Management
    // =========================================================================

    /**
     * Handle new window creation
     */
    _onWindowCreated(display, window) {
        this._connectWindowSignals(window);

        // Check if window opened on a fullscreen workspace - redirect to main
        // Also ensure we always have an empty workspace at the end
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._redirectWindowFromFullscreenWorkspace(window);
            // If window opened on what was the last (empty) workspace, ensure +1 empty exists
            this._ensureEmptyWorkspaceAtEnd();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Connect signals for a window
     */
    _connectWindowSignals(window) {
        if (this._windowSignals.has(window))
            return;

        // Skip windows that shouldn't be managed
        if (window.skip_taskbar)
            return;

        const fullscreenId = window.connect('notify::fullscreen', () => {
            this._onWindowFullscreenChanged(window);
        });

        const unmanagedId = window.connect('unmanaged', () => {
            this._onWindowUnmanaged(window);
        });

        this._windowSignals.set(window, {
            fullscreen: fullscreenId,
            unmanaged: unmanagedId,
        });

        // Store original workspace index
        this._captureOriginalWorkspace(window);

        // Handle if window is already fullscreen
        if (window.is_fullscreen()) {
            this._onWindowFullscreenChanged(window);
        }
    }

    /**
     * Disconnect signals for a window
     */
    _disconnectWindowSignals(window) {
        const signals = this._windowSignals.get(window);
        if (signals) {
            try {
                window.disconnect(signals.fullscreen);
            } catch (_) {}
            try {
                window.disconnect(signals.unmanaged);
            } catch (_) {}
            this._windowSignals.delete(window);
        }
    }

    /**
     * Capture the original workspace index for a window
     */
    _captureOriginalWorkspace(window) {
        if (window._kiwi_originalWorkspaceIndex === undefined) {
            try {
                const ws = window.get_workspace();
                window._kiwi_originalWorkspaceIndex = ws ? ws.index() : 0;
            } catch (_) {
                window._kiwi_originalWorkspaceIndex = 0;
            }
        }
    }

    // =========================================================================
    // Fullscreen Window Handling
    // =========================================================================

    /**
     * Handle fullscreen state change
     */
    _onWindowFullscreenChanged(window) {
        try {
            if (window.is_fullscreen()) {
                this._scheduleIsolation(window);
            } else {
                this._cancelPendingIsolation(window);
                this._restoreWindowFromFullscreen(window);
            }
        } catch (e) {
            // Defensive: never propagate exceptions to Shell
        }
    }

    /**
     * Schedule isolation of a fullscreen window (debounced)
     */
    _scheduleIsolation(window) {
        if (window._kiwi_isolated || this._pendingIsolation.has(window))
            return;

        // Capture original workspace before isolation
        this._captureOriginalWorkspace(window);

        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FULLSCREEN_ISOLATION_DELAY, () => {
            this._pendingIsolation.delete(window);

            if (!window.is_fullscreen())
                return GLib.SOURCE_REMOVE;

            try {
                this._isolateFullscreenWindow(window);
            } catch (_) {}

            return GLib.SOURCE_REMOVE;
        });

        this._pendingIsolation.set(window, sourceId);
    }

    /**
     * Cancel pending isolation for a window
     */
    _cancelPendingIsolation(window) {
        const sourceId = this._pendingIsolation.get(window);
        if (sourceId) {
            try {
                GLib.source_remove(sourceId);
            } catch (_) {}
            this._pendingIsolation.delete(window);
        }
    }

    /**
     * Isolate a fullscreen window to its own workspace.
     * 
     * Logic:
     * - If on main workspace (index 0), ALWAYS move to workspace index 1
     *   - If index 1 is empty, use it
     *   - If index 1 is occupied, move existing windows to first empty workspace, use index 1
     * - If on workspace index > 0 with other windows, move to index+1 (same logic)
     * - If on workspace index > 0 and alone, stay there (already isolated)
     */
    _isolateFullscreenWindow(window) {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return;

        if (window._kiwi_isolated)
            return;

        let currentWs = null;
        let currentIndex = 0;
        let otherWindowsOnCurrent = 0;

        try {
            currentWs = window.get_workspace();
            currentIndex = currentWs?.index?.() ?? 0;
            const allWindows = currentWs?.list_windows?.().filter(w => !w.skip_taskbar) || [];
            otherWindowsOnCurrent = allWindows.filter(w => w !== window).length;
        } catch (_) {}

        // Decision: should we move?
        // - If on main workspace (index 0), always move (keep main clean)
        // - If on workspace index > 0 and alone, stay there
        // - If on workspace index > 0 but has other windows, move
        const shouldMove = (currentIndex === 0) || (otherWindowsOnCurrent > 0);

        if (!shouldMove) {
            // Already isolated on a non-main workspace with no other windows
            window._kiwi_isolated = true;
            window._kiwi_fullscreenWorkspaceIndex = currentIndex;
            this._fullscreenWorkspaces.set(currentIndex, window);
            this._ensureEmptyWorkspaceAtEnd();
            return;
        }

        // Target is always currentIndex + 1
        const desiredTargetIndex = currentIndex + 1;
        let targetWs = null;

        // Check if workspace at desiredTargetIndex exists and is empty
        if (desiredTargetIndex < wm.n_workspaces) {
            try {
                const existingWs = wm.get_workspace_by_index(desiredTargetIndex);
                if (existingWs) {
                    const existingWindows = existingWs.list_windows().filter(w => !w.skip_taskbar);
                    if (existingWindows.length === 0) {
                        // Workspace exists and is empty, use it
                        targetWs = existingWs;
                    } else {
                        // Workspace is occupied - find or create workspace to move existing windows
                        let destinationWs = this._findFirstEmptyWorkspaceAfter(desiredTargetIndex);
                        let destinationIndex;
                        
                        if (destinationWs) {
                            destinationIndex = destinationWs.index();
                        } else {
                            // No empty workspace found, create one
                            destinationWs = wm.append_new_workspace(false, global.get_current_time());
                            destinationIndex = destinationWs ? destinationWs.index() : -1;
                        }
                        
                        if (destinationWs) {
                            // Move windows from target to destination workspace
                            for (const w of existingWindows) {
                                try {
                                    w.change_workspace(destinationWs);
                                    // Update tracking for moved fullscreen windows
                                    if (w._kiwi_fullscreenWorkspaceIndex === desiredTargetIndex) {
                                        w._kiwi_fullscreenWorkspaceIndex = destinationIndex;
                                        this._fullscreenWorkspaces.delete(desiredTargetIndex);
                                        this._fullscreenWorkspaces.set(destinationIndex, w);
                                    }
                                } catch (_) {}
                            }
                            // Use the now-empty workspace at desiredTargetIndex
                            targetWs = existingWs;
                        }
                    }
                }
            } catch (_) {}
        }

        // If still no target workspace, create one
        if (!targetWs) {
            try {
                targetWs = wm.append_new_workspace(false, global.get_current_time());
            } catch (_) {
                return;
            }
        }

        if (!targetWs)
            return;

        // Get final index
        let finalTargetIndex;
        try {
            finalTargetIndex = targetWs.index();
        } catch (_) {
            finalTargetIndex = desiredTargetIndex;
        }

        const leavingWorkspaceIndex = currentIndex;

        // Move window to the target workspace
        try {
            window.change_workspace(targetWs);
        } catch (_) {
            return;
        }

        // Activate the workspace
        try {
            targetWs.activate(global.get_current_time());
        } catch (_) {}

        // Track the fullscreen workspace
        window._kiwi_isolated = true;
        window._kiwi_fullscreenWorkspaceIndex = finalTargetIndex;
        this._fullscreenWorkspaces.set(finalTargetIndex, window);

        // Cancel any pending cleanup for the target workspace
        this._cancelWorkspaceCleanup(finalTargetIndex);

        // Schedule cleanup of the workspace we just left (if not main)
        if (leavingWorkspaceIndex > 0) {
            this._scheduleWorkspaceCleanup(leavingWorkspaceIndex);
        }

        // Ensure there's still an empty workspace after this one
        this._ensureEmptyWorkspaceAtEnd();
    }

    /**
     * Shift fullscreen workspace indices after removing a workspace at the given index
     */
    _shiftFullscreenIndicesAfterRemove(removedIndex) {
        const newMap = new Map();
        for (const [idx, win] of this._fullscreenWorkspaces) {
            if (idx > removedIndex) {
                // This workspace shifted left
                const newIdx = idx - 1;
                newMap.set(newIdx, win);
                if (win._kiwi_fullscreenWorkspaceIndex !== undefined) {
                    win._kiwi_fullscreenWorkspaceIndex = newIdx;
                }
            } else if (idx < removedIndex) {
                newMap.set(idx, win);
            }
            // idx === removedIndex is already deleted, skip it
        }
        this._fullscreenWorkspaces = newMap;
        
        // Also shift original workspace indices for all tracked windows
        for (const [win] of this._windowSignals) {
            if (win._kiwi_originalWorkspaceIndex !== undefined && 
                win._kiwi_originalWorkspaceIndex > removedIndex) {
                win._kiwi_originalWorkspaceIndex -= 1;
            }
        }
    }

    /**
     * Restore a window from fullscreen isolation (with delay for resize animation)
     */
    _restoreWindowFromFullscreen(window) {
        if (!window._kiwi_isolated)
            return;

        // Cancel any pending restore for this window
        this._cancelPendingRestore(window);

        const fullscreenWsIndex = window._kiwi_fullscreenWorkspaceIndex;
        const originalIndex = window._kiwi_originalWorkspaceIndex;

        // Clear isolation tracking immediately
        window._kiwi_isolated = false;
        window._kiwi_fullscreenWorkspaceIndex = undefined;

        // Remove from fullscreen workspace tracking
        if (fullscreenWsIndex !== undefined) {
            this._fullscreenWorkspaces.delete(fullscreenWsIndex);
        }

        // Schedule the actual restore after delay (allows resize animation to complete)
        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FULLSCREEN_RESTORE_DELAY, () => {
            this._pendingRestore.delete(window);
            this._executeWindowRestore(window, originalIndex, fullscreenWsIndex);
            return GLib.SOURCE_REMOVE;
        });

        this._pendingRestore.set(window, sourceId);
    }

    /**
     * Cancel pending restore for a window
     */
    _cancelPendingRestore(window) {
        const sourceId = this._pendingRestore.get(window);
        if (sourceId) {
            try {
                GLib.source_remove(sourceId);
            } catch (_) {}
            this._pendingRestore.delete(window);
        }
    }

    /**
     * Execute the actual window restore to original workspace
     */
    _executeWindowRestore(window, originalIndex, fullscreenWsIndex) {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return;

        // Determine target workspace
        let targetIndex = 0; // Default to main workspace
        if (originalIndex !== undefined && originalIndex >= 0) {
            // Clamp to valid range
            targetIndex = Math.min(originalIndex, Math.max(0, wm.n_workspaces - 1));
        }

        // Move window to target workspace
        try {
            const targetWs = wm.get_workspace_by_index(targetIndex);
            if (targetWs) {
                window.change_workspace(targetWs);
                targetWs.activate(global.get_current_time());
            }
        } catch (_) {}

        // Clear original workspace tracking
        window._kiwi_originalWorkspaceIndex = undefined;

        // Schedule cleanup of the fullscreen workspace we just left
        if (fullscreenWsIndex !== undefined && fullscreenWsIndex > 0) {
            this._scheduleWorkspaceCleanup(fullscreenWsIndex);
        }
    }

    /**
     * Handle window unmanaged (closed)
     */
    _onWindowUnmanaged(window) {
        // Cancel any pending isolation or restore
        this._cancelPendingIsolation(window);
        this._cancelPendingRestore(window);

        const fullscreenWsIndex = window._kiwi_fullscreenWorkspaceIndex;
        const originalIndex = window._kiwi_originalWorkspaceIndex;
        
        // Get the workspace the window was on before it's gone
        let windowWorkspaceIndex = null;
        try {
            const ws = window.get_workspace();
            windowWorkspaceIndex = ws?.index?.() ?? null;
        } catch (_) {}

        // Disconnect signals first
        this._disconnectWindowSignals(window);

        // Defer cleanup to avoid race conditions with Mutter
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const wm = this._getWorkspaceManager();
            if (!wm)
                return GLib.SOURCE_REMOVE;

            // Try to activate original workspace if valid and not already active
            if (originalIndex !== undefined && originalIndex >= 0 && originalIndex < wm.n_workspaces) {
                try {
                    const ws = wm.get_workspace_by_index(originalIndex);
                    if (ws && !ws.active) {
                        ws.activate(global.get_current_time());
                    }
                } catch (_) {}
            }

            // Remove from fullscreen tracking
            if (fullscreenWsIndex !== undefined) {
                this._fullscreenWorkspaces.delete(fullscreenWsIndex);
            }

            // Schedule cleanup of the workspace the window was on (with 600ms delay)
            const wsToCleanup = fullscreenWsIndex ?? windowWorkspaceIndex;
            if (wsToCleanup !== null && wsToCleanup > 0) {
                this._scheduleWorkspaceCleanup(wsToCleanup);
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Redirect a window from a fullscreen workspace to main workspace
     */
    _redirectWindowFromFullscreenWorkspace(window) {
        if (!window || window.is_fullscreen() || window.skip_taskbar)
            return;

        const wm = this._getWorkspaceManager();
        if (!wm)
            return;

        try {
            const currentWs = window.get_workspace();
            if (!currentWs)
                return;

            const currentIndex = currentWs.index();

            // Check if current workspace has a fullscreen window (not this window)
            const fullscreenWindow = this._getFullscreenWindowOnWorkspace(currentIndex);
            if (fullscreenWindow && fullscreenWindow !== window) {
                // Redirect to main workspace (index 0)
                const mainWs = this._getMainWorkspace();
                if (mainWs && mainWs.index() !== currentIndex) {
                    window.change_workspace(mainWs);
                    // Update original workspace tracking
                    window._kiwi_originalWorkspaceIndex = 0;
                }
            }
        } catch (_) {}
    }

    // =========================================================================
    // Lifecycle Management
    // =========================================================================

    /**
     * Enable the manager
     */
    enable() {
        const wm = this._getWorkspaceManager();

        // Connect to window-created signal
        this._windowCreatedId = global.display.connect(
            'window-created',
            this._onWindowCreated.bind(this)
        );

        // Connect to workspace changes for cleanup
        if (wm) {
            this._workspacesChangedId = wm.connect(
                'notify::n-workspaces',
                this._queueCheckWorkspaces.bind(this)
            );
            
            // Connect to workspace switch to cleanup empty workspaces when leaving them
            this._workspaceSwitchedId = wm.connect(
                'workspace-switched',
                this._onWorkspaceSwitched.bind(this)
            );
        }

        // Connect signals to existing windows
        global.get_window_actors().forEach(actor => {
            const window = actor.meta_window;
            if (window) {
                this._connectWindowSignals(window);
            }
        });
    }

    /**
     * Disable the manager and clean up
     */
    disable() {
        // Disconnect global signals
        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }

        const wm = this._getWorkspaceManager();
        if (wm) {
            if (this._workspacesChangedId) {
                wm.disconnect(this._workspacesChangedId);
                this._workspacesChangedId = null;
            }
            if (this._workspaceSwitchedId) {
                wm.disconnect(this._workspaceSwitchedId);
                this._workspaceSwitchedId = null;
            }
        }

        // Cancel pending workspace check
        if (this._checkWorkspacesId !== 0) {
            try {
                GLib.source_remove(this._checkWorkspacesId);
            } catch (_) {}
            this._checkWorkspacesId = 0;
        }

        // Cancel all pending isolation timeouts
        for (const [, sourceId] of this._pendingIsolation) {
            try {
                GLib.source_remove(sourceId);
            } catch (_) {}
        }
        this._pendingIsolation.clear();

        // Cancel all pending restore timeouts
        for (const [, sourceId] of this._pendingRestore) {
            try {
                GLib.source_remove(sourceId);
            } catch (_) {}
        }
        this._pendingRestore.clear();

        // Cancel all pending cleanup timeouts
        for (const [, sourceId] of this._pendingCleanup) {
            try {
                GLib.source_remove(sourceId);
            } catch (_) {}
        }
        this._pendingCleanup.clear();

        // Disconnect all window signals and clean up window properties
        for (const [window, signals] of this._windowSignals) {
            try {
                window.disconnect(signals.fullscreen);
            } catch (_) {}
            try {
                window.disconnect(signals.unmanaged);
            } catch (_) {}
            // Clean up custom properties on windows
            try {
                delete window._kiwi_originalWorkspaceIndex;
                delete window._kiwi_fullscreenWorkspaceIndex;
                delete window._kiwi_isolated;
            } catch (_) {}
        }
        this._windowSignals.clear();

        // Clear fullscreen workspace tracking
        this._fullscreenWorkspaces.clear();
    }
}

let _instance = null;

export function enable() {
    if (!_instance) {
        _instance = new FullscreenWorkspaceManager();
        _instance.enable();
    }
}

export function disable() {
    if (_instance) {
        _instance.disable();
        _instance = null;
    }
}

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

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// Minimum number of workspaces to maintain (main + 1 empty)
const MIN_WORKSPACES = 2;

// Always keep at least one empty workspace after the last workspace with windows
const KEEP_EMPTY_WORKSPACE_AT_END = true;

// Debounce delay before isolating fullscreen window (ms)
const FULLSCREEN_ISOLATION_DELAY = 600;

// Delay before restoring window to original workspace after exiting fullscreen (ms)
// Allows window resize animation to complete
const FULLSCREEN_RESTORE_DELAY = 600;

// Grace period after leaving workspace before cleaning it (ms)
const WORKSPACE_CLEANUP_DELAY = 600;

// Maximum number of workspaces allowed (GNOME schema limit)
// org.gnome.desktop.wm.preferences.num-workspaces has range 1-36
const MAX_WORKSPACES = 36;


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

        // Track pending window created idle sources: window -> sourceId
        this._pendingWindowCreated = new Map();

        // Track pending window unmanaged idle sources: window -> sourceId
        this._pendingWindowUnmanaged = new Map();

        // Global signal IDs
        this._windowCreatedId = null;
        this._workspacesChangedId = null;
        this._workspaceSwitchedId = null;

        // Pending workspace check idle source
        this._checkWorkspacesId = 0;

        // Flag to prevent recursive workspace creation during signal handling
        this._isCreatingWorkspace = false;

        // Settings for workspace mode detection
        this._mutterSettings = null;  // For dynamic-workspaces
        this._wmPreferences = null;   // For num-workspaces
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
     * Check if we're in dynamic workspace mode
     * Returns true if dynamic, false if fixed number of workspaces
     */
    _isDynamicWorkspaceMode() {
        if (!this._mutterSettings) {
            return true; // Default to dynamic if we can't determine
        }
        return this._mutterSettings.get_boolean('dynamic-workspaces');
    }

    /**
     * Check if workspaces are only on the primary monitor
     * When enabled, windows on secondary monitors appear on all workspaces
     */
    _isWorkspacesOnlyOnPrimary() {
        if (!this._mutterSettings) {
            return false; // Default to false if we can't determine
        }
        return this._mutterSettings.get_boolean('workspaces-only-on-primary');
    }

    /**
     * Filter windows to only include those relevant for workspace tracking
     * When workspaces-only-on-primary is enabled, only count windows on primary monitor
     * @param {Array} windows - Array of MetaWindow objects
     * @returns {Array} Filtered array of windows
     */
    _filterWorkspaceRelevantWindows(windows) {
        if (!this._isWorkspacesOnlyOnPrimary()) {
            return windows;
        }
        // Only count windows on the primary monitor when workspaces-only-on-primary is set
        return windows.filter(w => w.is_on_primary_monitor());
    }

    /**
     * Get the maximum allowed workspace index
     * In fixed mode, respects the num-workspaces setting
     */
    _getMaxAllowedWorkspaces() {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return MAX_WORKSPACES;

        if (this._isDynamicWorkspaceMode()) {
            return MAX_WORKSPACES;
        }

        // In fixed mode, respect the configured number
        if (this._wmPreferences) {
            try {
                const numWorkspaces = this._wmPreferences.get_int('num-workspaces');
                return Math.min(numWorkspaces, MAX_WORKSPACES);
            } catch (e) {
                // If we can't read the setting, use current count
                return Math.min(wm.n_workspaces, MAX_WORKSPACES);
            }
        }

        return Math.min(wm.n_workspaces, MAX_WORKSPACES);
    }

    /**
     * Check if we can safely append a new workspace
     * Returns true if it's safe to create, false otherwise
     * 
     * @param {boolean} bypassNumWorkspacesLimit - If true, bypass the num-workspaces limit in fixed mode
     *                                             Used for fullscreen isolation to allow temporary workspaces
     */
    _canAppendWorkspace(bypassNumWorkspacesLimit = false) {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return false;

        // Always check against absolute maximum
        if (wm.n_workspaces >= MAX_WORKSPACES)
            return false;

        // Check if we're already at or beyond the limit (unless bypassing for fullscreen)
        if (!bypassNumWorkspacesLimit) {
            const maxAllowed = this._getMaxAllowedWorkspaces();
            if (wm.n_workspaces >= maxAllowed)
                return false;
        }

        // Prevent recursive creation
        if (this._isCreatingWorkspace)
            return false;

        return true;
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
            const ws = wm.get_workspace_by_index(i);
            if (ws) {
                const windows = this._filterWorkspaceRelevantWindows(
                    ws.list_windows().filter(w => !w.skip_taskbar)
                );
                if (windows.length === 0) {
                    return ws;
                }
            }
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
            const ws = wm.get_workspace_by_index(i);
            if (ws) {
                const windows = this._filterWorkspaceRelevantWindows(
                    ws.list_windows().filter(w => !w.skip_taskbar)
                );
                if (windows.length > 0) {
                    return i;
                }
            }
        }
        return -1;
    }

    /**
     * Ensure there's at least one empty workspace after the last occupied one
     * and that we never have less than MIN_WORKSPACES (2)
     * 
     * SAFETY: Guards against infinite workspace creation by checking limits
     */
    _ensureEmptyWorkspaceAtEnd() {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return;

        // Prevent recursive calls during workspace creation
        if (this._isCreatingWorkspace)
            return;

        // First ensure we have at least MIN_WORKSPACES (2)
        while (wm.n_workspaces < MIN_WORKSPACES && this._canAppendWorkspace(true)) {
            this._isCreatingWorkspace = true;
            wm.append_new_workspace(false, global.get_current_time());
            this._isCreatingWorkspace = false;
        }

        if (!KEEP_EMPTY_WORKSPACE_AT_END)
            return;

        const lastOccupied = this._findLastOccupiedWorkspaceIndex();
        
        // If there's no empty workspace after the last occupied one, create one
        // lastOccupied is the index, so if n_workspaces == lastOccupied + 1, we need one more
        // Allow bypassing num-workspaces limit to ensure +1 empty workspace exists
        if (lastOccupied >= 0 && wm.n_workspaces <= lastOccupied + 1 && this._canAppendWorkspace(true)) {
            this._isCreatingWorkspace = true;
            wm.append_new_workspace(false, global.get_current_time());
            this._isCreatingWorkspace = false;
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
     * In fixed workspace mode, cleans up ALL empty workspaces
     */
    _onWorkspaceSwitched(wm, from, to, _direction) {
        // Cancel any pending cleanup for the workspace we're entering
        this._cancelWorkspaceCleanup(to);

        // If we left a different workspace and it's not main
        if (from !== to && from > 0) {
            // In fixed workspace mode, clean up ALL empty workspaces
            // In dynamic mode, GNOME handles this automatically
            if (!this._isDynamicWorkspaceMode()) {
                this._scheduleCleanupAllEmptyWorkspaces();
            } else {
                // In dynamic mode, just clean up the one we left
                this._scheduleWorkspaceCleanup(from);
            }
        }
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

        const ws = wm.get_workspace_by_index(workspaceIndex);
        if (!ws)
            return;

        const windows = this._filterWorkspaceRelevantWindows(
            ws.list_windows().filter(w => !w.skip_taskbar)
        );
        
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

        // Ensure we still have +1 empty at the end and MIN_WORKSPACES
        this._ensureEmptyWorkspaceAtEnd();
    }

    /**
     * Cancel pending cleanup for a workspace
     */
    _cancelWorkspaceCleanup(workspaceIndex) {
        const sourceId = this._pendingCleanup.get(workspaceIndex);
        if (sourceId) {
            GLib.source_remove(sourceId);
            this._pendingCleanup.delete(workspaceIndex);
        }
    }

    /**
     * Schedule cleanup of ALL empty workspaces (used in fixed workspace mode)
     */
    _scheduleCleanupAllEmptyWorkspaces() {
        // Use a special cleanup ID to track this operation
        const CLEANUP_ALL_ID = -1;
        
        // Cancel any existing cleanup-all operation
        this._cancelWorkspaceCleanup(CLEANUP_ALL_ID);

        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, WORKSPACE_CLEANUP_DELAY, () => {
            this._pendingCleanup.delete(CLEANUP_ALL_ID);
            this._cleanupAllEmptyWorkspaces();
            return GLib.SOURCE_REMOVE;
        });

        this._pendingCleanup.set(CLEANUP_ALL_ID, sourceId);
    }

    /**
     * Clean up ALL empty non-main workspaces
     * Only called in fixed workspace mode when leaving a workspace
     */
    _cleanupAllEmptyWorkspaces() {
        const wm = this._getWorkspaceManager();
        if (!wm)
            return;

        // Never go below MIN_WORKSPACES (2)
        if (wm.n_workspaces <= MIN_WORKSPACES)
            return;

        // Get current active workspace to avoid removing it
        const activeWs = wm.get_active_workspace();
        const activeIndex = activeWs ? activeWs.index() : -1;

        // Find the last occupied workspace
        const lastOccupied = this._findLastOccupiedWorkspaceIndex();

        // Collect all empty workspaces (except main, active, and the +1 empty at the end)
        const emptyIndices = [];
        for (let i = 1; i < wm.n_workspaces; i++) {
            // Skip the active workspace
            if (i === activeIndex)
                continue;

            // Skip the +1 empty workspace at the end (if it's the last one)
            if (KEEP_EMPTY_WORKSPACE_AT_END && i === lastOccupied + 1 && i === wm.n_workspaces - 1)
                continue;

            const ws = wm.get_workspace_by_index(i);
            if (ws) {
                const windows = this._filterWorkspaceRelevantWindows(
                    ws.list_windows().filter(w => !w.skip_taskbar)
                );
                if (windows.length === 0) {
                    emptyIndices.push(i);
                }
            }
        }

        // Remove empty workspaces from highest index to lowest to avoid index shifting issues
        emptyIndices.sort((a, b) => b - a);
        
        for (const idx of emptyIndices) {
            // Safety check: don't go below MIN_WORKSPACES
            if (wm.n_workspaces <= MIN_WORKSPACES)
                break;

            // Re-validate index is still valid and empty
            if (idx >= wm.n_workspaces || idx <= 0)
                continue;

            const ws = wm.get_workspace_by_index(idx);
            if (!ws)
                continue;

            const windows = this._filterWorkspaceRelevantWindows(
                ws.list_windows().filter(w => !w.skip_taskbar)
            );
            if (windows.length === 0 && !ws.active) {
                this._fullscreenWorkspaces.delete(idx);
                wm.remove_workspace(ws, global.get_current_time());
                // Shift tracking after each removal
                this._shiftFullscreenIndicesAfterRemove(idx);
            }
        }

        // Ensure we still have proper workspace setup
        this._ensureEmptyWorkspaceAtEnd();
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
        const sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._pendingWindowCreated.delete(window);
            this._redirectWindowFromFullscreenWorkspace(window);
            // If window opened on what was the last (empty) workspace, ensure +1 empty exists
            this._ensureEmptyWorkspaceAtEnd();
            return GLib.SOURCE_REMOVE;
        });
        this._pendingWindowCreated.set(window, sourceId);
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
            window.disconnect(signals.fullscreen);
            window.disconnect(signals.unmanaged);
            this._windowSignals.delete(window);
        }
    }

    /**
     * Capture the original workspace index for a window
     */
    _captureOriginalWorkspace(window) {
        if (window._kiwi_originalWorkspaceIndex === undefined) {
            const ws = window.get_workspace();
            window._kiwi_originalWorkspaceIndex = ws ? ws.index() : 0;
        }
    }

    // =========================================================================
    // Fullscreen Window Handling
    // =========================================================================

    /**
     * Handle fullscreen state change
     */
    _onWindowFullscreenChanged(window) {
        if (window.is_fullscreen()) {
            this._scheduleIsolation(window);
        } else {
            this._cancelPendingIsolation(window);
            this._restoreWindowFromFullscreen(window);
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

            this._isolateFullscreenWindow(window);

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
            GLib.source_remove(sourceId);
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

        currentWs = window.get_workspace();
        currentIndex = currentWs?.index?.() ?? 0;
        const allWindows = this._filterWorkspaceRelevantWindows(
            currentWs?.list_windows?.().filter(w => !w.skip_taskbar) || []
        );
        otherWindowsOnCurrent = allWindows.filter(w => w !== window).length;

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
            const existingWs = wm.get_workspace_by_index(desiredTargetIndex);
            if (existingWs) {
                const existingWindows = this._filterWorkspaceRelevantWindows(
                    existingWs.list_windows().filter(w => !w.skip_taskbar)
                );
                if (existingWindows.length === 0) {
                    // Workspace exists and is empty, use it
                    targetWs = existingWs;
                } else {
                    // Workspace is occupied - need to shift all windows from desiredTargetIndex onwards
                    // to the right by one position to maintain order
                    
                    // First, ensure we have space at the end or create a new workspace
                    const lastOccupiedIndex = this._findLastOccupiedWorkspaceIndex();
                    let shiftDestinationWs = null;
                    
                    // Check if there's an empty workspace after the last occupied one
                    if (lastOccupiedIndex >= 0 && lastOccupiedIndex + 1 < wm.n_workspaces) {
                        shiftDestinationWs = wm.get_workspace_by_index(lastOccupiedIndex + 1);
                    }
                    
                    // If no empty workspace at the end, create one
                    if (!shiftDestinationWs) {
                        if (this._canAppendWorkspace(true)) {
                            this._isCreatingWorkspace = true;
                            shiftDestinationWs = wm.append_new_workspace(false, global.get_current_time());
                            this._isCreatingWorkspace = false;
                        } else {
                            // Can't create more - we hit MAX_WORKSPACES absolute limit
                            console.warn('Kiwi: Cannot isolate fullscreen window - maximum workspace limit reached');
                            return;
                        }
                    }
                    
                    if (!shiftDestinationWs) {
                        console.warn('Kiwi: Failed to create destination workspace for shifting');
                        return;
                    }
                    
                    // Now shift all windows from right to left (reverse order to avoid conflicts)
                    // Start from the last occupied workspace and move backwards to desiredTargetIndex
                    const newLastOccupiedIndex = this._findLastOccupiedWorkspaceIndex();
                    for (let i = newLastOccupiedIndex; i >= desiredTargetIndex; i--) {
                        const sourceWs = wm.get_workspace_by_index(i);
                        if (!sourceWs)
                            continue;
                        
                        const windowsToMove = this._filterWorkspaceRelevantWindows(
                            sourceWs.list_windows().filter(w => !w.skip_taskbar)
                        );
                        if (windowsToMove.length === 0)
                            continue;
                        
                        // Target is i + 1
                        const targetShiftWs = wm.get_workspace_by_index(i + 1);
                        if (!targetShiftWs)
                            continue;
                        
                        // Move all windows from workspace i to workspace i+1
                        for (const w of windowsToMove) {
                            w.change_workspace(targetShiftWs);
                            
                            // Update tracking for moved fullscreen windows
                            if (w._kiwi_fullscreenWorkspaceIndex === i) {
                                w._kiwi_fullscreenWorkspaceIndex = i + 1;
                                this._fullscreenWorkspaces.delete(i);
                                this._fullscreenWorkspaces.set(i + 1, w);
                            }
                        }
                    }
                    
                    // Now desiredTargetIndex workspace should be empty
                    targetWs = existingWs;
                }
            }
        }

        // If still no target workspace, create one (bypass num-workspaces limit for fullscreen)
        if (!targetWs) {
            if (this._canAppendWorkspace(true)) {
                this._isCreatingWorkspace = true;
                targetWs = wm.append_new_workspace(false, global.get_current_time());
                this._isCreatingWorkspace = false;
            } else {
                // Cannot create more workspaces - we hit MAX_WORKSPACES absolute limit
                // Cannot isolate - abort
                console.warn('Kiwi: Cannot isolate fullscreen window - maximum workspace limit reached');
                return;
            }
        }

        if (!targetWs)
            return;

        // Get final index
        let finalTargetIndex = targetWs.index();

        const leavingWorkspaceIndex = currentIndex;

        // Move window to the target workspace
        window.change_workspace(targetWs);

        // Activate the workspace
        targetWs.activate(global.get_current_time());

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
            GLib.source_remove(sourceId);
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
        const targetWs = wm.get_workspace_by_index(targetIndex);
        if (targetWs) {
            window.change_workspace(targetWs);
            targetWs.activate(global.get_current_time());
        }

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
        const ws = window.get_workspace();
        windowWorkspaceIndex = ws?.index?.() ?? null;

        // Disconnect signals first
        this._disconnectWindowSignals(window);

        // Defer cleanup to avoid race conditions with Mutter
        const sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._pendingWindowUnmanaged.delete(window);
            const wm = this._getWorkspaceManager();
            if (!wm)
                return GLib.SOURCE_REMOVE;

            // Try to activate original workspace if valid and not already active
            if (originalIndex !== undefined && originalIndex >= 0 && originalIndex < wm.n_workspaces) {
                const ws = wm.get_workspace_by_index(originalIndex);
                if (ws && !ws.active) {
                    ws.activate(global.get_current_time());
                }
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
        this._pendingWindowUnmanaged.set(window, sourceId);
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
    }

    // =========================================================================
    // Lifecycle Management
    // =========================================================================

    /**
     * Enable the manager
     */
    enable() {
        const wm = this._getWorkspaceManager();

        // Initialize workspace settings for mode detection
        this._mutterSettings = new Gio.Settings({
            schema_id: 'org.gnome.mutter'
        });
        this._wmPreferences = new Gio.Settings({
            schema_id: 'org.gnome.desktop.wm.preferences'
        });

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
            GLib.source_remove(this._checkWorkspacesId);
            this._checkWorkspacesId = 0;
        }

        // Cancel all pending isolation timeouts
        for (const [, sourceId] of this._pendingIsolation) {
            GLib.source_remove(sourceId);
        }
        this._pendingIsolation.clear();

        // Cancel all pending restore timeouts
        for (const [, sourceId] of this._pendingRestore) {
            GLib.source_remove(sourceId);
        }
        this._pendingRestore.clear();

        // Cancel all pending cleanup timeouts
        for (const [, sourceId] of this._pendingCleanup) {
            GLib.source_remove(sourceId);
        }
        this._pendingCleanup.clear();

        // Cancel all pending window created idle sources
        for (const [, sourceId] of this._pendingWindowCreated) {
            GLib.source_remove(sourceId);
        }
        this._pendingWindowCreated.clear();

        // Cancel all pending window unmanaged idle sources
        for (const [, sourceId] of this._pendingWindowUnmanaged) {
            GLib.source_remove(sourceId);
        }
        this._pendingWindowUnmanaged.clear();

        // Disconnect all window signals and clean up window properties
        for (const [window, signals] of this._windowSignals) {
            window.disconnect(signals.fullscreen);
            window.disconnect(signals.unmanaged);
            // Clean up custom properties on windows
            delete window._kiwi_originalWorkspaceIndex;
            delete window._kiwi_fullscreenWorkspaceIndex;
            delete window._kiwi_isolated;
        }
        this._windowSignals.clear();

        // Clear fullscreen workspace tracking
        this._fullscreenWorkspaces.clear();

        // Clear workspace settings
        this._mutterSettings = null;
        this._wmPreferences = null;

        // Reset creation guard flag
        this._isCreatingWorkspace = false;
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

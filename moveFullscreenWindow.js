// moveFullscreenWindow.js

class MoveFullscreenWindow {
    constructor() {
        this._windowSignals = new Map();
        this._windowAddedId = null;
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
            this._disconnectWindowSignals(window);
        });

        this._windowSignals.set(window, {
            fullscreen: fullscreenId,
            unmanaged: unmanagedId,
        });

        // Store original workspace of the window
        if (!window._originalWorkspace) {
            window._originalWorkspace = window.get_workspace();
        }

        // Check initial fullscreen state
        if (window.fullscreen) {
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
        if (window.fullscreen) {
            // Move window to new workspace
            this._moveWindowToNewWorkspace(window);
        } else {
            // Restore window to original workspace
            this._restoreWindowToOriginalWorkspace(window);
        }
    }

    _moveWindowToNewWorkspace(window) {
        // Create a new workspace after the current one
        let currentWorkspace = window.get_workspace();
        let workspaceManager = global.workspace_manager;
        let newWorkspace = workspaceManager.append_new_workspace(false, workspaceManager.n_workspaces);

        // Move the window to the new workspace
        window.change_workspace(newWorkspace);

        // Switch to the new workspace
        newWorkspace.activate(global.get_current_time());

        // Store the original workspace if not already stored
        if (!window._originalWorkspace) {
            window._originalWorkspace = currentWorkspace;
        }
    }

    _restoreWindowToOriginalWorkspace(window) {
        // Move the window back to its original workspace
        if (window._originalWorkspace) {
            window.change_workspace(window._originalWorkspace);

            // Switch to the original workspace
            window._originalWorkspace.activate(global.get_current_time());

            window._originalWorkspace = null;
        }

        // Remove empty workspaces
        this._removeEmptyWorkspaces();
    }

    _removeEmptyWorkspaces() {
        let workspaceManager = global.workspace_manager;
        for (let i = workspaceManager.n_workspaces - 1; i >= 0; i--) {
            let ws = workspaceManager.get_workspace_by_index(i);
            if (ws.list_windows().length === 0 && i !== 0) {
                workspaceManager.remove_workspace(ws, global.get_current_time());
            }
        }
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

        // Disconnect signals for each window
        for (let [window, signalIds] of moveFullscreenWindowInstance._windowSignals) {
            window.disconnect(signalIds.fullscreen);
            window.disconnect(signalIds.unmanaged);
        }
        moveFullscreenWindowInstance._windowSignals.clear();

        moveFullscreenWindowInstance = null;
    }
}

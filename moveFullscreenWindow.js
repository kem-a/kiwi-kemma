// moveFullscreenWindow.js
export class MoveFullscreenWindow {
    constructor() {
        this._windowSignal = null;
    }

    enable() {
        this._windowSignal = global.window_manager.connect('notify::showing', this._moveToWorkspace.bind(this));
    }

    disable() {
        if (this._windowSignal) {
            global.window_manager.disconnect(this._windowSignal);
            this._windowSignal = null;
        }
    }

    _moveToWorkspace() {
        let window = global.display.focus_window;
        if (window && window.fullscreen) {
            // Code for moving window to new workspace when fullscreen and restoring it back to original workspace
        }
    }
};


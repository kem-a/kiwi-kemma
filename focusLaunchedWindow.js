// focusLaunchedWindow.js
export class FocusLaunchedWindow {
    enable() {
        this._windowSignal = global.display.connect('window-created', this._onWindowCreated.bind(this));
    }

    disable() {
        if (this._windowSignal) {
            global.display.disconnect(this._windowSignal);
            this._windowSignal = null;
        }
    }

    _onWindowCreated(display, window) {
        if (window) {
            window.activate(global.get_current_time());
        }
    }
}


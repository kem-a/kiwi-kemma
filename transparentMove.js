// transparentMove.js
export class TransparentMove {
    enable() {
        this._windowSignal = global.display.connect('notify::window-moved', this._onWindowMove.bind(this));
    }

    disable() {
        if (this._windowSignal) {
            global.display.disconnect(this._windowSignal);
            this._windowSignal = null;
        }
    }

    _onWindowMove(display, window) {
        window.set_opacity(128); // make the window semi-transparent
    }
};
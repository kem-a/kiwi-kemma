// focusLaunchedWindow.js
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class FocusMyWindow {
    enable() {
        this._handlerid = global.display.connect('window-demands-attention', (display, window) => {
            Main.activateWindow(window);
        });
    }

    disable() {
        if (this._handlerid) {
            global.display.disconnect(this._handlerid);
            this._handlerid = null;
        }
    }
}

let focusMyWindowInstance = null;

export function enable() {
    if (!focusMyWindowInstance) {
        focusMyWindowInstance = new FocusMyWindow();
        focusMyWindowInstance.enable();
    }
}

export function disable() {
    if (focusMyWindowInstance) {
        focusMyWindowInstance.disable();
        focusMyWindowInstance = null;
    }
}


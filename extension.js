import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

export default class FullscreenWorkspaceExtension extends Extension {
    enable() {
        this._fullscreenWindow = null;
        this._previousWorkspace = null;

        // Connect to the 'window-created' signal to handle new windows
        this._windowCreatedSignal = global.display.connect('window-created', this._onWindowCreated.bind(this));

        // Monitor mouse movements to slide the top bar
        this._monitorMouseMovement();
    }

    disable() {
        // Disconnect signals and clean up
        global.display.disconnect(this._windowCreatedSignal);
        if (this._mouseSignal) {
            global.stage.disconnect(this._mouseSignal);
        }
        if (this._windowSignals) {
            this._windowSignals.forEach(signal => signal.window.disconnect(signal.id));
        }
    }

    _monitorMouseMovement() {
        this._mouseSignal = global.stage.connect('motion-event', () => {
            if (Main.overview.visible) return;

            let [x, y] = global.get_pointer();

            // Detect when the mouse touches the top of the screen
            if (y <= 2) {
                this._showTopBar();
            } else if (y > 50) {
                this._hideTopBar();
            }
        });
    }

    _showTopBar() {
        if (!Main.panel.visible) {
            Main.panel.show();
            Main.panel.ease({
                opacity: 255,
                time: 0.25,
                transition: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    _hideTopBar() {
        if (Main.panel.visible) {
            Main.panel.ease({
                opacity: 0,
                time: 0.25,
                transition: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    Main.panel.hide();
                },
            });
        }
    }

    _onWindowCreated(display, window) {
        if (!window) return;

        const fullscreenChangedId = window.connect('notify::fullscreen', this._onFullscreenChanged.bind(this));

        if (!this._windowSignals) {
            this._windowSignals = [];
        }

        this._windowSignals.push({ window, id: fullscreenChangedId });
    }

    _onFullscreenChanged(window) {
        if (window.fullscreen) {
            this._fullscreenWindow = window;
            this._previousWorkspace = window.get_workspace();
            // Move the fullscreen window to a new empty workspace
        } else {
            this._fullscreenWindow = null;
            this._previousWorkspace = null;
        }
    }
}

function init() {
    return new FullscreenWorkspaceExtension();
}
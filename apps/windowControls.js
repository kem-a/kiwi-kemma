import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

let controlsIndicator = null;
let settings = null;

const WindowControlsIndicator = GObject.registerClass(
class WindowControlsIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'window-controls', false);

        settings = Extension.lookupByUUID('kiwi@kemma').getSettings();
        this._settingsChangedId = settings.connect('changed', (_, key) => {
            if (key === 'button-type') {
                this._updateIcons();
            } else if (key === 'show-controls-on-maximize') {
                this._updateVisibility();
            }
        });

        // Get the extension path
        const extensionPath = Extension.lookupByUUID('kiwi@kemma').path;
        this._iconPath = extensionPath;

        this._box = new St.BoxLayout({ style_class: 'window-controls-box' });
        this.add_child(this._box);

        this._closeButton = new St.Button({ 
            style_class: 'window-control-button close',
            track_hover: true 
        });
        this._minimizeButton = new St.Button({ 
            style_class: 'window-control-button minimize',
            track_hover: true 
        });
        this._maximizeButton = new St.Button({ 
            style_class: 'window-control-button maximize',
            track_hover: true 
        });

        // Add button state tracking
        ['minimize', 'maximize', 'close'].forEach(buttonType => {
            const button = this[`_${buttonType}Button`];
            button.connect('notify::hover', () => this._updateButtonIcon(buttonType));
            button.connect('button-press-event', () => {
                button.add_style_pseudo_class('active');
                this._updateButtonIcon(buttonType);
            });
            button.connect('button-release-event', () => {
                button.remove_style_pseudo_class('active');
                this._updateButtonIcon(buttonType);
            });
        });

        this._minimizeButton.connect('clicked', () => {
            const window = global.display.focus_window;
            if (window) window.minimize();
        });

        this._maximizeButton.connect('clicked', () => {
            const window = global.display.focus_window;
            if (window) {
                if (window.get_maximized()) {
                    window.unmaximize(Meta.MaximizeFlags.BOTH);
                } else {
                    window.maximize(Meta.MaximizeFlags.BOTH);
                }
            }
        });

        this._closeButton.connect('clicked', () => {
            const window = global.display.focus_window;
            if (window) window.delete(global.get_current_time());
        });

        this._box.add_child(this._closeButton);
        this._box.add_child(this._minimizeButton);
        this._box.add_child(this._maximizeButton);

        this._updateIcons();

        // Initialize properties
        this._focusWindow = null;
        this._focusWindowMaximizeSignal = null;
        this._focusWindowFullscreenSignal = null;

        // Connect to focused window changes
        this._focusWindowSignal = global.display.connect('notify::focus-window',
            this._onFocusWindowChanged.bind(this));
        
        // Add overview signals
        this._overviewShowingId = Main.overview.connect('showing', () => this._updateVisibility());
        this._overviewHidingId = Main.overview.connect('hiding', () => this._updateVisibility());
        
        this._updateVisibility();
    }

    _onFocusWindowChanged() {
        // Disconnect previous signals
        if (this._focusWindow) {
            if (this._focusWindowMaximizeHorizSignal) {
                this._focusWindow.disconnect(this._focusWindowMaximizeHorizSignal);
                this._focusWindowMaximizeHorizSignal = null;
            }
            if (this._focusWindowMaximizeVertSignal) {
                this._focusWindow.disconnect(this._focusWindowMaximizeVertSignal);
                this._focusWindowMaximizeVertSignal = null;
            }
            if (this._focusWindowFullscreenSignal) {
                this._focusWindow.disconnect(this._focusWindowFullscreenSignal);
                this._focusWindowFullscreenSignal = null;
            }
        }

        // Get the new focused window
        this._focusWindow = global.display.focus_window;

        // Connect to the new window's signals
        if (this._focusWindow) {
            this._focusWindowMaximizeHorizSignal = this._focusWindow.connect(
                'notify::maximized-horizontally',
                this._updateVisibility.bind(this)
            );
            this._focusWindowMaximizeVertSignal = this._focusWindow.connect(
                'notify::maximized-vertically',
                this._updateVisibility.bind(this)
            );
            this._focusWindowFullscreenSignal = this._focusWindow.connect(
                'notify::fullscreen',
                this._updateVisibility.bind(this)
            );
        }

        // Update visibility
        this._updateVisibility();
    }

    _updateButtonIcon(buttonType) {
        const button = this[`_${buttonType}Button`];
        const isMaximized = buttonType === 'maximize' && 
            global.display.focus_window?.get_maximized();
        
        let state = '';
        if (button.has_style_pseudo_class('active')) {
            state = '-active';
        } else if (button.hover) {
            state = '-hover';
        }

        const buttonName = isMaximized ? 'restore' : buttonType;
        const iconName = `button-${buttonName}${state}.svg`;
        const iconPath = `${this._iconPath}/icons/${settings.get_string('button-type')}/${iconName}`;
        
        button.child = new St.Icon({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) }),
            icon_size: 16
        });
    }

    _updateIcons() {
        ['minimize', 'maximize', 'close'].forEach(buttonType => 
            this._updateButtonIcon(buttonType));
    }

    _updateVisibility() {
        const focusWindow = this._focusWindow;
        const isMaximizedHorizontally = focusWindow && focusWindow.maximized_horizontally;
        const isMaximizedVertically = focusWindow && focusWindow.maximized_vertically;
        const isMaximized = isMaximizedHorizontally && isMaximizedVertically;
        const isFullscreen = focusWindow && focusWindow.is_fullscreen();
        const showOnMaximize = settings.get_boolean('show-controls-on-maximize');

        // Show controls based on settings and window state
        this.visible = !Main.overview.visible && 
                      focusWindow && 
                      ((showOnMaximize && isMaximized) || isFullscreen);
    }

    destroy() {
        if (this._focusWindowSignal) {
            global.display.disconnect(this._focusWindowSignal);
        }
        if (this._settingsChangedId) {
            settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
        }
        if (this._overviewHidingId) {
            Main.overview.disconnect(this._overviewHidingId);
        }

        // Disconnect from focused window signals
        if (this._focusWindow) {
            if (this._focusWindowMaximizeHorizSignal) {
                this._focusWindow.disconnect(this._focusWindowMaximizeHorizSignal);
                this._focusWindowMaximizeHorizSignal = null;
            }
            if (this._focusWindowMaximizeVertSignal) {
                this._focusWindow.disconnect(this._focusWindowMaximizeVertSignal);
                this._focusWindowMaximizeVertSignal = null;
            }
            if (this._focusWindowFullscreenSignal) {
                this._focusWindow.disconnect(this._focusWindowFullscreenSignal);
                this._focusWindowFullscreenSignal = null;
            }
            this._focusWindow = null;
        }

        super.destroy();
    }
});

export function enable() {
    if (!controlsIndicator) {
        controlsIndicator = new WindowControlsIndicator();
        
        // Insert controls at position 1 (after Activities button)
        Main.panel.addToStatusArea('window-controls', controlsIndicator, 1, 'left');
    }
}

export function disable() {
    if (controlsIndicator) {
        controlsIndicator.destroy();
        controlsIndicator = null;
    }
}
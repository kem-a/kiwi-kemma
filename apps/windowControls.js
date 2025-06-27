// windowControls.js - Adds window controls to the top panel
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

let controlsIndicator = null;
let settings = null;

const WindowControlsIndicator = GObject.registerClass(
class WindowControlsIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'window-controls', false);

        settings = Extension.lookupByUUID('kiwi@kemma').getSettings();
        this._settingsChangedId = settings.connect('changed', (_, key) => {
            if (key === 'button-type') this._updateIcons();
            else if (key === 'show-window-controls' || key === 'enable-app-window-buttons') this._updateVisibility();
        });

        this._iconPath = Extension.lookupByUUID('kiwi@kemma').path;
        this._box = new St.BoxLayout({ style_class: 'window-controls-box' });
        this.add_child(this._box);

        this._closeButton = new St.Button({ style_class: 'window-control-button close', track_hover: true });
        this._minimizeButton = new St.Button({ style_class: 'window-control-button minimize', track_hover: true });
        this._maximizeButton = new St.Button({ style_class: 'window-control-button maximize', track_hover: true });

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
                if (window.is_fullscreen()) window.unmake_fullscreen();
                else if (window.get_maximized()) window.unmaximize(Meta.MaximizeFlags.BOTH);
                else window.maximize(Meta.MaximizeFlags.BOTH);
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
        
        this._focusWindowSignal = global.display.connect('notify::focus-window', this._onFocusWindowChanged.bind(this));
        this._overviewShowingId = Main.overview.connect('showing', () => this._updateVisibility());
        this._overviewHiddenId = Main.overview.connect('hidden', () => {
            this._onFocusWindowChanged();
            this._updateVisibility();
        });
        
        this._updateVisibility();
    }

    _onFocusWindowChanged() {
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

        this._focusWindow = global.display.focus_window;

        if (this._focusWindow) {
            this._focusWindowMaximizeHorizSignal = this._focusWindow.connect('notify::maximized-horizontally', this._updateVisibility.bind(this));
            this._focusWindowMaximizeVertSignal = this._focusWindow.connect('notify::maximized-vertically', this._updateVisibility.bind(this));
            this._focusWindowFullscreenSignal = this._focusWindow.connect('notify::fullscreen', this._updateVisibility.bind(this));
        }

        this._updateVisibility();
    }

    _updateButtonIcon(buttonType) {
        const button = this[`_${buttonType}Button`];
        const isMaximized = buttonType === 'maximize' && global.display.focus_window?.get_maximized();
        const state = button.has_style_pseudo_class('active') ? '-active' : button.hover ? '-hover' : '';
        const buttonName = isMaximized ? 'restore' : buttonType;
        const iconName = `button-${buttonName}${state}.svg`;
        
        button.child = new St.Icon({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this._iconPath}/icons/${settings.get_string('button-type')}/${iconName}`) }),
            icon_size: 16
        });
    }

    _updateIcons() {
        ['minimize', 'maximize', 'close'].forEach(buttonType => this._updateButtonIcon(buttonType));
    }

    _updateVisibility() {
        const focusWindow = this._focusWindow;
        const isMaximized = focusWindow && focusWindow.maximized_horizontally && focusWindow.maximized_vertically;
        const isFullscreen = focusWindow && focusWindow.is_fullscreen();
        
        // Add window exclusion logic with null check for window title
        if (focusWindow) {
            const windowTitle = focusWindow.get_title();
            if (windowTitle && (windowTitle.startsWith('com.') || windowTitle.includes('@!0,0'))) {
                this.hide();
                return;
            }
        }

        this.visible = !Main.overview.visible && focusWindow && 
            settings.get_boolean('enable-app-window-buttons') && 
            settings.get_boolean('show-window-controls') && 
            (isMaximized || isFullscreen);
    }

    destroy() {
        if (this._focusWindowSignal) global.display.disconnect(this._focusWindowSignal);
        if (this._settingsChangedId) settings.disconnect(this._settingsChangedId);
        if (this._overviewShowingId) Main.overview.disconnect(this._overviewShowingId);
        if (this._overviewHiddenId) Main.overview.disconnect(this._overviewHiddenId);

        if (this._focusWindow) {
            if (this._focusWindowMaximizeHorizSignal) this._focusWindow.disconnect(this._focusWindowMaximizeHorizSignal);
            if (this._focusWindowMaximizeVertSignal) this._focusWindow.disconnect(this._focusWindowMaximizeVertSignal);
            if (this._focusWindowFullscreenSignal) this._focusWindow.disconnect(this._focusWindowFullscreenSignal);
        }

        super.destroy();
    }
});

export function enable() {
    if (!controlsIndicator) {
        controlsIndicator = new WindowControlsIndicator();
        Main.panel.addToStatusArea('window-controls', controlsIndicator, 1, 'left');
    }
}

export function disable() {
    if (controlsIndicator) {
        controlsIndicator.destroy();
        controlsIndicator = null;
    }
}
// windowControls.js - Adds window controls to the top panel
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

let controlsIndicator = null;

// Title buttons hover module management
class TitleButtonsHoverManager {
    constructor() {
        this._originalGtkModules = null;
        this._envFileWritten = false;
    }

    _envDir() {
        const home = GLib.get_home_dir();
        return `${home}/.config/environment.d`;
    }

    _envFile() {
        return `${this._envDir()}/10-gtk3.conf`;
    }

    _writeEnvironmentFile(modulePath) {
        try {
            const dir = this._envDir();
            GLib.mkdir_with_parents(dir, 0o755);

            const file = this._envFile();
            const content = `GTK_MODULES="${modulePath}"\n`;

            const [ok, bytesWritten] = GLib.file_set_contents(file, content);
            if (!ok) return false;

            GLib.chmod(file, 0o644);
            this._envFileWritten = true;
            return true;
        } catch (e) {
            return false;
        }
    }

    _removeEnvironmentFile() {
        try {
            const file = this._envFile();
            if (!GLib.file_test(file, GLib.FileTest.EXISTS)) return;
            try {
                GLib.unlink(file);
            } catch (e) {
                // ignore
            }
            this._envFileWritten = false;
        } catch (e) {
            // ignore
        }
    }

    enable() {
        try {
            const extension = Extension.lookupByUUID('kiwi@kemma');
            const modulePath = `${extension.path}/icons/libtitlebuttons_hover.so`;

            if (!GLib.file_test(modulePath, GLib.FileTest.EXISTS)) {
                return;
            } else {
                this._writeEnvironmentFile(modulePath);
            }

            this._originalGtkModules = GLib.getenv('GTK_MODULES');
            GLib.setenv('GTK_MODULES', modulePath, true);
        } catch (error) {
            // ignore
        }
    }

    disable() {
        try {
            if (this._originalGtkModules !== null) {
                if (this._originalGtkModules === '') {
                    GLib.unsetenv('GTK_MODULES');
                } else {
                    GLib.setenv('GTK_MODULES', this._originalGtkModules, true);
                }
            } else {
                GLib.unsetenv('GTK_MODULES');
            }

            this._removeEnvironmentFile();
        } catch (error) {
            // ignore
        }
    }
}

const WindowControlsIndicator = GObject.registerClass(
class WindowControlsIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'window-controls', false);

        this._settings = Extension.lookupByUUID('kiwi@kemma').getSettings();
        this._settingsChangedId = this._settings.connect('changed', (_, key) => {
            if (key === 'button-type') this._updateIcons();
            else if (key === 'show-window-controls' || key === 'enable-app-window-buttons') this._updateVisibility();
        });

        this._iconPath = Extension.lookupByUUID('kiwi@kemma').path;
        this._box = new St.BoxLayout({ style_class: 'window-controls-box' });
        this.add_child(this._box);
        
        // Track hover state for all-buttons-hover effect
        this._isContainerHovered = false;

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
            // Add enter/leave events for all-buttons-hover effect
            button.connect('enter-event', () => {
                this._isContainerHovered = true;
                this._updateAllIcons();
            });
            button.connect('leave-event', () => {
                this._isContainerHovered = false;
                this._updateAllIcons();
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
        const isFullscreen = global.display.focus_window?.is_fullscreen();
        // When in fullscreen, the minimize button should be disabled (non-reactive) and not show hover/active variants
        if (buttonType === 'minimize' && isFullscreen && this._settings.get_boolean('enable-app-window-buttons') && this._settings.get_boolean('show-window-controls')) {
            // Force base icon, ignore hover/active state
            button.reactive = false; // makes it "insensitive" visually via St
            button.remove_style_pseudo_class('active');
            const iconName = 'button-minimize.svg';
            button.child = new St.Icon({
                gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this._iconPath}/icons/${this._settings.get_string('button-type')}/${iconName}`) }),
                icon_size: 16
            });
            return;
        } else if (buttonType === 'minimize') {
            // Restore reactivity when leaving fullscreen
            button.reactive = true;
        }
        
        // Use hover state if the button is individually hovered OR if the container is hovered
        const isHovered = button.hover || this._isContainerHovered;
        const state = button.has_style_pseudo_class('active') ? '-active' : isHovered ? '-hover' : '';
        const buttonName = isMaximized ? 'restore' : buttonType;
        const iconName = `button-${buttonName}${state}.svg`;
        
        button.child = new St.Icon({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this._iconPath}/icons/${this._settings.get_string('button-type')}/${iconName}`) }),
            icon_size: 16
        });
    }

    _updateAllIcons() {
        ['minimize', 'maximize', 'close'].forEach(buttonType => this._updateButtonIcon(buttonType));
    }

    _updateIcons() {
        this._updateAllIcons();
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
            this._settings.get_boolean('enable-app-window-buttons') && 
            this._settings.get_boolean('show-window-controls') && 
            (isMaximized || isFullscreen);

        // Update minimize button sensitivity depending on fullscreen state
        if (this._minimizeButton) {
            if (this.visible && isFullscreen) {
                this._minimizeButton.reactive = false;
            } else {
                this._minimizeButton.reactive = true;
            }
        }
    }

    destroy() {
        if (this._focusWindowSignal) global.display.disconnect(this._focusWindowSignal);
        if (this._settingsChangedId) this._settings.disconnect(this._settingsChangedId);
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

let titleButtonsHoverManager = null;

export function enable() {
    if (!controlsIndicator) {
        controlsIndicator = new WindowControlsIndicator();
        Main.panel.addToStatusArea('window-controls', controlsIndicator, 1, 'left');
    }

    // Enable title buttons hover effect
    if (!titleButtonsHoverManager) {
        titleButtonsHoverManager = new TitleButtonsHoverManager();
    }
    titleButtonsHoverManager.enable();
}

export function disable() {
    if (controlsIndicator) {
        controlsIndicator.destroy();
        controlsIndicator = null;
    }

    // Disable title buttons hover effect
    if (titleButtonsHoverManager) {
        titleButtonsHoverManager.disable();
    }
}
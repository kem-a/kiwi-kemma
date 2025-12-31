// SPDX-License-Identifier: GPL-3.0-or-later
// Adds macOS-style window control buttons to the GNOME top panel.

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

let controlsIndicator = null;

const WindowControlsIndicator = GObject.registerClass(
class WindowControlsIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'window-controls', false);

        this._settings = Extension.lookupByUUID('kiwi@kemma').getSettings();
        this._settingsChangedId = this._settings.connect('changed', (_, key) => {
            if (key === 'button-type') this._updateAllIcons();
            else if (key === 'button-size') this._updateButtonSizeClass();
            else if (key === 'show-window-controls' || key === 'enable-app-window-buttons') this._updateVisibility();
        });

    this._iconPath = Extension.lookupByUUID('kiwi@kemma').path;
    this._iconsRootPath = `${this._iconPath}/icons`;
        this._box = new St.BoxLayout({ style_class: 'window-controls-box' });
        this.add_child(this._box);
        
        // Track hover state for all-buttons-hover effect
        this._isContainerHovered = false;

        this._closeButton = new St.Button({ style_class: 'window-control-button close', track_hover: true });
        this._minimizeButton = new St.Button({ style_class: 'window-control-button minimize', track_hover: true });
        this._maximizeButton = new St.Button({ style_class: 'window-control-button maximize', track_hover: true });

        // Suppress initial hover visuals when entering fullscreen until actual pointer motion
        this._suppressHoverUntilPointerMove = false;
        this._closeButtonDelayActive = false; // hidden delay after entering fullscreen
        this._closeDelayTimeoutId = null;
        this._lastIsFullscreen = false;
        this._lastIsMaximized = false; // track maximized state changes
        this._fullscreenWindowSerial = 0; // increment when fullscreen window context changes
        try {
            this._box.connect('motion-event', () => {
                if (this._suppressHoverUntilPointerMove) {
                    this._suppressHoverUntilPointerMove = false;
                    this._updateAllIcons();
                }
                return Clutter.EVENT_PROPAGATE;
            });
            
            // Add leave event for the main container to reset hover state
            this._box.connect('leave-event', () => {
                this._isContainerHovered = false;
                this._updateAllIcons();
                return Clutter.EVENT_PROPAGATE;
            });
        } catch (_) {}

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
                if (this._suppressHoverUntilPointerMove) {
                    this._suppressHoverUntilPointerMove = false;
                }
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
                if (window.is_fullscreen()) {
                    window.unmake_fullscreen();
                } else if (window.maximized_horizontally && window.maximized_vertically) {
                    // Handle both GNOME 48 and 49 - try without args first (GNOME 49), then with flags (GNOME 48)
                    try {
                        window.unmaximize();
                    } catch (e) {
                        // Fallback for GNOME 48 - unmaximize with flags
                        window.unmaximize(Meta.MaximizeFlags.BOTH);
                    }
                } else {
                    // Handle both GNOME 48 and 49 - try without args first (GNOME 49), then with flags (GNOME 48)
                    try {
                        window.maximize();
                    } catch (e) {
                        // Fallback for GNOME 48 - maximize with flags
                        window.maximize(Meta.MaximizeFlags.BOTH);
                    }
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

        this._updateAllIcons();
        
        this._focusWindowSignal = global.display.connect('notify::focus-window', this._onFocusWindowChanged.bind(this));
        this._overviewShowingId = Main.overview.connect('showing', () => this._updateVisibility());
        this._overviewHiddenId = Main.overview.connect('hidden', () => {
            this._onFocusWindowChanged();
            this._updateVisibility();
        });
        
        // Handle screen shield (lock screen) events
        this._screenShield = Main.screenShield;
        if (this._screenShield) {
            this._screenShieldActiveId = this._screenShield.connect('active-changed', () => {
                // When screen is unlocked, re-evaluate window state after a short delay
                if (!this._screenShield.active) {
                    if (this._screenShieldTimeoutId) {
                        try { GLib.source_remove(this._screenShieldTimeoutId); } catch (_) {}
                        this._screenShieldTimeoutId = null;
                    }
                    this._screenShieldTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                        this._screenShieldTimeoutId = null;
                        this._onFocusWindowChanged();
                        this._updateVisibility();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
        }
        
        this._updateVisibility();
        this._updateButtonSizeClass();
    }

    _updateButtonSizeClass() {
        const buttonSize = this._settings.get_string('button-size');
        if (buttonSize === 'small') {
            this._box.add_style_class_name('small-size');
        } else {
            this._box.remove_style_class_name('small-size');
        }
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
    const win = global.display.focus_window;

    // Robust maximized detection across GNOME versions
    let isMaximized = false;
    if (buttonType === 'maximize' && win) {
        // Common properties on many GNOME versions
        if (win.maximized_horizontally && win.maximized_vertically) {
            isMaximized = true;
        } else if (typeof win.get_maximized === 'function') {
            // Fallback to flags when available
            try {
                const flags = win.get_maximized();
                if ((flags & Meta.MaximizeFlags.HORIZONTAL) && (flags & Meta.MaximizeFlags.VERTICAL))
                    isMaximized = true;
            } catch (_) {}
        } else if (typeof win.is_maximized === 'function') {
            // Older API fallback
            try { isMaximized = !!win.is_maximized(); } catch (_) {}
        }
    }
    const isFullscreen = !!win && typeof win.is_fullscreen === 'function' && win.is_fullscreen();
        // When in fullscreen, the minimize button should be disabled (non-reactive) and not show hover/active variants
        if (buttonType === 'minimize' && isFullscreen && this._settings.get_boolean('enable-app-window-buttons') && this._settings.get_boolean('show-window-controls')) {
            // Force base icon, ignore hover/active state
            button.reactive = false; // makes it "insensitive" visually via St
            button.remove_style_pseudo_class('active');
            // Use backdrop variant to visually indicate disabled state
            const iconName = 'button-minimize-backdrop.png';
            this._setButtonIcon(button, iconName);
            return;
        } else if (buttonType === 'minimize') {
            // Restore reactivity when leaving fullscreen
            button.reactive = true;
        }
        
        // Use hover state if the button is individually hovered OR if the container is hovered
        let isHovered = button.hover || this._isContainerHovered;
        if (this._suppressHoverUntilPointerMove)
            isHovered = false; // force neutral until user actually moves pointer
        const state = button.has_style_pseudo_class('active') ? '-active' : isHovered ? '-hover' : '';
        
        // For maximize button: show restore icon when window is maximized OR fullscreen
        const buttonName = (buttonType === 'maximize' && (isMaximized || isFullscreen)) ? 'restore' : buttonType;
        const iconName = `button-${buttonName}${state}.png`;
        this._setButtonIcon(button, iconName);
    }

    _updateAllIcons() {
        ['minimize', 'maximize', 'close'].forEach(buttonType => this._updateButtonIcon(buttonType));
    }



    _updateVisibility() {
        const focusWindow = this._focusWindow;
        // Use robust maximized detection (match _updateButtonIcon)
        let isMaximized = false;
        if (focusWindow) {
            if (focusWindow.maximized_horizontally && focusWindow.maximized_vertically) {
                isMaximized = true;
            } else if (typeof focusWindow.get_maximized === 'function') {
                try {
                    const flags = focusWindow.get_maximized();
                    if ((flags & Meta.MaximizeFlags.HORIZONTAL) && (flags & Meta.MaximizeFlags.VERTICAL))
                        isMaximized = true;
                } catch (_) {}
            } else if (typeof focusWindow.is_maximized === 'function') {
                try { isMaximized = !!focusWindow.is_maximized(); } catch (_) {}
            }
        }
        const isFullscreen = !!focusWindow && typeof focusWindow.is_fullscreen === 'function' && focusWindow.is_fullscreen();
        
        // Store previous state for transition detection
        const wasVisible = this.visible;
        const wasMaximized = this._lastIsMaximized || false;
        
        // Add window exclusion logic with null check for window title
        if (focusWindow) {
            const windowTitle = focusWindow.get_title();
            if (windowTitle) {
                const normalizedTitle = windowTitle.trim().toLowerCase();
                if (normalizedTitle.startsWith('com.') || normalizedTitle.startsWith('gjs') || normalizedTitle.includes('@!0,0')) {
                    this.hide();
                    return;
                }
            }
            if (windowTitle && !windowTitle.trim()) {
                this.hide();
                return;
            }

            const tracker = Shell.WindowTracker.get_default();
            const app = tracker ? tracker.get_window_app(focusWindow) : null;
            const appName = app ? app.get_name() : null;
            const normalizedAppName = appName ? appName.trim().toLowerCase() : '';
            if (normalizedAppName.startsWith('com.') || normalizedAppName.startsWith('gjs')) {
                this.hide();
                return;
            }
        }

        this.visible = !Main.overview.visible && focusWindow && 
            this._settings.get_boolean('enable-app-window-buttons') && 
            this._settings.get_boolean('show-window-controls') && 
            (isMaximized || isFullscreen);

        // Reset hover state when window state changes or when becoming visible/hidden
        if (this.visible !== wasVisible || isMaximized !== wasMaximized) {
            this._isContainerHovered = false;
            // Force all buttons to lose hover state
            ['minimize', 'maximize', 'close'].forEach(buttonType => {
                const button = this[`_${buttonType}Button`];
                if (button) {
                    button.hover = false;
                }
            });
        }

        // Update minimize button sensitivity depending on fullscreen state
        if (this._minimizeButton) {
            if (this.visible && isFullscreen) {
                this._minimizeButton.reactive = false;
            } else {
                this._minimizeButton.reactive = true;
            }
        }

        // Hidden delay logic for close button after entering fullscreen
        if (this.visible && isFullscreen) {
            if (!this._lastIsFullscreen) {
                // Transitioned into fullscreen
                this._applyCloseButtonDelay();
            } else if (this._closeButtonDelayActive) {
                // keep disabled until timeout completes
                this._closeButton.reactive = false;
            }
        } else {
            // Leaving fullscreen or hidden
            this._clearCloseButtonDelay();
            this._closeButton.reactive = true;
        }

        this._lastIsFullscreen = isFullscreen;
        this._lastIsMaximized = isMaximized;

        // When becoming visible in fullscreen, suppress hover visuals until pointer moves
        if (this.visible && isFullscreen) {
            if (!this._suppressHoverUntilPointerMove) {
                this._suppressHoverUntilPointerMove = true;
                this._updateAllIcons();
            }
        } else if (!isFullscreen && this._suppressHoverUntilPointerMove) {
            this._suppressHoverUntilPointerMove = false;
            this._updateAllIcons();
        }
        
        // Update all icons after state changes
        this._updateAllIcons();
    }

    _applyCloseButtonDelay() {
        // Clear any existing
        this._clearCloseButtonDelay();
        // Activate delay
        this._closeButtonDelayActive = true;
        this._closeButton.reactive = false;
        const serial = ++this._fullscreenWindowSerial;
        // 3000 ms hidden delay
        this._closeDelayTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
            // Only lift delay if still same fullscreen context and still fullscreen
            if (this._closeDelayTimeoutId) {
                this._closeDelayTimeoutId = null;
            }
            if (this._closeButtonDelayActive && this._lastIsFullscreen && serial === this._fullscreenWindowSerial) {
                this._closeButtonDelayActive = false;
                this._closeButton.reactive = true;
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearCloseButtonDelay() {
        if (this._closeDelayTimeoutId) {
            try { GLib.source_remove(this._closeDelayTimeoutId); } catch (_) {}
            this._closeDelayTimeoutId = null;
        }
        if (this._closeButtonDelayActive) {
            this._closeButtonDelayActive = false;
            if (this._closeButton)
                this._closeButton.reactive = true;
        }
    }

    _setButtonIcon(button, iconName) {
        const monitor = Main.layoutManager.primaryMonitor;
        const scaleFactor = monitor ? monitor.geometry_scale : 1;
        const file = this._getIconFile(iconName, scaleFactor);
        
        button.child = new St.Icon({
            gicon: new Gio.FileIcon({ file }),
            style_class: 'window-control-icon',
        });
    }

    _getIconFile(iconName, scaleFactor = 1) {
        const buttonType = this._settings.get_string('button-type');
        const isAltTheme = buttonType === 'titlebuttons-alt';
        const baseFolder = isAltTheme ? 'titlebuttons' : buttonType;
        const basePath = `${this._iconsRootPath}/${baseFolder}`;

        const getScaledName = (name) => {
            if (scaleFactor >= 1.5 && name.endsWith('.png')) {
                return `${name.slice(0, -4)}@2.png`;
            }
            return name;
        };

        if (isAltTheme) {
            const altName = this._getAltVariant(iconName);
            if (altName) {
                const scaledAltName = getScaledName(altName);
                const scaledAltFile = Gio.File.new_for_path(`${basePath}/${scaledAltName}`);
                if (scaledAltFile.query_exists(null))
                    return scaledAltFile;
                
                const altFile = Gio.File.new_for_path(`${basePath}/${altName}`);
                if (altFile.query_exists(null))
                    return altFile;
            }
        }

        const scaledName = getScaledName(iconName);
        const scaledFile = Gio.File.new_for_path(`${basePath}/${scaledName}`);
        if (scaledFile.query_exists(null))
            return scaledFile;

        const fallbackFile = Gio.File.new_for_path(`${basePath}/${iconName}`);
        if (fallbackFile.query_exists(null))
            return fallbackFile;

        const defaultScaledFile = Gio.File.new_for_path(`${this._iconsRootPath}/titlebuttons/${scaledName}`);
        if (defaultScaledFile.query_exists(null))
            return defaultScaledFile;

        return Gio.File.new_for_path(`${this._iconsRootPath}/titlebuttons/${iconName}`);
    }

    _getAltVariant(iconName) {
        if (!/-hover|-active/.test(iconName))
            return null;
        if (!iconName.endsWith('.png'))
            return null;
        return `${iconName.slice(0, -4)}-alt.png`;
    }

    destroy() {
        if (this._focusWindowSignal) global.display.disconnect(this._focusWindowSignal);
        if (this._settingsChangedId) this._settings.disconnect(this._settingsChangedId);
        if (this._overviewShowingId) Main.overview.disconnect(this._overviewShowingId);
        if (this._overviewHiddenId) Main.overview.disconnect(this._overviewHiddenId);
        if (this._screenShieldActiveId && this._screenShield) this._screenShield.disconnect(this._screenShieldActiveId);
    if (this._screenShieldTimeoutId) { try { GLib.source_remove(this._screenShieldTimeoutId); } catch (_) {} this._screenShieldTimeoutId = null; }

        if (this._focusWindow) {
            if (this._focusWindowMaximizeHorizSignal) this._focusWindow.disconnect(this._focusWindowMaximizeHorizSignal);
            if (this._focusWindowMaximizeVertSignal) this._focusWindow.disconnect(this._focusWindowMaximizeVertSignal);
            if (this._focusWindowFullscreenSignal) this._focusWindow.disconnect(this._focusWindowFullscreenSignal);
        }

    this._clearCloseButtonDelay();

        super.destroy();
    }
});

export function enable() {
    if (!controlsIndicator) {
        controlsIndicator = new WindowControlsIndicator();
        
        // Count total elements in the left side of the panel
        const leftBoxChildren = Main.panel._leftBox.get_children();
        const totalElements = leftBoxChildren.length;
        
        // Place window controls at second-to-last position (since window title is last)
        const position = Math.max(0, totalElements - 1);
        
        Main.panel.addToStatusArea('window-controls', controlsIndicator, position, 'left');
    }
}

export function disable() {
    if (controlsIndicator) {
        controlsIndicator.destroy();
        controlsIndicator = null;
    }
}
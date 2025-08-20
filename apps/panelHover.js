import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GObject from 'gi://GObject';

let fullscreenWindows = new Set();
let windowSignals = new Map();
let windowCreatedHandler = null;
let panelHideTimeoutId = null;
let hotCorner = null;
let panelContainer = null;

function _getPanelContainer() {
    if (!panelContainer) {
        panelContainer = Main.panelManager?.primaryPanel?.widget ?? Main.layoutManager.panelBox;
    }
    return panelContainer;
}

function showPanel() {
    let container = _getPanelContainer();
    container.get_parent().set_child_above_sibling(container, null);
    container.ease({
        translation_y: 0,
        duration: 200,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

function hidePanel() {
    let container = _getPanelContainer();
    container.ease({
        translation_y: -Main.panel.height,
        duration: 200,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

const PanelEdge = GObject.registerClass(
class PanelEdge extends Clutter.Actor {
    _init() {
        super._init({
            name: 'panel-edge-detector',
            reactive: true,
            x: 0,
            y: 0,
            width: global.stage.width,
            height: 10,  // Increased height for better detection
            opacity: 0  // Make it invisible
        });

        // Set up barrier
        let primaryMonitor = global.display.get_primary_monitor();
        let geometry = global.display.get_monitor_geometry(primaryMonitor);
        
        this._barrier = new Meta.Barrier({
            backend: global.backend,
            x1: geometry.x,
            x2: geometry.x + geometry.width,
            y1: geometry.y,
            y2: geometry.y,
            directions: Meta.BarrierDirection.POSITIVE_Y
        });

        // Listen for pressure based trigger
        this._barrier.connect('triggered', this._onTrigger.bind(this));

        // Keep actor above fullscreen windows
        global.window_group.set_child_above_sibling(this, null);

        // Add hover detection
        this.connect('enter-event', this._onEnter.bind(this));
        this.connect('leave-event', this._onLeave.bind(this));
    }

    destroy() {
        if (this._barrier) {
            this._barrier.destroy();
            this._barrier = null;
        }
        super.destroy();
    }

    _onTrigger() {
        log('[PanelHover] Pressure barrier triggered');
        if (fullscreenWindows.size > 0) {
            this._showPanel();
        }
    }

    _onEnter() {
        log('[PanelHover] Edge entered');
        if (fullscreenWindows.size > 0) {
            this._showPanel();
        }
    }

    _onLeave() {
        log('[PanelHover] Edge left');
        if (fullscreenWindows.size > 0) {
            if (panelHideTimeoutId) {
                GLib.source_remove(panelHideTimeoutId);
            }
            panelHideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                const [, mouseY] = global.get_pointer();
                if (mouseY > Main.panel.height) {
                    this._hidePanel();
                }
                panelHideTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _showPanel() {
        log('[PanelHover] Showing panel');
        showPanel();
    }

    _hidePanel() {
        log('[PanelHover] Hiding panel');
        hidePanel();
    }
});

function _connectWindowSignals(window) {
    if (windowSignals.has(window)) {
        return;
    }

    let fullscreenId = window.connect('notify::fullscreen', () => {
        _onWindowFullscreenChanged(window);
    });

    let unmanagedId = window.connect('unmanaged', () => {
        _disconnectWindowSignals(window);
    });

    windowSignals.set(window, {
        fullscreen: fullscreenId,
        unmanaged: unmanagedId,
    });

    // Check initial fullscreen state
    if (window.is_fullscreen()) {
        _onWindowFullscreenChanged(window);
    }
}

function _disconnectWindowSignals(window) {
    if (windowSignals.has(window)) {
        let signalIds = windowSignals.get(window);
        window.disconnect(signalIds.fullscreen);
        window.disconnect(signalIds.unmanaged);
        windowSignals.delete(window);
    }
}

function _onWindowCreated(display, window) {
    if (!window) return;
    log('[PanelHover] Window created');
    _connectWindowSignals(window);
}

function _onWindowFullscreenChanged(window) {
    if (window.is_fullscreen()) {
        fullscreenWindows.add(window);
        log(`[PanelHover] Window entered fullscreen. Count: ${fullscreenWindows.size}`);
        hidePanel();
    } else {
        fullscreenWindows.delete(window);
        log(`[PanelHover] Window exited fullscreen. Count: ${fullscreenWindows.size}`);
        if (fullscreenWindows.size === 0) {
            log('[PanelHover] No fullscreen windows, resetting panel');
            showPanel();
        }
    }
}

export function enable() {
    log('[PanelHover] Enabling extension');
    disable();

    hotCorner = new PanelEdge();
    Main.layoutManager.addChrome(hotCorner, {
        trackFullscreen: true,
        affectsStruts: false,
        affectsInputRegion: true
    });

    // Connect to existing windows
    global.get_window_actors().forEach(actor => {
        let window = actor.meta_window;
        _connectWindowSignals(window);
    });

    windowCreatedHandler = global.display.connect('window-created', _onWindowCreated);
}

export function disable() {
    log('[PanelHover] Disabling extension');
    
    if (hotCorner) {
        hotCorner.destroy();
        hotCorner = null;
    }

    if (windowCreatedHandler) {
        global.display.disconnect(windowCreatedHandler);
        windowCreatedHandler = null;
    }

    if (panelHideTimeoutId) {
        GLib.source_remove(panelHideTimeoutId);
        panelHideTimeoutId = null;
    }

    // Disconnect window signals
    windowSignals.forEach((signalIds, window) => {
        window.disconnect(signalIds.fullscreen);
        window.disconnect(signalIds.unmanaged);
    });
    windowSignals.clear();
    fullscreenWindows.clear();

    // Ensure panel is restored
    showPanel();
    panelContainer = null;
}

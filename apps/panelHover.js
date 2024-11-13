import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

let panelHideTimeoutId = null;
let mouseTrackingHandler = null;
let windowCreatedHandler = null;
let fullscreenWindows = new Set();

function onWindowCreated(display, metaWindow) {
    if (!metaWindow) return;
    
    // Connect to window state changes
    metaWindow.connect('notify::fullscreen', () => {
        if (metaWindow.is_fullscreen()) {
            fullscreenWindows.add(metaWindow);
        } else {
            fullscreenWindows.delete(metaWindow);
        }
        
        // Reset panel position when no fullscreen windows
        if (fullscreenWindows.size === 0) {
            Main.panel.set_style('margin-top: 0px');
        }
    });
}

function onMotionEvent(actor, event) {
    if (fullscreenWindows.size === 0) return Clutter.EVENT_PROPAGATE;
    
    const panel = Main.panel;
    const [mouseX, mouseY] = event.get_coords();
    const panelHeight = panel.height;
    
    if (mouseY <= 1) {
        if (panelHideTimeoutId) {
            GLib.source_remove(panelHideTimeoutId);
            panelHideTimeoutId = null;
        }
        panel.set_style('margin-top: 0px');
    } else if (mouseY > panelHeight) {
        if (!panelHideTimeoutId) {
            panelHideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                if (fullscreenWindows.size > 0) {
                    panel.set_style(`margin-top: -${panelHeight}px`);
                }
                panelHideTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        }
    }
    
    return Clutter.EVENT_PROPAGATE;
}

export function enable() {
    disable(); // Clean up existing handlers
    
    // Track existing windows
    let windows = global.get_window_actors()
        .map(actor => actor.meta_window)
        .filter(win => win.is_fullscreen());
    
    windows.forEach(win => fullscreenWindows.add(win));
    
    // Set up handlers
    mouseTrackingHandler = global.stage.connect('motion-event', onMotionEvent);
    windowCreatedHandler = global.display.connect('window-created', onWindowCreated);
    
    Main.panel.set_style('margin-top: 0px');
}

export function disable() {
    if (mouseTrackingHandler) {
        global.stage.disconnect(mouseTrackingHandler);
        mouseTrackingHandler = null;
    }
    
    if (windowCreatedHandler) {
        global.display.disconnect(windowCreatedHandler);
        windowCreatedHandler = null;
    }
    
    if (panelHideTimeoutId) {
        GLib.source_remove(panelHideTimeoutId);
        panelHideTimeoutId = null;
    }
    
    fullscreenWindows.clear();
    Main.panel.set_style('margin-top: 0px');
}

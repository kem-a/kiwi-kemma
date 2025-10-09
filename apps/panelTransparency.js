// SPDX-License-Identifier: GPL-3.0-or-later
// Dynamically adjusts top panel transparency based on window and overview state.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

let settings;
let windowSignals = [];
let settingsSignals = [];
let interfaceSettings;
let originalStyle;
let isUpdatingStyle = false;
let interfaceSettingsSignal;
let timeoutId;
let safetyIntervalId;
let lastForcedAlpha = null; // remember last alpha decided by logic (touch/fullscreen)
let lastFullscreenState = false; // edge-detect fullscreen state changes

// Panel color fix helper
function applyPanelColorFix() {
    const panel = Main.panel;
    if (!panel) return;
    
    if (settings && settings.get_boolean('panel-color-inherit')) {
        panel.add_style_class_name('kiwi-panel-color-inherit');
    } else {
        panel.remove_style_class_name('kiwi-panel-color-inherit');
    }
}

function setOpaqueImmediately() {
    const panel = Main.panel;
    if (!panel) return;
    try {
        // Remove transparency-related inline style & refresh style class to force theme re-evaluation
        panel.set_style('');
        panel.remove_style_class_name('panel');
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            try {
                panel.add_style_class_name('panel');
                const themeNode = panel.get_theme_node();
                const bg = themeNode.get_background_color();
                const r = Math.floor(bg.red * 255);
                const g = Math.floor(bg.green * 255);
                const b = Math.floor(bg.blue * 255);
                panel.set_style(`background-color: rgb(${r}, ${g}, ${b}) !important;`);
                panel.queue_redraw();
            } catch (_) {
                if (originalStyle) panel.set_style(originalStyle);
            }
            return GLib.SOURCE_REMOVE;
        });
    } catch (e) {
        if (originalStyle) panel.set_style(originalStyle);
    }
}

function _isFullscreenActive() {
    try {
        return global.workspace_manager
            .get_active_workspace()
            .list_windows()
            .some(win =>
                win.showing_on_its_workspace() &&
                !win.is_hidden() &&
                typeof win.is_fullscreen === 'function' && win.is_fullscreen());
    } catch (_e) {
        return false;
    }
}

function updatePanelStyle(alpha = null) {
    const panel = Main.panel;
    if (isUpdatingStyle || !panel) return;
    isUpdatingStyle = true;
    
    try {
        // Use CSS class-based approach for fullscreen state to avoid oscillation
        const fullscreenNow = _isFullscreenActive();
        
        // Edge-detect fullscreen state changes
        if (fullscreenNow !== lastFullscreenState) {
            lastFullscreenState = fullscreenNow;
            
            if (fullscreenNow) {
                // Add CSS class for fullscreen - stylesheet.css handles opaque background
                panel.add_style_class_name('kiwi-panel-fullscreen');
                lastForcedAlpha = 1.0;
            } else {
                // Remove fullscreen class, restore transparency handling
                panel.remove_style_class_name('kiwi-panel-fullscreen');
                lastForcedAlpha = null;
            }
        }
        
        // In overview, always transparent
        if (Main.overview.visible) {
            panel.set_style('background-color: transparent !important;');
            panel.queue_redraw();
            return;
        }

        // If fullscreen is active, CSS class handles it - skip inline style
        if (fullscreenNow) {
            // Clear any inline style to let CSS rule take effect
            panel.set_style('');
            panel.queue_redraw();
            return;
        }

        // Get theme colors for non-fullscreen states
        const themeNode = panel.get_theme_node();
        const backgroundColor = themeNode.get_background_color();
        const [r, g, b] = [
            Math.floor(backgroundColor.red * 255),
            Math.floor(backgroundColor.green * 255),
            Math.floor(backgroundColor.blue * 255)
        ];

        if (!settings?.get_boolean('panel-transparency')) {
            panel.set_style(`background-color: rgb(${r}, ${g}, ${b}) !important;`);
            panel.queue_redraw();
            return;
        }

        if (alpha !== null) {
            lastForcedAlpha = alpha;
        }
        const opacity = (alpha !== null ? alpha : (lastForcedAlpha !== null ? lastForcedAlpha : settings.get_int('panel-transparency-level') / 100));
        const newStyle = `background-color: rgba(${r}, ${g}, ${b}, ${opacity}) !important;`;
        
        if (panel.get_style() !== newStyle) {
            panel.set_style(newStyle);
            panel.queue_redraw();
        }
    } catch (error) {
        panel.set_style(originalStyle || '');
    } finally {
        isUpdatingStyle = false;
    }
}

function checkWindowTouchingPanel() {
    if (!settings?.get_boolean('panel-transparency') || 
        !settings.get_boolean('panel-opaque-on-window')) {
        // Even if opaque-on-window is disabled, fullscreen should force opaque
        if (_isFullscreenActive()) {
            updatePanelStyle(1.0);
        } else {
            // Clear any stale forced alpha (e.g., from prior fullscreen)
            if (lastForcedAlpha !== null) {
                lastForcedAlpha = null;
            }
            updatePanelStyle(null);
        }
        return;
    }

    const panel = Main.panel;
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const [, panelTop] = panel.get_transformed_position();
    const threshold = 5 * scale;

    const windowTouching = global.workspace_manager
        .get_active_workspace()
        .list_windows()
        .some(win => 
            win.is_on_primary_monitor() &&
            win.showing_on_its_workspace() &&
            !win.is_hidden() &&
            win.get_window_type() !== Meta.WindowType.DESKTOP &&
            !win.skip_taskbar &&
            win.get_frame_rect().y <= (panelTop + panel.height + threshold)
        );
    if (_isFullscreenActive()) {
        updatePanelStyle(1.0);
    } else {
        updatePanelStyle(windowTouching ? 1.0 : null);
        if (!windowTouching && lastForcedAlpha !== null) {
            // Clear forced alpha when no condition applies
            lastForcedAlpha = null;
        }
    }
}

function handleWindowSignals(connect = true) {
    if (!connect) {
        windowSignals.forEach(({ actor, signals }) => {
            signals.forEach(signalId => actor.disconnect(signalId));
        });
        windowSignals = [];
        return;
    }

    const workspace = global.workspace_manager.get_active_workspace();
    const workspaceSignals = [];

    workspaceSignals.push(workspace.connect('window-added', (ws, win) => {
        connectWindowSignals(win);
        checkWindowTouchingPanel();
    }));

    workspaceSignals.push(workspace.connect('window-removed', (ws, win) => {
        disconnectWindowSignals(win);
        checkWindowTouchingPanel();
    }));

    windowSignals.push({ actor: workspace, signals: workspaceSignals });

    workspace.list_windows().forEach(win => {
        connectWindowSignals(win);
    });
}

function connectWindowSignals(metaWindow) {
    const actorSignals = [];

    actorSignals.push(metaWindow.connect('position-changed', () => {
        checkWindowTouchingPanel();
    }));

    actorSignals.push(metaWindow.connect('size-changed', () => {
        checkWindowTouchingPanel();
    }));

    // Track state changes (fullscreen, maximized, etc.)
    actorSignals.push(metaWindow.connect('notify::fullscreened', () => {
        checkWindowTouchingPanel();
    }));
    actorSignals.push(metaWindow.connect('notify::maximized-horizontally', () => {
        checkWindowTouchingPanel();
    }));
    actorSignals.push(metaWindow.connect('notify::maximized-vertically', () => {
        checkWindowTouchingPanel();
    }));

    actorSignals.push(metaWindow.connect('unmanaged', () => {
        disconnectWindowSignals(metaWindow);
        checkWindowTouchingPanel();
    }));

    windowSignals.push({ actor: metaWindow, signals: actorSignals });
}

function disconnectWindowSignals(metaWindow) {
    const index = windowSignals.findIndex(item => item.actor === metaWindow);
    if (index !== -1) {
        const { signals } = windowSignals[index];
        signals.forEach(signalId => {
            try {
                metaWindow.disconnect(signalId);
            } catch (e) {}
        });
        windowSignals.splice(index, 1);
    }
}

function setupSignals() {
    settingsSignals.forEach(signal => {
        try {
            settings.disconnect(signal);
        } catch (e) {}
    });
    settingsSignals = [];

    settingsSignals = [
    settings.connect('changed::panel-transparency', () => {
            handleWindowSignals(false);
            if (settings.get_boolean('panel-transparency')) {
                handleWindowSignals(true);
                checkWindowTouchingPanel();
            } else {
        lastForcedAlpha = null;
                // Stop periodic checks before applying opaque style
                if (safetyIntervalId) {
                    GLib.source_remove(safetyIntervalId);
                    safetyIntervalId = null;
                }
                setOpaqueImmediately();
                // Force an additional idle update to lock in opaque style
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    updatePanelStyle(1.0); // will early path due to transparency disabled
                    return GLib.SOURCE_REMOVE;
                });
            }
        }),
        settings.connect('changed::panel-transparency-level', () => {
            updatePanelStyle(null);
        }),
        settings.connect('changed::panel-opaque-on-window', () => {
            checkWindowTouchingPanel();
        }),
        settings.connect('changed::panel-color-inherit', () => {
            applyPanelColorFix();
        })
    ];

    handleWindowSignals(true);

    windowSignals.push({
        actor: global.window_manager,
        signals: [
            global.window_manager.connect('switch-workspace', () => {
                checkWindowTouchingPanel();
            })
        ]
    });

    windowSignals.push({
        actor: global.display,
        signals: [
            global.display.connect('window-entered-monitor', () => {
                checkWindowTouchingPanel();
            }),
            global.display.connect('window-left-monitor', () => {
                checkWindowTouchingPanel();
            }),
            // Fullscreen enter/leave signals (GNOME Shell provides these on display)
            // Fallback: if signals are not available, they just won't fire.
            (() => { try { return global.display.connect('window-entered-fullscreen', () => { updatePanelStyle(); }); } catch(_e) { return 0; } })(),
                (() => { try { return global.display.connect('window-left-fullscreen', () => { 
                    // Fullscreen exited: if opaque-on-window disabled, restore configured transparency.
                    if (!settings.get_boolean('panel-opaque-on-window')) {
                        lastForcedAlpha = null; // allow normal transparency level
                        updatePanelStyle(null);
                    } else {
                        checkWindowTouchingPanel();
                    }
                 }); } catch(_e) { return 0; } })(),
            (() => { try { return global.display.connect('in-fullscreen-changed', () => { checkWindowTouchingPanel(); }); } catch(_e) { return 0; } })()
        ]
    });

    windowSignals.push({
        actor: Main.overview,
        signals: [
            Main.overview.connect('showing', () => {
                updatePanelStyle();
            }),
            Main.overview.connect('hiding', () => {
                const panel = Main.panel;
                const themeNode = panel.get_theme_node();
                const backgroundColor = themeNode.get_background_color();
                const [r, g, b] = [
                    Math.floor(backgroundColor.red * 255),
                    Math.floor(backgroundColor.green * 255),
                    Math.floor(backgroundColor.blue * 255)
                ];
                panel.set_style(`background-color: rgba(${r}, ${g}, ${b}, 0) !important;`);
            }),
            Main.overview.connect('hidden', () => {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    checkWindowTouchingPanel();
                    return GLib.SOURCE_REMOVE;
                });
            })
        ]
    });
}

function forceThemeUpdate() {
    const panel = Main.panel;
    panel.remove_style_class_name('panel');
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        panel.add_style_class_name('panel');
        panel.style = null;
        updatePanelStyle();
        return GLib.SOURCE_REMOVE;
    });
}

export function init(extensionSettings) {
    settings = extensionSettings;
}

export function enable(_settings) {
    settings = _settings;
    if (!settings) return;
    
    originalStyle = Main.panel.get_style();
    interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    interfaceSettingsSignal = interfaceSettings.connect('changed::color-scheme', () => {
        forceThemeUpdate();
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            updatePanelStyle();
            return GLib.SOURCE_REMOVE;
        });
    });

    setupSignals();

    if (settings.get_boolean('panel-transparency')) {
        updatePanelStyle();
    } else {
        setOpaqueImmediately();
    }
    forceThemeUpdate();

    // Apply panel color fix on startup
    applyPanelColorFix();

    timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        checkWindowTouchingPanel();
        timeoutId = null;
        return GLib.SOURCE_REMOVE;
    });

    // Lightweight periodic safety check (every 2s) to catch missed transitions (uses full logic)
    safetyIntervalId = GLib.timeout_add(GLib.PRIORITY_LOW, 2000, () => {
        if (!settings) return GLib.SOURCE_REMOVE;
        checkWindowTouchingPanel();
        return GLib.SOURCE_CONTINUE;
    });
}

export function disable() {
    if (timeoutId) {
        GLib.source_remove(timeoutId);
        timeoutId = null;
    }
    if (safetyIntervalId) {
        GLib.source_remove(safetyIntervalId);
        safetyIntervalId = null;
    }
    
    settingsSignals.forEach(signal => {
        try {
            settings.disconnect(signal);
        } catch (e) {}
    });
    settingsSignals = [];

    handleWindowSignals(false);

    if (interfaceSettingsSignal) {
        interfaceSettings.disconnect(interfaceSettingsSignal);
        interfaceSettingsSignal = null;
    }
    interfaceSettings = null;

    // Remove CSS class and force opaque restore
    try {
        const panel = Main.panel;
        panel.remove_style_class_name('kiwi-panel-fullscreen');
        panel.remove_style_class_name('kiwi-panel-color-inherit');
        if (originalStyle) {
            panel.set_style(originalStyle);
        } else {
            setOpaqueImmediately();
        }
    } catch (_) {}

    settings = null;
    lastForcedAlpha = null;
    lastFullscreenState = false;
}
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

const DARK_PANEL_FALLBACK_RGB = [18, 18, 18];
const LUMINANCE_DARK_THRESHOLD = 0.38;
const LUMINANCE_TEXT_THRESHOLD = 0.45;

function _srgbToLinear(component) {
    const value = component / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function _calculateRelativeLuminance(r, g, b) {
    const lr = _srgbToLinear(r);
    const lg = _srgbToLinear(g);
    const lb = _srgbToLinear(b);
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function _shouldPreferDarkColors() {
    if (!interfaceSettings) return false;
    try {
        const scheme = interfaceSettings.get_string('color-scheme');
        return scheme === 'prefer-dark' || scheme === 'force-dark';
    } catch (_e) {
        return false;
    }
}

function _getTextColorForBackground(r, g, b) {
    const luminance = _calculateRelativeLuminance(r, g, b);
    return luminance > LUMINANCE_TEXT_THRESHOLD ? 'rgba(0, 0, 0, 0.87)' : 'rgba(255, 255, 255, 0.94)';
}

function _getPanelBaseColor({ strictTheme = false } = {}) {
    const panel = Main.panel;
    const themeNode = panel?.get_theme_node();
    if (!themeNode) {
        return {
            rgb: DARK_PANEL_FALLBACK_RGB,
            textColor: _getTextColorForBackground(...DARK_PANEL_FALLBACK_RGB)
        };
    }

    let r = Math.floor(themeNode.get_background_color().red * 255);
    let g = Math.floor(themeNode.get_background_color().green * 255);
    let b = Math.floor(themeNode.get_background_color().blue * 255);

    const luminance = _calculateRelativeLuminance(r, g, b);
    if (!strictTheme && _shouldPreferDarkColors() && luminance > LUMINANCE_DARK_THRESHOLD) {
        [r, g, b] = DARK_PANEL_FALLBACK_RGB;
    }

    return {
        rgb: [r, g, b],
        textColor: _getTextColorForBackground(r, g, b)
    };
}

function _applyPanelStyle(panel, r, g, b, alpha, textColor) {
    if (!panel) return '';
    const clampedAlpha = typeof alpha === 'number' ? Math.min(Math.max(alpha, 0), 1) : 1;
    const backgroundColor = clampedAlpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`;
    const newStyle = `background-color: ${backgroundColor} !important; color: ${textColor} !important;`;

    if (panel.get_style() !== newStyle) {
        panel.set_style(newStyle);
    }
    panel.queue_redraw();
    return newStyle;
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
                const { rgb: [r, g, b], textColor } = _getPanelBaseColor({ strictTheme: true });
                _applyPanelStyle(panel, r, g, b, 1, textColor);
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
    // NOTE: A pure CSS alternative could add style classes (e.g., 'fullscreen-has-window')
    // and define them in stylesheet.css. Current approach sets inline style for dynamic RGBA.
        const { rgb: [r, g, b], textColor } = _getPanelBaseColor();

        if (Main.overview.visible) {
            _applyPanelStyle(panel, r, g, b, 0, textColor);
            return;
        }

        // Force opaque when any fullscreen window is active regardless of other transparency logic
        if (_isFullscreenActive()) {
            lastForcedAlpha = 1.0;
            _applyPanelStyle(panel, r, g, b, 1, textColor);
            return;
        }

        if (!settings?.get_boolean('panel-transparency')) {
            _applyPanelStyle(panel, r, g, b, 1, textColor);
            return;
        }

        if (alpha !== null) {
            lastForcedAlpha = alpha;
        }
        const opacity = alpha !== null
            ? alpha
            : (lastForcedAlpha !== null ? lastForcedAlpha : settings.get_int('panel-transparency-level') / 100);

        _applyPanelStyle(panel, r, g, b, opacity, textColor);
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
                const { rgb: [r, g, b], textColor } = _getPanelBaseColor();
                _applyPanelStyle(panel, r, g, b, 0, textColor);
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

    // Force opaque restore using captured original style (or recomputed) before dropping references
    try {
        if (originalStyle) {
            Main.panel.set_style(originalStyle);
        } else {
            setOpaqueImmediately();
        }
    } catch (_) {}

    settings = null;
    lastForcedAlpha = null;
}
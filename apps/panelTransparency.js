// SPDX-License-Identifier: GPL-3.0-or-later
// Dynamically adjusts top panel transparency based on window and overview state.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

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

// Blur state
let blurEffect = null;
let blurBackgroundGroup = null;
let blurWidget = null;
let blurSizeSignals = [];
let blurPaintSignals = []; // paint signal connections to force blur repaint

// --- Panel blur helpers ---
// Uses the same approach as blur-my-shell: a Meta.BackgroundGroup (width/height 0)
// containing an St.Widget with Shell.BlurEffect, inserted at index 0 of panelBox.
// Meta.BackgroundGroup doesn't participate in layout allocation, so it won't
// create a "second panel" like a bare St.Widget would.

function createBlurEffect() {
    destroyBlurEffect();

    const panel = Main.panel;
    const panelBox = panel?.get_parent();
    if (!panel || !panelBox) return;

    // Container that doesn't affect layout
    blurBackgroundGroup = new Meta.BackgroundGroup({
        name: 'kiwi-panel-blur-group',
        width: 0,
        height: 0,
    });

    // Widget sized to match panel — carries the blur effect
    blurWidget = new St.Widget({ name: 'kiwi-panel-blur' });

    blurEffect = new Shell.BlurEffect({
        mode: Shell.BlurMode.BACKGROUND,
        radius: 30,
        brightness: 1.0,
    });
    blurWidget.add_effect(blurEffect);

    blurBackgroundGroup.insert_child_at_index(blurWidget, 0);
    panelBox.insert_child_at_index(blurBackgroundGroup, 0);

    // Size/position the blur widget to match the panel
    _updateBlurSize();

    // Track panel position/size changes
    blurSizeSignals.push(
        panel.connect('notify::position', _updateBlurSize),
        panel.connect('notify::size', _updateBlurSize),
    );
    blurSizeSignals.push(
        panelBox.connect('notify::size', _updateBlurSize),
        panelBox.connect('notify::position', _updateBlurSize),
    );

    // Force blur repaint when background actors repaint.
    // Shell.BlurEffect with BACKGROUND mode relies on reading the framebuffer
    // beneath the widget, but the compositor's clipped-redraws optimization
    // often skips repainting the blur when only the background changes.
    // This is the same workaround used by blur-my-shell (GNOME Shell #2857).
    _connectPaintSignals();
}

function _connectPaintSignals() {
    _disconnectPaintSignals();
    if (!blurEffect) return;

    const backgroundGroup = Main.layoutManager._backgroundGroup;
    if (!backgroundGroup) return;

    // Connect to each current background actor
    for (const bg of backgroundGroup) {
        _connectBgActor(bg);
    }

    // Re-connect when background actors are added/removed (monitor or wallpaper changes)
    const addId = backgroundGroup.connect('child-added', (_group, child) => {
        _connectBgActor(child);
    });
    const removeId = backgroundGroup.connect('child-removed', (_group, child) => {
        // Remove entries for the departing actor (don't disconnect — it's already gone)
        blurPaintSignals = blurPaintSignals.filter(s => s.actor !== child);
    });
    blurPaintSignals.push({ actor: backgroundGroup, id: addId });
    blurPaintSignals.push({ actor: backgroundGroup, id: removeId });

    // Also repaint when the stage is painted (catches remaining cases)
    const stage = global.stage;
    if (stage) {
        const id = stage.connect('after-paint', () => {
            if (blurEffect && blurWidget?.visible)
                blurEffect.queue_repaint();
        });
        blurPaintSignals.push({ actor: stage, id });
    }
}

function _connectBgActor(bg) {
    const contentId = bg.connect('notify::content', () => {
        if (blurEffect) blurEffect.queue_repaint();
    });
    // Auto-cleanup when the actor is destroyed (avoids accessing disposed objects)
    const destroyId = bg.connect('destroy', () => {
        blurPaintSignals = blurPaintSignals.filter(s => s.actor !== bg);
    });
    blurPaintSignals.push({ actor: bg, id: contentId });
    blurPaintSignals.push({ actor: bg, id: destroyId });
}

function _disconnectPaintSignals() {
    // Copy and clear first so destroy-signal callbacks don't mutate mid-iteration
    const signals = blurPaintSignals;
    blurPaintSignals = [];
    for (const { actor, id } of signals) {
        try { actor.disconnect(id); } catch (_) {}
    }
}

function _updateBlurSize() {
    const panel = Main.panel;
    if (!blurWidget || !panel) return;

    blurWidget.set_position(panel.x, panel.y);
    blurWidget.set_size(panel.width, panel.height);
}

function destroyBlurEffect() {
    const panel = Main.panel;
    const panelBox = panel?.get_parent();

    // Disconnect size tracking signals
    if (blurSizeSignals.length > 0) {
        // First two signals are on the panel, last two on panelBox
        if (panel) {
            try { panel.disconnect(blurSizeSignals[0]); } catch (_) {}
            try { panel.disconnect(blurSizeSignals[1]); } catch (_) {}
        }
        if (panelBox) {
            try { panelBox.disconnect(blurSizeSignals[2]); } catch (_) {}
            try { panelBox.disconnect(blurSizeSignals[3]); } catch (_) {}
        }
        blurSizeSignals = [];
    }

    _disconnectPaintSignals();

    if (blurBackgroundGroup) {
        if (panelBox) {
            try { panelBox.remove_child(blurBackgroundGroup); } catch (_) {}
        }
        blurBackgroundGroup.destroy_all_children();
        blurBackgroundGroup.destroy();
        blurBackgroundGroup = null;
    }
    blurWidget = null;
    blurEffect = null;
}

function updateBlurVisibility(visible) {
    if (blurWidget) {
        blurWidget.visible = visible;
    }
}

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
        
        // In overview, always transparent — hide blur
        if (Main.overview.visible) {
            panel.set_style('background-color: transparent !important;');
            updateBlurVisibility(false);
            panel.queue_redraw();
            return;
        }

        // If fullscreen is active, CSS class handles it - skip inline style
        if (fullscreenNow) {
            // Clear any inline style to let CSS rule take effect
            panel.set_style('');
            updateBlurVisibility(false);
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
            updateBlurVisibility(false);
            panel.queue_redraw();
            return;
        }

        if (alpha !== null) {
            lastForcedAlpha = alpha;
        }
        const opacity = (alpha !== null ? alpha : (lastForcedAlpha !== null ? lastForcedAlpha : settings.get_int('panel-transparency-level') / 100));
        const newStyle = `background-color: rgba(${r}, ${g}, ${b}, ${opacity}) !important;`;
        
        // Show/hide blur regardless of whether style string changed
        const blurEnabled = settings?.get_boolean('panel-blur');
        updateBlurVisibility(blurEnabled && opacity < 1.0);

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
            metaWindow.disconnect(signalId);
        });
        windowSignals.splice(index, 1);
    }
}

function setupSignals() {
    settingsSignals.forEach(signal => {
        settings.disconnect(signal);
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
                    GLib.Source.remove(safetyIntervalId);
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
        }),
        settings.connect('changed::panel-blur', () => {
            if (settings.get_boolean('panel-blur')) {
                createBlurEffect();
                checkWindowTouchingPanel();
            } else {
                destroyBlurEffect();
            }
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

    // Create blur effect if blur is enabled
    if (settings.get_boolean('panel-blur')) {
        createBlurEffect();
    }

    timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        checkWindowTouchingPanel();
        timeoutId = null;
        return GLib.SOURCE_REMOVE;
    });

    // Lightweight periodic safety check (every 2s) to catch missed transitions (uses full logic)
    safetyIntervalId = GLib.timeout_add(GLib.PRIORITY_LOW, 2000, () => {
        if (!settings) { safetyIntervalId = null; return GLib.SOURCE_REMOVE; }
        checkWindowTouchingPanel();
        return GLib.SOURCE_CONTINUE;
    });
}

export function disable() {
    if (timeoutId) {
        GLib.Source.remove(timeoutId);
        timeoutId = null;
    }
    if (safetyIntervalId) {
        GLib.Source.remove(safetyIntervalId);
        safetyIntervalId = null;
    }
    
    settingsSignals.forEach(signal => {
        settings.disconnect(signal);
    });
    settingsSignals = [];

    handleWindowSignals(false);

    if (interfaceSettingsSignal) {
        interfaceSettings.disconnect(interfaceSettingsSignal);
        interfaceSettingsSignal = null;
    }
    interfaceSettings = null;

    // Destroy blur effect
    destroyBlurEffect();

    // Remove CSS class and force opaque restore
    const panel = Main.panel;
    panel.remove_style_class_name('kiwi-panel-fullscreen');
    panel.remove_style_class_name('kiwi-panel-color-inherit');
    if (originalStyle) {
        panel.set_style(originalStyle);
    } else {
        setOpaqueImmediately();
    }

    settings = null;
    lastForcedAlpha = null;
    lastFullscreenState = false;
}
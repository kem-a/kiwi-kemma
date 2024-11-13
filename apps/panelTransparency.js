import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

// State management
let settings;
let windowSignals = [];
let settingsSignals = [];
let interfaceSettings;
let originalStyle;
let isUpdatingStyle = false;

function updatePanelStyle(alpha = null) {
    console.log('updatePanel called');
    const panel = Main.panel;
    
    if (isUpdatingStyle || !panel) return;
    
    isUpdatingStyle = true;
    
    try {
        const themeNode = panel.get_theme_node();
        const backgroundColor = themeNode.get_background_color();
        const [r, g, b] = [
            Math.floor(backgroundColor.red * 255),
            Math.floor(backgroundColor.green * 255),
            Math.floor(backgroundColor.blue * 255)
        ];

        // Check if the overview is visible
        if (Main.overview.visible) {
            // Make the panel fully transparent in overview mode
            //panel.set_style('background-color: transparent !important; transition-duration: 250ms;');
            panel.set_style('background-color: transparent !important;');
            console.log('Panel style updated for overview (transparent)');
            return;
        }

        if (!settings?.get_boolean('panel-transparency')) {
            console.log('Panel transparency is disabled');
            panel.set_style(`background-color: rgb(${r}, ${g}, ${b})`);
            return;
        }

        const opacity = alpha ?? settings.get_int('panel-transparency-level') / 100;
        //const newStyle = `background-color: rgba(${r}, ${g}, ${b}, ${opacity}) !important; transition-duration: 250ms;`;
        const newStyle = `background-color: rgba(${r}, ${g}, ${b}, ${opacity}) !important;`;
        
        if (panel.get_style() !== newStyle) {
            console.log('Current panel style:', panel.get_style());
            panel.set_style(newStyle);
            console.log(`Panel style updated with opacity ${opacity}`);
        } else {
            console.log('Style unchanged, current:', panel.get_style());
        }

        // Add stack trace to see what's calling this
        console.log('Call stack:', new Error().stack);
        
    } catch (error) {
        logError(error, 'Failed to update panel style');
        panel.set_style(originalStyle || '');
    } finally {
        isUpdatingStyle = false;
    }
}

function checkWindowTouchingPanel() {
    console.log('checkWindowTouchingPanel called');
    if (!settings?.get_boolean('panel-transparency') || 
        !settings.get_boolean('panel-opaque-on-window')) {
        updatePanelStyle(null);
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

    updatePanelStyle(windowTouching ? 1.0 : null);
    console.log(`Window touching panel: ${windowTouching}`);
}

function handleWindowSignals(connect = true) {
    if (!connect) {
        // Disconnect existing signals
        windowSignals.forEach(({ actor, signals }) => {
            signals.forEach(signalId => actor.disconnect(signalId));
        });
        windowSignals = [];
        return;
    }

    // Connect to 'window-added' and 'window-removed' signals on the active workspace
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

    // Connect signals for existing windows
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
            } catch (e) {
                console.error(`Error disconnecting signal: ${e}`);
            }
        });
        windowSignals.splice(index, 1);
    }
}

function setupSignals() {
    // Connect settings signals
    settingsSignals = [
        settings.connect('changed::panel-transparency', () => {
            console.log('panel-transparency setting changed');
            handleWindowSignals(false);
            if (settings.get_boolean('panel-transparency')) {
                handleWindowSignals(true);
                checkWindowTouchingPanel();
            } else {
                updatePanelStyle(null);
            }
        }),
        settings.connect('changed::panel-transparency-level', () => {
            console.log('panel-transparency-level setting changed');
            updatePanelStyle(null);
        }),
        settings.connect('changed::panel-opaque-on-window', () => {
            console.log('panel-opaque-on-window setting changed');
            checkWindowTouchingPanel();
        })
    ];

    // Connect window management signals
    handleWindowSignals(true);

    // Connect to workspace changes
    windowSignals.push({
        actor: global.window_manager,
        signals: [
            global.window_manager.connect('switch-workspace', () => {
                console.log('Workspace switched');
                checkWindowTouchingPanel();
            })
        ]
    });

    // Connect to monitor changes
    windowSignals.push({
        actor: global.display,
        signals: [
            global.display.connect('window-entered-monitor', () => {
                console.log('Window entered monitor');
                checkWindowTouchingPanel();
            }),
            global.display.connect('window-left-monitor', () => {
                console.log('Window left monitor');
                checkWindowTouchingPanel();
            })
        ]
    });

    // Update the overview signal handlers with a delay for hidden state
    windowSignals.push({
        actor: Main.overview,
        signals: [
            Main.overview.connect('showing', () => {
                console.log('Overview showing');
                updatePanelStyle();
            }),
            Main.overview.connect('hidden', () => {
                console.log('Overview hidden');
                // Add delay to allow windows to settle into position
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
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
    console.log('panelTransparency enable called');
    settings = _settings;
    
    if (!settings) return;
    
    originalStyle = Main.panel.get_style();
    interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });

    // Connect settings signals
    settingsSignals = [
        settings.connect('changed::panel-transparency', () => {
            console.log('panel-transparency setting changed');
            if (settings.get_boolean('panel-transparency')) {
                setupSignals();
                checkWindowTouchingPanel();
            } else {
                updatePanelStyle(null);
                handleWindowSignals(false);
            }
        }),
        settings.connect('changed::panel-transparency-level', () => {
            console.log('panel-transparency-level setting changed');
            updatePanelStyle(null);
        }),
        settings.connect('changed::panel-opaque-on-window', () => {
            console.log('panel-opaque-on-window setting changed');
            checkWindowTouchingPanel();
        })
    ];

    setupSignals(); // Initialize signals

    updatePanelStyle();
    forceThemeUpdate();

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        checkWindowTouchingPanel();
        return GLib.SOURCE_REMOVE;
    });
}

export function disable() {
    console.log('panelTransparency disable called');
    settingsSignals.forEach(signal => {
        try {
            settings?.disconnect(signal);
        } catch (e) {
            console.log(`Failed to disconnect settings signal: ${e}`);
        }
    });
    settingsSignals = [];
    
    handleWindowSignals(false);
    
    if (originalStyle) {
        Main.panel.set_style(originalStyle);
    }

    interfaceSettings = null;
    settings = null;
}
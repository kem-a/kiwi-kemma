// SPDX-License-Identifier: GPL-3.0-or-later
// Dynamically adjusts top panel transparency based on window and overview state.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GdkPixbuf from 'gi://GdkPixbuf';
import Clutter from 'gi://Clutter';

import { connectPaintSignal } from './blurPaintSignal.js';

let settings;
let enabled = false;
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

// Adaptive foreground state
let bgSettings;
let bgSignals = [];
let wallpaperLuminance = 0;
let iconTheme;
let monochromeIcons = new Map(); // gicon string -> 'light' | 'dark' | null
let contentIcons = new WeakMap(); // St.ImageContent -> 'light' | 'dark' | null

const SAMPLE_SIZE = 32; // wallpaper is downscaled to this before sampling
const SAMPLE_ROWS = 4;  // top rows only — that's what sits behind the panel
const LIGHT_THRESHOLD = 0.6;
const DARKEN_EFFECT = 'kiwi-tray-darken';
const LIGHTEN_EFFECT = 'kiwi-tray-lighten';
const ICON_SAMPLE_SIZE = 24;
const ICON_SATURATION_MAX = 0.15;    // above this the icon carries real colour
const ICON_LUMINANCE_MIN = 0.6;      // above this the icon counts as light
const ICON_LUMINANCE_MAX_DARK = 0.4; // below this it counts as dark

// Blur state
let blurEffect = null;
let blurBackgroundGroup = null;
let blurWidget = null;
let blurSizeSignals = [];
let blurPaintSignals = []; // paint signal connections to force blur repaint
let blurRepaintIdleId = 0; // idle source for coalesced blur repaints

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

    // Force throttled blur repaints when content above the blur repaints
    // (panel button hover, shadows) — fixes lingering squared artifacts
    // (GNOME Shell #2857).
    connectPaintSignal(blurWidget, _scheduleBlurRepaint);

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

function _scheduleBlurRepaint() {
    if (blurRepaintIdleId || !blurEffect) return;
    blurRepaintIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        blurRepaintIdleId = 0;
        if (blurEffect && blurWidget?.visible)
            blurEffect.queue_repaint();
        return GLib.SOURCE_REMOVE;
    });
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

    // Event-driven repaint: only queue repaint when content actually changes
    const restackedId = global.display.connect('restacked', _scheduleBlurRepaint);
    blurPaintSignals.push({ actor: global.display, id: restackedId });

    const wmSignals = ['map', 'destroy', 'minimize', 'unminimize', 'switch-workspace'];
    for (const sigName of wmSignals) {
        try {
            const id = global.window_manager.connect(sigName, _scheduleBlurRepaint);
            blurPaintSignals.push({ actor: global.window_manager, id });
        } catch (_) {}
    }

    const showId = Main.overview.connect('showing', _scheduleBlurRepaint);
    const hideId = Main.overview.connect('hidden', _scheduleBlurRepaint);
    blurPaintSignals.push({ actor: Main.overview, id: showId });
    blurPaintSignals.push({ actor: Main.overview, id: hideId });
}

function _connectBgActor(bg) {
    const contentId = bg.connect('notify::content', _scheduleBlurRepaint);
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
    if (blurRepaintIdleId) {
        GLib.Source.remove(blurRepaintIdleId);
        blurRepaintIdleId = 0;
    }
}

function _updateBlurSize() {
    const panel = Main.panel;
    if (!blurWidget || !panel) return;

    blurWidget.set_position(panel.x, panel.y);
    blurWidget.set_size(panel.width, panel.height);
    _scheduleBlurRepaint();
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

// --- Adaptive foreground helpers ---
// What sits behind the panel foreground is the panel's own background painted at
// the current opacity over the wallpaper. Measure both, blend them, and force
// the foreground the other way. Neither direction can be left to the theme: a
// dark theme keeps white text over a light wallpaper, and a light one (the Light
// Style extension) keeps dark text over a dark wallpaper.

function _wallpaperPath() {
    if (!bgSettings) return null;
    const dark = interfaceSettings?.get_string('color-scheme') === 'prefer-dark';
    let uri = dark ? bgSettings.get_string('picture-uri-dark') : '';
    if (!uri) uri = bgSettings.get_string('picture-uri');
    if (!uri) return null;
    return Gio.File.new_for_uri(uri).get_path();
}

function updateWallpaperLightness() {
    const path = _wallpaperPath();
    if (!path) {
        wallpaperLuminance = 0;
        return;
    }

    try {
        // preserve_aspect_ratio false: SAMPLE_ROWS is then a fixed fraction of
        // the image height regardless of its dimensions.
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, SAMPLE_SIZE, SAMPLE_SIZE, false);
        const pixels = pixbuf.get_pixels();
        const stride = pixbuf.get_rowstride();
        const channels = pixbuf.get_n_channels();
        const width = pixbuf.get_width();
        const rows = Math.min(SAMPLE_ROWS, pixbuf.get_height());

        let sum = 0;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * stride + x * channels;
                sum += (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
            }
        }
        wallpaperLuminance = sum / (rows * width);
    } catch (_e) {
        // XML slideshows and unreadable files: keep the theme foreground
        wallpaperLuminance = 0;
    }
}

// Tray icons come from apps as raster images, so CSS can't recolour them.
// Brightness -1 maps every pixel to black and +1 to white, both leaving alpha
// alone, so a monochrome icon can be pushed either way. A coloured icon would
// just become a blob, so only icons that measure as monochrome get an effect.
// Returns 'light', 'dark' or null when the icon must be left alone.
function _measureIcon(pixbuf) {
    const pixels = pixbuf.get_pixels();
    const stride = pixbuf.get_rowstride();
    const channels = pixbuf.get_n_channels();
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();

    let saturation = 0;
    let luminance = 0;
    let count = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * stride + x * channels;
            if (pixels[i + 3] < 30) continue; // ignore near-transparent pixels

            const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);

            saturation += max === 0 ? 0 : (max - min) / max;
            luminance += 0.2126 * r + 0.7152 * g + 0.0722 * b;
            count++;
        }
    }

    if (!count || (saturation / count) >= ICON_SATURATION_MAX) return null;

    const mean = luminance / count;
    if (mean > ICON_LUMINANCE_MIN) return 'light';
    if (mean < ICON_LUMINANCE_MAX_DARK) return 'dark';
    return null; // mid grey: pushing it either way is a coin flip
}

function _iconTone(gicon) {
    if (!gicon) return null;

    // AppIndicator wraps file icons in an EmblemedIcon that deliberately breaks
    // to_string(); the inner icon resolves and keys the cache properly.
    if (gicon instanceof Gio.EmblemedIcon)
        gicon = gicon.get_icon();

    const key = gicon.to_string();
    if (key && monochromeIcons.has(key))
        return monochromeIcons.get(key);

    let tone = null;
    try {
        const info = iconTheme.lookup_by_gicon(gicon, ICON_SAMPLE_SIZE, St.IconLookupFlags.FORCE_SIZE);
        const pixbuf = info?.load_icon();
        // Without an alpha channel the icon is a solid rectangle — recolouring
        // it would produce exactly the flat patch this check exists to avoid.
        if (pixbuf?.get_has_alpha())
            tone = _measureIcon(pixbuf);
    } catch (_e) {
        // Unresolvable icon: leave it alone
    }

    if (key) monochromeIcons.set(key, tone);
    return tone;
}

// Indicators that publish IconPixmap over D-Bus instead of an icon name (the
// Nextcloud client, for one) have nothing to look up: AppIndicator paints the
// pixmap straight into an St.ImageContent and leaves the gicon behind. That
// content is a Gio.LoadableIcon, so the image actually on screen can be read
// back and measured with the same test — AppIndicator itself loads it this way
// to build emblems. A new St.ImageContent is created for every pixmap update,
// so keying the cache on the object both caches and invalidates itself.
function _contentTone(content) {
    if (contentIcons.has(content))
        return contentIcons.get(content);

    let tone = null;
    try {
        const [stream] = content.load(ICON_SAMPLE_SIZE, null);
        const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
        if (pixbuf?.get_has_alpha())
            tone = _measureIcon(pixbuf);
    } catch (_e) {
        // Unreadable content: leave it alone
    }

    contentIcons.set(content, tone);
    return tone;
}

function _trayIcons() {
    const icons = [];
    const walk = actor => {
        for (const child of actor.get_children()) {
            if (child instanceof St.Icon &&
                (child.has_style_class_name('appindicator-icon') || child.has_style_class_name('tray-icon')))
                icons.push(child);
            else
                walk(child);
        }
    };
    walk(Main.panel);
    return icons;
}

// mode is 'darken' on a light background, 'lighten' on a dark one, or null to
// leave every icon as its app painted it.
function updateTrayIconInversion(mode) {
    for (const icon of _trayIcons()) {
        // An icon painted from a D-Bus pixmap carries its image in `content`,
        // and the gicon left over from an earlier update may not match it, so
        // measure whichever of the two is the image actually on screen.
        const tone = mode ? (icon.content
            ? _contentTone(icon.content)
            : _iconTone(icon.gicon)) : null;

        // Only push an icon away from the background it sits on.
        const wanted = (mode === 'darken' && tone === 'light') ? DARKEN_EFFECT
            : (mode === 'lighten' && tone === 'dark') ? LIGHTEN_EFFECT
            : null;

        for (const name of [DARKEN_EFFECT, LIGHTEN_EFFECT]) {
            if (name !== wanted && icon.get_effect(name))
                icon.remove_effect_by_name(name);
        }

        if (wanted && !icon.get_effect(wanted)) {
            const effect = new Clutter.BrightnessContrastEffect({ name: wanted });
            effect.set_brightness(wanted === DARKEN_EFFECT ? -1.0 : 1.0);
            icon.add_effect(effect);
        }
    }
}

// St hands out Cogl.Color, whose components are 0..255 bytes.
function _luminance(color) {
    return (0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue) / 255;
}

function _panelLuminance() {
    return _luminance(Main.panel.get_theme_node().get_background_color());
}

// In the overview the panel paints nothing and the shell theme styles its own
// foreground for the overview backdrop, so hand it back untouched.
function clearForegroundContrast() {
    const panel = Main.panel;
    panel.remove_style_class_name('kiwi-panel-dark-text');
    panel.remove_style_class_name('kiwi-panel-light-text');
    updateTrayIconInversion(null);
}

function updateForegroundContrast(opacity, panelLuminance = _panelLuminance()) {
    const panel = Main.panel;
    const behind = opacity * panelLuminance + (1 - opacity) * wallpaperLuminance;
    const dark = behind > LIGHT_THRESHOLD;

    // Both directions need forcing: a light shell theme paints the panel text
    // dark, which disappears once a transparent panel exposes a dark wallpaper.
    panel.remove_style_class_name(dark ? 'kiwi-panel-light-text' : 'kiwi-panel-dark-text');
    panel.add_style_class_name(dark ? 'kiwi-panel-dark-text' : 'kiwi-panel-light-text');

    // Indicators that appear later are picked up by the periodic safety check.
    updateTrayIconInversion(settings?.get_boolean('panel-invert-tray-icons')
        ? (dark ? 'darken' : 'lighten')
        : null);
}

// Panel color fix helper
// The class only sets the panel's *theme* background; the colour that actually
// shows comes from the inline style updatePanelStyle() builds out of
// get_background_color(). So toggling the class changes nothing until the stale
// inline style is dropped and the style recomputed — that is why the old
// behaviour needed an overview trip (which clears the inline style) to show up.
function applyPanelColorFix() {
    const panel = Main.panel;
    if (!panel) return;

    if (settings && settings.get_boolean('panel-color-inherit')) {
        panel.add_style_class_name('kiwi-panel-color-inherit');
    } else {
        panel.remove_style_class_name('kiwi-panel-color-inherit');
    }

    // Clear the inline background so the theme node reports the class colour
    // instead of the rgba() we last wrote, then rebuild it from that reading.
    panel.set_style('');
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (enabled) updatePanelStyle(lastForcedAlpha);
        return GLib.SOURCE_REMOVE;
    });
}

// Transparency is off: hand the panel back to whatever styled it before us.
// Baking in a colour read from the theme node fights the shell theme and any
// other extension that paints the panel inline (e.g. Light Shell).
function restorePanelStyle() {
    const panel = Main.panel;
    if (!panel) return;
    panel.set_style(originalStyle);
    panel.queue_redraw();
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
            clearForegroundContrast();
            panel.queue_redraw();
            return;
        }

        // If fullscreen is active, CSS class handles it - skip inline style
        if (fullscreenNow) {
            // Clear any inline style to let CSS rule take effect
            panel.set_style('');
            updateBlurVisibility(false);
            updateForegroundContrast(1.0);
            panel.queue_redraw();
            return;
        }

        if (!settings?.get_boolean('panel-transparency')) {
            updateBlurVisibility(false);
            updateForegroundContrast(1.0);
            restorePanelStyle();
            return;
        }

        // Get theme colors for non-fullscreen states
        const themeNode = panel.get_theme_node();
        const backgroundColor = themeNode.get_background_color();
        const [r, g, b] = [backgroundColor.red, backgroundColor.green, backgroundColor.blue];

        if (alpha !== null) {
            lastForcedAlpha = alpha;
        }
        const opacity = (alpha !== null ? alpha : (lastForcedAlpha !== null ? lastForcedAlpha : settings.get_int('panel-transparency-level') / 100));
        const newStyle = `background-color: rgba(${r}, ${g}, ${b}, ${opacity}) !important;`;
        
        // Show/hide blur regardless of whether style string changed
        const blurEnabled = settings?.get_boolean('panel-blur');
        updateBlurVisibility(blurEnabled && opacity < 1.0);
        updateForegroundContrast(opacity, _luminance(backgroundColor));

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
            if (settings.get_boolean('panel-transparency')) {
                checkWindowTouchingPanel();
            } else {
                lastForcedAlpha = null;
                updateBlurVisibility(false);
                restorePanelStyle();
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
        settings.connect('changed::panel-invert-tray-icons', () => {
            updatePanelStyle(null);
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
                const backgroundColor = panel.get_theme_node().get_background_color();
                const { red: r, green: g, blue: b } = backgroundColor;
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
    // extension.js re-runs every module's enable() on any settings change, so
    // this must be idempotent — otherwise originalStyle is re-captured from a
    // panel we already made transparent, and timers/signals pile up.
    if (enabled || !_settings) return;
    settings = _settings;
    enabled = true;

    originalStyle = Main.panel.get_style();
    interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    interfaceSettingsSignal = interfaceSettings.connect('changed::color-scheme', () => {
        updateWallpaperLightness();
        forceThemeUpdate();
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            updatePanelStyle();
            return GLib.SOURCE_REMOVE;
        });
    });

    iconTheme = new St.IconTheme();
    bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });
    bgSignals = ['changed::picture-uri', 'changed::picture-uri-dark'].map(key =>
        bgSettings.connect(key, () => {
            updateWallpaperLightness();
            updatePanelStyle();
        }));
    updateWallpaperLightness();

    setupSignals();

    updatePanelStyle();
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
    if (!enabled) return;
    enabled = false;

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

    bgSignals.forEach(signal => bgSettings.disconnect(signal));
    bgSignals = [];
    bgSettings = null;
    wallpaperLuminance = 0;
    iconTheme = null;
    monochromeIcons.clear();
    contentIcons = new WeakMap();

    // Destroy blur effect
    destroyBlurEffect();

    // Remove CSS classes and give the panel its pre-Kiwi style back
    const panel = Main.panel;
    panel.remove_style_class_name('kiwi-panel-fullscreen');
    panel.remove_style_class_name('kiwi-panel-color-inherit');
    clearForegroundContrast();
    restorePanelStyle();

    settings = null;
    originalStyle = null;
    lastForcedAlpha = null;
    lastFullscreenState = false;
}
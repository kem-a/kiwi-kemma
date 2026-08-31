// SPDX-License-Identifier: GPL-3.0-or-later
// Flips the dock's indicator and separator with whatever is behind it - dark over
// light content, light over dark - the way panelTransparency.js flips the top
// panel foreground. The pill answers to the session's own scheme instead, near
// white in a light one and near black in a dark one, and its border is left
// always light so it reads as a glow off the pill either way.
//
// The wallpaper is not the answer here: a window passing under the dock is what
// actually decides whether the dots and separators can be read, and a white
// window over a dark wallpaper is exactly the case that breaks. So the reading
// comes off the composited screen through Shell.Screenshot, from a thin band at
// the dock's own edge of the monitor with the dock's own pixels left out of the
// average - that band is the window that is behind it.
//
// Two of the three colours are not ours to write in CSS. Dash-to-Dock paints the
// background pill with an inline style whenever transparency is not left at
// DEFAULT (theming.js _adjustTheme), and draws the running indicator with Cairo
// from its own colour key rather than the dot's theme node
// (appIconIndicators.js _computeStyle), and an inline style beats a stylesheet in
// St either way. So those two go through Dash-to-Dock's colour keys, and the
// separator - which it does leave to CSS - goes through a class on the container.
// The keys are put back as they were on disable; opacity, borders and the rest
// are never touched.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { dashOf, dockSettings, disconnectAll, prefersDark, watchDocks } from './dockUtils.js';

// What is behind the dock, which the indicator and separator read against
const LIGHT_CLASS = 'kiwi-dock-light';
const DARK_CLASS = 'kiwi-dock-dark';
// The session's own scheme, which the pill follows instead
const SCHEME_LIGHT_CLASS = 'kiwi-dock-scheme-light';
const SCHEME_DARK_CLASS = 'kiwi-dock-scheme-dark';

// Only the colours. background-opacity and the indicator border keys stay the
// user's, so the dock keeps the weight they gave it and only changes hue.
const DOT_KEY = 'custom-theme-running-dots-color';
const PILL_KEY = 'background-color';
const SAVED_KEYS = [DOT_KEY, PILL_KEY];

// At the opacity Dash-to-Dock paints the pill, what shows through it comes
// mostly from behind the dock - so that, not the pill, is what the indicator has
// to read against.
const DOT_COLOR = { light: 'rgb(28,28,28)', dark: 'rgb(250,250,251)' };

// The pill answers to the session instead of its surroundings: light in a light
// one, near black in a dark one. This is the value that shows in practice -
// Dash-to-Dock composes the pill's inline style out of this key, and an inline
// style beats a stylesheet in St, so the .dash-background rules in
// stylesheet.css only get a look in when it leaves the pill to CSS. Keep the two
// in step.
const PILL_COLOR = { light: 'rgb(120,120,120)', dark: 'rgb(28,28,28)' };

const BAND = 4;           // thickness of the sampled strip, logical pixels
const GAP = 6;            // clearance from the dock edge for the fallback strip
const SHADOW = 24;        // dropped either side of the dock, where its shadow falls
const MIN_OUTSIDE = 160;  // band that has to miss the dock for the main reading
const SETTLE = 200;       // ms of quiet before a reading is taken

// A dead band, so a window sitting near the middle grey cannot make the dock
// flicker between the two sets as it is nudged about.
const LIGHT_ENTER = 0.62;
const LIGHT_LEAVE = 0.5;

let enabled = false;
let d2d;
let bgSettings;
let screenshot;
let globalSignals = [];      // [object, id], for disconnectAll
let windowSignals = [];      // [object, id], torn down and rebuilt per workspace
let sources = {};
let savedColors = null;
let docks = [];              // [{ container, destroyId }]
let mode = null;             // 'light' | 'dark' behind the dock, once measured
let scheme = null;           // 'light' | 'dark' session
let settleId = 0;
let sampling = false;

/* ----------------------------------------------------------- screen reading */

/**
 * The strip to read, and the slice of it the dock itself covers.
 *
 * @param container a dashtodockContainer actor
 */
function _band(container) {
    const dash = dashOf(container);
    const pill = dash?.get_children().find(child =>
        child.get_style_class_name?.()?.includes('dash-background'));
    const monitor = Main.layoutManager.findMonitorForActor(container);
    if (!pill?.has_allocation() || !monitor)
        return null;

    const [px, py] = pill.get_transformed_position();
    const [pw, ph] = pill.get_transformed_size();
    if (pw < 1 || ph < 1)
        return null;

    const position = d2d.get_string('dock-position');
    const vertical = position === 'LEFT' || position === 'RIGHT';
    const span = vertical ? monitor.height : monitor.width;
    const covered = vertical ? ph : pw;

    // The band is pinned to the monitor edge rather than to the pill. Autohide
    // slides the pill clear across the band, and a band that went with it would
    // answer differently to an unchanged screen - which is what made the colours
    // alternate as the dock came and went. The pill only ever moves across the
    // band, never along it, so its own axis still says where the dock sits.
    const inset = vertical ? pw / 2 : ph / 2;
    const rect = vertical
        ? {
            x: position === 'LEFT'
                ? monitor.x + inset : monitor.x + monitor.width - inset,
            y: monitor.y, width: BAND, height: monitor.height,
        }
        : {
            x: monitor.x,
            y: position === 'TOP'
                ? monitor.y + inset : monitor.y + monitor.height - inset,
            width: monitor.width, height: BAND,
        };

    // Straight across the dock's own band: what shows beside the pill is the
    // window that is behind it. The dock's shadow is dropped with it, or the
    // pill turning light would darken its own next reading.
    if (span - covered >= MIN_OUTSIDE) {
        const start = (vertical ? py : px) - (vertical ? monitor.y : monitor.x) - SHADOW;
        return {
            rect: _clamp(rect, monitor),
            skip: [Math.max(0, start / span), Math.min(1, (start + covered + 2 * SHADOW) / span)],
        };
    }

    // A dock stretched the length of the monitor leaves nothing beside it, so
    // read the strip just past its inner edge instead.
    const thickness = 2 * inset + GAP + BAND;
    const outside = vertical
        ? {
            ...rect,
            x: position === 'LEFT'
                ? monitor.x + thickness : monitor.x + monitor.width - thickness,
        }
        : {
            ...rect,
            y: position === 'TOP'
                ? monitor.y + thickness : monitor.y + monitor.height - thickness,
        };
    return { rect: _clamp(outside, monitor), skip: [0, 0] };
}

function _clamp(rect, monitor) {
    const x = Math.max(monitor.x, Math.min(Math.round(rect.x), monitor.x + monitor.width - 1));
    const y = Math.max(monitor.y, Math.min(Math.round(rect.y), monitor.y + monitor.height - 1));
    return {
        x, y,
        width: Math.max(1, Math.min(Math.round(rect.width), monitor.x + monitor.width - x)),
        height: Math.max(1, Math.min(Math.round(rect.height), monitor.y + monitor.height - y)),
    };
}

/**
 * Mean luminance of the strip, less the part the dock covers.
 *
 * @param pixbuf the captured strip
 * @param skip [from, to] as fractions of the strip's long side
 */
function _luminance(pixbuf, skip) {
    const pixels = pixbuf.get_pixels();
    const stride = pixbuf.get_rowstride();
    const channels = pixbuf.get_n_channels();
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const horizontal = width >= height;
    const length = horizontal ? width : height;
    const from = Math.round(skip[0] * length);
    const to = Math.round(skip[1] * length);

    let sum = 0;
    let count = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const along = horizontal ? x : y;
            if (along >= from && along < to)
                continue;
            const i = y * stride + x * channels;
            sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
            count++;
        }
    }
    return count ? sum / count / 255 : 0;
}

function _read() {
    if (sampling || Main.overview.visible)
        return;

    // The first dock that can actually be measured, rather than whichever came
    // first: a dock still being built has no allocation to read yet.
    const band = docks.reduce((found, { container }) => found ?? _band(container), null);
    if (!band)
        return;

    const { rect, skip } = band;
    const stream = Gio.MemoryOutputStream.new_resizable();
    sampling = true;
    screenshot.screenshot_area(rect.x, rect.y, rect.width, rect.height, stream,
        (source, result) => {
            sampling = false;
            if (!enabled)
                return;
            try {
                source.screenshot_area_finish(result);
                stream.close(null);
                const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(
                    Gio.MemoryInputStream.new_from_bytes(stream.steal_as_bytes()), null);
                _apply(_luminance(pixbuf, skip));
            } catch (_e) {
                // A capture the compositor refused: keep the set we are on
            }
        });
}

// Window drags and resizes come in a stream of signals; one reading once they
// stop is enough, and the screen has to have settled before it is worth taking.
function _schedule() {
    if (settleId)
        return;
    settleId = GLib.timeout_add(GLib.PRIORITY_LOW, SETTLE, () => {
        settleId = 0;
        _read();
        return GLib.SOURCE_REMOVE;
    });
}

/* ---------------------------------------------------------------- applying */

/** Cairo indicators only redraw when asked; a style class change is not enough. */
function _repaintIndicators(actor) {
    if (actor instanceof St.DrawingArea) {
        actor.queue_repaint();
        return;
    }
    for (const child of actor.get_children())
        _repaintIndicators(child);
}

function _styleContainer(container) {
    if (mode) {
        container.add_style_class_name(mode === 'light' ? LIGHT_CLASS : DARK_CLASS);
        container.remove_style_class_name(mode === 'light' ? DARK_CLASS : LIGHT_CLASS);
    }
    if (scheme) {
        container.add_style_class_name(scheme === 'light' ? SCHEME_LIGHT_CLASS : SCHEME_DARK_CLASS);
        container.remove_style_class_name(scheme === 'light' ? SCHEME_DARK_CLASS : SCHEME_LIGHT_CLASS);
    }
    _repaintIndicators(container);
}

function _apply(luminance) {
    const wanted = mode === 'light'
        ? (luminance < LIGHT_LEAVE ? 'dark' : 'light')
        : (luminance > LIGHT_ENTER ? 'light' : 'dark');
    if (wanted === mode)
        return;

    mode = wanted;
    d2d.set_string(DOT_KEY, DOT_COLOR[mode]);
    docks.forEach(({ container }) => _styleContainer(container));
}

function _syncScheme() {
    const wanted = prefersDark() ? 'dark' : 'light';
    if (wanted === scheme)
        return;

    scheme = wanted;
    d2d.set_string(PILL_KEY, PILL_COLOR[scheme]);
    docks.forEach(({ container }) => _styleContainer(container));
}

function _attach(container) {
    if (docks.some(dock => dock.container === container))
        return;

    // A dock torn down before we are (monitor removed, Dash-to-Dock switched
    // off) takes its container with it
    const entry = { container };
    entry.destroyId = container.connect('destroy', () => {
        docks = docks.filter(other => other !== entry);
    });
    docks.push(entry);

    _styleContainer(container);
    _schedule();
}

/* ----------------------------------------------------------------- signals */

// Everything that can put different content behind the dock. Purely
// event-driven: nothing is read while the screen is still.
function _connectWindowSignals() {
    _disconnectWindowSignals();

    const workspace = global.workspace_manager.get_active_workspace();
    windowSignals.push(
        [workspace, workspace.connect('window-added', (_ws, win) => {
            _connectWindow(win);
            _schedule();
        })],
        [workspace, workspace.connect('window-removed', _schedule)]);

    workspace.list_windows().forEach(_connectWindow);
}

function _connectWindow(metaWindow) {
    for (const signal of ['position-changed', 'size-changed', 'notify::minimized'])
        windowSignals.push([metaWindow, metaWindow.connect(signal, _schedule)]);

    // Let go of a window as it goes, rather than reaching for a finalized one
    windowSignals.push([metaWindow, metaWindow.connect('unmanaged', () => {
        windowSignals = windowSignals.filter(([object]) => object !== metaWindow);
        _schedule();
    })]);
}

function _disconnectWindowSignals() {
    disconnectAll(windowSignals);
    windowSignals = [];
}

/* ------------------------------------------------------------- entry points */

export function enable() {
    // Settings changes re-run the whole apply pass; don't stack signals or
    // capture the colours we already wrote as the user's own
    if (enabled)
        return;

    d2d = dockSettings();
    if (!d2d)
        return;
    enabled = true;

    savedColors = Object.fromEntries(SAVED_KEYS.map(key => [key, d2d.get_string(key)]));
    screenshot = new Shell.Screenshot();
    bgSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.background' });

    for (const [object, signal] of [
        [global.display, 'restacked'],
        [global.window_manager, 'switch-workspace'],
        [Main.overview, 'hidden'],
        [bgSettings, 'changed::picture-uri'],
        [bgSettings, 'changed::picture-uri-dark'],
        [d2d, 'changed::dock-position'],
    ])
        globalSignals.push([object, object.connect(signal, _schedule)]);

    // The scheme moves the pill on its own, and swaps which of the two
    // wallpapers is shown without touching either key - so it needs both.
    const stSettings = St.Settings.get();
    globalSignals.push([stSettings, stSettings.connect('notify::color-scheme', () => {
        _syncScheme();
        _schedule();
    })]);

    // A new wallpaper is cross-faded in over its predecessor rather than swapped
    // for it, so the reading the key change asks for is still of the old one.
    // The outgoing actor being dropped at the end of that fade is what says the
    // new one is really on screen.
    const backgrounds = Main.layoutManager._backgroundGroup;
    if (backgrounds) {
        for (const signal of ['child-added', 'child-removed'])
            globalSignals.push([backgrounds, backgrounds.connect(signal, _schedule)]);
    }

    globalSignals.push([global.workspace_manager,
        global.workspace_manager.connect('active-workspace-changed', _connectWindowSignals)]);

    _connectWindowSignals();
    _syncScheme();
    watchDocks({ attach: _attach, count: () => docks.length, globalSignals, sources });
    _schedule();
}

export function disable() {
    enabled = false;

    for (const id of [settleId, sources.dockSearch]) {
        if (id)
            GLib.Source.remove(id);
    }
    settleId = 0;
    sources.dockSearch = 0;

    disconnectAll(globalSignals);
    globalSignals = [];
    _disconnectWindowSignals();

    for (const { container, destroyId } of docks) {
        container.disconnect(destroyId);
        for (const name of [LIGHT_CLASS, DARK_CLASS, SCHEME_LIGHT_CLASS, SCHEME_DARK_CLASS])
            container.remove_style_class_name(name);
        _repaintIndicators(container);
    }
    docks = [];

    for (const [key, value] of Object.entries(savedColors))
        d2d.set_string(key, value);
    savedColors = null;

    d2d = null;
    bgSettings = null;
    screenshot = null;
    mode = null;
    scheme = null;
    sampling = false;
}

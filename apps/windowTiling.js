// SPDX-License-Identifier: GPL-3.0-or-later
// Window tiling engine and the glyph button grid used by the window title menu.
// Mutter exposes no tiling API to extensions (meta_window_tile is not introspected),
// so layouts are applied with move_resize_frame over the monitor work area.

import Meta from 'gi://Meta';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const GLYPH_W = 26;
const GLYPH_H = 18;
const PANE_GAP = 1;
const GLYPH_BORDER = 1; // must match the border-width of .kiwi-tile-glyph
const SECTION_LABEL_OPACITY = 150; // 0-255. CSS opacity is not applied here; set it on the actor.
const PANE_GHOST_OPACITY = 115;

const ANIMATION_MS = 300;

const FULL = { x: 0, y: 0, w: 1, h: 1 };

// Fractions of the work area, shared by the geometry and the menu glyphs.
const LAYOUTS = {
    'left':         { x: 0,     y: 0,     w: 1 / 2, h: 1 },
    'right':        { x: 1 / 2, y: 0,     w: 1 / 2, h: 1 },
    'top':          { x: 0,     y: 0,     w: 1,     h: 1 / 2 },
    'bottom':       { x: 0,     y: 1 / 2, w: 1,     h: 1 / 2 },
    'top-left':     { x: 0,     y: 0,     w: 1 / 2, h: 1 / 2 },
    'top-right':    { x: 1 / 2, y: 0,     w: 1 / 2, h: 1 / 2 },
    'bottom-left':  { x: 0,     y: 1 / 2, w: 1 / 2, h: 1 / 2 },
    'bottom-right': { x: 1 / 2, y: 1 / 2, w: 1 / 2, h: 1 / 2 },
};

const ARRANGEMENTS = {
    'left-right': ['left', 'right'],
    'right-left': ['right', 'left'],
    'quarters': ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
};

const MOVING_GRAB_OPS = [
    Meta.GrabOp.MOVING,
    Meta.GrabOp.MOVING_UNCONSTRAINED,
    Meta.GrabOp.KEYBOARD_MOVING,
];

let _grabOpBeginId = null;

// GNOME 49+ takes no arguments, GNOME 48 requires MaximizeFlags.
function maximizeWindow(win) {
    try {
        win.maximize();
    } catch {
        win.maximize(Meta.MaximizeFlags.BOTH);
    }
}

function unmaximizeWindow(win) {
    try {
        win.unmaximize();
    } catch {
        win.unmaximize(Meta.MaximizeFlags.BOTH);
    }
}

function isMaximized(win) {
    return !!win && win.maximized_horizontally && win.maximized_vertically;
}

// Mutter's allows_resize() returns false while a window is maximized or fullscreen, and
// allows_move() returns false while fullscreen. Tiling un-maximizes first, so gate on the
// client's own resize capability instead of its current state.
export function canTile(win) {
    return !!win && win.resizeable;
}

function focusWindow() {
    return global.display.focus_window;
}

// True when the window has somewhere to go back to.
export function canRestore(win) {
    return !!win && (!!win._kiwiRestore || isMaximized(win));
}

// Animate the window into its new geometry the way the shell's own size-change animation
// does (windowManager.js _sizeChangedWindow): offset and scale the actor back to where it
// was, then ease both transforms to identity. They are relative, so Mutter keeps
// positioning the actor underneath without fighting the animation.
function moveResizeAnimated(win, x, y, w, h, animate, fromRect) {
    const actor = win.get_compositor_private();
    // Callers that un-maximize first pass the rect the window occupied before that, so the
    // animation starts where the window actually looked, not at its restored size.
    const from = fromRect || win.get_frame_rect();

    win.move_resize_frame(false, x, y, w, h);

    if (!animate || !actor || !from.width || !from.height)
        return;
    if (from.x === x && from.y === y && from.width === w && from.height === h)
        return;

    actor.remove_all_transitions();
    actor.set_pivot_point(0, 0);
    actor.translation_x = from.x - x;
    actor.translation_y = from.y - y;
    actor.scale_x = from.width / w;
    actor.scale_y = from.height / h;
    actor.ease({
        translation_x: 0,
        translation_y: 0,
        scale_x: 1,
        scale_y: 1,
        duration: ANIMATION_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

// Remember where the window came from so it can be restored later.
function stashGeometry(win) {
    if (win._kiwiRestore)
        return;

    if (isMaximized(win)) {
        win._kiwiRestore = { maximized: true };
    } else {
        const r = win.get_frame_rect();
        win._kiwiRestore = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
}

function frameFor(win, key) {
    const wa = win.get_work_area_current_monitor();
    const f = LAYOUTS[key];
    // Round the edges, not the sizes, so two halves add up to the full work area.
    const x1 = wa.x + Math.round(f.x * wa.width);
    const x2 = wa.x + Math.round((f.x + f.w) * wa.width);
    const y1 = wa.y + Math.round(f.y * wa.height);
    const y2 = wa.y + Math.round((f.y + f.h) * wa.height);
    return [x1, y1, x2 - x1, y2 - y1];
}

function tileWindow(win, key, animate = true) {
    if (!canTile(win))
        return;

    stashGeometry(win);

    const from = win.get_frame_rect();
    if (win.is_fullscreen())
        win.unmake_fullscreen();
    if (isMaximized(win))
        unmaximizeWindow(win);

    const [x, y, w, h] = frameFor(win, key);
    moveResizeAnimated(win, x, y, w, h, animate, from);
}

function restoreWindow(win, animate = true) {
    if (!win)
        return;

    const stash = win._kiwiRestore;
    delete win._kiwiRestore;

    if (!stash) {
        // Never tiled by us, but still maximized: plain unmaximize.
        if (isMaximized(win))
            unmaximizeWindow(win);
        return;
    }

    if (stash.maximized) {
        maximizeWindow(win);
        return;
    }

    const from = win.get_frame_rect();
    if (isMaximized(win))
        unmaximizeWindow(win);
    moveResizeAnimated(win, stash.x, stash.y, stash.width, stash.height, animate, from);
}

// An Arrange action moves several windows at once, so restoring puts all of them back.
export function restoreAllWindows(focused) {
    const workspace = global.workspace_manager.get_active_workspace();
    const tiled = global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
        .filter(win => win._kiwiRestore);

    for (const win of tiled)
        restoreWindow(win);

    // Nothing of ours was tiled; fall back to the focused window so the entry still works
    // for a plainly maximized window.
    if (!tiled.length)
        restoreWindow(focused);
}

export function toggleFullscreen(win) {
    if (!win)
        return;

    if (win.is_fullscreen())
        win.unmake_fullscreen();
    else
        win.make_fullscreen();
}

// Other windows that can share the screen, most recently used first.
function tilePartners(win) {
    const workspace = global.workspace_manager.get_active_workspace();
    return global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
        .filter(other => other !== win && !other.minimized && !other.is_skip_taskbar() &&
                         other.get_monitor() === win.get_monitor() && canTile(other));
}

function arrangeWindows(win, kind) {
    if (!canTile(win))
        return;

    const keys = ARRANGEMENTS[kind];
    const partners = tilePartners(win).slice(0, keys.length - 1);

    tileWindow(win, keys[0]);
    partners.forEach((other, index) => {
        tileWindow(other, keys[index + 1]);
        other.raise();
    });
    win.activate(global.get_current_time());
}

// Dragging a maximized window by its titlebar restores it; Mutter does that itself, but it
// has no idea our tiled windows are tiled, so reproduce it here. No animation: the window
// must stay under the pointer.
function onGrabOpBegin(_display, win, grabOp) {
    if (!win || !win._kiwiRestore)
        return;

    if (!MOVING_GRAB_OPS.includes(grabOp))
        return;

    const before = win.get_frame_rect();
    const [pointerX] = global.get_pointer();
    // Where the pointer sits across the titlebar, so the window keeps following it.
    const ratio = before.width > 0
        ? Math.min(1, Math.max(0, (pointerX - before.x) / before.width)) : 0.5;

    const stash = win._kiwiRestore;
    delete win._kiwiRestore;
    if (stash.maximized || isMaximized(win))
        return;

    win.move_resize_frame(false,
        Math.round(pointerX - ratio * stash.width), before.y, stash.width, stash.height);
}

export function enableDragRestore() {
    if (_grabOpBeginId)
        return;

    _grabOpBeginId = global.display.connect('grab-op-begin', onGrabOpBegin);
}

export function disableDragRestore() {
    // Drop the stashes too: they live on the Meta.Window objects, which outlive us, and a
    // stale one would send a window back to a geometry from a previous session.
    for (const win of global.display.get_tab_list(Meta.TabList.NORMAL, null))
        delete win._kiwiRestore;

    if (!_grabOpBeginId)
        return;

    global.display.disconnect(_grabOpBeginId);
    _grabOpBeginId = null;
}

// Miniature screen with one filled pane per window, drawn from the layout fractions.
// Clutter.FixedLayout ignores the content box, so the CSS border is not subtracted for us;
// instead of compensating by hand, the panes go in a borderless inner box that a BinLayout
// centres — symmetric whichever way St allocates.
function makeGlyph(panes) {
    const glyph = new St.Widget({
        style_class: 'kiwi-tile-glyph',
        layout_manager: new Clutter.BinLayout(),
        width: GLYPH_W,
        height: GLYPH_H,
    });

    const inner = new St.Widget({
        layout_manager: new Clutter.FixedLayout(),
        width: GLYPH_W - 2 * GLYPH_BORDER,
        height: GLYPH_H - 2 * GLYPH_BORDER,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    glyph.add_child(inner);

    for (const pane of panes) {
        const actor = new St.Widget({ style_class: 'kiwi-tile-pane' });
        // A ghost pane is another window in an Arrange layout. Dimming it via the actor
        // rather than a translucent fill keeps it correct on any background, including
        // the accent colour a selected tile paints behind it.
        if (pane.ghost)
            actor.opacity = PANE_GHOST_OPACITY;
        const x1 = Math.round(pane.x * inner.width);
        const x2 = Math.round((pane.x + pane.w) * inner.width);
        const y1 = Math.round(pane.y * inner.height);
        const y2 = Math.round((pane.y + pane.h) * inner.height);
        actor.set_position(x1 + PANE_GAP, y1 + PANE_GAP);
        actor.set_size(Math.max(1, x2 - x1 - PANE_GAP * 2), Math.max(1, y2 - y1 - PANE_GAP * 2));
        inner.add_child(actor);
    }

    return glyph;
}

// The two labelled rows of glyph buttons. onActivated runs before the action so the caller
// can close its menu. The returned sync(win) dims tiles that need more windows than exist.
export function createTileGrid(gettext, onActivated) {
    const _ = gettext;
    const sections = [
        [_('Move & Resize'), [
            [_('Left'), [LAYOUTS['left']], 0, () => tileWindow(focusWindow(), 'left')],
            [_('Right'), [LAYOUTS['right']], 0, () => tileWindow(focusWindow(), 'right')],
            [_('Top'), [LAYOUTS['top']], 0, () => tileWindow(focusWindow(), 'top')],
            [_('Bottom'), [LAYOUTS['bottom']], 0, () => tileWindow(focusWindow(), 'bottom')],
        ]],
        [_('Fill & Arrange'), [
            [_('Fill'), [FULL], 0, () => {
                const win = focusWindow();
                if (win) {
                    stashGeometry(win);
                    maximizeWindow(win);
                }
            }],
            [_('Left & Right'),
                [LAYOUTS['left'], { ...LAYOUTS['right'], ghost: true }],
                1, () => arrangeWindows(focusWindow(), 'left-right')],
            [_('Right & Left'),
                [LAYOUTS['right'], { ...LAYOUTS['left'], ghost: true }],
                1, () => arrangeWindows(focusWindow(), 'right-left')],
            [_('Quarters'), [
                LAYOUTS['top-left'],
                { ...LAYOUTS['top-right'], ghost: true },
                { ...LAYOUTS['bottom-left'], ghost: true },
                { ...LAYOUTS['bottom-right'], ghost: true },
            ], 3, () => arrangeWindows(focusWindow(), 'quarters')],
        ]],
    ];

    const actor = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'kiwi-tiling-grid',
    });
    // The glyphs use explicit colours for contrast rather than inheriting the menu
    // foreground, so they need to know which way the shell theme is pointing.
    if (Main.getStyleVariant() === 'light')
        actor.add_style_class_name('light');

    const arrangeTiles = [];

    for (const [label, tiles] of sections) {
        const sectionLabel = new St.Label({ text: label, style_class: 'kiwi-tiling-section-label' });
        sectionLabel.opacity = SECTION_LABEL_OPACITY;
        actor.add_child(sectionLabel);

        const row = new St.BoxLayout({ style_class: 'kiwi-tiling-row' });
        for (const [name, panes, needs, run] of tiles) {
            const button = new St.Button({
                style_class: 'kiwi-tile-button',
                track_hover: true,
                accessible_name: name,
            });
            button.set_child(makeGlyph(panes));
            button.connect('clicked', () => {
                onActivated();
                run();
            });
            row.add_child(button);

            if (needs)
                arrangeTiles.push([button, needs]);
        }
        actor.add_child(row);
    }

    const sync = win => {
        const available = win ? tilePartners(win).length : 0;
        for (const [button, needed] of arrangeTiles) {
            const usable = available >= needed;
            button.reactive = usable;
            button.opacity = usable ? 255 : 90;
        }
    };

    return { actor, sync };
}

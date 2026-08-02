// SPDX-License-Identifier: GPL-3.0-or-later
// macOS-style minimized windows: parks a thumbnail of every minimized window in
// Dash-to-Dock, after the app icons and before the trash.
// The window is snapshotted with paint_to_content() while it is still mapped,
// so the tile keeps showing the last frame after the window is gone from view.
// Dash-to-Dock's own trash item is moved to the end of our strip, which keeps
// the macOS order (apps | minimized windows | trash) without reimplementing it.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { DashItemContainer } from 'resource:///org/gnome/shell/ui/dash.js';

const D2D_SCHEMA = 'org.gnome.shell.extensions.dash-to-dock';
// Proportions measured off a macOS dock: every tile is the same fixed box, a
// little wider than an icon along the dock, with the thumbnail centred in it and
// the app icon always in the same corner, so the icons line up in one row.
const TILE_ALONG = 1.15;      // tile box along the dock, in dash icon sizes
const TILE_ACROSS = 1;        // tile box across the dock, in dash icon sizes
const BADGE_FRACTION = 0.4;   // app icon badge, fraction of the dash icon size
const RESTORE_GRACE = 500;    // ms to leave a restoring window's target alone
const GEOMETRY_SETTLE = 100;  // ms of a still dock before recomputing targets
// The dash opens and closes its slots in 200ms, which is too brisk next to the
// window flying in or out: match the shell's MINIMIZE_WINDOW_ANIMATION_TIME so
// the slot and the window move as one gesture.
const TILE_ANIMATION_TIME = 400;

let enabled = false;
let docks = [];                 // [{ dash, strip, iconSize, signals, tiles, trashItem }]
let order = [];                 // Meta.Window[], in minimize order (newest last)
let snapshots = new Map();      // Meta.Window -> { content, width, height }
let windowSignals = new Map();  // Meta.Window -> [signal ids]
let globalSignals = [];         // [[object, id]]
let restoring = new Set();      // windows whose restore animation is still running
let dockSearchId = 0;
let restoreGraceId = 0;
let geometryUpdateId = 0;
let trashAdoptionId = 0;
let startupCompleteId = 0;
let childAddedId = 0;
let d2dSettings = null;

/* -------------------------------------------------------------- snapshots */

function _isEligible(win) {
    return !!win && win.window_type === Meta.WindowType.NORMAL && !win.is_skip_taskbar();
}

function _captureSnapshot(win) {
    const actor = win.get_compositor_private();
    if (!actor)
        return null;

    // Clip away client-side shadows. Despite what the docs say, mutter
    // intersects this rectangle with the actor rect in stage coordinates,
    // so the frame rect goes in unmodified.
    const frame = win.get_frame_rect();
    const clip = new Mtk.Rectangle({
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
    });

    try {
        const content = actor.paint_to_content(clip);
        if (content)
            return { content, width: frame.width, height: frame.height };
    } catch (_) {
        // No valid texture (already unmapped) — the tile falls back to the app icon
    }
    return null;
}

/**
 * Windows are followed through notify::minimized rather than the window manager
 * minimize/unminimize signals: mutter emits it for every path into and out of
 * the minimized state, including windows raised by other launchers, and it does
 * so before the window is unmapped, which is what makes the snapshot possible.
 *
 * @param win a Meta.Window
 */
function _trackWindow(win) {
    if (!_isEligible(win) || windowSignals.has(win))
        return;

    windowSignals.set(win, [
        win.connect('notify::minimized', () =>
            win.minimized ? _addWindow(win) : _removeWindow(win)),
        win.connect('unmanaged', () => _untrackWindow(win)),
    ]);

    if (win.minimized)
        _addWindow(win);
}

function _untrackWindow(win) {
    for (const id of windowSignals.get(win) ?? [])
        win.disconnect(id);
    windowSignals.delete(win);
    _removeWindow(win);
}

function _addWindow(win) {
    if (!enabled || order.includes(win))
        return;

    const snapshot = _captureSnapshot(win);
    if (snapshot)
        snapshots.set(win, snapshot);
    order.push(win);
    restoring.delete(win);
    _syncDocks();
}

function _removeWindow(win) {
    if (!order.includes(win))
        return;

    order = order.filter(w => w !== win);
    snapshots.delete(win);

    if (enabled) {
        _holdGeometry(win);
        _syncDocks();
    }
}

/**
 * The window manager reads the icon geometry when it starts the restore
 * animation, which is queued rather than immediate. Until then the window still
 * needs to point at the tile it came from, so keep it out of the next update.
 *
 * @param win a Meta.Window being restored
 */
function _holdGeometry(win) {
    restoring.add(win);

    if (restoreGraceId)
        GLib.Source.remove(restoreGraceId);
    restoreGraceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RESTORE_GRACE, () => {
        restoreGraceId = 0;
        restoring.clear();
        _queueIconGeometry();
        return GLib.SOURCE_REMOVE;
    });
}

/* ------------------------------------------------------------------ tiles */

function _scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scaleFactor;
}

function _tileBox(dash) {
    const base = dash.iconSize * _scaleFactor();
    const isHorizontal = dash._isHorizontal ?? true;
    return [
        Math.round(base * (isHorizontal ? TILE_ALONG : TILE_ACROSS)),
        Math.round(base * (isHorizontal ? TILE_ACROSS : TILE_ALONG)),
    ];
}

function _makeWindowTile(win, dash) {
    const button = new St.Button({
        style_class: 'kiwi-minimized-tile',
        can_focus: true,
        track_hover: true,
    });
    const app = Shell.WindowTracker.get_default().get_window_app(win);
    const snapshot = snapshots.get(win);
    const [boxWidth, boxHeight] = _tileBox(dash);

    // Every tile is the same box, so the app icons line up across the strip
    const box = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        width: boxWidth,
        height: boxHeight,
    });

    if (snapshot) {
        // Children that do not expand end up centred, which is what we want here
        const fit = Math.min(boxWidth / snapshot.width, boxHeight / snapshot.height);
        const thumbnail = new St.Widget({
            content: snapshot.content,
            width: Math.round(snapshot.width * fit),
            height: Math.round(snapshot.height * fit),
        });
        // A window texture minified this far is slow and aliased with the default
        // filter; mipmaps are built once and stay cheap while the tile animates
        thumbnail.set_content_scaling_filters(
            Clutter.ScalingFilter.TRILINEAR, Clutter.ScalingFilter.LINEAR);
        box.add_child(thumbnail);
    } else {
        box.add_child(app
            ? app.create_icon_texture(dash.iconSize)
            : new St.Icon({ icon_name: 'application-x-executable', icon_size: dash.iconSize }));
    }

    if (app && snapshot) {
        const badge = app.create_icon_texture(
            Math.max(16, Math.round(dash.iconSize * BADGE_FRACTION)));
        // Clutter only honours the alignment of children that expand
        badge.set({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
        });
        box.add_child(badge);
    }

    button.set_child(box);
    return button;
}

function _makeSeparator(dash) {
    const isHorizontal = dash._isHorizontal ?? true;
    return new St.Widget({
        style_class: 'dash-separator',
        x_align: isHorizontal ? Clutter.ActorAlign.FILL : Clutter.ActorAlign.CENTER,
        y_align: isHorizontal ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL,
        width: isHorizontal ? -1 : dash.iconSize,
        height: isHorizontal ? dash.iconSize : -1,
    });
}

/**
 * Wrap a tile in the same item container Dash-to-Dock uses for its icons, so
 * hover labels, positioning and the zoom-in animation match the rest of the dock.
 *
 * @param dash the Dash-to-Dock dash actor
 * @param child the tile actor
 * @param labelText text for the hover label
 */
function _makeItem(dash, child, labelText) {
    const sibling = dash._box.get_children().find(c => typeof c.setLabelText === 'function');
    const Container = sibling ? sibling.constructor : DashItemContainer;
    const item = sibling ? new Container(dash._position) : new Container();
    item.setChild(child);
    item.setLabelText(labelText);
    dash._hookUpLabel(item);
    return item;
}

/* ------------------------------------------------------------------ docks */

function _syncDocks() {
    docks.forEach(_syncDock);
    _queueIconGeometry();
}

/**
 * Bring the strip in line with the list of minimized windows. Tiles are kept
 * across updates so that a restored window's tile can shrink out of the way
 * instead of blinking out: the item's preferred size follows its scale, so the
 * neighbours slide over and the dock closes the gap on its own.
 *
 * @param info the per-dock state
 */
function _syncDock(info) {
    const { dash, strip } = info;
    const rebuild = info.iconSize !== dash.iconSize;
    info.iconSize = dash.iconSize;

    if (rebuild) {
        info.separator?.destroy();
        info.separator = null;
    }

    info.tiles = info.tiles.filter(({ win, item }) => {
        if (!rebuild && order.includes(win))
            return true;
        if (rebuild)
            item.destroy();
        else
            _animateOut(item);
        return false;
    });

    for (const win of order) {
        if (info.tiles.some(tile => tile.win === win))
            continue;

        const item = _makeTileItem(info, win);
        if (info.trashItem)
            strip.insert_child_below(item, info.trashItem);
        else
            strip.add_child(item);
        _animateIn(item);
        info.tiles.push({ win, item });
    }

    _syncSeparator(info);

    if (info.trashItem) {
        strip.set_child_above_sibling(info.trashItem, null);
        // Dash-to-Dock only resizes and reveals the items it still owns
        info.trashItem.child.icon?.setIconSize(dash.iconSize);
        info.trashItem.show(false);
    }
}

/**
 * Grow a tile into place. Same shape as DashItemContainer.show(), but on the
 * window animation's clock: the item's preferred size follows its scale, so the
 * strip opens the slot as the window arrives.
 *
 * @param item a dash item container holding a tile
 */
function _animateIn(item) {
    item.ease({
        scale_x: 1,
        scale_y: 1,
        opacity: 255,
        duration: TILE_ANIMATION_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

function _animateOut(item) {
    item.animatingOut = true;
    item.label?.hide();
    item.ease({
        scale_x: 0,
        scale_y: 0,
        opacity: 0,
        duration: TILE_ANIMATION_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => item.destroy(),
    });
}

function _makeTileItem(info, win) {
    const { dash } = info;
    const button = _makeWindowTile(win, dash);
    const item = _makeItem(dash, button, win.get_title() ?? '');

    button.connect('clicked', () => {
        // Make sure the restore animation starts from the tile, not from
        // wherever Dash-to-Dock last pointed the icon geometry
        win.set_icon_geometry(_itemRect(item));
        win.activate(global.get_current_time());
    });

    return item;
}

function _syncSeparator(info) {
    // Dash-to-Dock draws its own separator after the favourites, which for a dock
    // without loose running apps already marks the boundary we would draw
    const separated = info.dash._box.get_children().at(-1)
        ?.get_style_class_name?.()?.includes('dash-separator');
    const wanted = !separated && (info.tiles.length > 0 || !!info.trashItem);

    if (wanted && !info.separator) {
        info.separator = _makeSeparator(info.dash);
        info.strip.insert_child_at_index(info.separator, 0);
    } else if (!wanted && info.separator) {
        info.separator.destroy();
        info.separator = null;
    }
}

/* ------------------------------------------------------------------ trash */

function _findTrashItem(dash) {
    return dash._box.get_children().find(child =>
        child.child?._delegate?.app?.isTrash) ?? null;
}

/**
 * Move Dash-to-Dock's trash item to the end of our strip. It stays a real dock
 * icon — same menu, same drop target — it just lives after the minimized windows.
 * Dash-to-Dock rebuilds it whenever it redisplays, since it no longer finds it
 * in its own box, so the freshly built one replaces the one we hold.
 *
 * @param info the per-dock state
 */
function _adoptTrash(info) {
    const item = _findTrashItem(info.dash);
    if (!item || item === info.trashItem)
        return;

    info.trashItem?.destroy();
    info.dash._box.remove_child(item);
    info.strip.add_child(item);
    info.trashItem = item;
    _syncDock(info);
}

function _queueTrashAdoption() {
    if (trashAdoptionId || !enabled)
        return;
    // Never restructure the dash while Dash-to-Dock is in the middle of a redisplay
    trashAdoptionId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        trashAdoptionId = 0;
        docks.forEach(_adoptTrash);
        return GLib.SOURCE_REMOVE;
    });
}

function _releaseTrash(info, removeActors) {
    if (!info.trashItem)
        return;

    if (removeActors) {
        info.strip.remove_child(info.trashItem);
        info.dash._box.add_child(info.trashItem);
    }
    info.trashItem = null;
}

function _dropTrash() {
    // The user turned Dash-to-Dock's trash off; it cannot remove what it does
    // not hold, so drop our copy
    for (const info of docks) {
        info.trashItem?.destroy();
        info.trashItem = null;
    }
    _syncDocks();
}

/* --------------------------------------------------------- icon geometry */

function _itemRect(item) {
    const [x, y] = item.get_transformed_position();
    const [width, height] = item.get_transformed_size();
    return new Mtk.Rectangle({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
    });
}

/**
 * Where the tile of the next minimized window will show up: on top of the trash
 * tile, which is pushed along, or at the end of the strip when there is none.
 *
 * @param info the per-dock state
 */
function _nextSlotRect(info) {
    const { dash, strip, trashItem } = info;
    const size = Math.round(dash.iconSize * _scaleFactor());
    if (trashItem) {
        const rect = _itemRect(trashItem);
        rect.width = size;
        rect.height = size;
        return rect;
    }

    const isHorizontal = dash._isHorizontal ?? true;
    const [x, y] = strip.get_transformed_position();
    const [width, height] = strip.get_transformed_size();
    return new Mtk.Rectangle({
        x: Math.round(isHorizontal ? x + width : x),
        y: Math.round(isHorizontal ? y : y + height),
        width: size,
        height: size,
    });
}

function _dockForWindow(win) {
    const monitorIndex = win.get_monitor();
    return docks.find(info => info.dash._monitorIndex === monitorIndex) ?? docks[0];
}

/**
 * The window manager animates a minimize towards the window's icon geometry and
 * a restore out of it, so every window has to point at its own tile, and every
 * window without a tile at the slot it is going to land in.
 */
function _applyIconGeometry() {
    const windows = global.get_window_actors()
        .map(actor => actor.meta_window)
        .filter(win => _isEligible(win) &&
            !order.includes(win) && !restoring.has(win));

    for (const info of docks) {
        if (!info.strip.get_stage())
            continue;

        const slot = _nextSlotRect(info);

        for (const { win, item } of info.tiles) {
            // A tile still zooming in has no usable rect yet
            const rect = _itemRect(item);
            win.set_icon_geometry(rect.width && rect.height ? rect : slot);
        }

        for (const win of windows) {
            if (_dockForWindow(win) === info)
                win.set_icon_geometry(slot);
        }
    }
}

/**
 * Recomputing the targets means asking every tile for its transformed position,
 * which can force a layout pass. Doing that from an allocation handler made the
 * strip relayout several times per frame and the animation stutter, so wait for
 * the dock to stop moving first.
 */
function _queueIconGeometry() {
    if (!enabled)
        return;

    if (geometryUpdateId)
        GLib.Source.remove(geometryUpdateId);
    geometryUpdateId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, GEOMETRY_SETTLE, () => {
        geometryUpdateId = 0;
        _applyIconGeometry();
        return GLib.SOURCE_REMOVE;
    });
}

function _findDockContainers() {
    // Dash-to-Dock adds containers with name 'dashtodockContainer' to Main.uiGroup
    return Main.uiGroup.get_children().filter(child =>
        child.name === 'dashtodockContainer'
    );
}

function _attachDock(dockContainer) {
    // dashtodockContainer → _slider → child (dashtodockBox) → dash
    const dashBox = dockContainer._slider?.get_child();
    const dash = dashBox?.get_children().find(c => c.name === 'dash');
    if (!dash?._box || !dash._boxContainer)
        return;
    if (docks.some(info => info.dash === dash))
        return;

    const isHorizontal = dash._isHorizontal ?? true;
    const strip = new St.BoxLayout({
        name: 'kiwi-minimized-strip',
        orientation: isHorizontal
            ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL,
        x_align: isHorizontal ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER,
        y_align: isHorizontal ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START,
    });
    dash._boxContainer.insert_child_above(strip, dash._box);

    const info = {
        dash,
        strip,
        iconSize: dash.iconSize,
        signals: [],
        tiles: [],
        separator: null,
        trashItem: null,
    };

    // The dock moves whenever items are added or the overview slides it in;
    // the animation targets have to follow it
    const allocationId = strip.connect('notify::allocation', () => _queueIconGeometry());
    info.signals.push([strip, allocationId]);

    // Dash-to-Dock shrinks its icons to fit the monitor; follow that size
    const sizeId = dash._box.connect(
        isHorizontal ? 'notify::height' : 'notify::width', () => {
            if (dash.iconSize !== info.iconSize)
                _syncDock(info);
        });
    info.signals.push([dash._box, sizeId]);

    // Dash-to-Dock rebuilds its trash item on every redisplay; take it over again
    const addedId = dash._box.connect('child-added', (_box, child) => {
        if (child.child?._delegate?.app?.isTrash)
            _queueTrashAdoption();
    });
    info.signals.push([dash._box, addedId]);

    const destroyId = dash.connect('destroy', () => _detachDock(info, false));
    info.signals.push([dash, destroyId]);

    docks.push(info);
    _adoptTrash(info);
    _syncDock(info);
}

function _detachDock(info, removeActors = true) {
    for (const [object, id] of info.signals) {
        try { object.disconnect(id); } catch (_) {}
    }
    info.signals = [];

    _releaseTrash(info, removeActors);

    if (removeActors) {
        info.strip.destroy_all_children();
        info.strip.destroy();
    }

    docks = docks.filter(d => d !== info);
}

function _attachExistingDocks() {
    _findDockContainers().forEach(container => _attachDock(container));
}

/* ------------------------------------------------------------------ trash */

/* ----------------------------------------------------------- entry points */

export function enable() {
    if (enabled)
        return;
    enabled = true;

    // Dash-to-Dock cannot take its trash item back while we hold it, so follow
    // the setting to know when the user does not want it any more
    if (Gio.SettingsSchemaSource.get_default()?.lookup(D2D_SCHEMA, true)) {
        d2dSettings = new Gio.Settings({ schema_id: D2D_SCHEMA });
        const trashSettingId = d2dSettings.connect('changed::show-trash', () => {
            if (d2dSettings.get_boolean('show-trash'))
                _queueTrashAdoption();
            else
                _dropTrash();
        });
        globalSignals.push([d2dSettings, trashSettingId]);
    }

    const createdId = global.display.connect('window-created',
        (_display, win) => _trackWindow(win));
    globalSignals.push([global.display, createdId]);

    // Dash-to-Dock repoints icon geometry at its app icons when an app's window
    // list changes, so claim it back for every new window
    const mapId = global.window_manager.connect('map', () => _queueIconGeometry());
    globalSignals.push([global.window_manager, mapId]);

    global.get_window_actors().forEach(actor => _trackWindow(actor.meta_window));

    // During startup the dock is not laid out yet, same caveat as dockBlur
    if (Main.layoutManager._startingUp) {
        startupCompleteId = Main.layoutManager.connect('startup-complete', () => {
            Main.layoutManager.disconnect(startupCompleteId);
            startupCompleteId = 0;
            _watchDocks();
        });
        return;
    }
    _watchDocks();
}

function _watchDocks() {
    childAddedId = Main.uiGroup.connect('child-added', (_group, actor) => {
        if (actor.name === 'dashtodockContainer')
            _attachDock(actor);
    });

    _attachExistingDocks();

    // The dock may still be loading, retry for a while
    if (docks.length === 0) {
        let attempts = 0;
        dockSearchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            attempts++;
            _attachExistingDocks();
            if (docks.length > 0 || attempts >= 10) {
                dockSearchId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }
}

export function disable() {
    if (!enabled)
        return;
    enabled = false;

    if (startupCompleteId) {
        Main.layoutManager.disconnect(startupCompleteId);
        startupCompleteId = 0;
    }
    if (dockSearchId) {
        GLib.Source.remove(dockSearchId);
        dockSearchId = 0;
    }
    if (geometryUpdateId) {
        GLib.Source.remove(geometryUpdateId);
        geometryUpdateId = 0;
    }
    if (restoreGraceId) {
        GLib.Source.remove(restoreGraceId);
        restoreGraceId = 0;
    }
    if (trashAdoptionId) {
        GLib.Source.remove(trashAdoptionId);
        trashAdoptionId = 0;
    }
    if (childAddedId) {
        Main.uiGroup.disconnect(childAddedId);
        childAddedId = 0;
    }

    for (const [object, id] of globalSignals) {
        try { object.disconnect(id); } catch (_) {}
    }
    globalSignals = [];

    [...docks].forEach(info => _detachDock(info));

    // Drop our animation targets; Dash-to-Dock repoints them at its app icons
    // on its next update
    global.get_window_actors().forEach(actor => {
        if (_isEligible(actor.meta_window))
            actor.meta_window.set_icon_geometry(null);
    });

    for (const [win, ids] of windowSignals) {
        for (const id of ids) {
            try { win.disconnect(id); } catch (_) {}
        }
    }
    windowSignals.clear();
    snapshots.clear();
    restoring.clear();
    order = [];

    d2dSettings = null;
}

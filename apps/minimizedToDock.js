// SPDX-License-Identifier: GPL-3.0-or-later
// macOS-style minimized windows: parks a thumbnail of every minimized window in
// Dash-to-Dock, after the app icons and before the trash.
// The window is snapshotted with paint_to_content() while it is still mapped,
// so the tile keeps showing the last frame after the window is gone from view.
// Dash-to-Dock's own trash item is moved to the end of our strip, which keeps
// the macOS order (apps | minimized windows | trash) without reimplementing it.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {
    applyIconOffset, dashEndsWithSeparator, dashOf, disconnectAll, dockSettings, isTrashItem,
    makeDashItem, makeDashSeparator, makeStrip, scaleFactor, watchDocks,
} from './dockUtils.js';

// Proportions measured off a macOS dock: every tile is the same fixed box, a
// little wider than an icon along the dock, with the thumbnail centred in it and
// the app icon always in the same corner, so the icons line up in one row. The
// tile box holds the thumbnail alone; the selector around it is the padding on
// .kiwi-minimized-tile, mirroring how .overview-icon frames an app icon.
const TILE_ALONG = 1.15;      // tile box along the dock, in dash icon sizes
const TILE_ACROSS = 1;        // tile box across the dock, in dash icon sizes
const THUMBNAIL_RADIUS = 4;   // px of corner rounding on a thumbnail, scaled
const BADGE_FRACTION = 0.4;   // app icon badge, fraction of the dash icon size
const RESTORE_GRACE = 500;    // ms to leave a restoring window's target alone
const GEOMETRY_SETTLE = 100;  // ms of a still dock before recomputing targets
// The dash opens and closes its slots in 200ms, which is too brisk next to the
// window flying in or out: the two together match the shell's
// MINIMIZE_WINDOW_ANIMATION_TIME so the slot and the window move as one
// gesture. macOS splits it in two - the dock makes room along its length first,
// then the thumbnail grows out of the dock's edge, and back down on restore.
const TILE_SLOT_TIME = 160;   // ms to open or close the slot along the dock
const TILE_GROW_TIME = 240;   // ms for the thumbnail itself to grow or shrink

let enabled = false;
let docks = [];                 // [{ dash, strip, iconSize, signals, tiles, trashItem }]
let order = [];                 // Meta.Window[], in minimize order (newest last)
let snapshots = new Map();      // Meta.Window -> { content, width, height }
let windowSignals = new Map();  // Meta.Window -> [signal ids]
let globalSignals = [];         // [[object, id]]
let restoring = new Set();      // windows whose restore animation is still running
let d2dSettings = null;
const sources = {
    dockSearch: 0, restoreGrace: 0, geometryUpdate: 0, trashAdoption: 0, separatorSync: 0,
};

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

    // A window that is already minimized cannot be snapshotted - it is unmapped -
    // so the one taken on the way down is the only one there will be
    if (!snapshots.has(win)) {
        const snapshot = _captureSnapshot(win);
        if (snapshot)
            snapshots.set(win, snapshot);
    }

    // The window manager starts the minimize animation before the queued update
    // below runs, so whatever was written last wins — and Dash-to-Dock repoints
    // a window at its app icon on every window-list change of that app. Aim this
    // one at the slot it is about to land in, now.
    const info = _dockForWindow(win);
    if (info?.strip.get_stage())
        win.set_icon_geometry(_nextSlotRect(info));

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

    if (sources.restoreGrace)
        GLib.Source.remove(sources.restoreGrace);
    sources.restoreGrace = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RESTORE_GRACE, () => {
        sources.restoreGrace = 0;
        restoring.clear();
        _queueIconGeometry();
        return GLib.SOURCE_REMOVE;
    });
}

/* ------------------------------------------------------------------ tiles */

const CORNER_UNIFORMS = `
    uniform float width;
    uniform float height;
    uniform float radius;
`;
// Alpha to zero outside the corner arcs, with a half-pixel feather so the curve
// does not stair-step. Leaves the coverage in 'a'.
const CORNER_COVERAGE = `
    vec2 size = vec2(width, height);
    vec2 uv = cogl_tex_coord_in[0].xy;
    // How far the pixel reaches past the corner arc, 0 while inside
    vec2 d = max(vec2(radius) - min(uv * size, size - uv * size), vec2(0.0));
    float a = clamp(radius - length(d) + 0.5, 0.0, 1.0);
`;

// GNOME 48-50, where the effect replaces the fragment program outright and
// Clutter binds the source texture to 'tex' itself.
const RoundedCornersEffect = GObject.registerClass(
class RoundedCornersEffect extends Clutter.ShaderEffect {
    constructor() {
        super();
        this.set_shader_source(`
            uniform sampler2D tex;
            ${CORNER_UNIFORMS}

            void main() {
                ${CORNER_COVERAGE}
                cogl_color_out = texture2D(tex, uv) * a;
            }
        `);
    }
});

/**
 * GNOME 51 dropped Clutter.ShaderEffect.set_shader_source: a shader effect is
 * now built from a Cogl snippet, which hooks into the pipeline instead of
 * replacing it. The fragment stage has therefore already sampled the actor into
 * cogl_color_out by the time the snippet runs, and all it has to do is scale it.
 */
function _newRoundedCornersEffect() {
    if (Clutter.ShaderEffect.prototype.set_shader_source)
        return new RoundedCornersEffect();

    return Clutter.ShaderEffect.new_with_snippet(
        Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, CORNER_UNIFORMS, `
            ${CORNER_COVERAGE}
            cogl_color_out *= a;
        `));
}

function _tileBox(dash) {
    const scale = scaleFactor();
    const isHorizontal = dash._isHorizontal ?? true;
    const along = Math.round(dash.iconSize * TILE_ALONG * scale);
    const across = Math.round(dash.iconSize * TILE_ACROSS * scale);
    return isHorizontal ? [along, across] : [across, along];
}

/**
 * Cut the corners off a thumbnail. A window texture is square, and the window's
 * own rounding shrinks to nothing at this size, so the corners are rounded in
 * screen space the way macOS rounds them.
 *
 * @param actor the thumbnail actor, already at its final size
 */
function _roundCorners(actor) {
    const effect = _newRoundedCornersEffect();
    actor.add_effect(effect);

    const { width, height } = actor;
    const radius = Math.min(THUMBNAIL_RADIUS * scaleFactor(), width / 2, height / 2);
    // Nudged off whole numbers so GJS marshals doubles, which is what the
    // shader's float uniforms expect
    effect.set_uniform_value('width', width - 1e-6);
    effect.set_uniform_value('height', height - 1e-6);
    effect.set_uniform_value('radius', radius - 1e-6);

    // A dash item's preferred size follows its scale, so an animating tile
    // allocates its thumbnail down to nothing. An offscreen effect on a
    // zero-sized actor asks Cogl for an empty viewport, which it warns about;
    // there is nothing to round off at that size anyway.
    actor.connect('notify::allocation', () => {
        const box = actor.get_allocation_box();
        effect.enabled = box.get_width() >= 1 && box.get_height() >= 1;
    });
}

function _makeWindowTile(win, dash) {
    const button = new St.Button({
        style_class: 'kiwi-minimized-tile',
        can_focus: true,
        track_hover: true,
        // The badge expands to reach its corner and setChild() forces y_expand;
        // Clutter propagates both up from the children, so with the default FILL
        // the selector would stretch over the whole slot and hang out of the
        // dock. Anything but FILL keeps it at the tile box plus its padding.
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const app = Shell.WindowTracker.get_default().get_window_app(win);
    const snapshot = snapshots.get(win);
    const [boxWidth, boxHeight] = _tileBox(dash);

    // Sit where an app icon sits rather than in the middle of the slot
    applyIconOffset(dash, button);

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
        _roundCorners(thumbnail);
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
            _animateOut(info, item);
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
        _animateIn(info, item);
        info.tiles.push({ win, item });
    }

    _syncSeparator(info);

    if (info.trashItem) {
        // Reordering costs a relayout even when nothing moves
        if (strip.get_last_child() !== info.trashItem)
            strip.set_child_above_sibling(info.trashItem, null);
        // Dash-to-Dock only resizes the items it still owns
        info.trashItem.child.icon?.setIconSize(dash.iconSize);
    }
}

/**
 * The two axes of a tile animation: 'slot' is the one along the dock, which the
 * item container scales to open and close its place in the strip, and 'grow' is
 * the one across it, which the tile scales about the dock's own edge so it comes
 * up out of the dock rather than out of its own middle.
 *
 * @param dash the Dash-to-Dock dash actor
 */
function _tileAxes(dash) {
    if (dash._isHorizontal ?? true) {
        const y = dash._position === St.Side.TOP ? 0 : 1;
        return { slot: 'scale_x', grow: 'scale_y', pivot: new Graphene.Point({ x: 0.5, y }) };
    }

    const x = dash._position === St.Side.RIGHT ? 1 : 0;
    return { slot: 'scale_y', grow: 'scale_x', pivot: new Graphene.Point({ x, y: 0.5 }) };
}

/**
 * Grow a tile into place, macOS style: the strip opens the slot along the dock
 * first - the item's preferred size follows its scale, so the neighbours slide
 * over - and only then does the thumbnail rise out of the dock's edge.
 *
 * @param info the per-dock state
 * @param item a dash item container holding a tile
 */
function _animateIn(info, item) {
    const { slot, grow, pivot } = _tileAxes(info.dash);
    const tile = item.child;

    // Only the slot axis animates on the item, so the strip keeps its thickness
    item[grow] = 1;
    tile.pivot_point = pivot;
    tile[grow] = 0;

    item.ease({
        [slot]: 1,
        opacity: 255,
        duration: TILE_SLOT_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
    tile.ease({
        [grow]: 1,
        delay: TILE_SLOT_TIME,
        duration: TILE_GROW_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

function _animateOut(info, item) {
    const { slot, grow } = _tileAxes(info.dash);

    item.animatingOut = true;
    item.label?.hide();

    // Backwards: the thumbnail sinks back into the dock, then the slot closes
    item.child.ease({
        [grow]: 0,
        duration: TILE_GROW_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
    item.ease({
        [slot]: 0,
        opacity: 0,
        delay: TILE_GROW_TIME,
        duration: TILE_SLOT_TIME,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        // Not onComplete: the tile is off our list before the animation starts,
        // so a shrink cut short would leave it in the strip with nothing to
        // free it, holding its window snapshot
        onStopped: () => item.destroy(),
    });
}

function _makeTileItem(info, win) {
    const { dash } = info;
    const button = _makeWindowTile(win, dash);
    const item = makeDashItem(dash, button, win.get_title() ?? '');

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
    const wanted = !dashEndsWithSeparator(info.dash) &&
        (info.tiles.length > 0 || !!info.trashItem);

    if (wanted && !info.separator) {
        info.separator = makeDashSeparator(info.dash);
        info.strip.insert_child_at_index(info.separator, 0);
    } else if (!wanted && info.separator) {
        info.separator.destroy();
        info.separator = null;
    }
}

/**
 * The boundary moves with Dash-to-Dock's own box: a closed app takes its icon
 * out only once it has animated away, and until then Dash-to-Dock's separator
 * is not the last child yet and ours still looks needed. Re-check afterwards.
 */
function _queueSeparatorSync() {
    if (sources.separatorSync || !enabled)
        return;
    // Dash-to-Dock pulls its separator out and puts it back mid-redisplay
    sources.separatorSync = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        sources.separatorSync = 0;
        docks.forEach(_syncSeparator);
        return GLib.SOURCE_REMOVE;
    });
}

/* ------------------------------------------------------------------ trash */

function _findTrashItem(dash) {
    return dash._box.get_children().find(isTrashItem) ?? null;
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
    // Undo the hiding from the child-added handler; item.show() would not,
    // DashItemContainer shadows it with the scale animation
    item.visible = true;
    // Dash-to-Dock builds its items scaled away and reveals the ones it keeps;
    // this one is ours now, and only ever needs revealing the once
    item.show(false);
    info.trashItem = item;
    _syncDock(info);
}

function _queueTrashAdoption() {
    if (sources.trashAdoption || !enabled)
        return;
    // Never restructure the dash while Dash-to-Dock is in the middle of a redisplay
    sources.trashAdoption = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        sources.trashAdoption = 0;
        docks.forEach(_adoptTrash);
        return GLib.SOURCE_REMOVE;
    });
}

function _releaseTrash(info, removeActors) {
    // A rebuilt trash item hidden for an adoption that is not going to happen
    // now would stay invisible; hand that one back instead of our older copy
    const pending = removeActors ? _findTrashItem(info.dash) : null;
    if (pending)
        pending.visible = true;

    if (!info.trashItem)
        return;

    if (removeActors && !pending) {
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
    const size = Math.round(dash.iconSize * scaleFactor());
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

    if (sources.geometryUpdate)
        GLib.Source.remove(sources.geometryUpdate);
    sources.geometryUpdate = GLib.timeout_add(GLib.PRIORITY_DEFAULT, GEOMETRY_SETTLE, () => {
        sources.geometryUpdate = 0;
        _applyIconGeometry();
        return GLib.SOURCE_REMOVE;
    });
}

function _attachDock(dockContainer) {
    const dash = dashOf(dockContainer);
    if (!dash?._box || !dash._boxContainer)
        return;
    if (docks.some(info => info.dash === dash))
        return;

    const isHorizontal = dash._isHorizontal ?? true;
    const strip = makeStrip(dash, 'kiwi-minimized-strip');
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

    // Dash-to-Dock rebuilds its trash item on every redisplay; take it over
    // again. Hide it at once, or it widens the dash for the few frames until
    // the idle-time adoption and the whole dock shifts and shifts back.
    const addedId = dash._box.connect('child-added', (_box, child) => {
        if (isTrashItem(child)) {
            child.hide();
            _queueTrashAdoption();
        } else {
            _queueSeparatorSync();
        }
    });
    info.signals.push([dash._box, addedId]);

    // A running app that leaves the dock moves the boundary Dash-to-Dock draws
    const removedId = dash._box.connect('child-removed', () => _queueSeparatorSync());
    info.signals.push([dash._box, removedId]);

    const destroyId = dash.connect('destroy', () => _detachDock(info, false));
    info.signals.push([dash, destroyId]);

    docks.push(info);
    _adoptTrash(info);
    _syncDock(info);
}

function _detachDock(info, removeActors = true) {
    disconnectAll(info.signals);
    info.signals = [];

    _releaseTrash(info, removeActors);

    if (removeActors) {
        info.strip.destroy_all_children();
        info.strip.destroy();
    }

    docks = docks.filter(d => d !== info);
}

/* ----------------------------------------------------------- entry points */

export function enable() {
    if (enabled)
        return;
    enabled = true;

    // Dash-to-Dock cannot take its trash item back while we hold it, so follow
    // the setting to know when the user does not want it any more
    d2dSettings = dockSettings();
    if (d2dSettings) {
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

    // Same on the way out: closing one window of an app repoints the app's other
    // windows, minimized ones included, and those have to keep their tiles
    const destroyId = global.window_manager.connect('destroy', () => _queueIconGeometry());
    globalSignals.push([global.window_manager, destroyId]);

    // Snapshots outlive a disable, since the shell turns extensions off for the
    // lock screen and the windows behind it are past snapshotting. Only the ones
    // still sitting minimized are worth keeping: a window closed or brought back
    // while we were off would come back to a picture of the past.
    const windows = global.get_window_actors().map(actor => actor.meta_window);
    for (const win of snapshots.keys()) {
        if (!windows.includes(win) || !win.minimized)
            snapshots.delete(win);
    }
    windows.forEach(_trackWindow);

    // During startup the dock is not laid out yet, same caveat as dockBlur
    if (Main.layoutManager._startingUp) {
        const startupId = Main.layoutManager.connect('startup-complete', () => _watchDocks());
        globalSignals.push([Main.layoutManager, startupId]);
        return;
    }
    _watchDocks();
}

function _watchDocks() {
    watchDocks({
        attach: _attachDock,
        count: () => docks.length,
        globalSignals,
        sources,
    });
}

export function disable() {
    enabled = false;

    for (const key of Object.keys(sources)) {
        if (sources[key])
            GLib.Source.remove(sources[key]);
        sources[key] = 0;
    }

    disconnectAll(globalSignals);
    globalSignals = [];

    [...docks].forEach(info => _detachDock(info));

    for (const [win, ids] of windowSignals) {
        disconnectAll(ids.map(id => [win, id]));
        // Drop our animation targets; Dash-to-Dock repoints them at its app
        // icons on its next update
        win.set_icon_geometry(null);
    }
    windowSignals.clear();
    restoring.clear();
    order = [];

    d2dSettings = null;
}

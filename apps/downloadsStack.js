// SPDX-License-Identifier: GPL-3.0-or-later
// macOS-style Downloads stack: a folder item that sits in Dash-to-Dock next to
// the trash and fans the newest files in ~/Downloads out over the desktop.
// The fan is an arc of rows: a name pill rotated along the tangent, an icon on
// the arc itself, so the icons climb in one gently bending column the way the
// macOS fan does. The dock item is a pile of those same thumbnails, kept in step
// with the folder by a file monitor, and the fan spreads out of it.

import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { iconOffset, makeDashItem, makeDashSeparator } from './minimizedToDock.js';

const MAX_ROWS = 10;          // files in the fan, as macOS caps it
const FILE_ICON = 1.3;        // file icon, in dash icon sizes
const ROW_SPACING = 1.2;      // step along the arc, in file icon sizes
const FAN_START = 3;          // degrees of tilt on the first row
const FAN_STEP = 1.4;         // degrees added per row
const NAME_LIMIT = 36;        // characters before a name is elided
const TOP_MARGIN = 24;        // px kept clear above the topmost row
// Opening and closing are the same motion in reverse: one row at a time, the
// same step apart, so the fan spreads and folds at one pace.
const ROW_ANIMATION = 150;    // ms for a row to travel to or from the dock
const ROW_STAGGER = 12;       // ms between one row leaving and the next
const PRESS_BRIGHTNESS = -0.6;  // dock-styling's darken while a button is held
// The dock item is the pile the fan comes out of: the same newest files, one
// behind the other, each a little further up and turned a little further over.
const STACK_DEPTH = 5;        // thumbnails deep the pile is drawn
const STACK_STEP = 0.04;      // offset between two piled thumbnails, in icon sizes
const STACK_TILT = 2.2;       // degrees added per thumbnail down the pile
const REFRESH_DELAY = 400;    // ms of a quiet Downloads folder before rereading
// A card is as big as an app icon in the dock, give or take the rim of the
// folder it sits on, and the pile as a whole stays inside the same box.
const STACK_ITEM = 1.0;      // the largest a card gets, in dash icon sizes
const STACK_EXTENT = 1;       // how much of the icon box the whole pile fills
const LIST_BATCH = 64;
const LIST_ATTRIBUTES = [
    'standard::name',
    'standard::display-name',
    'standard::is-hidden',
    'standard::is-backup',
    'standard::icon',
    'time::modified',
    'thumbnail::path',
].join(',');

let enabled = false;
let docks = [];               // [{ dash, strip, item, button, iconSize, signals }]
let globalSignals = [];       // [[object, id]]
let fan = null;               // { overlay, grab, rows, anchor }
let recent = [];              // newest file infos first, at most MAX_ROWS of them
let recentCount = 0;          // files in the folder, however many that is
let folderMonitor = null;     // Gio.FileMonitor on the Downloads folder
let gettextFunc = message => message;
const sources = { dockSearch: 0, replace: 0, refresh: 0 };

function _disconnectAll(pairs) {
    for (const [object, id] of pairs)
        object.disconnect(id);
}

function _scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scaleFactor;
}

function _prefersDark() {
    return St.Settings.get().colorScheme === St.SystemColorScheme.PREFER_DARK;
}

/* ------------------------------------------------------------- file list */

function _downloadsFile() {
    const path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ??
        GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);
    return Gio.File.new_for_path(path);
}

function _openUri(uri) {
    Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
}

/**
 * Reread the folder and rebuild every pile from it. The dock item shows the
 * newest files even while the fan is shut, so the list is kept up to date rather
 * than read on the click - which is also what lets the fan open at once, out of
 * the very thumbnails the pile is made of.
 */
function _refresh() {
    _listDownloads(files => {
        if (!enabled)
            return;
        recent = files.slice(0, MAX_ROWS);
        recentCount = files.length;
        docks.forEach(_syncButton);
    });
}

function _queueRefresh() {
    if (sources.refresh)
        GLib.Source.remove(sources.refresh);
    // A download in progress touches its file over and over; wait for it to stop
    sources.refresh = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REFRESH_DELAY, () => {
        sources.refresh = 0;
        _refresh();
        return GLib.SOURCE_REMOVE;
    });
}

/**
 * The whole directory is read before anything is shown: the newest files can be
 * anywhere in the enumeration order, and the count of the rest is what the top
 * row reports.
 *
 * @param callback receives the file infos, newest first
 */
function _listDownloads(callback) {
    _downloadsFile().enumerate_children_async(
        LIST_ATTRIBUTES, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null,
        (source, result) => {
            let enumerator = null;
            try {
                enumerator = source.enumerate_children_finish(result);
            } catch (_) {
                // No Downloads folder, or it is not readable
            }
            if (enumerator)
                _readBatch(enumerator, [], callback);
            else
                callback([]);
        });
}

function _readBatch(enumerator, found, callback) {
    enumerator.next_files_async(LIST_BATCH, GLib.PRIORITY_DEFAULT, null,
        (source, result) => {
            let infos = [];
            try {
                infos = source.next_files_finish(result);
            } catch (_) {
                infos = [];
            }

            if (infos.length === 0) {
                source.close_async(GLib.PRIORITY_DEFAULT, null, null);
                found.sort((a, b) => _modified(b) - _modified(a));
                callback(found);
                return;
            }

            for (const info of infos) {
                if (!info.get_is_hidden() && !info.get_is_backup())
                    found.push(info);
            }
            _readBatch(source, found, callback);
        });
}

function _modified(info) {
    return info.get_attribute_uint64('time::modified');
}

/**
 * The picture on a row, in a box of the size every row uses, so the icons line
 * up in one column whatever shape they are.
 *
 * Nautilus has usually thumbnailed what the user downloaded, and that preview is
 * what macOS shows on the stack. A thumbnail is loaded as a texture rather than
 * as an icon: St.Icon squares off whatever it is given, which stretches a
 * photograph, while the texture cache scales it to fit and keeps its shape.
 *
 * @param info a file info from the Downloads folder
 * @param size the box, in logical pixels
 */
function _fileIcon(info, size) {
    const box = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        width: size * _scaleFactor(),
        height: size * _scaleFactor(),
    });

    const thumbnail = info.get_attribute_byte_string('thumbnail::path');
    const [format, imageWidth, imageHeight] = thumbnail
        ? GdkPixbuf.Pixbuf.get_file_info(thumbnail) : [null, 0, 0];

    if (format) {
        // The texture cache fills whatever box it is given, so the box has to
        // have the picture's shape already. Reading the header - which is all
        // get_file_info does - is what tells us that before it is loaded.
        const fit = Math.min(size / imageWidth, size / imageHeight);
        const texture = St.TextureCache.get_default().load_file_async(
            Gio.File.new_for_path(thumbnail),
            Math.round(imageWidth * fit), Math.round(imageHeight * fit),
            _scaleFactor(), 1);
        // A thumbnailer that pads its canvas to a square has drawn the paper
        // and the shadow under it into the picture itself - the margin around
        // it is transparent. Matting that would fill the margin white and bury
        // the shadow it came with, so only edge-to-edge pictures are framed.
        const framed = imageWidth !== imageHeight;
        // The frame is the picture's own shape, so the shadow follows the
        // picture rather than the box around it
        const frame = new St.Bin({
            style_class: framed ? 'kiwi-fan-thumbnail' : '',
            child: texture,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Smooth the frame's edges where it is turned, but only once the
        // picture has arrived: an offscreen effect on a zero-sized actor asks
        // Cogl for an empty viewport, which it warns about
        frame.connect('notify::allocation', () => {
            const allocation = frame.get_allocation_box();
            frame.offscreen_redirect =
                allocation.get_width() >= 1 && allocation.get_height() >= 1
                    ? Clutter.OffscreenRedirect.ALWAYS : 0;
        });
        box.add_child(frame);
    } else {
        box.add_child(new St.Icon({
            style_class: 'kiwi-fan-file-icon',
            gicon: info.get_icon(),
            icon_size: size,
        }));
    }

    return box;
}

function _displayName(info) {
    const name = info.get_display_name();
    return name.length > NAME_LIMIT ? `${name.slice(0, NAME_LIMIT - 1)}…` : name;
}

/* -------------------------------------------------------------------- fan */

/**
 * One entry of the fan: the picture, and a name pill hanging off to the left of
 * it. Only the picture is a button - the pill is there to be read.
 *
 * @param text the pill's text
 * @param iconActor the picture, from _fileIcon or a plain icon
 * @param iconClass style class for the picture's button
 * @param onActivate run when the picture is clicked
 */
function _makeRow(text, iconActor, iconClass, onActivate) {
    const row = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
    const label = new St.Label({
        style_class: 'kiwi-fan-label',
        text,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const icon = new St.Button({
        style_class: iconClass,
        child: iconActor,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Held down, it darkens like an app icon in the dock
    icon.connect('notify::pressed', () => _syncDarken(icon));
    icon.connect('clicked', onActivate);

    if (_prefersDark()) {
        label.add_style_class_name('dark');
        icon.add_style_class_name('dark');
    }

    row.add_child(label);
    row.add_child(icon);
    row.label = label;
    row.iconButton = icon;
    return row;
}

/**
 * Put a row on the arc: the icon lands on the point and the whole row - pill and
 * picture together - turns to the tangent there, the way a macOS stack tips its
 * entries over as the fan climbs.
 *
 * @param row a row built by _makeRow
 * @param x stage x of the point on the arc
 * @param y stage y of the point on the arc
 * @param degrees tilt at that point
 */
function _placeRow(row, x, y, degrees) {
    const [, , width, height] = row.get_preferred_size();
    const [, , iconWidth] = row.iconButton.get_preferred_size();
    row.set_size(width, height);
    row.set_position(Math.round(x - width + iconWidth / 2), Math.round(y - height / 2));
    // Turn around the picture, which is what sits on the arc, and grow out of it
    row.set_pivot_point((width - iconWidth / 2) / width, 0.5);
    row.rotation_angle_z = degrees;
}

/**
 * Where a row's pivot - the middle of its icon - currently sits on the stage.
 * That is the point the row flies out of and folds back into.
 *
 * @param row a placed row
 */
function _rowPivot(row) {
    const [x, y] = row.get_position();
    const [pivotX, pivotY] = row.get_pivot_point();
    return [x + row.width * pivotX, y + row.height * pivotY];
}

/**
 * Take the row off the pile: it starts as the card it was in the dock - same
 * place, same size, same tilt - and the card goes out from under it as it lifts,
 * so what leaves the dock is the card itself rather than a copy of it. The name
 * pill catches up on the way.
 *
 * @param row a row built by _makeRow, already placed on the arc
 * @param index its place in the fan, nearest the dock first
 * @param onLanded run when this row reaches the arc
 */
function _animateRowIn(row, index, onLanded) {
    const [pivotX, pivotY] = _rowPivot(row);
    const { start, card } = row;
    const tilt = row.rotation_angle_z;

    row.set({
        translation_x: start.x - pivotX,
        translation_y: start.y - pivotY,
        scale_x: start.scale,
        scale_y: start.scale,
        rotation_angle_z: start.tilt,
    });
    row.label.opacity = 0;

    const delay = index * ROW_STAGGER;
    row.label.ease({
        opacity: 255,
        duration: ROW_ANIMATION,
        delay,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
    // Out from under the row at the moment it starts moving, not before
    card?.ease({ opacity: 0, duration: 1, delay });
    row.ease({
        translation_x: 0,
        translation_y: 0,
        scale_x: 1,
        scale_y: 1,
        rotation_angle_z: tilt,
        duration: ROW_ANIMATION,
        delay,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        // Only once it has landed: a turned actor is rasterized edge by edge and
        // the pill's rounded corners come out with steps in them, which painting
        // it to a texture first smooths over. Doing that while the row moves
        // makes the shell rebuild that texture every frame, and the whole fan
        // flickers as each row arrives.
        onComplete: () => {
            row.offscreen_redirect = Clutter.OffscreenRedirect.ALWAYS;
            onLanded?.();
        },
    });
}

function _showFan(info) {
    // Before anything is measured: the fan hangs off the dock, so the dock has
    // to be out and staying out first
    _lockDock(info, true);

    const [buttonX, buttonY] = info.button.get_transformed_position();
    const [buttonWidth, buttonHeight] = info.button.get_transformed_size();
    const geometry = Main.layoutManager.monitors[info.dash._monitorIndex] ??
        Main.layoutManager.primaryMonitor;
    const scale = _scaleFactor();
    const iconSize = Math.round(info.dash.iconSize * FILE_ICON);
    const spacing = Math.round(iconSize * scale * ROW_SPACING);

    const anchorX = buttonX + buttonWidth / 2;
    const anchorY = buttonY;
    // Where the pile sits and how a card in it is placed: every row starts as
    // its own card, so it leaves the dock from exactly where the card lay
    const stack = info.button.child;
    const cards = stack.cards ?? [];
    const pileX = anchorX;
    const pileY = buttonY + buttonHeight / 2;
    const pile = _pileMetrics(info.dash);
    const cardStart = depth => ({
        x: pileX + depth * pile.step,
        y: pileY - depth * pile.step,
        scale: pile.size / iconSize,
        tilt: depth * STACK_TILT,
    });

    // The last row is the one that opens the folder and folds the fan back up
    const room = Math.floor((anchorY - geometry.y - TOP_MARGIN) / spacing) - 1;
    const shown = recent.slice(0, Math.max(0, Math.min(MAX_ROWS, room)));

    const overlay = new St.Widget({
        name: 'kiwi-downloads-fan',
        reactive: true,
        can_focus: true,
        x: 0,
        y: 0,
        width: global.stage.width,
        height: global.stage.height,
    });
    // Chrome, not just an actor in the ui group: the shell only routes pointer
    // events to what it has in its input region, and without that the fan is
    // drawn over the desktop but every click goes to the window underneath
    Main.layoutManager.addTopChrome(overlay);

    const folder = _downloadsFile();
    const rows = [];

    for (const file of shown) {
        rows.push(_makeRow(
            _displayName(file), _fileIcon(file, iconSize), 'kiwi-fan-icon',
            () => {
                _openUri(folder.get_child(file.get_name()).get_uri());
                _closeFan();
            }));
    }

    const rest = recentCount - shown.length;
    let text = gettextFunc('Open in Files');
    if (rest > 0)
        text = gettextFunc('%d More in Files').replace('%d', rest);
    else if (shown.length === 0)
        text = gettextFunc('Empty');

    // The row that ends the fan and goes on to the folder. Its button is filled
    // to its own edge, unlike a thumbnail sitting in a roomier box, so the row
    // holds the pill off it.
    const more = _makeRow(
        text,
        new St.Icon({
            style_class: 'kiwi-fan-more-icon',
            icon_name: 'go-next-symbolic',
            icon_size: Math.round(iconSize * 0.3),
        }),
        'kiwi-fan-more',
        () => {
            _openUri(folder.get_uri());
            _closeFan();
        });
    more.add_style_class_name('kiwi-fan-more-row');
    rows.push(more);

    // The arc leans to the right, as a macOS fan does, and the name pills hang
    // off to the left of it where there is room for them
    let x = anchorX;
    let y = anchorY;
    let angle = FAN_START;
    rows.forEach((row, index) => {
        // Under everything added before it, so the fan keeps the pile's order:
        // the newest card is on top there and nearest the dock here
        overlay.insert_child_at_index(row, 0);
        x += Math.sin(angle * Math.PI / 180) * spacing;
        y -= Math.cos(angle * Math.PI / 180) * spacing;
        _placeRow(row, x, y, angle);
        row.card = cards[index] ?? null;
        // Rows too deep to have a card of their own come out from under the
        // bottom one, which is where the pile ends
        row.start = cardStart(Math.min(index, Math.max(0, pile.depth - 1)));
        _animateRowIn(row, index);
        angle += FAN_STEP;
    });

    // Cards too deep for the fan to have room for still leave the pile - what
    // the dock shows while the fan is out is the folder, not a rump of a pile
    for (const card of cards.slice(rows.length))
        card.ease({ opacity: 0, duration: 1, delay: rows.length * ROW_STAGGER });

    const grab = Main.pushModal(overlay, { actionMode: Shell.ActionMode.POPUP });
    // A press on a row still bubbles up to here: St.Button tracks its press with
    // a click action, which does not consume the event. Closing the fan on it
    // would tear the row down before the release could make it a click, so only
    // a press that lands on the backdrop itself closes the fan.
    overlay.connect('button-press-event', (actor, event) => {
        if (global.stage.get_event_actor(event) !== actor)
            return Clutter.EVENT_PROPAGATE;
        _closeFan();
        return Clutter.EVENT_STOP;
    });
    overlay.connect('key-press-event', (_actor, event) => {
        if (event.get_key_symbol() !== Clutter.KEY_Escape)
            return Clutter.EVENT_PROPAGATE;
        _closeFan();
        return Clutter.EVENT_STOP;
    });

    fan = { overlay, grab, rows, info };
}

function _dropOverlay(overlay) {
    if (!overlay.get_stage())
        return;
    Main.layoutManager.removeChrome(overlay);
    overlay.destroy();
}

/**
 * Hold the dock out while the fan is open, the way Dash-to-Dock holds it out for
 * a drag or an open icon menu: the fan hangs off the dock, and an autohiding
 * dock would slide out from under it as soon as the pointer left.
 *
 * @param info the per-dock state
 * @param locked whether the fan is open
 */
function _lockDock(info, locked) {
    const container = info.container;
    // A dock torn down while the fan is open has nothing left to hold out
    if (!container._updateDashVisibility || !container.get_stage())
        return;

    info.dash.requiresVisibility = locked;
    if (locked) {
        container._updateDashVisibility();
        // Set last: the autohide branch above clears it
        container._ignoreHover = true;
    } else {
        container._ignoreHover = false;
        container._box.sync_hover();
        container._updateDashVisibility();
    }
}

function _closeFan() {
    if (!fan)
        return;

    const { overlay, grab, rows, info } = fan;
    fan = null;

    Main.popModal(grab);
    _lockDock(info, false);
    overlay.reactive = false;

    // Back down the way they came out and in the same order reversed: the
    // topmost row folds first, each one landing back on the card it left, and
    // the row nearest the dock is last - it takes the overlay with it.
    const stack = info.button?.child;
    rows.forEach((row, index) => {
        const [pivotX, pivotY] = _rowPivot(row);
        const { start, card } = row;
        row.offscreen_redirect = 0;
        row.label.ease({
            opacity: 0,
            duration: ROW_ANIMATION,
            delay: (rows.length - 1 - index) * ROW_STAGGER,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
        row.ease({
            translation_x: start.x - pivotX,
            translation_y: start.y - pivotY,
            scale_x: start.scale,
            scale_y: start.scale,
            rotation_angle_z: start.tilt,
            duration: ROW_ANIMATION,
            delay: (rows.length - 1 - index) * ROW_STAGGER,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                // The card takes the row's place again, under it
                if (card)
                    card.opacity = 255;
                if (index > 0)
                    return;
                _dropOverlay(overlay);
                // Rebuilt from the folder as it stands now, in case it changed
                // while the fan was out
                _syncButton(info);
            },
        });
    });

    for (const card of stack?.cards.slice(rows.length) ?? []) {
        card.ease({
            opacity: 255,
            duration: 1,
            delay: (rows.length - 1) * ROW_STAGGER,
        });
    }
}

function _toggleFan(info) {
    if (fan)
        _closeFan();
    else
        _showFan(info);
}

/* ------------------------------------------------------------------ docks */

/**
 * How the pile is laid out at a given dash icon size. Cards are as large as they
 * can be without covering the folder icon they sit on, and a deep pile gives up
 * just enough room for its steps to stay inside the same rim.
 *
 * @param dash the Dash-to-Dock dash actor
 */
function _pileMetrics(dash) {
    const depth = Math.min(recent.length, STACK_DEPTH);
    const span = Math.max(0, depth - 1) * STACK_STEP;
    return {
        depth,
        size: Math.round(dash.iconSize * Math.min(STACK_ITEM, STACK_EXTENT - span)),
        step: Math.round(dash.iconSize * STACK_STEP * _scaleFactor()),
    };
}

/**
 * The dock item: the newest files piled one on the other, newest in front, each
 * one behind it a step further up and a degree further over, with the folder
 * icon at the back of the pile. The folder is hidden while there are cards over
 * it and surfaces as they leave, which is what empties the pile.
 *
 * @param dash the Dash-to-Dock dash actor
 */
function _stackIcon(dash) {
    const scale = _scaleFactor();
    const box = new St.Widget({
        style_class: 'kiwi-downloads-stack',
        layout_manager: new Clutter.BinLayout(),
        width: Math.round(dash.iconSize * scale),
        height: Math.round(dash.iconSize * scale),
    });

    // The bottom of the pile, and what is left of it once the cards have gone
    box.add_child(new St.Icon({
        gicon: new Gio.ThemedIcon({ name: 'folder-download' }),
        icon_size: dash.iconSize,
    }));

    const { depth: pileDepth, size, step } = _pileMetrics(dash);
    box.cards = [];
    // Added back to front, so the newest ends up on top of the pile
    for (let depth = pileDepth - 1; depth >= 0; depth--) {
        const card = _fileIcon(recent[depth], size);
        card.set({
            translation_x: depth * step,
            translation_y: -depth * step,
            rotation_angle_z: depth * STACK_TILT,
        });
        box.add_child(card);
        box.cards[depth] = card;
    }
    return box;
}

function _makeButton(info) {
    const { dash } = info;
    const button = new St.Button({
        style_class: 'kiwi-downloads-item',
        can_focus: true,
        track_hover: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    button.set_child(_stackIcon(dash));

    // Sit where an app icon sits rather than in the middle of the slot
    const offset = iconOffset(dash);
    if (dash._isHorizontal ?? true)
        button.translation_y = offset;
    else
        button.translation_x = offset;

    button.connect('notify::pressed', () => _syncPress(info));
    button.connect('clicked', () => _toggleFan(info));
    return button;
}

function _syncButton(info) {
    // Not while the fan is out: the rows hold on to the cards they came from,
    // and the pile is rebuilt from the folder as it is when the fan folds back
    if (info.button && !fan)
        info.button.set_child(_stackIcon(info.dash));
}

/**
 * The darken dock styling puts on an app icon while it is held.
 *
 * @param button the button being pressed or released
 */
function _syncDarken(button) {
    if (button.pressed) {
        const effect = new Clutter.BrightnessContrastEffect({ name: 'kiwi-press-darken' });
        effect.set_brightness(PRESS_BRIGHTNESS);
        button.add_effect(effect);
    } else {
        button.remove_effect_by_name('kiwi-press-darken');
    }
}

/**
 * Darken the item while it is held, the way dock styling darkens the app icons.
 * That styling only reaches the icons Dash-to-Dock owns, and it is behind its
 * own setting - which the dock wears as a style class, so following the class
 * follows the setting.
 *
 * @param info the per-dock state
 */
function _syncPress(info) {
    if (info.container.has_style_class_name('kiwi-dock-styled'))
        _syncDarken(info.button);
    else
        info.button.remove_effect_by_name('kiwi-press-darken');
}

function _buildItem(info) {
    info.iconSize = info.dash.iconSize;
    info.button = _makeButton(info);
    info.item = makeDashItem(info.dash, info.button, gettextFunc('Downloads'));
    info.item.connect('destroy', () => {
        info.item = null;
        info.button = null;
        _queueReplace();
    });
    info.item.show(false);
}

/**
 * Minimize-to-dock already keeps a strip after the app icons; join that one when
 * it is there so both features share one divider, and take the front of it, in
 * front of the minimized windows. Without it, a strip of our own holds the stack
 * alone.
 *
 * @param info the per-dock state
 */
function _placeItem(info) {
    if (!info.item)
        _buildItem(info);

    const strip = info.dash._boxContainer.get_children()
        .find(child => child.name === 'kiwi-minimized-strip') ?? info.strip;

    if (info.item.get_parent() !== strip) {
        info.item.get_parent()?.remove_child(info.item);
        if (info.stripSignal) {
            const [previous, id] = info.stripSignal;
            previous.disconnect(id);
        }
        strip.add_child(info.item);
        // Minimize-to-dock keeps adding tiles to the strip we just joined, and
        // they land above us; take our place back after each one
        info.stripSignal = [strip, strip.connect('child-added', () => _queueReplace())];
    }

    // At the head of the strip, after the divider that opens it: the stack comes
    // before the minimized windows, and the trash stays at the end
    const first = strip.get_first_child();
    const divider = first?.get_style_class_name?.()?.includes('dash-separator');
    strip.set_child_at_index(info.item, divider ? 1 : 0);

    _syncSeparator(info, strip === info.strip);
}

/**
 * Standing alone after the app icons, the stack needs the divider macOS draws in
 * front of it. In the minimized strip that divider is already there, and
 * Dash-to-Dock draws one of its own for a dock without loose running apps.
 *
 * @param info the per-dock state
 * @param own whether the stack sits in our strip rather than the minimized one
 */
function _syncSeparator(info, own) {
    const separated = info.dash._box.get_children().at(-1)
        ?.get_style_class_name?.()?.includes('dash-separator');
    const wanted = own && !separated;

    if (wanted && !info.separator) {
        info.separator = makeDashSeparator(info.dash);
        info.strip.insert_child_at_index(info.separator, 0);
    } else if (!wanted && info.separator) {
        info.separator.destroy();
        info.separator = null;
    }
}

/**
 * Both strips are rebuilt from under us — Dash-to-Dock redisplays, minimize-to-
 * dock adds tiles and adopts a fresh trash item — so never restructure while
 * that is going on.
 */
function _queueReplace() {
    if (sources.replace || !enabled)
        return;
    sources.replace = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        sources.replace = 0;
        docks.forEach(_placeItem);
        return GLib.SOURCE_REMOVE;
    });
}

function _attachDock(dockContainer) {
    // dashtodockContainer → _slider → child (dashtodockBox) → dash
    const dashBox = dockContainer._slider?.get_child();
    const dash = dashBox?.get_children().find(c => c.name === 'dash');
    if (!dash?._box || !dash._boxContainer)
        return;
    if (docks.some(existing => existing.dash === dash))
        return;

    const isHorizontal = dash._isHorizontal ?? true;
    const strip = new St.BoxLayout({
        name: 'kiwi-downloads-strip',
        orientation: isHorizontal
            ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL,
        x_align: isHorizontal ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER,
        y_align: isHorizontal ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START,
    });
    dash._boxContainer.insert_child_above(strip, dash._box);

    const info = {
        dash,
        container: dockContainer,
        strip,
        item: null,
        button: null,
        iconSize: dash.iconSize,
        signals: [],
        stripSignal: null,
        separator: null,
    };

    // The minimized strip comes and goes with its own setting; a strip torn down
    // takes our item with it, and the destroy handler queues the rebuild
    const containerId = dash._boxContainer.connect('child-added', () => _queueReplace());
    info.signals.push([dash._boxContainer, containerId]);

    // Dash-to-Dock shrinks its icons to fit the monitor; follow that size
    const sizeId = dash._box.connect(
        isHorizontal ? 'notify::height' : 'notify::width', () => {
            if (dash.iconSize === info.iconSize || !info.button)
                return;
            info.iconSize = dash.iconSize;
            _syncButton(info);
            // The dock pads a smaller icon differently, so the offset moves too
            const offset = iconOffset(dash);
            if (isHorizontal)
                info.button.translation_y = offset;
            else
                info.button.translation_x = offset;
        });
    info.signals.push([dash._box, sizeId]);

    const destroyId = dash.connect('destroy', () => _detachDock(info, false));
    info.signals.push([dash, destroyId]);

    docks.push(info);
    _placeItem(info);
    _queueReplace();
}

function _detachDock(info, removeActors = true) {
    _disconnectAll(info.signals);
    info.signals = [];

    if (info.stripSignal) {
        const [strip, id] = info.stripSignal;
        strip.disconnect(id);
        info.stripSignal = null;
    }

    _closeFan();

    if (removeActors) {
        info.item?.destroy();
        info.strip.destroy();
    }
    info.item = null;
    info.button = null;
    info.separator = null;

    docks = docks.filter(other => other !== info);
}

function _attachExistingDocks() {
    for (const child of Main.uiGroup.get_children()) {
        if (child.name === 'dashtodockContainer')
            _attachDock(child);
    }
}

function _watchDocks() {
    const uiGroupId = Main.uiGroup.connect('child-added', (_group, actor) => {
        if (actor.name === 'dashtodockContainer')
            _attachDock(actor);
    });
    globalSignals.push([Main.uiGroup, uiGroupId]);

    _attachExistingDocks();

    // The dock may still be loading, retry for a while
    if (docks.length === 0) {
        let attempts = 0;
        sources.dockSearch = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            _attachExistingDocks();
            if (docks.length > 0 || ++attempts >= 10) {
                sources.dockSearch = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }
}

/* ----------------------------------------------------------- entry points */

export function enable(gettext) {
    if (typeof gettext === 'function')
        gettextFunc = gettext;
    if (enabled)
        return;
    enabled = true;

    const overviewId = Main.overview.connect('showing', () => _closeFan());
    globalSignals.push([Main.overview, overviewId]);

    // The pile on the dock shows what is in the folder, so it follows the folder
    folderMonitor = _downloadsFile().monitor_directory(
        Gio.FileMonitorFlags.WATCH_MOVES, null);
    const changedId = folderMonitor.connect('changed', () => _queueRefresh());
    globalSignals.push([folderMonitor, changedId]);
    _refresh();

    // During startup the dock is not laid out yet, same caveat as dockBlur
    if (Main.layoutManager._startingUp) {
        const startupId = Main.layoutManager.connect('startup-complete', () => _watchDocks());
        globalSignals.push([Main.layoutManager, startupId]);
        return;
    }
    _watchDocks();
}

export function disable() {
    enabled = false;

    for (const key of Object.keys(sources)) {
        if (sources[key])
            GLib.Source.remove(sources[key]);
        sources[key] = 0;
    }

    if (fan) {
        Main.popModal(fan.grab);
        _lockDock(fan.info, false);
        _dropOverlay(fan.overlay);
        fan = null;
    }

    _disconnectAll(globalSignals);
    globalSignals = [];

    [...docks].forEach(info => _detachDock(info));

    folderMonitor?.cancel();
    folderMonitor = null;
    recent = [];
    recentCount = 0;

    gettextFunc = message => message;
}

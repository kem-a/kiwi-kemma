// SPDX-License-Identifier: GPL-3.0-or-later
// Shared Dash-to-Dock plumbing. Four modules hang things off the dock - blur,
// icon styling, minimized windows, the downloads stack - and each one has to find
// the dock, wait for it to load, build items the dock's own way and take them
// apart again. That is all here so they agree on how it is done.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { DashItemContainer } from 'resource:///org/gnome/shell/ui/dash.js';

const CONTAINER_NAME = 'dashtodockContainer';
const D2D_SCHEMA = 'org.gnome.shell.extensions.dash-to-dock';
const D2D_UUIDS = ['dash-to-dock@micxgx.gmail.com', 'ubuntu-dock@ubuntu.com'];
const DOCK_SEARCH_INTERVAL = 1000; // ms between tries while the dock loads
const DOCK_SEARCH_TRIES = 10;
const PRESS_EFFECT = 'kiwi-press-darken';
const PRESS_BRIGHTNESS = -0.6;

/* ---------------------------------------------------------- shell helpers */

export function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scaleFactor;
}

export function prefersDark() {
    return St.Settings.get().colorScheme === St.SystemColorScheme.PREFER_DARK;
}

export function disconnectAll(pairs) {
    for (const [object, id] of pairs)
        object.disconnect(id);
}

/* -------------------------------------------------------- dock discovery */

/**
 * A real dock, as opposed to the bare St.Bin of the same name that Dash-to-Dock
 * parks in the uiGroup for a moment to read alphas off the theme
 * (theming.js _getAlphas). That one is added and removed inside a single call,
 * so it fires 'child-added' like a dock but never gets a dash - and, since it is
 * only unparented and not destroyed, whoever took it for a dock keeps holding it.
 * The slider is built before the dock reaches the uiGroup, so it tells them apart
 * from the first signal.
 *
 * @param actor a Main.uiGroup child
 */
export function isDock(actor) {
    return actor.name === CONTAINER_NAME && actor._slider !== undefined;
}

/** Dash-to-Dock adds one container per monitor to Main.uiGroup. */
export function dockContainers() {
    return Main.uiGroup.get_children().filter(isDock);
}

/**
 * The dash inside a dock container:
 * dashtodockContainer → _slider → child (dashtodockBox) → dash
 *
 * @param dockContainer a dashtodockContainer actor
 */
export function dashOf(dockContainer) {
    const dashBox = dockContainer._slider?.get_child();
    return dashBox?.get_children().find(child => child.name === 'dash') ?? null;
}

function isHorizontal(dash) {
    return dash._isHorizontal ?? true;
}

/**
 * Attach to every dock there is and every one that turns up later. Dash-to-Dock
 * may still be loading when we are enabled, so keep looking for a while.
 *
 * @param attach called with each dock container
 * @param count returns how many docks are attached so far
 * @param globalSignals signal list the Main.uiGroup handler is recorded in
 * @param sources source table whose 'dockSearch' slot holds the retry timeout
 */
export function watchDocks({ attach, count, globalSignals, sources }) {
    const uiGroupId = Main.uiGroup.connect('child-added', (_group, actor) => {
        if (isDock(actor))
            attach(actor);
    });
    globalSignals.push([Main.uiGroup, uiGroupId]);

    dockContainers().forEach(attach);
    if (count() > 0)
        return;

    let attempts = 0;
    if (sources.dockSearch)
        GLib.Source.remove(sources.dockSearch);
    sources.dockSearch = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DOCK_SEARCH_INTERVAL, () => {
        dockContainers().forEach(attach);
        if (count() > 0 || ++attempts >= DOCK_SEARCH_TRIES) {
            sources.dockSearch = 0;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
}

/* ------------------------------------------------------------ dash items */

/**
 * A strip of our own inside the dash, after Dash-to-Dock's own box of icons.
 *
 * @param dash the Dash-to-Dock dash actor
 * @param name actor name, so the strips can find each other
 */
export function makeStrip(dash, name) {
    const horizontal = isHorizontal(dash);
    return new St.BoxLayout({
        name,
        orientation: horizontal
            ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL,
        x_align: horizontal ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER,
        y_align: horizontal ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START,
    });
}

export function makeDashSeparator(dash) {
    const horizontal = isHorizontal(dash);
    return new St.Widget({
        style_class: 'dash-separator',
        x_align: horizontal ? Clutter.ActorAlign.FILL : Clutter.ActorAlign.CENTER,
        y_align: horizontal ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL,
        width: horizontal ? -1 : dash.iconSize,
        height: horizontal ? dash.iconSize : -1,
    });
}

let d2dSettings;              // undefined until looked up, null without the dock

/**
 * The default schema source only covers the system-wide directories, so a dock
 * installed in the user's home is only found through its own schemas directory.
 */
function lookupDockSchema() {
    const source = Gio.SettingsSchemaSource.get_default();
    // A schema that is not installed aborts the shell rather than throwing
    const schema = source?.lookup(D2D_SCHEMA, true);
    if (schema)
        return schema;

    for (const uuid of D2D_UUIDS) {
        const dir = Main.extensionManager.lookup(uuid)?.dir.get_child('schemas');
        if (!dir?.get_child('gschemas.compiled').query_exists(null))
            continue;
        const own = Gio.SettingsSchemaSource.new_from_directory(dir.get_path(), source, true)
            .lookup(D2D_SCHEMA, true);
        if (own)
            return own;
    }
    return null;
}

/** Dash-to-Dock's own settings, or null when it is not installed. */
export function dockSettings() {
    if (d2dSettings === undefined) {
        const schema = lookupDockSchema();
        d2dSettings = schema ? new Gio.Settings({ settings_schema: schema }) : null;
    }
    return d2dSettings;
}

/** Nothing that hangs off the dock has anywhere to go without it. */
export function dockInstalled() {
    return dockSettings() !== null;
}

/**
 * Whether Dash-to-Dock is set to keep its tooltips to itself. It only asks the
 * question of its own app icons - the shell shows a label for any other dash
 * item that is hovered, and has nothing to ask - so our items have to honour the
 * setting on their own.
 */
function tooltipsHidden() {
    return dockSettings()?.get_boolean('hide-tooltip') ?? false;
}

/**
 * Wrap a tile in the same item container Dash-to-Dock uses for its icons, so
 * hover labels, positioning and the zoom-in animation match the rest of the dock.
 *
 * @param dash the Dash-to-Dock dash actor
 * @param child the tile actor
 * @param labelText text for the hover label
 */
export function makeDashItem(dash, child, labelText) {
    const sibling = dash._box.get_children().find(c => typeof c.setLabelText === 'function');
    const Container = sibling ? sibling.constructor : DashItemContainer;
    const item = sibling ? new Container(dash._position) : new Container();
    item.setChild(child);
    item.setLabelText(labelText);
    dash._hookUpLabel(item);
    // Asked on the hover rather than here, so the setting is followed as it is
    // turned rather than as the item was built
    const showLabel = item.showLabel.bind(item);
    item.showLabel = () => {
        if (!tooltipsHidden())
            showLabel();
    };
    return item;
}

export function isTrashItem(child) {
    return !!child.child?._delegate?.app?.isTrash;
}

/**
 * Whether Dash-to-Dock's own separator already closes its box, marking the same
 * boundary we would draw. A trash item it has just rebuilt sits after that
 * separator until the idle-time adoption takes it away; counting it would have
 * us draw a second separator and drop it again on every redisplay.
 *
 * @param dash the Dash-to-Dock dash actor
 */
export function dashEndsWithSeparator(dash) {
    const last = dash._box.get_children().findLast(child => !isTrashItem(child));
    return !!last?.get_style_class_name?.()?.includes('dash-separator');
}

/**
 * Move an actor to where an app icon sits rather than the middle of its slot.
 * Dash-to-Dock pads its icon buttons unevenly so that the icons come out centred
 * in the dock background, which is itself shorter than the slot; our items have
 * to take the same step or they hang below the background. The icon box inside
 * the button adds a step of its own - it holds the running dot below the icon -
 * so the art is off the centre of the button by that much again.
 *
 * @param dash the Dash-to-Dock dash actor
 * @param actor the item to offset
 */
export function applyIconOffset(dash, actor) {
    const button = dash._box.get_children().find(c => c.child?._delegate?.icon)?.child;
    let offset = 0;

    if (button) {
        const icon = button._delegate.icon;
        button.ensure_style();
        icon.ensure_style();
        const [near, far] = isHorizontal(dash)
            ? [St.Side.TOP, St.Side.BOTTOM] : [St.Side.LEFT, St.Side.RIGHT];
        const step = node => node.get_padding(near) - node.get_padding(far);
        offset = Math.round(
            (step(button.get_theme_node()) + step(icon.get_theme_node())) / 2);
    }

    if (isHorizontal(dash))
        actor.translation_y = offset;
    else
        actor.translation_x = offset;
}

/* --------------------------------------------------------- press feedback */

/**
 * The darken dock styling puts on an icon while it is held.
 *
 * @param button the button being pressed or released
 * @param active false to make sure the darken is gone, whatever the press state
 */
export function syncDarken(button, active = true) {
    if (active && button.pressed) {
        const effect = new Clutter.BrightnessContrastEffect({ name: PRESS_EFFECT });
        effect.set_brightness(PRESS_BRIGHTNESS);
        button.add_effect(effect);
    } else {
        button.remove_effect_by_name(PRESS_EFFECT);
    }
}

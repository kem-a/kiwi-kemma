// SPDX-License-Identifier: GPL-3.0-or-later
// Hops a dock icon up and down while its app is starting, macOS style.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { dashOf, disconnectAll, dockContainers, watchDocks } from './dockUtils.js';

const RISE_MS = 420;
const FALL_MS = 480;
const HOP = 0.5;    // of the icon size, enough to clear the dock
const MIN_HOPS = 2; // a quick launch still gets a hop worth seeing
const MAX_HOPS = 5; // an app that never opens a window stops hopping anyway

let appSystem = null;
let stateChangedId = 0;
let hookedDocks = 0;
const signals = [];
const sources = {};
const hopping = new Set();
const restores = [];

/**
 * The icon art of every dock icon standing for this app. The bin is what
 * Dash-to-Dock animates for its own urgent wiggle, so moving it leaves the
 * dock layout alone.
 *
 * @param app the app that is starting
 */
function binsFor(app) {
    const bins = [];

    for (const container of dockContainers()) {
        const dash = dashOf(container);
        const button = dash?._box.get_children()
            .find(c => c.child?._delegate?.app === app)?.child;
        const bin = button?._delegate?.icon?._iconBin;
        if (bin)
            bins.push([dash, bin]);
    }

    return bins;
}

/** The axis and distance of the hop, away from the screen edge the dock is on.
 *
 * @param dash the Dash-to-Dock dash actor
 */
function hopOffset(dash) {
    const distance = Math.round(dash.iconSize * HOP);

    switch (dash._position) {
    case St.Side.TOP:
        return ['translation_y', distance];
    case St.Side.LEFT:
        return ['translation_x', distance];
    case St.Side.RIGHT:
        return ['translation_x', -distance];
    default:
        return ['translation_y', -distance];
    }
}

/**
 * The dock keeps its contents clipped to itself, so a hop would be cut off at
 * the edge rather than rising over it. Every clip between the icon and the top
 * comes off for as long as an icon is in the air. Anything already lifted reads
 * as clear here, so a second icon adds no duplicates.
 *
 * @param bin the icon art about to hop
 */
function unclip(bin) {
    for (let actor = bin.get_parent(); actor; actor = actor.get_parent()) {
        if (actor.clip_to_allocation) {
            actor.clip_to_allocation = false;
            restores.push(() => (actor.clip_to_allocation = true));
        }

        if (actor.clip_to_view) {
            actor.clip_to_view = false;
            restores.push(() => (actor.clip_to_view = true));
        }

        // Dash-to-Dock's slide container sets a hard clip from its allocate, so
        // taking it off once is not enough; it goes back on at every layout.
        // The clip itself is what to listen for - an allocation is notified
        // before the clip that follows it is set, which is too early to undo.
        const clip = actor.get_clip();
        if (clip[2] > 0 || clip[3] > 0) {
            let dropping = false;
            const reclippedId = actor.connect('notify::clip-rect', () => {
                if (dropping)
                    return;
                dropping = true;
                actor.remove_clip();
                dropping = false;
            });
            actor.remove_clip();
            restores.push(() => {
                actor.disconnect(reclippedId);
                actor.set_clip(...clip);
            });
        }
    }
}

function reclip() {
    if (hopping.size)
        return;

    restores.forEach(restore => restore());
    restores.length = 0;
}

function settle(bin) {
    bin.remove_all_transitions();
    bin.translation_x = 0;
    bin.translation_y = 0;
    hopping.delete(bin);
    reclip();
}

// TEMP diagnostics: what is still clipping at the top of the arc, and where the
// icon actually is on screen. Remove once the last cut is explained.
function reportApex(bin, app) {
    const guilty = [];
    for (let a = bin.get_parent(); a; a = a.get_parent()) {
        const c = a.get_clip();
        const flags = [
            c[2] > 0 || c[3] > 0 ? `clip=${c.join()}` : '',
            a.clip_to_allocation ? 'cta' : '',
            a.clip_to_view ? 'ctv' : '',
        ].filter(f => f);
        if (flags.length) {
            const [ax, ay] = a.get_transformed_position();
            guilty.push(`${a.constructor?.name}${a.name ? `#${a.name}` : ''}` +
                `@${Math.round(ax)},${Math.round(ay)} ${a.width}x${a.height} ${flags.join(' ')}`);
        }
    }

    const [bx, by] = bin.get_transformed_position();
    console.log(`KIWI-APEX ${app.get_id()} bin@${Math.round(bx)},${Math.round(by)} ` +
        `${bin.width}x${bin.height} | ${guilty.length ? guilty.join(' < ') : 'nothing clipping'}`);
}

function hop(dash, bin, app, done) {
    // Out of hops, or the app has a window up and it has hopped enough to be
    // seen, or its icon has gone. A window is the one signal every app gives,
    // whether or not it reports a startup sequence.
    if (done >= MAX_HOPS || !bin.get_parent() ||
        (done >= MIN_HOPS && app.get_n_windows() > 0)) {
        settle(bin);
        return;
    }

    const [axis, distance] = hopOffset(dash);

    bin.ease({
        [axis]: distance,
        duration: RISE_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => (reportApex(bin, app), bin.ease({
            [axis]: 0,
            duration: FALL_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => hop(dash, bin, app, done + 1),
        })),
    });
}

function start(app) {
    if (!St.Settings.get().enable_animations)
        return;

    for (const [dash, bin] of binsFor(app)) {
        if (hopping.has(bin))
            continue;

        hopping.add(bin);
        unclip(bin);
        hop(dash, bin, app, 0);
    }
}

/**
 * An app with StartupNotify=false never reaches Shell.AppState.STARTING, so a
 * click on its icon is the only notice we get that it is on its way.
 *
 * @param item a dash item container
 */
function hookItem(item) {
    const button = item.child;
    const app = button?._delegate?.app;
    if (!app || button._kiwiBounceId)
        return;

    button._kiwiBounceId = button.connect('clicked', () => {
        if (app.get_n_windows() === 0)
            start(app);
    });
    signals.push([button, button._kiwiBounceId]);
}

function attach(container) {
    const dash = dashOf(container);
    if (!dash || dash._kiwiBounceHooked)
        return;

    dash._kiwiBounceHooked = true;
    hookedDocks++;
    dash._box.get_children().forEach(hookItem);
    signals.push([dash._box, dash._box.connect('child-added', (_box, item) => hookItem(item))]);
}

export function enable() {
    if (appSystem)
        return;

    appSystem = Shell.AppSystem.get_default();
    stateChangedId = appSystem.connect('app-state-changed', (system, app) => {
        if (app.state === Shell.AppState.STARTING)
            start(app);
    });

    watchDocks({
        attach,
        count: () => hookedDocks,
        globalSignals: signals,
        sources,
    });
}

export function disable() {
    if (!appSystem)
        return;

    appSystem.disconnect(stateChangedId);
    stateChangedId = 0;
    appSystem = null;

    if (sources.dockSearch) {
        GLib.Source.remove(sources.dockSearch);
        sources.dockSearch = 0;
    }

    disconnectAll(signals);
    signals.length = 0;
    dockContainers().forEach(container => {
        const dash = dashOf(container);
        if (dash)
            delete dash._kiwiBounceHooked;
        dash?._box.get_children().forEach(item => delete item.child?._kiwiBounceId);
    });
    hookedDocks = 0;

    [...hopping].forEach(settle);
}

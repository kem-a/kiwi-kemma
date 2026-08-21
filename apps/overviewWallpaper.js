// SPDX-License-Identifier: GPL-3.0-or-later
// Blurs the overview background on the GPU instead of pre-blurring the wallpaper
// with ImageMagick.
//
// The wallpaper is static and sits at the bottom of the overview, so a
// Shell.BlurEffect in ACTOR mode blurs it through ClutterOffscreenEffect, which
// caches its offscreen until the actor is dirty - i.e. once, not per frame. That
// removes the whole ImageMagick path: no subprocess, no cache files, no meta files,
// no regeneration bookkeeping, and no JPEG decode or CPU upscale on the frame that
// first paints #overviewGroup.
//
// Meta.Background follows the wallpaper and the light/dark variant by itself, so
// wallpaper changes need no handling here at all.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';

const GROUP_NAME = 'kiwi-overview-blur-group';
const EFFECT_NAME = 'kiwi-overview-blur';

// Radius goes to clutter_blur_node_new() after being divided by the effect's
// downscale_factor, and blurring a downscaled texture then upscaling it smooths
// further, so the result reads stronger than the nominal radius suggests. 80 matched
// the ImageMagick sigma on paper but looked over-blurred; this is the knob to turn.
const BLUR_RADIUS = 60;
// The ImageMagick path darkened by 20% (dark) and 35% (light) via -colorize black;
// brightness is the same adjustment expressed as a multiplier.
const BRIGHTNESS_DARK = 0.80;
const BRIGHTNESS_LIGHT = 0.65;

let _enabled = false;
let _settings = null;
let _group = null;
let _managers = [];
let _groupSignals = [];   // reconnected on every rebuild
let _globalSignals = [];  // live for as long as the module is enabled

function _brightness() {
    return St.Settings.get().colorScheme === St.SystemColorScheme.PREFER_DARK
        ? BRIGHTNESS_DARK : BRIGHTNESS_LIGHT;
}

function _disconnect(list) {
    for (const [obj, id] of list) {
        try { obj.disconnect(id); } catch (_) { /* actor already gone */ }
    }
    list.length = 0;
}

function _teardown() {
    _disconnect(_groupSignals);

    // Each manager owns the Meta.BackgroundActor it parented into its holder, so it
    // has to go before the holders are destroyed under it.
    _managers.forEach(manager => manager.destroy());
    _managers = [];

    if (_group) {
        _group.get_parent()?.remove_child(_group);
        _group.destroy_all_children();
        _group.destroy();
        _group = null;
    }
}

function _build() {
    _teardown();

    _group = new Meta.BackgroundGroup({ name: GROUP_NAME });
    const brightness = _brightness();

    Main.layoutManager.monitors.forEach((monitor, index) => {
        const holder = new St.Widget({
            name: EFFECT_NAME,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        });
        holder.add_effect_with_name(EFFECT_NAME, new Shell.BlurEffect({
            mode: Shell.BlurMode.ACTOR,
            radius: BLUR_RADIUS,
            brightness,
        }));

        // BackgroundManager parents a Meta.BackgroundActor into the holder and keeps
        // it on the current wallpaper. controlPosition:false skips its own layout
        // pass, which would reorder siblings and flash the unblurred colour through
        // while a new background loads.
        _managers.push(new Background.BackgroundManager({
            container: holder,
            monitorIndex: index,
            controlPosition: false,
        }));

        _group.add_child(holder);
    });

    const overviewGroup = Main.layoutManager.overviewGroup;
    overviewGroup.insert_child_at_index(_group, 0);

    // Anything the shell adds to overviewGroup later would otherwise land beneath
    // the blur and be hidden by it.
    _groupSignals.push([overviewGroup, overviewGroup.connect('child-added', (group, child) => {
        if (child !== _group)
            group.set_child_below_sibling(_group, null);
    })]);
}

function _syncBrightness() {
    const brightness = _brightness();
    _group?.get_children().forEach(holder => {
        const effect = holder.get_effect(EFFECT_NAME);
        if (effect)
            effect.brightness = brightness;
    });
}

export function enable(settings) {
    if (_enabled)
        return;
    _settings = settings;
    if (!_settings.get_boolean('overview-wallpaper-background'))
        return;
    _enabled = true;

    _build();

    // A monitor change invalidates every holder's geometry, so rebuild outright.
    _globalSignals.push([Main.layoutManager,
        Main.layoutManager.connect('monitors-changed', () => _build())]);
    // Only the darkening depends on the colour scheme; the wallpaper swap itself is
    // BackgroundManager's job.
    _globalSignals.push([St.Settings.get(),
        St.Settings.get().connect('notify::color-scheme', () => _syncBrightness())]);
}

// Kept for extension.js, which calls this after enable(). There is nothing to
// regenerate any more, so it only has to cover the case of being called first.
export function refresh() {
    if (_enabled && !_group)
        _build();
}

export function disable() {
    _enabled = false;
    _disconnect(_globalSignals);
    _teardown();
    _settings = null;
}

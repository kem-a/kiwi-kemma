// SPDX-License-Identifier: GPL-3.0-or-later
// Replaces GNOME's window open/close animation with a subtle macOS-style fade.

import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// macOS-style: a quick fade in/out with only a barely-there scale, anchored at
// the window center. Open decelerates (ease-out), close accelerates (ease-in).
const OPEN_DURATION = 100;     // ms
const OPEN_SCALE_FROM = 0.97;
const CLOSE_DURATION = 70;     // ms
const CLOSE_SCALE_TO = 0.97;

let _origShouldAnimateActor = null;

export function enable() {
    if (_origShouldAnimateActor)
        return;

    _origShouldAnimateActor = Main.wm._shouldAnimateActor;

    // _shouldAnimateActor() is the last hook before actor.ease(). The
    // 'map'/'destroy' handlers are bound at shell startup, so reassigning
    // _mapWindow/_destroyWindow would not intercept them; reassigning this
    // dynamically-dispatched helper does. We keep GNOME's own onStopped
    // completion callback intact and only rewrite the ease params.
    Main.wm._shouldAnimateActor = function (actor, types) {
        const shouldAnimate = _origShouldAnimateActor.call(this, actor, types);
        if (!shouldAnimate || actor._kiwiEasePatched)
            return shouldAnimate;

        // One-shot replacement of ease(): the caller calls it next. Which
        // animation we are in is only decided there — _mapWindow/_destroyWindow
        // register the actor in wm._mapping/_destroying between this call and
        // theirs, so a Set lookup replaces sniffing the caller off a stack.
        actor._kiwiEasePatched = true;
        const origEase = actor.ease;
        actor.ease = function (params) {
            actor.ease = origEase;
            actor._kiwiEasePatched = false;

            const forOpening = Main.wm._mapping.has(actor);
            const forClosing = Main.wm._destroying.has(actor);
            // Leave minimize and size-change (maximize/fullscreen) animations alone.
            if (!forOpening && !forClosing)
                return origEase.call(this, params);

            actor.set_pivot_point(0.5, 0.5);

            if (forOpening) {
                actor.scale_x = OPEN_SCALE_FROM;
                actor.scale_y = OPEN_SCALE_FROM;
                actor.opacity = 0;
                params.scale_x = 1;
                params.scale_y = 1;
                params.opacity = 255;
                params.duration = OPEN_DURATION;
                params.mode = Clutter.AnimationMode.EASE_OUT_QUAD;
            } else {
                params.scale_x = CLOSE_SCALE_TO;
                params.scale_y = CLOSE_SCALE_TO;
                params.opacity = 0;
                params.duration = CLOSE_DURATION;
                params.mode = Clutter.AnimationMode.EASE_IN_QUAD;
            }

            return origEase.call(this, params);
        };

        return shouldAnimate;
    };
}

export function disable() {
    if (!_origShouldAnimateActor)
        return;
    Main.wm._shouldAnimateActor = _origShouldAnimateActor;
    _origShouldAnimateActor = null;
}

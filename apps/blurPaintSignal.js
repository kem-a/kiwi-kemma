// SPDX-License-Identifier: GPL-3.0-or-later
// Clutter effect that emits 'update-blur' whenever its actor is painted.
// Shell.BlurEffect (BACKGROUND mode) does not repaint when content above it
// repaints (GNOME Shell #2857), leaving squared artifacts around buttons and
// icons. Attaching this effect to the blur widget forces a (throttled) blur
// repaint whenever the widget itself is painted — same hack as blur-my-shell.

import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

export const BlurPaintSignal = GObject.registerClass({
    GTypeName: 'KiwiBlurPaintSignal',
    Signals: {
        'update-blur': {},
    },
}, class BlurPaintSignal extends Clutter.Effect {
    vfunc_paint(node, paintContext, paintFlags) {
        this.emit('update-blur');
        super.vfunc_paint(node, paintContext, paintFlags);
    }
});

// Connects the paint-signal hack: queues a repaint of blurEffect whenever
// actor paints, throttled so the repaint itself doesn't loop forever.
export function connectPaintSignal(actor, getBlurEffect) {
    const paintSignal = new BlurPaintSignal();
    let counter = 0;
    paintSignal.connect('update-blur', () => {
        if (counter === 0) {
            counter = 2;
            try { getBlurEffect()?.queue_repaint(); } catch (_) {}
        } else {
            counter--;
        }
    });
    actor.add_effect(paintSignal);
    return paintSignal;
}

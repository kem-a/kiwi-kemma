// SPDX-License-Identifier: GPL-3.0-or-later
// Makes windows semi-transparent while being moved or resized for visual feedback.

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';

const TRANSPARENT_ON_MOVING = true;
const TRANSPARENT_ON_RESIZING = true;
const TRANSITION_TIME = 0.2; // in seconds
const WINDOW_OPACITY = 230; // Opacity value (0-255)

const _grab_moving_operations = [
    Meta.GrabOp.MOVING,
    Meta.GrabOp.KEYBOARD_MOVING,
    Meta.GrabOp.MOVING_UNCONSTRAINED,
];

const _grab_resizing_operations = [
    Meta.GrabOp.RESIZING_NW,
    Meta.GrabOp.RESIZING_N,
    Meta.GrabOp.RESIZING_NE,
    Meta.GrabOp.RESIZING_E,
    Meta.GrabOp.RESIZING_SW,
    Meta.GrabOp.RESIZING_S,
    Meta.GrabOp.RESIZING_SE,
    Meta.GrabOp.RESIZING_W,
    Meta.GrabOp.KEYBOARD_RESIZING_UNKNOWN,
    Meta.GrabOp.KEYBOARD_RESIZING_NW,
    Meta.GrabOp.KEYBOARD_RESIZING_N,
    Meta.GrabOp.KEYBOARD_RESIZING_NE,
    Meta.GrabOp.KEYBOARD_RESIZING_E,
    Meta.GrabOp.KEYBOARD_RESIZING_SW,
    Meta.GrabOp.KEYBOARD_RESIZING_S,
    Meta.GrabOp.KEYBOARD_RESIZING_SE,
    Meta.GrabOp.KEYBOARD_RESIZING_W,
];

export class TransparentMove {
    constructor() {
        this._window_opacity = {};
        this._allowed_grab_operations = [];
        this.init_grab_operations();
    }

    init_grab_operations() {
        this._allowed_grab_operations = [];
        if (TRANSPARENT_ON_MOVING) {
            this._allowed_grab_operations.push(..._grab_moving_operations);
        }
    
        if (TRANSPARENT_ON_RESIZING) {
            this._allowed_grab_operations.push(..._grab_resizing_operations);
        }
    }

    is_grab_operation_allowed(grab_op) {
        return this._allowed_grab_operations.indexOf(grab_op) > -1;
    }

    set_opacity(window_surfaces, target_opacity, on_complete) {
        const complete_func = () => {
            if (on_complete)
                on_complete();
        };

        if (window_surfaces.length === 0) {
            complete_func();
            return;
        }

        if (TRANSITION_TIME < 0.001) {
            window_surfaces.forEach(surface => {
                surface.opacity = target_opacity;
            });
            complete_func();
        } else {
            window_surfaces.forEach(surface => {
                surface.ease({
                    duration: TRANSITION_TIME * 1000,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    opacity: target_opacity,
                    onComplete: complete_func,
                });
            });
        }
    }

    get_window_surfaces(meta_window) {
        const window_actor = meta_window.get_compositor_private();
        if (!window_actor)
            return [];

        const surfaces = this.find_meta_surface_actors(window_actor);
        if (surfaces.length > 0)
            return surfaces;

        return [window_actor];
    }

    find_meta_surface_actors(meta_actor) {
        if (meta_actor.constructor.name.indexOf('MetaSurfaceActor') > -1) {
            return [meta_actor];
        }
        
        const surfaces = [];
        for (const child of meta_actor.get_children()) {
            const result = this.find_meta_surface_actors(child);
            if (result.length > 0) {
                surfaces.push(...result);
            }
        }

        return surfaces;
    }

    window_grab_begin(meta_display, meta_window, meta_grab_op, gpointer) {
        if (!meta_window || !this.is_grab_operation_allowed(meta_grab_op)) {
            return;
        }
    
        const window_surfaces = this.get_window_surfaces(meta_window);
        if (window_surfaces.length === 0)
            return;

        const pid = meta_window.get_pid();
        if (!this._window_opacity[pid])
            this._window_opacity[pid] = window_surfaces[0].opacity;

        this.set_opacity(window_surfaces, WINDOW_OPACITY);
    }

    window_grab_end(meta_display, meta_window, meta_grab_op, gpointer) {
        if (!meta_window || !this.is_grab_operation_allowed(meta_grab_op)) {
            return;
        }
    
        const window_surfaces = this.get_window_surfaces(meta_window);
        if (window_surfaces.length === 0)
            return;

        const pid = meta_window.get_pid();
        const complete_func = function() {
            delete this._window_opacity[pid];
        };

        this.set_opacity(window_surfaces, this._window_opacity[pid], complete_func.bind(this));
    }

    enable() {
        this.init_grab_operations();
        this._on_window_grab_begin = global.display.connect('grab-op-begin', this.window_grab_begin.bind(this));
        this._on_window_grab_end = global.display.connect('grab-op-end', this.window_grab_end.bind(this));
    }

    disable() {
        global.display.disconnect(this._on_window_grab_begin);
        global.display.disconnect(this._on_window_grab_end);
    
        delete this._window_opacity;
        delete this._allowed_grab_operations;
        delete this._on_window_grab_begin;
        delete this._on_window_grab_end;
    }
}

let transparentMoveInstance = null;

export function enable() {
    if (!transparentMoveInstance) {
        transparentMoveInstance = new TransparentMove();
        transparentMoveInstance.enable();
    }
}

export function disable() {
    if (transparentMoveInstance) {
        transparentMoveInstance.disable();
        transparentMoveInstance = null;
    }
}

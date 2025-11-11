// SPDX-License-Identifier: GPL-3.0-or-later
// Shows the focused window's title in the panel with an optional app menu.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import GLib from 'gi://GLib';

import { AppMenu } from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

let indicator = null;

const WindowTitleIndicator = GObject.registerClass(
class WindowTitleIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'window-title', true);

        this._menu = new AppMenu(this);
        this.setMenu(this._menu);
        Main.panel.menuManager.addMenu(this._menu);

        this._box = new St.BoxLayout({style_class: 'panel-button'});
        
        this._icon = new St.Icon({
            style_class: 'app-menu-icon',
            icon_size: 16,
        });
        this._box.add_child(this._icon);

        this._label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
            style: 'max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'
        });
        this._box.add_child(this._label);
        this.add_child(this._box);
        this._focusWindow = null;
        this._focusWindowSignal = global.display.connect('notify::focus-window', 
            this._onFocusedWindowChanged.bind(this));
        
        this._overviewShowingId = Main.overview.connect('showing',
            () => this._updateVisibility());
        
        this._onFocusedWindowChanged();

        this._menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._syncMenuAlignment();
                    return GLib.SOURCE_REMOVE;
                });
            }
        });

        this._overviewHiddenId = Main.overview.connect('hidden',
            () => this._onOverviewHidden());
    }

    _updateVisibility() {
        if (Main.overview.visible) {
            this._clearDisplay();
        } else {
            this._updateWindowTitle();
        }
    }

    _onFocusedWindowChanged() {
        let window = global.display.focus_window;

        if (!window && this.menu && this.menu.isOpen)
            return;

        if (this._focusWindow) {
            this._focusWindow.disconnect(this._titleSignal);
            this._focusWindow = null;
        }

        if (window) {
            this._focusWindow = window;
            this._titleSignal = window.connect('notify::title', 
                this._updateWindowTitle.bind(this));
            this._updateWindowTitle();
            this.show();
        } else {
            this._clearDisplay();
        }
    }

    _onOverviewHidden() {
        this._onFocusedWindowChanged();
    }

    _updateWindowTitle() {
        if (!this._focusWindow) return;

        let windowTitle = this._focusWindow.get_title();
        
        // Handle null window title
        if (!windowTitle) {
            this._clearDisplay();
            return;
        }

        // Exclude window titles that start with "com." or "gjs"
        const normalizedTitle = windowTitle.trim().toLowerCase();
        if (normalizedTitle.startsWith('com.') || normalizedTitle.startsWith('gjs') || normalizedTitle.includes('@!0,0')) {
            this._clearDisplay();
            return;
        }

        windowTitle = windowTitle.trim();

        const tracker = Shell.WindowTracker.get_default();
        const app = tracker ? tracker.get_window_app(this._focusWindow) : null;
        const appName = app ? app.get_name() : null;
        const normalizedAppName = appName ? appName.trim().toLowerCase() : '';
        if (normalizedAppName.startsWith('com.') || normalizedAppName.startsWith('gjs')) {
            this._clearDisplay();
            return;
        }

        const dashIndex = Math.max(windowTitle.lastIndexOf(' - '), windowTitle.lastIndexOf(' — '));
        if (dashIndex !== -1) {
            windowTitle = windowTitle.substring(0, dashIndex);
        }

        if (app) {
            this._icon.gicon = app.get_icon();
            this._label.text = ` ${app.get_name()} — ${windowTitle}`;
            this._menu.setApp(app);
        } else {
            this._icon.gicon = null;
            this._label.text = ` ${windowTitle}`;
            this._menu.setApp(null);
        }
        
        this.reactive = true;
        if (!Main.overview.visible) {
            this.show();
        }

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._syncMenuAlignment();
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearDisplay(resetMenu = true) {
        this._label.text = '';
        this._icon.gicon = null;
        this.reactive = false;
        if (resetMenu && this._menu) {
            if (this.menu && this.menu.isOpen)
                this.menu.close(true);
            this._menu.setApp(null);
        }
        this.hide();
    }

    _syncMenuAlignment() {
        const buttonBox = this.get_allocation_box();
        const labelBox = this._label.get_allocation_box();
        const labelLeft = labelBox.x1 - buttonBox.x1;

        let menuWidth = this._menu.actor.get_width();
        if (menuWidth <= 0) {
            const [, natWidth] = this._menu.actor.get_preferred_width(-1);
            menuWidth = natWidth;
        }

        if (menuWidth <= 0)
            return;

        const alignment = Math.max(0, Math.min(1, labelLeft / menuWidth));
        if (this._menu.actor.setSourceAlignment)
            this._menu.actor.setSourceAlignment(alignment);
        if (this._menu.actor.setArrowAlignment)
            this._menu.actor.setArrowAlignment(alignment);
        else
            this._menu._arrowAlignment = alignment;
    }

    destroy() {
        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
        }
        if (this._focusWindowSignal) {
            global.display.disconnect(this._focusWindowSignal);
        }
        if (this._focusWindow && this._titleSignal) {
            this._focusWindow.disconnect(this._titleSignal);
        }
        if (this._overviewHiddenId) {
            Main.overview.disconnect(this._overviewHiddenId);
        }
        super.destroy();
    }
});

export function enable() {
    if (!indicator) {
        indicator = new WindowTitleIndicator();
        Main.panel.addToStatusArea('window-title', indicator, -1, 'left');
    }
}

export function disable() {
    if (indicator) {
        indicator.destroy();
        indicator = null;
    }
}

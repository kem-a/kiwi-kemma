import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

let indicator = null;

const WindowTitleIndicator = GObject.registerClass(
class WindowTitleIndicator extends PanelMenu.Button {
    _init() {
        // Adjust initialization to ensure the button is reactive
        super._init(0.0, 'window-title', true);

        this._menu = new AppMenu(this);
        this.setMenu(this._menu);
        Main.panel.menuManager.addMenu(this._menu);

        this._box = new St.BoxLayout({style_class: 'panel-button'});
        
        this._icon = new St.Icon({style_class: 'app-menu-icon'});
        this._box.add_child(this._icon);

        this._label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START
        });
        this._box.add_child(this._label);

        this.add_child(this._box);

        this._focusWindow = null;
        this._focusWindowSignal = global.display.connect('notify::focus-window', 
            this._onFocusedWindowChanged.bind(this));
        
        // Add overview detection
        this._overviewShowingId = Main.overview.connect('showing',
            () => this._updateVisibility());
        this._overviewHidingId = Main.overview.connect('hiding',
            () => this._updateVisibility());
            
        this._onFocusedWindowChanged();

        // Adjust the menu's arrow alignment to appear under the icon
        this.menu._arrowAlignment = 0.0;

        // Remove the previous 'hiding' signal connection
        if (this._overviewHidingId) {
            Main.overview.disconnect(this._overviewHidingId);
            this._overviewHidingId = null;
        }

        // Connect to the 'hidden' signal instead of 'hiding'
        this._overviewHiddenId = Main.overview.connect('hidden',
            () => this._onOverviewHidden());
    }

    _updateVisibility() {
        if (Main.overview.visible) {
            this._label.text = '';
            this._icon.gicon = null;
            this.hide();
        } else {
            this._updateWindowTitle();
        }
    }

    _onFocusedWindowChanged() {
        let window = global.display.focus_window;

        // Update condition to properly handle focus changes
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
            this._label.text = '';
            this._icon.gicon = null;
            this.hide();
        }
    }

    _onOverviewHidden() {
        // Update the title after the overview is fully hidden
        this._onFocusedWindowChanged();
    }

    _updateWindowTitle() {
        if (!this._focusWindow) return;

        const app = Shell.WindowTracker.get_default().get_window_app(this._focusWindow);
        if (app) {
            this._icon.gicon = app.get_icon();
            this._label.text = ` ${app.get_name()} — ${this._focusWindow.get_title()}`;
            this._menu.setApp(app);
        } else {
            this._icon.gicon = null;
            this._label.text = ` ${this._focusWindow.get_title()}`;
            this._menu.setApp(null);
        }
        
        if (!Main.overview.visible) {
            this.show();
        }
    }

    destroy() {
        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
        }
        if (this._overviewHidingId) {
            Main.overview.disconnect(this._overviewHidingId);
        }
        if (this._focusWindowSignal) {
            global.display.disconnect(this._focusWindowSignal);
        }
        if (this._focusWindow && this._titleSignal) {
            this._focusWindow.disconnect(this._titleSignal);
        }

        // Disconnect the 'hidden' signal
        if (this._overviewHiddenId) {
            Main.overview.disconnect(this._overviewHiddenId);
            this._overviewHiddenId = null;
        }

        super.destroy();
    }
});

export function enable() {
    if (!indicator) {
        indicator = new WindowTitleIndicator();
        Main.panel.addToStatusArea('window-title', indicator, 1, 'left');  // Changed order from 0 to 1
    }
}

export function disable() {
    if (indicator) {
        indicator.destroy();
        indicator = null;
    }
}
// SPDX-License-Identifier: GPL-3.0-or-later
// Kiwi Extension - Quick Settings Notifications

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

// State holders
let enabled = false;
let notificationWidget = null;
let quickSettingsGrid = null;
let _monitor = null;
let _originalMaxHeight = null;
let _initTimeoutId = null;

// Get QuickSettings grid
function getQuickSettingsGrid() {
    if (!quickSettingsGrid) {
        const quickSettings = Main.panel.statusArea.quickSettings;
        if (quickSettings && quickSettings.menu) {
            quickSettingsGrid = quickSettings.menu._grid;
        }
    }
    return quickSettingsGrid;
}

// Media-related code removed to quickSettingsMedia.js

// #region Notification Classes (adapted from samples)
class NotificationList extends MessageList.MessageView {
    // Do not setup mpris
    _setupMpris() {}
}
GObject.registerClass(NotificationList);

// Notification Header
class NotificationHeader extends St.BoxLayout {
    constructor() {
        super({ style_class: 'kiwi-header' });

        this._headerLabel = new St.Label({
            text: 'Notifications',
            style_class: 'kiwi-header-label',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
            x_expand: true
        });
        this.add_child(this._headerLabel);

        this._clearButton = new St.Button({
            style_class: 'message-list-clear-button button',
            icon_name: 'user-trash-symbolic',
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
        });
        this.add_child(this._clearButton);
    }
}
GObject.registerClass(NotificationHeader);

// Notification Widget
class NotificationWidget extends St.BoxLayout {
    constructor() {
        super({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'kiwi-notifications',
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });

        this._createScroll();
        this._createHeader();

        this.add_child(this._header);
        this.add_child(this._scroll);

        this._list.connectObject('notify::empty', this._syncEmpty.bind(this));
        this._list.connectObject('notify::can-clear', this._syncClear.bind(this));
        this._syncEmpty();
        this._syncClear();
    }

    _createScroll() {
        this._list = new NotificationList();
        this._scroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            child: this._list,
            style_class: 'kiwi-notification-scroll',
            vscrollbar_policy: St.PolicyType.EXTERNAL,
        });
    }

    _createHeader() {
        this._header = new NotificationHeader();
        this._header._clearButton.connectObject('clicked', this._list.clear.bind(this._list));
    }

    _syncClear() {
        const canClear = this._list.canClear;
        this._header._clearButton.reactive = canClear;
        this._header._clearButton.can_focus = canClear;
        if (canClear) {
            this._header._clearButton.remove_style_class_name('disabled');
        } else {
            this._header._clearButton.add_style_class_name('disabled');
        }
    }

    _syncEmpty() {
        this.visible = !this._list.empty;
    }
}
GObject.registerClass(NotificationWidget);

// #endregion Notification Classes

export function enable() {
    if (enabled) return;

    // Delay to ensure quicksettings is fully loaded
    _initTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        const grid = getQuickSettingsGrid();
        if (!grid) return GLib.SOURCE_CONTINUE; // Retry if grid not ready

        const quickSettings = Main.panel.statusArea.quickSettings;
        if (quickSettings && quickSettings.menu) {
            _monitor = Main.layoutManager.primaryMonitor;
            _originalMaxHeight = quickSettings.menu.actor.get_style();
            const newHeight = _monitor.height * 0.9;
            quickSettings.menu.actor.set_style(`max-height: ${newHeight}px;`);
        }

        // Create notification widget
        notificationWidget = new NotificationWidget();
        grid.add_child(notificationWidget);
        grid.layout_manager.child_set_property(grid, notificationWidget, 'column-span', 2);

        enabled = true;
        _initTimeoutId = null;
        return GLib.SOURCE_REMOVE;
    });
}

export function disable() {
    if (!enabled) return;

    const quickSettings = Main.panel.statusArea.quickSettings;
    if (quickSettings && quickSettings.menu && _originalMaxHeight) {
        quickSettings.menu.actor.set_style(_originalMaxHeight);
    }
    _originalMaxHeight = null;
    _monitor = null;
    if (_initTimeoutId) {
        GLib.Source.remove(_initTimeoutId);
        _initTimeoutId = null;
    }

    const grid = getQuickSettingsGrid();
    if (grid) {
        if (notificationWidget) {
            grid.remove_child(notificationWidget);
            notificationWidget.destroy();
            notificationWidget = null;
        }
    }

    enabled = false;
}

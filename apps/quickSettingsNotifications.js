// SPDX-License-Identifier: GPL-3.0-or-later
// Kiwi Extension - Quick Settings Notifications

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {
    SHELL_HAS_SYSTEM_DND,
    suppressBuiltinDndIndicator,
    suppressBuiltinDndToggle,
    restoreBuiltinDndIndicator,
    restoreBuiltinDndToggle,
    hideDateMenuIndicator,
    restoreDateMenuIndicator,
} from './quickSettingsDnDRemoval.js';

const DND_ICON_NAME = 'weather-clear-night-symbolic';
const DND_ICON_SIZE = 16;

// State holders
let enabled = false;
let notificationWidget = null;
let quickSettingsGrid = null;
let _monitor = null;
let _originalMaxHeight = null;
let _initTimeoutId = null;
let _dndButton = null;
let _dndIcon = null;
let _notificationSettings = null;
let _notificationSettingsChangedId = null;
let _dndEnsureTimeoutId = null;
let _panelMoonIcon = null;
let _panelMoonInserted = false;


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

function getSystemItemContainer() {
    const quickSettings = Main.panel.statusArea.quickSettings;
    if (!quickSettings || !quickSettings._system)
        return null;

    const systemItem = quickSettings._system._systemItem;
    if (!systemItem)
        return null;

    return systemItem.child ?? null;
}

function ensureNotificationSettings() {
    if (!_notificationSettings) {
        try {
            _notificationSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' });
        } catch (error) {
            logError(error, '[kiwi] Failed to load notification settings for DND button');
            _notificationSettings = null;
        }
    }
    return _notificationSettings;
}

function syncDndButtonState() {
    if (!_notificationSettings || !_dndButton || !_dndIcon)
        return;

    const dndActive = !_notificationSettings.get_boolean('show-banners');
    if (_dndButton.checked !== dndActive)
        _dndButton.checked = dndActive;

    _dndIcon.icon_name = DND_ICON_NAME;
    _dndButton.set_tooltip_text?.(dndActive ? 'Disable Do Not Disturb' : 'Enable Do Not Disturb');

    // Always hide the date menu DND indicator in the panel; we provide our own.
    hideDateMenuIndicator();
    ensurePanelMoonIcon(dndActive);
}

function toggleDnd() {
    if (!_notificationSettings)
        return;

    const showBanners = _notificationSettings.get_boolean('show-banners');
    _notificationSettings.set_boolean('show-banners', !showBanners);
}

function ensureDndButton() {
    const container = getSystemItemContainer();
    const settings = ensureNotificationSettings();
    if (!container || !settings)
        return false;

    // Suppress quick settings DND toggle only on GNOME 49+ where it exists
    const toggleSuppressed = SHELL_HAS_SYSTEM_DND ? suppressBuiltinDndToggle() : true;
    // Always suppress panel DND indicator; we replace it with our own moon icon
    const indicatorSuppressed = suppressBuiltinDndIndicator();

    if (!_dndButton) {
        // Attempt to inherit styling from an existing button for consistency
        const existingButtons = container.get_children();
        const templateButton = existingButtons.find(button => button && button.style_class) ?? null;
        const templateStyle = templateButton?.style_class ?? 'system-menu-action';
        let iconStyle = 'system-status-icon';
        if (templateButton) {
            const templateIcon = templateButton.get_children().find(child => child instanceof St.Icon);
            if (templateIcon?.style_class)
                iconStyle = templateIcon.style_class;
        }

        _dndIcon = new St.Icon({
            icon_name: DND_ICON_NAME,
            icon_size: DND_ICON_SIZE,
            style_class: `${iconStyle} kiwi-dnd-icon`,
        });

        _dndButton = new St.Button({
            style_class: `${templateStyle} kiwi-dnd-button`,
            can_focus: true,
            reactive: true,
            track_hover: true,
            toggle_mode: true,
            accessible_name: 'Do Not Disturb',
        });
        _dndButton.set_child(_dndIcon);
        _dndButton.connect('clicked', toggleDnd);
        _dndButton.set_tooltip_text?.('Enable Do Not Disturb');
    }

    const currentParent = _dndButton.get_parent();
    if (currentParent !== container) {
        if (currentParent)
            currentParent.remove_child(_dndButton);

        const lockButton = container.get_children().find(child => child?.constructor?.name === 'LockItem');
        if (lockButton) {
            const index = container.get_children().indexOf(lockButton);
            container.insert_child_at_index(_dndButton, Math.max(0, index));
        } else {
            container.add_child(_dndButton);
        }
    }

    if (!_notificationSettingsChangedId) {
        _notificationSettingsChangedId = settings.connect('changed::show-banners', syncDndButtonState);
    }

    syncDndButtonState();
    return _dndButton.get_parent() === container && toggleSuppressed && indicatorSuppressed;
}

function ensureDndButtonWithRetry() {
    if (ensureDndButton())
        return;

    if (_dndEnsureTimeoutId)
        return;

    _dndEnsureTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
        if (ensureDndButton()) {
            _dndEnsureTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
    if (_dndEnsureTimeoutId && GLib.Source.set_name_by_id)
        GLib.Source.set_name_by_id(_dndEnsureTimeoutId, '[kiwi] Ensure DND button');
}

function destroyDndButton() {
    if (_dndEnsureTimeoutId) {
        GLib.Source.remove(_dndEnsureTimeoutId);
        _dndEnsureTimeoutId = null;
    }
    if (_notificationSettings && _notificationSettingsChangedId) {
        try {
            _notificationSettings.disconnect(_notificationSettingsChangedId);
        } catch (error) {
            logError(error, '[kiwi] Failed to disconnect DND settings listener');
        }
        _notificationSettingsChangedId = null;
    }

    if (_dndButton) {
        const parent = _dndButton.get_parent();
        if (parent)
            parent.remove_child(_dndButton);
        _dndButton.destroy();
        _dndButton = null;
    }

    _dndIcon = null;
    _notificationSettings = null;

    if (SHELL_HAS_SYSTEM_DND)
        restoreDateMenuIndicator();
    removePanelMoonIcon();
}

// #region Notification Classes
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
            style_class: 'message-list-clear-button button destructive-action',
            label: 'Clear',
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
            x_expand: false,
        });
        this._clearButton.set_accessible_name('Clear all notifications');
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
        if (!grid)
            return GLib.SOURCE_CONTINUE; // Retry if grid not ready

        const quickSettings = Main.panel.statusArea.quickSettings;
        if (quickSettings && quickSettings.menu) {
            _monitor = Main.layoutManager.primaryMonitor;
            _originalMaxHeight = quickSettings.menu.actor.get_style();
            const newHeight = _monitor.height * 0.9;
            quickSettings.menu.actor.set_style(`max-height: ${newHeight}px;`);
        }

        // Create notification widget
        if (!notificationWidget) {
            notificationWidget = new NotificationWidget();
            grid.add_child(notificationWidget);
            grid.layout_manager.child_set_property(grid, notificationWidget, 'column-span', 2);
        }

        // On GNOME 49+, hide built-in quick settings DND toggle; always hide panel indicator
        if (SHELL_HAS_SYSTEM_DND)
            suppressBuiltinDndToggle();
        suppressBuiltinDndIndicator();
        ensureDndButtonWithRetry();

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

    destroyDndButton();
    // Always restore panel indicator; restore quick settings toggle on GNOME 49+
    restoreBuiltinDndIndicator();
    if (SHELL_HAS_SYSTEM_DND)
        restoreBuiltinDndToggle();

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

function ensurePanelMoonIcon(isActive = false) {
    if (SHELL_HAS_SYSTEM_DND)
        suppressBuiltinDndIndicator();

    const quickSettings = Main.panel.statusArea.quickSettings;
    const indicatorsContainer = quickSettings?._indicators;
    if (!indicatorsContainer)
        return;

    if (!_panelMoonIcon) {
        _panelMoonIcon = new St.Icon({
            icon_name: DND_ICON_NAME,
            style_class: 'system-status-icon kiwi-dnd-indicator',
            visible: false,
            reactive: false,
            accessible_name: 'Do Not Disturb Indicator',
        });
    }

    if (_panelMoonIcon.get_parent() !== indicatorsContainer) {
        if (_panelMoonIcon.get_parent())
            _panelMoonIcon.get_parent().remove_child(_panelMoonIcon);

        indicatorsContainer.add_child(_panelMoonIcon);
        _panelMoonInserted = true;
    }

    if (!_panelMoonInserted)
        return;

    _panelMoonIcon.visible = isActive;
    if (_panelMoonIcon.opacity !== undefined)
        _panelMoonIcon.opacity = isActive ? 255 : 0;
    _panelMoonIcon.reactive = false;
}

function removePanelMoonIcon() {
    if (!_panelMoonIcon)
        return;

    const parent = _panelMoonIcon.get_parent();
    if (parent)
        parent.remove_child(_panelMoonIcon);

    _panelMoonInserted = false;
}

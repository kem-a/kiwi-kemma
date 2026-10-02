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
let gettextFunc = (message) => message;
let notificationWidget = null;
let _originalMaxHeight; // undefined until saved; the saved style itself may be null
let _initTimeoutId = null;
let _dndButton = null;
let _notificationSettings = null;
let _notificationSettingsChangedId = null;
let _dndEnsureTimeoutId = null;
let _panelMoonIcon = null;
let _kiwiSettings = null;
let _kiwiSettingsChangedId = null;


function getSystemItemContainer() {
    // _system is created asynchronously by QuickSettings
    return Main.panel.statusArea.quickSettings._system?._systemItem.child;
}

function syncDndButtonState() {
    const dndActive = !_notificationSettings.get_boolean('show-banners');
    if (_dndButton.checked !== dndActive)
        _dndButton.checked = dndActive;

    // Always hide the date menu DND indicator in the panel; we provide our own.
    hideDateMenuIndicator();
    ensurePanelMoonIcon(dndActive);
}

function toggleDnd() {
    const showBanners = _notificationSettings.get_boolean('show-banners');
    _notificationSettings.set_boolean('show-banners', !showBanners);
}

function ensureDndButton() {
    if (!_notificationSettings)
        _notificationSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' });

    const container = getSystemItemContainer();
    if (!container)
        return false;

    // Suppress quick settings DND toggle (no-op before GNOME 49)
    const toggleSuppressed = suppressBuiltinDndToggle();
    // Always suppress panel DND indicator; we replace it with our own moon icon
    const indicatorSuppressed = suppressBuiltinDndIndicator();

    if (!_dndButton) {
        // Attempt to inherit styling from an existing button for consistency
        const templateButton = container.get_children().find(button => button.style_class);
        const templateStyle = templateButton?.style_class ?? 'system-menu-action';
        let iconStyle = 'system-status-icon';
        if (templateButton) {
            const templateIcon = templateButton.get_children().find(child => child instanceof St.Icon);
            if (templateIcon?.style_class)
                iconStyle = templateIcon.style_class;
        }

        _dndButton = new St.Button({
            style_class: `${templateStyle} kiwi-dnd-button`,
            can_focus: true,
            reactive: true,
            track_hover: true,
            toggle_mode: true,
            accessible_name: gettextFunc('Do Not Disturb'),
            child: new St.Icon({
                icon_name: DND_ICON_NAME,
                icon_size: DND_ICON_SIZE,
                style_class: `${iconStyle} kiwi-dnd-icon`,
            }),
        });
        _dndButton.connect('clicked', toggleDnd);
    }

    const currentParent = _dndButton.get_parent();
    if (currentParent !== container) {
        if (currentParent)
            currentParent.remove_child(_dndButton);

        const lockButton = container.get_children().find(child => child.constructor.name === 'LockItem');
        if (lockButton)
            container.insert_child_below(_dndButton, lockButton);
        else
            container.add_child(_dndButton);
    }

    if (!_notificationSettingsChangedId) {
        _notificationSettingsChangedId = _notificationSettings.connect('changed::show-banners', syncDndButtonState);
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
    GLib.Source.set_name_by_id(_dndEnsureTimeoutId, '[kiwi] Ensure DND button');
}

function destroyDndButton() {
    if (_dndEnsureTimeoutId) {
        GLib.Source.remove(_dndEnsureTimeoutId);
        _dndEnsureTimeoutId = null;
    }
    if (_notificationSettingsChangedId) {
        _notificationSettings.disconnect(_notificationSettingsChangedId);
        _notificationSettingsChangedId = null;
    }

    if (_dndButton) {
        _dndButton.destroy();
        _dndButton = null;
    }

    _notificationSettings = null;

    restoreDateMenuIndicator();
    removePanelMoonIcon();
}

// #region Notification Classes
const NotificationList = GObject.registerClass(
class NotificationList extends MessageList.MessageView {
    // Prevent media integration; Kiwi has its own media widget
    _setupMpris() {}
});

// Notification Header
class NotificationHeader extends St.BoxLayout {
    constructor() {
        super({ style_class: 'kiwi-header' });

        this._headerLabel = new St.Label({
            text: gettextFunc('Notifications'),
            style_class: 'kiwi-header-label',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
            x_expand: true
        });
        this.add_child(this._headerLabel);

        this._clearButton = new St.Button({
            style_class: 'message-list-clear-button button destructive-action',
            label: gettextFunc('Clear'),
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
            x_expand: false,
        });
        this._clearButton.set_accessible_name(gettextFunc('Clear all notifications'));
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

function _applyCustomDndSetting() {
    if (!enabled)
        return;

    if (_kiwiSettings.get_boolean('custom-dnd-button')) {
        suppressBuiltinDndToggle();
        suppressBuiltinDndIndicator();
        ensureDndButtonWithRetry();
    } else {
        destroyDndButton();
        restoreBuiltinDndIndicator();
        restoreBuiltinDndToggle();
    }
}

export function enable(gettext, settings) {
    gettextFunc = gettext;
    _kiwiSettings = settings;
    if (enabled || _initTimeoutId) return;

    // Delay to ensure quicksettings is fully loaded
    _initTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        const quickSettings = Main.panel.statusArea.quickSettings;
        const grid = quickSettings.menu._grid;
        const monitor = Main.layoutManager.primaryMonitor;
        _originalMaxHeight = quickSettings.menu.actor.get_style();
        const newHeight = monitor.height * 0.9;
        quickSettings.menu.actor.set_style(`max-height: ${newHeight}px;`);

        // Create notification widget
        if (!notificationWidget) {
            notificationWidget = new NotificationWidget();
            grid.add_child(notificationWidget);
            grid.layout_manager.child_set_property(grid, notificationWidget, 'column-span', 2);

            // Dismiss the quick settings popup when a notification shown inside it is
            // activated, so the menu does not overlay (and block focus of) the launched
            // window. Notifications emit 'activated' on click; cleanup is tied to the
            // widget's lifetime via connectObject's owner.
            const closeMenuOnActivate = () => {
                if (quickSettings.menu.isOpen)
                    quickSettings.menu.close();
            };
            const watchNotification = (notification) =>
                notification.connectObject('activated', closeMenuOnActivate, notificationWidget);
            const watchSource = (source) => {
                source.connectObject('notification-added', (_s, n) => watchNotification(n), notificationWidget);
                source.notifications.forEach(watchNotification);
            };
            Main.messageTray.connectObject('source-added', (_mt, source) => watchSource(source), notificationWidget);
            Main.messageTray.getSources().forEach(watchSource);
        }

        // Conditionally suppress built-in DND UI and add custom button
        if (_kiwiSettings.get_boolean('custom-dnd-button')) {
            suppressBuiltinDndToggle();
            suppressBuiltinDndIndicator();
            ensureDndButtonWithRetry();
        }

        if (!_kiwiSettingsChangedId)
            _kiwiSettingsChangedId = _kiwiSettings.connect('changed::custom-dnd-button', _applyCustomDndSetting);

        enabled = true;
        _initTimeoutId = null;
        return GLib.SOURCE_REMOVE;
    });
}

export function disable() {
    if (_initTimeoutId) {
        GLib.Source.remove(_initTimeoutId);
        _initTimeoutId = null;
    }

    if (_originalMaxHeight !== undefined)
        Main.panel.statusArea.quickSettings.menu.actor.set_style(_originalMaxHeight);
    _originalMaxHeight = undefined;

    destroyDndButton();
    // Always restore panel indicator; restore quick settings toggle on GNOME 49+
    restoreBuiltinDndIndicator();
    restoreBuiltinDndToggle();

    if (notificationWidget) {
        notificationWidget.destroy();
        notificationWidget = null;
    }

    if (_kiwiSettingsChangedId) {
        _kiwiSettings.disconnect(_kiwiSettingsChangedId);
        _kiwiSettingsChangedId = null;
    }
    _kiwiSettings = null;

    enabled = false;
    gettextFunc = (message) => message;
}

function ensurePanelMoonIcon(isActive = false) {
    if (SHELL_HAS_SYSTEM_DND)
        suppressBuiltinDndIndicator();

    const indicatorsContainer = Main.panel.statusArea.quickSettings._indicators;

    if (!_panelMoonIcon) {
        _panelMoonIcon = new St.Icon({
            icon_name: DND_ICON_NAME,
            style_class: 'system-status-icon kiwi-dnd-indicator',
            visible: false,
            reactive: false,
            accessible_name: gettextFunc('Do Not Disturb Indicator'),
        });
    }

    if (_panelMoonIcon.get_parent() !== indicatorsContainer) {
        if (_panelMoonIcon.get_parent())
            _panelMoonIcon.get_parent().remove_child(_panelMoonIcon);

        indicatorsContainer.add_child(_panelMoonIcon);
    }

    _panelMoonIcon.visible = isActive;
    _panelMoonIcon.opacity = isActive ? 255 : 0;
}

function removePanelMoonIcon() {
    _panelMoonIcon?.destroy();
    _panelMoonIcon = null;
}

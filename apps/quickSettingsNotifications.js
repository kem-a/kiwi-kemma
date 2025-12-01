// SPDX-License-Identifier: GPL-3.0-or-later
// Kiwi Extension - Quick Settings Notifications

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
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
const DATE_MENU_PLACEHOLDER_MIN_WIDTH = 280;
const DATE_MENU_PLACEHOLDER_DEFAULT_WIDTH = 360;
const HAS_MESSAGE_LIST_SECTION = MessageList && typeof MessageList.MessageListSection === 'function';

// State holders
let enabled = false;
let gettextFunc = (message) => message;
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
let _dateMenuMessageList = null;
let _dateMenuMessageListParent = null;
let _dateMenuMessageListIndex = -1;
let _dateMenuMessageListWasVisible = null;
let _dateMenuMessageListPlaceholder = null;
let _dateMenuSuppressed = false;


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
    const tooltip = dndActive ? gettextFunc('Disable Do Not Disturb') : gettextFunc('Enable Do Not Disturb');
    _dndButton.set_tooltip_text?.(tooltip);

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
            accessible_name: gettextFunc('Do Not Disturb'),
        });
        _dndButton.set_child(_dndIcon);
        _dndButton.connect('clicked', toggleDnd);
        _dndButton.set_tooltip_text?.(gettextFunc('Enable Do Not Disturb'));
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

function suppressDateMenuMessageList() {
    if (_dateMenuMessageList)
        return;

    const dateMenu = Main.panel.statusArea?.dateMenu;
    const messageList = dateMenu?._messageList;
    if (!messageList)
        return;

    const parent = messageList.get_parent();
    if (!parent)
        return;

    const siblings = parent.get_children();
    const allocation = messageList.get_allocation_box?.();
    let allocatedWidth = 0;
    if (allocation)
        allocatedWidth = allocation.get_width();
    if (!allocatedWidth)
        allocatedWidth = Math.round(messageList.width ?? 0);
    if (!allocatedWidth) {
        const [, natWidth] = messageList.get_preferred_width(-1);
        allocatedWidth = Math.round(natWidth);
    }
    if (!allocatedWidth && messageList.get_theme_node) {
        try {
            allocatedWidth = Math.round(messageList.get_theme_node().get_length('min-width'));
        } catch (error) {
            allocatedWidth = 0;
        }
    }
    if (!allocatedWidth)
        allocatedWidth = DATE_MENU_PLACEHOLDER_DEFAULT_WIDTH;
    _dateMenuMessageList = messageList;
    _dateMenuMessageListParent = parent;
    _dateMenuMessageListIndex = siblings.indexOf(messageList);
    _dateMenuMessageListWasVisible = messageList.visible;

    parent.remove_child(messageList);

    const placeholderWidth = Math.max(allocatedWidth, DATE_MENU_PLACEHOLDER_MIN_WIDTH);
    _dateMenuMessageListPlaceholder = new St.Widget({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.START,
    });
    _dateMenuMessageListPlaceholder.set_style(`min-width: ${placeholderWidth}px;`);
    parent.insert_child_at_index(_dateMenuMessageListPlaceholder, _dateMenuMessageListIndex);

    messageList.hide();
}

function restoreDateMenuMessageList() {
    if (!_dateMenuMessageList)
        return;

    if (_dateMenuMessageListParent) {
        if (_dateMenuMessageListPlaceholder) {
            _dateMenuMessageListParent.remove_child(_dateMenuMessageListPlaceholder);
            _dateMenuMessageListPlaceholder.destroy();
            _dateMenuMessageListPlaceholder = null;
        }

        const siblings = _dateMenuMessageListParent.get_children();
        const targetIndex = _dateMenuMessageListIndex >= 0 ? Math.min(_dateMenuMessageListIndex, siblings.length) : siblings.length;
        _dateMenuMessageListParent.insert_child_at_index(_dateMenuMessageList, targetIndex);

        if (_dateMenuMessageListWasVisible)
            _dateMenuMessageList.show();
        else
            _dateMenuMessageList.hide();
    }

    _dateMenuMessageList = null;
    _dateMenuMessageListParent = null;
    _dateMenuMessageListIndex = -1;
    _dateMenuMessageListWasVisible = null;
    _dateMenuMessageListPlaceholder = null;
}

// #region Notification Classes
let NotificationList;

if (HAS_MESSAGE_LIST_SECTION) {
    const MAX_NOTIFICATION_ACTIONS = 3;

    const QuickNotificationMessage = GObject.registerClass(
    class QuickNotificationMessage extends MessageList.Message {
        constructor(notification) {
            super(notification.source);

            this._notification = notification;
            this._closed = false;
            this._actionButtons = new Map();

            this.connect('close', () => {
                this._closed = true;
                if (this._notification)
                    this._notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
            });

            notification.connectObject(
                'action-added', (_n, action) => this._addAction(action),
                'action-removed', (_n, action) => this._removeAction(action),
                'destroy', () => {
                    this._notification = null;
                    if (!this._closed)
                        this.close();
                },
                this,
            );

            notification.bind_property('title', this, 'title', GObject.BindingFlags.SYNC_CREATE);
            notification.bind_property('body', this, 'body', GObject.BindingFlags.SYNC_CREATE);
            notification.bind_property('use-body-markup', this, 'use-body-markup', GObject.BindingFlags.SYNC_CREATE);
            notification.bind_property('datetime', this, 'datetime', GObject.BindingFlags.SYNC_CREATE);
            notification.bind_property('gicon', this, 'icon', GObject.BindingFlags.SYNC_CREATE);

            notification.actions?.forEach(action => this._addAction(action));
        }

        vfunc_clicked() {
            this._notification?.activate();
        }

        canClose() {
            return true;
        }

        _ensureActionArea() {
            if (this._buttonBox)
                return;

            this._buttonBox = new St.BoxLayout({
                style_class: 'notification-buttons-bin',
                x_expand: true,
            });
            this.setActionArea(this._buttonBox);
            global.focus_manager.add_group(this._buttonBox);
        }

        _addAction(action) {
            if (this._actionButtons.has(action))
                return;

            this._ensureActionArea();

            if (this._buttonBox.get_n_children() >= MAX_NOTIFICATION_ACTIONS)
                return;

            const button = new St.Button({
                style_class: 'notification-button',
                label: action.label,
                x_expand: true,
            });
            button.connect('clicked', () => action.activate());
            this._actionButtons.set(action, button);
            this._buttonBox.add_child(button);
        }

        _removeAction(action) {
            this._actionButtons.get(action)?.destroy();
            this._actionButtons.delete(action);
        }
    });

    const QuickNotificationSection = GObject.registerClass(
    class QuickNotificationSection extends MessageList.MessageListSection {
        constructor() {
            super();

            this._urgentCount = 0;
            this._messageByNotification = new Map();

            Main.messageTray.connectObject(
                'source-added', this._onSourceAdded.bind(this),
                'source-removed', this._onSourceRemoved.bind(this),
                this,
            );

            Main.messageTray.getSources().forEach(source => this._onSourceAdded(Main.messageTray, source));
        }

        get allowed() {
            return Main.sessionMode.hasNotifications && !Main.sessionMode.isGreeter;
        }

        _onSourceAdded(_tray, source) {
            source.connectObject('notification-added', this._onNotificationAdded.bind(this), this);

            if (source.notifications) {
                for (const notification of source.notifications)
                    this._onNotificationAdded(source, notification, false);
            }
        }

        _onSourceRemoved(_tray, source) {
            source.disconnectObject(this);
        }

        _onNotificationAdded(source, notification, animate = this.mapped) {
            if (this._messageByNotification.has(notification))
                return;

            const isUrgent = notification.urgency === MessageTray.Urgency.CRITICAL;
            const entry = {
                message: new QuickNotificationMessage(notification),
                isUrgent,
            };
            this._messageByNotification.set(notification, entry);

            notification.connectObject(
                'destroy', () => {
                    const current = this._messageByNotification.get(notification);
                    if (!current)
                        return;

                    if (current.isUrgent && this._urgentCount > 0)
                        this._urgentCount--;
                    this._messageByNotification.delete(notification);
                },
                'notify::datetime', () => {
                    const current = this._messageByNotification.get(notification);
                    if (!current)
                        return;

                    this.moveMessage(current.message, current.isUrgent ? 0 : this._urgentCount, this.mapped);
                },
                this,
            );

            const index = isUrgent ? 0 : this._urgentCount;
            this.addMessageAtIndex(entry.message, index, animate);

            if (isUrgent)
                this._urgentCount++;
            else if (this.mapped)
                notification.acknowledged = true;
        }

        vfunc_map() {
            for (const [notification, entry] of this._messageByNotification) {
                if (!entry.isUrgent)
                    notification.acknowledged = true;
            }

            super.vfunc_map();
        }

        clear() {
            super.clear();
            this._messageByNotification.clear();
            this._urgentCount = 0;
        }

        destroy() {
            Main.messageTray.disconnectObject(this);
            Main.messageTray.getSources().forEach(source => source.disconnectObject?.(this));
            this._messageByNotification.clear();

            super.destroy();
        }
    });

    NotificationList = GObject.registerClass({
        Properties: {
            'empty': GObject.ParamSpec.boolean(
                'empty', 'empty', 'empty',
                GObject.ParamFlags.READABLE,
                true,
            ),
            'can-clear': GObject.ParamSpec.boolean(
                'can-clear', 'can-clear', 'can-clear',
                GObject.ParamFlags.READABLE,
                false,
            ),
        },
    }, class NotificationList extends St.BoxLayout {
        constructor() {
            super({
                vertical: true,
                x_expand: true,
                y_expand: true,
            });

            this._section = new QuickNotificationSection();
            this._section.x_expand = true;
            this.add_child(this._section);

            this._section.connectObject(
                'notify::empty', () => this.notify('empty'),
                'notify::can-clear', () => this.notify('can-clear'),
                this,
            );
        }

        get empty() {
            return this._section.empty;
        }

        get canClear() {
            return this._section.canClear;
        }

        clear() {
            this._section.clear();
        }

        destroy() {
            this._section.destroy();
            super.destroy();
        }
    });
} else {
    NotificationList = GObject.registerClass(
    class NotificationList extends MessageList.MessageView {
        // Prevent unexpected media integration on legacy shells
        _setupMpris() {}
    });
}

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
            vertical: true,
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

export function enable(gettext) {
    gettextFunc = typeof gettext === 'function' ? gettext : (message) => message;
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

        if (HAS_MESSAGE_LIST_SECTION) {
            suppressDateMenuMessageList();
            _dateMenuSuppressed = true;
        } else {
            _dateMenuSuppressed = false;
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

    if (_dateMenuSuppressed)
        restoreDateMenuMessageList();
    _dateMenuSuppressed = false;

    const grid = getQuickSettingsGrid();
    if (grid) {
        if (notificationWidget) {
            grid.remove_child(notificationWidget);
            notificationWidget.destroy();
            notificationWidget = null;
        }
    }

    enabled = false;
    gettextFunc = (message) => message;
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
            accessible_name: gettextFunc('Do Not Disturb Indicator'),
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

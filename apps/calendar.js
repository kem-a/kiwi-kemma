// SPDX-License-Identifier: GPL-3.0-or-later
// Repositions the calendar and customizes notification widgets in the top panel.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import { PopupAnimation } from 'resource:///org/gnome/shell/ui/boxpointer.js';
import { InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js';

// State holders so we can fully restore on disable
let dateMenu;
let enabled = false;
let originalParent;
let originalParentIndex;
let originalMenuBoxStyle;
let hiddenMessageList = null; // date menu message list hidden while enabled
let originalBannerBinProps; // { x_align, y_align, x_expand }
let calendarAnimationInjections = null;

function setupCalendarAnimation() {
    const pointer = dateMenu.menu._boxPointer;
    calendarAnimationInjections = new InjectionManager();
    let animation = null;

    // Keep Shell's open/close lifecycle (input muting, callbacks and fading),
    // and only replace the motion on this calendar's BoxPointer.
    for (const method of ['open', 'close']) {
        calendarAnimationInjections.overrideMethod(pointer, method, original => function (animate, ...args) {
            const previousAnimation = animation;
            animation = { opening: method === 'open', slide: !!(animate & PopupAnimation.SLIDE) };
            try {
                return original.call(this, animate, ...args);
            } finally {
                animation = previousAnimation;
            }
        });
    }

    calendarAnimationInjections.overrideMethod(pointer, 'ease', original => function (params) {
        const reducedMotion = St.ReducedMotion &&
            St.Settings.get().reducedMotion === St.ReducedMotion.REDUCE;
        if (animation?.slide && !reducedMotion) {
            // Natural width is needed on the first open, before allocation.
            const [, naturalWidth] = this.get_preferred_width(-1);
            const distance = Math.max(this.width, naturalWidth);
            this.translation_y = 0;
            this.scale_x = 1;
            this.scale_y = 1;
            if (animation.opening)
                this.translation_x = distance;

            params = {
                ...params,
                translation_x: animation.opening ? 0 : distance,
                translation_y: 0,
                scale_x: 1,
                scale_y: 1,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            };
        }
        return original.call(this, params);
    });
}

function cleanupCalendarAnimation() {
    if (!calendarAnimationInjections)
        return;

    // Complete any in-flight animation before restoring or reparenting actors.
    // PopupMenu switched from a bitmask to an options object in GNOME 51.
    dateMenu.menu.close(parseInt(Config.PACKAGE_VERSION) >= 51
        ? { animate: false } : PopupAnimation.NONE);
    calendarAnimationInjections.clear();
    calendarAnimationInjections = null;

    const pointer = dateMenu.menu._boxPointer;
    pointer.translation_x = 0;
    pointer.translation_y = 0;
    pointer.scale_x = 1;
    pointer.scale_y = 1;
}

// Notification indicator state
let notificationIndicator = null;
let notificationIndicatorParent = null;
let notificationSignals = [];
let indicatorInsertTimeoutId = null; // timeout id for delayed indicator insertion
let kiwiExtension = null;
let kiwiSettings = null;
let indicatorStyleSignalId = 0;

function applyIndicatorStyle(style) {
    if (!notificationIndicator) return;
    // When attached to the panel right box (Keep Notification Panel mode),
    // the indicator sits after the clock and may become the rightmost panel
    // element when window controls are hidden — add right padding so the dot
    // isn't flush against the screen edge.
    const margin = notificationIndicatorParent === Main.panel._rightBox
        ? ' margin-right: 12px;'
        : '';
    switch (style) {
        case 'accent':
            notificationIndicator.style = 'color: -st-accent-color;' + margin;
            break;
        case 'symbolic':
            notificationIndicator.style = margin || null; // let panel theme color cascade
            break;
        case 'default':
        default:
            notificationIndicator.style = 'color: red;' + margin;
            break;
    }
}

function setupNotificationIndicator() {
    if (notificationIndicator) return;
    const keep = kiwiSettings.get_boolean('keep-notification-panel');
    notificationIndicatorParent = keep
        ? Main.panel._rightBox
        : Main.panel.statusArea.quickSettings._indicators;

    const initialStyle = kiwiSettings.get_string('notification-indicator-style');

    const iconFile = kiwiExtension.dir.get_child('icons/message-indicator-symbolic.svg');
    notificationIndicator = new St.Icon({
        gicon: Gio.FileIcon.new(iconFile),
        style_class: 'notification-badge',
        visible: false,
    });
    applyIndicatorStyle(initialStyle);

    // The icon goes into a panel container we don't own; if that is torn down
    // the icon goes with it and the 5 s poll would touch a disposed object.
    notificationIndicator.connect('destroy', () => {
        notificationIndicator = null;
    });

    // Add small delay to ensure all other indicators are added first
    indicatorInsertTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        indicatorInsertTimeoutId = null; // clear reference on fire
        let insertIndex = notificationIndicatorParent.get_n_children();
        // When attached directly to the panel right box (Keep Notification
        // Panel mode), keep the indicator adjacent to the clock instead of
        // letting it land at the far right of the panel.
        if (notificationIndicatorParent === Main.panel._rightBox && dateMenu?.container) {
            const dateIdx = notificationIndicatorParent.get_children().indexOf(dateMenu.container);
            if (dateIdx >= 0)
                insertIndex = dateIdx + 1;
        }
        notificationIndicatorParent.insert_child_at_index(notificationIndicator, insertIndex);
        return GLib.SOURCE_REMOVE;
    });

    // Update style live when the setting changes
    indicatorStyleSignalId = kiwiSettings.connect('changed::notification-indicator-style', () => {
        applyIndicatorStyle(kiwiSettings.get_string('notification-indicator-style'));
    });

    // Connect to notification signals and update visibility
    connectNotificationSignals();
    updateNotificationIndicator();
}

function cleanupNotificationIndicator() {
    // Disconnect signals and clear intervals
    if (indicatorInsertTimeoutId) {
        GLib.Source.remove(indicatorInsertTimeoutId);
        indicatorInsertTimeoutId = null;
    }
    if (indicatorStyleSignalId) {
        kiwiSettings.disconnect(indicatorStyleSignalId);
    }
    indicatorStyleSignalId = 0;
    kiwiSettings = null;
    kiwiExtension = null;
    notificationSignals.forEach(signal => {
        if (signal.obj === 'interval') {
            GLib.Source.remove(signal.id);
        } else {
            signal.obj.disconnect(signal.id);
        }
    });
    notificationSignals = [];

    if (notificationIndicator) {
        notificationIndicator.destroy();
        notificationIndicator = null;
    }
    notificationIndicatorParent = null;
}

// Sources come and go over a session. Following them keeps the indicator live
// for sources created after us, and drops each source's handles while it is
// still alive — a source is disposed right after 'source-removed', so handles
// kept until disable() were being disconnected from a dead object.
function connectSource(source) {
    const addedId = source.connect('notification-added', () => updateNotificationIndicator());
    notificationSignals.push({ obj: source, id: addedId });
    const removedId = source.connect('notification-removed', () => updateNotificationIndicator());
    notificationSignals.push({ obj: source, id: removedId });
}

function disconnectSource(source) {
    notificationSignals = notificationSignals.filter(signal => {
        if (signal.obj !== source)
            return true;
        source.disconnect(signal.id);
        return false;
    });
}

function connectNotificationSignals() {
    notificationSignals = [];
    // Monitor message tray sources for new notifications
    const sourceAddedId = Main.messageTray.connect('source-added', (_tray, source) => {
        connectSource(source);
        updateNotificationIndicator();
    });
    notificationSignals.push({ obj: Main.messageTray, id: sourceAddedId });

    const sourceRemovedId = Main.messageTray.connect('source-removed', (_tray, source) => {
        disconnectSource(source);
        updateNotificationIndicator();
    });
    notificationSignals.push({ obj: Main.messageTray, id: sourceRemovedId });

    for (const source of Main.messageTray._sources.values())
        connectSource(source);

    // Fallback periodic check
    const checkInterval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
        updateNotificationIndicator();
        return GLib.SOURCE_CONTINUE; // Keep the timeout running
    });
    notificationSignals.push({ obj: 'interval', id: checkInterval });
}

function updateNotificationIndicator() {
    if (!notificationIndicator) return;

    const hasNotifications = checkForNotifications();
    if (hasNotifications !== notificationIndicator.visible) {
        notificationIndicator.visible = hasNotifications;
    }
}

export function enable(extension) {
    if (enabled)
        return; // Prevent double-application
    kiwiExtension = extension;
    kiwiSettings = extension.getSettings();

    dateMenu = Main.panel.statusArea.dateMenu;

    // Store original parent + index for clean restoration
    originalParent = dateMenu.container.get_parent();
    if (originalParent) {
        originalParentIndex = originalParent.get_children().indexOf(dateMenu.container);
    }

    // Move date menu to end of right box (recorded original position already)
    if (dateMenu.container.get_parent() === Main.panel._centerBox) {
        Main.panel._centerBox.remove_child(dateMenu.container);
        Main.panel._rightBox.insert_child_at_index(dateMenu.container, Main.panel._rightBox.get_children().length);
    }

    const keepNotificationPanel = kiwiSettings.get_boolean('keep-notification-panel');

    // Hide the notification list column of the date menu (shown in quick settings instead)
    if (!keepNotificationPanel) {
        originalMenuBoxStyle = originalMenuBoxStyle ?? dateMenu.menu.box.style;

        hiddenMessageList = dateMenu._messageList;
        hiddenMessageList.hide();

        // Size width to the calendar (plus padding); min-width allows natural growth
        const [, natW] = dateMenu._calendar.get_preferred_width(-1);
        dateMenu.menu.box.style = `min-width: ${Math.max(300, natW + 20)}px;`;
    }

    setupCalendarAnimation();

    // Adjust notification banner alignment without destroying the actor.
    // Apply in both modes so banners appear top-right regardless of whether
    // the GNOME notification panel is kept.
    const bin = Main.messageTray._bannerBin;
    originalBannerBinProps = originalBannerBinProps || {
        x_align: bin.x_align,
        y_align: bin.y_align,
        x_expand: bin.x_expand,
    };
    bin.set_x_expand(true);
    bin.set_x_align(Clutter.ActorAlign.END);
    bin.set_y_align(Clutter.ActorAlign.START);

    // Set up notification indicator on QuickSettings
    setupNotificationIndicator();

    enabled = true;
}

export function disable() {
    dateMenu = Main.panel.statusArea.dateMenu;

    cleanupCalendarAnimation();

    // Restore the message list if we hid it
    if (hiddenMessageList) {
        hiddenMessageList.show();
        hiddenMessageList = null;
    }

    // Restore style
    if (originalMenuBoxStyle !== undefined) {
        dateMenu.menu.box.style = originalMenuBoxStyle;
        originalMenuBoxStyle = undefined;
    }

    // Move back to original parent & position
    if (originalParent && dateMenu.container.get_parent() !== originalParent) {
        const currentParent = dateMenu.container.get_parent();
        if (currentParent)
            currentParent.remove_child(dateMenu.container);
        const children = originalParent.get_children();
        const insertIndex = Math.min(originalParentIndex, children.length);
        originalParent.insert_child_at_index(dateMenu.container, insertIndex);
    }

    // Restore banner bin alignment
    if (originalBannerBinProps) {
        const bin = Main.messageTray._bannerBin;
        bin.set_x_expand(originalBannerBinProps.x_expand);
        bin.set_x_align(originalBannerBinProps.x_align);
        bin.set_y_align(originalBannerBinProps.y_align);
        originalBannerBinProps = null;
    }

    // Clean up notification indicator
    cleanupNotificationIndicator();

    enabled = false;
}

function checkForNotifications() {
    // Check the message tray's notification sources directly. Count notifications
    // that are still present (not necessarily unacknowledged) since acknowledged
    // notifications can still be in the notification panel.
    for (const source of Main.messageTray._sources.values()) {
        if (source.notifications.length > 0)
            return true;
    }

    // Check if there are any notification actors still visible in the system
    // This catches notifications that are in the notification panel
    return Main.messageTray._notificationQueue.length > 0;
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Repositions the calendar and customizes notification widgets in the top panel.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';

// State holders so we can fully restore on disable
let dateMenu;
let enabled = false;
let originalFormatFunction;
let originalParent;
let originalParentIndex;
let originalMenuBoxStyle;
let originalShouldShowNotificationSection;
let originalShouldShowMediaSection;
let removedSections = null; // { notification:{actor,index}, media:{actor,index}, messages:{actor,index} }
let originalBannerBinProps; // { x_align, y_align, x_expand }
let calendarActorRef; // preserved calendar actor to ensure visibility

// Notification indicator state
let notificationIndicator = null;
let notificationSignals = [];
let quickSettings = null;
let indicatorInsertTimeoutId = null; // timeout id for delayed indicator insertion

function setupNotificationIndicator() {
    if (notificationIndicator) return;
    quickSettings = Main.panel.statusArea.quickSettings;
    if (!quickSettings) return;

    // Create a simple widget like the username example
    notificationIndicator = new St.Icon({
        icon_name: 'media-record-symbolic',
        style_class: 'notification-badge',
        visible: false,
    });
    
    // Add small delay to ensure all other indicators are added first
    indicatorInsertTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        indicatorInsertTimeoutId = null; // clear reference on fire
        const indicatorsContainer = quickSettings._indicators;
        const lastIndex = indicatorsContainer.get_n_children();
        indicatorsContainer.insert_child_at_index(notificationIndicator, lastIndex);
        return GLib.SOURCE_REMOVE;
    });

    // Connect to notification signals and update visibility
    connectNotificationSignals();
    updateNotificationIndicator();
}

function cleanupNotificationIndicator() {
    // Disconnect signals and clear intervals
    if (indicatorInsertTimeoutId) {
        try { GLib.source_remove(indicatorInsertTimeoutId); } catch (_) {}
        indicatorInsertTimeoutId = null;
    }
    notificationSignals.forEach(signal => {
        try {
            if (signal.obj === 'interval') {
                GLib.Source.remove(signal.id);
            } else if (signal.obj && signal.id) {
                signal.obj.disconnect(signal.id);
            }
        } catch (e) {
            // Signal may already be disconnected
        }
    });
    notificationSignals = [];

    if (notificationIndicator && quickSettings) {
        const indicatorsContainer = quickSettings._indicators;
        if (indicatorsContainer) {
            indicatorsContainer.remove_child(notificationIndicator);
        }
        notificationIndicator.destroy();
        notificationIndicator = null;
    }
    quickSettings = null;
}

function connectNotificationSignals() {
    notificationSignals = [];
    // Monitor message tray sources for new notifications
    if (Main.messageTray) {
        const sourceAddedId = Main.messageTray.connect('source-added', () => updateNotificationIndicator());
        notificationSignals.push({ obj: Main.messageTray, id: sourceAddedId });

        const sourceRemovedId = Main.messageTray.connect('source-removed', () => updateNotificationIndicator());
        notificationSignals.push({ obj: Main.messageTray, id: sourceRemovedId });

        for (let source of Main.messageTray._sources.values()) {
            const notificationAddedId = source.connect('notification-added', () => updateNotificationIndicator());
            notificationSignals.push({ obj: source, id: notificationAddedId });
            const notificationRemovedId = source.connect('notification-removed', () => updateNotificationIndicator());
            notificationSignals.push({ obj: source, id: notificationRemovedId });
        }
    }

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

export function enable() {
    if (enabled)
        return; // Prevent double-application

    dateMenu = Main.panel.statusArea.dateMenu;
    if (!dateMenu)
        return;

    // Store original parent + index for clean restoration
    originalParent = dateMenu.container.get_parent();
    if (originalParent) {
        originalParentIndex = originalParent.get_children().indexOf(dateMenu.container);
    }

    // Override clock format (store original)
    if (dateMenu._clockDisplay && !originalFormatFunction) {
        originalFormatFunction = dateMenu._clockDisplay.format;
        dateMenu._clockDisplay.format = (date) => {
            try {
                const locale = dateMenu._calendar?.get_locale() || 'en-US';
                const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
                const day = new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(date);
                const month = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
                const time = new Intl.DateTimeFormat(locale, {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                }).format(date);
                return `${weekday} ${day} ${month} ${time}`;
            } catch (e) {
                return originalFormatFunction.call(dateMenu._clockDisplay, date);
            }
        };
    }

    // Move date menu to end of right box (recorded original position already)
    if (dateMenu.container.get_parent() === Main.panel._centerBox) {
        Main.panel._centerBox.remove_child(dateMenu.container);
        Main.panel._rightBox.insert_child_at_index(dateMenu.container, Main.panel._rightBox.get_children().length);
    }

    // Non-destructively remove other sections & override visibility predicates
    if (dateMenu.menu?.box) {
        originalMenuBoxStyle = originalMenuBoxStyle ?? dateMenu.menu.box.style;
        removedSections = {};

        const parentBox = dateMenu.menu.box;
        // Attempt to preserve a reference to calendar actor for safety
        if (!calendarActorRef) {
            calendarActorRef = dateMenu._calendar || dateMenu._calendarSection || null;
        }

        function detachOrHideSection(key, actorRefName) {
            const actor = dateMenu[actorRefName];
            if (!actor) return;
            // Skip if this is (somehow) the calendar actor we want to keep
            if (calendarActorRef && actor === calendarActorRef)
                return;
            let idx = -1;
            let hidden = false;
            if (actor.get_parent() === parentBox) {
                idx = parentBox.get_children().indexOf(actor);
                parentBox.remove_child(actor); // non-destructive
            } else {
                // Fallback: just hide it if we cannot safely detach
                if (actor.show && actor.hide) {
                    actor.hide();
                    hidden = true;
                }
            }
            removedSections[key] = { actor, index: idx, hidden };
        }
        detachOrHideSection('notification', '_notificationSection');
        detachOrHideSection('media', '_mediaSection');
        detachOrHideSection('messages', '_messageList');

        // Preserve originals only once
        if (!originalShouldShowNotificationSection)
            originalShouldShowNotificationSection = dateMenu._shouldShowNotificationSection;
        if (!originalShouldShowMediaSection)
            originalShouldShowMediaSection = dateMenu._shouldShowMediaSection;

        dateMenu._shouldShowNotificationSection = () => false;
        dateMenu._shouldShowMediaSection = () => false;

        // Dynamically size width so week numbers (if enabled) are not truncated.
        try {
            const baseWidth = 300; // previous fixed width
            let width = baseWidth;
            // Obtain a more accurate preferred width for the calendar actor if present
            if (calendarActorRef && calendarActorRef.get_preferred_width) {
                const [_minW, natW] = calendarActorRef.get_preferred_width(-1);
                // Add padding allowance
                width = Math.max(width, natW + 20);
            }
            // Heuristic bump if week numbers enabled but preferred width not accessible yet
            const weekNumbersEnabled = Boolean(
                dateMenu._calendar?.get_show_week_numbers?.() ||
                dateMenu._calendar?._showWeekNumbers
            );
            if (weekNumbersEnabled)
                width = Math.max(width, baseWidth + 24); // allocate extra column space

            // Use min-width to allow natural growth if theme wants larger
            dateMenu.menu.box.style = `min-width: ${width}px;`;
        } catch (_e) {
            // Fallback to original fixed width if something fails
            dateMenu.menu.box.style = 'width: 330px;';
        }

        // Ensure calendar actor is present (some GNOME versions may move it around)
        if (calendarActorRef && !calendarActorRef.get_parent()) {
            // Insert at top for consistency
            parentBox.insert_child_at_index(calendarActorRef, 0);
        }
    }

    // Adjust notification banner alignment without destroying the actor
    if (Main.messageTray?._bannerBin) {
        const bin = Main.messageTray._bannerBin;
        originalBannerBinProps = originalBannerBinProps || {
            x_align: bin.x_align,
            y_align: bin.y_align,
            x_expand: bin.x_expand,
        };
        try {
            if (bin.set_x_expand)
                bin.set_x_expand(true);
            else
                bin.x_expand = true;
            if (bin.set_x_align)
                bin.set_x_align(Clutter.ActorAlign.END);
            else
                bin.x_align = Clutter.ActorAlign.END;
            if (bin.set_y_align)
                bin.set_y_align(Clutter.ActorAlign.START);
            else
                bin.y_align = Clutter.ActorAlign.START;
        } catch (_e) {
            // Fallback: recreate only if mutation methods failed
            const newBin = new Clutter.Actor({
                name: 'bannerBin',
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.START,
            });
            // Transfer children
            bin.get_children().forEach(c => bin.remove_child(c) && newBin.add_child(c));
            const parent = bin.get_parent();
            if (parent) {
                parent.remove_child(bin);
                parent.add_child(newBin);
            }
            Main.messageTray._bannerBin = newBin;
        }
    }

    // Set up notification indicator on QuickSettings
    setupNotificationIndicator();

    enabled = true;
}

export function disable() {
    dateMenu = Main.panel.statusArea.dateMenu;
    // Restore clock format
    if (dateMenu._clockDisplay && originalFormatFunction) {
        dateMenu._clockDisplay.format = originalFormatFunction;
        originalFormatFunction = null;
    }

    // Restore other sections if we detached them
    if (removedSections && dateMenu.menu?.box) {
        const parentBox = dateMenu.menu.box;
        // Reinsert in original order based on recorded indices
        const entries = Object.values(removedSections).filter(Boolean).sort((a, b) => a.index - b.index);
        entries.forEach(({ actor, index, hidden }) => {
            if (!actor) return;
            if (hidden && actor.show) {
                actor.show();
                return;
            }
            if (index >= 0 && !actor.get_parent()) {
                const children = parentBox.get_children();
                const insertIndex = Math.min(index, children.length);
                parentBox.insert_child_at_index(actor, insertIndex);
            }
        });
        removedSections = null;
    }

    // Restore predicate methods
    if (originalShouldShowNotificationSection) {
        dateMenu._shouldShowNotificationSection = originalShouldShowNotificationSection;
        originalShouldShowNotificationSection = null;
    }
    if (originalShouldShowMediaSection) {
        dateMenu._shouldShowMediaSection = originalShouldShowMediaSection;
        originalShouldShowMediaSection = null;
    }

    // Restore style
    if (dateMenu.menu?.box && originalMenuBoxStyle !== undefined) {
        dateMenu.menu.box.style = originalMenuBoxStyle;
        originalMenuBoxStyle = undefined;
    }

    // Move back to original parent & position
    if (originalParent && dateMenu.container.get_parent() !== originalParent) {
        const currentParent = dateMenu.container.get_parent();
        if (currentParent)
            currentParent.remove_child(dateMenu.container);
        const children = originalParent.get_children();
        const insertIndex = Math.min(originalParentIndex ?? 0, children.length);
        originalParent.insert_child_at_index(dateMenu.container, insertIndex);
    }

    // Restore banner bin alignment
    if (Main.messageTray?._bannerBin && originalBannerBinProps) {
        const bin = Main.messageTray._bannerBin;
        try {
            if (bin.set_x_expand)
                bin.set_x_expand(originalBannerBinProps.x_expand);
            else
                bin.x_expand = originalBannerBinProps.x_expand;
            if (bin.set_x_align)
                bin.set_x_align(originalBannerBinProps.x_align);
            else
                bin.x_align = originalBannerBinProps.x_align;
            if (bin.set_y_align)
                bin.set_y_align(originalBannerBinProps.y_align);
            else
                bin.y_align = originalBannerBinProps.y_align;
        } catch (_e) {
            // If something went wrong, we accept the modified state.
        }
        originalBannerBinProps = null;
    }

    // Clean up notification indicator
    cleanupNotificationIndicator();

    enabled = false;
}

function checkForNotifications() {
    // Check the message tray's notification sources directly
    if (Main.messageTray && Main.messageTray._sources) {
        for (let source of Main.messageTray._sources.values()) {
            if (source && source.notifications && source.notifications.length > 0) {
                // Count notifications that are still present (not necessarily unacknowledged)
                // since acknowledged notifications can still be in the notification panel
                const activeNotifications = source.notifications.filter(notification => {
                    // Check if notification is not destroyed and still relevant
                    return notification && !notification.destroyed && !notification.isDestroyed;
                });
                
                if (activeNotifications.length > 0) {
                    return true;
                }
            }
        }
    }

    // Check if there are any notification actors still visible in the system
    // This catches notifications that are in the notification panel
    if (Main.messageTray && Main.messageTray._notificationQueue && 
        Main.messageTray._notificationQueue.length > 0) {
        return true;
    }

    // Also check if the original notification section would be visible
    // (this is the state before our calendar module hides it)
    if (originalShouldShowNotificationSection && 
        typeof originalShouldShowNotificationSection === 'function') {
        try {
            return originalShouldShowNotificationSection.call(dateMenu);
        } catch (e) {
            // If there's an error, assume no notifications
        }
    }

    return false;
}


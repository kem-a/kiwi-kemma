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
let originalMenuLayout;
let originalBannerBinProps; // { x_align, y_align, x_expand }

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
    
    // Safely disconnect all notification signals
    notificationSignals.forEach(signal => {
        try {
            if (signal.obj === 'interval') {
                GLib.Source.remove(signal.id);
            } else if (signal.obj && signal.id && !signal.obj.is_disposed?.()) {
                signal.obj.disconnect(signal.id);
            }
        } catch (e) {
            // Signal may already be disconnected or object disposed
        }
    });
    notificationSignals = [];

    if (notificationIndicator && quickSettings) {
        try {
            const indicatorsContainer = quickSettings._indicators;
            if (indicatorsContainer && !indicatorsContainer.is_disposed?.()) {
                indicatorsContainer.remove_child(notificationIndicator);
            }
            if (!notificationIndicator.is_disposed?.()) {
                notificationIndicator.destroy();
            }
        } catch (e) {
            // Objects may already be disposed
        }
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

    // Completely restructure the date menu layout to put notifications above calendar
    if (dateMenu.menu?.box && !originalMenuLayout) {
        const menuBox = dateMenu.menu.box;
        
        // Find the main container (should be a bin with hbox inside)
        const children = menuBox.get_children();
        let mainContainer = null;
        let originalHbox = null;
        
        for (let child of children) {
            // Look for the container that has the horizontal layout
            if (child.get_children && child.get_children().length > 0) {
                const possibleHbox = child.get_children()[0];
                if (possibleHbox && possibleHbox.get_children && possibleHbox.get_children().length === 2) {
                    mainContainer = child;
                    originalHbox = possibleHbox;
                    break;
                }
            }
        }
        
        if (originalHbox && originalHbox.get_children) {
            const hboxChildren = originalHbox.get_children();
            const messageList = hboxChildren[0]; // notifications
            const calendarColumn = hboxChildren[1]; // calendar
            
            // Store original layout for restoration
            originalMenuLayout = {
                menuBox: menuBox,
                mainContainer: mainContainer,
                originalHbox: originalHbox,
                messageList: messageList,
                calendarColumn: calendarColumn
            };
            
            // Remove the original container from menuBox
            menuBox.remove_child(mainContainer);
            
            // Create a new vertical layout that spans the full width
            const newVerticalLayout = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'calendar-vertical-layout',
                x_expand: true,
                y_expand: true
            });
            
            // Remove children from the original horizontal box
            originalHbox.remove_child(messageList);
            originalHbox.remove_child(calendarColumn);
            
            // Customize the notification section layout
            customizeNotificationSection(messageList);
            
            // Create a container for notifications (top section)
            const notificationContainer = new St.Widget({
                style_class: 'calendar-notification-section',
                layout_manager: new Clutter.BinLayout(),
                x_expand: true
            });
            notificationContainer.add_child(messageList);
            
            // Create a container for calendar (bottom section)  
            const calendarContainer = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_expand: true
            });
            calendarContainer.add_child(calendarColumn);
            
            // Only add notification container if there are notifications
            const shouldShowNotifications = checkForNotifications();
            if (shouldShowNotifications) {
                newVerticalLayout.add_child(notificationContainer);
            }
            newVerticalLayout.add_child(calendarContainer);
            
            // Store visibility state for updates
            originalMenuLayout.shouldShowNotifications = shouldShowNotifications;
            
            // Add the new vertical layout to the menu
            menuBox.add_child(newVerticalLayout);
            
            // Store references for cleanup
            originalMenuLayout.newVerticalLayout = newVerticalLayout;
            originalMenuLayout.notificationContainer = notificationContainer;
            originalMenuLayout.calendarContainer = calendarContainer;
            
            // Set up notification visibility monitoring
            setupNotificationVisibilityMonitoring(newVerticalLayout, notificationContainer);
        }
    }

    // Set up notification indicator on QuickSettings
    setupNotificationIndicator();

    // Adjust notification banner alignment
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
            // Continue if banner bin modification fails
        }
    }

    enabled = true;
}

function customizeNotificationSection(messageList) {
    if (!messageList) return;
    
    try {
        // Hide scrollbar by modifying the scroll view
        const scrollView = messageList._scrollView;
        if (scrollView) {
            scrollView.hscrollbar_policy = St.PolicyType.NEVER;
            scrollView.vscrollbar_policy = St.PolicyType.NEVER;
            scrollView.overlay_scrollbars = true;
        }
        
        // Remove background from main section
        messageList.remove_style_class_name('message-list-section');
        messageList.add_style_class_name('calendar-message-list-section');
        
        // Find and hide "Do not disturb" button and "clear" button
        const messageView = messageList._messageView;
        if (messageView) {
            // Hide the header with DND and clear buttons
            const children = messageList.get_children();
            children.forEach(child => {
                if (child.get_children) {
                    const grandChildren = child.get_children();
                    grandChildren.forEach(grandChild => {
                        // Look for buttons (Do not disturb and Clear)
                        if (grandChild.constructor.name.includes('Button') || 
                            grandChild.style_class?.includes('message-list-clear-button') ||
                            grandChild.style_class?.includes('do-not-disturb')) {
                            grandChild.visible = false;
                        }
                    });
                }
            });
        }
        
        // Apply custom styling to match calendar width and reduce padding
        messageList.add_style_class_name('calendar-notification-list');
        
        // Hide media players by filtering them out
        if (messageList._mediaSection) {
            messageList._mediaSection.visible = false;
        }
        
    } catch (e) {
        // Ignore errors during customization
    }
}


function setupNotificationVisibilityMonitoring(verticalLayout, notificationContainer) {
    if (!verticalLayout || !notificationContainer) return;
    
    // Monitor for notification changes and update visibility
    const updateVisibility = () => {
        try {
            const hasNotifications = checkForNotifications();
            if (hasNotifications && !notificationContainer.get_parent()) {
                // Add notification container if it has notifications but isn't shown
                verticalLayout.insert_child_at_index(notificationContainer, 0);
            } else if (!hasNotifications && notificationContainer.get_parent()) {
                // Remove notification container if no notifications
                verticalLayout.remove_child(notificationContainer);
            }
        } catch (e) {
            // Ignore errors during visibility updates
        }
    };
    
    // Set up periodic monitoring
    const monitorId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
        updateVisibility();
        return GLib.SOURCE_CONTINUE;
    });
    
    // Store for cleanup
    if (originalMenuLayout) {
        originalMenuLayout.monitorId = monitorId;
    }
}

export function disable() {
    dateMenu = Main.panel.statusArea.dateMenu;
    
    // Restore clock format
    if (dateMenu._clockDisplay && originalFormatFunction) {
        dateMenu._clockDisplay.format = originalFormatFunction;
        originalFormatFunction = null;
    }

    // Restore original horizontal layout (notifications beside calendar)
    if (originalMenuLayout && originalMenuLayout.menuBox) {
        try {
            // Remove our new vertical layout
            if (originalMenuLayout.newVerticalLayout && !originalMenuLayout.newVerticalLayout.is_disposed?.()) {
                originalMenuLayout.menuBox.remove_child(originalMenuLayout.newVerticalLayout);
                
                // Remove children from our containers (check if they exist and aren't disposed)
                if (originalMenuLayout.notificationContainer && !originalMenuLayout.notificationContainer.is_disposed?.() &&
                    originalMenuLayout.messageList && !originalMenuLayout.messageList.is_disposed?.()) {
                    originalMenuLayout.notificationContainer.remove_child(originalMenuLayout.messageList);
                }
                
                if (originalMenuLayout.calendarContainer && !originalMenuLayout.calendarContainer.is_disposed?.() &&
                    originalMenuLayout.calendarColumn && !originalMenuLayout.calendarColumn.is_disposed?.()) {
                    originalMenuLayout.calendarContainer.remove_child(originalMenuLayout.calendarColumn);
                }
                
                // Destroy our containers
                if (!originalMenuLayout.newVerticalLayout.is_disposed?.()) {
                    originalMenuLayout.newVerticalLayout.destroy();
                }
                if (originalMenuLayout.notificationContainer && !originalMenuLayout.notificationContainer.is_disposed?.()) {
                    originalMenuLayout.notificationContainer.destroy();
                }
                if (originalMenuLayout.calendarContainer && !originalMenuLayout.calendarContainer.is_disposed?.()) {
                    originalMenuLayout.calendarContainer.destroy();
                }
            }
            
            // Restore children to original horizontal layout (if they still exist)
            if (originalMenuLayout.originalHbox && !originalMenuLayout.originalHbox.is_disposed?.()) {
                if (originalMenuLayout.messageList && !originalMenuLayout.messageList.is_disposed?.()) {
                    originalMenuLayout.originalHbox.add_child(originalMenuLayout.messageList);
                }
                if (originalMenuLayout.calendarColumn && !originalMenuLayout.calendarColumn.is_disposed?.()) {
                    originalMenuLayout.originalHbox.add_child(originalMenuLayout.calendarColumn);
                }
            }
            
            // Restore the original main container to the menu (if it still exists)
            if (originalMenuLayout.menuBox && !originalMenuLayout.menuBox.is_disposed?.() &&
                originalMenuLayout.mainContainer && !originalMenuLayout.mainContainer.is_disposed?.()) {
                originalMenuLayout.menuBox.add_child(originalMenuLayout.mainContainer);
            }
        } catch (e) {
            // Ignore errors during cleanup - objects may already be disposed
        }
        
        originalMenuLayout = null;
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

    // Clean up monitoring timer if exists
    if (originalMenuLayout && originalMenuLayout.monitorId) {
        GLib.source_remove(originalMenuLayout.monitorId);
        delete originalMenuLayout.monitorId;
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

    // Check if there are any visible message groups in the message list
    if (dateMenu && dateMenu._messageList) {
        try {
            // Check if the message list has any visible content
            const messageView = dateMenu._messageList._messageView;
            if (messageView && !messageView.empty) {
                return true;
            }
        } catch (e) {
            // If there's an error, fall back to other checks
        }
    }

    return false;
}


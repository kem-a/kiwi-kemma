import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

let originalDateMenuPosition;
let dateMenu;
let originalFormatFunction;
let originalBannerAlignment;
let quickMenuNotificationsContainer;
let notificationAddedId;
let sourceAddedId;
let sources = new Map();

export function enable() {
    dateMenu = Main.panel.statusArea.dateMenu;
    
    // Add custom CSS class to clock
    if (dateMenu._clockDisplay) {
        dateMenu._clockDisplay.add_style_class_name('kiwi-clock');
    }
    
    // Store original position and format
    originalDateMenuPosition = Main.panel._rightBox.get_children().indexOf(dateMenu.container);
    if (dateMenu._clockDisplay) {
        originalFormatFunction = dateMenu._clockDisplay.format;
        dateMenu._clockDisplay.format = (date) => {
            try {
                const locale = dateMenu._calendar?.get_locale() || 'en-US';
                
                // Get parts separately to control the exact format
                const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
                const day = new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(date);
                const month = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
                const time = new Intl.DateTimeFormat(locale, { 
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false 
                }).format(date);

                return `${weekday} ${day} ${month} ${time}`;
            } catch (e) {
                return originalFormatFunction.call(dateMenu._clockDisplay, date);
            }
        };
    }
    
    // Move calendar to last position in right box
    if (dateMenu.container.get_parent() === Main.panel._centerBox) {
        Main.panel._centerBox.remove_child(dateMenu.container);
        // Get the number of children to insert at the end
        const position = Main.panel._rightBox.get_children().length;
        Main.panel._rightBox.insert_child_at_index(dateMenu.container, position);
    }
    
    // Hide notification section in calendar popup
    if (dateMenu.menu._messageList) {
        dateMenu.menu._messageList.get_parent().remove_child(dateMenu.menu._messageList);
        dateMenu.menu.box.style = 'width: 280px;';
    }

    // Move notification banners to right
    originalBannerAlignment = Main.messageTray.bannerAlignment;
    if (Main.messageTray._bannerBin) {
        Main.messageTray._bannerBin.destroy();
        Main.messageTray._bannerBin = new Clutter.Actor({
            name: 'bannerBin',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
        });
        Main.messageTray.add_child(Main.messageTray._bannerBin);
    }

    // Create a container for notifications in quick settings
    quickMenuNotificationsContainer = new St.BoxLayout({
        style_class: 'quick-settings-notifications-container',
        vertical: true,
    });
    
    const quickSettings = Main.panel.statusArea.quickSettings;
    if (quickSettings && quickSettings.menu) {
        // Add to the bottom of the quick settings menu
        quickSettings.menu.box.add_child(quickMenuNotificationsContainer);
    }

    // Connect to source-added signal and handle notifications
    sourceAddedId = Main.messageTray.connect('source-added', (tray, source) => {
        const notifyId = source.connect('notification-added', (source, notification) => {
            if (quickMenuNotificationsContainer) {
                quickMenuNotificationsContainer.add_child(notification.actor);
            }
        });
        sources.set(source, notifyId);
    });

    // Handle existing sources
    Main.messageTray.getSources().forEach(source => {
        const notifyId = source.connect('notification-added', (source, notification) => {
            if (quickMenuNotificationsContainer) {
                quickMenuNotificationsContainer.add_child(notification.actor);
            }
        });
        sources.set(source, notifyId);
    });
}

export function disable() {
    if (!dateMenu) return;

    // Remove custom CSS class from clock
    if (dateMenu._clockDisplay) {
        dateMenu._clockDisplay.remove_style_class_name('kiwi-clock');
    }
    
    // Restore original format
    if (dateMenu._clockDisplay && originalFormatFunction) {
        dateMenu._clockDisplay.format = originalFormatFunction;
    }
    
    // Restore original position
    if (dateMenu.container.get_parent() === Main.panel._rightBox) {
        Main.panel._rightBox.remove_child(dateMenu.container);
        Main.panel._centerBox.insert_child_at_index(dateMenu.container, 0);
    }
    
    // Restore notification section
    if (dateMenu.menu._messageList) {
        dateMenu.menu._calendarSection.add_child(dateMenu.menu._messageList);
        dateMenu.menu.box.style = '';
    }

    // Restore notification banner position
    if (Main.messageTray._bannerBin) {
        Main.messageTray._bannerBin.destroy();
        Main.messageTray._bannerBin = new Clutter.Actor({
            name: 'bannerBin',
            x_align: originalBannerAlignment || Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });
        Main.messageTray.add_child(Main.messageTray._bannerBin);
    }

    // Remove the notifications container
    if (quickMenuNotificationsContainer) {
        const quickSettings = Main.panel.statusArea.quickSettings;
        if (quickSettings && quickSettings.menu) {
            quickSettings.menu.box.remove_child(quickMenuNotificationsContainer);
        }
        quickMenuNotificationsContainer = null;
    }

    // Disconnect all notification signals
    if (sourceAddedId) {
        Main.messageTray.disconnect(sourceAddedId);
        sourceAddedId = null;
    }
    
    // Disconnect from all sources
    for (const [source, id] of sources) {
        source.disconnect(id);
    }
    sources.clear();

    // Disconnect the notification-added signal
    if (notificationAddedId) {
        Main.messageTray.disconnect(notificationAddedId);
        notificationAddedId = null;
    }
}

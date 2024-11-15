import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

let originalDateMenuPosition;
let dateMenu;
let originalFormatFunction;
let originalBannerAlignment;

export function enable() {
    dateMenu = Main.panel.statusArea.dateMenu;
    
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
    
    // Keep only calendar section in popup menu
    if (dateMenu.menu.box) {
        // Remove notification sections completely instead of hiding
        if (dateMenu._notificationSection) {
            dateMenu.menu.box.remove_child(dateMenu._notificationSection);
            dateMenu._notificationSection.destroy();
            dateMenu._notificationSection = null;
        }
        if (dateMenu._mediaSection) {
            dateMenu.menu.box.remove_child(dateMenu._mediaSection);
            dateMenu._mediaSection.destroy();
            dateMenu._mediaSection = null;
        }
        if (dateMenu._messageList) {
            dateMenu.menu.box.remove_child(dateMenu._messageList);
            dateMenu._messageList.destroy();
            dateMenu._messageList = null;
        }
        
        // Block the default notification handling
        dateMenu._shouldShowNotificationSection = () => false;
        dateMenu._shouldShowMediaSection = () => false;
        
        dateMenu.menu.box.style = 'width: 330px;';
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
}

export function disable() {
    if (!dateMenu) return;
    
    // Restore original format
    if (dateMenu._clockDisplay && originalFormatFunction) {
        dateMenu._clockDisplay.format = originalFormatFunction;
    }
    
    // Don't restore notification sections in disable()
    if (dateMenu.container.get_parent() === Main.panel._rightBox) {
        Main.panel._rightBox.remove_child(dateMenu.container);
        Main.panel._centerBox.insert_child_at_index(dateMenu.container, 0);
    }
    
    // Reset style only
    dateMenu.menu.box.style = '';

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
}

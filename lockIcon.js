// lockIcon.js
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';

export class LockIcon {
    constructor() {
        this._numLockIcon = null;
        this._capsLockIcon = null;
    }

    enable() {
        if (Main.panel.statusArea['keyboard'] && Main.panel.statusArea['keyboard']._indicators) {
            this._capsLockIcon = new St.Icon({ icon_name: 'caps-lock-enabled-symbolic', style_class: 'system-status-icon' });
            this._numLockIcon = new St.Icon({ icon_name: 'num-lock-enabled-symbolic', style_class: 'system-status-icon' });
            Main.panel.statusArea['keyboard']._indicators.add_child(this._capsLockIcon);
            Main.panel.statusArea['keyboard']._indicators.add_child(this._numLockIcon);
        } else {
            log('keyboard status area or its _indicators property is not available');
        }
    }

    disable() {
        if (Main.panel.statusArea['keyboard'] && Main.panel.statusArea['keyboard']._indicators) {
            if (this._capsLockIcon) {
                Main.panel.statusArea['keyboard']._indicators.remove_child(this._capsLockIcon);
                this._capsLockIcon = null;
            }
            if (this._numLockIcon) {
                Main.panel.statusArea['keyboard']._indicators.remove_child(this._numLockIcon);
                this._numLockIcon = null;
            }
        }
    }
}

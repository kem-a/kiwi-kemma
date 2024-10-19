import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { AddUsernameToQuickMenu } from './addUsernameToQuickMenu.js';
import { MoveFullscreenWindow } from './moveFullscreenWindow.js';
import { FocusLaunchedWindow } from './focusLaunchedWindow.js';
import { LockIcon } from './lockIcon.js';
import { TransparentMove } from './transparentMove.js';
// import { BatteryPercentage } from './batteryPercentage.js';
import Gio from 'gi://Gio';

export default class KiwiExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._settings = this.getSettings();
        this._instances = {
            moveFullscreenWindow: new MoveFullscreenWindow(),
            addUsernameToQuickMenu: new AddUsernameToQuickMenu(),
            focusLaunchedWindow: new FocusLaunchedWindow(),
            lockIcon: new LockIcon(),
            transparentMove: new TransparentMove(),
            // batteryPercentage: new BatteryPercentage(),
        };
    }

    enable() {
        if (this._settings.get_boolean('move-window-to-new-workspace')) {
            this._instances.moveFullscreenWindow.enable();
        }
        if (this._settings.get_boolean('add-username-to-quick-menu')) {
            this._instances.addUsernameToQuickMenu.enable();
        }
        if (this._settings.get_boolean('focus-launched-window')) {
            this._instances.focusLaunchedWindow.enable();
        }
        if (this._settings.get_boolean('lock-icon')) {
            this._instances.lockIcon.enable();
        }
        if (this._settings.get_boolean('transparent-move')) {
            this._instances.transparentMove.enable();
        }
        // if (this._settings.get_boolean('battery-percentage')) {
        //     this._instances.batteryPercentage.enable();
        // }
    }

    disable() {
        for (let instance of Object.values(this._instances)) {
            instance.disable();
        }
    }
}
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { AddUsernameToQuickMenu, enable as addUsernameEnable, disable as addUsernameDisable } from './addUsernameToQuickMenu.js';
import { MoveFullscreenWindow } from './moveFullscreenWindow.js';
import { FocusLaunchedWindow } from './focusLaunchedWindow.js';
import { LockIcon, enable as lockIconEnable, disable as lockIconDisable } from './lockIcon.js';
import { TransparentMove } from './transparentMove.js';
// import { BatteryPercentage } from './batteryPercentage.js';


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

    _on_settings_changed() {
        if (this._settings.get_boolean('move-window-to-new-workspace')) {
            this._instances.moveFullscreenWindow.enable();
        } else {
            this._instances.moveFullscreenWindow.disable();
        }

        if (this._settings.get_boolean('add-username-to-quick-menu')) {
            addUsernameEnable();
        } else {
            addUsernameDisable();
        }

        if (this._settings.get_boolean('focus-launched-window')) {
            this._instances.focusLaunchedWindow.enable();
        } else {
            this._instances.focusLaunchedWindow.disable();
        }

        if (this._settings.get_boolean('lock-icon')) {
            lockIconEnable();
        } else {
            lockIconDisable();
        }

        if (this._settings.get_boolean('transparent-move')) {
            this._instances.transparentMove.enable();
        } else {
            this._instances.transparentMove.disable();
        }

        // if (this._settings.get_boolean('battery-percentage')) {
        //     this._instances.batteryPercentage.enable();
        // } else {
        //     this._instances.batteryPercentage.disable();
        // }
    }

    enable() {
        this._settings = this.getSettings();
        this._on_settings_changed();
        this._settings.connectObject('changed', this._on_settings_changed.bind(this), this);
    }

    disable() {
        this._settings.disconnectObject(this);
        this._settings = null;

        for (let instance of Object.values(this._instances)) {
            instance.disable();
        }
    }
}
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { enable as addUsernameEnable, disable as addUsernameDisable } from './addUsernameToQuickMenu.js';
import { enable as moveFullscreenEnable, disable as moveFullscreenDisable } from './moveFullscreenWindow.js';
import { enable as focusLaunchedWindowEnable, disable as focusLaunchedWindowDisable } from './focusLaunchedWindow.js';
import { enable as lockIconEnable, disable as lockIconDisable } from './lockIcon.js';
import { enable as transparentMoveEnable, disable as transparentMoveDisable } from './transparentMove.js';
import { enable as batteryPercentageEnable, disable as batteryPercentageDisable } from './batteryPercentage.js';

export default class KiwiExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._settings = this.getSettings();
    }

    _on_settings_changed() {
        if (this._settings.get_boolean('move-window-to-new-workspace')) {
            moveFullscreenEnable();
        } else {
            moveFullscreenDisable();
        }

        if (this._settings.get_boolean('add-username-to-quick-menu')) {
            addUsernameEnable();
        } else {
            addUsernameDisable();
        }

        if (this._settings.get_boolean('focus-launched-window')) {
            focusLaunchedWindowEnable();
        } else {
            focusLaunchedWindowDisable();
        }

        if (this._settings.get_boolean('lock-icon')) {
            lockIconEnable();
        } else {
            lockIconDisable();
        }

        if (this._settings.get_boolean('transparent-move')) {
            transparentMoveEnable();
        } else {
            transparentMoveDisable();
        }

        if (this._settings.get_boolean('battery-percentage')) {
            batteryPercentageEnable();
        } else {
            batteryPercentageDisable();
        }
    }

    enable() {
        this._settingsChangedId = this._settings.connect('changed', this._on_settings_changed.bind(this));
        this._on_settings_changed();
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        moveFullscreenDisable();
        addUsernameDisable();
        focusLaunchedWindowDisable();
        lockIconDisable();
        transparentMoveDisable();
        batteryPercentageDisable();
    }
}
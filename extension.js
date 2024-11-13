import * as ExtensionUtils from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { enable as addUsernameEnable, disable as addUsernameDisable } from './apps/addUsernameToQuickMenu.js';
import { enable as moveFullscreenEnable, disable as moveFullscreenDisable } from './apps/moveFullscreenWindow.js';
import { enable as focusLaunchedWindowEnable, disable as focusLaunchedWindowDisable } from './apps/focusLaunchedWindow.js';
import { enable as lockIconEnable, disable as lockIconDisable } from './apps/lockIcon.js';
import { enable as transparentMoveEnable, disable as transparentMoveDisable } from './apps/transparentMove.js';
import { enable as batteryPercentageEnable, disable as batteryPercentageDisable } from './apps/batteryPercentage.js';
import { enable as calendarEnable, disable as calendarDisable } from './apps/calendar.js';
import { enable as windowTitleEnable, disable as windowTitleDisable } from './apps/windowTitle.js';
import { enable as windowControlsEnable, disable as windowControlsDisable } from './apps/windowControls.js';
import { enable as panelHoverEnable, disable as panelHoverDisable } from './apps/panelHover.js';
import { enable as panelTransparencyEnable, disable as panelTransparencyDisable } from './apps/panelTransparency.js';

export default class KiwiExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    _on_settings_changed(key) {
        if (key === 'button-type' && this._settings.get_boolean('show-window-controls')) {
            windowControlsDisable();
            windowControlsEnable();
        }

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

        if (this._settings.get_boolean('move-calendar-right')) {
            calendarEnable();
        } else {
            calendarDisable();
        }

        if (this._settings.get_boolean('show-window-title')) {
            windowTitleEnable();
        } else {
            windowTitleDisable();
        }

        if (this._settings.get_boolean('show-window-controls')) {
            windowControlsEnable();
        } else {
            windowControlsDisable();
        }

        if (this._settings.get_boolean('panel-hover-fullscreen')) {
            panelHoverEnable();
        } else {
            panelHoverDisable();
        }

        if (this._settings.get_boolean('panel-transparency')) {
            panelTransparencyEnable(this._settings);  // Pass settings object
        } else {
            panelTransparencyDisable();
        }
    }

    enable() {
        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect('changed', (settings, key) => this._on_settings_changed(key));
        this._on_settings_changed(null);
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
        calendarDisable();
        windowTitleDisable();
        windowControlsDisable();
        panelHoverDisable();
        panelTransparencyDisable();
    }
}
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
import { enable as hideMinimizedWindowsEnable, disable as hideMinimizedWindowsDisable } from './apps/hideMinimizedWindows.js';
import { enable as gtkThemeManagerEnable, disable as gtkThemeManagerDisable } from './apps/gtkThemeManager.js';
import { enable as firefoxThemeManagerEnable, disable as firefoxThemeManagerDisable } from './apps/firefoxThemeManager.js';
import { enable as hideActivitiesButtonEnable, disable as hideActivitiesButtonDisable } from './apps/hideActivitiesButton.js';
import { enable as overviewWallpaperEnable, disable as overviewWallpaperDisable, refresh as overviewWallpaperRefresh } from './apps/overviewWallpaper.js';
import { enable as skipOverviewEnable, disable as skipOverviewDisable } from './apps/skipOverviewOnLogin.js';
// near-future feature
//import { enable as quickSettingsNotificationsEnable, disable as quickSettingsNotificationsDisable } from './apps/quickSettingsNotifications.js';
import { enable as keyboardIndicatorEnable, disable as keyboardIndicatorDisable } from './apps/keyboardIndicator.js';

export default class KiwiExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    _on_settings_changed(key) {
        // Re-apply keyboard indicator module on any of its keys changing
        if (key === 'keyboard-indicator' || key === 'hide-keyboard-indicator') {
            if (this._settings.get_boolean('keyboard-indicator')) {
                keyboardIndicatorDisable();
                keyboardIndicatorEnable(this._settings);
            } else {
                keyboardIndicatorDisable();
            }
        }

        if (key === 'button-type' && this._settings.get_boolean('show-window-controls')) {
            windowControlsDisable();
            windowControlsEnable();
        }

        // GTK theme updates are handled by gtkThemeManager module
        // No need to handle 'enable-app-window-buttons' or 'button-type' here for GTK updates

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
            //quickSettingsNotificationsEnable();
        } else {
            calendarDisable();
            //quickSettingsNotificationsDisable();
        }

        if (this._settings.get_boolean('show-window-title')) {
            windowTitleEnable();
        } else {
            windowTitleDisable();
        }

        if (this._settings.get_boolean('show-window-controls') && this._settings.get_boolean('enable-app-window-buttons')) {
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

        if (this._settings.get_boolean('hide-minimized-windows')) {
            hideMinimizedWindowsEnable();
        } else {
            hideMinimizedWindowsDisable();
        }

        if (this._settings.get_boolean('hide-activities-button')) {
            hideActivitiesButtonEnable();
        } else {
            hideActivitiesButtonDisable();
        }

        if (this._settings.get_boolean('overview-wallpaper-background')) {
            overviewWallpaperEnable(this._settings);
        } else {
            overviewWallpaperDisable();
        }

        if (this._settings.get_boolean('skip-overview-on-login')) {
            skipOverviewEnable();
        } else {
            skipOverviewDisable();
        }

        // Firefox styling manager
        if (this._settings.get_boolean('enable-firefox-styling'))
            firefoxThemeManagerEnable();
        else
            firefoxThemeManagerDisable();

        // Keyboard indicator module (idempotent apply on general refresh)
        if (this._settings.get_boolean('keyboard-indicator'))
            keyboardIndicatorEnable(this._settings);
        else
            keyboardIndicatorDisable();
    }

    enable() {
        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect('changed', (settings, key) => this._on_settings_changed(key));
        
        // Enable GTK theme manager
        gtkThemeManagerEnable();
        // Enable Firefox theme manager based on setting
        if (this._settings.get_boolean('enable-firefox-styling'))
            firefoxThemeManagerEnable();
        
        this._on_settings_changed(null);
        // Generate wallpaper background if enabled
        overviewWallpaperRefresh();
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
        hideMinimizedWindowsDisable();
        hideActivitiesButtonDisable();
        overviewWallpaperDisable();
        skipOverviewDisable();
        keyboardIndicatorDisable();
        gtkThemeManagerDisable();
        firefoxThemeManagerDisable();
        this._settings = null;
    }
}
/*
 * Kiwi is not Apple – macOS-inspired enhancements for GNOME Shell.
 * Copyright (C) 2025  Arnis Kemlers
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
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
import { enable as panelStylingEnable, disable as panelStylingDisable, enableMenus as popupStylingEnable, disableMenus as popupStylingDisable } from './apps/panelStyling.js';
import { enable as hideMinimizedWindowsEnable, disable as hideMinimizedWindowsDisable } from './apps/hideMinimizedWindows.js';
import { enable as gtkThemeManagerEnable, disable as gtkThemeManagerDisable } from './apps/gtkThemeManager.js';
import { enable as firefoxThemeManagerEnable, disable as firefoxThemeManagerDisable } from './apps/firefoxThemeManager.js';
import { enable as thunderbirdThemeManagerEnable, disable as thunderbirdThemeManagerDisable } from './apps/thunderbirdThemeManager.js';
import { enable as hideActivitiesButtonEnable, disable as hideActivitiesButtonDisable } from './apps/hideActivitiesButton.js';
import { enable as overviewWallpaperEnable, disable as overviewWallpaperDisable, refresh as overviewWallpaperRefresh } from './apps/overviewWallpaper.js';
import { enable as skipOverviewEnable, disable as skipOverviewDisable } from './apps/skipOverviewOnLogin.js';
import { enable as quickSettingsNotificationsEnable, disable as quickSettingsNotificationsDisable } from './apps/quickSettingsNotifications.js';
import { enable as quickSettingsMediaEnable, disable as quickSettingsMediaDisable } from './apps/quickSettingsMedia.js';
import { enable as keyboardIndicatorEnable, disable as keyboardIndicatorDisable } from './apps/keyboardIndicator.js';
import { enable as launchpadAppEnable, disable as launchpadAppDisable } from './apps/launchpadApp.js';
import { enable as dockBlurEnable, disable as dockBlurDisable } from './apps/dockBlur.js';
import { enable as dockStylingEnable, disable as dockStylingDisable } from './apps/dockStyling.js';
import { enable as dockColorsEnable, disable as dockColorsDisable } from './apps/dockColors.js';
import { enable as minimizedToDockEnable, disable as minimizedToDockDisable } from './apps/minimizedToDock.js';
import { enable as downloadsStackEnable, disable as downloadsStackDisable } from './apps/downloadsStack.js';
import { enable as reduceWindowAnimationsEnable, disable as reduceWindowAnimationsDisable } from './apps/reduceWindowAnimations.js';
import { setHideMediaIndicator, setHideMediaPlayer } from './apps/quickSettingsMedia.js';
import { enableDragRestore, disableDragRestore } from './apps/windowTiling.js';
import { dockActive, isDockExtension } from './apps/dockUtils.js';

export default class KiwiExtension extends Extension {
    _on_settings_changed(key) {
        const gettextFunc = this.gettext.bind(this);
        // Re-apply keyboard indicator module on any of its keys changing
        if (key === 'keyboard-indicator' || key === 'hide-keyboard-indicator') {
            if (this._settings.get_boolean('keyboard-indicator')) {
                keyboardIndicatorDisable();
                keyboardIndicatorEnable(this._settings);
            } else {
                keyboardIndicatorDisable();
            }
        }

        if ((key === 'button-type' || key === 'enable-app-window-buttons') && this._settings.get_boolean('show-window-controls')) {
            windowControlsDisable();
            windowControlsEnable(this);
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

        this._applyBatteryPercentage();

        if (key === 'keep-notification-panel' && this._settings.get_boolean('move-calendar-right')) {
            calendarDisable();
            quickSettingsNotificationsDisable();
            quickSettingsMediaDisable();
        }

        if (this._settings.get_boolean('move-calendar-right')) {
            calendarEnable(this);
            if (!this._settings.get_boolean('keep-notification-panel')) {
                quickSettingsNotificationsEnable(gettextFunc, this._settings);
                quickSettingsMediaEnable(gettextFunc);
            } else {
                quickSettingsNotificationsDisable();
                quickSettingsMediaDisable();
            }
        } else {
            calendarDisable();
            quickSettingsNotificationsDisable();
            quickSettingsMediaDisable();
        }

        // Calendar (re-)enable moves dateMenu to the end of _rightBox, which
        // pushes window controls out of the last position. Tear down so the
        // re-enable below re-attaches them at the far right.
        if ((key === 'keep-notification-panel' || key === 'move-calendar-right')
            && this._settings.get_boolean('show-window-controls')) {
            windowControlsDisable();
        }

        if (this._settings.get_boolean('show-window-title')) {
            windowTitleEnable(this);
        } else {
            windowTitleDisable();
        }

        if (this._settings.get_boolean('show-window-title') &&
            this._settings.get_boolean('show-tiling-title-menu')) {
            enableDragRestore();
        } else {
            disableDragRestore();
        }

        if (this._settings.get_boolean('show-window-controls')) {
            windowControlsEnable(this);
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

        if (this._settings.get_boolean('panel-styling')) {
            panelStylingEnable();
        } else {
            panelStylingDisable();
        }

        if (this._settings.get_boolean('popup-menu-styling')) {
            popupStylingEnable();
        } else {
            popupStylingDisable();
        }

        // Everything below that hangs off Dash-to-Dock stays off while it is not
        // running, rather than reaching for a dock that is never going to turn up
        const hasDock = dockActive();
        const minimizeToDock = hasDock && this._settings.get_boolean('minimize-to-dock');

        // A window parked in the dock should not also show up in the overview
        if (this._settings.get_boolean('hide-minimized-windows') || minimizeToDock) {
            hideMinimizedWindowsEnable();
        } else {
            hideMinimizedWindowsDisable();
        }

        if (minimizeToDock) {
            minimizedToDockEnable();
        } else {
            minimizedToDockDisable();
        }

        if (hasDock && this._settings.get_boolean('downloads-in-dock')) {
            downloadsStackEnable(gettextFunc, this._settings);
        } else {
            downloadsStackDisable();
        }

        if (this._settings.get_boolean('hide-activities-button')) {
            hideActivitiesButtonEnable();
        } else {
            hideActivitiesButtonDisable();
        }

        const hideMediaIndicator = this._settings.get_boolean('hide-media-indicator');
        setHideMediaIndicator(hideMediaIndicator);

        const hideMediaPlayer = this._settings.get_boolean('hide-media-player');
        setHideMediaPlayer(hideMediaPlayer);

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
        if (this._settings.get_boolean('enable-firefox-styling') || this._settings.get_boolean('show-window-controls'))
            firefoxThemeManagerEnable(this);
        else
            firefoxThemeManagerDisable();

        // Thunderbird styling manager
        if (this._settings.get_boolean('enable-thunderbird-styling') || this._settings.get_boolean('show-window-controls'))
            thunderbirdThemeManagerEnable(this);
        else
            thunderbirdThemeManagerDisable();

        // Keyboard indicator module (idempotent apply on general refresh)
        if (this._settings.get_boolean('keyboard-indicator'))
            keyboardIndicatorEnable(this._settings);
        else
            keyboardIndicatorDisable();

        // Dock styling
        if (hasDock && this._settings.get_boolean('dock-styling'))
            dockStylingEnable();
        else
            dockStylingDisable();

        // Dock blur
        if (hasDock && this._settings.get_boolean('dock-blur'))
            dockBlurEnable();
        else
            dockBlurDisable();

        // Dock colors that follow the wallpaper behind the dock
        if (hasDock && this._settings.get_boolean('dock-adaptive-colors'))
            dockColorsEnable();
        else
            dockColorsDisable();

        // Reduce window open/close animations (macOS-style scale + fade)
        if (this._settings.get_boolean('reduce-window-animations'))
            reduceWindowAnimationsEnable();
        else
            reduceWindowAnimationsDisable();

        // Launchpad app
        if (key === 'launchpad-app-custom-icon' && this._settings.get_boolean('enable-launchpad-app')) {
            launchpadAppDisable();
            launchpadAppEnable(this, gettextFunc);
        } else if (this._settings.get_boolean('enable-launchpad-app')) {
            launchpadAppEnable(this, gettextFunc);
        } else {
            launchpadAppDisable();
        }
    }

    // GNOME's own top bar percentage would show a second number, so ours steps aside
    _applyBatteryPercentage() {
        if (this._settings.get_boolean('battery-percentage') &&
            !this._interfaceSettings.get_boolean('show-battery-percentage')) {
            batteryPercentageEnable();
        } else {
            batteryPercentageDisable();
        }
    }

    enable() {
        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect('changed', (settings, key) => this._on_settings_changed(key));
        this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._batteryPercentageChangedId = this._interfaceSettings.connect('changed::show-battery-percentage',
            () => this._applyBatteryPercentage());

        // The dock is a separate extension the user can turn on and off under
        // us, and the dock features follow it either way
        this._dockStateChangedId = Main.extensionManager.connect('extension-state-changed',
            (_manager, extension) => {
                if (isDockExtension(extension))
                    this._on_settings_changed(null);
            });
        
        // Enable GTK theme manager
        gtkThemeManagerEnable(this);
        // Enable Firefox theme manager based on setting
        if (this._settings.get_boolean('enable-firefox-styling') || this._settings.get_boolean('show-window-controls'))
            firefoxThemeManagerEnable(this);
        // Enable Thunderbird theme manager based on setting
        if (this._settings.get_boolean('enable-thunderbird-styling') || this._settings.get_boolean('show-window-controls'))
            thunderbirdThemeManagerEnable(this);

        focusLaunchedWindowEnable();

        this._on_settings_changed(null);
        overviewWallpaperRefresh();
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._batteryPercentageChangedId) {
            this._interfaceSettings.disconnect(this._batteryPercentageChangedId);
            this._batteryPercentageChangedId = null;
        }
        if (this._dockStateChangedId) {
            Main.extensionManager.disconnect(this._dockStateChangedId);
            this._dockStateChangedId = null;
        }
        this._interfaceSettings = null;
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
        panelStylingDisable();
        popupStylingDisable();
        hideMinimizedWindowsDisable();
        hideActivitiesButtonDisable();
        overviewWallpaperDisable();
        skipOverviewDisable();
        keyboardIndicatorDisable();
        gtkThemeManagerDisable();
        firefoxThemeManagerDisable();
        thunderbirdThemeManagerDisable();
        quickSettingsMediaDisable();
        quickSettingsNotificationsDisable();
        launchpadAppDisable();
        dockBlurDisable();
        dockStylingDisable();
        dockColorsDisable();
        // The stack borrows the minimized strip and holds a signal on it, so it
        // has to let go before that strip is destroyed
        downloadsStackDisable();
        minimizedToDockDisable();
        reduceWindowAnimationsDisable();
        disableDragRestore();
        this._settings = null;
    }
}
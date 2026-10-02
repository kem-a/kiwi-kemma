// SPDX-License-Identifier: GPL-3.0-or-later
// Shows a battery percentage indicator when charge falls below the threshold.

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
// Static variable for the battery percentage trigger threshold. Default is 20%.
const BATTERY_TRIGGER_PERCENTAGE = 20;
const FALLBACK_BATTERY_PATH = '/org/freedesktop/UPower/devices/battery_BAT0';

class BatteryPercentage {
    constructor() {
        // Create a label for displaying the battery percentage
        this._batteryLabel = new St.Label({
            style_class: 'battery-percentage-label',
            text: '',
            opacity: 0,
            y_align: Clutter.ActorAlign.CENTER
        });
        // Add the label to the Quick Settings indicators
        Main.panel.statusArea.quickSettings._indicators.add_child(this._batteryLabel);
        this._batteryLabel.visible = false;
        
    // Initialize the battery proxy to interact with UPower
    this._propertiesChangedId = null;
    this._initBatteryProxy();
        // Track the last battery state and percentage to avoid redundant animations
        this._lastPercentage = null;
        this._lastState = null;
    }

    _initBatteryProxy() {
        // Try to detect the correct battery object path dynamically using UPower.
        // This avoids hardcoding BAT1 which can be BAT0 on some machines.
        const upowerProxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.system,
            g_interface_name: 'org.freedesktop.UPower',
            g_object_path: '/org/freedesktop/UPower',
            g_name: 'org.freedesktop.UPower',
            g_flags: Gio.DBusProxyFlags.NONE,
        });

        upowerProxy.init_async(GLib.PRIORITY_DEFAULT, null, (proxy, res) => {
            try {
                proxy.init_finish(res);

                // Enumerate devices and look for battery device paths
                let devices = [];
                try {
                    devices = proxy.call_sync('EnumerateDevices', null, Gio.DBusCallFlags.NONE, -1, null).deep_unpack()[0];
                } catch (e) {
                    // Enumeration failed; use the fallback path
                }

                // Prefer a laptop battery over peripheral ones (mice, headsets), else BAT0
                const batteryPath = devices.find(p => /battery_BAT\d+/.test(p))
                    ?? devices.find(p => /battery/i.test(p))
                    ?? FALLBACK_BATTERY_PATH;
                this._initDeviceProxy(batteryPath);
            } catch (e) {
                // If anything goes wrong enumerating devices, fall back to the original hardcoded path
                this._initDeviceProxy(FALLBACK_BATTERY_PATH);
            }
        });
    }

    _initDeviceProxy(path) {
        this._batteryProxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.system,
            g_interface_name: 'org.freedesktop.UPower.Device',
            g_object_path: path,
            g_name: 'org.freedesktop.UPower',
            g_flags: Gio.DBusProxyFlags.NONE,
        });

        this._batteryProxy.init_async(GLib.PRIORITY_DEFAULT, null, (deviceProxy, deviceRes) => {
            try {
                deviceProxy.init_finish(deviceRes);
                // Update the battery percentage after initialization
                this._updateBatteryPercentage();
                // Connect to the properties-changed signal to update on changes
                this._propertiesChangedId = this._batteryProxy.connect('g-properties-changed', () => {
                    this._updateBatteryPercentage();
                });
            } catch (e) {
                // Device proxy initialization failed; nothing more we can do here.
            }
        });
    }

    _updateBatteryPercentage() {
        // Get the battery percentage and state properties
        const percentageProperty = this._batteryProxy.get_cached_property('Percentage');
        const stateProperty = this._batteryProxy.get_cached_property('State');

        // If properties are not available, return early
        if (!percentageProperty || !stateProperty) {
            return;
        }

        const percentage = percentageProperty.unpack();
        const state = stateProperty.unpack();

        // Update the label text with the current battery percentage
        this._batteryLabel.text = `${percentage}%`;

        // Animate when percentage changes to 25% while not charging
        if (percentage === BATTERY_TRIGGER_PERCENTAGE && state === 2 && percentage !== this._lastPercentage) {
            this._animateIn();
        }

        // Animate when plugging or unplugging the charger while below 25%
        if (percentage <= BATTERY_TRIGGER_PERCENTAGE && state !== this._lastState) {
            // State: 1 = Charging, 2 = Discharging
            if (state === 1)
                this._animateOut();
            else if (state === 2)
                this._animateIn();
        }

        // Update the last known state and percentage
        this._lastPercentage = percentage;
        this._lastState = state;
    }

    _animateIn() {
        // Show the label and animate it sliding in from the right
        this._batteryLabel.visible = true;
        this._batteryLabel.translation_x = this._batteryLabel.width;
        this._batteryLabel.ease({
            translation_x: 0,
            opacity: 255,
            duration: 250,
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => {
                this._batteryLabel.translation_x = 0;
            }
        });
    }

    destroy() {
        if (this._propertiesChangedId && this._batteryProxy) {
            this._batteryProxy.disconnect(this._propertiesChangedId);
            this._propertiesChangedId = null;
        }
        this._batteryProxy = null;
        this._batteryLabel.destroy();
        this._batteryLabel = null;
    }

    _animateOut() {
        // Animate the label sliding out to the right and then hide it
        this._batteryLabel.ease({
            translation_x: this._batteryLabel.width,
            opacity: 0,
            duration: 250,
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => {
                this._batteryLabel.translation_x = this._batteryLabel.width;
                this._batteryLabel.visible = false;
            }
        });
    }
}

let batteryPercentageInstance = null;

export const enable = () => {
    // Enable the battery percentage indicator
    if (!batteryPercentageInstance) {
        batteryPercentageInstance = new BatteryPercentage();
    }
};

export const disable = () => {
    // Disable the battery percentage indicator and remove it from the panel
    if (batteryPercentageInstance) {
        batteryPercentageInstance.destroy();
        batteryPercentageInstance = null;
    }
};

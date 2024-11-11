// batteryPercentage.js - Updated for GNOME 45+
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
// Static variable for the battery percentage trigger threshold
const BATTERY_TRIGGER_PERCENTAGE = 25;

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
        this._initBatteryProxy();
        // Track the last battery state and percentage to avoid redundant animations
        this._lastPercentage = null;
        this._lastState = null;
    }

    _initBatteryProxy() {
        // Set up a D-Bus proxy to communicate with UPower for battery status
        this._batteryProxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.system,
            g_interface_name: 'org.freedesktop.UPower.Device',
            g_object_path: '/org/freedesktop/UPower/devices/battery_BAT1',
            g_name: 'org.freedesktop.UPower',
            g_flags: Gio.DBusProxyFlags.NONE,
        });

        // Initialize the proxy asynchronously
        this._batteryProxy.init_async(GLib.PRIORITY_DEFAULT, null, (proxy, result) => {
            try {
                proxy.init_finish(result);
                // Update the battery percentage after initialization
                this._updateBatteryPercentage();
                // Connect to the properties-changed signal to update on changes
                this._batteryProxy.connect('g-properties-changed', () => {
                    this._updateBatteryPercentage();
                });
            } catch (e) {
                // Handle initialization error
            }
        });
    }

    _updateBatteryPercentage() {
        try {
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
                if (state === 1 || state === 2) { // State: 1 = Charging, 2 = Discharging
                    if (state === 1) {
                        this._animateOut();
                    } else if (state === 2) {
                        this._animateIn();
                    }
                }
            }

            // Update the last known state and percentage
            this._lastPercentage = percentage;
            this._lastState = state;
        } catch (e) {
            // Handle update error
        }
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
        Main.panel.statusArea.quickSettings._indicators.remove_child(batteryPercentageInstance._batteryLabel);
        batteryPercentageInstance = null;
    }
};

// batteryPercentage.js
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class BatteryPercentage {
    enable() {
        this._powerManager = Main.panel.statusArea['aggregateMenu']._power;
        this._batteryPercentageSignal = this._powerManager.connect('notify::percentage', this._updateBatteryPercentage.bind(this));
        this._updateBatteryPercentage();
    }

    disable() {
        if (this._batteryPercentageSignal) {
            this._powerManager.disconnect(this._batteryPercentageSignal);
            this._batteryPercentageSignal = null;
        }
    }

    _updateBatteryPercentage() {
        let percentage = this._powerManager.percentage;
        if (percentage > 25 && !this._powerManager.charging) {
            this._powerManager.percentageLabel.hide();
        } else {
            this._powerManager.percentageLabel.show();
        }
    }
};

// SPDX-License-Identifier: GPL-3.0-or-later
// Kiwi Extension - Quick Settings Media playback widget helpers

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import { loadInterfaceXML } from 'resource:///org/gnome/shell/misc/fileUtils.js';

import { Player, MPRIS_PLAYER_PREFIX } from './player.js';

const DBusIface = loadInterfaceXML('org.freedesktop.DBus');
const DBusProxy = Gio.DBusProxy.makeProxyWrapper(DBusIface);

export class Source extends GObject.Object {
    constructor(gettext) {
        super();
        this._players = new Map();
        this._proxy = null;
        this._nameOwnerChangedId = 0;
        this._gettext = typeof gettext === 'function' ? gettext : (message) => message;
    }

    start() {
        if (this._proxy)
            return;
        this._proxy = new DBusProxy(
            Gio.DBus.session,
            'org.freedesktop.DBus',
            '/org/freedesktop/DBus',
            this._onProxyReady.bind(this)
        );
    }

    stop() {
        if (this._proxy && this._nameOwnerChangedId) {
            this._proxy.disconnectSignal(this._nameOwnerChangedId);
            this._nameOwnerChangedId = 0;
        }

        const players = [...this._players.values()];
        this._players.clear();

        for (const player of players) {
            player.disconnectObject(this);
            this.emit('player-removed', player);
            player.destroy();
        }

        this._proxy = null;
    }

    destroy() {
        this.stop();
    }

    get players() {
        return [...this._players.values()];
    }

    _addPlayer(busName) {
        if (this._players.has(busName))
            return;

        const player = new Player(busName, this._gettext);
        this._players.set(busName, player);

        player.connectObject('notify::can-play', () => {
            this.emit(player.canPlay ? 'player-added' : 'player-removed', player);
        }, this);

        if (player.canPlay)
            this.emit('player-added', player);
    }

    async _onProxyReady() {
        if (!this._proxy)
            return;

        try {
            const [names] = await this._proxy.ListNamesAsync();
            for (const name of names) {
                if (!name.startsWith(MPRIS_PLAYER_PREFIX))
                    continue;
                this._addPlayer(name);
            }

            this._nameOwnerChangedId = this._proxy.connectSignal('NameOwnerChanged', this._onNameOwnerChanged.bind(this));
        } catch (error) {
            logError(error, '[kiwi] Failed to enumerate MPRIS players');
        }
    }

    _onNameOwnerChanged(_proxy, _sender, [name, oldOwner, newOwner]) {
        if (!name.startsWith(MPRIS_PLAYER_PREFIX))
            return;

        if (oldOwner) {
            const player = this._players.get(name);
            if (player) {
                this._players.delete(name);
                player.disconnectObject(this);
                this.emit('player-removed', player);
                player.destroy();
            }
        }

        if (newOwner)
            this._addPlayer(name);
    }
}

GObject.registerClass({
    Signals: {
        'player-added': { param_types: [Player] },
        'player-removed': { param_types: [Player] },
    },
}, Source);

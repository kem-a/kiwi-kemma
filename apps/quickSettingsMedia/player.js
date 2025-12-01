// SPDX-License-Identifier: GPL-3.0-or-later
// Kiwi Extension - Quick Settings Media playback widget helpers

import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

export const MPRIS_PLAYER_PREFIX = 'org.mpris.MediaPlayer2.';

const MEDIA_DBUS_XML = `<?xml version="1.0"?>
<node>
    <interface name="org.freedesktop.DBus.Properties">
        <method name="Get">
            <arg type="s" name="interface_name" direction="in"/>
            <arg type="s" name="property_name" direction="in"/>
            <arg type="v" name="value" direction="out"/>
        </method>
    </interface>
    <interface name="org.mpris.MediaPlayer2.Player">
        <method name="SetPosition">
            <arg type="o" name="TrackId" direction="in"/>
            <arg type="x" name="Position" direction="in"/>
        </method>
        <method name="PlayPause"/>
        <method name="Next"/>
        <method name="Previous"/>
        <property name="CanGoNext" type="b" access="read"/>
        <property name="CanGoPrevious" type="b" access="read"/>
        <property name="CanPlay" type="b" access="read"/>
        <property name="CanSeek" type="b" access="read"/>
        <property name="Metadata" type="a{sv}" access="read"/>
        <property name="PlaybackStatus" type="s" access="read"/>
    </interface>
    <interface name="org.mpris.MediaPlayer2">
        <method name="Raise"/>
        <property name="CanRaise" type="b" access="read"/>
        <property name="DesktopEntry" type="s" access="read"/>
        <property name="Identity" type="s" access="read"/>
    </interface>
</node>`;

const MEDIA_NODE_INFO = Gio.DBusNodeInfo.new_for_xml(MEDIA_DBUS_XML);

function _lookupInterface(name) {
    return MEDIA_NODE_INFO.interfaces.find(iface => iface.name === name);
}

const PROPERTIES_IFACE_NAME = 'org.freedesktop.DBus.Properties';
const PLAYER_IFACE_NAME = 'org.mpris.MediaPlayer2.Player';
const MPRIS_IFACE_NAME = 'org.mpris.MediaPlayer2';

export class Player extends GObject.Object {
    constructor(busName, gettext) {
        super();
        this._busName = busName;
        this._gettext = typeof gettext === 'function' ? gettext : (message) => message;
        this.source = new MessageList.Source();
        this._canPlay = false;
        this._canSeek = false;
        this._destroyed = false;
        this._mprisProxy = null;
        this._playerProxy = null;
        this._propertiesProxy = null;

        const mprisIface = _lookupInterface(MPRIS_IFACE_NAME);
        const playerIface = _lookupInterface(PLAYER_IFACE_NAME);
        const propertiesIface = _lookupInterface(PROPERTIES_IFACE_NAME);

        const mprisPromise = mprisIface ? Gio.DBusProxy.new(
            Gio.DBus.session,
            Gio.DBusProxyFlags.NONE,
            mprisIface,
            busName,
            '/org/mpris/MediaPlayer2',
            mprisIface.name,
            null
        )
            .then(proxy => this._mprisProxy = proxy)
            .catch(() => {}) : Promise.resolve();

        const playerPromise = playerIface ? Gio.DBusProxy.new(
            Gio.DBus.session,
            Gio.DBusProxyFlags.NONE,
            playerIface,
            busName,
            '/org/mpris/MediaPlayer2',
            playerIface.name,
            null
        )
            .then(proxy => this._playerProxy = proxy)
            .catch(() => {}) : Promise.resolve();

        let propertiesPromise = Promise.resolve();
        if (propertiesIface) {
            propertiesPromise = Gio.DBusProxy.new(
                Gio.DBus.session,
                Gio.DBusProxyFlags.NONE,
                propertiesIface,
                busName,
                '/org/mpris/MediaPlayer2',
                propertiesIface.name,
                null
            )
                .then(proxy => this._propertiesProxy = proxy)
                .catch(() => {});
        } else {
            this._propertiesProxy = null;
        }

        Promise.all([playerPromise, propertiesPromise, mprisPromise])
            .then(this._ready.bind(this))
            .catch(() => {});
    }

    get position() {
        return this._propertiesProxy?.GetAsync('org.mpris.MediaPlayer2.Player', 'Position')
            .then(result => result[0].get_int64())
            .catch(() => null);
    }

    set position(value) {
        this._playerProxy?.SetPositionAsync(this._trackId, Math.min(this._length, Math.max(1, value))).catch(() => {});
    }

    get busName() { return this._busName; }
    get trackId() { return this._trackId; }
    get length() { return this._length; }
    get trackArtists() { return this._trackArtists; }
    get trackTitle() { return this._trackTitle; }
    get trackCoverUrl() { return this._trackCoverUrl; }
    get app() { return this._app; }
    get canGoNext() { return this._playerProxy?.CanGoNext; }
    get canGoPrevious() { return this._playerProxy?.CanGoPrevious; }
    get status() { return this._playerProxy?.PlaybackStatus; }
    get canPlay() { return this._canPlay; }
    get canSeek() { return this._canSeek; }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._close();
        try {
            this.source?.destroy?.();
        } catch (error) {
            logError(error, '[kiwi] Failed to destroy MessageList source for media player');
        }
    }

    _parseMetadata(metadata) {
        if (!metadata) {
            this._trackId = null;
            this._length = null;
            this._trackArtists = null;
            this._trackTitle = null;
            this._trackCoverUrl = null;
            return;
        }
        this._trackId = metadata['mpris:trackid']?.deepUnpack();
        this._length = metadata['mpris:length']?.deepUnpack();

        this._trackArtists = metadata['xesam:artist']?.deepUnpack();
        if (typeof this._trackArtists === 'string') {
            this._trackArtists = [this._trackArtists];
        } else if (!Array.isArray(this._trackArtists) || !this._trackArtists.every(artist => typeof artist === 'string')) {
            this._trackArtists = [this._gettext('Unknown artist')];
        }

        this._trackTitle = metadata['xesam:title']?.deepUnpack();
        if (typeof this._trackTitle !== 'string')
            this._trackTitle = this._gettext('Unknown title');

        this._trackCoverUrl = metadata['mpris:artUrl']?.deepUnpack();
        if (typeof this._trackCoverUrl !== 'string')
            this._trackCoverUrl = null;

        if (this._mprisProxy?.DesktopEntry) {
            this._app = Shell.AppSystem.get_default().lookup_app(this._mprisProxy.DesktopEntry + '.desktop');
        } else {
            this._app = null;
        }

        this.source.set({
            title: this._app?.get_name() ?? this._mprisProxy?.Identity,
            icon: this._app?.get_icon() ?? null,
        });

        this._setCanPlay(!!this._playerProxy?.CanPlay);
        this._setCanSeek(!!this._playerProxy?.CanSeek);
    }

    _update() {
        try {
            const metadata = this._playerProxy?.Metadata;
            this._parseMetadata(metadata);
        } catch {}
        this.emit('changed');
    }

    previous() { this._playerProxy?.PreviousAsync().catch(() => {}); }
    next() { this._playerProxy?.NextAsync().catch(() => {}); }
    playPause() { this._playerProxy?.PlayPauseAsync().catch(() => {}); }

    raise() {
        if (this._app) {
            this._app.activate();
        } else if (this._mprisProxy?.CanRaise) {
            this._mprisProxy.RaiseAsync().catch(() => {});
        }
    }

    isPlaying() { return this.status === 'Playing'; }

    _ready() {
        if (!this._mprisProxy || !this._playerProxy)
            return;

        const mprisProxy = this._mprisProxy;
        mprisProxy.connectObject('notify::g-name-owner', () => {
            if (!this._mprisProxy?.g_name_owner)
                this._close();
        }, this);

        if (!mprisProxy.g_name_owner)
            this._close();

        this._playerProxy.connectObject('g-properties-changed', this._update.bind(this), this);
        this._update();
    }

    _close() {
        this._mprisProxy?.disconnectObject(this);
        this._playerProxy?.disconnectObject(this);
        this._mprisProxy = null;
        this._playerProxy = null;
        this._propertiesProxy = null;
        this._setCanPlay(false);
        this._setCanSeek(false);
    }

    _setCanPlay(value) {
        if (this._canPlay === value)
            return;
        this._canPlay = value;
        this.notify('can-play');
    }

    _setCanSeek(value) {
        if (this._canSeek === value)
            return;
        this._canSeek = value;
        this.notify('can-seek');
    }
}

GObject.registerClass({
    Signals: {
        'changed': { param_types: [] },
    },
    Properties: {
        'can-play': GObject.ParamSpec.boolean('can-play', 'can-play', 'Whether the player can play', GObject.ParamFlags.READABLE, false),
        'can-seek': GObject.ParamSpec.boolean('can-seek', 'can-seek', 'Whether the player can seek', GObject.ParamFlags.READABLE, false),
    },
}, Player);

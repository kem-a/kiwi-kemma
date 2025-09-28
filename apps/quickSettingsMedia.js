// SPDX-License-Identifier: GPL-3.0-or-later
// Kiwi Extension - Quick Settings Media

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import { loadInterfaceXML } from 'resource:///org/gnome/shell/misc/fileUtils.js';
import { PageIndicators } from 'resource:///org/gnome/shell/ui/pageIndicators.js';

// State holders
let enabled = false;
let mediaWidget = null;
let quickSettingsGrid = null;
let _initTimeoutId = null;

// Get QuickSettings grid
function getQuickSettingsGrid() {
    if (!quickSettingsGrid) {
        const quickSettings = Main.panel.statusArea.quickSettings;
        if (quickSettings && quickSettings.menu)
            quickSettingsGrid = quickSettings.menu._grid;
    }
    return quickSettingsGrid;
}

// #region Media Classes (moved from notifications module)
const DBusIface = loadInterfaceXML('org.freedesktop.DBus');
const DBusProxy = Gio.DBusProxy.makeProxyWrapper(DBusIface);
const MPRIS_PLAYER_PREFIX = 'org.mpris.MediaPlayer2.';

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

const PROPERTIES_IFACE = _lookupInterface('org.freedesktop.DBus.Properties');
const PLAYER_IFACE = _lookupInterface('org.mpris.MediaPlayer2.Player');
const MPRIS_IFACE = _lookupInterface('org.mpris.MediaPlayer2');

class Player extends GObject.Object {
    constructor(busName) {
        super();
        this._busName = busName;
        this.source = new MessageList.Source();
        this._canPlay = false;
        this._canSeek = false;

        const mprisPromise = Gio.DBusProxy.new(Gio.DBus.session, Gio.DBusProxyFlags.NONE, MPRIS_IFACE, busName, '/org/mpris/MediaPlayer2', MPRIS_IFACE.name, null)
            .then(proxy => this._mprisProxy = proxy)
            .catch(() => {});

        const playerPromise = Gio.DBusProxy.new(Gio.DBus.session, Gio.DBusProxyFlags.NONE, PLAYER_IFACE, busName, '/org/mpris/MediaPlayer2', PLAYER_IFACE.name, null)
            .then(proxy => this._playerProxy = proxy)
            .catch(() => {});

        let propertiesPromise = Promise.resolve();
        if (PROPERTIES_IFACE) {
            propertiesPromise = Gio.DBusProxy.new(Gio.DBus.session, Gio.DBusProxyFlags.NONE, PROPERTIES_IFACE, busName, '/org/mpris/MediaPlayer2', PROPERTIES_IFACE.name, null)
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
            this._trackArtists = ['Unknown artist'];
        }

        this._trackTitle = metadata['xesam:title']?.deepUnpack();
        if (typeof this._trackTitle !== 'string') {
            this._trackTitle = 'Unknown title';
        }

        this._trackCoverUrl = metadata['mpris:artUrl']?.deepUnpack();
        if (typeof this._trackCoverUrl !== 'string') {
            this._trackCoverUrl = null;
        }

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
        this._mprisProxy?.connectObject('notify::g-name-owner', () => {
            if (!this._mprisProxy.g_name_owner) this._close();
        });
        if (!this._mprisProxy.g_name_owner) this._close();

        this._playerProxy?.connectObject('g-properties-changed', this._update.bind(this));
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

class MediaItem extends MessageList.Message {
    constructor(player) {
        super(player.source);
        this.add_style_class_name('media-message');
        this._player = player;
        this._destroyed = false;
        this.connect('destroy', () => {
            this._destroyed = true;
            this._player?.disconnectObject(this);
        });

        this._createControlButtons();
        this._player.connectObject('changed', this._update.bind(this), this);
        this._update();
    }

    _createControlButtons() {
        if (!this._prevButton)
            this._prevButton = this.addMediaControl('media-skip-backward-symbolic', () => this._player.previous());

        if (!this._pauseButton)
            this._pauseButton = this.addMediaControl('', () => this._player.playPause());

        if (!this._nextButton)
            this._nextButton = this.addMediaControl('media-skip-forward-symbolic', () => this._player.next());
    }

    _update() {
        if (this._destroyed)
            return;

        let icon;
        if (this._player.trackCoverUrl) {
            const file = Gio.File.new_for_uri(this._player.trackCoverUrl);
            icon = new Gio.FileIcon({ file });
        } else {
            icon = new Gio.ThemedIcon({ name: 'audio-x-generic-symbolic' });
        }

        const trackArtists = this._player.trackArtists?.join(', ') ?? '';

        this.set({ title: this._player.trackTitle, body: trackArtists, icon });

        if (this._pauseButton) {
            const isPlaying = this._player.status === 'Playing';
            this._pauseButton.child.icon_name = isPlaying ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        }

        if (this._prevButton)
            this._prevButton.reactive = !!this._player.canGoPrevious;
        if (this._nextButton)
            this._nextButton.reactive = !!this._player.canGoNext;
    }

    vfunc_button_press_event() { return Clutter.EVENT_PROPAGATE; }
    vfunc_button_release_event() { return Clutter.EVENT_PROPAGATE; }
    vfunc_motion_event() { return Clutter.EVENT_PROPAGATE; }
    vfunc_touch_event() { return Clutter.EVENT_PROPAGATE; }
}
GObject.registerClass(MediaItem);

class MediaList extends St.BoxLayout {
    constructor() {
        super({ can_focus: true, reactive: true, track_hover: true, hover: false, clip_to_allocation: true });
        this._current = null;
        this._currentMaxPage = 0;
        this._currentPage = 0;
        this._items = new Map();

        this.connect('scroll-event', (_, event) => {
            const direction = event.get_scroll_direction();
            if (direction === Clutter.ScrollDirection.UP) this._seekPage(-1);
            if (direction === Clutter.ScrollDirection.DOWN) this._seekPage(1);
        });

        this._source = new Source();
        this._source.connectObject('player-removed', (_source, player) => {
            const item = this._items.get(player);
            if (!item) return;
            item.destroy();
            this._items.delete(player);
            this._sync();
        });
        this._source.connectObject('player-added', (_source, player) => {
            if (this._items.has(player)) return;
            const item = new MediaItem(player);
            this._items.set(player, item);
            this.add_child(item);
            this._sync();
        });
        this._source.start();
    }

    get _messages() { return this.get_children(); }

    _showFirstPlaying() {
        const messages = this._messages;
        this._setPage(messages.find(message => message?._player.isPlaying()) ?? messages[0]);
    }

    _setPage(to) {
        const current = this._current;
        const messages = this._messages;
        this._current = to;
        if (!to || to == current) return;

        for (const message of messages) {
            if (message == current) continue;
            message.hide();
        }

        const toIndex = messages.findIndex(message => message == to);
        this._currentPage = toIndex;
        this.emit('page-updated', toIndex);

        if (!current) {
            to.show();
            return;
        }

        const currentIndex = messages.findIndex(message => message == current);
        current.ease({
            opacity: 0,
            translationX: (toIndex > currentIndex ? -120 : 120),
            duration: 100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                current.hide();
                to.opacity = 0;
                to.translationX = toIndex > currentIndex ? 120 : -120;
                to.show();
                to.ease({
                    mode: Clutter.AnimationMode.EASE_OUT_EXPO,
                    duration: 280,
                    translationX: 0,
                    opacity: 255,
                    onStopped: () => { to.opacity = 255; to.translationX = 0; }
                });
            },
        });
    }

    _seekPage(offset) {
        const messages = this._messages;
        if (this._current === null) return;
        let currentIndex = messages.findIndex(message => message == this._current);
        if (currentIndex == -1) currentIndex = 0;
        const length = messages.length;
        this._setPage(messages[((currentIndex + offset + length) % length)]);
    }

    _sync() {
        const messages = this._messages;
        const empty = messages.length == 0;

        if (this._currentMaxPage != messages.length)
            this.emit('max-page-updated', this._currentMaxPage = messages.length);

        if (this._current && (empty || !messages.includes(this._current)))
            this._current = null;

        for (const message of messages) {
            if (message == this._current) continue;
            message.hide();
        }

        if (!this._current) this._showFirstPlaying();
        this.empty = empty;
    }
}
GObject.registerClass({
    Signals: {
        'page-updated': { param_types: [GObject.TYPE_INT] },
        'max-page-updated': { param_types: [GObject.TYPE_INT] },
    },
    Properties: {
        'empty': GObject.ParamSpec.boolean('empty', null, null, GObject.ParamFlags.READWRITE, true),
    }
}, MediaList);

class Source extends GObject.Object {
    constructor() { super(); this._players = new Map(); }

    start() {
        this._proxy = new DBusProxy(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus', this._onProxyReady.bind(this));
    }

    get players() { return [...this._players.values()]; }

    _addPlayer(busName) {
        if (this._players.has(busName)) return;
        const player = new Player(busName);
        this._players.set(busName, player);
        player.connectObject('notify::can-play', () => {
            this.emit(player.canPlay ? 'player-added' : 'player-removed', player);
        }, this);
        if (player.canPlay)
            this.emit('player-added', player);
    }

    async _onProxyReady() {
        try {
            const [names] = await this._proxy.ListNamesAsync();
            for (const name of names) {
                if (!name.startsWith(MPRIS_PLAYER_PREFIX)) continue;
                this._addPlayer(name);
            }
            this._proxy.connectSignal('NameOwnerChanged', this._onNameOwnerChanged.bind(this));
        } catch (e) {
            log('Failed to enumerate MPRIS players: ' + e);
        }
    }

    _onNameOwnerChanged(proxy, sender, [name, oldOwner, newOwner]) {
        if (!name.startsWith(MPRIS_PLAYER_PREFIX)) return;
        if (oldOwner) {
            const player = this._players.get(name);
            if (player) {
                this._players.delete(name);
                player.disconnectObject(this);
                this.emit('player-removed', player);
            }
        }
        if (newOwner) this._addPlayer(name);
    }
}
GObject.registerClass({
    Signals: {
        'player-added': { param_types: [Player] },
        'player-removed': { param_types: [Player] },
    },
}, Source);

class MediaHeader extends St.BoxLayout {
    constructor() {
        super({ style_class: 'kiwi-header' });
        this._headerLabel = new St.Label({ text: 'Media', style_class: 'kiwi-header-label', y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.START, x_expand: true });
        this.add_child(this._headerLabel);
        this._pageIndicator = new PageIndicators(Clutter.Orientation.HORIZONTAL);
        this._pageIndicator.x_align = Clutter.ActorAlign.END;
        this._pageIndicator.y_align = Clutter.ActorAlign.CENTER;
        this.add_child(this._pageIndicator);
    }
    set maxPage(maxPage) { this._pageIndicator.setNPages(maxPage); }
    get maxPage() { return this._pageIndicator.nPages; }
    set page(page) { this._pageIndicator.setCurrentPosition(page); }
    get page() { return this._pageIndicator._currentPosition; }
}
GObject.registerClass(MediaHeader);

class MediaWidget extends St.BoxLayout {
    constructor() {
        super({ orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true, reactive: true, style_class: 'kiwi-media' });
        this._header = new MediaHeader();
        this.add_child(this._header);
        this._list = new MediaList();
        this.add_child(this._list);
        this._list.connectObject('notify::empty', this._syncEmpty.bind(this));
        this._syncEmpty();
        this._header.page = this._list.page;
        this._header.maxPage = this._list.maxPage;
        this._list.connectObject('page-updated', (_, page) => { if (this._header.page != page) this._header.page = page; });
        this._list.connectObject('max-page-updated', (_, maxPage) => { if (this._header.maxPage != maxPage) this._header.maxPage = maxPage; });
    }
    _syncEmpty() { this.visible = !this._list.empty; }
}
GObject.registerClass(MediaWidget);
// #endregion Media Classes

export function enable() {
    if (enabled) return;

    _initTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        const grid = getQuickSettingsGrid();
        if (!grid) return GLib.SOURCE_CONTINUE; // Retry if grid not ready

        mediaWidget = new MediaWidget();
        if (grid.insert_child_at_index)
            grid.insert_child_at_index(mediaWidget, 0);
        else
            grid.add_child(mediaWidget);
        grid.layout_manager.child_set_property(grid, mediaWidget, 'column-span', 2);

        enabled = true;
        _initTimeoutId = null;
        return GLib.SOURCE_REMOVE;
    });
}

export function disable() {
    if (!enabled) return;

    if (_initTimeoutId) {
        GLib.Source.remove(_initTimeoutId);
        _initTimeoutId = null;
    }

    const grid = getQuickSettingsGrid();
    if (grid && mediaWidget) {
        grid.remove_child(mediaWidget);
        mediaWidget.destroy();
        mediaWidget = null;
    }

    enabled = false;
}

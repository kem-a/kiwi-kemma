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

class Player extends GObject.Object {
    constructor(busName) {
        super();
        this._busName = busName;
        this.source = new MessageList.Source();

        const mprisIface = loadInterfaceXML('org.mpris.MediaPlayer2');
        const playerIface = loadInterfaceXML('org.mpris.MediaPlayer2.Player');
        const propertiesIface = loadInterfaceXML('org.freedesktop.DBus.Properties');

        const mprisPromise = Gio.DBusProxy.new(Gio.DBus.session, Gio.DBusProxyFlags.NONE, mprisIface, busName, '/org/mpris/MediaPlayer2', mprisIface.name, null)
            .then(proxy => this._mprisProxy = proxy)
            .catch(() => {});

        const playerPromise = Gio.DBusProxy.new(Gio.DBus.session, Gio.DBusProxyFlags.NONE, playerIface, busName, '/org/mpris/MediaPlayer2', playerIface.name, null)
            .then(proxy => this._playerProxy = proxy)
            .catch(() => {});

        const propertiesPromise = Gio.DBusProxy.new(Gio.DBus.session, Gio.DBusProxyFlags.NONE, propertiesIface, busName, '/org/mpris/MediaPlayer2', propertiesIface.name, null)
            .then(proxy => this._propertiesProxy = proxy)
            .catch(() => {});

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

        this.canPlay = !!this._playerProxy?.CanPlay;
        this.canSeek = this._playerProxy?.CanSeek;
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
    }
}
GObject.registerClass(Player);

class MediaItem extends MessageList.Message {
    constructor(player) {
        super(player.source);
        this.add_style_class_name('media-message');
        this._player = player;

        this._createControlButtons();
        this._player.connectObject('changed', this._update.bind(this));
        this._update();
    }

    _createControlButtons() {
        if (this._player.canGoPrevious) this._prevButton = this.addMediaControl('media-skip-backward-symbolic', () => this._player.previous());
        this._pauseButton = this.addMediaControl('', () => this._player.playPause());
        if (this._player.canGoNext) this._nextButton = this.addMediaControl('media-skip-forward-symbolic', () => this._player.next());
    }

    _update() {
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

        if (this._prevButton) this._prevButton.reactive = this._player.canGoPrevious;
        if (this._nextButton) this._nextButton.reactive = this._player.canGoNext;
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
        });
    }

    async _onProxyReady() {
        const [names] = await this._proxy.ListNamesAsync();
        for (const name of names) {
            if (!name.startsWith(MPRIS_PLAYER_PREFIX)) continue;
            this._addPlayer(name);
        }
        this._proxy.connectSignal('NameOwnerChanged', this._onNameOwnerChanged.bind(this));
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

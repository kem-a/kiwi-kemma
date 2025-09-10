import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// State variables
let notificationsWidget = null;
let mediaWidget = null;
let quickSettings = null;
let dateMenu = null;
let notificationSignals = [];
let mediaSignals = [];
let timeoutIds = [];

// Notification Widget
const NotificationWidget = GObject.registerClass(
class NotificationWidget extends St.BoxLayout {
    _init() {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'kiwi-notifications',
            x_expand: true,
            // Remove background by not setting background-color
        });

        // Header with Clear All button
        this._headerBox = new St.BoxLayout({
            style_class: 'kiwi-notifications-header-box',
            x_expand: true,
        });

        this._headerLabel = new St.Label({
            text: _("Notifications"),
            style_class: 'kiwi-notifications-header',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });

        this._clearAllButton = new St.Button({
            style_class: 'kiwi-clear-all-button button',
            label: _("clear"),
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
        });

        this._headerBox.add_child(this._headerLabel);
        this._headerBox.add_child(this._clearAllButton);

        this._list = new MessageList.MessageView();
        this._scroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            child: this._list,
            // Remove padding from scroll view and hide scrollbar
            style: 'padding: 0;',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.NEVER,
        });

        // Remove right padding from the notification list
        this._list.style = 'padding-right: 0; margin-right: 0;';

        this._placeholder = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'kiwi-notifications-placeholder',
            x_align: Clutter.ActorAlign.CENTER,
            opacity: 60,
            x_expand: true,
            // Remove padding from placeholder
            style: 'padding: 0;',
        });

        this._placeholderIcon = new St.Icon({
            style_class: 'kiwi-notifications-icon',
            icon_name: 'no-notifications-symbolic'
        });

        this._placeholderLabel = new St.Label({
            text: _("No Notifications")
        });

        this._placeholder.add_child(this._placeholderIcon);
        this._placeholder.add_child(this._placeholderLabel);

        this.add_child(this._headerBox);
        this.add_child(this._scroll);
        this.add_child(this._placeholder);

        // Connect clear all button
        this._clearAllButton.connect('clicked', this.clear.bind(this));

        this._list.connect('notify::empty', this._syncVisibility.bind(this));
        this._list.connect('notify::can-clear', this._syncClearButton.bind(this));
        this._syncVisibility();
        this._syncClearButton();
    }

    _syncVisibility() {
        const empty = this._list.empty;
        this._scroll.visible = !empty;
        this._placeholder.visible = empty;
        // Hide clear all button when empty
        this._clearAllButton.visible = !empty && this._list.canClear;
    }

    _syncClearButton() {
        const canClear = this._list.canClear;
        this._clearAllButton.visible = canClear;
        this._clearAllButton.reactive = canClear;
        this._clearAllButton.can_focus = canClear;
    }

    clear() {
        this._list.clear();
    }

    get empty() {
        return this._list.empty;
    }
});

// MPRIS Player class
class MprisPlayer {
    constructor(busName, mediaWidget) {
        this._busName = busName;
        this._mediaWidget = mediaWidget;
        this._active = false;
        this._controls = null;

        try {
            this._createProxies();
        } catch (e) {
            console.error('Failed to initialize MPRIS player for', busName, ':', e);
            // Mark as failed so the media widget knows not to use this player
            this._playerProxy = null;
            this._mprisProxy = null;
            throw e;
        }
    }

    _createProxies() {
        try {
            // Create MPRIS interface proxy with timeout
            this._mprisProxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                this._busName,
                '/org/mpris/MediaPlayer2',
                'org.mpris.MediaPlayer2',
                null
            );

            // Create Player interface proxy with timeout
            this._playerProxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                this._busName,
                '/org/mpris/MediaPlayer2',
                'org.mpris.MediaPlayer2.Player',
                null
            );

            // Connect to property changes
            if (this._playerProxy) {
                this._playerProxy.connect('g-properties-changed', this._onPropertiesChanged.bind(this));
            }
            if (this._mprisProxy) {
                this._mprisProxy.connect('g-properties-changed', this._onPropertiesChanged.bind(this));
            }

            // Initial update
            this._updateState();
        } catch (e) {
            console.error('Failed to create MPRIS proxies for', this._busName, ':', e);
            // Mark proxies as null so we know they failed
            this._mprisProxy = null;
            this._playerProxy = null;
            throw e; // Re-throw to indicate failure
        }
    }

    _onPropertiesChanged(proxy, changed, invalidated) {
        this._updateState();
        this._mediaWidget._updateCurrentPlayer();
    }

    _updateState() {
        try {
            if (!this._playerProxy) return;

            this._playbackStatus = this._playerProxy.PlaybackStatus || 'Stopped';
            this._metadata = this._playerProxy.Metadata || {};
            this._canPlay = this._playerProxy.CanPlay || false;
            this._canPause = this._playerProxy.CanPause || false;
            this._canGoNext = this._playerProxy.CanGoNext || false;
            this._canGoPrevious = this._playerProxy.CanGoPrevious || false;
        } catch (e) {
            console.error('Failed to update MPRIS player state:', e);
            this._playbackStatus = 'Stopped';
            this._metadata = {};
            this._canPlay = false;
            this._canPause = false;
            this._canGoNext = false;
            this._canGoPrevious = false;
        }
    }

    getPriority() {
        if (!this._playbackStatus) return 0;

        switch (this._playbackStatus) {
            case 'Playing': return 3;
            case 'Paused': return 2;
            case 'Stopped': return 1;
            default: return 0;
        }
    }

    isActive() {
        return this._playbackStatus === 'Playing' || this._playbackStatus === 'Paused';
    }

    activate() {
        if (this._active) return;

        this._active = true;
        this._createControls();
    }

    deactivate() {
        if (!this._active) return;

        this._active = false;
        if (this._controls) {
            this._mediaWidget._mediaBox.remove_child(this._controls);
            this._controls.destroy();
            this._controls = null;
        }
    }

    _createControls() {
        this._controls = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'kiwi-media-controls',
            x_expand: true,
        });

        // Track info
        const trackBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'kiwi-media-track-info',
            x_expand: true,
        });

        const title = this._metadata['xesam:title'] || _('Unknown Title');
        const artist = this._metadata['xesam:artist'] ? this._metadata['xesam:artist'][0] : _('Unknown Artist');

        const titleLabel = new St.Label({
            text: title,
            style_class: 'kiwi-media-title',
            x_align: Clutter.ActorAlign.START,
        });

        const artistLabel = new St.Label({
            text: artist,
            style_class: 'kiwi-media-artist',
            x_align: Clutter.ActorAlign.START,
        });

        trackBox.add_child(titleLabel);
        trackBox.add_child(artistLabel);

        // Control buttons
        const buttonsBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'kiwi-media-buttons',
            x_align: Clutter.ActorAlign.CENTER,
        });

        const prevButton = new St.Button({
            style_class: 'kiwi-media-button button',
            child: new St.Icon({ icon_name: 'media-skip-backward-symbolic' }),
            can_focus: true,
        });

        const playPauseButton = new St.Button({
            style_class: 'kiwi-media-button button',
            child: new St.Icon({
                icon_name: this._playbackStatus === 'Playing' ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic'
            }),
            can_focus: true,
        });

        const nextButton = new St.Button({
            style_class: 'kiwi-media-button button',
            child: new St.Icon({ icon_name: 'media-skip-forward-symbolic' }),
            can_focus: true,
        });

        // Connect button signals
        if (this._canGoPrevious) {
            prevButton.connect('clicked', () => {
                this._playerProxy.PreviousRemote();
            });
        } else {
            prevButton.opacity = 128;
        }

        if (this._canPlay || this._canPause) {
            playPauseButton.connect('clicked', () => {
                if (this._playbackStatus === 'Playing') {
                    this._playerProxy.PauseRemote();
                } else {
                    this._playerProxy.PlayRemote();
                }
            });
        } else {
            playPauseButton.opacity = 128;
        }

        if (this._canGoNext) {
            nextButton.connect('clicked', () => {
                this._playerProxy.NextRemote();
            });
        } else {
            nextButton.opacity = 128;
        }

        buttonsBox.add_child(prevButton);
        buttonsBox.add_child(playPauseButton);
        buttonsBox.add_child(nextButton);

        this._controls.add_child(trackBox);
        this._controls.add_child(buttonsBox);

        this._mediaWidget._mediaBox.add_child(this._controls);
    }

    isValid() {
        return this._playerProxy !== null && this._mprisProxy !== null;
    }

    destroy() {
        this.deactivate();

        if (this._playerProxy) {
            this._playerProxy = null;
        }

        if (this._mprisProxy) {
            this._mprisProxy = null;
        }
    }
}

// Media Widget
const MediaWidget = GObject.registerClass(
class MediaWidget extends St.BoxLayout {
    _init() {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'kiwi-media',
            x_expand: true,
            // Remove background by not setting background-color
            // Remove padding
            style: 'padding: 0;',
        });

        this._header = new St.Label({
            text: _("Media"),
            style_class: 'kiwi-media-header',
            x_align: Clutter.ActorAlign.START,
            // Remove padding from header
            style: 'padding: 0; margin-bottom: 8px;',
        });

        this._mediaBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'kiwi-media-box',
            x_expand: true,
        });

        this._placeholder = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'kiwi-media-placeholder',
            x_align: Clutter.ActorAlign.CENTER,
            opacity: 60,
            x_expand: true,
            // Remove padding from placeholder
            style: 'padding: 0;',
        });

        this._placeholderIcon = new St.Icon({
            style_class: 'kiwi-media-icon',
            icon_name: 'audio-x-generic-symbolic'
        });

        this._placeholderLabel = new St.Label({
            text: _("No Media Playing")
        });

        this._placeholder.add_child(this._placeholderIcon);
        this._placeholder.add_child(this._placeholderLabel);

        this._mediaBox.add_child(this._placeholder);

        this.add_child(this._header);
        this.add_child(this._mediaBox);

        this._players = new Map();
        this._currentPlayer = null;

        this._syncVisibility();
        this._connectToMpris();
    }

    _connectToMpris() {
        try {
            // Connect to MPRIS media players
            this._mprisWatchId = Gio.bus_watch_name(
                Gio.BusType.SESSION,
                'org.freedesktop.DBus',
                Gio.BusNameWatcherFlags.NONE,
                this._onMprisAppeared.bind(this),
                this._onMprisVanished.bind(this)
            );

            // Get existing MPRIS players
            this._getExistingMprisPlayers();
        } catch (e) {
            console.error('Failed to connect to MPRIS:', e);
            // Continue without MPRIS support
        }
    }

    _onMprisAppeared(connection, name) {
        if (!name.startsWith('org.mpris.MediaPlayer2.')) return;

        this._createPlayerProxy(name);
    }

    _onMprisVanished(connection, name) {
        if (!name.startsWith('org.mpris.MediaPlayer2.')) return;

        if (this._players.has(name)) {
            const player = this._players.get(name);
            player.destroy();
            this._players.delete(name);
        }

        this._updateCurrentPlayer();
    }

    _getExistingMprisPlayers() {
        try {
            Gio.DBus.session.call(
                'org.freedesktop.DBus',
                '/org/freedesktop/DBus',
                'org.freedesktop.DBus',
                'ListNames',
                null,
                GLib.VariantType.new('(as)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (connection, result) => {
                    try {
                        const variant = connection.call_finish(result);
                        const [names] = variant.unpack();
                        if (Array.isArray(names)) {
                            names.forEach(name => {
                                if (name.startsWith('org.mpris.MediaPlayer2.')) {
                                    this._createPlayerProxy(name);
                                }
                            });
                        }
                    } catch (e) {
                        console.error('Failed to get MPRIS players:', e);
                    }
                }
            );
        } catch (e) {
            console.error('Failed to initiate MPRIS player discovery:', e);
        }
    }

    _createPlayerProxy(busName) {
        if (this._players.has(busName)) return;

        try {
            const player = new MprisPlayer(busName, this);
            // Only keep valid players
            if (player.isValid()) {
                this._players.set(busName, player);
                this._updateCurrentPlayer();
            } else {
                // Clean up invalid player
                player.destroy();
            }
        } catch (e) {
            console.error('Failed to create MPRIS player proxy for', busName, ':', e);
            // Player creation failed, don't add to map
        }
    }

    _updateCurrentPlayer() {
        // Find the player with the highest priority (playing > paused > stopped)
        let bestPlayer = null;
        let bestPriority = -1;

        for (const player of this._players.values()) {
            if (!player.isValid()) continue;

            const priority = player.getPriority();
            if (priority > bestPriority) {
                bestPriority = priority;
                bestPlayer = player;
            }
        }

        if (this._currentPlayer !== bestPlayer) {
            if (this._currentPlayer) {
                this._currentPlayer.deactivate();
            }

            this._currentPlayer = bestPlayer;

            if (this._currentPlayer) {
                this._currentPlayer.activate();
            }
        }

        this._syncVisibility();
    }

    _syncVisibility() {
        const hasMedia = this._currentPlayer && this._currentPlayer.isActive();
        this._placeholder.visible = !hasMedia;
        this._mediaBox.visible = hasMedia;

        // Hide the entire media widget if no media is playing
        this.visible = hasMedia;
    }

    destroy() {
        if (this._mprisWatchId) {
            try {
                Gio.bus_unwatch_name(this._mprisWatchId);
            } catch (e) {
                console.error('Failed to unwatch MPRIS bus name:', e);
            }
            this._mprisWatchId = null;
        }

        for (const player of this._players.values()) {
            try {
                player.destroy();
            } catch (e) {
                console.error('Failed to destroy MPRIS player:', e);
            }
        }
        this._players.clear();

        super.destroy();
    }
});

function setupWidgets() {
    if (!quickSettings) {
        quickSettings = Main.panel.statusArea.quickSettings;
        if (!quickSettings) {
            console.warn('Quick settings not available');
            return;
        }
    }

    if (!dateMenu) {
        dateMenu = Main.panel.statusArea.dateMenu;
        if (!dateMenu) {
            console.warn('Date menu not available');
            return;
        }
    }

    // Check if grid is available
    if (!quickSettings.menu._grid) {
        console.warn('Quick settings grid not available');
        return;
    }

    // Create notification widget
    if (!notificationsWidget) {
        try {
            notificationsWidget = new NotificationWidget();
            // Set max width to match quick settings popup width
            notificationsWidget.style = 'max-width: 320px; padding: 0;';
            quickSettings.menu._grid.add_child(notificationsWidget);
            quickSettings.menu._grid.layout_manager.child_set_property(
                quickSettings.menu._grid, notificationsWidget, "column-span", 2
            );
        } catch (e) {
            console.error('Failed to create notification widget:', e);
            return;
        }
    }

    // Create media widget
    if (!mediaWidget) {
        try {
            mediaWidget = new MediaWidget();
            // Set max width to match quick settings popup width
            mediaWidget.style = 'max-width: 320px; padding: 0;';
            // Initially hide the media widget until media is detected
            mediaWidget.visible = false;
            quickSettings.menu._grid.add_child(mediaWidget);
            quickSettings.menu._grid.layout_manager.child_set_property(
                quickSettings.menu._grid, mediaWidget, "column-span", 2
            );
        } catch (e) {
            console.error('Failed to create media widget:', e);
            return;
        }
    }

    // Connect to notification signals
    connectNotificationSignals();

    // Connect to media signals (simplified)
    connectMediaSignals();
}

function cleanupWidgets() {
    // Disconnect signals
    notificationSignals.forEach(signal => {
        try {
            if (signal.obj && signal.id) {
                // Check if object is still valid before disconnecting
                try {
                    signal.obj.disconnect(signal.id);
                } catch (e) {
                    // Object may have been disposed, ignore
                }
            }
        } catch (e) {
            // Signal may already be disconnected
        }
    });
    notificationSignals = [];

    mediaSignals.forEach(signal => {
        try {
            if (signal.obj && signal.id) {
                // Check if object is still valid before disconnecting
                try {
                    signal.obj.disconnect(signal.id);
                } catch (e) {
                    // Object may have been disposed, ignore
                }
            }
        } catch (e) {
            // Signal may already be disconnected
        }
    });
    mediaSignals = [];

    // Clear timeouts
    timeoutIds.forEach(id => {
        try {
            GLib.source_remove(id);
        } catch (e) {
            // Timeout may already be removed
        }
    });
    timeoutIds = [];

    // Remove widgets
    if (notificationsWidget && quickSettings && quickSettings.menu._grid) {
        try {
            quickSettings.menu._grid.remove_child(notificationsWidget);
            notificationsWidget.destroy();
        } catch (e) {
            console.error('Failed to remove notification widget:', e);
        }
        notificationsWidget = null;
    }

    if (mediaWidget && quickSettings && quickSettings.menu._grid) {
        try {
            quickSettings.menu._grid.remove_child(mediaWidget);
            mediaWidget.destroy();
        } catch (e) {
            console.error('Failed to remove media widget:', e);
        }
        mediaWidget = null;
    }

    quickSettings = null;
    dateMenu = null;
}

function connectNotificationSignals() {
    if (!Main.messageTray) return;

    // Monitor message tray sources
    const sourceAddedId = Main.messageTray.connect('source-added', () => {
        updateNotificationVisibility();
    });
    notificationSignals.push({ obj: Main.messageTray, id: sourceAddedId });

    const sourceRemovedId = Main.messageTray.connect('source-removed', () => {
        updateNotificationVisibility();
    });
    notificationSignals.push({ obj: Main.messageTray, id: sourceRemovedId });

    // Connect to existing sources
    if (Main.messageTray._sources) {
        for (let source of Main.messageTray._sources.values()) {
            try {
                const notificationAddedId = source.connect('notification-added', () => {
                    updateNotificationVisibility();
                });
                notificationSignals.push({ obj: source, id: notificationAddedId });

                const notificationRemovedId = source.connect('notification-removed', () => {
                    updateNotificationVisibility();
                });
                notificationSignals.push({ obj: source, id: notificationRemovedId });
            } catch (e) {
                // Source may be disposed, skip it
                console.warn('Failed to connect to notification source:', e);
            }
        }
    }

    // Periodic check
    const checkInterval = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
        updateNotificationVisibility();
        return GLib.SOURCE_CONTINUE;
    });
    timeoutIds.push(checkInterval);
}

function connectMediaSignals() {
    // Media widget now handles MPRIS connections internally
    // No additional signal connections needed at module level
}

function updateNotificationVisibility() {
    if (!notificationsWidget) return;

    const hasNotifications = checkForNotifications();
    notificationsWidget.visible = hasNotifications;
    // Also hide the widget if it's empty
    if (notificationsWidget.empty) {
        notificationsWidget.visible = false;
    }
}

function updateMediaVisibility() {
    if (!mediaWidget) return;

    // Media widget now handles its own visibility based on active MPRIS players
    // The widget will show/hide its content automatically
}

function checkForNotifications() {
    if (!Main.messageTray || !Main.messageTray._sources) return false;

    try {
        for (let source of Main.messageTray._sources.values()) {
            if (source && source.notifications && source.notifications.length > 0) {
                const activeNotifications = source.notifications.filter(notification => {
                    return notification && !notification.destroyed && !notification.isDestroyed;
                });

                if (activeNotifications.length > 0) {
                    return true;
                }
            }
        }
    } catch (e) {
        // Sources may be disposed during shutdown
        console.warn('Error checking notifications:', e);
        return false;
    }

    return false;
}

export function enable() {
    setupWidgets();
}

export function disable() {
    cleanupWidgets();
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Kiwi Extension - Quick Settings Media playback widget

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import { PageIndicators } from 'resource:///org/gnome/shell/ui/pageIndicators.js';

import { MediaItem } from './quickSettingsMedia/mediaItem.js';
import { Source } from './quickSettingsMedia/source.js';

const SCROLL_LOCK_TIMEOUT_MS = 320;
const SMOOTH_SCROLL_THRESHOLD = 1.5;

// State holders
let enabled = false;
let mediaWidget = null;
let quickSettingsGrid = null;
let _initTimeoutId = null;
let mediaIndicator = null;
let gettextFunc = (message) => message;

// Get QuickSettings grid
function getQuickSettingsGrid() {
    if (!quickSettingsGrid) {
        const quickSettings = Main.panel.statusArea.quickSettings;
        if (quickSettings && quickSettings.menu)
            quickSettingsGrid = quickSettings.menu._grid;
    }
    return quickSettingsGrid;
}

function ensureMediaIndicator() {
    if (mediaIndicator)
        return mediaIndicator;

    const quickSettings = Main.panel.statusArea.quickSettings;
    if (!quickSettings || !quickSettings._indicators)
        return null;

    const indicator = new St.Icon({
        icon_name: 'media-playback-start-symbolic',
        style_class: 'system-status-icon kiwi-media-indicator',
        visible: false,
    });

    const container = quickSettings._indicators;
    if (indicator.get_parent())
        indicator.get_parent().remove_child(indicator);
    container.insert_child_at_index(indicator, 0);

    mediaIndicator = indicator;
    return mediaIndicator;
}

function updateMediaIndicator({ hasPlayers, isPlaying }) {
    if (!hasPlayers) {
        if (mediaIndicator)
            mediaIndicator.visible = false;
        return;
    }

    const indicator = ensureMediaIndicator();
    if (!indicator)
        return;

    indicator.visible = true;
    indicator.icon_name = isPlaying ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic';
}

function destroyMediaIndicator() {
    if (mediaIndicator) {
        const parent = mediaIndicator.get_parent();
        if (parent)
            parent.remove_child(mediaIndicator);
        mediaIndicator.destroy();
        mediaIndicator = null;
    }
}

// #region Media Classes
// Player, Source, and MediaItem helpers are provided by modules in apps/quickSettingsMedia.

class MediaList extends St.BoxLayout {
    constructor() {
        super({ can_focus: true, reactive: true, track_hover: true, hover: false, clip_to_allocation: true });
        this._current = null;
        this._currentMaxPage = 0;
        this._currentPage = 0;
        this._items = new Map();
        this._scrollLocked = false;
        this._scrollUnlockId = null;
        this._destroyed = false;
        this._hasActivePlayback = false;
    this._playerCount = 0;

        this.connect('scroll-event', this._onScrollEvent.bind(this));
        this.connect('destroy', this._onDestroy.bind(this));

        this._source = new Source(gettextFunc);
        this._source.connectObject('player-removed', (_source, player) => {
            if (this._destroyed)
                return;
            const item = this._items.get(player);
            if (!item)
                return;
            this._items.delete(player);
            this.remove_child(item);
            item.destroy();
            player.disconnectObject(this);
            this._sync();
        }, this);
        this._source.connectObject('player-added', (_source, player) => {
            if (this._destroyed || this._items.has(player))
                return;
            const item = new MediaItem(player);
            this._items.set(player, item);
            this.add_child(item);
            player.connectObject('changed', () => this._updatePlaybackState(), this);
            this._sync();
        }, this);
        this._source.start();
    }

    get _messages() {
        return this.get_children();
    }

    get page() {
        return this._currentPage;
    }

    get maxPage() {
        return this._currentMaxPage;
    }

    get playerCount() {
        return this._playerCount;
    }

    _onScrollEvent(_actor, event) {
        if (this.empty || this._scrollLocked || this._currentMaxPage <= 1)
            return Clutter.EVENT_PROPAGATE;

        let offset = 0;
        const direction = event.get_scroll_direction();

        if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            if (!Number.isFinite(dx) || Math.abs(dx) < Math.abs(dy) || Math.abs(dx) < SMOOTH_SCROLL_THRESHOLD)
                return Clutter.EVENT_PROPAGATE;
            offset = dx > 0 ? 1 : -1;
        } else if (direction === Clutter.ScrollDirection.LEFT) {
            offset = -1;
        } else if (direction === Clutter.ScrollDirection.RIGHT) {
            offset = 1;
        } else {
            return Clutter.EVENT_PROPAGATE;
        }

        if (offset === 0)
            return Clutter.EVENT_PROPAGATE;

        if (!this._seekPage(offset))
            return Clutter.EVENT_STOP;

        this._lockScroll();

        return Clutter.EVENT_STOP;
    }

    _lockScroll() {
        this._scrollLocked = true;
        if (this._scrollUnlockId) {
            GLib.Source.remove(this._scrollUnlockId);
            this._scrollUnlockId = null;
        }

        this._scrollUnlockId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SCROLL_LOCK_TIMEOUT_MS, () => {
            this._scrollLocked = false;
            this._scrollUnlockId = null;
            return GLib.SOURCE_REMOVE;
        });
        if (this._scrollUnlockId && GLib.Source.set_name_by_id)
            GLib.Source.set_name_by_id(this._scrollUnlockId, '[kiwi] MediaList scroll unlock');
    }

    _onDestroy() {
        this._destroyed = true;

        if (this._scrollUnlockId) {
            GLib.Source.remove(this._scrollUnlockId);
            this._scrollUnlockId = null;
        }

        if (this._source) {
            this._source.disconnectObject(this);
            this._source.destroy();
            this._source = null;
        }

        for (const item of this._items.values())
            item.destroy();
        this._items.clear();

        this._current = null;
        this._setPlaybackActive(false);
        this._setPlayerCount(0);
    }

    _showFirstPlaying() {
        const messages = this._messages;
        if (!messages.length)
            return;

        const target = messages.find(message => message?._player?.isPlaying()) ?? messages[0];
        if (target)
            this._setPage(target, { animate: false });
    }

    _setPage(to, { animate = true } = {}) {
        if (!to || this._destroyed)
            return false;

        const messages = this._messages;
        const toIndex = messages.indexOf(to);
        if (toIndex === -1)
            return false;

        const previous = this._current;
        const hasPrevious = previous && messages.includes(previous);

        this._current = to;

        for (const message of messages) {
            if (message === to)
                continue;
            message.hide();
        }

        this._currentPage = toIndex;
        this.emit('page-updated', toIndex);

        const shouldAnimate = animate && hasPrevious && previous && previous.get_stage();
        if (!shouldAnimate) {
            to.opacity = 255;
            to.translationX = 0;
            to.show();
            return true;
        }

        const previousIndex = messages.indexOf(previous);
        const exitDirection = toIndex > previousIndex ? -120 : 120;

        previous.ease({
            opacity: 0,
            translationX: exitDirection,
            duration: 100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                previous.hide();
                to.opacity = 0;
                to.translationX = -exitDirection;
                to.show();
                to.ease({
                    mode: Clutter.AnimationMode.EASE_OUT_EXPO,
                    duration: 280,
                    translationX: 0,
                    opacity: 255,
                    onStopped: () => {
                        to.opacity = 255;
                        to.translationX = 0;
                    },
                });
            },
        });
        return true;
    }

    _seekPage(offset) {
        if (!offset)
            return false;

        const messages = this._messages;
        if (!messages.length)
            return false;

        let currentIndex = messages.findIndex(message => message === this._current);
        if (currentIndex === -1)
            currentIndex = 0;

        const targetIndex = Math.max(0, Math.min(currentIndex + offset, messages.length - 1));
        if (targetIndex === currentIndex)
            return false;

        return this._setPage(messages[targetIndex]);
    }

    goToPage(index, { animate = true } = {}) {
        const messages = this._messages;
        if (index < 0 || index >= messages.length)
            return false;

        return this._setPage(messages[index], { animate });
    }

    _sync() {
        if (this._destroyed)
            return;

        const messages = this._messages;
        const empty = messages.length === 0;

        if (this._current && !messages.includes(this._current))
            this._current = null;

        if (this._currentMaxPage !== messages.length) {
            this._currentMaxPage = messages.length;
            this.emit('max-page-updated', this._currentMaxPage);
        }

        let selectedViaShowFirst = false;
        if (!this._current && !empty) {
            this._showFirstPlaying();
            selectedViaShowFirst = true;
        }

        if (!selectedViaShowFirst) {
            for (const message of messages) {
                if (message === this._current) {
                    message.show();
                    message.opacity = 255;
                    message.translationX = 0;
                } else {
                    message.hide();
                }
            }
        }

        if (this._current) {
            const index = messages.indexOf(this._current);
            if (index !== -1 && index !== this._currentPage) {
                this._currentPage = index;
                this.emit('page-updated', index);
            }
        } else if (empty && this._currentPage !== 0) {
            this._currentPage = 0;
            this.emit('page-updated', 0);
        }

        if (empty)
            this._current = null;

        this.empty = empty;
        this._updatePlaybackState();
        this._setPlayerCount(messages.length);
    }

    get playbackActive() {
        return this._hasActivePlayback;
    }

    _updatePlaybackState() {
        if (this._destroyed)
            return;

        const active = [...this._items.keys()].some(player => {
            try {
                return player.isPlaying?.();
            } catch {
                return false;
            }
        });

        this._setPlaybackActive(active);
    }

    _setPlaybackActive(active) {
        if (this._hasActivePlayback === active)
            return;
        this._hasActivePlayback = active;
        this.emit('playback-active-changed', active);
        this.notify('playback-active');
    }

    _setPlayerCount(count) {
        if (this._playerCount === count)
            return;
        this._playerCount = count;
        this.emit('player-count-changed', count);
    }
}

GObject.registerClass({
    Signals: {
        'page-updated': { param_types: [GObject.TYPE_INT] },
        'max-page-updated': { param_types: [GObject.TYPE_INT] },
        'playback-active-changed': { param_types: [GObject.TYPE_BOOLEAN] },
        'player-count-changed': { param_types: [GObject.TYPE_INT] },
    },
    Properties: {
        'empty': GObject.ParamSpec.boolean('empty', null, null, GObject.ParamFlags.READWRITE, true),
        'playback-active': GObject.ParamSpec.boolean('playback-active', null, null, GObject.ParamFlags.READABLE, false),
    },
}, MediaList);

class MediaHeader extends St.BoxLayout {
    constructor() {
        super({ style_class: 'kiwi-header', vertical: true });
        this.spacing = 4;
        this._headerLabel = new St.Label({
            text: gettextFunc('Media'),
            style_class: 'kiwi-header-label',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        this.add_child(this._headerLabel);

        this._pageIndicator = new PageIndicators(Clutter.Orientation.HORIZONTAL);
        this._pageIndicator.reactive = true;
        this._pageIndicator.can_focus = true;
        this._pageIndicator.x_expand = true;
        this._pageIndicator.x_align = Clutter.ActorAlign.CENTER;
        this._pageIndicator.y_align = Clutter.ActorAlign.CENTER;
        this._pageIndicator.add_style_class_name('kiwi-page-indicators');
        this.add_child(this._pageIndicator);
    }

    set maxPage(maxPage) {
        const total = Math.max(1, maxPage);
        this._pageIndicator.visible = maxPage > 1;
        this._pageIndicator.setNPages(total);
    }

    get maxPage() {
        return this._pageIndicator.nPages;
    }

    set page(page) {
        const nPages = Math.max(1, this._pageIndicator.nPages);
        const clamped = Math.max(0, Math.min(page ?? 0, nPages - 1));
        this._pageIndicator.setCurrentPosition(clamped);
    }

    get page() {
        return this._pageIndicator._currentPosition ?? 0;
    }

    connectPageActivated(callback, target) {
        return this._pageIndicator.connectObject('page-activated', callback, target ?? this);
    }
}

GObject.registerClass(MediaHeader);

class MediaWidget extends St.BoxLayout {
    constructor() {
        super({
            vertical: true,
            x_expand: true,
            reactive: true,
            style_class: 'kiwi-media',
            y_align: Clutter.ActorAlign.START,
        });
        this.spacing = 6;

        this._header = new MediaHeader();
        this.add_child(this._header);

        this._headerSpacer = new St.Widget({ style_class: 'kiwi-media-spacer', x_expand: true });
        this._headerSpacer.set_style('height: 6px;');
        this.add_child(this._headerSpacer);

        this._list = new MediaList();
        this._list.y_expand = false;
        this._list.y_align = Clutter.ActorAlign.START;
        this.add_child(this._list);

        this._list.connectObject('notify::empty', this._syncEmpty.bind(this));

        this._syncEmpty();
        this._header.page = this._list.page;
        this._header.maxPage = this._list.maxPage;

        this._list.connectObject('page-updated', (_, page) => {
            if (this._header.page !== page)
                this._header.page = page;
        });
        this._list.connectObject('max-page-updated', (_, maxPage) => {
            if (this._header.maxPage !== maxPage)
                this._header.maxPage = maxPage;
            this._updateBodySpacing(maxPage);
        });
        this._list.connectObject('playback-active-changed', () => {
            this._refreshIndicator();
        }, this);
        this._list.connectObject('player-count-changed', () => {
            this._refreshIndicator();
        }, this);
        this._header.connectPageActivated((_, page) => {
            if (page === this._list.page)
                return;
            this._list.goToPage(page);
        }, this);

        this._updateBodySpacing(this._list.maxPage);
        this._refreshIndicator();
    }

    _updateBodySpacing(maxPage = this._list.maxPage) {
        const multiplePages = maxPage > 1;
        this.spacing = multiplePages ? 0 : 6;
        this._headerSpacer.visible = !multiplePages;
    }

    _syncEmpty() {
        const isEmpty = this._list.empty;
        this.visible = !isEmpty;
        if (isEmpty)
            this._updateBodySpacing(0);
    }

    _refreshIndicator() {
        updateMediaIndicator({
            hasPlayers: this._list.playerCount > 0,
            isPlaying: this._list.playbackActive,
        });
    }
}

GObject.registerClass(MediaWidget);
// #endregion Media Classes

export function enable(gettext) {
    gettextFunc = typeof gettext === 'function' ? gettext : (message) => message;
    if (enabled)
        return;

    _initTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        const grid = getQuickSettingsGrid();
        if (!grid)
            return GLib.SOURCE_CONTINUE; // Retry if grid not ready

        mediaWidget = new MediaWidget();
        const existingChildren = grid.get_children?.() ?? [];
        const notificationsActor = existingChildren.find(child =>
            typeof child.has_style_class_name === 'function' && child.has_style_class_name('kiwi-notifications'));

        const targetIndex = notificationsActor ? existingChildren.indexOf(notificationsActor) : existingChildren.length;

        if (typeof grid.insert_child_at_index === 'function') {
            grid.insert_child_at_index(mediaWidget, targetIndex);
        } else if (notificationsActor && typeof grid.insert_child_above === 'function') {
            grid.insert_child_above(mediaWidget, notificationsActor);
        } else {
            grid.add_child(mediaWidget);
        }

        const layout = grid.layout_manager;
        if (layout && typeof layout.child_set_property === 'function')
            layout.child_set_property(grid, mediaWidget, 'column-span', 2);

        enabled = true;
        _initTimeoutId = null;
        return GLib.SOURCE_REMOVE;
    });
}

export function disable() {
    if (!enabled)
        return;

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

    destroyMediaIndicator();

    enabled = false;
    gettextFunc = (message) => message;
}

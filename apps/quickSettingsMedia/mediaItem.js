// SPDX-License-Identifier: GPL-3.0-or-later
// Kiwi Extension - Quick Settings Media playback widget helpers

import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';

const TITLE_SCROLL_GAP = '        ';
const TITLE_SCROLL_SPEED = 40;
const ARTWORK_SIZE = 112;
// Ignore bogus remote positions for this long after our own seek
const SEEK_SETTLE_TIME = 10 * 1000000;

Gio._promisify(Gio.File.prototype, 'read_async', 'read_finish');
Gio._promisify(GdkPixbuf.Pixbuf, 'new_from_stream_at_scale_async', 'new_from_stream_finish');

function formatTime(position, withHours = false) {
    let seconds = Math.max(0, Math.floor(position / 1000000));
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    seconds %= 60;
    const secondsPart = String(seconds).padStart(2, '0');
    if (hours > 0 || withHours)
        return `${hours}:${String(minutes).padStart(2, '0')}:${secondsPart}`;
    return `${minutes}:${secondsPart}`;
}

export class MediaItem extends MessageList.Message {
    constructor(player) {
        super(player.source);
        this.add_style_class_name('media-message');
        this._player = player;
        this._position = 0;
        this._positionRequest = 0;
        this._positionPending = false;
        this._progressTimerId = null;
        this._dragging = false;
        this._syncingPosition = false;
        this._lastRemotePosition = null;
        this._lastSeekTime = 0;
        this._tickTime = 0;
        this._scrollingTitle = null;
        this._titleText = '';
        this._scrollTitleWidth = 0;
        this._scrollDistance = 0;
        this._titleScrollId = null;
        this._titleCycleStarting = false;
        this.connect('destroy', () => {
            if (this._artworkCancellable)
                this._artworkCancellable.cancel();
            this._stopUpdates();
            this._stopTitleScroll();
            this._player.disconnectObject(this);
            this._player = null;
        });

        this._header.hide();
        this._createArtwork();
        this._createInlineTitle();
        this._moveControlsUnderArtist();
        this._createControlButtons();
        this._createProgress();
        this.connect('notify::mapped', this._syncMapped.bind(this));
        this._player.connectObject('changed', this._update.bind(this), this);
        this._update();
    }

    _createArtwork() {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this._artwork = new St.Widget({
            style_class: 'kiwi-media-artwork',
            layout_manager: new Clutter.BinLayout(),
            width: ARTWORK_SIZE * scale,
            height: ARTWORK_SIZE * scale,
            x_expand: false,
            y_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._icon.get_parent().insert_child_below(this._artwork, this._icon);
    }

    _updateArtwork() {
        const url = this._player.trackCoverUrl ?? null;
        if (this._artworkUrl === url)
            return;
        this._artworkUrl = url;
        if (this._artworkCancellable)
            this._artworkCancellable.cancel();
        this._artwork.destroy_all_children();
        const placeholder = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            style_class: 'kiwi-media-artwork-placeholder',
        });
        this._artwork.add_child(placeholder);
        if (!url)
            return;

        this._artworkCancellable = new Gio.Cancellable();
        this._loadArtwork(url, this._artworkCancellable, placeholder);
    }

    async _loadArtwork(url, cancellable, placeholder) {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        let stream = null;
        try {
            stream = await Gio.File.new_for_uri(url).read_async(GLib.PRIORITY_DEFAULT, cancellable);
            let pixbuf = await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                stream, ARTWORK_SIZE * scale, ARTWORK_SIZE * scale, true, cancellable);
            if (cancellable.is_cancelled() || !this._player)
                return;
            if (!pixbuf.get_has_alpha())
                pixbuf = pixbuf.add_alpha(false, 0, 0, 0);
            const width = pixbuf.get_width();
            const height = pixbuf.get_height();
            const stride = pixbuf.get_rowstride();
            const pixels = pixbuf.get_pixels();
            const radius = Math.min(6 * scale, width / 2, height / 2);
            // Clip the image itself; a widget border radius does not clip children.
            for (let y = 0; y < Math.ceil(radius); y++) {
                for (let x = 0; x < Math.ceil(radius); x++) {
                    const alpha = Math.max(0, Math.min(1,
                        radius - Math.hypot(radius - x - 0.5, radius - y - 0.5) + 0.5));
                    for (const px of [x, width - 1 - x]) {
                        for (const py of [y, height - 1 - y]) {
                            const offset = py * stride + px * 4 + 3;
                            pixels[offset] = Math.round(pixels[offset] * alpha);
                        }
                    }
                }
            }
            const image = St.ImageContent.new_with_preferred_size(width, height);
            const context = global.stage.get_context().get_backend().get_cogl_context();
            image.set_data(context, pixels, Cogl.PixelFormat.RGBA_8888, width, height, stride);
            this._artwork.add_child(new Clutter.Actor({ content: image, width, height }));
            placeholder.hide();
        } catch (error) {
            if (!cancellable.is_cancelled())
                console.error('[kiwi] Could not load media artwork:', error);
        } finally {
            if (stream)
                stream.close_async(GLib.PRIORITY_DEFAULT, null, null);
        }
    }

    _createInlineTitle() {
        const contentBox = this.titleLabel.get_parent();
        const index = contentBox.get_children().indexOf(this.titleLabel);
        contentBox.remove_child(this.titleLabel);
        this.titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.titleLabel.clutter_text.single_line_mode = true;
        this.titleLabel.x_align = Clutter.ActorAlign.START;
        this.titleLabel.y_align = Clutter.ActorAlign.CENTER;
        this.titleLabel.set_position(0, 0);

        // The marquee doubles the title inside this single label, so the
        // loop wrap shows identical glyphs at identical positions.
        this._titleTrack = new St.Widget({ layout_manager: new Clutter.FixedLayout() });
        this._titleTrack.add_child(this.titleLabel);

        this._titleViewport = new St.Widget({
            style_class: 'kiwi-track-title',
            width: 0,
            x_expand: true,
            clip_to_allocation: true,
            layout_manager: new Clutter.FixedLayout(),
        });
        this._titleViewport.add_child(this._titleTrack);
        contentBox.insert_child_at_index(this._titleViewport, index);
        this._titleViewport.connect('notify::allocation', this._scrollTitle.bind(this));
    }

    _moveControlsUnderArtist() {
        this._mediaControls.get_parent().remove_child(this._mediaControls);
        this._mediaControls.add_style_class_name('kiwi-media-controls');
        this._mediaControls.x_align = Clutter.ActorAlign.CENTER;
        this._bodyBin.get_parent().add_child(this._mediaControls);
    }

    _createControlButtons() {
        this._prevButton = this.addMediaControl('media-skip-backward-symbolic', () => this._player.previous());
        this._pauseButton = this.addMediaControl('', () => this._player.playPause());
        this._nextButton = this.addMediaControl('media-skip-forward-symbolic', () => this._player.next());
    }

    _createProgress() {
        this._progress = new St.BoxLayout({
            style_class: 'kiwi-media-progress',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._bodyBin.get_parent().add_child(this._progress);
        this._slider = new Slider(0);
        this._slider.accessible_name = this._player.trackTitle;
        this._progress.add_child(this._slider);
        const times = new St.BoxLayout({ style_class: 'kiwi-media-times' });
        this._elapsed = new St.Label({ x_expand: true, x_align: Clutter.ActorAlign.START });
        this._remaining = new St.Label({ x_expand: true, x_align: Clutter.ActorAlign.END });
        times.add_child(this._elapsed);
        times.add_child(this._remaining);
        this._progress.add_child(times);

        this._slider.connect('drag-begin', () => {
            this._dragging = true;
            this._dragTrackId = this._player.trackId;
            this._positionRequest++;
        });
        this._slider.connect('drag-end', () => {
            this._dragging = false;
            if (this._dragTrackId === this._player.trackId)
                this._seek();
            else
                this._syncPosition();
        });
        this._slider.connect('notify::value', () => {
            if (this._syncingPosition || !this._slider.reactive)
                return;
            this._setPosition(this._slider.value * this._player.length);
            if (!this._dragging)
                this._seek();
        });
    }

    _setPosition(position) {
        const length = this._player.length > 0 ? this._player.length : 0;
        this._position = Math.max(0, length ? Math.min(length, position) : position);
        this._syncingPosition = true;
        this._slider.value = length ? this._position / length : 0;
        this._syncingPosition = false;
        const withHours = length >= 3600000000;
        this._elapsed.text = formatTime(this._position, withHours);
        this._remaining.text = length ? `-${formatTime(length - this._position, withHours)}` : '--:--';
    }

    _seek() {
        this._positionRequest++;
        this._lastSeekTime = GLib.get_monotonic_time();
        this._player.position = Math.round(this._position);
    }

    async _syncPosition() {
        if (!this.mapped || this._dragging || this._positionPending)
            return;
        this._positionPending = true;
        const request = this._positionRequest;
        const position = await this._player.position;
        this._positionPending = false;
        if (!this._player || !this.mapped || this._dragging || request !== this._positionRequest)
            return;
        if (!Number.isFinite(position) || position === this._lastRemotePosition)
            return;
        this._lastRemotePosition = position;
        // Players like Firefox report an uninitialized zero right after a
        // seek; keep the locally tracked position instead.
        const justSeeked = GLib.get_monotonic_time() - this._lastSeekTime < SEEK_SETTLE_TIME;
        if (position === 0 && justSeeked && this._position > 2 * 1000000)
            return;
        this._setPosition(position);
    }

    _syncMapped() {
        if (!this.mapped) {
            this._stopUpdates();
            this._stopTitleScroll();
            return;
        }
        this._syncPosition();
        if (!this._progressTimerId) {
            this._tickTime = 0;
            this._progressTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._tickPosition();
                return GLib.SOURCE_CONTINUE;
            });
        }
        // The mapped notification fires before children are mapped, so
        // defer the marquee start until the title track can animate.
        this._queueTitleScroll();
    }

    // Players like Firefox report a stale Position, so advance the local
    // position while playing and let the remote value correct it when it
    // actually changes.
    _tickPosition() {
        const now = GLib.get_monotonic_time();
        const elapsed = this._tickTime ? now - this._tickTime : 0;
        this._tickTime = now;
        if (!this._dragging && this._player.status === 'Playing')
            this._setPosition(this._position + elapsed);
        this._syncPosition();
    }

    _stopUpdates() {
        this._positionRequest++;
        if (this._progressTimerId) {
            GLib.Source.remove(this._progressTimerId);
            this._progressTimerId = null;
        }
    }

    _stopTitleScroll() {
        if (this._titleScrollId) {
            GLib.Source.remove(this._titleScrollId);
            this._titleScrollId = null;
        }
        this._titleTrack.remove_all_transitions();
        this._titleTrack.translation_x = 0;
        if (this._scrollingTitle !== null)
            this.titleLabel.text = this._titleText;
        this._scrollingTitle = null;
    }

    _queueTitleScroll() {
        if (this._titleScrollId)
            return;
        this._titleScrollId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._titleScrollId = null;
            this._scrollTitle();
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(this._titleScrollId, '[kiwi] MediaItem title scroll');
    }

    _marqueeText() {
        return `${this._titleText}${TITLE_SCROLL_GAP}${this._titleText}`;
    }

    // Endless marquee: the title is doubled inside one label and the track
    // translates by exactly one period, so the wrap shows identical glyphs
    // at identical positions.
    _scrollTitle() {
        const text = this._titleText;
        const width = this._titleViewport.get_allocation_box().get_width();
        if (!this.mapped || width <= 0) {
            this._stopTitleScroll();
            return;
        }
        if (this._scrollingTitle === text && this._titleTrack.get_transition('translation-x'))
            return;
        this._stopTitleScroll();
        if (this.titleLabel.text !== text)
            this.titleLabel.text = text;
        const [, titleWidth] = this.titleLabel.get_preferred_width(-1);
        if (titleWidth <= width)
            return;

        this._scrollingTitle = text;
        this._scrollTitleWidth = titleWidth;
        this.titleLabel.text = this._marqueeText();
        const [, fullWidth] = this.titleLabel.get_preferred_width(-1);
        // Run widths are additive in one Pango layout, so the difference
        // is exactly the period of the repeated text.
        this._scrollDistance = fullWidth - titleWidth;
        this._scrollTitleCycle();
    }

    _scrollTitleCycle() {
        const width = this._titleViewport.get_allocation_box().get_width();
        if (!this.mapped || !this._titleTrack.mapped ||
            this._scrollingTitle !== this._titleText ||
            width <= 0 || this._scrollTitleWidth <= width) {
            this._stopTitleScroll();
            return;
        }
        if (this._titleCycleStarting)
            return;

        this._titleTrack.translation_x = 0;
        this._titleCycleStarting = true;
        try {
            this._titleTrack.ease({
                translation_x: -this._scrollDistance,
                duration: Math.max(1500, Math.round(this._scrollDistance / TITLE_SCROLL_SPEED * 1000)),
                mode: Clutter.AnimationMode.LINEAR,
                onComplete: () => this._scrollTitleCycle(),
            });
        } finally {
            this._titleCycleStarting = false;
        }
        // No transition means onComplete already ran synchronously (ease
        // skips transitions for unmapped actors or disabled animations);
        // stop instead of restarting in a loop.
        if (!this._titleTrack.get_transition('translation-x'))
            this._stopTitleScroll();
    }

    _update() {
        const trackArtists = this._player.trackArtists?.join(', ') ?? '';

        this.set({ title: this._player.trackTitle, body: trackArtists, icon: null });
        this._titleText = (this._player.trackTitle ?? '').replace(/\n/g, ' ');
        // Not scrolling: show the plain title. Scrolling the same title:
        // restore the doubled text that set() just overwrote.
        if (this._scrollingTitle === null)
            this.titleLabel.text = this._titleText;
        else if (this._scrollingTitle === this._titleText)
            this.titleLabel.text = this._marqueeText();
        this._updateArtwork();

        const isPlaying = this._player.status === 'Playing';
        this._pauseButton.child.icon_name = isPlaying ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';

        this._prevButton.reactive = !!this._player.canGoPrevious;
        this._nextButton.reactive = !!this._player.canGoNext;
        this._slider.reactive = Number.isFinite(this._player.length) && this._player.length > 0 &&
            this._player.canSeek;
        this._slider.can_focus = this._slider.reactive;
        this._slider.accessible_name = this._player.trackTitle;
        if (this._trackId !== this._player.trackId) {
            this._trackId = this._player.trackId;
            this._positionRequest++;
            this._setPosition(0);
        } else {
            this._setPosition(this._position);
        }
        this._syncMapped();
    }

    vfunc_button_press_event() { return Clutter.EVENT_PROPAGATE; }
    vfunc_button_release_event() { return Clutter.EVENT_PROPAGATE; }
    vfunc_motion_event() { return Clutter.EVENT_PROPAGATE; }
    vfunc_touch_event() { return Clutter.EVENT_PROPAGATE; }
}

GObject.registerClass(MediaItem);

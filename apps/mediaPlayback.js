// SPDX-License-Identifier: GPL-3.0-or-later
// Kiwi Extension - Media playback cards and MPRIS players

import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import { BarLevel } from 'resource:///org/gnome/shell/ui/barLevel.js';
import { Slider } from 'resource:///org/gnome/shell/ui/slider.js';
import { loadInterfaceXML } from 'resource:///org/gnome/shell/misc/fileUtils.js';

const TITLE_SCROLL_GAP = '        ';
const TITLE_SCROLL_SPEED = 40;
const ARTWORK_SIZE = 112;
const SECONDARY_OPACITY = Math.round(255 * 0.9);
const METADATA_REFRESH_ATTEMPTS = 5;
const HANDLE_FADE_DURATION = 140;
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

class MediaProgressSlider extends Slider {
    _init(value) {
        super._init(value);
        this._handleOpacity = new St.Adjustment({ actor: this, lower: 0, upper: 1, value: 0 });
        this._handleOpacity.connect('notify::value', () => this.queue_repaint());
        // Slider updates its handle radius after DrawingArea's style repaint.
        this.connect_after('style-changed', () => this.queue_repaint());
        this.connect('notify::hover', () => this._syncHandle());
        this.connect('notify::reactive', () => this._syncHandle());
        this.connect('notify::mapped', () => this._syncHandle());
        this.connect('drag-begin', () => {
            this._handleDragging = true;
            this._syncHandle();
        });
        this.connect('drag-end', () => {
            this._handleDragging = false;
            this._syncHandle();
        });
        this.connect('destroy', () => this._handleOpacity.remove_transition('value'));
    }

    _syncHandle() {
        if (!this.mapped) {
            this._handleOpacity.remove_transition('value');
            this._handleOpacity.value = 0;
            return;
        }
        this._handleOpacity.ease(this.reactive && (this.hover || this._handleDragging) ? 1 : 0, {
            duration: HANDLE_FADE_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    vfunc_repaint() {
        // Paint the bar normally, then fade only the handle.
        BarLevel.prototype.vfunc_repaint.call(this);
        const opacity = this._handleOpacity?.value ?? 0;
        if (opacity === 0)
            return;

        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        const radius = this._handleRadius;
        let x = radius + (width - 2 * radius) * this._value / this._maxValue;
        if (this.get_text_direction() === Clutter.TextDirection.RTL)
            x = width - x;
        const color = this.get_theme_node().get_foreground_color();
        cr.setSourceRGBA(color.red / 255, color.green / 255, color.blue / 255,
            color.alpha / 255 * opacity);
        cr.arc(x, height / 2, radius, 0, 2 * Math.PI);
        cr.fill();
        cr.$dispose();
    }
}
GObject.registerClass(MediaProgressSlider);

export class MediaItem extends MessageList.Message {
    constructor(player, requestRedraw = null) {
        super(player.source);
        this.add_style_class_name('media-message');
        // Only the controls are clickable; the inherited message button must
        // not compete with them for pointer presses.
        this.reactive = false;
        this.can_focus = false;
        this.track_hover = false;
        this._player = player;
        this._requestRedraw = requestRedraw;
        this._position = 0;
        this._positionRequest = 0;
        this._positionPending = false;
        this._progressTimerId = null;
        this._dragging = false;
        this._syncingPosition = false;
        this._lastRemotePosition = null;
        this._lastSeekTime = 0;
        this._tickTime = 0;
        this._playing = false;
        this._metadataRetries = METADATA_REFRESH_ATTEMPTS;
        this._scrollingTitle = null;
        this._titleText = '';
        this._scrollTitleWidth = 0;
        this._scrollDistance = 0;
        this._titleScrollId = null;
        this._titleCycleStarting = false;
        this._soundWaveTimerId = null;
        this.connect('destroy', () => {
            if (this._artworkCancellable)
                this._artworkCancellable.cancel();
            this._stopUpdates();
            this._stopTitleScroll();
            this._stopVisualizer();
            this._player.disconnectObject(this);
            this._player = null;
        });

        this._header.hide();
        this._createArtwork();
        this._createInlineTitle();
        this._createArtistRow();
        this._moveControlsUnderArtist();
        this._createControlButtons();
        this._createProgress();
        this.connect('notify::mapped', this._syncMapped.bind(this));
        this._player.connectObject(
            'changed', this._update.bind(this),
            'seeked', (_player, position) => this._onSeeked(position), this);
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
        this._titleTrack.connect('notify::translation-x', () => this._requestRedraw?.());

        this._titleViewport = new St.Widget({
            style_class: 'kiwi-track-title',
            width: 0,
            x_expand: true,
            clip_to_allocation: true,
            layout_manager: new Clutter.FixedLayout(),
        });
        this._titleViewport.add_child(this._titleTrack);
        contentBox.insert_child_at_index(this._titleViewport, index);
        this._titleViewport.connect('notify::allocation', this._queueTitleScroll.bind(this));
    }

    _createArtistRow() {
        const contentBox = this._bodyBin.get_parent();
        const index = contentBox.get_children().indexOf(this._bodyBin);
        contentBox.remove_child(this._bodyBin);
        this._artistRow = new St.BoxLayout({
            style_class: 'kiwi-media-artist-row',
            x_expand: true,
        });
        this._bodyBin.x_expand = true;
        this._artistRow.add_child(this._bodyBin);
        this._soundWave = new St.BoxLayout({
            style_class: 'kiwi-media-soundwave',
            opacity: SECONDARY_OPACITY,
            y_align: Clutter.ActorAlign.CENTER,
        });
        for (let i = 0; i < 4; i++) {
            const bar = new St.Widget({
                style_class: 'kiwi-media-soundwave-bar',
                scale_y: 0.25,
            });
            bar.set_pivot_point(0.5, 0.5);
            this._soundWave.add_child(bar);
        }
        this._artistRow.add_child(this._soundWave);
        contentBox.insert_child_at_index(this._artistRow, index);
        this._soundWave.connect('notify::mapped', this._syncVisualizer.bind(this));
        this._soundWave.connect('style-changed', () => {
            // St does not resolve currentColor for widget backgrounds.
            const color = this._soundWave.get_theme_node().get_foreground_color();
            const style = `background-color: rgba(${color.red}, ${color.green}, ${color.blue}, ${color.alpha / 255});`;
            for (const bar of this._soundWave.get_children()) {
                if (bar.style !== style)
                    bar.style = style;
            }
        });
        St.Settings.get().connectObject('notify::enable-animations', this._syncVisualizer.bind(this), this);
    }

    _syncVisualizer() {
        if (!this._soundWave?.mapped || !this._player?.isPlaying() || !St.Settings.get().enable_animations) {
            this._stopVisualizer();
            return;
        }
        if (this._soundWaveTimerId)
            return;

        // A compact playback indicator; transform the bars without relayout.
        const bars = this._soundWave.get_children();
        const levels = [0.3, 0.85, 0.5, 1, 0.65];
        let phase = 0;
        const animate = () => {
            bars.forEach((bar, index) => bar.ease({
                scale_y: levels[(phase + index * 2) % levels.length],
                duration: 220,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            }));
            phase++;
            return GLib.SOURCE_CONTINUE;
        };
        animate();
        this._soundWaveTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 240, animate);
        GLib.Source.set_name_by_id(this._soundWaveTimerId, '[kiwi] MediaItem soundwave');
    }

    _stopVisualizer() {
        if (this._soundWaveTimerId) {
            GLib.Source.remove(this._soundWaveTimerId);
            this._soundWaveTimerId = null;
        }
        for (const bar of this._soundWave?.get_children() ?? []) {
            bar.remove_all_transitions();
            bar.scale_y = 0.25;
        }
    }

    _moveControlsUnderArtist() {
        this._bodyBin.opacity = SECONDARY_OPACITY;
        this._mediaControls.get_parent().remove_child(this._mediaControls);
        this._mediaControls.add_style_class_name('kiwi-media-controls');
        this._mediaControls.x_align = Clutter.ActorAlign.CENTER;
        this._artistRow.get_parent().add_child(this._mediaControls);
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
        this._mediaControls.get_parent().add_child(this._progress);
        this._slider = new MediaProgressSlider(0);
        this._slider.accessible_name = this._player.trackTitle;
        this._slider.connect('repaint', () => this._requestRedraw?.());
        this._progress.add_child(this._slider);
        const times = new St.BoxLayout({ style_class: 'kiwi-media-times' });
        this._elapsed = new St.Label({ x_expand: true, x_align: Clutter.ActorAlign.START });
        this._remaining = new St.Label({ x_expand: true, x_align: Clutter.ActorAlign.END });
        times.add_child(this._elapsed);
        times.add_child(this._remaining);
        this._progress.add_child(times);

        this._slider.connect('drag-begin', () => {
            this._dragging = true;
            this._dragTrackKey = this._player.trackKey;
            this._positionRequest++;
        });
        this._slider.connect('drag-end', () => {
            this._dragging = false;
            if (this._dragTrackKey === this._player.trackKey)
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
        this._tickTime = GLib.get_monotonic_time();
        const length = this._player.length > 0 ? this._player.length : 0;
        this._position = Math.max(0, length ? Math.min(length, position) : position);
        this._syncingPosition = true;
        this._slider.value = length ? this._position / length : 0;
        this._syncingPosition = false;
        const withHours = length >= 3600000000;
        this._elapsed.text = formatTime(this._position, withHours);
        this._remaining.text = length ? `-${formatTime(length - this._position, withHours)}` : '--:--';
    }

    async _seek() {
        const request = ++this._positionRequest;
        this._lastSeekTime = GLib.get_monotonic_time();
        const success = await this._player.seek(Math.round(this._position));
        if (!this._player || request !== this._positionRequest || success)
            return;
        this._lastSeekTime = 0;
        this._lastRemotePosition = null;
        this._syncPosition();
    }

    _onSeeked(position) {
        if (!Number.isFinite(position) || this._dragging)
            return;
        this._positionRequest++;
        this._lastSeekTime = 0;
        this._lastRemotePosition = position;
        this._tickTime = GLib.get_monotonic_time();
        this._setPosition(position);
    }

    async _syncPosition() {
        if (!this._player || !this.mapped || this._dragging || this._positionPending)
            return;
        this._positionPending = true;
        const player = this._player;
        const request = this._positionRequest;
        // Some players publish duration/capabilities late without notifying
        // clients. Retry briefly using the existing progress timer.
        if (this._metadataRetries > 0 && (!(player.length > 0) || !player.canSeek)) {
            this._metadataRetries--;
            await player.refresh();
        }
        const position = await player.position;
        this._positionPending = false;
        if (!this._player || !this.mapped || this._dragging || request !== this._positionRequest)
            return;
        if (!Number.isFinite(position) || position === this._lastRemotePosition)
            return;
        // Players like Firefox report an uninitialized zero right after a
        // seek; keep the locally tracked position instead.
        const justSeeked = GLib.get_monotonic_time() - this._lastSeekTime < SEEK_SETTLE_TIME;
        // Firefox can keep returning zero even after confirming a non-zero
        // seek. Its next Seeked signal or track change remains authoritative.
        if (position === 0 && this._lastRemotePosition > 0 &&
            player.busName.startsWith('org.mpris.MediaPlayer2.firefox.'))
            return;
        if (position === 0 && justSeeked && this._position > 2 * 1000000)
            return;
        this._lastRemotePosition = position;
        this._setPosition(position);
    }

    _syncMapped() {
        this._advancePosition();
        if (!this.mapped) {
            this._stopUpdates();
            this._stopTitleScroll();
            return;
        }
        this._syncPosition();
        if (!this._progressTimerId) {
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
    _advancePosition() {
        const now = GLib.get_monotonic_time();
        const elapsed = this._tickTime ? now - this._tickTime : 0;
        this._tickTime = now;
        if (!this._dragging && this._playing)
            this._setPosition(this._position + elapsed);
    }

    _tickPosition() {
        this._advancePosition();
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

    _syncTitlePlayback() {
        const transition = this._titleTrack.get_transition('translation-x');
        if (this.mapped && this._player.isPlaying() && this._scrollingTitle === this._titleText) {
            if (!transition)
                this._scrollTitleCycle(false);
        } else if (transition) {
            // Removing a running ease transition releases Shell's animation
            // bookkeeping; pausing its timeline would bypass that cleanup.
            this._titleTrack.remove_all_transitions();
        }
    }

    // Endless marquee: the title is doubled inside one label and the track
    // translates by exactly one period, so the wrap shows identical glyphs
    // at identical positions.
    _scrollTitle() {
        if (!this.mapped || !this._titleViewport.has_allocation())
            return;
        const text = this._titleText;
        const width = this._titleViewport.get_allocation_box().get_width();
        if (!this.mapped || width <= 0) {
            this._stopTitleScroll();
            return;
        }
        if (this._scrollingTitle === text) {
            this._syncTitlePlayback();
            return;
        }
        this._stopTitleScroll();
        if (!this._player.isPlaying())
            return;
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

    _scrollTitleCycle(reset = true) {
        const width = this._titleViewport.get_allocation_box().get_width();
        if (!this.mapped || !this._titleTrack.mapped ||
            this._scrollingTitle !== this._titleText ||
            width <= 0 || this._scrollTitleWidth <= width) {
            this._stopTitleScroll();
            return;
        }
        if (this._titleCycleStarting || !this._player.isPlaying())
            return;

        if (reset)
            this._titleTrack.translation_x = 0;
        const remaining = Math.max(0, this._scrollDistance + this._titleTrack.translation_x);
        const duration = Math.max(1500, Math.round(this._scrollDistance / TITLE_SCROLL_SPEED * 1000));
        this._titleCycleStarting = true;
        try {
            this._titleTrack.ease({
                translation_x: -this._scrollDistance,
                duration: Math.max(1, Math.round(duration * remaining / this._scrollDistance)),
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
        this._advancePosition();
        const trackArtists = this._player.trackArtists?.join(', ') ?? '';
        const title = (this._player.trackTitle ?? '').replace(/\n/g, ' ');
        // Playback/capability updates must not rewrite the marquee text and
        // invalidate the popup layout when the track information is unchanged.
        if (title !== this._titleText || trackArtists !== this._displayedArtists) {
            this.set({ title: this._player.trackTitle, body: trackArtists, icon: null });
            this._titleText = title;
            this._displayedArtists = trackArtists;
            if (this._scrollingTitle === null)
                this.titleLabel.text = title;
            else if (this._scrollingTitle === title)
                this.titleLabel.text = this._marqueeText();
        }
        this._updateArtwork();

        const isPlaying = this._player.status === 'Playing';
        this._playing = isPlaying;
        this._pauseButton.child.icon_name = isPlaying ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._syncTitlePlayback();
        this._syncVisualizer();

        this._updateControl(this._prevButton, this._player.canGoPrevious);
        this._updateControl(this._nextButton, this._player.canGoNext);
        this._updateControl(this._pauseButton, isPlaying ? this._player.canPause : this._player.canPlay);
        this._slider.reactive = Number.isFinite(this._player.length) && this._player.length > 0 &&
            this._player.canSeek;
        this._slider.can_focus = this._slider.reactive;
        this._slider.accessible_name = this._player.trackTitle;
        if (this._trackKey !== this._player.trackKey) {
            this._trackKey = this._player.trackKey;
            this._positionRequest++;
            this._lastRemotePosition = null;
            this._lastSeekTime = 0;
            this._metadataRetries = METADATA_REFRESH_ATTEMPTS;
            this._setPosition(0);
        } else {
            this._setPosition(this._position);
        }
        this._syncMapped();
    }

    _updateControl(button, sensitive) {
        if (!sensitive) {
            button.fake_release();
            button.hover = false;
        }
        button.reactive = !!sensitive;
        button.can_focus = !!sensitive;
    }

    vfunc_button_press_event() { return Clutter.EVENT_PROPAGATE; }
    vfunc_button_release_event() { return Clutter.EVENT_PROPAGATE; }
    vfunc_motion_event() { return Clutter.EVENT_PROPAGATE; }
    vfunc_touch_event() { return Clutter.EVENT_PROPAGATE; }
}

GObject.registerClass(MediaItem);

const MPRIS_PLAYER_PREFIX = 'org.mpris.MediaPlayer2.';
const WEBKIT_TRACK_ID = '/org/mpris/MediaPlayer2/webkit';

const MEDIA_DBUS_XML = `<?xml version="1.0"?>
<node>
    <interface name="org.freedesktop.DBus.Properties">
        <method name="Get">
            <arg type="s" name="interface_name" direction="in"/>
            <arg type="s" name="property_name" direction="in"/>
            <arg type="v" name="value" direction="out"/>
        </method>
        <method name="GetAll">
            <arg type="s" name="interface_name" direction="in"/>
            <arg type="a{sv}" name="properties" direction="out"/>
        </method>
    </interface>
    <interface name="org.mpris.MediaPlayer2.Player">
        <method name="SetPosition">
            <arg type="o" name="TrackId" direction="in"/>
            <arg type="x" name="Position" direction="in"/>
        </method>
        <method name="Seek">
            <arg type="x" name="Offset" direction="in"/>
        </method>
        <method name="Play"/>
        <method name="Pause"/>
        <method name="Next"/>
        <method name="Previous"/>
        <signal name="Seeked">
            <arg type="x" name="Position"/>
        </signal>
        <property name="CanGoNext" type="b" access="read"/>
        <property name="CanGoPrevious" type="b" access="read"/>
        <property name="CanPlay" type="b" access="read"/>
        <property name="CanPause" type="b" access="read"/>
        <property name="CanControl" type="b" access="read"/>
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

let mediaNodeInfo = null;

function _lookupInterface(name) {
    mediaNodeInfo ??= Gio.DBusNodeInfo.new_for_xml(MEDIA_DBUS_XML);
    return mediaNodeInfo.interfaces.find(iface => iface.name === name);
}

const PROPERTIES_IFACE_NAME = 'org.freedesktop.DBus.Properties';
const PLAYER_IFACE_NAME = 'org.mpris.MediaPlayer2.Player';
const MPRIS_IFACE_NAME = 'org.mpris.MediaPlayer2';

class Player extends GObject.Object {
    constructor(busName, gettext) {
        super();
        this._busName = busName;
        this._gettext = gettext;
        this.source = new MessageList.Source();
        this._canPlay = false;
        this._canSeek = false;
        this._trackKey = null;
        this._destroyed = false;
        this._mprisProxy = null;
        this._playerProxy = null;
        this._propertiesProxy = null;
        this._seekRequest = 0;
        this._seekPending = null;

        const mprisIface = _lookupInterface(MPRIS_IFACE_NAME);
        const playerIface = _lookupInterface(PLAYER_IFACE_NAME);
        const propertiesIface = _lookupInterface(PROPERTIES_IFACE_NAME);

        const mprisPromise = Gio.DBusProxy.new(
            Gio.DBus.session,
            Gio.DBusProxyFlags.NONE,
            mprisIface,
            busName,
            '/org/mpris/MediaPlayer2',
            mprisIface.name,
            null
        )
            .then(proxy => this._mprisProxy = proxy)
            .catch(() => {});

        const playerPromise = Gio.DBusProxy.new(
            Gio.DBus.session,
            Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
            playerIface,
            busName,
            '/org/mpris/MediaPlayer2',
            playerIface.name,
            null
        )
            .then(proxy => this._playerProxy = proxy)
            .catch(() => {});

        const propertiesPromise = Gio.DBusProxy.new(
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

        Promise.all([playerPromise, propertiesPromise, mprisPromise])
            .then(this._ready.bind(this))
            .catch(() => {});
    }

    get position() {
        return this._propertiesProxy?.GetAsync('org.mpris.MediaPlayer2.Player', 'Position')
            .then(result => result[0].get_int64())
            .catch(() => null);
    }

    async seek(value) {
        const proxy = this._playerProxy;
        const trackKey = this.trackKey;
        const request = ++this._seekRequest;
        if (!this.canSeek || !proxy || !Number.isFinite(value))
            return false;
        const length = Number.isFinite(this._length) && this._length > 0 ? this._length : null;
        const target = Math.round(length ? Math.min(length, Math.max(0, value)) : Math.max(0, value));
        // Wait for an applied seek before reading the next relative offset,
        // and discard targets superseded while a request was in flight.
        const pending = (this._seekPending ?? Promise.resolve()).then(async () => {
            if (!this.canSeek || proxy !== this._playerProxy || trackKey !== this.trackKey ||
                request !== this._seekRequest)
                return false;
            try {
                if (this._trackId === WEBKIT_TRACK_ID) {
                    // WebKit advertises SetPosition but rejects it, and its Seek
                    // method interprets the argument as an absolute position.
                    await proxy.SeekAsync(target);
                } else if (this._trackId && this._trackId !== '/org/mpris/MediaPlayer2/TrackList/NoTrack') {
                    await proxy.SetPositionAsync(this._trackId, target);
                } else {
                    // Players without a track id (e.g. Gapless) only support relative seeks.
                    const current = await this.position;
                    if (!Number.isFinite(current) || !this.canSeek || proxy !== this._playerProxy ||
                        trackKey !== this.trackKey || request !== this._seekRequest)
                        return false;
                    await proxy.SeekAsync(target - current);
                }
                return true;
            } catch {
                return false;
            }
        });
        this._seekPending = pending;
        try {
            return await pending;
        } finally {
            if (this._seekPending === pending)
                this._seekPending = null;
        }
    }

    async refresh() {
        const proxy = this._playerProxy;
        const trackKey = this.trackKey;
        if (!proxy || !this._propertiesProxy)
            return;
        try {
            const [properties] = await this._propertiesProxy.GetAllAsync(PLAYER_IFACE_NAME);
            if (proxy !== this._playerProxy || trackKey !== this.trackKey)
                return;
            let changed = false;
            for (const name of ['Metadata', 'CanPlay', 'CanPause', 'CanControl', 'CanSeek', 'CanGoNext', 'CanGoPrevious']) {
                const value = properties[name];
                if (value && !proxy.get_cached_property(name)?.equal(value)) {
                    proxy.set_cached_property(name, value);
                    changed = true;
                }
            }
            if (changed)
                this._update();
        } catch {
            // Keep the cached state when a player cannot refresh its properties.
        }
    }

    get busName() { return this._busName; }
    get trackId() { return this._trackId; }
    get trackKey() { return this._trackKey; }
    get length() { return this._length; }
    get trackArtists() { return this._trackArtists; }
    get trackTitle() { return this._trackTitle; }
    get trackCoverUrl() { return this._trackCoverUrl; }
    get app() { return this._app; }
    get canControl() { return !!this._playerProxy && this._playerProxy.CanControl !== false; }
    // WebKit advertises navigation unconditionally, even without page handlers.
    get canGoNext() { return this.canControl && this.trackKey !== null && this.trackId !== WEBKIT_TRACK_ID && !!this._playerProxy.CanGoNext; }
    get canGoPrevious() { return this.canControl && this.trackKey !== null && this.trackId !== WEBKIT_TRACK_ID && !!this._playerProxy.CanGoPrevious; }
    get status() { return this._playerProxy?.PlaybackStatus; }
    get canPlay() { return this._canPlay; }
    get canPause() { return this.canControl && this.trackKey !== null && !!this._playerProxy.CanPause; }
    get canSeek() { return this._canSeek; }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._close();
    }

    _parseMetadata(metadata) {
        metadata ??= {};
        const trackId = metadata['mpris:trackid']?.deepUnpack();
        const length = metadata['mpris:length']?.deepUnpack();
        const title = metadata['xesam:title']?.deepUnpack();
        const url = metadata['xesam:url']?.deepUnpack();
        const hasTrackDetails = !!title || !!url || (Number.isFinite(length) && length > 0);
        // Decibels uses NoTrack for loaded audio. Only treat it as idle when
        // neither the track details nor the playback state indicate media.
        const noTrack = trackId === '/org/mpris/MediaPlayer2/TrackList/NoTrack' &&
            !hasTrackDetails && this.status !== 'Playing' && this.status !== 'Paused';
        // Gapless omits track ids and WebKit reuses one id for every track.
        const trackKey = noTrack ? null
            : JSON.stringify([trackId, url, title, metadata['xesam:artist']?.deepUnpack()]);
        if (this._trackKey !== trackKey)
            this._length = null;
        this._trackId = trackId;
        this._trackKey = trackKey;
        if (Number.isFinite(length) && length > 0)
            this._length = length;

        this._trackArtists = metadata['xesam:artist']?.deepUnpack();
        if (typeof this._trackArtists === 'string') {
            this._trackArtists = [this._trackArtists];
        } else if (!Array.isArray(this._trackArtists) || !this._trackArtists.every(artist => typeof artist === 'string')) {
            this._trackArtists = [this._gettext('Unknown artist')];
        }

        this._trackTitle = title;
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
    }

    _update() {
        const metadata = this._playerProxy?.Metadata;
        this._parseMetadata(metadata);
        this._setCanSeek(this.canControl && this.trackKey !== null && !!this._playerProxy?.CanSeek);
        this._setCanPlay(this.canControl && !!this._playerProxy?.CanPlay && this.trackKey !== null);
        this.emit('changed');
    }

    previous() {
        if (this.canGoPrevious)
            this._playerProxy.PreviousAsync().catch(() => {});
    }

    next() {
        if (this.canGoNext)
            this._playerProxy.NextAsync().catch(() => {});
    }

    playPause() {
        if (this.isPlaying() ? this.canPause : this.canPlay) {
            const action = this.isPlaying() ? 'PauseAsync' : 'PlayAsync';
            this._playerProxy[action]().catch(() => {});
        }
    }

    raise() {
        if (this._app) {
            this._app.activate();
        } else if (this._mprisProxy?.CanRaise) {
            this._mprisProxy.RaiseAsync().catch(() => {});
        }
    }

    isPlaying() { return this.status === 'Playing'; }

    _ready() {
        // The proxies can resolve after destroy(); don't wire a dead player up
        if (this._destroyed || !this._mprisProxy || !this._playerProxy)
            return;

        const mprisProxy = this._mprisProxy;
        mprisProxy.connectObject('notify::g-name-owner', () => {
            if (!this._mprisProxy?.g_name_owner)
                this._close();
        }, this);

        if (!mprisProxy.g_name_owner) {
            this._close();
            return;
        }

        this._playerProxy.connectObject('g-properties-changed', this._update.bind(this), this);
        this._playerProxy.connectObject('g-signal', (_proxy, _sender, name, parameters) => {
            if (name === 'Seeked')
                this.emit('seeked', parameters.deep_unpack()[0]);
        }, this);
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
        'seeked': { param_types: [GObject.TYPE_INT64] },
    },
    Properties: {
        'can-play': GObject.ParamSpec.boolean('can-play', 'can-play', 'Whether the player can play', GObject.ParamFlags.READABLE, false),
        'can-seek': GObject.ParamSpec.boolean('can-seek', 'can-seek', 'Whether the player can seek', GObject.ParamFlags.READABLE, false),
    },
}, Player);

const DBusIface = loadInterfaceXML('org.freedesktop.DBus');
const DBusProxy = Gio.DBusProxy.makeProxyWrapper(DBusIface);

export class Source extends GObject.Object {
    constructor(gettext) {
        super();
        this._players = new Map();
        this._proxy = null;
        this._nameOwnerChangedId = 0;
        this._gettext = gettext;
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
        const proxy = this._proxy;
        if (!proxy)
            return;

        try {
            const [names] = await proxy.ListNamesAsync();
            // stop(), or stop() and start() again, while the call was out
            if (this._proxy !== proxy)
                return;
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

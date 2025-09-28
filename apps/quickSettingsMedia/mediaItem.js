// SPDX-License-Identifier: GPL-3.0-or-later
// Kiwi Extension - Quick Settings Media playback widget helpers

import * as MessageList from 'resource:///org/gnome/shell/ui/messageList.js';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

export class MediaItem extends MessageList.Message {
    constructor(player) {
        super(player.source);
        this.add_style_class_name('media-message');
        this._player = player;
        this._destroyed = false;
        this.connect('destroy', () => {
            this._destroyed = true;
            this._player?.disconnectObject(this);
            this._player = null;
        });

        this._createControlButtons();
        this._player.connectObject('changed', this._update.bind(this), this);
        this._update();
    }

    _createControlButtons() {
        if (!this._prevButton)
            this._prevButton = this.addMediaControl('media-skip-backward-symbolic', () => this._player?.previous());

        if (!this._pauseButton)
            this._pauseButton = this.addMediaControl('', () => this._player?.playPause());

        if (!this._nextButton)
            this._nextButton = this.addMediaControl('media-skip-forward-symbolic', () => this._player?.next());
    }

    _update() {
        if (this._destroyed)
            return;

        let icon;
        if (this._player?.trackCoverUrl) {
            const file = Gio.File.new_for_uri(this._player.trackCoverUrl);
            icon = new Gio.FileIcon({ file });
        } else {
            icon = new Gio.ThemedIcon({ name: 'audio-x-generic-symbolic' });
        }

        const trackArtists = this._player?.trackArtists?.join(', ') ?? '';

        this.set({ title: this._player?.trackTitle, body: trackArtists, icon });

        if (this._pauseButton && this._player) {
            const isPlaying = this._player.status === 'Playing';
            this._pauseButton.child.icon_name = isPlaying ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        }

        if (this._prevButton)
            this._prevButton.reactive = !!this._player?.canGoPrevious;
        if (this._nextButton)
            this._nextButton.reactive = !!this._player?.canGoNext;
    }

    vfunc_button_press_event() { return Clutter.EVENT_PROPAGATE; }
    vfunc_button_release_event() { return Clutter.EVENT_PROPAGATE; }
    vfunc_motion_event() { return Clutter.EVENT_PROPAGATE; }
    vfunc_touch_event() { return Clutter.EVENT_PROPAGATE; }
}

GObject.registerClass(MediaItem);

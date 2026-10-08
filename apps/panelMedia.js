// SPDX-License-Identifier: GPL-3.0-or-later
// Kiwi Extension - Panel media playback menu

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import { MediaItem, Source } from './mediaPlayback.js';

const MAX_VISIBLE_PLAYERS = 3;

let panelButton = null;

class MediaList extends St.BoxLayout {
    constructor(gettext, requestRedraw) {
        super({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'kiwi-media-list',
            x_expand: true,
        });
        this._items = new Map();
        this._destroyed = false;
        this.connect('destroy', this._onDestroy.bind(this));

        this._source = new Source(gettext);
        this._source.connectObject('player-removed', (_source, player) => {
            if (this._destroyed)
                return;
            const item = this._items.get(player);
            if (!item)
                return;
            this._items.delete(player);
            this.remove_child(item);
            item.destroy();
            this.emit('changed');
        }, this);
        this._source.connectObject('player-added', (_source, player) => {
            if (this._destroyed || this._items.has(player))
                return;
            const item = new MediaItem(player, requestRedraw);
            this._items.set(player, item);
            this.add_child(item);
            this.emit('changed');
        }, this);
        this._source.start();
    }

    get playerCount() {
        return this._items.size;
    }

    _onDestroy() {
        this._destroyed = true;
        this._source.disconnectObject(this);
        for (const item of this._items.values())
            item.destroy();
        this._items.clear();
        this._source.destroy();
        this._source = null;
    }
}

GObject.registerClass({
    Signals: { 'changed': {} },
}, MediaList);

class MediaWidget extends St.ScrollView {
    constructor(gettext, requestRedraw) {
        super({
            child: new MediaList(gettext, requestRedraw),
            style_class: 'kiwi-media',
            x_expand: true,
            y_expand: true,
            track_hover: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.EXTERNAL,
            overlay_scrollbars: true,
            clip_to_allocation: true,
        });
        this.child.connectObject('changed', this._sync.bind(this), this);
        this.connect('notify::hover', this._sync.bind(this));
        global.stage.connectObject('notify::key-focus', () => {
            const focus = global.stage.get_key_focus();
            if (!focus || !this.child.contains(focus))
                return;
            const [, y] = focus.get_transformed_position();
            const [, top] = this.get_transformed_position();
            this.vadjustment.value += Math.min(y - top, 0) +
                Math.max(y + focus.height - top - this.height, 0);
        }, this);
        this._sync();
    }

    vfunc_get_preferred_height(forWidth) {
        const list = this.child;
        if (!list)
            return [0, 0];

        const themeNode = this.get_theme_node();
        const listThemeNode = list.get_theme_node();
        const width = listThemeNode.adjust_for_width(themeNode.adjust_for_width(forWidth));
        const items = list.get_children().slice(0, MAX_VISIBLE_PLAYERS);
        let height = Math.max(0, items.length - 1) * listThemeNode.get_length('spacing');
        for (const item of items) {
            const [, naturalHeight] = item.get_preferred_height(width);
            height += naturalHeight;
        }

        // Limit the viewport, while the list keeps its full scrollable height.
        const [, listHeight] = listThemeNode.adjust_preferred_height(0, height);
        return themeNode.adjust_preferred_height(0, listHeight);
    }

    _sync() {
        const hasPlayers = this.child.playerCount > 0;
        this.vscrollbar_policy = this.hover && this.child.playerCount >= 4
            ? St.PolicyType.ALWAYS : St.PolicyType.EXTERNAL;
        this.visible = hasPlayers;
        panelButton.visible = hasPlayers;
    }
}

GObject.registerClass(MediaWidget);

export function enable(gettext) {
    if (panelButton)
        return;

    panelButton = new PanelMenu.Button(1.0, gettext('Media'));
    panelButton.visible = false;
    const mediaIndicator = new St.Icon({
        icon_name: 'media-playback-start-symbolic',
        style_class: 'system-status-icon kiwi-media-indicator',
    });
    panelButton.add_child(mediaIndicator);
    panelButton.menu.actor.set_x_align(Clutter.ActorAlign.END);
    panelButton.menu.actor.set_x_expand(false);
    panelButton.menu.setSourceAlignment(1);
    panelButton.menu.box.add_style_class_name('kiwi-media-menu');
    const popupActor = panelButton.menu.actor;
    // Redraw the whole popup during media animations so dynamic background
    // blur does not rely on damage limited to the title or slider.
    const requestRedraw = () => {
        if (popupActor.mapped)
            popupActor.queue_redraw();
    };
    panelButton.menu.box.add_child(new MediaWidget(gettext, requestRedraw));
    Main.panel.addToStatusArea('kiwi-media', panelButton, 1, 'right');
}

export function disable() {
    if (panelButton) {
        panelButton.destroy();
        panelButton = null;
    }
}

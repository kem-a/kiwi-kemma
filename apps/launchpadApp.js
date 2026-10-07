// SPDX-License-Identifier: GPL-3.0-or-later
// Adds customizable Launchpad icon to the dash, and makes it behave like the native Show Apps button.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { dashOf, disconnectAll, watchDocks } from './dockUtils.js';

const LAUNCHPAD_DESKTOP_ID = 'org.gnome.Shell.Extensions.Kiwi.Launchpad.desktop';
const OLD_DESKTOP_ID = 'launchpad-kiwi.desktop';
const ICON_RELATIVE_PATH = 'icons/launchpad.svg';
// Right after the first favorite, like Launchpad after Finder
const LAUNCHPAD_POSITION = 1;

let _enabled = false; // Guards repeated enable() calls
let globalSignals = [];
let docks = [];
const sources = { dockSearch: 0, overviewDashSearch: 0 };
// Dash-to-Dock keeps a placeholder in place of the overview dash for the whole
// startup animation, so the real one may only arrive after login
const OVERVIEW_DASH_INTERVAL = 250; // ms
const OVERVIEW_DASH_TRIES = 40;     // ~10s

function _desktopPath(id) {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'applications', id]);
}

function _otherFavorites() {
    return global.settings.get_strv('favorite-apps')
        .filter(id => id !== LAUNCHPAD_DESKTOP_ID && id !== OLD_DESKTOP_ID);
}

// Puts our entry back in its slot after any drag, unpin or edit of the list
function _pinFavorite() {
    const current = global.settings.get_strv('favorite-apps');
    const favorites = _otherFavorites();
    favorites.splice(Math.min(LAUNCHPAD_POSITION, favorites.length), 0, LAUNCHPAD_DESKTOP_ID);
    if (favorites.join() !== current.join())
        global.settings.set_strv('favorite-apps', favorites);
}

/**
 * Our favorite stands in for the dash's own Show Apps button. Its click toggles
 * that button, so the dock and overview react exactly as they do to the native
 * one, and there is no app menu to offer.
 *
 * @param dash the dash the item belongs to
 * @param item a child of the dash's icon box
 */
function _takeOver(dash, item) {
    const appIcon = item.child?._delegate;
    if (appIcon?.app?.get_id() !== LAUNCHPAD_DESKTOP_ID)
        return;

    appIcon.activate = () => {
        dash.showAppsButton.checked = !dash.showAppsButton.checked;
    };
    appIcon.popupMenu = () => false;
}

function _watchDash(dash) {
    dash._box.get_children().forEach(item => _takeOver(dash, item));
    return dash._box.connect('child-added', (_box, item) => _takeOver(dash, item));
}

/**
 * Watch the overview's own dash. Dash-to-Dock parks a placeholder actor there
 * for the whole startup animation - it has a showAppsButton but no icon box -
 * and swaps the real dash back in on 'startup-complete'. We run before that at
 * login, so wait for the box rather than dereferencing it.
 */
function _watchOverviewDash() {
    let attempts = 0;
    const tryWatch = () => {
        const {dash} = Main.overview;
        if (dash?._box) {
            globalSignals.push([dash._box, _watchDash(dash)]);
            sources.overviewDashSearch = 0;
            return GLib.SOURCE_REMOVE;
        }
        if (++attempts < OVERVIEW_DASH_TRIES)
            return GLib.SOURCE_CONTINUE;
        sources.overviewDashSearch = 0;
        return GLib.SOURCE_REMOVE;
    };

    if (tryWatch() === GLib.SOURCE_CONTINUE) {
        sources.overviewDashSearch = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, OVERVIEW_DASH_INTERVAL, tryWatch);
    }
}

function _attach(container) {
    const dash = dashOf(container);
    if (!dash || docks.some(dock => dock.container === container))
        return;

    const entry = { container, box: dash._box, boxId: _watchDash(dash) };
    entry.destroyId = container.connect('destroy', () => {
        docks = docks.filter(other => other !== entry);
    });
    docks.push(entry);
}

function _writeDesktopFile(extension, gettextFunc) {
    // Use custom icon if set and valid, otherwise default
    const customIconPath = extension.getSettings().get_string('launchpad-app-custom-icon');
    const iconPath = customIconPath && Gio.File.new_for_path(customIconPath).query_exists(null)
        ? customIconPath
        : extension.dir.resolve_relative_path(ICON_RELATIVE_PATH).get_path();

    // NoDisplay=true would make AppFavorites drop it from the dash
    const desktopContent = `[Desktop Entry]
Type=Application
Name=${gettextFunc('Launchpad')}
Comment=${gettextFunc('Open Application Overview')}
Icon=${iconPath}
Exec=/usr/bin/true
Terminal=false
StartupNotify=false
NoDisplay=false
`;

    const desktopPath = _desktopPath(LAUNCHPAD_DESKTOP_ID);
    GLib.mkdir_with_parents(GLib.path_get_dirname(desktopPath), 0o755);
    try {
        GLib.file_set_contents(desktopPath, desktopContent);
    } catch (e) {
        console.error('Launchpad: Failed to create desktop file:', e);
        return false;
    }
    return true;
}

export function enable(extension, gettext) {
    // extension.js re-runs this on any settings change. A custom-icon change is
    // handled by disabling first, so that path still rewrites the .desktop file.
    if (_enabled)
        return;

    if (!_writeDesktopFile(extension, gettext))
        return;

    _enabled = true;

    if (!Main.overview.isDummy)
        _watchOverviewDash();
    watchDocks({ attach: _attach, count: () => docks.length, globalSignals, sources });

    globalSignals.push([global.settings,
        global.settings.connect('changed::favorite-apps', _pinFavorite)]);
    _pinFavorite();
}

export function disable() {
    _enabled = false;

    for (const key of ['dockSearch', 'overviewDashSearch']) {
        if (sources[key])
            GLib.Source.remove(sources[key]);
        sources[key] = 0;
    }

    disconnectAll(globalSignals);
    globalSignals = [];

    for (const { container, destroyId, box, boxId } of docks) {
        container.disconnect(destroyId);
        box.disconnect(boxId);
    }
    docks = [];

    const favorites = _otherFavorites();
    if (favorites.length !== global.settings.get_strv('favorite-apps').length)
        global.settings.set_strv('favorite-apps', favorites);

    for (const id of [LAUNCHPAD_DESKTOP_ID, OLD_DESKTOP_ID])
        GLib.unlink(_desktopPath(id));
}

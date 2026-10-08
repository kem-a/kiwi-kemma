// SPDX-License-Identifier: GPL-3.0-or-later
// Adds customizable Launchpad icon to the dash, and makes it behave like the native Show Apps button.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { dashOf, disconnectAll, watchDocks } from './dockUtils.js';

Gio._promisify(Gio.File.prototype, 'query_info_async', 'query_info_finish');
Gio._promisify(Gio.File.prototype, 'make_directory_async', 'make_directory_finish');
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'delete_async', 'delete_finish');

const LAUNCHPAD_DESKTOP_ID = 'org.gnome.Shell.Extensions.Kiwi.Launchpad.desktop';
const OLD_DESKTOP_ID = 'launchpad-kiwi.desktop';
const ICON_RELATIVE_PATH = 'icons/launchpad.svg';
// Right after the first favorite, like Launchpad after Finder
const LAUNCHPAD_POSITION = 1;

let _enabled = false; // Guards repeated enable() calls, including pending initialization
let _enableCancellable = null;
// Keep writes and disable-time deletions in order across rapid enable cycles.
let _fileOperations = Promise.resolve();
let globalSignals = [];
let docks = [];
// The watched overview dash can be swapped out from under us, so it is kept
// apart from globalSignals and each watch drops itself when its box dies
let overviewWatches = [];
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

// Route our favorite through the native Show Apps button so dock and overview
// behavior matches it; suppress the app menu.
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

// Dash-to-Dock uses a placeholder without an icon box until startup completes,
// so wait for the real overview dash before attaching.
function _watchOverviewDash() {
    let attempts = 0;
    const tryWatch = () => {
        const {dash} = Main.overview;
        if (dash?._box) {
            const watch = { box: dash._box, childId: _watchDash(dash) };
            // Dash-to-Dock swaps the overview dash in and out; drop the watch
            // with the box so disable() never disconnects a dead actor
            watch.destroyId = watch.box.connect('destroy', () => {
                overviewWatches = overviewWatches.filter(other => other !== watch);
            });
            overviewWatches.push(watch);
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

function _queueFileOperation(operation) {
    const pending = _fileOperations.then(operation);
    _fileOperations = pending.catch(() => {});
    return pending;
}

async function _ensureDirectory(directory, cancellable) {
    try {
        await directory.make_directory_async(GLib.PRIORITY_DEFAULT, cancellable);
    } catch (error) {
        if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            return;
        const parent = directory.get_parent();
        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) || !parent)
            throw error;
        await _ensureDirectory(parent, cancellable);
        await _ensureDirectory(directory, cancellable);
    }
}

async function _writeDesktopFile(extension, gettextFunc, cancellable) {
    if (cancellable.is_cancelled())
        return false;

    // Use custom icon if set and valid, otherwise default
    const customIconPath = extension.getSettings().get_string('launchpad-app-custom-icon');
    let iconPath = extension.dir.resolve_relative_path(ICON_RELATIVE_PATH).get_path();
    if (customIconPath) {
        try {
            await Gio.File.new_for_path(customIconPath).query_info_async(
                'standard::type', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable);
            iconPath = customIconPath;
        } catch (error) {
            if (cancellable.is_cancelled())
                throw error;
            // Missing or unreadable custom icon; use the bundled one.
        }
    }

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

    const desktopFile = Gio.File.new_for_path(_desktopPath(LAUNCHPAD_DESKTOP_ID));

    // Touching the file makes the shell's app cache wait out its reload debounce
    // before the icon is known again, so leave it alone when it already matches
    try {
        const [current] = await desktopFile.load_contents_async(cancellable);
        if (new TextDecoder().decode(current) === desktopContent)
            return true;
    } catch (error) {
        if (cancellable.is_cancelled())
            throw error;
        // Missing or unreadable; write it below
    }

    await _ensureDirectory(desktopFile.get_parent(), cancellable);
    await desktopFile.replace_contents_bytes_async(
        new GLib.Bytes(new TextEncoder().encode(desktopContent)), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable);
    return true;
}

export async function enable(extension, gettext) {
    // extension.js re-runs this on any settings change. A custom-icon change is
    // handled by disabling first, so that path still rewrites the .desktop file.
    if (_enabled)
        return;

    _enabled = true;
    const cancellable = new Gio.Cancellable();
    _enableCancellable = cancellable;
    let ready;
    try {
        ready = await _queueFileOperation(() => _writeDesktopFile(extension, gettext, cancellable));
    } catch (error) {
        if (_enableCancellable === cancellable) {
            _enabled = false;
            _enableCancellable = null;
        }
        if (!cancellable.is_cancelled())
            console.error('Launchpad: Failed to create desktop file:', error);
        return;
    }

    if (!ready || _enableCancellable !== cancellable || cancellable.is_cancelled())
        return;

    if (!Main.overview.isDummy)
        _watchOverviewDash();
    watchDocks({ attach: _attach, count: () => docks.length, globalSignals, sources });

    globalSignals.push([global.settings,
        global.settings.connect('changed::favorite-apps', _pinFavorite)]);
    _pinFavorite();
}

export function disable() {
    _enabled = false;
    _enableCancellable?.cancel();
    _enableCancellable = null;

    for (const key of ['dockSearch', 'overviewDashSearch']) {
        if (sources[key])
            GLib.Source.remove(sources[key]);
        sources[key] = 0;
    }

    disconnectAll(globalSignals);
    globalSignals = [];

    for (const { box, childId, destroyId } of overviewWatches) {
        box.disconnect(childId);
        box.disconnect(destroyId);
    }
    overviewWatches = [];

    for (const { container, destroyId, box, boxId } of docks) {
        container.disconnect(destroyId);
        box.disconnect(boxId);
    }
    docks = [];

    // The shell turns every extension off while the lock screen is up and back on
    // at unlock. Keep the entry and the pin across that: the app cache only
    // rescans seconds after the directory changes, so removing them here would
    // hide the icon on every unlock. A real disable still cleans up.
    if (Main.sessionMode.isLocked)
        return;

    const favorites = _otherFavorites();
    if (favorites.length !== global.settings.get_strv('favorite-apps').length)
        global.settings.set_strv('favorite-apps', favorites);

    _queueFileOperation(async () => {
        for (const id of [LAUNCHPAD_DESKTOP_ID, OLD_DESKTOP_ID]) {
            try {
                await Gio.File.new_for_path(_desktopPath(id)).delete_async(GLib.PRIORITY_DEFAULT, null);
            } catch (error) {
                if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                    console.error('Launchpad: Failed to remove desktop file:', error);
            }
        }
    });
}

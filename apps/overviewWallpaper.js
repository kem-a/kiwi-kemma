// SPDX-License-Identifier: GPL-3.0-or-later
// Generates blurred overview wallpapers that follow light and dark mode changes.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// ============================
// Module State (cleared in disable)
// ============================
let _settings = null;              // Extension settings
let _bgSettings = null;            // GSettings: org.gnome.desktop.background
let _interfaceSettings = null;     // GSettings: org.gnome.desktop.interface
let _bgSignalIds = [];             // Connected wallpaper keys
let _interfaceSignalId = 0;        // Color scheme signal id
let _styleProvider = null;         // Loaded temporary stylesheet file
let _currentAppliedPath = null;    // Currently applied variant path
let _fadeLayer = null;             // Transition overlay widget
let _timeoutId = 0;                // Debounce for single variant regen
let _timeoutAllId = 0;             // Debounce for all variants regen
let _activeProcess = null;         // Last started subprocess
let _pendingGeneration = false;    // Whether a conversion is in progress
let _generationQueue = [];         // FIFO of [scheme, applyAfter]

// ============================
// Constants / Config
// ============================
// sigma and darken adjustment at line 194
const WALLPAPER_SCHEMA = 'org.gnome.desktop.background';
const WALLPAPER_KEY = 'picture-uri';
const WALLPAPER_KEY_DARK = 'picture-uri-dark';
const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const COLOR_SCHEME_KEY = 'color-scheme'; // values: 'default', 'prefer-dark'
const SCHEMES = ['default', 'prefer-dark'];

const TARGET_DIR = GLib.build_filenamev([GLib.get_home_dir(), '.cache', 'kiwi']);
const TARGET_FILE_LIGHT = GLib.build_filenamev([TARGET_DIR, 'overview-blurred-wallpaper-light.jpg']);
const META_FILE_LIGHT = GLib.build_filenamev([TARGET_DIR, 'overview-blurred-wallpaper-light.meta']);
const TARGET_FILE_DARK = GLib.build_filenamev([TARGET_DIR, 'overview-blurred-wallpaper-dark.jpg']);
const META_FILE_DARK = GLib.build_filenamev([TARGET_DIR, 'overview-blurred-wallpaper-dark.meta']);

function _removeFile(path) {
    try {
        const f = Gio.File.new_for_path(path);
        if (f.query_exists(null))
            f.delete(null);
    } catch (_) { /* ignore */ }
}

function _cleanupCache() {
    // Remove generated assets so next enable regenerates fresh copies
    _removeFile(TARGET_FILE_LIGHT);
    _removeFile(META_FILE_LIGHT);
    _removeFile(TARGET_FILE_DARK);
    _removeFile(META_FILE_DARK);
    // Attempt to remove cache dir if empty (optional)
    try {
        const dir = Gio.File.new_for_path(TARGET_DIR);
        if (dir.query_exists(null)) {
            const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info = enumerator.next_file(null);
            if (!info) // empty
                dir.delete(null);
        }
    } catch (_) { /* ignore */ }
}

// Toggleable lightweight logger (kept silent by default to meet guideline: no excessive logging)
function logDebug(_msg) { /* enable for troubleshooting: print(`[kiwi overview wallpaper] ${_msg}`); */ }

function _ensureTargetDir() {
    try {
        const dir = Gio.File.new_for_path(TARGET_DIR);
        if (!dir.query_exists(null))
            dir.make_directory_with_parents(null);
    } catch (e) {
        logDebug('Failed to create target dir: ' + e);
    }
}

function _getWallpaperPathForScheme(scheme) {
    try {
        if (!_bgSettings)
            _bgSettings = new Gio.Settings({ schema: WALLPAPER_SCHEMA });
        let uri = scheme === 'prefer-dark' ? _bgSettings.get_string(WALLPAPER_KEY_DARK) : '';
        if (!uri)
            uri = _bgSettings.get_string(WALLPAPER_KEY);
        if (uri?.startsWith('file://'))
            uri = uri.substring(7);
        return uri || null;
    } catch (e) {
        logDebug('Failed to read wallpaper for scheme ' + scheme + ': ' + e);
        return null;
    }
}

function _imagemagickAvailable() {
    // Require IM7 'magick' command only
    return GLib.find_program_in_path('magick') !== null;
}

function _readMetaPath(metaPath) {
    try {
        const file = Gio.File.new_for_path(metaPath);
        if (!file.query_exists(null)) return null;
        const [ok, bytes] = file.load_contents(null);
        if (!ok) return null;
        return new TextDecoder().decode(bytes).trim() || null;
    } catch (_) { return null; }
}

function _writeMetaPath(metaPath, srcPath) {
    try {
        const file = Gio.File.new_for_path(metaPath);
        file.replace_contents(srcPath + '\n', null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    } catch (_) { /* ignore */ }
}

function _fileMTime(path) {
    try {
        const file = Gio.File.new_for_path(path);
        if (!file.query_exists(null)) return 0;
        const info = file.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null);
        return info.get_attribute_uint64('time::modified');
    } catch (_) { return 0; }
}
function _targetInfoForScheme(scheme) {
    const dark = scheme === 'prefer-dark';
    return {
        target: dark ? TARGET_FILE_DARK : TARGET_FILE_LIGHT,
        meta: dark ? META_FILE_DARK : META_FILE_LIGHT,
    };
}

// XML timed wallpaper resolution helpers
function _isXmlPath(path) {
    return path && path.toLowerCase().endsWith('.xml');
}

function _resolveTimedWallpaper(xmlPath, scheme) {
    if (!_isXmlPath(xmlPath)) return xmlPath;
    
    try {
        const file = Gio.File.new_for_path(xmlPath);
        if (!file.query_exists(null)) return null;
        
        const [ok, bytes] = file.load_contents(null);
        if (!ok) return null;
        
        const xml = new TextDecoder().decode(bytes);
        const xmlDir = GLib.path_get_dirname(xmlPath);
        
        // Extract image paths from <file>, <from>, <to> tags
        const imageRe = /<(?:file|from|to)>\s*([^<]+?)\s*<\/(?:file|from|to)>/gi;
        const images = [];
        let match;
        
        while ((match = imageRe.exec(xml)) !== null) {
            let imagePath = match[1].trim();
            if (!imagePath.startsWith('/')) {
                imagePath = GLib.build_filenamev([xmlDir, imagePath]);
            }
            
            // Verify it's an actual image file that exists
            if (_isImageFile(imagePath) && Gio.File.new_for_path(imagePath).query_exists(null)) {
                images.push(imagePath);
            }
        }
        
        if (images.length === 0) return null;
        
        // Score images based on scheme preference and filename
        const preferDark = scheme === 'prefer-dark';
        let bestImage = images[0];
        let bestScore = -999;
        
        for (const img of images) {
            const basename = GLib.path_get_basename(img).toLowerCase();
            let score = 0;
            
            if (preferDark) {
                if (basename.includes('night') || basename.includes('dark')) score += 20;
                if (basename.includes('day') || basename.includes('light')) score -= 5;
            } else {
                if (basename.includes('day') || basename.includes('light')) score += 20;
                if (basename.includes('night') || basename.includes('dark')) score -= 5;
            }
            
            if (score > bestScore) {
                bestScore = score;
                bestImage = img;
            }
        }
        
        return bestImage;
        
    } catch (e) {
        logDebug('Failed to resolve timed wallpaper XML: ' + e);
        return null;
    }
}

function _isImageFile(path) {
    if (!path) return false;
    const ext = path.toLowerCase();
    return ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png') || 
           ext.endsWith('.webp') || ext.endsWith('.bmp') || ext.endsWith('.tiff') || 
           ext.endsWith('.tif') || ext.endsWith('.jxl');
}

function _needsRegenerationVariant(srcPath, scheme) {
    const { target, meta } = _targetInfoForScheme(scheme);
    if (_fileMTime(target) === 0)
        return true; // no blurred file yet
    if (_readMetaPath(meta) !== srcPath)
        return true; // wallpaper path changed (covers rename, different dark/light file etc.)
    if (_fileMTime(srcPath) > _fileMTime(target))
        return true; // source updated (usually user replaced file contents)
    return false;
}

function _spawnMagickAsync(argv, onComplete) {
    try {
        _activeProcess = new Gio.Subprocess({ argv, flags: Gio.SubprocessFlags.NONE });
        _activeProcess.init(null);
        const procRef = _activeProcess;
        procRef.wait_check_async(null, (proc, res) => {
            try {
                const success = proc.wait_check_finish(res);
                if (proc !== _activeProcess)
                    return; // superseded by a newer request
                if (!success)
                    logDebug(`${argv[0]} exited with non-zero status`);
                onComplete(success);
            } catch (e) {
                if (proc === _activeProcess)
                    logDebug(`${argv[0]} failed: ${e}`);
            }
        });
    } catch (e) {
        logDebug('Failed to start magick process: ' + e);
        onComplete(false);
    }
}

function _processGenerationQueue() {
    if (_pendingGeneration || !_generationQueue.length)
        return;
    const [scheme, applyAfter] = _generationQueue.shift();
    _generateVariant(scheme, applyAfter);
}

function _generateVariant(scheme, applyAfter = false) {
    if (!_imagemagickAvailable()) return;
    let src = _getWallpaperPathForScheme(scheme);
    if (!src) return;
    
    // Resolve XML timed wallpapers to actual image files
    src = _resolveTimedWallpaper(src, scheme);
    if (!src) {
        logDebug('Failed to resolve wallpaper path for scheme: ' + scheme);
        return;
    }
    
    if (_pendingGeneration) {
        _generationQueue.push([scheme, applyAfter]);
        return;
    }
    if (!_needsRegenerationVariant(src, scheme)) {
        if (applyAfter)
            _applyStylesheet();
        return;
    }

    _ensureTargetDir();
    _pendingGeneration = true;

    const isDark = scheme === 'prefer-dark';
    const darkenPercent = isDark ? 20 : 35;     // adjust for preference - light/dark
    const blurSigma = isDark ? '0x25' : '0x20'; // adjust for preference - light/dark

    let targetWidth = 1920;
    try {
        const monitors = Main.layoutManager?.monitors || [];
        if (monitors.length)
            targetWidth = monitors.reduce((m, mon) => Math.max(m, mon.width), 0) || 1920;
    } catch (_) { /* fallback retained */ }

    const { target, meta } = _targetInfoForScheme(scheme);
    const argv = [
        'magick', src,
        '-resize', String(targetWidth),
        '-strip',
        '-fill', 'black', '-colorize', `${darkenPercent}%`,
        '-quality', '85',
        '-blur', blurSigma,
        target,
    ];

    _spawnMagickAsync(argv, success => {
        if (success) {
            _writeMetaPath(meta, src);
            if (applyAfter && _settings?.get_boolean('overview-wallpaper-background'))
                _applyStylesheet();
        }
        _pendingGeneration = false;
        _processGenerationQueue();
    });
}

function _currentScheme() {
    return _interfaceSettings?.get_string(COLOR_SCHEME_KEY) || 'default';
}

function _chooseVariantPathForCurrentScheme() {
    const scheme = _currentScheme();
    const { target } = _targetInfoForScheme(scheme);
    if (Gio.File.new_for_path(target).query_exists(null))
        return target;
    // fallback to opposite variant if main missing
    const { target: fallback } = _targetInfoForScheme(scheme === 'prefer-dark' ? 'default' : 'prefer-dark');
    return fallback;
}

function _updateBaseStylesheet(path) {
    if (_styleProvider) {
        try { St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(_styleProvider); } catch (_) {}
        _styleProvider = null;
    }
    const cssContent = `#overviewGroup {\n  background-image: url("${path}");\n  background-size: cover;\n  background-position: center;\n  background-repeat: no-repeat;\n}`;
    const cssFile = Gio.File.new_tmp('kiwi-overview-bg-XXXXXX.css')[0];
    cssFile.replace_contents(cssContent, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    _styleProvider = cssFile;
    St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(cssFile);
    _currentAppliedPath = path;
}

function _animateTransitionTo(chosen) {
    const overviewGroup = Main.layoutManager?.overviewGroup;
    if (!overviewGroup) { // fallback: no animation
        _updateBaseStylesheet(chosen);
        return;
    }
    if (_fadeLayer) {
        try { _fadeLayer.destroy(); } catch (_) {}
        _fadeLayer = null;
    }
    _fadeLayer = new St.Widget({
        reactive: false,
        opacity: 0,
        style: `background-image: url("${chosen}"); background-size: cover; background-position: center; background-repeat: no-repeat;`,
    });
    _fadeLayer.set_x_expand(true);
    _fadeLayer.set_y_expand(true);
    overviewGroup.add_child(_fadeLayer);
    overviewGroup.set_child_above_sibling(_fadeLayer, null);
    _fadeLayer.ease({
        opacity: 255,
        duration: 400,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
            try { _updateBaseStylesheet(chosen); } catch (e) { logDebug('Failed to finalize stylesheet: ' + e); }
            if (_fadeLayer) {
                try { _fadeLayer.destroy(); } catch (_) {}
                _fadeLayer = null;
            }
        },
    });
}

function _applyStylesheet() {
    const chosen = _chooseVariantPathForCurrentScheme();
    if (!chosen || chosen === _currentAppliedPath)
        return;
    if (!Gio.File.new_for_path(chosen).query_exists(null))
        return;
    if (!_currentAppliedPath) {
        try { _updateBaseStylesheet(chosen); } catch (e) { logDebug('Failed initial apply: ' + e); }
        return;
    }
    _animateTransitionTo(chosen);
}

function _queueRegenerate() {
    if (_timeoutId) {
        GLib.source_remove(_timeoutId);
        _timeoutId = 0;
    }
    // Debounce multiple quick changes
    _timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        _timeoutId = 0;
    // regenerate only current scheme variant
    _generateVariant(_currentScheme(), true);
        return GLib.SOURCE_REMOVE;
    });
}

function _queueRegenerateAllVariants() {
    if (_timeoutAllId) {
        GLib.source_remove(_timeoutAllId);
        _timeoutAllId = 0;
    }
    _timeoutAllId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
        _timeoutAllId = 0;
        SCHEMES.forEach(scheme => {
            let src = _getWallpaperPathForScheme(scheme);
            if (src) {
                src = _resolveTimedWallpaper(src, scheme);
                if (src && _needsRegenerationVariant(src, scheme))
                    _generateVariant(scheme, scheme === _currentScheme());
            }
        });
        return GLib.SOURCE_REMOVE;
    });
}

// NOTE: _regenerateImmediate removed (unused) – queue-based approach covers live scenarios.

export function enable(settings) {
    _settings = settings;
    if (!_settings.get_boolean('overview-wallpaper-background'))
        return;
    if (!_bgSettings)
        _bgSettings = new Gio.Settings({ schema: WALLPAPER_SCHEMA });
    if (!_interfaceSettings)
        _interfaceSettings = new Gio.Settings({ schema: INTERFACE_SCHEMA });

    if (!_imagemagickAvailable()) {
        logDebug('ImageMagick not installed; feature disabled');
        return;
    }

    // Connect wallpaper change signals (both light and dark variants)
    [WALLPAPER_KEY, WALLPAPER_KEY_DARK].forEach(key => {
        try {
            const id = _bgSettings.connect('changed::' + key, () => _queueRegenerateAllVariants());
            _bgSignalIds.push(id);
        } catch (e) {
            logDebug('Failed to connect wallpaper key ' + key + ': ' + e);
        }
    });

    // Connect color scheme changes
    try {
        _interfaceSignalId = _interfaceSettings.connect('changed::' + COLOR_SCHEME_KEY, () => _queueRegenerate());
    } catch (e) {
        logDebug('Failed to connect color scheme: ' + e);
    }

    // Apply any existing cached variant immediately (no animation first time)
    _applyStylesheet();
    // Pre-generate / refresh both variants if needed
    SCHEMES.forEach(scheme => {
        let src = _getWallpaperPathForScheme(scheme);
        if (src) {
            src = _resolveTimedWallpaper(src, scheme);
            if (src && _needsRegenerationVariant(src, scheme))
                _generateVariant(scheme, scheme === _currentScheme());
        }
    });
}

export function refresh() {
    if (!_settings || !_settings.get_boolean('overview-wallpaper-background')) return;
    // Refresh only current scheme variant
    const scheme = _currentScheme();
    let src = _getWallpaperPathForScheme(scheme);
    if (src) {
        src = _resolveTimedWallpaper(src, scheme);
        if (src && _needsRegenerationVariant(src, scheme))
            _generateVariant(scheme, true);
        else
            _applyStylesheet();
    }
}

export function disable() {
    if (_timeoutId) {
        GLib.source_remove(_timeoutId);
        _timeoutId = 0;
    }
    // Disconnect wallpaper signals
    if (_bgSettings && _bgSignalIds.length) {
        _bgSignalIds.forEach(id => { try { _bgSettings.disconnect(id); } catch (_) {} });
    }
    _bgSignalIds = [];
    // Disconnect color scheme
    if (_interfaceSettings && _interfaceSignalId) {
        try { _interfaceSettings.disconnect(_interfaceSignalId); } catch (_) {}
    }
    _interfaceSignalId = 0;
    if (_styleProvider) {
        try {
            St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(_styleProvider);
        } catch (e) { /* ignore */ }
        _styleProvider = null;
    }
    // Terminate any running conversion early to avoid writing after cleanup
    try {
        if (_activeProcess && !_activeProcess.get_if_exited())
            _activeProcess.force_exit();
    } catch (_) { /* ignore */ }
    _activeProcess = null;
    _settings = null;
    _pendingGeneration = false;
    if (_fadeLayer) {
        try { _fadeLayer.destroy(); } catch (_) {}
        _fadeLayer = null;
    }
    _currentAppliedPath = null;
    if (_timeoutAllId) {
        GLib.source_remove(_timeoutAllId);
        _timeoutAllId = 0;
    }
    // Clear cached blurred images & meta files
    _cleanupCache();
}

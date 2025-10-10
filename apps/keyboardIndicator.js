// SPDX-License-Identifier: GPL-3.0-or-later
// Adjusts the top-panel keyboard indicator to match user preferences.

import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';

let _state = null;

function _syncIndicatorState() {
    if (!_state?.indicator)
        return;
    const isVisible = _applyVisibility();
    _applyTheme(isVisible);
    _updateLabel();
}

function _normalizeSourceId(id) {
    if (!id)
        return null;
    const m = String(id).match(/^[A-Za-z]+/);
    return m ? m[0].toLowerCase() : null;
}

function _getCurrentInputSource() {
    // Get current input source from GNOME Shell's InputSourceManager
    const inputSourceManager = Keyboard.getInputSourceManager();
    if (!inputSourceManager)
        return null;
    const currentSource = inputSourceManager.currentSource;
    return currentSource ? _normalizeSourceId(currentSource.id) : null;
}

function _onInputSourceChanged() {
    // Called when system input source changes via InputSourceManager
    _updateLabel();
}

function _getIndicator() {
    const sa = Main.panel?.statusArea;
    if (!sa)
        return null;
    return sa.keyboard || sa.inputSource || sa.inputMethod || null;
}

function _findLabel(root) {
    if (!root || !root.get_children)
        return null;
    const stack = [root];
    let fallback = null;
    while (stack.length) {
        const node = stack.pop();
        if (node instanceof St.Label) {
            // Prefer labels that are visible and have some text
            const text = node.text ?? '';
            if (node.visible && text.length > 0)
                return node;
            // Keep as last resort if nothing else found (do not store globally)
            if (!fallback)
                fallback = node;
        }
        const children = node.get_children?.();
        if (children && children.length)
            stack.push(...children);
    }
    return fallback;
}

function _ensureLabelRef() {
    if (!_state?.indicator)
        return;
    const newLabel = _findLabel(_state.indicator);
    if (newLabel === _state.label)
        return;
    // Reconnect notify::text to the current label actor
    if (_state.label) {
        if (_state.labelChangedId) {
            try { _state.label.disconnect(_state.labelChangedId); } catch (_e) {}
            _state.labelChangedId = 0;
        }
        if (_state.labelDestroyId) {
            try { _state.label.disconnect(_state.labelDestroyId); } catch (_e) {}
            _state.labelDestroyId = 0;
        }
    }
    _state.label = newLabel;
    if (_state.label) {
        // Track actor destruction to avoid accessing disposed objects
        _state.labelDestroyId = _state.label.connect('destroy', obj => {
            if (!_state || obj !== _state.label)
                return;
            // Clear connections tracked for this label
            if (_state.labelChangedId) {
                try { obj.disconnect(_state.labelChangedId); } catch (_e) {}
                _state.labelChangedId = 0;
            }
            if (_state.labelDestroyId) {
                try { obj.disconnect(_state.labelDestroyId); } catch (_e) {}
                _state.labelDestroyId = 0;
            }
            _state.label = null;
            // Refresh on next idle to locate a replacement label safely
            if (!_state.idleId) {
                _state.idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    if (_state) {
                        _state.idleId = 0;
                        _ensureLabelRef();
                        _syncIndicatorState();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
        _state.labelChangedId = _state.label.connect('notify::text', _updateLabel);
    }
}

function _applyVisibility() {
    if (!_state?.indicator)
        return false;
    const hidden = _state.settings.get_boolean('hide-keyboard-indicator');
    const shellVisible = _state.shellVisible ?? _state.indicator.visible;
    if (_state.indicator._kiwiOriginalVisible === undefined)
        _state.indicator._kiwiOriginalVisible = shellVisible;
    const shouldBeVisible = !hidden && shellVisible;
    if (_state.indicator.visible === shouldBeVisible)
        return shouldBeVisible;
    _state.updatingVisibility = true;
    try {
        _state.indicator.visible = shouldBeVisible;
    } finally {
        _state.updatingVisibility = false;
    }
    return shouldBeVisible;
}

function _applyTheme(isVisible = _state?.indicator?.visible ?? false) {
    if (!_state?.indicator)
        return;
    if (!isVisible) {
        try { _state.indicator.remove_style_class_name('kiwi-input-themed'); } catch (_e) {}
        try { _state.indicator.remove_style_class_name('kiwi-input-en'); } catch (_e) {}
        return;
    }
    try { _state.indicator.add_style_class_name('kiwi-input-themed'); } catch (_e) {}
}

function _updateLabel() {
    if (!_state?.indicator)
        return;
    // Refresh label reference in case the indicator swapped its child label
    _ensureLabelRef();
    if (!_state.label)
        return;

    const label = _state.label;

    // If theming class isn't present (feature disabled), ensure we don't change anything
    if (!_state.indicator.has_style_class_name('kiwi-input-themed')) {
        try {
            if (label && label._kiwiOriginalText !== undefined) {
                try {
                    if (label.text !== label._kiwiOriginalText)
                        label.text = label._kiwiOriginalText;
                } catch (_e) { /* label may be disposed */ }
            }
        } catch (_e) {}
        try { _state.indicator.remove_style_class_name('kiwi-input-en'); } catch (_e) {}
        return;
    }

    // Save original text if not already saved for this label actor
    if (!label._kiwiOriginalText) {
        try { label._kiwiOriginalText = label.text; } catch (_e) { return; }
    }

    // Get the current text (what's actually displayed in panel)
    let currentText = '';
    try { currentText = label.text || ''; } catch (_e) { return; }
    let nextText = currentText;

    // Helpers
    const alphaText = String(currentText).match(/^[A-Za-z]{1,3}$/)?.[0] || '';
    const lowerText = alphaText.toLowerCase();
    const EN_SET = new Set(['en', 'us', 'gb']);

    // Prefer system source code; but avoid applying EN mapping when the label clearly shows a non-EN code (race-safe)
    const code = _getCurrentInputSource();
    const codeLower = _normalizeSourceId(code);

    if (codeLower && EN_SET.has(codeLower)) {
        if (!alphaText || EN_SET.has(lowerText)) {
            // Both system and label indicate EN (or label empty); map to 'A'
            nextText = 'A';
            _state.indicator.add_style_class_name('kiwi-input-en');
        } else if (alphaText.length <= 3) {
            // Label shows a different layout explicitly; trust label and uppercase it
            nextText = alphaText.toUpperCase();
            _state.indicator.remove_style_class_name('kiwi-input-en');
        }
    } else if (alphaText) {
        // Non-EN code displayed in label; uppercase it
        nextText = alphaText.toUpperCase();
        _state.indicator.remove_style_class_name('kiwi-input-en');
    } else if (codeLower) {
        // No short label, but we have a system code; use it when short
        if (codeLower.length <= 3) {
            nextText = codeLower.toUpperCase();
            _state.indicator.remove_style_class_name('kiwi-input-en');
        }
    }

    try {
        if (label.text !== nextText)
            label.text = nextText;
    } catch (_e) { return; }

    // Maintain hidden state if requested
    _applyVisibility();
}

function _connect() {
    if (!_state?.indicator)
        return;
    // Ensure we are connected to the current label actor
    _ensureLabelRef();
    if (!_state.visibilityChangedId)
        _state.visibilityChangedId = _state.indicator.connect('notify::visible', actor => {
            if (!_state || _state.updatingVisibility)
                return;
            _state.shellVisible = actor.visible;
            actor._kiwiOriginalVisible = actor.visible;
            _syncIndicatorState();
        });
    // Connect to InputSourceManager for proper input source change detection
    const inputSourceManager = Keyboard.getInputSourceManager();
    if (inputSourceManager && !_state.inputManagerChangedId) {
        _state.inputManagerChangedId = inputSourceManager.connect('current-source-changed', _onInputSourceChanged);
    }
}

function _disconnect() {
    if (_state?.label && _state.labelChangedId) {
        try { _state.label.disconnect(_state.labelChangedId); } catch (_e) {}
        _state.labelChangedId = 0;
    }
    if (_state?.label && _state.labelDestroyId) {
        try { _state.label.disconnect(_state.labelDestroyId); } catch (_e) {}
        _state.labelDestroyId = 0;
    }
    if (_state?.inputManagerChangedId) {
        const inputSourceManager = Keyboard.getInputSourceManager();
        if (inputSourceManager) {
            inputSourceManager.disconnect(_state.inputManagerChangedId);
        }
        _state.inputManagerChangedId = 0;
    }
    if (_state?.visibilityChangedId && _state.indicator) {
        try { _state.indicator.disconnect(_state.visibilityChangedId); } catch (_e) {}
        _state.visibilityChangedId = 0;
    }
    if (_state?.idleId) {
        try { GLib.source_remove(_state.idleId); } catch (_e) {}
        _state.idleId = 0;
    }
}

export function enable(settings) {
    if (_state)
        return;
    const indicator = _getIndicator();
    if (!indicator)
        return;
    _state = {
        indicator,
        label: null,
        settings,
        labelChangedId: 0,
        labelDestroyId: 0,
        inputManagerChangedId: 0,
        visibilityChangedId: 0,
        shellVisible: indicator.visible,
        updatingVisibility: false,
        idleId: 0,
    };
    _ensureLabelRef();
    _connect();
    _syncIndicatorState();
}

export function disable() {
    if (!_state)
        return;
    _disconnect();
    try {
        // Try to restore any label we touched
        const labels = new Set();
        if (_state.label)
            labels.add(_state.label);
        const currentLabel = _findLabel(_state.indicator);
        if (currentLabel)
            labels.add(currentLabel);
        for (const lb of labels) {
            try {
                if (lb && lb._kiwiOriginalText !== undefined) {
                    try {
                        if (lb.text !== lb._kiwiOriginalText)
                            lb.text = lb._kiwiOriginalText;
                    } catch (_e) {}
                    // Clear the marker to avoid leaking state
                    lb._kiwiOriginalText = undefined;
                }
            } catch (_e) {}
        }
    } catch (_e) {}
    if (_state.indicator) {
        try {
            if (_state.shellVisible !== undefined)
                _state.indicator.visible = _state.shellVisible;
        } catch (_e) {}
        try {
            if (_state.indicator._kiwiOriginalVisible !== undefined)
                _state.indicator._kiwiOriginalVisible = undefined;
        } catch (_e) {}
        try { _state.indicator.remove_style_class_name('kiwi-input-themed'); } catch (_e) {}
        try { _state.indicator.remove_style_class_name('kiwi-input-en'); } catch (_e) {}
    }
    _state = null;
}

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
    const m = id.match(/^[A-Za-z]+/);
    return m ? m[0].toLowerCase() : null;
}

function _getCurrentInputSource() {
    const currentSource = Keyboard.getInputSourceManager().currentSource;
    return currentSource ? _normalizeSourceId(currentSource.id) : null;
}

function _onInputSourceChanged() {
    // Called when system input source changes via InputSourceManager
    _updateLabel();
}

// The indicator is torn down with the panel (shell shutdown, status area
// rebuild). Its label is destroyed with it, and the destroy handler below
// schedules an idle refresh — which then walked an already-disposed indicator.
// Drop every reference and the pending idle while the object is still alive.
function _onIndicatorDestroyed() {
    if (_state.idleId) {
        GLib.Source.remove(_state.idleId);
        _state.idleId = 0;
    }
    // Children are still alive while the parent's destroy handler runs
    if (_state.label) {
        _state.label.disconnect(_state.labelChangedId);
        _state.label.disconnect(_state.labelDestroyId);
    }
    _state.indicator = null;
    _state.indicatorDestroyId = 0;
    _state.visibilityChangedId = 0;
    _state.label = null;
    _state.labelChangedId = 0;
    _state.labelDestroyId = 0;
}

function _findLabel(root) {
    if (!root)
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
        stack.push(...node.get_children());
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
            _state.label.disconnect(_state.labelChangedId);
            _state.labelChangedId = 0;
        }
        if (_state.labelDestroyId) {
            _state.label.disconnect(_state.labelDestroyId);
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
                obj.disconnect(_state.labelChangedId);
                _state.labelChangedId = 0;
            }
            if (_state.labelDestroyId) {
                obj.disconnect(_state.labelDestroyId);
                _state.labelDestroyId = 0;
            }
            _state.label = null;
            // Refresh on next idle to locate a replacement label safely
            if (!_state.idleId) {
                _state.idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    _state.idleId = 0;
                    _ensureLabelRef();
                    _syncIndicatorState();
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
        _state.labelChangedId = _state.label.connect('notify::text', _updateLabel);
    }
}

function _applyVisibility() {
    const hidden = _state.settings.get_boolean('hide-keyboard-indicator');
    const shouldBeVisible = !hidden && _state.shellVisible;
    if (_state.indicator.visible === shouldBeVisible)
        return shouldBeVisible;
    _state.updatingVisibility = true;
    _state.indicator.visible = shouldBeVisible;
    _state.updatingVisibility = false;
    return shouldBeVisible;
}

function _applyTheme(isVisible) {
    if (!isVisible) {
        _state.indicator.remove_style_class_name('kiwi-input-themed');
        _state.indicator.remove_style_class_name('kiwi-input-en');
        return;
    }
    _state.indicator.add_style_class_name('kiwi-input-themed');
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
        if (label._kiwiOriginalText !== undefined) {
            if (label.text !== label._kiwiOriginalText)
                label.text = label._kiwiOriginalText;
        }
        _state.indicator.remove_style_class_name('kiwi-input-en');
        return;
    }

    // Save original text if not already saved for this label actor
    if (!label._kiwiOriginalText) {
        label._kiwiOriginalText = label.text;
    }

    // Get the current text (what's actually displayed in panel)
    let currentText = label.text || '';
    let nextText = currentText;

    // Helpers
    const alphaText = currentText.match(/^[A-Za-z]{1,3}$/)?.[0] || '';
    const lowerText = alphaText.toLowerCase();
    const EN_SET = new Set(['en', 'us', 'gb']);
    // 'a' is the text we mapped ourselves on a previous pass — it still means EN
    const LABEL_EN_SET = new Set([...EN_SET, 'a']);

    // Prefer system source code; but avoid applying EN mapping when the label clearly shows a non-EN code (race-safe)
    const codeLower = _getCurrentInputSource();

    if (codeLower && EN_SET.has(codeLower)) {
        if (!alphaText || LABEL_EN_SET.has(lowerText)) {
            // Both system and label indicate EN (or label empty); map to 'A'
            nextText = 'A';
            _state.indicator.add_style_class_name('kiwi-input-en');
        } else {
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

    if (label.text !== nextText)
        label.text = nextText;

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
            _syncIndicatorState();
        });
    // Connect to InputSourceManager for proper input source change detection
    if (!_state.inputManagerChangedId) {
        _state.inputManagerChangedId = Keyboard.getInputSourceManager().connect('current-source-changed', _onInputSourceChanged);
    }
}

function _disconnect() {
    if (_state.label && _state.labelChangedId) {
        _state.label.disconnect(_state.labelChangedId);
        _state.labelChangedId = 0;
    }
    if (_state.label && _state.labelDestroyId) {
        _state.label.disconnect(_state.labelDestroyId);
        _state.labelDestroyId = 0;
    }
    if (_state.inputManagerChangedId) {
        Keyboard.getInputSourceManager().disconnect(_state.inputManagerChangedId);
        _state.inputManagerChangedId = 0;
    }
    if (_state.visibilityChangedId && _state.indicator) {
        _state.indicator.disconnect(_state.visibilityChangedId);
        _state.visibilityChangedId = 0;
    }
    if (_state.indicatorDestroyId && _state.indicator) {
        _state.indicator.disconnect(_state.indicatorDestroyId);
        _state.indicatorDestroyId = 0;
    }
    if (_state.idleId) {
        GLib.Source.remove(_state.idleId);
        _state.idleId = 0;
    }
}

export function enable(settings) {
    if (_state)
        return;
    const indicator = Main.panel.statusArea.keyboard;
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
        indicatorDestroyId: 0,
    };
    _state.indicatorDestroyId = indicator.connect('destroy', _onIndicatorDestroyed);
    _ensureLabelRef();
    _connect();
    _syncIndicatorState();
}

export function disable() {
    // _state is null only when enable() found no indicator, so nothing was touched
    if (_state) {
        _disconnect();
        // Try to restore any label we touched
        const labels = new Set();
        if (_state.label)
            labels.add(_state.label);
        const currentLabel = _findLabel(_state.indicator);
        if (currentLabel)
            labels.add(currentLabel);
        for (const lb of labels) {
            if (lb._kiwiOriginalText !== undefined) {
                if (lb.text !== lb._kiwiOriginalText)
                    lb.text = lb._kiwiOriginalText;
                // Clear the marker to avoid leaking state
                lb._kiwiOriginalText = undefined;
            }
        }
        if (_state.indicator) {
            _state.indicator.visible = _state.shellVisible;
            _state.indicator.remove_style_class_name('kiwi-input-themed');
            _state.indicator.remove_style_class_name('kiwi-input-en');
        }
    }
    _state = null;
}

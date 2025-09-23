# Kiwi Extension Copilot Instructions

## Architecture Overview

Kiwi is a GNOME Shell extension that provides macOS-like features through a modular architecture:

- **Main Extension** (`extension.js`): Orchestrates all features through enable/disable lifecycle
- **Feature Modules** (`apps/`): Independent modules implementing specific features (window controls, transparency, etc.)
- **GTK Theme System** (`icons/`, `gtkThemeManager.js`): Dynamic CSS injection for window button styling
- **Settings Schema** (`schemas/`): GSettings-based configuration with compiled schemas
- **Advanced Features** (`advanced/`): Native C libraries for features not allowed in GNOME Extensions store

## Critical Development Patterns

### Module Architecture
Each feature module in `apps/` follows a strict pattern:
```javascript
export function enable() { /* setup */ }
export function disable() { /* cleanup */ }
```
- Always implement both functions, even if disable() is empty
- Store signal connections and clean them up in disable()
- Use `Extension.lookupByUUID('kiwi@kemma')` to access extension context

### Settings Integration
- Settings changes trigger `_on_settings_changed()` in main extension
- Each module is enabled/disabled based on corresponding boolean setting
- GTK theme updates are handled automatically by `gtkThemeManager.js`
- Always use `this._settings.get_boolean()` / `get_string()` for configuration

### GTK Theme Management
The `gtkThemeManager.js` dynamically generates `gtk3.css` and `gtk4.css` based on settings:
- Conditionally imports titlebutton styles (`titlebuttons3.css`, `titlebuttons-alt3.css`)
- Adds titlebar hiding CSS when panel controls are enabled
- Always includes fixes CSS files
- Updates require `@import` statements, not inline CSS

### Window Management Patterns
- Use `global.workspace_manager` for workspace operations
- Store workspace indices, not raw `Meta.Workspace` objects (prevents segfaults)
- Defer workspace removal with `GLib.idle_add()` to avoid race conditions
- Track window states with Map collections: `this._windowSignals = new Map()`

## Critical Workflows

### Building and Testing
```bash
# Compile settings schema (required after schema changes)
glib-compile-schemas schemas/

# Install for testing
cp -r . ~/.local/share/gnome-shell/extensions/kiwi@kemma
# Restart GNOME Shell: Alt+F2, type 'r', Enter
```

### Advanced Features (Native Libraries)
```bash
cd advanced/
./install-extra.sh  # Uses pre-compiled .so file
./compile-extra.sh  # Compile from source if needed
```

### Preferences UI
- Built with GTK4/Adwaita in `prefs.js`
- Uses `Adw.PreferencesPage` and `Adw.PreferencesGroup` structure
- Settings are two-way bound with `settings.bind()`

## GNOME Shell Integration Points

### Panel Integration
- Window controls: Custom `PanelMenu.Button` with hover effects
- Use `Main.panel.addToStatusArea()` for panel widgets
- Style with CSS classes in `stylesheet.css`

### Workspace/Window Tracking
- Connect to `global.display` for window-created events
- Use `global.workspace_manager` for workspace operations  
- Always validate workspace existence before operations

### Settings and Signals
- Settings changes automatically trigger feature enable/disable
- Use signal IDs for cleanup: `this._settingsChangedId = settings.connect(...)`
- Disconnect all signals in disable() to prevent memory leaks

## Common Issues and Solutions

### Segfault Prevention
- Never store raw `Meta.Workspace` objects on windows
- Use `GLib.idle_add()` for workspace removal operations
- Validate workspace indices before accessing workspaces

### CSS Theme Updates
- GTK theme changes require both gtk3.css and gtk4.css updates
- Use `gtkThemeManager.updateGtkCss()` for consistent theme application
- Flatpak apps need additional filesystem permissions for theming

### Extension Distribution
- GNOME Extensions store prohibits compiled `.so` files
- Advanced features with native libraries go in `advanced/` folder
- Include pre-compiled binaries with source for user convenience

## Key Files to Understand
- `extension.js`: Main orchestration and settings handling
- `apps/windowControls.js`: Complex panel integration example
- `apps/gtkThemeManager.js`: Dynamic CSS generation pattern
- `schemas/org.gnome.shell.extensions.kiwi.gschema.xml`: Settings definition
- `advanced/README.md`: Native library integration approach


# GNOME Shell Extensions Review Guidelines - Key Points

## Critical Rules to Check:

### 1. Initialization and Cleanup

- **RULE**: Don't create/modify anything before `enable()` is called
- **RULE**: Use `enable()` to create objects, connect signals, add main loop sources
- **RULE**: Use `disable()` to cleanup everything done in `enable()`

### 2. Object Management

- **RULE**: Destroy all objects in `disable()` - any GObject classes must be destroyed
- **RULE**: Disconnect all signal connections in `disable()`
- **RULE**: Remove all main loop sources in `disable()`
  - Track every `GLib.timeout_add`, `GLib.idle_add`, `GLib.interval_add`, `Mainloop.timeout_add`, `imports.misc.util.setTimeout`, etc.
  - Store returned source IDs in module/class fields (e.g. `this._timeoutId`, array) and clear them in `disable()` / `destroy()` with `GLib.source_remove(id)` (or `GLib.Source.remove(id)` depending on API style) then null out the reference.
  - If a repeating source returns `GLib.SOURCE_CONTINUE`, ensure you remove it explicitly on cleanup.
  - Never leave anonymous timeouts untracked.

### 3. Import Restrictions

- **RULE**: Do not use deprecated modules (ByteArray, Lang, Mainloop)
- **RULE**: Do not import GTK libraries (Gdk, Gtk, Adw) in GNOME Shell process
- **RULE**: Do not import GNOME Shell libraries (Clutter, Meta, St, Shell) in preferences

### 4. Code Quality

- **RULE**: Code must not be obfuscated or minified
- **RULE**: No excessive logging
- **RULE**: Use modern ES6 features, avoid deprecated patterns

### 5. Common Issues to Look For:

- Unused imports/declarations
- Variables declared but not properly cleaned up
- Signal connections without disconnection
- Objects created but not destroyed
- Main loop sources not removed
- Static resources created during initialization instead of enable()

## What to Check in Each File:

1. ✅ Are all imports actually used?
2. ✅ Are objects properly destroyed in disable()?
3. ✅ Are signal connections properly disconnected?
4. ✅ Are main loop sources properly removed?
5. ✅ No deprecated modules?
6. ✅ No object creation during initialization?
7. ✅ Proper ES6 usage?
8. ✅ EVERY timeout/idle/interval tracked & removed? (Search: `timeout_add`, `idle_add`, `SOURCE_CONTINUE`)
9. ✅ No lingering source IDs after disable? (Manually invoke enable/disable cycle in review)

### Quick Audit Procedure (Never Skip):

1. Grep: `grep -R "timeout_add\|idle_add\|SOURCE_CONTINUE" apps/` and ensure each result stores an ID.
2. Verify each stored ID is removed in `disable()` / `destroy()` (or via an intermediate cleanup function).
3. For classes: confirm `destroy()` clears all sources before calling `super.destroy()`.
4. For modules: confirm `disable()` clears module-level arrays/maps of sources.
5. If a timeout self-clears (one-shot returning `SOURCE_REMOVE`) still track it if created conditionally so you can cancel it when disabling early.

If ANY source isn’t tracked, BLOCK MERGE until fixed.


# This document contains links to Gnome shell extensions and Gnome shell development documents


## [Gnome Shell Reference API](https://gjs-docs.gnome.org/)


## [Gnone Shell Developer Guide](https://gjs.guide/guides/)


## [Gnome Shell extensions Guide](https://gjs.guide/extensions/)

### [Gnome Shell Extensions Review Guidlines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)

### Development
#### [Getting started](https://gjs.guide/extensions/development/creating.html)
#### [Translations](https://gjs.guide/extensions/development/translations.html)
#### [Preferences](https://gjs.guide/extensions/development/preferences.html)
#### [Accessibility](https://gjs.guide/extensions/development/accessibility.html)
#### [Debugging](https://gjs.guide/extensions/development/debugging.html)
#### [Targeting Older GNOME Versions](https://gjs.guide/extensions/development/targeting-older-gnome.html)
#### [TypeScript and LSP ](https://gjs.guide/extensions/development/typescript.html)


### Overview
#### [Anatomy of an Extension](https://gjs.guide/extensions/overview/anatomy.html)
#### [Architecture](https://gjs.guide/extensions/overview/architecture.html)
#### [Imports and Modules](https://gjs.guide/extensions/overview/imports-and-modules.html)
#### [Updates and Breakage](https://gjs.guide/extensions/overview/updates-and-breakage.html)


### Topics
#### [Extension (ESModule)](https://gjs.guide/extensions/topics/extension.html)
#### [Dialogs](https://gjs.guide/extensions/topics/dialogs.html)
#### [Notifications](https://gjs.guide/extensions/topics/notifications.html)
#### [Popup Menu](https://gjs.guide/extensions/topics/popup-menu.html)
#### [Quick Settings](https://gjs.guide/extensions/topics/quick-settings.html)
#### [Search Provider](https://gjs.guide/extensions/topics/search-provider.html)
#### [Session Modes](https://gjs.guide/extensions/topics/session-modes.html)
#### [Port Extensions to GNOME Shell 49](https://gjs.guide/extensions/upgrading/gnome-shell-49.html)
#### [Port Extensions to GNOME Shell 48](https://gjs.guide/extensions/upgrading/gnome-shell-48.html)

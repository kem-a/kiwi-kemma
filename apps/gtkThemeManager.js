// gtkThemeManager.js - Manages GTK CSS imports based on settings
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

let settings = null;
let settingsChangedId = null;

async function updateGtkCss() {
    const extension = Extension.lookupByUUID('kiwi@kemma');
    const enableAppButtons = settings.get_boolean('enable-app-window-buttons');
    const showControlsOnPanel = settings.get_boolean('show-window-controls');
    const buttonType = settings.get_string('button-type');
    
    // Define GTK 3 and GTK 4 specific content
    let gtk3Content = '';
    let gtk4Content = '';
    
    // Add titlebuttons CSS only if app window buttons are enabled
    if (enableAppButtons) {
        if (buttonType === 'titlebuttons-alt') {
            gtk3Content += `@import 'titlebuttons-alt3.css';\n`;
            gtk4Content += `@import 'titlebuttons-alt4.css';\n`;
        } else if (buttonType === 'titlebuttons-png') {
            gtk3Content += `@import 'titlebuttons-png3.css';\n`;
            gtk4Content += `@import 'titlebuttons-png4.css';\n`;
        } else {
            // Default to titlebuttons
            gtk3Content += `@import 'titlebuttons3.css';\n`;
            gtk4Content += `@import 'titlebuttons4.css';\n`;
        }
    }
    
    // Add hide-titlebar CSS if window controls should be shown in panel
    if (showControlsOnPanel) {
        gtk3Content += `@import 'hide-titlebar3.css';\n`;
        gtk4Content += `@import 'hide-titlebar4.css';\n`;
    }
    
    // Always add fixes CSS at the end
    gtk3Content += `\n@import 'fixes3.css';\n`;
    gtk4Content += `\n@import 'fixes4.css';\n`;
    
    // Update both GTK 3 and GTK 4 files in the icons folder
    const gtk3Path = `${extension.path}/icons/gtk3.css`;
    const gtk4Path = `${extension.path}/icons/gtk4.css`;
    
    try {
        // Write to GTK 3.0 file
        const gtk3File = Gio.File.new_for_path(gtk3Path);
        gtk3File.replace_contents(gtk3Content, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        
        // Write to GTK 4.0 file
        const gtk4File = Gio.File.new_for_path(gtk4Path);
        gtk4File.replace_contents(gtk4Content, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        
        // Update user GTK config files with imports
        await createUserGtkConfig();
        
        console.log(`[Kiwi] Updated GTK CSS files. App buttons: ${enableAppButtons}, Button type: ${buttonType}, Panel controls: ${showControlsOnPanel}`);
    } catch (error) {
        console.error(`[Kiwi] Error updating GTK CSS files: ${error}`);
    }
}

async function createUserGtkConfig() {
    try {
        const extension = Extension.lookupByUUID('kiwi@kemma');
        const homeDir = GLib.get_home_dir();
        
        // Create user GTK config directories if they don't exist
        const gtk3ConfigDir = `${homeDir}/.config/gtk-3.0`;
        const gtk4ConfigDir = `${homeDir}/.config/gtk-4.0`;
        
        GLib.mkdir_with_parents(gtk3ConfigDir, 0o755);
        GLib.mkdir_with_parents(gtk4ConfigDir, 0o755);
        
        // Define the import lines
        const gtk3ImportLine = `@import '${extension.path}/icons/gtk3.css';\n`;
        const gtk4ImportLine = `@import '${extension.path}/icons/gtk4.css';\n`;
        
        // Paths to user GTK CSS files
        const gtk3UserPath = `${gtk3ConfigDir}/gtk.css`;
        const gtk4UserPath = `${gtk4ConfigDir}/gtk.css`;
        
        // Process GTK 3 config
        await processUserGtkFile(gtk3UserPath, gtk3ImportLine);
        
        // Process GTK 4 config
        await processUserGtkFile(gtk4UserPath, gtk4ImportLine);
        
        console.log('[Kiwi] Added imports to user GTK config files');
        
    } catch (error) {
        console.error(`[Kiwi] Error creating user GTK config: ${error}`);
    }
}

async function processUserGtkFile(filePath, importLine) {
    try {
        const file = Gio.File.new_for_path(filePath);
        let existingContent = '';
        
        // Read existing content if file exists
        if (file.query_exists(null)) {
            const [success, contents] = await new Promise((resolve, reject) => {
                file.load_contents_async(null, (source, result) => {
                    try {
                        const [success, contents] = source.load_contents_finish(result);
                        resolve([success, contents]);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            
            if (success) {
                existingContent = new TextDecoder().decode(contents);
            }
        }
        
        // Check if our import is already present
        const kiwieImportRegex = /@import\s+['"][^'"]*kiwi@kemma[^'"]*['"];\s*\n?/g;
        
        // Remove any existing kiwi imports
        existingContent = existingContent.replace(kiwieImportRegex, '');
        
        // Add our import at the beginning
        const newContent = importLine + existingContent;
        
        // Write the updated content
        file.replace_contents(newContent, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        
    } catch (error) {
        console.error(`[Kiwi] Error processing GTK file ${filePath}: ${error}`);
    }
}

async function removeUserGtkConfig() {
    try {
        const homeDir = GLib.get_home_dir();
        const gtk3UserPath = `${homeDir}/.config/gtk-3.0/gtk.css`;
        const gtk4UserPath = `${homeDir}/.config/gtk-4.0/gtk.css`;
        
        // Remove our imports from both files
        for (const path of [gtk3UserPath, gtk4UserPath]) {
            try {
                const file = Gio.File.new_for_path(path);
                if (file.query_exists(null)) {
                    const [success, contents] = await new Promise((resolve, reject) => {
                        file.load_contents_async(null, (source, result) => {
                            try {
                                const [success, contents] = source.load_contents_finish(result);
                                resolve([success, contents]);
                            } catch (error) {
                                reject(error);
                            }
                        });
                    });
                    
                    if (success) {
                        let content = new TextDecoder().decode(contents);
                        
                        // Remove any kiwi@kemma imports
                        const kiwieImportRegex = /@import\s+['"][^'"]*kiwi@kemma[^'"]*['"];\s*\n?/g;
                        content = content.replace(kiwieImportRegex, '');
                        
                        // If there's remaining content, write it back, otherwise delete the file
                        if (content.trim()) {
                            file.replace_contents(content, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                        } else {
                            file.delete(null);
                        }
                    }
                }
            } catch (e) {
                // File might not exist or be inaccessible, continue
                console.log(`[Kiwi] Could not process ${path}: ${e.message}`);
            }
        }
        
        console.log('[Kiwi] Removed kiwi imports from user GTK config files');
        
    } catch (error) {
        console.error(`[Kiwi] Error removing user GTK config: ${error}`);
    }
}

export function enable() {
    if (!settings) {
        settings = Extension.lookupByUUID('kiwi@kemma').getSettings();
        settingsChangedId = settings.connect('changed', (settings, key) => {
            if (key === 'enable-app-window-buttons' || key === 'button-type' || key === 'show-window-controls') {
                updateGtkCss().catch(error => {
                    console.error(`[Kiwi] Error in settings changed handler: ${error}`);
                });
            }
        });
        
        // Initial update
        updateGtkCss().catch(error => {
            console.error(`[Kiwi] Error in initial update: ${error}`);
        });
    }
}

export function disable() {
    if (settingsChangedId && settings) {
        settings.disconnect(settingsChangedId);
        settingsChangedId = null;
        settings = null;
    }
    
    // Remove our imports from user GTK config files
    removeUserGtkConfig().catch(error => {
        console.error(`[Kiwi] Error in disable cleanup: ${error}`);
    });
}

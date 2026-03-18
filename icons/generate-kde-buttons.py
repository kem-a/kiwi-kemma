#!/usr/bin/env python3
"""Generate KDE Breeze-style window control button PNGs for Kiwi extension.

Produces two icon sets:
  titlebuttons-kde-light/  — dark icons for light GTK themes
  titlebuttons-kde-dark/   — light icons for dark GTK themes
Hover/active states use opaque circles so the icon color is always white.
"""

import subprocess
import os
import glob
import shutil

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Two color variants: one for light themes, one for dark themes
VARIANTS = {
    'light': {
        'icon_normal':   '#3d3d3d',   # Dark icon on light bg
        'icon_backdrop': '#999999',   # Dimmed dark icon
        'bg_hover':      '#3d3d3d',   # Dark circle hover bg
        'bg_active':     '#2d2d2d',   # Darker pressed bg
    },
    'dark': {
        'icon_normal':   '#d0d0d0',   # Light icon on dark bg
        'icon_backdrop': '#808080',   # Dimmed light icon
        'bg_hover':      '#626262',   # Lighter circle hover bg
        'bg_active':     '#4d4d4d',   # Lighter pressed bg
    },
}

# Common colors for hover/active states (icon on opaque circle)
ICON_COLOR_HOVER = '#fcfcfc'        # White icon (hover)
ICON_COLOR_ACTIVE = '#e0e0e0'       # Slightly dimmed white (pressed)
BG_CLOSE_HOVER = '#c0392b'         # KDE Breeze close hover red
BG_CLOSE_ACTIVE = '#a5281b'        # Darker red for pressed

CANVAS = 20   # SVG canvas size
R = 9         # circle radius for hover bg
CX = 10       # center X
CY = 10       # center Y

STROKE_WIDTH = 1.5

def close_symbol(color, sw=STROKE_WIDTH):
    """X symbol for close button."""
    offset = 4.5
    return f'''  <line x1="{CX-offset}" y1="{CY-offset}" x2="{CX+offset}" y2="{CY+offset}"
        stroke="{color}" stroke-width="{sw}" stroke-linecap="round"/>
  <line x1="{CX+offset}" y1="{CY-offset}" x2="{CX-offset}" y2="{CY+offset}"
        stroke="{color}" stroke-width="{sw}" stroke-linecap="round"/>'''

def maximize_symbol(color, sw=STROKE_WIDTH):
    """Upward chevron for maximize."""
    return f'''  <polyline points="{CX-4.5},{CY+2} {CX},{CY-3} {CX+4.5},{CY+2}"
        fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'''

def minimize_symbol(color, sw=STROKE_WIDTH):
    """Downward chevron for minimize."""
    return f'''  <polyline points="{CX-4.5},{CY-2} {CX},{CY+3} {CX+4.5},{CY-2}"
        fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'''

def restore_symbol(color, sw=STROKE_WIDTH):
    """Diamond shape for restore (unmaximize)."""
    s = 4.5
    return f'''  <polyline points="{CX},{CY-s} {CX+s},{CY} {CX},{CY+s} {CX-s},{CY} {CX},{CY-s}"
        fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'''

def bg_circle(color):
    return f'  <circle cx="{CX}" cy="{CY}" r="{R}" fill="{color}"/>'

def make_svg(symbol_func, icon_color, bg_color=None, sw=STROKE_WIDTH):
    bg = bg_circle(bg_color) + '\n' if bg_color else ''
    symbol = symbol_func(icon_color, sw)
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" viewBox="0 0 {CANVAS} {CANVAS}">
{bg}{symbol}
</svg>'''

def svg_to_png(svg_content, output_path, size):
    """Convert SVG string to PNG using rsvg-convert."""
    proc = subprocess.run(
        ['rsvg-convert', '-w', str(size), '-h', str(size), '-o', output_path],
        input=svg_content.encode(), capture_output=True
    )
    if proc.returncode != 0:
        print(f'Error converting {output_path}: {proc.stderr.decode()}')

# Clean old output directories
for dirname in ['titlebuttons-kde', 'titlebuttons-kde-light', 'titlebuttons-kde-dark']:
    old_dir = os.path.join(BASE_DIR, dirname)
    if os.path.isdir(old_dir):
        shutil.rmtree(old_dir)

# Generate both variants
for variant_name, colors in VARIANTS.items():
    output_dir = os.path.join(BASE_DIR, f'titlebuttons-kde-{variant_name}')
    os.makedirs(output_dir, exist_ok=True)

    buttons = {
        'close': {
            '':          (close_symbol, colors['icon_normal'], None),
            '-hover':    (close_symbol, ICON_COLOR_HOVER, BG_CLOSE_HOVER),
            '-active':   (close_symbol, ICON_COLOR_ACTIVE, BG_CLOSE_ACTIVE),
            '-backdrop': (close_symbol, colors['icon_backdrop'], None),
        },
        'maximize': {
            '':          (maximize_symbol, colors['icon_normal'], None),
            '-hover':    (maximize_symbol, ICON_COLOR_HOVER, colors['bg_hover']),
            '-active':   (maximize_symbol, ICON_COLOR_ACTIVE, colors['bg_active']),
            '-backdrop': (maximize_symbol, colors['icon_backdrop'], None),
        },
        'minimize': {
            '':          (minimize_symbol, colors['icon_normal'], None),
            '-hover':    (minimize_symbol, ICON_COLOR_HOVER, colors['bg_hover']),
            '-active':   (minimize_symbol, ICON_COLOR_ACTIVE, colors['bg_active']),
            '-backdrop': (minimize_symbol, colors['icon_backdrop'], None),
        },
        'restore': {
            '':          (restore_symbol, colors['icon_normal'], None),
            '-hover':    (restore_symbol, ICON_COLOR_HOVER, colors['bg_hover']),
            '-active':   (restore_symbol, ICON_COLOR_ACTIVE, colors['bg_active']),
            '-backdrop': (restore_symbol, colors['icon_backdrop'], None),
        },
    }

    print(f'\n--- {variant_name} variant (titlebuttons-kde-{variant_name}/) ---')
    for button_name, states in buttons.items():
        for suffix, (symbol_func, icon_color, bg_color) in states.items():
            svg = make_svg(symbol_func, icon_color, bg_color)
            base = f'button-{button_name}{suffix}'
            svg_to_png(svg, os.path.join(output_dir, f'{base}.png'), CANVAS)
            svg_to_png(svg, os.path.join(output_dir, f'{base}@2.png'), CANVAS * 2)
            print(f'  {base}.png + @2.png')

print(f'\nAll KDE Breeze button PNGs generated.')

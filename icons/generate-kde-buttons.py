#!/usr/bin/env python3
"""Generate KDE Breeze-style window control button PNGs for Kiwi extension."""

import subprocess
import os
import glob

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'titlebuttons-kde')
os.makedirs(OUTPUT_DIR, exist_ok=True)

# KDE Breeze theme colors
# Normal state: medium-contrast icon on transparent bg (works on both light and dark)
# Hover close: white X on red circle
# Hover maximize/minimize: white icon on grey circle
# Active (pressed): slightly darker versions
# Backdrop: dimmed

ICON_COLOR_NORMAL = '#888888'       # Medium grey (visible on both light and dark)
ICON_COLOR_HOVER = '#fcfcfc'        # White icon (hover)
ICON_COLOR_ACTIVE = '#e0e0e0'       # Slightly dimmed white (pressed)
ICON_COLOR_BACKDROP = '#666666'     # Dimmer grey (unfocused window)

BG_CLOSE_HOVER = '#c0392b'         # KDE Breeze close hover red
BG_CLOSE_ACTIVE = '#a5281b'        # Darker red for pressed
BG_HOVER = '#3d3d3d'               # Dark grey hover bg for min/max
BG_ACTIVE = '#2d2d2d'              # Darker grey for pressed

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

# Clean old files
for old in glob.glob(os.path.join(OUTPUT_DIR, '*.png')) + glob.glob(os.path.join(OUTPUT_DIR, '*.svg')):
    os.remove(old)

# Button definitions
buttons = {
    'close': {
        '':          (close_symbol, ICON_COLOR_NORMAL, None),
        '-hover':    (close_symbol, ICON_COLOR_HOVER, BG_CLOSE_HOVER),
        '-active':   (close_symbol, ICON_COLOR_ACTIVE, BG_CLOSE_ACTIVE),
        '-backdrop': (close_symbol, ICON_COLOR_BACKDROP, None),
    },
    'maximize': {
        '':          (maximize_symbol, ICON_COLOR_NORMAL, None),
        '-hover':    (maximize_symbol, ICON_COLOR_HOVER, BG_HOVER),
        '-active':   (maximize_symbol, ICON_COLOR_ACTIVE, BG_ACTIVE),
        '-backdrop': (maximize_symbol, ICON_COLOR_BACKDROP, None),
    },
    'minimize': {
        '':          (minimize_symbol, ICON_COLOR_NORMAL, None),
        '-hover':    (minimize_symbol, ICON_COLOR_HOVER, BG_HOVER),
        '-active':   (minimize_symbol, ICON_COLOR_ACTIVE, BG_ACTIVE),
        '-backdrop': (minimize_symbol, ICON_COLOR_BACKDROP, None),
    },
    'restore': {
        '':          (restore_symbol, ICON_COLOR_NORMAL, None),
        '-hover':    (restore_symbol, ICON_COLOR_HOVER, BG_HOVER),
        '-active':   (restore_symbol, ICON_COLOR_ACTIVE, BG_ACTIVE),
        '-backdrop': (restore_symbol, ICON_COLOR_BACKDROP, None),
    },
}

# Generate PNGs at 1x (20px) and 2x (40px)
for button_name, states in buttons.items():
    for suffix, (symbol_func, icon_color, bg_color) in states.items():
        svg = make_svg(symbol_func, icon_color, bg_color)
        base = f'button-{button_name}{suffix}'
        svg_to_png(svg, os.path.join(OUTPUT_DIR, f'{base}.png'), CANVAS)
        svg_to_png(svg, os.path.join(OUTPUT_DIR, f'{base}@2.png'), CANVAS * 2)
        print(f'Generated: {base}.png + @2.png')

print(f'\nAll KDE Breeze button PNGs generated in {OUTPUT_DIR}')

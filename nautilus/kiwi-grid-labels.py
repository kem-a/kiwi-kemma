# SPDX-License-Identifier: GPL-3.0-or-later
# Draws a macOS style accent pill behind each line of a selected Nautilus
# grid view file name. GTK CSS can only draw one box per widget.

import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Adw, GObject, Graphene, Gsk, Gtk, Pango

PADDING = 5


class NameHighlight(Gtk.Widget):
    def __init__(self, label):
        super().__init__(layout_manager=Gtk.BinLayout(), css_classes=['kiwi-name-highlight'])
        self._label = label
        label.set_parent(self)
        self.connect('destroy', lambda *_: label.unparent())

    def _is_selected(self):
        widget = self.get_parent()
        while widget is not None:
            if widget.get_state_flags() & Gtk.StateFlags.SELECTED:
                return True
            widget = widget.get_parent()
        return False

    # Selection restyles the label (see fixes4.css), which redraws us too
    def do_snapshot(self, snapshot):
        label = self._label
        if self._is_selected():
            color = Adw.StyleManager.get_default().get_accent_color_rgba()
            _, origin = label.compute_point(self, Graphene.Point().init(0, 0))
            offset_x, offset_y = label.get_layout_offsets()
            line = label.get_layout().get_iter()
            while True:
                _, logical = line.get_line_extents()
                height = logical.height / Pango.SCALE
                rect = Graphene.Rect().init(
                    origin.x + offset_x + logical.x / Pango.SCALE - PADDING,
                    origin.y + offset_y + logical.y / Pango.SCALE,
                    logical.width / Pango.SCALE + 2 * PADDING,
                    height)
                pill = Gsk.RoundedRect()
                pill.init_from_rect(rect, height / 2)
                snapshot.push_rounded_clip(pill)
                snapshot.append_color(color, rect)
                snapshot.pop()
                if not line.next_line():
                    break
        self.snapshot_child(label, snapshot)


def _on_realize(box, *args):
    label = box.get_first_child()
    if box.has_css_class('icon-ui-labels-box') and isinstance(label, Gtk.Label):
        box.remove(label)
        box.prepend(NameHighlight(label))
    return True


# Signals exist only once the class is initialized
Gtk.Box()
GObject.add_emission_hook(Gtk.Box, 'realize', _on_realize)

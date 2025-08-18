// file: titlebuttons_hover.c
#include <gtk/gtk.h>

typedef struct {
  int hover_count;
} HoverHoverData;

static void ensure_hover_data(GtkWidget *target) {
  if (!g_object_get_data(G_OBJECT(target), "tb-hover-data")) {
    HoverHoverData *d = g_new0(HoverHoverData, 1);
    g_object_set_data_full(G_OBJECT(target), "tb-hover-data", d, g_free);
  }
}

static void add_class(GtkWidget *w) {
  gtk_style_context_add_class(gtk_widget_get_style_context(w), "titlebuttons-hover");
}
static void remove_class(GtkWidget *w) {
  gtk_style_context_remove_class(gtk_widget_get_style_context(w), "titlebuttons-hover");
}

static void reset_hover_state(GtkWidget *target) {
  HoverHoverData *d = g_object_get_data(G_OBJECT(target), "tb-hover-data");
  if (d) d->hover_count = 0;
  remove_class(target);
}

static GtkWidget *find_headerbar(GtkWidget *w) {
  while (w && !GTK_IS_HEADER_BAR(w)) w = gtk_widget_get_parent(w);
  return w; // may be NULL
}

static gboolean on_btn_enter(GtkWidget *btn, GdkEventCrossing *e, gpointer target) {
  if (e->detail == GDK_NOTIFY_INFERIOR) return FALSE;
  ensure_hover_data(GTK_WIDGET(target));
  HoverHoverData *d = g_object_get_data(G_OBJECT(target), "tb-hover-data");
  if (d->hover_count++ == 0) add_class(GTK_WIDGET(target));
  return FALSE;
}
static gboolean on_btn_leave(GtkWidget *btn, GdkEventCrossing *e, gpointer target) {
  if (e->detail == GDK_NOTIFY_INFERIOR) return FALSE;
  HoverHoverData *d = g_object_get_data(G_OBJECT(target), "tb-hover-data");
  if (!d) return FALSE;
  if (d->hover_count > 0 && --d->hover_count == 0) remove_class(GTK_WIDGET(target));
  return FALSE;
}

static gboolean has_class(GtkWidget *w, const char *cls) {
  GtkStyleContext *ctx = gtk_widget_get_style_context(w);
  return gtk_style_context_has_class(ctx, cls);
}

static void wire_button_box(GtkWidget *box) {
  if (g_object_get_data(G_OBJECT(box), "tb-hover-wired")) return;
  GList *kids = gtk_container_get_children(GTK_CONTAINER(box));
  int n_tb = 0;
  for (GList *l = kids; l; l = l->next)
    if (GTK_IS_BUTTON(l->data) && has_class(GTK_WIDGET(l->data), "titlebutton"))
      n_tb++;
  if (n_tb > 0) {
  }
  if (n_tb >= 2) {
    GtkWidget *headerbar = find_headerbar(box);
    GtkWidget *target = headerbar ? headerbar : box; // prefer headerbar for styling
  // Reset previous state because buttons may have been recreated (e.g. maximize/unmaximize)
  reset_hover_state(target);
    for (GList *l = kids; l; l = l->next) {
      GtkWidget *child = l->data;
      if (GTK_IS_BUTTON(child) && has_class(child, "titlebutton")) {
        gtk_widget_add_events(child, GDK_ENTER_NOTIFY_MASK | GDK_LEAVE_NOTIFY_MASK);
        g_signal_connect(child, "enter-notify-event", G_CALLBACK(on_btn_enter), target);
        g_signal_connect(child, "leave-notify-event", G_CALLBACK(on_btn_leave),  target);
    // On destroy (replacement) ensure we clear hover state to avoid a stuck hover
    g_signal_connect_swapped(child, "destroy", G_CALLBACK(reset_hover_state), target);
      }
    }
    g_object_set_data(G_OBJECT(box), "tb-hover-wired", GINT_TO_POINTER(1));
    g_object_set_data(G_OBJECT(target), "tb-hover-any-wired", GINT_TO_POINTER(1));
  }
  g_list_free(kids);
}

static void scan(GtkWidget *w); // fwd

static void forall_cb(GtkWidget *child, gpointer data) {
  scan(child);
}

static void scan(GtkWidget *w) {
  if (GTK_IS_BOX(w)) wire_button_box(w);
  if (GTK_IS_CONTAINER(w)) {
    // Use forall to include INTERNAL children (gtk_container_get_children skips those)
    gtk_container_forall(GTK_CONTAINER(w), forall_cb, NULL);
  }
}

// ---- Broader fallback: collect all titlebuttons globally and wire their common parent if not already wired ----
static void collect_titlebuttons(GtkWidget *w, GPtrArray *buttons) {
  if (GTK_IS_BUTTON(w) && has_class(w, "titlebutton")) {
    g_ptr_array_add(buttons, w);
  }
  if (GTK_IS_CONTAINER(w)) {
    gtk_container_forall(GTK_CONTAINER(w), (GtkCallback) collect_titlebuttons, buttons);
  }
}

static void global_wire(GtkWindow *win) {
  if (!GTK_IS_WINDOW(win)) return;
  GPtrArray *buttons = g_ptr_array_new();
  collect_titlebuttons(GTK_WIDGET(win), buttons);
  if (buttons->len >= 2) {
    // Find common parent of first two buttons (likely the box we want)
    GtkWidget *b0 = g_ptr_array_index(buttons, 0);
    GtkWidget *parent = gtk_widget_get_parent(b0);
    if (parent && !g_object_get_data(G_OBJECT(parent), "tb-hover-wired")) {
      wire_button_box(parent); // will perform internal wiring & mark
    }
  } else {
  }
  g_ptr_array_free(buttons, TRUE);
}

static gboolean deferred_scan(gpointer w) {
  if (GTK_IS_WIDGET(w)) scan(GTK_WIDGET(w));
  g_object_unref(w);
  return G_SOURCE_REMOVE;
}

static gboolean on_widget_realize(GSignalInvocationHint *ih, guint n, const GValue *params, gpointer data) {
  GtkWidget *w = g_value_get_object(&params[0]);
  if (GTK_IS_HEADER_BAR(w) || has_class(w, "titlebar")) {
    // Immediate scan (might catch early buttons)
    scan(w);
    // Deferred scan to catch late-created decoration buttons
    g_idle_add(deferred_scan, g_object_ref(w));
  }
  return TRUE;
}

// Periodic fallback scanning callbacks (file-scope; cannot nest in C)
static gboolean initial_idle_scan(gpointer data) {
  GList *tops = gtk_window_list_toplevels();
  for (GList *l = tops; l; l = l->next) scan(GTK_WIDGET(l->data));
  g_list_free(tops);
  return G_SOURCE_REMOVE; // one-shot
}
static gboolean periodic_scan(gpointer data) {
  GList *tops = gtk_window_list_toplevels();
  for (GList *l = tops; l; l = l->next) {
    GtkWidget *w = GTK_WIDGET(l->data);
    scan(w);
    global_wire(GTK_WINDOW(w));
  }
  g_list_free(tops);
  return TRUE;
}

G_MODULE_EXPORT void gtk_module_init(gint *argc, gchar ***argv) {
  // Some distros build GTK without exposing 'realize' as a signal; fall back to periodic scans.
  // Schedule an early idle scan and then periodic lightweight rescans.
  g_idle_add(initial_idle_scan, NULL);
  g_timeout_add(800 /* ms */, periodic_scan, NULL);
}

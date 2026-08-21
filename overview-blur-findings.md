# Overview Blur: why Kiwi moved from ImageMagick pre-blur to a direct GPU blur

Investigation record, 2026-08-21. Kept to justify the decision and to stop the
ImageMagick approach being reintroduced on the reasoning that first motivated it.

**Reported symptom:** a noticeable hitch when opening the overview, worst the first
time, much faster on subsequent opens, absent with the extension disabled.

**Outcome:** the hitch was a synchronous JPEG decode and CPU upscale of Kiwi's
pre-blurred wallpaper on the frame that first paints `#overviewGroup`. It cost ~264 ms
of a 468 ms stall. `apps/overviewWallpaper.js` now blurs the live background on the
GPU instead: 585 lines became 153, and the ImageMagick dependency is gone.

---

## Test environment

Numbers below are specific to this machine; the mechanism is not.

| | |
|---|---|
| GNOME Shell | 50.4, Wayland, Fedora 44 |
| Panel | eDP-1, **3072x1920 @ 165 Hz**, fractional scale **1.6** (logical 1920x1200) |
| Frame budget | **6.06 ms** |
| CPU | Intel Ultra 7 255H (hybrid P/E), `powersave`, on battery |
| Other extensions | 20 enabled, incl. dash-to-dock, blur-my-shell, panel-corners |

Two environment traps worth recording, both of which produced false results before
being caught:

- `xrandr --listmonitors` reports 3840x2400 — that is XWayland's view. The real mode
  comes from `org.gnome.Mutter.DisplayConfig.GetCurrentState`.
- The panel is 165 Hz, not 60. A "slow frame" threshold of 20 ms hides real drops.

## Measurement method

What finally worked, after several approaches that did not:

- **`perf`, not sysprof.** `perf_event_paranoid=2` allows userspace profiling,
  debuginfod resolves symbols, and output is readable in a terminal.
- **Drive the overview over D-Bus** — `org.gnome.Shell.OverviewActive` is writable,
  so runs are unattended and repeatable.
- **Measure `instructions`, not `task-clock` or `cycles`.** `cycles` comes back as
  `cpu_atom/cycles` only on a hybrid CPU. `task-clock` measures time-on-CPU, which
  inflates when `powersave` drops the clock — it gave a 2320-4452 ms spread for
  identical configurations. Instruction counts settled to +/-2%.
- **Idle 75 s before each open.** This is the single most important detail. The
  texture that causes the stall is purged from GPU memory when idle (Clutter has a
  `gl-video-memory-purged` signal for exactly this), so a warm shell does not
  exhibit the bug at all. 15 s of idle was not enough.
- **Read the frame *index* of the stall.** The probe sampled
  `Clutter.Stage::after-paint` between overview state signals and reported the gap
  before each frame. Every stall sat at **index 0** — the first frame after
  `showing` — which is where synchronous work in a signal handler lands.

`showing`->`shown` wall time is useless here: the animation is timeline-based
(`ANIMATION_TIME = 250`), so it finishes on schedule whether or not frames dropped.

## Root cause

perf, sliced to the single stalling frame and compared against an idle control:

| DSO | stall frame | idle control |
|---|---|---|
| `libgallium` (Mesa/iris) | 28.7% | 80.3% |
| **`libgdk_pixbuf`** | **27.8%** | absent |
| **`glycin-image-rs`** | **5.0%** | absent |

```text
27.79%  scale_line_22_33                       <- GdkPixbuf CPU image scaling
16.06%  convert_ubyte                          <- RGB24 -> RGBA32 conversion
 2.25%  zune_jpeg::idct::avx2::idct_avx2_4x4   <- JPEG decode
12.87%  additional_selector_matches_style      <- St selector matching
11.20%  sel_matches_style_real
```

**Scaling, not decoding, was the cost** — 44% versus 2.25%. The mechanism is in
`st-texture-cache.c`:

```c
CoglTexture *st_texture_cache_load_file_to_cogl_texture (...)
{
  texture = st_texture_cache_load_file_sync_to_cogl_texture (
    cache, ST_TEXTURE_CACHE_POLICY_FOREVER, context, file,
    -1, -1, paint_scale, resource_scale, &error);
```
```c
int scale = ceilf (paint_scale * resource_scale);
gdk_pixbuf_loader_set_size (loader, scaled_width * scale_factor,
                            scaled_height * scale_factor);
```

Width and height are `-1`, so **St takes the stored image's natural size and
multiplies it by the integer scale factor** — 2 on this display. The old code sized
the cached file to the monitor's *logical* width (1920), so a 1920x1080 JPEG was
CPU-upscaled to 3840x2160 on load, for a 3072x1920 panel. Synchronously, on the first
frame of the overview transition.

Two further defects in the old path, both found along the way:

- The stored file was 16:9 while the panel is 16:10, so `background-size: cover`
  **cropped 10% horizontally** on every paint.
- `background-position: center` was silently rejected — St parses it as a length
  ("Ignoring length property that isn't a number", 86 occurrences per boot) — so it
  had never done anything.

## Two candidate fixes, both measured

### A. Keep ImageMagick, size the file correctly

Store small, since St's multiply means bigger input is strictly worse, and a blurred
image has no detail to preserve. Measured `new_from_file_at_scale(w*2, h*2)`:

| stored | St output | jpeg85 |
|---|---|---|
| 384x240 | 768x480 | 7.7 ms |
| **768x480** | 1536x960 | **16.5 ms** |
| 1536x960 | 3072x1920 | 55.9 ms |
| **1920x1080 (old)** | 3840x2160 | **~84 ms** |

Format was investigated and **JPEG kept**. PNG8 decodes 10% faster but bands badly on
the smooth gradients a blur produces (0.754% vs 0.318% RMSE); PNG24/32 decode ~70%
slower; WebP was slowest at 95 ms. PNG32 does eliminate the 18 ms alpha conversion,
but pays 33 ms more decode for it.

Result: 468 ms -> **79 ms**, load+scale+alpha ~102 -> 21 ms, texture 33 -> 5.6 MB, and
quality actually *improved* (0.421% -> 0.318% RMSE vs a high-quality reference)
because the 10% crop was gone.

### B. Drop ImageMagick, blur on the GPU

A `Meta.BackgroundGroup` at index 0 of `overviewGroup`, one `St.Widget` per monitor
carrying `Shell.BlurEffect` in **`ACTOR`** mode, each holding a
`Background.BackgroundManager`.

The original argument against this was that a full-screen blur would cost ~18x
Kiwi's dock blur by area, every frame. **That argument was wrong.** Dock blur is
`BlurMode.BACKGROUND`, reading a framebuffer with moving windows behind it, so it must
re-blur. The overview wallpaper is static and bottom-most. Confirmed in
`shell-blur-effect.c`:

```c
if (actor_dirty || !(self->cache_flags & ACTOR_PAINTED))
  { /* recompute and cache */ }
else
  { /* use cached pipeline */ }
```

ACTOR mode caches the blurred result and only recomputes when the actor is dirty or a
property changes. For a static wallpaper that is **once, not per frame**.

## Head-to-head

Deep-idle (75 s) protocol, index-0 stall in ms:

| | cold open | 2nd | 3rd | close | while open (median) |
|---|---|---|---|---|---|
| Old ImageMagick path | **468** | 137 | 69 | — | — |
| Feature disabled entirely | 204 | 143 | 68 | — | — |
| A: ImageMagick, sized correctly | 79 | 127 | 68 | 25-35 | 6.1-9.8 |
| **B: GPU blur (chosen)** | 191 / 209 | **64-75** | 66-69 | 31-51 | 9.1-12.6 |
| blur-my-shell overview blur | 218 | 74 | 86 | — | 8.6-9.5 |

Reading these honestly:

- **Cold open is a tie, and neither implementation controls it.** B measures 191 and
  209 across two runs, landing on the **204 ms floor measured with the feature
  disabled**. perf on B's cold frame shows 20.5% `libmozjs` (JIT: `BaselineCompiler`,
  GC `tracePersistentRoots`), 8.1% `libst` selector matching, ~0.5% shader compile —
  GNOME constructing the overview for the first time, not the blur. A's single 79 ms
  sample is *below* the disabled-feature floor, which suggests a warm-JIT outlier
  rather than a real advantage; n=1 there.
- **Warm opens: B wins**, 64-75 vs 68-127 ms. This is the common case, and it matches
  the subjective report of "much snappier, especially on the 2nd or 3rd open".
- **While the overview is open: A is slightly better**, ~6-10 vs ~9-12 ms median. B
  adds one more actor to composite per frame even with a cached texture. This is B's
  one real cost.

## Decision: B, the GPU blur

- Cold open equivalent; warm opens measurably better.
- **585 lines -> 153.** Gone: the `magick` subprocess, the generation queue and its
  debounce timers, two cache files plus two `.meta` files, a generated stylesheet
  loaded into the theme, cache-invalidation bookkeeping, and the wallpaper /
  colour-scheme change plumbing.
- **No ImageMagick dependency.** The feature previously required it, and `prefs.js`
  greyed the toggle out when absent. Both are removed.
- `Meta.Background` follows wallpaper and light/dark changes by itself, so those need
  no handling and respond instantly instead of after a debounce plus a subprocess.

Accepted trade: ~2-3 ms per frame while the overview is open.

Tuning knobs in `apps/overviewWallpaper.js`: `BLUR_RADIUS` (60; radius is divided by
the effect's `downscale_factor` and the downscale/upscale smooths further, so it reads
stronger than the nominal value) and `BRIGHTNESS_DARK` / `BRIGHTNESS_LIGHT` (0.80 /
0.65, matching the old `-colorize` of 20% / 35%).

## Hypotheses tested and refuted

Recorded so they are not re-tried. Each looked plausible and was wrong:

1. **`panelTransparency`'s overview handlers**, incl. tray-icon inversion — disabling
   both changed nothing.
2. **Enable-time churn** — `enable()` totals 425 ms and finishes 1343 ms before the
   first open; theme managers are 0.3-0.8 ms, not the file-I/O cost assumed.
3. **Idle-wake CPU frequency ramp** — the first post-idle open was the *cheapest* of
   its batch.
4. **`dock-blur`** — it is ~60% of Kiwi's +44% instruction overhead per transition,
   but disabling it does not move the stall at all. Throughput and stall are
   different problems.
5. **St CSS restyle from the `:overview` pseudo-class** — real (24% of the stall
   frame) but a passenger, not the cause; it did not disappear when the stall did.
6. **A one-shot texture preload at startup** — the texture is purged after idle, so a
   preload does not survive to the moment it is needed.

## Methodological warnings

- **Bisecting Kiwi by toggling its settings is self-confounding.**
  `_on_settings_changed()` re-runs every module's `enable()` on any key change, and
  three modules were not idempotent — `overviewWallpaper` leaked a
  `changed::color-scheme` handler on every pass, permanently, past `disable()`. Those
  guards are now in place, but the lesson stands: verify idempotency before using
  settings toggles as a measurement tool.
- **A warm shell does not reproduce this class of bug.** Any driver that opens the
  overview every 1-2 s reports 55-152 ms no matter what is toggled. Only >=75 s idle
  exposed it.
- **Extension modules are imported once and cached**, so `gnome-extensions
  disable/enable` does *not* reload edited JS. Every code change needs a logout.
- **Compare like with like.** One early comparison put a cold-login run with Kiwi off
  against a mid-session run with Kiwi just enabled and the prefs window open. It
  showed a 2.3x difference that did not survive a controlled re-run.

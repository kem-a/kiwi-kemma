# Translating

## How to Contribute Translations

- Edit the relevant `po/<lang>.po` file and create a PR.
- To add a new language, copy `kiwi.pot` to `po/<lang>.po`, translate the strings, and submit a PR.
- Run `./compile-translations.sh` to validate and regenerate `.mo` files for local testing.
- To sync with upstream Kiwi Menu strings, run `python3 translating/update_po_translations.py` and review the resulting diffs before submitting.

## Translation Status

| Language | Code | Status | Completion |
| -------- | ---- | ------ | ---------- |
| Chinese (Simplified) | zh_CN | 🟢 Complete | 180/180 (100%) |
| German | de | 🟢 Complete | 180/180 (100%) |
| Spanish | es | 🟢 Complete | 180/180 (100%) |
| Estonian | et | 🟢 Complete | 180/180 (100%) |
| Persian | fa | 🟢 Complete | 180/180 (100%) |
| Finnish | fi | 🟢 Complete | 180/180 (100%) |
| French | fr | 🟢 Complete | 180/180 (100%) |
| Italian | it | 🟢 Complete | 180/180 (100%) |
| Korean | ko | 🟢 Complete | 180/180 (100%) |
| Lithuanian | lt | 🟢 Complete | 180/180 (100%) |
| Latvian | lv | 🟢 Complete | 180/180 (100%) |
| Norwegian Bokmål | nb | 🟢 Complete | 180/180 (100%) |
| Dutch | nl | 🟢 Complete | 180/180 (100%) |
| Polish | pl | 🟢 Complete | 180/180 (100%) |
| Portuguese | pt | 🟢 Complete | 180/180 (100%) |
| Swedish | sv | 🟢 Complete | 180/180 (100%) |

*Stats generated on 2026‑08‑21 via `msgfmt --statistics`.*

## Note

> Current translations are imported from the Kiwi Menu project. Native speakers are encouraged to proofread and polish any phrasing.

## Compiling translations for testing

The helper script compiles translations and produces a `locale/` folder for local testing. Run:

```bash
./compile-translations.sh
```

## Packaging

When packing the extension you can point `gnome-extensions pack` at the `po/` directory:

```bash
gnome-extensions pack --podir=po
```

## Further Reading

- [GJS translations guide](https://gjs.guide/extensions/development/translations.html)
- [GNOME Translation Project](https://wiki.gnome.org/TranslationProject)

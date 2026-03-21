# Translating

## How to Contribute Translations

- Edit the relevant `po/<lang>.po` file and create a PR.
- To add a new language, copy `kiwi.pot` to `po/<lang>.po`, translate the strings, and submit a PR.
- Run `./compile-translations.sh` to validate and regenerate `.mo` files for local testing.
- To sync with upstream Kiwi Menu strings, run `python3 translating/update_po_translations.py` and review the resulting diffs before submitting.

## Translation Status

| Language | Code | Status | Completion |
| -------- | ---- | ------ | ---------- |
| Chinese (Simplified) | zh_CN | 🟢 Complete | 99/99 (100%) |
| German | de | 🟢 Complete | 99/99 (100%) |
| Spanish | es | 🟢 Complete | 99/99 (100%) |
| Estonian | et | 🟢 Complete | 99/99 (100%) |
| Persian | fa | 🟢 Complete | 99/99 (100%) |
| Finnish | fi | 🟢 Complete | 99/99 (100%) |
| French | fr | 🟢 Complete | 99/99 (100%) |
| Italian | it | 🟢 Complete | 99/99 (100%) |
| Korean | ko | 🟡 Needs review | 97/99 (97.9%) |
| Lithuanian | lt | 🟢 Complete | 99/99 (100%) |
| Latvian | lv | 🟢 Complete | 99/99 (100%) |
| Norwegian Bokmål | nb | 🟢 Complete | 99/99 (100%) |
| Dutch | nl | 🟢 Complete | 99/99 (100%) |
| Polish | pl | 🟢 Complete | 99/99 (100%) |
| Portuguese | pt | 🟢 Complete | 99/99 (100%) |
| Swedish | sv | 🟢 Complete | 99/99 (100%) |

*Stats generated on 2025‑12‑01 via `msgfmt --statistics`. The few untranslated entries in Korean are new Kiwi strings awaiting native review. Obsolete `#~` entries were removed for clarity.*

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

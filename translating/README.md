# Translating

## How to Contribute Translations

- Edit the relevant `po/<lang>.po` file and create a PR.
- To add a new language, copy `kiwi.pot` to `po/<lang>.po`, translate the strings, and submit a PR.
- Run `./compile-translations.sh` to validate and regenerate `.mo` files for local testing.
- To sync with upstream Kiwi Menu strings, run `python3 translating/update_po_translations.py` and review the resulting diffs before submitting.

## Translation Status

| Language | Code | Status | Completion |
| -------- | ---- | ------ | ---------- |
| Chinese (Simplified) | zh_CN | 🟡 In progress | 122/125 (97%) |
| German | de | 🟡 In progress | 122/125 (97%) |
| Spanish | es | 🟡 In progress | 122/125 (97%) |
| Estonian | et | 🟡 In progress | 122/125 (97%) |
| Persian | fa | 🟡 In progress | 122/125 (97%) |
| Finnish | fi | 🟡 In progress | 122/125 (97%) |
| French | fr | 🟡 In progress | 122/125 (97%) |
| Italian | it | 🟡 In progress | 122/125 (97%) |
| Korean | ko | 🟡 In progress | 122/125 (97%) |
| Lithuanian | lt | 🟡 In progress | 122/125 (97%) |
| Latvian | lv | 🟡 In progress | 122/125 (97%) |
| Norwegian Bokmål | nb | 🟡 In progress | 122/125 (97%) |
| Dutch | nl | 🟡 In progress | 122/125 (97%) |
| Polish | pl | 🟡 In progress | 122/125 (97%) |
| Portuguese | pt | 🟡 In progress | 122/125 (97%) |
| Swedish | sv | 🟡 In progress | 122/125 (97%) |

*Stats generated on 2026‑05‑25 via `msgfmt --statistics`.*

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

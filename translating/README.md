# Translating

## How to Contribute Translations

- Edit the relevant `po/<lang>.po` file and create a PR.
- To add a new language, copy `kiwi.pot` to `po/<lang>.po`, translate the strings, and submit a PR.
- Run `./compile-translations.sh` to validate and regenerate `.mo` files for local testing.

## Translation Status

| Language | Code | Status | Completion |
| -------- | ---- | ------ | ---------- |
| Chinese (Simplified) | zh_CN | 🟢 Complete | 192/192 (100%) |
| German | de | 🟢 Complete | 192/192 (100%) |
| Spanish | es | 🟢 Complete | 192/192 (100%) |
| Estonian | et | 🟢 Complete | 192/192 (100%) |
| Persian | fa | 🟢 Complete | 192/192 (100%) |
| Finnish | fi | 🟢 Complete | 192/192 (100%) |
| French | fr | 🟢 Complete | 192/192 (100%) |
| Italian | it | 🟢 Complete | 192/192 (100%) |
| Korean | ko | 🟢 Complete | 192/192 (100%) |
| Lithuanian | lt | 🟢 Complete | 192/192 (100%) |
| Latvian | lv | 🟢 Complete | 192/192 (100%) |
| Norwegian Bokmål | nb | 🟢 Complete | 192/192 (100%) |
| Dutch | nl | 🟢 Complete | 192/192 (100%) |
| Polish | pl | 🟢 Complete | 192/192 (100%) |
| Portuguese | pt | 🟢 Complete | 192/192 (100%) |
| Swedish | sv | 🟢 Complete | 192/192 (100%) |
| Ukrainian | uk | 🟢 Complete | 192/192 (100%) |

*Stats generated on 2026‑10‑01 via `msgfmt --statistics`.*

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

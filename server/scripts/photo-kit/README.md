# Photo kit (M270)

How the owner's marketing pictures become app-ready files. Run from `server/` (the scripts use its `sharp`).
Nothing here talks to a server or to any outside service; uploading is `scripts/m270-photos.mjs`.

1. `node scripts/photo-kit/grid.cjs` — previews with a 10% grid (`photo-kit/out/grid/`), to read where the
   lettering sits in each picture.
2. `node scripts/photo-kit/english.cjs [name…]` — the English twin of each lettered picture: the Arabic
   lettering is lifted off (top-hat mask, pull-push fill, the picture's own grain) and the English line is
   typeset in IBM Plex Sans in its place. Each picture is one entry in `JOBS`: the region(s) to erase and the
   text block(s), all in percent of the picture; a span's colour can be sampled from the original lettering.
   Look at `out/en/<name>.preview.jpg` before going on.
3. `node scripts/photo-kit/export.cjs` — the final WebP files (well under the 1 MB upload limit), the wordless
   16:9 cuts, and `manifest.json` (file → image slots) in the owner's folder `…\جاهزة للتطبيق`.
4. `node scripts/m270-photos.mjs [prod] [--dry-run]` — uploads and fills EMPTY slots only.

For a new batch: add the source files to `JOBS` / `SRC` / `ITEMS` (the lists name the M270 pictures) and rerun.

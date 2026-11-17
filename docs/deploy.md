# Putting SoMa Skate online

`./skate build` makes a static site in `dist/`. Any static host can serve it as plain files: there is no server code, no database and no build step on the host. These notes describe how to deploy it.

## Build and try it locally

```
./skate build                 # dist/: the bundle, data/, assets/, sw.js, build.json, the manifest
./skate serve                 # http://127.0.0.1:5480/, served the way a plain static host serves it
./skate serve --encode        # the same, as a host that marks .gz files Content-Encoding: gzip
```

Build on a machine that has the derived assets. The city and the photo paint are not in git (`./skate world fetch` downloads them; the world generator makes them), so a host's build step needs `./skate world fetch` first. Building locally and uploading `dist/` works too. The build rewrites a pre-built BVH file (`*.bvh.bin`) first if it is missing or no longer matches its park.

The build prints the transfer sizes. These are the current numbers:

| file | raw | shipped (gzip) | brotli, for reference |
|---|---|---|---|
| assets/park/sf.city.bin | 53.8 MB | 20.8 MB | 15.1 MB |
| assets/park/sf.city.look.bin | 20.0 MB | 2.5 MB | 2.0 MB |
| assets/park/sf.city.data.bin | 7.4 MB | 2.3 MB | 2.2 MB |
| assets/park/sf.city.bvh.bin | 5.9 MB | 2.4 MB | 2.8 MB |
| assets/park/soma.park.paint.bin | 5.2 MB | 1.7 MB | 1.6 MB |
| assets/park/soma.park.bin | 3.9 MB | 1.3 MB | 1.0 MB |
| assets/park/soma.park.bvh.bin | 0.5 MB | 0.2 MB | 0.2 MB |
| all binaries | 96.7 MB | 31.2 MB | 25.0 MB |
| text (js, css, html, json) | 3.1 MB | 0.8 MB (the host compresses these) | |

A first visit downloads about 76 MB. Most of that is textures (jpg and png, about 37 MB, which do not compress further) and the sky HDR (4 MB). Later visits load from the service worker's cache, and the game then plays offline.

## What the build does for hosting

- **Relative paths everywhere.** The site works at a domain root or in a subfolder, for example a GitHub Pages project site at `https://<user>.github.io/soma-skate/`.
- **Binaries ship as `name.bin.gz`.** Static hosts rarely compress `application/octet-stream`. The loader (`src/client/fetchbin.ts`) fetches the `.gz` file and inflates it with the browser's `DecompressionStream`. If a host already decodes the file with `Content-Encoding: gzip`, the loader sees that the gzip header is gone and uses the bytes as they are. Brotli would be about 20% smaller, but a page cannot inflate brotli itself, so the build ships gzip. Gzip also keeps every file under Cloudflare Pages' 25 MiB per-file limit: the raw city is 54 MB, the gzipped one 20.8 MB.
- **`build.json`** lists every file with its size and a revision hash. The loading bar reads the sizes, so it shows real megabytes for the park and the city. The service worker reads the list to know what to cache.
- **`sw.js`** caches the app shell when it installs. It keeps every file the game fetches (cache first), and once the game is running it fetches the rest of `build.json` in the background. A new build gets a new cache version, and files whose revision did not change are copied over from the old cache, so a returning player downloads only what changed.
- **`manifest.webmanifest`** makes the site installable (Add to Home Screen, or Install in desktop Chrome). It names the game "SoMa Skate", uses International Orange (`#ff4f00`) as the theme colour, and uses icons made from the logo sticker (`tools/icons.py` writes them to `assets/icons/`).
- **Fallbacks.** A browser without WebGL2 sees a short message instead of a blank page. On the first visit, a device whose first frames are slow (median over 28 ms, set in `data/settings.json` under `bench`) starts on the low quality preset. A toast says so, and Settings can change it back.
- **`_headers` and `.nojekyll`.** Netlify and Cloudflare Pages read `_headers`: the hashed bundle in `app/` is cached for a year, while `sw.js` and `build.json` are always revalidated. `.nojekyll` makes GitHub Pages serve the folder exactly as it is.

The service worker needs HTTPS, which all three hosts below provide (`http://127.0.0.1` also works for local tests).

## Cloudflare Pages

1. `./skate build`
2. `npx wrangler pages project create soma-skate` (once), then `npx wrangler pages deploy dist --project-name soma-skate`.
   Or, in the dashboard: Workers & Pages, Create, Pages, Upload assets, and drop the `dist` folder.
3. The site is at `https://soma-skate.pages.dev/`.

The limit that matters is 25 MiB per file, which the gzipped binaries stay under. A site of about 180 files is well inside the free plan.

## Netlify

1. `./skate build`
2. Drag the `dist` folder onto https://app.netlify.com/drop, or run `npx netlify-cli deploy --dir dist --prod`.

## GitHub Pages

1. `./skate build`
2. Publish `dist/` to a `gh-pages` branch, for example with `npx gh-pages -d dist --dotfiles`. `--dotfiles` keeps `.nojekyll`.
3. In the repository settings, under Pages, set the source to the `gh-pages` branch.

The game runs from the project subfolder (`https://<user>.github.io/<repo>/`) because every path is relative. GitHub rejects files over 100 MB and keeps sites under 1 GB; the build is about 70 MB.

## Dev only (not in the built site)

These features need the Vite dev server (`npm run dev`, the `/__skate/` endpoints in `src/harness/devserver.ts`). The built site leaves them out or says where they work:

- Clip notes (F8, saved to `inbox/`) and share videos rendered frame by frame (V, into `out/clips/`, or `SOMA_SKATE_CLIPS_DIR`). In the build, photo mode (B) downloads the PNG through the browser, and V replays the last 15 seconds on screen while the browser records it with its sound (MediaRecorder: MP4 where the browser can, WebM otherwise) and downloads the file. `?browserclip` tries that recorder on the dev server.
- Park comments (pins written to the world generator's `data/comments.json` when `SOMA_SKATEPARK_DIR` is there, else `out/park-comments/`).
- The tuning panel, which writes `data/physics.json`, and hot reloading of `data/*.json`.
- The live bridge (`./skate cmd`, `./skate watch`) and quicksaves written to files (F5 keeps the snapshot in memory in the build).

The generated radio stations need nothing from a server, so the radio works in the build and offline.

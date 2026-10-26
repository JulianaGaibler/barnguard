# Installing a display as an app

Some displays run without the Rust server and can be put on a tablet as an
installed app: `age-verification`, `policy-story` and `contrast`. Added to the home screen,
a display opens fullscreen with no address bar, and keeps working with no
network once it has loaded once. The arcade and the enterprise display need the
server and are not installable.

## Basic usage

1. Build the display on its own:

   ```sh
   npm run build:display contrast
   ```

   This writes `dist-contrast/` with only that display's code, fonts, manifest
   and icons, about 2 to 3 MB. Run `npm run build:display` with no id to list
   the displays.

2. Put the contents of `dist-contrast/` on any static host. It can sit at the
   root or in a folder, since every path is relative. The host has to serve
   HTTPS, because browsers only run service workers and offer installation on
   secure origins. `localhost` also counts, for trying it out.

3. On the tablet, open the address, such as `https://example.org/contrast/`,
   and add it to the home screen. There is no URL parameter to add.
   - On an iPad, in Safari: Share, then Add to Home Screen.
   - On Android, in Chrome: the menu, then Install app.

4. Open the app from the home screen once while online. After that it starts
   without a network.

To put several displays on one host, give each its own folder side by side,
such as `/contrast/` and `/policy-story/`, or its own origin. Never put one
inside the folder of another build, and in particular not under a full build
at `/`: the outer service worker would answer for the inner folder and clear
its cache.

### All displays in one build

`npm run build:portable` writes `dist-portable/` with every display, as the
booth server ships them. A display is then picked with `?display=<id>`, such as
`https://example.org/booth/?display=age-verification`, and installs from that
address. A copy installed this way keeps working if the folder is later
replaced with that display's own build, which ignores the parameter.

## Fullscreen and kiosk mode

An app opened from the home screen has no browser bars on either system. On iOS
the status bar at the top and the home indicator at the bottom stay, and the
display keeps clear of them. The page also keeps the screen awake while the app
is open, and stops pull to refresh, pinch zoom and the long press menu.

A web app cannot lock the tablet to itself. That is set on the device:

- **iPad:** Guided Access for one tablet, under Settings, Accessibility. For
  many tablets, Single App Mode through device management.
- **Android:** screen pinning for one tablet, or a kiosk browser or device
  policy that locks the tablet to one app.

## Updates

The app checks for a new version each time it opens, when it comes back to the
front, and every half hour. A new version downloads in the background and takes
over, with a reload, once nobody has touched the screen for a minute. The
attendant can also close the app and open it again.

## Advanced usage

### What is cached

The service worker keeps the files the build produces: the code, the engine's
data files, the fonts and the icons. A single display's build is about 2 to
3 MB, the full build about 7 MB. The 3D models in `public/debug/` are left out.
Nothing from `/api/` is cached.

### Adding a display

A display can be installed when it has a manifest and icons in `public/`, and
sets `install` in its `DisplayManifest` (`src/displays/<id>/index.ts`):

- `manifest-<id>.webmanifest`, with a `start_url` of `./?display=<id>`. A
  single-display build rewrites it to `./` and keeps the `id`.
- `icons/<id>-180.png`, `-192.png`, `-512.png` and `-maskable-512.png`

`npm run build:display` refuses a display with no manifest, since one without
it needs the server. `--force` builds it anyway.

The manifests and icons in the repo are placeholders. Replace the icon files
with the final art, keeping the names. The maskable icon keeps its picture in
the middle 60 percent, because Android crops it to a circle or a rounded square.

### The status bar on iOS

iOS never hides the status bar in an installed app, whatever the manifest's
`display` says. `index.html` sets its style to `default`, black text on a white
bar. A dark display asks for another with `install.statusBarStyle` in its
`DisplayManifest`. Contrast uses `black`, a bar with white text in the
page's own background color. `black-translucent` lets the page run under the bar, but an iPad then
reports the page a bar's height short, so the bottom of the screen is left
undrawn and a bar of the page background shows there. The style is read when
the app is added to the home screen, so an installed copy has to be removed and
added again to pick up a change.

### Checking it

Serve the build folder over `localhost` and open it in Chrome, for example with
`npx vite preview --outDir dist-contrast`. In the devtools
Application tab, the manifest, the service worker and the cache should all be
there. Switch the network to offline and reload to check the offline start. The
home screen behavior needs a real tablet.

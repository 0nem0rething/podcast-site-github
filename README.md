# Your podcast website

A static podcast site (plain HTML, CSS and JavaScript, no build step) plus a private manager you run on your Mac to add episodes and change the look. You deploy it with GitHub Pages from a private repo. Audio lives in the repo (or optionally external storage).

## What is in this folder

| File | What it is | Deploy it? |
|---|---|---|
| `index.html`, `style.css`, `app.js` | The public site | Yes |
| `site.json`, `episodes.json` | All content and settings, loaded at runtime | Yes |
| `manifest.webmanifest`, `sw.js`, `icons/` | Home Screen app support | Yes |
| `covers/`, `fonts/`, `share.jpg` | Cover art, bundled fonts, share image | Yes |
| `.github/workflows/pages.yml` | Deploys the public files to GitHub Pages | Used by GitHub |
| `_headers` | Cloudflare-only cache rules, ignored by GitHub Pages | No effect |
| `audio/` | 3 tiny sample tones so it works out of the box | Dropped from exports automatically once no episode uses them |
| `site.zip` | The same site files, zipped, to load into the manager the first time | No |
| **`manager.html`** | **Your private manager** | **Never. Keep it on your Mac.** |

`manager.html` has no password and can change everything, so it must never be uploaded or shared as a link. It runs from the file on your Mac, works in Safari and Chrome, and needs no internet.

## Deploy with a private GitHub repo and GitHub Pages

Your whole site (including audio) lives in a **private repo**. A workflow in `.github/workflows/pages.yml` publishes only the public files to GitHub Pages every time you push to `main`. `manager.html`, `site.zip` and this README are never published.

**Read this first**
- GitHub Pages from a **private** repo needs a paid GitHub plan (Pro, Team or Enterprise). On the Free plan, Pages only works with public repos.
- The published website is **public** even when the repo is private. Anyone with an audio URL can play it, so do not put anything in `audio/` that is not meant to be public.
- Limits: files under 100 MB (the manager caps audio at 90 MiB), site under 1 GB, roughly 100 GB of traffic a month. A podcast that outgrows this should move audio to external hosting (set the audio base URL in the manager).

**One-time setup**
1. Create a **private** repo (for example `podcast-site`) and upload everything in this folder, including the hidden `.github` folder. Easiest: on your Mac, `cd` into the folder, then `git init -b main`, `git add -A`, `git commit -m "Initial site"`, `git remote add origin git@github.com:YOURNAME/podcast-site.git`, `git push -u origin main`. (Drag and drop in the GitHub web page skips hidden folders.)
2. In the repo go to **Settings, Pages**, and under **Build and deployment** set **Source** to **GitHub Actions**.
3. Open the **Actions** tab. The "Deploy site to GitHub Pages" run starts on the first push (or press **Run workflow**). When it is green, your site is at `https://YOURNAME.github.io/podcast-site/`.
4. Open `manager.html`, load the site (below), then on **Customise** set **Public site URL** to that address so link previews show your share image.

The site uses only relative links, so it works under the `/podcast-site/` sub-path and on a custom domain alike. Home Screen install and lock-screen audio need HTTPS, which Pages provides.

**Each time you add an episode**
1. Create a fine-grained token: GitHub, Settings, Developer settings, **Fine-grained tokens**, only this repository, **Contents: Read and write**.
2. Open `manager.html` (double-click it, Safari or Chrome), enter `owner/name` and the token, click **Load from GitHub**.
3. **Episodes, Add episode.** Audio hosting is set to **In my GitHub repo** automatically. Add title, description, cover and audio (under 90 MiB).
4. Check **Preview**, then **Export, Publish to GitHub**. It commits only the changed files, and the workflow deploys them in a minute or two. Watch progress in the Actions tab.

Notes:
- The token is only sent to api.github.com from the manager and is never written into the site. "Remember the token" keeps it in this browser only.
- If Publish says the branch changed, load from GitHub again and redo your change.
- Keep `manager.html` off the site: the workflow already skips it, and the repo is private, but never share it as a link because it has no password.
- GitHub Pages ignores the `_headers` file (that was for Cloudflare). It is harmless. Pages caches files for about 10 minutes, so a new episode can take a few minutes to appear; the service worker fetches fresh files first.
- The Pages deployment appears under **Settings, Pages**. To use your own domain, add it there.

### Alternative: audio on separate storage
If you would rather not keep audio in the repo, set **Audio hosting** to **External** in the manager and enter a base URL for a bucket with a custom domain (Cloudflare R2 works well). Upload the files it lists to that bucket. Test with `curl -sI -H "Range: bytes=0-1" URL`: you want `206`, `accept-ranges: bytes` and `content-type: audio/mpeg`.

### Alternative: loading from a zip
Drop `site.zip` (or any exported zip) onto the manager's start screen. After **Export** you can unzip over your repo folder and `git commit` and `git push`.

## Mac gotcha: Safari unzips downloads

By default Safari opens "safe" files after downloading, which turns the exported zip into a folder and deletes the zip. Either turn that off (Safari, Settings, General, untick **Open "safe" files after downloading**) or export from Chrome. If you only have the unzipped folder, right-click it in Finder and choose Compress to get a zip to load into the manager again. Cloudflare Pages also accepts the folder directly.

## Routine without the GitHub connection (zip method)

1. Open `manager.html` and drop in your latest exported zip.
2. **Episodes, Add episode**, check **Preview**, then **Export site**.
3. Unzip over your local repo folder, then `git add -A`, `git commit`, `git push`. The workflow deploys it.

Editing, reordering (set **Order on site** to Manual), searching and deleting episodes all work the same way. Deleting an episode removes its files on the next Publish to GitHub.

## How playback works (and why it survives a locked iPhone)

- One persistent `<audio>` element handles all playback. Switching episodes only changes its `src`; the page is never reloaded.
- Playback starts only from a tap, with `preload="metadata"`. No Web Audio, video elements or iframes are used.
- The Media Session API provides title, show name and artwork for the lock screen and Control Center, plus play, pause, seek back 15 s, seek forward 30 s, seek to, previous and next, and keeps position state updated.
- On iPhone, if previous/next track handlers are set, the lock screen shows them instead of the 15 s/30 s skip buttons. The manager has a switch ("Previous/next episode buttons on the lock screen") if you prefer the skip buttons.
- The service worker caches only the app shell, uses network-first for the HTML, JSON, CSS and JS so new episodes appear after you deploy, and never touches audio or any Range request.
- Playback position is remembered per episode in `localStorage`, plus the last-played episode. Episodes advance automatically when one ends.

## iPhone test checklist

Run **everything twice**: once in a **Safari tab**, once from the **Home Screen app** (Share, Add to Home Screen, then launch from the icon). Use real audio from R2, not the sample tones, and an episode of a few minutes.

1. Open the site. Tap an episode's **Play**. Audio starts.
2. Lock the phone with the side button. Audio keeps playing.
3. Wake the screen. The lock screen shows the **title, show name and artwork**, with working play/pause.
4. Use the lock-screen controls: pause, play, and **drag the scrubber** to seek. Skip buttons or previous/next respond (depending on your setting).
5. Unlock and return to the site. The player shows the **same position and play state** as the lock screen.
6. Change speed (1×, 1.25×, 1.5×, 2×) and confirm it applies.
7. Let one episode end, or seek near its end. The **next episode starts**. Lock the phone first to check it continues while locked.
8. Pause at a known time, **close the app completely** (swipe it away, or close the tab), and reopen. The **last episode is selected and the position is remembered** (playback itself does not start until you tap).
9. Switch to the other mode (tab vs Home Screen) and repeat.
10. Turn Wi-Fi off briefly in the app: the site shell should still open, and audio should fail gracefully with a message.

## Troubleshooting

Background audio in Home Screen web apps on iOS has been **less reliable than in Safari tabs** in some iOS versions. If it stops when the phone locks in the Home Screen app:

- First confirm the same episode keeps playing when locked in a normal **Safari tab**. If it does, the site and audio are fine and the issue is iOS standalone behaviour.
- Check the audio headers (the curl check under "Audio on separate storage"). Wrong `Content-Type` or no Range support breaks seeking and can stop playback.
- Make sure the file is MP3 or AAC (.m4a), not WAV, FLAC or Ogg.
- Fully quit the Home Screen app, reopen it, and start playback with a tap. Playback never starts automatically.
- Remove the Home Screen icon and add it again after updating iOS.
- Check iPhone **Settings, Focus/Low Power Mode**; Low Power Mode can interrupt background media.
- Make sure the phone is not silenced by a ringer-mode quirk: raise the volume with the side buttons while playing.
- If the lock screen shows the wrong buttons, toggle "Previous/next episode buttons on the lock screen" in the manager and redeploy.
- If you changed things and an old version appears, close and reopen the app. The service worker version changes on every export, so the update arrives on the next launch.
- As a fallback for listeners, the site always works in Safari, which is the most reliable mode.

## Home Screen app

The manager generates the manifest and all icons (180×180 apple-touch-icon, 192 and 512 PNG, and a maskable 512) from one uploaded square image. Visitors on iPhone Safari who have not installed the app see a small dismissible hint (Share, Add to Home Screen). It never shows once installed, and you can switch it off or change its text in the manager.

## Notes and limits

- The preview in the manager runs the real public page, but audio hosted in R2 plays in the preview only for episodes whose audio you added in the current session.
- Fonts (Inter, Space Grotesk, Lora, Fraunces) are bundled in `fonts/`, so no external font requests are made.
- Everything the visitor sees comes from `site.json` and `episodes.json`. You can edit those by hand, but the manager is easier.
- Visitors cannot add or edit anything, and the public page never links to the manager.

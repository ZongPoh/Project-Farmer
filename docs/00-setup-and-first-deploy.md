# Step 0 — Get it on the internet before you build anything

Deploy on day one, while the app is nearly empty. If you leave deployment to
the end it becomes a scary unknown sitting between you and shipping. Do it
now, when there is nothing to break.

## Run it locally

```bash
npm install
npm run dev
```

Open the URL it prints. You should see the hex board.

## Deploy

The game is a static site, so it is hosted on **GitHub Pages** — no server, no
account beyond GitHub. (It was Firebase Hosting originally; that has been
dropped.)

```bash
git remote add origin https://github.com/<your-user>/<repo-name>.git
git push -u origin main
```

Then, once, in the repository on GitHub: **Settings → Pages → Source →
GitHub Actions**.

`.github/workflows/pages.yml` does the rest on every push to `main`:

- `npm ci` — installs exactly what `package-lock.json` pins
- `npm run check` — lint and tests; a broken push is not published
- `npm run build` — Vite writes the site to `dist/`
- uploads `dist/` and publishes it

`vite.config.js` sets `base: "./"`, so every asset path is relative and the
site works at `https://<your-user>.github.io/<repo-name>/` whatever the
repository is called. There is no client-side routing, so no rewrite rule is
needed.

## Done when

You can send someone a `github.io` URL and they see the board spinning.

## Exercise

Change the page title in `index.html`, commit, push. Watch the run in the
**Actions** tab and confirm the change is live. The whole loop takes a couple
of minutes.

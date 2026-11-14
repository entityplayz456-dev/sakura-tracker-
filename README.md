# Sakura · Daily Goals

A calm, offline-first tracker for two daily goals (protein and calories) plus optional morning weight.
No account, no server: everything is stored on your phone in IndexedDB.

## Folder structure

```
sakura-tracker/
├── index.html            app page + decorative SVGs
├── style.css             cherry-blossom theme
├── db.js                 IndexedDB layer (versioned, additive-only upgrades)
├── app.js                dashboard, calendar, weight, stats, import/export
├── service-worker.js     offline cache for the app files (never touches your data)
├── manifest.json         install-as-app settings
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
└── README.md
```

## Put it on GitHub Pages (from your phone or laptop)

1. On github.com tap **+ → New repository**. Name it `sakura-tracker`, set it to **Public**, and tap **Create repository**.
2. Tap **uploading an existing file**. Upload every file. Keep `index.html` at the top level of the repo and the three icons inside an `icons` folder. Some phones flatten folders when uploading; if that happens, create the folder by naming a new file `icons/icon-192.png`, or upload the icons separately into `icons/`.
3. Tap **Commit changes**.
4. Go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, set the branch to **main** and the folder to **/ (root)**, then tap **Save**.
5. Wait 1–2 minutes. Your app is at `https://<your-username>.github.io/sakura-tracker/`.
6. Open that link in Chrome on your phone, then use **⋮ → Add to Home screen / Install app**.

This runs alongside your gym timer. Each repo gets its own address, and the two apps keep separate data.

## Updating the code later

Upload the changed files to the same repo with the same names. Your records are **not** affected: they live in the browser's database, not in the files. If you change `service-worker.js`, increase `sakura-v1` to `sakura-v2` so phones refresh their cached copy.

Do **not** rename the repo or your GitHub username. The data belongs to the site's address, so a new address starts with an empty app. If you ever have to move it, export a backup first and import it at the new address.

## Backing up and restoring

* **Back up:** Settings → **Export JSON**. Keep the file somewhere safe, such as Google Drive or email it to yourself. About once a month is enough.
* **Spreadsheet copy:** Settings → **Download CSV** (`date, protein_met, calorie_met, weight_kg`).
* **Restore:** Settings → **Import backup** and choose a `.json` or `.csv` file. Before anything changes, you choose:
  * **Merge** adds the file's days. Where a date exists both on the device and in the file, the file's version wins.
  * **Replace all** wipes the device first and restores the file exactly. This happens in a single database transaction, so a failed import changes nothing.

Clearing this site's data in browser settings, uninstalling the browser or switching phones removes your records. That's why backups matter.

## How things are counted

* Each day is one record keyed by its **local** date (`YYYY-MM-DD`), so editing a day updates it and never creates a duplicate.
* Adherence = days where both goals were met ÷ days you logged. Days with no entry and future days are never counted as failures.
* A streak counts consecutive days with both goals met. If today isn't complete yet, the streak counts back from yesterday.
* Weekly weight average uses only the weigh-ins you actually entered in that Monday–Sunday week, and shows how many there were.

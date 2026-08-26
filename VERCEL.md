# Deploy Movies By Prosper Sasuu on Vercel

## 1. Upload the site
Unzip this package so these files are at the project root:

- `index.html`, `styles.css`, `app.js`
- `manifest.json`, `sw.js`
- `robots.txt`, `ads.txt`, `sitemap.xml`
- `vercel.json`
- `icons/` folder

## 2. Deploy
### Option A — Vercel CLI
```bash
npm i -g vercel
vercel login
vercel --prod
```

### Option B — GitHub
1. Create a GitHub repo and push these files.
2. vercel.com → **Add New Project** → import the repo.
3. Framework Preset: **Other**
4. Build Command: leave empty  
   Output Directory: leave empty (or `.`)
5. Deploy.

### Option C — Drag & drop
Vercel Dashboard → **Add New…** → **Project** → upload the unzipped folder.

## 3. After first deploy
1. Copy your production URL (e.g. `https://movies-bps.vercel.app`).
2. Edit `robots.txt` and `sitemap.xml`: replace `YOUR-DOMAIN.vercel.app` with that host.
3. Redeploy.
4. Open:
   - `https://YOUR-DOMAIN.vercel.app/ads.txt`
   - `https://YOUR-DOMAIN.vercel.app/robots.txt`
   - `https://YOUR-DOMAIN.vercel.app/sitemap.xml`

## 4. Google & AdSense
1. **Search Console** → add property → verification meta is already in `index.html`.
2. Submit sitemap: `https://YOUR-DOMAIN.vercel.app/sitemap.xml`
3. **AdSense** → sites → your domain → ensure `ads.txt` is reachable.
4. Auto ads are enabled via page-level config; after approval, ads fill reserved slots.

## 5. Deep links (`/movie/123`)
`vercel.json` rewrites `/movie/:id` → `index.html` so client routing and shares work.

## 6. Custom domain (optional)
Vercel Project → Settings → Domains → add domain → update `robots.txt` / `sitemap.xml` again.

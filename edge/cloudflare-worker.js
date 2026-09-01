/**
 * Movies By Prosper Sasuu — Edge OG injection (Cloudflare Worker)
 *
 * Deploy: wrangler publish (or paste into Cloudflare Dashboard → Workers)
 * Routes: yourdomain.com/movie/*  and optionally yourdomain.com/*
 *
 * Behavior:
 * - Browser requests for /movie/:id → SPA shell (same origin index) so the app boots
 * - Social crawlers (Twitter, Facebook, WhatsApp, Telegram, Slack, etc.)
 *   get HTML with Open Graph + Twitter Card tags filled from the YTS proxy API
 */

const API = 'https://movies-api.accel.li/api/v2';

const BOT_RE = /facebookexternalhit|Facebot|Twitterbot|WhatsApp|TelegramBot|Slackbot|LinkedInBot|Discordbot|Googlebot|bingbot|Baiduspider|Embedly|Quora Link Preview|Showyoubot|outbrain|pinterest|vkShare|W3C_Validator|redditbot|Applebot|Iframely/i;

function isBot(ua) {
  return BOT_RE.test(ua || '');
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fixImage(url) {
  if (!url) return '';
  return String(url).replace(/yts\.(mx|am|gg)/g, 'yts.lt');
}

async function fetchMovie(id) {
  const u = `${API}/movie_details.json?movie_id=${id}&with_images=true&with_cast=false`;
  const res = await fetch(u, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) return null;
  const json = await res.json();
  if (json.status !== 'ok') return null;
  return json.data?.movie || null;
}

function ogHtml(movie, canonical) {
  const title = `${movie.title} (${movie.year})`;
  const desc = (movie.description_full || movie.description_intro || movie.summary || `Watch details, torrents & cast for ${movie.title}`).slice(0, 200);
  const image = fixImage(movie.large_cover_image || movie.medium_cover_image || movie.background_image_original || '');
  const rating = movie.rating != null ? ` ★ ${movie.rating}` : '';
  const site = 'Movies By Prosper Sasuu';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} · ${escapeHtml(site)}</title>
  <meta name="description" content="${escapeHtml(desc)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />

  <!-- Open Graph -->
  <meta property="og:type" content="video.movie" />
  <meta property="og:site_name" content="${escapeHtml(site)}" />
  <meta property="og:title" content="${escapeHtml(title)}${escapeHtml(rating)}" />
  <meta property="og:description" content="${escapeHtml(desc)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:image:alt" content="${escapeHtml(movie.title)} poster" />
  ${movie.year ? `<meta property="og:video:release_date" content="${escapeHtml(String(movie.year))}" />` : ''}

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(desc)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />

  <!-- Non-JS fallback -->
  <meta http-equiv="refresh" content="0;url=${escapeHtml(canonical)}" />
  <style>
    body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    a{color:#e50914}
  </style>
</head>
<body>
  <p>Opening <strong>${escapeHtml(title)}</strong>… <a href="${escapeHtml(canonical)}">Continue</a></p>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/movie\/(\d+)(?:\/.*)?$/);
    if (!match) {
      // Optional: SPA fallback if this worker is on /* 
      return fetch(request);
    }

    const id = match[1];
    const ua = request.headers.get('user-agent') || '';
    const canonical = `${url.origin}/movie/${id}`;

    // Browsers: serve the real app (index) so client router can open details
    if (!isBot(ua)) {
      // Fetch origin index.html (adjust if assets are on same zone)
      const indexUrl = new URL('/', url.origin);
      const indexReq = new Request(indexUrl, request);
      const res = await fetch(indexReq);
      // Ensure HTML is not cached as movie-specific forever
      const headers = new Headers(res.headers);
      headers.set('Cache-Control', 'public, max-age=60');
      return new Response(res.body, { status: res.status, headers });
    }

    // Crawlers: inject OG tags
    try {
      const movie = await fetchMovie(id);
      if (!movie) {
        return new Response(ogHtml({
          title: 'Movie',
          year: '',
          description_full: 'Movie on Movies By Prosper Sasuu',
          large_cover_image: ''
        }, canonical), {
          status: 404,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' }
        });
      }
      return new Response(ogHtml(movie, canonical), {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=3600, s-maxage=86400'
        }
      });
    } catch (e) {
      return new Response('Upstream error', { status: 502 });
    }
  }
};

/**
 * Netlify Edge Function — OG injection for /movie/:id
 * Place as: netlify/edge-functions/movie-og.ts
 * netlify.toml:
 *   [[edge_functions]]
 *     function = "movie-og"
 *     path = "/movie/*"
 */
import type { Context } from "https://edge.netlify.com";

const API = "https://movies-api.accel.li/api/v2";
const BOT_RE = /facebookexternalhit|Facebot|Twitterbot|WhatsApp|TelegramBot|Slackbot|LinkedInBot|Discordbot|Googlebot|bingbot|redditbot|Applebot|Iframely/i;

function isBot(ua: string) {
  return BOT_RE.test(ua || "");
}

function escapeHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fixImage(url: string) {
  return String(url || "").replace(/yts\.(mx|am|gg)/g, "yts.lt");
}

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/movie\/(\d+)(?:\/.*)?$/);
  if (!m) return context.next();

  const ua = request.headers.get("user-agent") || "";
  if (!isBot(ua)) {
    // Let Netlify serve index.html via SPA fallback
    return context.next();
  }

  const id = m[1];
  const canonical = `${url.origin}/movie/${id}`;
  try {
    const res = await fetch(
      `${API}/movie_details.json?movie_id=${id}&with_images=true`
    );
    const json = await res.json();
    const movie = json?.data?.movie;
    if (!movie) return context.next();

    const title = `${movie.title} (${movie.year})`;
    const desc = (
      movie.description_full ||
      movie.summary ||
      `Details for ${movie.title}`
    ).slice(0, 200);
    const image = fixImage(movie.large_cover_image || movie.medium_cover_image);

    const html = `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="video.movie"/>
<meta property="og:title" content="${escapeHtml(title)}"/>
<meta property="og:description" content="${escapeHtml(desc)}"/>
<meta property="og:url" content="${escapeHtml(canonical)}"/>
<meta property="og:image" content="${escapeHtml(image)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(title)}"/>
<meta name="twitter:image" content="${escapeHtml(image)}"/>
</head><body></body></html>`;

    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return context.next();
  }
};

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Initialize Google GenAI SDK server-side
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

// Prevent caching of service worker and HTML documents to guarantee freshness
app.use((req, res, next) => {
  if (req.path === '/sw.js' || req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});

// Official YTS endpoints documented at https://yts.gg/api
const API_UPSTREAMS = [
  'https://movies-api.accel.li/api/v2',
  'https://yts.gg/api/v2',
];

// Helper to query YTS movies API internally with automatic upstream fallback
async function queryMovieApi(endpoint, params = {}) {
  const query = new URLSearchParams(params).toString();
  const queryString = query ? '?' + query : '';

  for (const upstream of API_UPSTREAMS) {
    const url = `${upstream}/${endpoint}${queryString}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const r = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
        },
      });
      clearTimeout(timeout);
      if (r.ok) {
        const data = await r.json();
        if (data && (data.status === 'ok' || data.data)) {
          return data;
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      // Try next upstream in pool
    }
  }
  return null;
}

async function callWithTimeout(promise, ms = 3500) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('AI response timed out')), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

// 1. AI Vibe Search: Finds movies matching natural language vibes, moods, or themes
app.post('/api/ai/vibe-search', async (req, res) => {
  const { vibe } = req.body || {};
  if (!vibe || typeof vibe !== 'string' || !vibe.trim()) {
    return res.status(400).json({ error: 'Please provide a movie vibe or mood prompt.' });
  }

  const promptText = vibe.trim();

  try {
    let aiResult = null;

    if (ai) {
      try {
        const response = await callWithTimeout(
          ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: `You are a film curator. The user wants movies that match this vibe or theme: "${promptText}".
Recommend 5 real, well-known, high-quality movies available in major film databases that strongly match this aesthetic or mood.
Return JSON with a 1-sentence curator summary and 5 recommendations with title, release year, primary genre, a punchy 1-sentence match explanation, and a clean search query for the movie title.`,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  summary: { type: Type.STRING },
                  recommendations: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        title: { type: Type.STRING },
                        year: { type: Type.NUMBER },
                        genre: { type: Type.STRING },
                        matchReason: { type: Type.STRING },
                        searchQuery: { type: Type.STRING },
                      },
                      required: ['title', 'year', 'genre', 'matchReason', 'searchQuery'],
                    },
                  },
                },
                required: ['summary', 'recommendations'],
              },
            },
          }),
          3500
        );

        if (response && response.text) {
          aiResult = JSON.parse(response.text);
        }
      } catch (aiErr) {
        console.warn('AI call bypassed/timeout, using curated catalog match:', aiErr.message);
      }
    }

    // Fallback if AI is unavailable or failed to produce items
    if (!aiResult || !Array.isArray(aiResult.recommendations) || aiResult.recommendations.length === 0) {
      const cleaned = promptText.replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);
      let searchTerm = cleaned[0] || 'thriller';
      
      let fallbackData = await queryMovieApi('list_movies.json', {
        query_term: searchTerm,
        sort_by: 'rating',
        limit: 5,
      });

      let movies = fallbackData?.data?.movies || [];
      if (movies.length === 0 && cleaned.length > 1) {
        fallbackData = await queryMovieApi('list_movies.json', {
          query_term: cleaned[1],
          sort_by: 'rating',
          limit: 5,
        });
        movies = fallbackData?.data?.movies || [];
      }
      if (movies.length === 0) {
        fallbackData = await queryMovieApi('list_movies.json', {
          sort_by: 'rating',
          limit: 5,
        });
        movies = fallbackData?.data?.movies || [];
      }

      return res.json({
        summary: `Curated selection matching vibe: "${promptText}"`,
        items: movies.map(m => ({
          id: m.id,
          title: m.title,
          year: m.year,
          rating: m.rating,
          genres: m.genres || [],
          medium_cover_image: m.medium_cover_image,
          matchReason: `High-rated ${m.genres?.[0] || 'film'} matching your mood.`,
          torrents: m.torrents || [],
        })),
      });
    }

    // Enhance AI recommendations with live movie catalog posters and IDs
    const enriched = await Promise.all(
      aiResult.recommendations.map(async (rec) => {
        const queryTerm = rec.searchQuery || rec.title;
        const catalogData = await queryMovieApi('list_movies.json', {
          query_term: queryTerm,
          limit: 2,
        });

        const match = catalogData?.data?.movies?.[0] || null;

        return {
          id: match ? match.id : null,
          title: rec.title,
          year: rec.year,
          genre: rec.genre,
          matchReason: rec.matchReason,
          rating: match?.rating || null,
          medium_cover_image: match?.medium_cover_image || null,
          torrents: match?.torrents || [],
          genres: match?.genres || [rec.genre],
        };
      })
    );

    res.json({
      summary: aiResult.summary,
      items: enriched,
    });
  } catch (err) {
    console.error('AI vibe search error:', err);
    // Graceful fallback to catalog query
    const catalogData = await queryMovieApi('list_movies.json', {
      sort_by: 'rating',
      limit: 5,
    });
    res.json({
      summary: 'Recommended cinema picks:',
      items: (catalogData?.data?.movies || []).map(m => ({
        id: m.id,
        title: m.title,
        year: m.year,
        rating: m.rating,
        genres: m.genres || [],
        medium_cover_image: m.medium_cover_image,
        matchReason: `Top rated selection (${m.rating}★).`,
        torrents: m.torrents || [],
      })),
    });
  }
});

// 2. AI Movie Insights: Generates quick critic hooks and "Why you'll love it"
app.post('/api/ai/movie-insight', async (req, res) => {
  const { title, year, genres = [], summary = '' } = req.body || {};
  if (!title) {
    return res.status(400).json({ error: 'Movie title required' });
  }

  try {
    if (ai) {
      try {
        const response = await callWithTimeout(
          ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: `Analyze the film "${title}" (${year || 'recent'}), genres: ${genres.join(', ')}.
Synopsis: "${(summary || '').slice(0, 300)}".
Provide a concise, punchy AI critic insight in JSON:
1. "hook": 2 sentences max explaining what makes this movie unforgettable or worth watching.
2. "vibe": 3 mood keywords (e.g. "Gritty, Cerebral, Uncompromising").
3. "bestFor": 1 short phrase on who will love it (e.g. "Fans of Denis Villeneuve and slow-burn mysteries").`,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  hook: { type: Type.STRING },
                  vibe: { type: Type.STRING },
                  bestFor: { type: Type.STRING },
                },
                required: ['hook', 'vibe', 'bestFor'],
              },
            },
          }),
          3500
        );

        if (response && response.text) {
          return res.json(JSON.parse(response.text));
        }
      } catch (aiErr) {
        console.warn('AI insight call timeout/bypass:', aiErr.message);
      }
    }

    // Default critic insight
    const primaryGenre = genres[0] || 'Cinema';
    res.json({
      hook: `An impactful ${primaryGenre.toLowerCase()} piece with standout visual storytelling and engaging performances.`,
      vibe: `${primaryGenre}, Engaging, Atmospheric`,
      bestFor: `Enthusiasts of classic and modern ${primaryGenre.toLowerCase()} storytelling`,
    });
  } catch (err) {
    console.error('AI insight error:', err);
    res.json({
      hook: `A notable title in ${genres[0] || 'cinema'} with memorable moments and strong production quality.`,
      vibe: 'Atmospheric, Engaging, Cinematic',
      bestFor: 'Moviegoers seeking quality genre storytelling',
    });
  }
});

// 3. Random Movie Roll / Surprise Me
app.get('/api/random-movie', async (req, res) => {
  try {
    const { quality, genre, minimum_rating } = req.query;
    const params = {
      limit: 20,
      sort_by: 'rating',
      order_by: 'desc',
    };
    if (quality) params.quality = quality;
    if (genre) params.genre = genre;
    if (minimum_rating) params.minimum_rating = minimum_rating;

    // Randomize page between 1 and 25
    const randomPage = Math.floor(Math.random() * 20) + 1;
    params.page = randomPage;

    let data = await queryMovieApi('list_movies.json', params);
    let movies = data?.data?.movies || [];

    if (movies.length === 0) {
      // Fallback to page 1
      params.page = 1;
      data = await queryMovieApi('list_movies.json', params);
      movies = data?.data?.movies || [];
    }

    if (movies.length === 0) {
      return res.status(404).json({ error: 'No movies found matching criteria' });
    }

    const randomPick = movies[Math.floor(Math.random() * movies.length)];
    res.json({ movie: randomPick });
  } catch (err) {
    console.error('Random movie error:', err);
    res.status(500).json({ error: 'Failed to pick random movie' });
  }
});

// Proxy movie API requests to avoid CORS and client-side network restrictions,
// with automatic failover across official YTS upstreams (https://yts.gg/api)
app.use('/api/v2', async (req, res) => {
  let lastError = null;

  for (const upstream of API_UPSTREAMS) {
    try {
      const targetUrl = `${upstream}${req.url}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);

      const apiRes = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
        },
      });
      clearTimeout(timeout);

      // If response is OK or a valid not-found (404), return it directly
      if (apiRes.ok || apiRes.status === 404) {
        const data = await apiRes.text();
        return res.status(apiRes.status)
          .set('Content-Type', apiRes.headers.get('content-type') || 'application/json')
          .send(data);
      }

      lastError = new Error(`Upstream ${upstream} returned status ${apiRes.status}`);
    } catch (err) {
      lastError = err;
      // Try next upstream
    }
  }

  console.error('API proxy error across all upstreams:', lastError?.message);
  res.status(502).json({
    status: 'error',
    message: 'API request failed: ' + (lastError?.message || 'All upstreams unavailable'),
  });
});

// Serve static assets from root directory
app.use(express.static(__dirname, {
  extensions: ['html'],
}));

// Fallback for SPA routing to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});

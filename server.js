import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Prevent caching of service worker and HTML documents to guarantee freshness
app.use((req, res, next) => {
  if (req.path === '/sw.js' || req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});

// Proxy movie API requests to avoid CORS and client-side network restrictions
app.use('/api/v2', async (req, res) => {
  try {
    const targetUrl = `https://movies-api.accel.li/api/v2${req.url}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const apiRes = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    clearTimeout(timeout);

    const data = await apiRes.text();
    res.status(apiRes.status)
      .set('Content-Type', apiRes.headers.get('content-type') || 'application/json')
      .send(data);
  } catch (err) {
    console.error('API proxy error:', err.message);
    res.status(502).json({ status: 'error', message: 'API request failed: ' + err.message });
  }
});

// Serve static assets from root directory
app.use(express.static(__dirname, {
  extensions: ['html']
}));

// Fallback for SPA routing to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

const API = (typeof window !== 'undefined' && window.location?.origin && window.location.origin.startsWith('http'))
  ? '/api/v2'
  : 'https://movies-api.accel.li/api/v2';

const state = {
  page: 1,
  query: '',
  quality: '',
  genre: '',
  rating: '',
  year: '',
  language: '',
  sort: 'latest',
  movies: [],
  loading: false,
  hasMore: true,
  currentMovieId: null,
  total: 0,
  mode: 'browse', // browse | watchlist
  pageSize: window.matchMedia('(max-width: 600px)').matches ? 16 : 20,
  compareList: [],
  advFilters: {
    decade: '',
    runtime: '',
    seeds: ''
  },
  wlCategory: 'all'
};

const $ = (sel) => document.querySelector(sel);
const movieGrid = $('#movieGrid');
const loadingEl = $('#loading');
const emptyEl = $('#empty');
const paginationEl = $('#pagination');
const searchInput = $('#searchInput');
const hSearchInput = $('#headerSearchInput');
const hSearchResults = $('#headerSearchResults');
const hSearchClear = $('#headerSearchClear');
const homeView = $('#homeView');
const detailsView = $('#detailsView');
const hero = $('#hero');

const on = (id, event, fn) => {
  const el = (typeof id === 'string') ? $(id) : id;
  if (el) el.addEventListener(event, fn);
};

async function quickSearch(query) {
  if (!query.trim()) {
    hSearchResults.hidden = true;
    hSearchClear.hidden = true;
    return;
  }
  hSearchClear.hidden = false;

  try {
    const res = await fetch(`${API}/list_movies.json?query_term=${encodeURIComponent(query)}&limit=5`);
    const json = await res.json();
    if (json.status !== 'ok') {
      renderQuickResults([], json.status_message || 'Search is temporarily unavailable.');
      return;
    }
    if (!Array.isArray(json.data?.movies)) {
      renderQuickResults([]);
      return;
    }
    renderQuickResults(json.data.movies);
  } catch (err) {
    console.error('Quick search error:', err);
  }
}

function renderQuickResults(movies, emptyMessage = 'No movies found.') {
  hSearchResults.innerHTML = '';
  hSearchResults.hidden = false;

  if (movies.length === 0) {
    const message = document.createElement('div');
    message.className = 'h-search-empty';
    message.textContent = emptyMessage;
    hSearchResults.appendChild(message);
    return;
  }

  const header = document.createElement('div');
  header.className = 'h-search-header';
  header.textContent = 'Quick Cinema Search';
  hSearchResults.appendChild(header);

  movies.forEach(m => {
    const item = document.createElement('div');
    item.className = 'h-result-item';
    const quality = m.torrents?.[0]?.quality || '720p';
    item.innerHTML = `
      <img src="${fixImageUrl(m.small_cover_image || m.medium_cover_image)}" class="h-result-img" alt="">
      <div class="h-result-info">
        <div class="h-result-title">${escapeHtml(m.title)}</div>
        <div class="h-result-meta">${m.year} • <span class="rating">★ ${m.rating}</span> • ${m.genres?.[0] || 'Movie'}</div>
      </div>
      <div class="h-result-quality">${quality}</div>
    `;
    item.onclick = () => {
      hSearchResults.hidden = true;
      hSearchInput.value = '';
      hSearchClear.hidden = true;
      openDetails(m.id, m.title + (m.year ? ' ' + m.year : ''), m);
    };
    hSearchResults.appendChild(item);
  });
}

on(hSearchInput, 'input', debounce((e) => quickSearch(e.target.value), 300));
on(hSearchInput, 'keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const value = hSearchInput.value.trim();
    if (!value) return;
    hSearchResults.hidden = true;
    hSearchClear.hidden = true;
    if (typeof applyFiltersAndSearch === 'function') {
      searchInput.value = value;
      applyFiltersAndSearch();
    }
  }
});
on(hSearchClear, 'click', () => {
  hSearchInput.value = '';
  hSearchResults.hidden = true;
  hSearchClear.hidden = true;
  hSearchInput.focus();
});

// Close dropdown on click outside
on(document, 'click', (e) => {
  if (!e.target.closest('.header-search')) {
    hSearchResults.hidden = true;
  }
});

// ---- Storage helpers ----
const LS = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }
};

// Watchlist: array of movie summary objects {id, title, year, rating, medium_cover_image, category, addedAt}
function getWatchlist() {
  const raw = LS.get('mbps_watchlist', []);
  return raw.map(m => ({
    ...m,
    category: m.category || 'plan',
    addedAt: m.addedAt || Date.now()
  }));
}
function setWatchlist(list) {
  LS.set('mbps_watchlist', list);
  updateWatchlistBadge();
}
function isInWatchlist(id) { return getWatchlist().some(m => m.id === id); }
function toggleWatchlist(movie, category = 'plan') {
  let list = getWatchlist();
  if (list.some(m => m.id === movie.id)) {
    list = list.filter(m => m.id !== movie.id);
    toast('Removed from Watchlist');
  } else {
    list.unshift({
      id: movie.id,
      title: movie.title,
      year: movie.year,
      rating: movie.rating,
      category: category,
      addedAt: Date.now(),
      medium_cover_image: movie.medium_cover_image || movie.large_cover_image
    });
    if (list.length > 300) list = list.slice(0, 300);
    toast('Added to Watchlist');
  }
  setWatchlist(list);
  return isInWatchlist(movie.id);
}
function setMovieCategory(movieId, category) {
  let list = getWatchlist();
  const item = list.find(m => m.id === movieId);
  if (item) {
    item.category = category;
    setWatchlist(list);
    const catLabels = { plan: 'Plan to Watch', watched: 'Watched', favorite: 'Favorites' };
    toast(`Moved to ${catLabels[category] || category}`);
    if (state.mode === 'watchlist') loadWatchlist();
  }
}
function updateWatchlistBadge() {
  const list = getWatchlist();
  const n = list.length;
  const badge = $('#watchlistBadge');
  if (badge) {
    badge.hidden = n === 0;
    badge.textContent = n;
  }
  const mobileBadge = $('#mobileWatchlistBadge');
  if (mobileBadge) {
    mobileBadge.hidden = n === 0;
    mobileBadge.textContent = n;
  }
  const countAll = $('#wlCatAll');
  const countPlan = $('#wlCatPlan');
  const countWatched = $('#wlCatWatched');
  const countFav = $('#wlCatFavorite');
  if (countAll) countAll.textContent = n;
  if (countPlan) countPlan.textContent = list.filter(m => m.category === 'plan').length;
  if (countWatched) countWatched.textContent = list.filter(m => m.category === 'watched').length;
  if (countFav) countFav.textContent = list.filter(m => m.category === 'favorite').length;
}

function exportWatchlistJson() {
  const list = getWatchlist();
  if (!list.length) return toast('Watchlist is empty');
  const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `movies-watchlist-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Watchlist JSON exported!');
}

function exportWatchlistCsv() {
  const list = getWatchlist();
  if (!list.length) return toast('Watchlist is empty');
  const header = ['ID', 'Title', 'Year', 'Rating', 'Category', 'AddedDate'];
  const rows = list.map(m => [
    m.id,
    `"${(m.title || '').replace(/"/g, '""')}"`,
    m.year || '',
    m.rating || '',
    m.category || 'plan',
    new Date(m.addedAt || Date.now()).toISOString().slice(0, 10)
  ]);
  const csvContent = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `movies-watchlist-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Watchlist CSV exported!');
}

function importWatchlistFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('Invalid format');
      const current = getWatchlist();
      const existingIds = new Set(current.map(m => m.id));
      let added = 0;
      data.forEach(item => {
        if (item && item.id && !existingIds.has(item.id)) {
          current.push({
            id: item.id,
            title: item.title || 'Movie',
            year: item.year || 2020,
            rating: item.rating || 0,
            medium_cover_image: item.medium_cover_image || '',
            category: item.category || 'plan',
            addedAt: item.addedAt || Date.now()
          });
          existingIds.add(item.id);
          added++;
        }
      });
      setWatchlist(current);
      if (state.mode === 'watchlist') loadWatchlist();
      toast(`Imported ${added} new movies!`);
    } catch (err) {
      toast('Failed to import watchlist JSON');
    }
  };
  reader.readAsText(file);
}

function shareWatchlist() {
  const list = getWatchlist();
  if (!list.length) return toast('Watchlist is empty');
  const miniList = list.slice(0, 40).map(m => ({ id: m.id, t: m.title, y: m.year, r: m.rating, img: m.medium_cover_image, c: m.category }));
  const jsonStr = JSON.stringify(miniList);
  const encoded = btoa(encodeURIComponent(jsonStr));
  const shareUrl = `${location.origin}${location.pathname}#shared-watchlist=${encoded}`;
  navigator.clipboard.writeText(shareUrl).then(() => {
    toast('Shareable link copied to clipboard!');
  }).catch(() => {
    prompt('Share this link:', shareUrl);
  });
}

// Recently viewed
function getRecent() { return LS.get('mbps_recent', []); }
function addRecent(movie) {
  let list = getRecent().filter(m => m.id !== movie.id);
  list.unshift({
    id: movie.id,
    title: movie.title,
    year: movie.year,
    medium_cover_image: movie.medium_cover_image || movie.large_cover_image
  });
  list = list.slice(0, 12);
  LS.set('mbps_recent', list);
  renderRecent();
}
function renderRecent() {
  const section = $('#recentSection');
  const strip = $('#recentStrip');
  const list = getRecent();
  if (!list.length || state.mode === 'watchlist') {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  strip.innerHTML = '';
  list.forEach(m => {
    const card = document.createElement('div');
    card.className = 'recent-card';
    card.innerHTML = `
      <img src="${fixImageUrl(m.medium_cover_image)}" alt="" loading="lazy" onerror="this.style.opacity=0.3" />
      <div class="card-title">${escapeHtml(m.title)}</div>
    `;
    on(card, 'click', () => openDetails(m.id, m.title + (m.year ? ' ' + m.year : '')));
    strip.appendChild(card);
  });
  if (strip) { strip.dataset.swipeBound = ''; bindStripSwipe('.recent-strip'); }
}

// Years
(function fillYears() {
  const sel = $('#filterYear');
  const current = new Date().getFullYear();
  for (let y = current; y >= 1970; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  }
})();

// Genre chips

const GENRES = ['Action','Adventure','Animation','Comedy','Crime','Documentary','Drama','Family','Fantasy','Horror','Mystery','Romance','Sci-Fi','Thriller','War','Western'];
(function fillChips() {
  const wrap = $('#genreChips');
  GENRES.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'genre-chip';
    btn.textContent = g;
    btn.dataset.genre = g;
    on(btn, 'click', () => {
      const active = btn.classList.contains('active');
      document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
      if (!active) {
        btn.classList.add('active');
        state.genre = g;
        $('#filterGenre').value = g;
      } else {
        state.genre = '';
        $('#filterGenre').value = '';
      }
      loadMovies(true);
    });
    wrap.appendChild(btn);
  });
})();

const GENRE_ICONS = {
  Action: '🔥', Adventure: '🧭', Animation: '✨', Comedy: '😄', Crime: '🕵️',
  Documentary: '🎥', Drama: '🎭', Family: '👨‍👩‍👧‍👦', Fantasy: '🐉', Horror: '👻',
  Mystery: '🔍', Romance: '💕', 'Sci-Fi': '🚀', Thriller: '😱', War: '⚔️', Western: '🤠'
};

function renderGenresHub() {
  const grid = $('#genresGrid');
  if (!grid) return;
  if (!grid.dataset.ready) {
    grid.innerHTML = '';
    GENRES.forEach(g => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'genre-card' + (state.genre === g ? ' active' : '');
      btn.dataset.genre = g;
      btn.innerHTML = `<span class="genre-card-ico" aria-hidden="true">${GENRE_ICONS[g] || '🎬'}</span><span>${escapeHtml(g)}</span>`;
      on(btn, 'click', () => selectGenreFromHub(g));
      grid.appendChild(btn);
    });
    grid.dataset.ready = '1';
  } else {
    grid.querySelectorAll('.genre-card').forEach(c => {
      c.classList.toggle('active', c.dataset.genre === state.genre);
    });
  }
}

function selectGenreFromHub(genre) {
  state.mode = 'browse';
  state.genre = genre;
  state.query = '';
  state.quality = '';
  state.rating = '';
  state.year = '';
  state.language = '';
  state.sort = 'latest';
  searchInput.value = '';
  $('#filterGenre').value = genre;
  $('#filterQuality').value = '';
  $('#filterRating').value = '';
  $('#filterYear').value = '';
  $('#filterLanguage').value = '';
  $('#filterOrder').value = 'latest';
  document.querySelectorAll('.genre-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.genre === genre);
  });
  document.querySelectorAll('.genre-card').forEach(c => {
    c.classList.toggle('active', c.dataset.genre === genre);
  });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector('.nav-item[data-view="genres"]')?.classList.add('active');
  const hub = $('#genresHub');
  const moviesSec = $('#moviesSection');
  if (hub) hub.hidden = true;
  if (moviesSec) moviesSec.hidden = false;

  const targetPath = `/genres/${encodeURIComponent(genre)}`;
  if (location.pathname !== targetPath) {
    history.pushState({ genre }, '', targetPath);
  }

  loadMovies(true);
}

function showGenresHub() {
  if (state.currentMovieId) closeDetails();
  homeView.hidden = false;
  detailsView.hidden = true;
  renderGenresHub();
  const hub = $('#genresHub');
  const moviesSec = $('#moviesSection');
  if (hub) hub.hidden = false;
  if (moviesSec) moviesSec.hidden = true;
  if (hero) hero.hidden = true;
  const recent = $('#recentSection');
  if (recent) recent.hidden = true;
  const about = $('#about-site');
  if (about) about.hidden = true;
  const adTop = $('#adTop');
  if (adTop) adTop.hidden = true;
  emptyEl.hidden = true;
  loadingEl.hidden = true;
  const pgWrap = $('.pagination-wrap');
  if (pgWrap) pgWrap.hidden = true;

  if (location.pathname !== '/genres') {
    history.pushState({ view: 'genres' }, '', '/genres');
  }
}



function fixImageUrl(url) {
  if (!url) return '';
  return String(url).replace(/yts\.(mx|am|gg)/g, 'yts.lt');
}

function createMagnet(movie, torrent) {
  const trackers = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.tracker.cl:1337/announce',
    'udp://tracker.openbittorrent.com:6969/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://exodus.desync.com:6969/announce',
    'udp://tracker.moeking.me:6969/announce',
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'udp://explodie.org:6969/announce'
  ];
  let magnet = `magnet:?xt=urn:btih:${torrent.hash}&dn=${encodeURIComponent(movie.title)}`;
  trackers.forEach(t => { magnet += `&tr=${encodeURIComponent(t)}`; });
  return magnet;
}

function stars(rating) {
  return `★ ${Number(rating).toFixed(1)}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function slugify(text) {
  if (!text) return '';
  return text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}


function setMovieStructuredData(movie) {
  const el = document.getElementById('movieJsonLd');
  const origin = 'https://movies-by-prosper-sasuu.vercel.app';
  const url = origin + '/movie/' + movie.id;
  const image = fixImageUrl(movie.large_cover_image || movie.medium_cover_image || '');
  const absImage = image.startsWith('http') ? image : origin + (image.startsWith('/') ? '' : '/') + image;
  const desc = (movie.description_full || movie.description_intro || movie.summary || movie.title || '').slice(0, 300);
  const genres = movie.genres || [];
  const rating = movie.rating != null && Number(movie.rating) > 0 ? Number(movie.rating) : null;

  // Optimized meta description for movie pages
  const metaBits = [
    movie.title,
    movie.year ? `(${movie.year})` : '',
    rating ? `★ ${rating}/10` : '',
    genres.slice(0, 2).join(', '),
    'trailers, cast & details'
  ].filter(Boolean);
  let metaDesc = metaBits.join(' · ');
  if (metaDesc.length > 155) metaDesc = metaDesc.slice(0, 152) + '…';

  updatePageMeta({
    title: `${movie.title} (${movie.year}) | Movies By Prosper Sasuu`,
    description: metaDesc,
    url: `/movie/${movie.id}`,
    image: absImage
  });

  const movieNode = {
    "@type": "Movie",
    "@id": url + "#movie",
    "name": movie.title,
    "url": url,
    "image": absImage || undefined,
    "dateCreated": movie.year ? String(movie.year) : undefined,
    "description": desc || undefined,
    "genre": genres.length ? genres : undefined,
    "duration": movie.runtime ? `PT${movie.runtime}M` : undefined,
    "aggregateRating": rating != null ? {
      "@type": "AggregateRating",
      "ratingValue": rating,
      "bestRating": 10,
      "worstRating": 0
    } : undefined,
    "contentRating": movie.mpa_rating || undefined,
    "inLanguage": movie.language || undefined,
    "actor": (movie.cast || []).slice(0, 10).map(c => ({
      "@type": "Person",
      "name": c.name
    })),
    "trailer": movie.yt_trailer_code ? {
      "@type": "VideoObject",
      "name": `${movie.title} Trailer`,
      "embedUrl": `https://www.youtube.com/embed/${movie.yt_trailer_code}`,
      "thumbnailUrl": absImage || undefined,
      "description": `Official trailer for ${movie.title} (${movie.year})`,
      "uploadDate": movie.year ? `${movie.year}-01-01` : undefined
    } : undefined
  };

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      movieNode,
      {
        "@type": "BreadcrumbList",
        "@id": url + "#breadcrumb",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Home", "item": origin + "/" },
          { "@type": "ListItem", "position": 2, "name": movie.title, "item": url }
        ]
      },
      {
        "@type": "WebPage",
        "@id": url + "#webpage",
        "url": url,
        "name": `${movie.title} (${movie.year}) | Movies By Prosper Sasuu`,
        "description": metaDesc,
        "primaryEntity": { "@id": url + "#movie" },
        "isPartOf": { "@id": origin + "/#website" }
      }
    ]
  };

  if (el) el.textContent = JSON.stringify(graph);
}

function updatePageMeta({ title, description, url, image }) {
  if (title) document.title = title;

  const setAttr = (selector, attr, value) => {
    const el = document.querySelector(selector);
    if (el && value) el.setAttribute(attr, value);
  };

  if (description) {
    setAttr('#metaDescription', 'content', description);
    setAttr('meta[property="og:description"]', 'content', description);
    setAttr('meta[name="twitter:description"]', 'content', description);
  }

  if (title) {
    setAttr('meta[property="og:title"]', 'content', title);
    setAttr('meta[name="twitter:title"]', 'content', title);
  }

  if (url) {
    const absUrl = url.startsWith('http') ? url : `https://movies-by-prosper-sasuu.vercel.app${url.startsWith('/') ? '' : '/'}${url}`;
    setAttr('link[rel="canonical"]', 'href', absUrl);
    setAttr('meta[property="og:url"]', 'content', absUrl);
  }

  if (image) {
    const absImg = image.startsWith('http') ? image : `https://movies-by-prosper-sasuu.vercel.app${image.startsWith('/') ? '' : '/'}${image}`;
    setAttr('meta[property="og:image"]', 'content', absImg);
    setAttr('meta[name="twitter:image"]', 'content', absImg);
  }
}

function clearMovieStructuredData() {
  const el = document.getElementById('movieJsonLd');
  if (el) el.textContent = '';

  // Restore default SEO metadata
  document.title = 'Movies By Prosper Sasuu — Discover Free HD & 4K Movies';
  const defDesc = 'Discover and browse thousands of HD and 4K movies for free. Filter by genre, rating, and year. Get trailers, cast info, and manage your watchlist on Movies By Prosper Sasuu.';
  const defUrl = 'https://movies-by-prosper-sasuu.vercel.app/';
  const defImg = 'https://movies-by-prosper-sasuu.vercel.app/icons/logo-full.png';

  updatePageMeta({
    title: document.title,
    description: defDesc,
    url: defUrl,
    image: defImg
  });
}


function initAdSlots() {
  // Mark containers ready; Auto ads fills page-level inventory.
  // Manual units can later target [data-ad-pos] with real data-ad-slot IDs.
  document.querySelectorAll('.ad-container').forEach(box => {
    if (box.dataset.ready) return;
    box.dataset.ready = '1';
    // Optional: request a responsive unit when slots exist in AdSense
    // (requires real slot IDs - keep Auto ads as primary)
  });
  // Observe when iframes or ad nodes appear → mark loaded (layout stability)
  const obs = new MutationObserver(() => {
    document.querySelectorAll('.ad-slot').forEach(slot => {
      if (slot.querySelector('iframe, [id^="container-"] > *, a, img')) slot.classList.add('ad-loaded');
    });
  });
  document.querySelectorAll('.ad-slot').forEach(slot => {
    obs.observe(slot, { childList: true, subtree: true });
  });
}


function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

function getSortParams() {
  const map = {
    latest: { sort_by: 'date_added', order_by: 'desc' },
    seeds: { sort_by: 'seeds', order_by: 'desc' },
    rating: { sort_by: 'rating', order_by: 'desc' },
    year: { sort_by: 'year', order_by: 'desc' },
    title: { sort_by: 'title', order_by: 'asc' },
    download_count: { sort_by: 'download_count', order_by: 'desc' }
  };
  return map[state.sort] || map.latest;
}

function qualityRank(q) {
  const s = String(q || '').toLowerCase();
  if (s.includes('2160') || s.includes('4k')) return 4;
  if (s.includes('1080')) return 3;
  if (s.includes('720')) return 2;
  if (s.includes('3d')) return 1;
  return 0;
}

function sortTorrents(torrents) {
  return [...(torrents || [])].sort((a, b) => {
    const qr = qualityRank(b.quality) - qualityRank(a.quality);
    if (qr !== 0) return qr;
    return (b.seeds || 0) - (a.seeds || 0);
  });
}

// ---- Cache ----
const detailsCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;
const prefetchTimers = new Map();
let detailsAbort = null;

function cacheGet(id) {
  const hit = detailsCache.get(id);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;
  try {
    const raw = sessionStorage.getItem('mbps_movie_' + id);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts < CACHE_TTL) {
        detailsCache.set(id, parsed);
        return parsed.data;
      }
    }
  } catch {}
  return null;
}

function cacheSet(id, data) {
  const entry = { data, ts: Date.now() };
  detailsCache.set(id, entry);
  try { sessionStorage.setItem('mbps_movie_' + id, JSON.stringify(entry)); } catch {}
}

const MOVIE_LIST_CACHE_TTL = 5 * 60 * 1000;

function movieListCacheKey(page) {
  return 'mbps_movies_' + btoa(unescape(encodeURIComponent(JSON.stringify({
    page, pageSize: state.pageSize, query: state.query.trim(), quality: state.quality,
    genre: state.genre, rating: state.rating, year: state.year, language: state.language, sort: state.sort
  })))).replace(/=+$/,'');
}

function getMovieListCache(page) {
  try {
    const raw = localStorage.getItem(movieListCacheKey(page));
    if (!raw) return null;
    const item = JSON.parse(raw);
    if (!item || Date.now() - item.ts > MOVIE_LIST_CACHE_TTL) return null;
    return item.data;
  } catch { return null; }
}

function setMovieListCache(page, data) {
  try {
    localStorage.setItem(movieListCacheKey(page), JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

async function fetchMovies(page = 1, { allowCache = true } = {}) {
  const cached = allowCache ? getMovieListCache(page) : null;
  if (cached) return cached;

  const params = new URLSearchParams({ page, limit: state.pageSize });
  if (state.query.trim()) params.set('query_term', state.query.trim());
  if (state.quality) params.set('quality', state.quality);
  if (state.genre) params.set('genre', state.genre);
  if (state.rating) params.set('minimum_rating', state.rating);
  if (state.language) params.set('language', state.language);
  if (state.year && !state.query.trim()) {
    // year often works via query_term
    params.set('query_term', String(state.year));
  } else if (state.year && state.query.trim()) {
    params.set('query_term', state.query.trim() + ' ' + state.year);
  }
  const sort = getSortParams();
  params.set('sort_by', sort.sort_by);
  params.set('order_by', sort.order_by);

  const res = await fetch(`${API}/list_movies.json?${params}`, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Movie API request failed (${res.status}).`);
  const json = await res.json();
  if (json.status !== 'ok') {
    throw new Error(json.status_message || 'Movie API request failed.');
  }
  if (!json.data || typeof json.data !== 'object') {
    throw new Error('Movie API returned an invalid response.');
  }
  let movies = Array.isArray(json.data.movies) ? json.data.movies : [];
  if (state.year) movies = movies.filter(m => String(m.year) === String(state.year));

  // Apply Advanced Filters
  if (state.advFilters.decade) {
    const d = state.advFilters.decade;
    movies = movies.filter(m => {
      const y = parseInt(m.year, 10);
      if (isNaN(y)) return true;
      if (d === '2020s') return y >= 2020;
      if (d === '2010s') return y >= 2010 && y <= 2019;
      if (d === '2000s') return y >= 2000 && y <= 2009;
      if (d === '1990s') return y >= 1990 && y <= 1999;
      if (d === '1980s') return y >= 1980 && y <= 1989;
      if (d === 'classic') return y < 1980;
      return true;
    });
  }

  if (state.advFilters.runtime) {
    const r = state.advFilters.runtime;
    movies = movies.filter(m => {
      if (!m.runtime) return true;
      if (r === 'short') return m.runtime < 90;
      if (r === 'feature') return m.runtime >= 90 && m.runtime <= 120;
      if (r === 'epic') return m.runtime > 120;
      return true;
    });
  }

  if (state.advFilters.seeds) {
    const minSeeds = parseInt(state.advFilters.seeds, 10);
    if (!isNaN(minSeeds)) {
      movies = movies.filter(m => {
        return (m.torrents || []).some(t => (t.seeds || 0) >= minSeeds);
      });
    }
  }

  const result = { movies, total: (state.advFilters.decade || state.advFilters.runtime || state.advFilters.seeds) ? movies.length : (json.data.movie_count || 0) };
  setMovieListCache(page, result);
  return result;
}

const MOVIE_DETAILS_TIMEOUT = 12000;

async function fetchMovieDetails(id, { signal, rich = true } = {}) {
  const cached = cacheGet(id);
  if (cached) return cached;

  const params = new URLSearchParams({
    movie_id: id,
    with_images: rich ? 'true' : 'false',
    with_cast: rich ? 'true' : 'false'
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MOVIE_DETAILS_TIMEOUT);
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }

  try {
    const res = await fetch(`${API}/movie_details.json?${params}`, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`API error (${res.status})`);
    const json = await res.json();
    if (json.status !== 'ok') return null;
    const movie = json.data.movie;
    if (movie && rich) cacheSet(id, movie);
    return movie;
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', forwardAbort);
  }
}

function prefetchDetails(id) {
  // Avoid firing a full movie-details request on hover/touch. The list response
  // already contains the data needed to render the first screen instantly.
  return;
}

function cancelPrefetch(id) {
  const t = prefetchTimers.get(id);
  if (t) { clearTimeout(t); prefetchTimers.delete(id); }
}

function renderMovieCard(movie) {
  const card = document.createElement('article');
  card.className = 'movie-card';
  card.dataset.id = movie.id;
  const imgUrl = fixImageUrl(movie.medium_cover_image || movie.large_cover_image);
  const watched = isInWatchlist(movie.id);
  const inCompare = state.compareList.some(c => c.id === movie.id);
  const currentCategory = movie.category || (getWatchlist().find(w => w.id === movie.id)?.category || 'plan');

  // Detect highest quality
  let qualityLabel = '';
  if (movie.torrents && movie.torrents.length) {
    if (movie.torrents.some(t => t.quality === '2160p')) qualityLabel = '4K UHD';
    else if (movie.torrents.some(t => t.quality === '1080p')) qualityLabel = '1080p';
    else if (movie.torrents.some(t => t.quality === '720p')) qualityLabel = '720p';
  } else if (movie.quality) {
    qualityLabel = movie.quality;
  }

  const firstGenre = (movie.genres && movie.genres[0]) || '';
  const isListView = state.viewLayout === 'list';

  if (isListView) {
    const synopsis = movie.description_full || movie.summary || 'Click for full plot synopsis and cast list.';
    const snippet = synopsis.length > 150 ? synopsis.slice(0, 147) + '...' : synopsis;
    const allGenres = (movie.genres || []).slice(0, 3).join(' / ');
    card.innerHTML = `
      <div class="poster-wrap">
        <button class="card-watch ${watched ? 'on' : ''}" title="Watchlist" aria-label="Watchlist">${watched ? '♥' : '♡'}</button>
        <img class="poster-img" src="${imgUrl}" alt="${escapeHtml(movie.title)}" width="80" height="120" loading="lazy" decoding="async" onerror="this.style.opacity='0.25'" />
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(movie.title)}</div>
        <div class="card-meta">
          <span>${movie.year || '—'}</span>
          <span class="meta-dot">·</span>
          <span>${stars(movie.rating)}</span>
          ${movie.runtime ? `<span class="meta-dot">·</span><span>${movie.runtime}m</span>` : ''}
          ${allGenres ? `<span class="meta-dot">·</span><span>${escapeHtml(allGenres)}</span>` : ''}
          ${qualityLabel ? `<span class="meta-dot">·</span><strong style="color:var(--accent)">${qualityLabel}</strong>` : ''}
        </div>
        <p class="list-snippet" style="font-size:0.8rem;color:var(--text-muted);margin-top:6px;line-height:1.4;">${escapeHtml(snippet)}</p>
      </div>
      <div class="list-actions">
        ${movie.yt_trailer_code ? `
          <button type="button" class="btn-list-trailer" title="Watch Trailer" aria-label="Watch Trailer" style="padding:7px 12px;background:var(--accent);color:#fff;border:none;border-radius:6px;font-size:0.8rem;font-weight:600;display:flex;align-items:center;gap:5px;cursor:pointer;">
            <svg class="btn-ico" aria-hidden="true"><use href="#i-play"/></svg>
            <span>Trailer</span>
          </button>
        ` : ''}
        <button type="button" class="card-compare-btn ${inCompare ? 'on' : ''}" title="Compare">
          <svg class="btn-ico" aria-hidden="true"><use href="#i-scale"/></svg>
        </button>
      </div>
    `;
  } else {
    card.innerHTML = `
      <div class="poster-wrap">
        <button class="card-watch ${watched ? 'on' : ''}" title="Watchlist" aria-label="Watchlist">${watched ? '♥' : '♡'}</button>
        <div class="card-quick-actions">
          ${movie.yt_trailer_code ? `
            <button type="button" class="card-trailer-btn" title="Watch Official Trailer" aria-label="Watch Official Trailer">
              <svg class="btn-ico" aria-hidden="true"><use href="#i-play"/></svg>
            </button>
          ` : ''}
          <button type="button" class="card-compare-btn ${inCompare ? 'on' : ''}" title="${inCompare ? 'Remove from comparison' : 'Add to compare'}" aria-label="Compare movie">
            <svg class="btn-ico" aria-hidden="true"><use href="#i-scale"/></svg>
          </button>
        </div>
        <img class="poster-img" src="${imgUrl}" alt="${escapeHtml(movie.title)}" width="230" height="345" loading="${state.movies.indexOf(movie) < 6 ? 'eager' : 'lazy'}" decoding="async" fetchpriority="${state.movies.indexOf(movie) < 2 ? 'high' : 'auto'}" onerror="this.style.opacity='0.25'" />
        <div class="rating-badge">${stars(movie.rating)}</div>
        ${qualityLabel ? `<div class="card-quality-badge">${qualityLabel}</div>` : ''}
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(movie.title)}</div>
        <div class="card-meta">
          <span>${movie.year || '—'}</span>
          ${firstGenre ? `<span class="meta-dot">·</span><span>${escapeHtml(firstGenre)}</span>` : ''}
          ${movie.runtime ? `<span class="meta-dot">·</span><span>${movie.runtime}m</span>` : ''}
        </div>
        ${state.mode === 'watchlist' ? `
          <select class="card-wl-status-select" aria-label="Change status" style="margin-top:4px;">
            <option value="plan" ${currentCategory === 'plan' ? 'selected' : ''}>📌 Plan to Watch</option>
            <option value="watched" ${currentCategory === 'watched' ? 'selected' : ''}>✔️ Watched</option>
            <option value="favorite" ${currentCategory === 'favorite' ? 'selected' : ''}>⭐ Favorite</option>
          </select>
        ` : ''}
      </div>
    `;
  }

  // Watchlist button
  const watchBtn = card.querySelector('.card-watch');
  if (watchBtn) {
    on(watchBtn, 'click', (e) => {
      e.stopPropagation();
      const on = toggleWatchlist(movie);
      watchBtn.classList.toggle('on', on);
      watchBtn.textContent = on ? '♥' : '♡';
      if (state.mode === 'watchlist') loadWatchlist();
    });
  }

  // Trailer button
  const trailerBtn = card.querySelector('.card-trailer-btn, .btn-list-trailer');
  if (trailerBtn && movie.yt_trailer_code) {
    on(trailerBtn, 'click', (e) => {
      e.stopPropagation();
      openTrailerTheater(movie, movie.yt_trailer_code);
    });
  }

  // Compare button
  const cmpBtn = card.querySelector('.card-compare-btn');
  if (cmpBtn) {
    on(cmpBtn, 'click', (e) => {
      e.stopPropagation();
      const added = toggleCompare(movie);
      cmpBtn.classList.toggle('on', added);
    });
  }

  const catSelect = card.querySelector('.card-wl-status-select');
  if (catSelect) {
    on(catSelect, 'click', (e) => e.stopPropagation());
    on(catSelect, 'change', (e) => {
      e.stopPropagation();
      setMovieCategory(movie.id, e.target.value);
    });
  }

  on(card, 'click', () => openDetails(movie.id, movie.title + (movie.year ? ' ' + movie.year : ''), movie));
  on(card, 'mouseenter', () => prefetchDetails(movie.id));
  on(card, 'mouseleave', () => cancelPrefetch(movie.id));
  on(card, 'touchstart', () => prefetchDetails(movie.id), { passive: true });
  return card;
}

function renderGrid(movies, append = false) {
  if (!append) movieGrid.innerHTML = '';
  const frag = document.createDocumentFragment();
  movies.forEach(m => frag.appendChild(renderMovieCard(m)));
  movieGrid.appendChild(frag);
}

function setHero(movie) {
  if (!movie) { hero.hidden = true; return; }
  hero.hidden = false;
  const bg = fixImageUrl(movie.background_image_original || movie.large_cover_image || movie.medium_cover_image);
  $('#heroBg').style.backgroundImage = `url(${bg})`;
  $('#heroTitle').textContent = movie.title;
  $('#heroMeta').innerHTML = `
    <span>${movie.year}</span>
    <span class="rating">${stars(movie.rating)}</span>
    <span>${movie.runtime ? movie.runtime + ' min' : ''}</span>
  `;
  const summary = movie.summary || movie.description_full || '';
  $('#heroSummary').textContent = summary.slice(0, 220) + (summary.length > 220 ? '…' : '');
  $('#heroWatch').onclick = () => openDetails(movie.id, movie.title + (movie.year ? ' ' + movie.year : ''), movie);
  const wlBtn = $('#heroWatchlist');
  const on = isInWatchlist(movie.id);
  wlBtn.textContent = on ? '♥ In Watchlist' : '❤ Watchlist';
  wlBtn.onclick = () => {
    const now = toggleWatchlist(movie);
    wlBtn.textContent = now ? '♥ In Watchlist' : '❤ Watchlist';
  };
}

function updateSectionHeader() {
  const titles = {
    browse: { title: 'Latest Releases', desc: 'Brand new additions, freshest encodes & latest catalog uploads', icon: '📅' },
    trending: { title: 'Trending Now', desc: 'Most seeded and popular titles right now', icon: '🔥' },
    '4k': { title: '4K UHD Collection', desc: 'Ultra HD 2160p encodes in stunning quality', icon: '📺' },
    top: { title: 'Top Rated', desc: 'Highest rated movies across the catalog', icon: '⭐' },
    genres: { title: 'Browse by Genre', desc: 'Explore movies filtered by your favorite genres', icon: '▦' },
    watchlist: { title: 'Your Watchlist', desc: 'Movies you saved for later', icon: '❤' }
  };
  const activeNav = document.querySelector('.nav-item.active');
  const key = state.mode === 'watchlist' ? 'watchlist' : (activeNav?.dataset.view || 'browse');
  const t = titles[key] || titles.browse;

  let seoTitle = `${t.title} | Movies By Prosper Sasuu`;
  let seoDesc = t.desc;

  const bcCurrent = $('#breadcrumbCurrent');
  if (state.query && state.mode !== 'watchlist') {
    const displayQuery = state.query.length > 30 ? state.query.slice(0, 27) + '...' : state.query;
    $('#sectionTitle').textContent = `Results for “${displayQuery}”`;
    $('#sectionDesc').textContent = 'Matching titles from the catalog';
    if (bcCurrent) bcCurrent.textContent = `Search: “${displayQuery}”`;
    seoTitle = `Search results for "${displayQuery}" | Movies By Prosper Sasuu`;
  } else {
    $('#sectionTitle').textContent = t.title;
    $('#sectionDesc').textContent = t.desc;
    if (bcCurrent) bcCurrent.textContent = t.title;
  }
  $('#sectionIcon').textContent = t.icon;

  if (typeof renderActiveFilters === 'function') {
    renderActiveFilters();
  }

  // Only update page metadata if we're not in a specific movie details view
  if (!state.currentMovieId) {
    updatePageMeta({
      title: seoTitle,
      description: seoDesc,
      url: key === 'browse' ? '/' : `/${key}`
    });
  }
}

function updateUIState({ isInitial = false, error = false } = {}) {
  const hasMovies = state.movies.length > 0;
  loadingEl.hidden = !state.loading || !isInitial;
  emptyEl.hidden = state.loading || hasMovies;
  const clearBtn = $('#clearFiltersBtn');
  const hasActiveFilters = Boolean(
    state.query || state.quality || state.genre || state.rating || state.year ||
    state.language || state.advFilters.decade || state.advFilters.runtime ||
    state.advFilters.seeds
  );
  if (error && !hasMovies) {
    emptyEl.hidden = false;
    $('#emptyText').textContent = 'Failed to load movies. Please try again.';
    clearBtn.hidden = false;
    clearBtn.textContent = 'Try again';
    clearBtn.dataset.action = 'retry';
  } else if (!hasMovies && !state.loading) {
    $('#emptyText').textContent = state.mode === 'watchlist'
      ? 'Your watchlist is empty. Tap ♡ on any movie to save it.'
      : hasActiveFilters
        ? 'No movies found for these filters.'
        : 'No movies are available right now.';
    clearBtn.hidden = state.mode === 'watchlist';
    clearBtn.textContent = hasActiveFilters ? 'Clear filters' : 'Try again';
    clearBtn.dataset.action = hasActiveFilters ? 'clear' : 'retry';
  }
  const pgWrap = $('.pagination-wrap');
  if (pgWrap) pgWrap.hidden = state.loading || !hasMovies || state.mode === 'watchlist' || state.total <= state.pageSize;

  $('#resultsCount').textContent = state.mode === 'watchlist'
    ? `${state.movies.length} saved`
    : (state.total ? `${state.total.toLocaleString()} movies` : '');
}

async function loadMovies(reset = false, targetPage = null) {
  const hub = $('#genresHub');
  const moviesSec = $('#moviesSection');
  if (hub) hub.hidden = true;
  if (moviesSec) moviesSec.hidden = false;
  const wlToolbar = $('#watchlistToolbar');
  if (wlToolbar) wlToolbar.hidden = true;
  if (state.mode === 'watchlist') return loadWatchlist();
  if (state.loading) return;

  if (targetPage !== null) {
    state.page = targetPage;
  } else if (reset) {
    state.page = 1;
  }

  state.loading = true;
  const isInitial = reset || targetPage !== null || state.movies.length === 0;
  let loadError = false;
  updateUIState({ isInitial });

  // For numbered pagination, always clear grid
  movieGrid.innerHTML = '';
  window.scrollTo({ top: 0, behavior: reset ? 'auto' : 'smooth' });

  try {
    const cached = getMovieListCache(state.page);
    const result = await fetchMovies(state.page);
    const { movies, total } = result;
    state.movies = movies;
    state.total = total;
    state.hasMore = total > state.page * state.pageSize;
    renderGrid(movies, false);
    renderPagination();
    updateSectionHeader();
    renderRecent();
    if (reset || (targetPage === 1)) setHero(movies.length > 0 ? movies[0] : null);

    // Refresh cached catalog data quietly so repeat visits feel instant while staying fresh.
    if (cached) {
      fetchMovies(state.page, { allowCache: false }).then(fresh => {
        if (state.page === (targetPage !== null ? targetPage : state.page) && fresh.movies?.length) {
          state.movies = fresh.movies;
          state.total = fresh.total;
          renderGrid(fresh.movies, false);
          renderPagination();
          updateUIState({ isInitial: false });
        }
      }).catch(() => {});
    }
  } catch (err) {
    console.error(err);
    loadError = true;
    updateUIState({ isInitial, error: true });
    return;
  } finally {
    state.loading = false;
    updateUIState({ isInitial: false, error: loadError });
  }
}

function renderPagination() {
  if (!paginationEl) return;
  paginationEl.innerHTML = '';
  if (state.total <= state.pageSize || state.mode === 'watchlist') return;

  const totalPages = Math.ceil(state.total / state.pageSize);
  const current = state.page;
  const delta = window.innerWidth < 600 ? 1 : 2;
  const range = [];

  for (let i = Math.max(2, current - delta); i <= Math.min(totalPages - 1, current + delta); i++) {
    range.push(i);
  }

  if (current - delta > 2) range.unshift('...');
  range.unshift(1);
  if (current + delta < totalPages - 1) range.push('...');
  range.push(totalPages);

  range.forEach(p => {
    if (p === '...') {
      const span = document.createElement('span');
      span.className = 'page-btn dots';
      span.textContent = '...';
      paginationEl.appendChild(span);
    } else {
      const btn = document.createElement('button');
      btn.className = `page-btn ${p === current ? 'active' : ''}`;
      btn.textContent = p;
      on(btn, 'click', () => loadMovies(false, p));
      paginationEl.appendChild(btn);
    }
  });

  if (current < totalPages) {
    const next = document.createElement('button');
    next.className = 'page-btn next-btn';
    next.innerHTML = 'Next &raquo;';
    on(next, 'click', () => loadMovies(false, current + 1));
    paginationEl.appendChild(next);
  }
}

function loadWatchlist() {
  state.mode = 'watchlist';
  state.loading = false;
  hero.hidden = true;
  $('#recentSection').hidden = true;
  const about = $('#about-site');
  if (about) about.hidden = true;
  const adTop = $('#adTop');
  if (adTop) adTop.hidden = true;
  const wlToolbar = $('#watchlistToolbar');
  if (wlToolbar) wlToolbar.hidden = false;

  const all = getWatchlist();
  const list = state.wlCategory === 'all' ? all : all.filter(m => m.category === state.wlCategory);
  state.movies = list;
  state.hasMore = false;
  state.total = list.length;
  renderGrid(list, false);
  updateSectionHeader();
  updateWatchlistBadge();
  updateUIState({ isInitial: false });
}

async function openDetails(id, title = null, seedMovie = null) {
  state.currentMovieId = id;

  const updateUrl = (movieTitle) => {
    const slug = movieTitle ? '/' + slugify(movieTitle) : '';
    const target = `/movie/${id}${slug}`;
    try {
      if (location.pathname !== target) {
        history.pushState({ movieId: id }, '', target);
      } else {
        history.replaceState({ movieId: id }, '', target);
      }
    } catch (_) {
      window.location.hash = `movie/${id}${slug}`;
    }
  };

  updateUrl(title);
  homeView.hidden = true;
  detailsView.hidden = false;
  window.scrollTo(0, 0);

  if (detailsAbort) { try { detailsAbort.abort(); } catch {} }
  detailsAbort = new AbortController();
  const signal = detailsAbort.signal;

  const cached = cacheGet(id);
  const instantMovie = cached || seedMovie;

  // Render immediately from the catalog/search result. This prevents the
  // details page from showing a loading screen while the API is slow.
  if (instantMovie) {
    $('#detailsLoading').hidden = true;
    $('#detailsContent').hidden = false;
    updateUrl(instantMovie.title + (instantMovie.year ? ' ' + instantMovie.year : ''));
    renderDetails(instantMovie);
    addRecent(instantMovie);

    // Refresh with the richer response in the background. If the API is slow
    // or unavailable, the already-rendered movie page remains usable.
    if (!cached) {
      fetchMovieDetails(id, { signal, rich: true }).then(m => {
        if (m && state.currentMovieId === id) {
          updateUrl(m.title + (m.year ? ' ' + m.year : ''));
          renderDetails(m);
          addRecent(m);
        }
      }).catch(err => {
        if (err.name !== 'AbortError') console.warn('Background movie refresh failed:', err.message);
      });
    }
    return;
  }

  $('#detailsContent').hidden = true;
  $('#detailsLoading').hidden = false;
  $('#detailsLoading').innerHTML = '<p>Loading movie details…</p><p style="font-size:.9rem;opacity:.7">The movie service is responding slowly. Please wait a moment.</p>';

  try {
    // For direct movie URLs, request the small/basic response first. It is
    // faster than waiting for images + cast before showing anything.
    const movie = await fetchMovieDetails(id, { signal, rich: false });
    if (state.currentMovieId !== id) return;
    if (!movie) throw new Error('Not found');
    updateUrl(movie.title + (movie.year ? ' ' + movie.year : ''));
    renderDetails(movie);
    addRecent(movie);

    // Then upgrade the page to the full response in the background.
    fetchMovieDetails(id, { signal, rich: true }).then(m => {
      if (m && state.currentMovieId === id) renderDetails(m);
    }).catch(err => {
      if (err.name !== 'AbortError') console.warn('Rich movie refresh failed:', err.message);
    });
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error(e);
    $('#detailsLoading').innerHTML = '<p style="color:#777">Movie service is temporarily slow or unavailable.</p><button class="btn-primary" onclick="location.reload()">Try again</button>';
  }
}

function renderDetails(movie) {
  $('#detailsLoading').hidden = true;
  $('#detailsContent').hidden = false;

  const bg = fixImageUrl(movie.background_image_original || movie.large_cover_image || movie.background_image);
  $('#detailsBg').style.backgroundImage = `url(${bg})`;

  const poster = $('#detailsPoster');
  poster.src = fixImageUrl(movie.large_cover_image || movie.medium_cover_image);
  poster.alt = movie.title;
  poster.width = 300;
  poster.height = 450;
  poster.style.cursor = 'zoom-in';
  poster.title = 'Click to view high-res poster';
  poster.onclick = () => {
    const gallery = [
      fixImageUrl(movie.large_cover_image || movie.medium_cover_image),
      fixImageUrl(movie.large_screenshot_image1 || movie.medium_screenshot_image1),
      fixImageUrl(movie.large_screenshot_image2 || movie.medium_screenshot_image2),
      fixImageUrl(movie.large_screenshot_image3 || movie.medium_screenshot_image3),
    ].filter(Boolean);
    openLightboxGallery(gallery, 0);
  };

  const watched = isInWatchlist(movie.id);
  const wlBtn = $('#detailsWatchlistBtn');
  if (wlBtn) {
    wlBtn.classList.toggle('on', watched);
    wlBtn.textContent = watched ? '♥' : '♡';
    wlBtn.onclick = (e) => {
      e.stopPropagation();
      const now = toggleWatchlist(movie);
      wlBtn.classList.toggle('on', now);
      wlBtn.textContent = now ? '♥' : '♡';
      // Update the other watchlist button in actions if it exists
      const actionWl = $('#detailsActions .btn-secondary');
      if (actionWl) actionWl.textContent = now ? '♥ In Watchlist' : '❤ Watchlist';
    };
  }

  const badge = $('#detailsRatingBadge');
  if (badge) {
    badge.innerHTML = stars(movie.rating);
    badge.hidden = !movie.rating;
  }

  $('#detailsTitle').textContent = movie.title;
  setMovieStructuredData(movie);

  // Update details topbar breadcrumb navigation
  const bcHome = $('#detailsBcHome');
  if (bcHome) bcHome.onclick = (e) => { e.preventDefault(); closeDetails(); };
  const bcGenre = $('#detailsBcGenre');
  if (bcGenre) {
    const firstGenre = (movie.genres && movie.genres[0]) || 'Movies';
    bcGenre.textContent = firstGenre;
    bcGenre.onclick = (e) => {
      e.preventDefault();
      closeDetails();
      if (movie.genres && movie.genres[0]) {
        state.genre = movie.genres[0];
        const fg = $('#filterGenre'); if (fg) fg.value = movie.genres[0];
        loadMovies(true);
      }
    };
  }
  const bcTitle = $('#detailsBcTitle');
  if (bcTitle) bcTitle.textContent = `${movie.title} (${movie.year || ''})`;

  const topTrailer = $('#detailsTrailerTopBtn');
  if (topTrailer) {
    topTrailer.onclick = () => {
      if (movie.yt_trailer_code) openTrailerTheater(movie, movie.yt_trailer_code);
      else toast('Trailer not available for this title');
    };
  }

  const topShare = $('#detailsShareBtn');
  if (topShare) {
    topShare.onclick = async () => {
      const shareUrl = window.location.href;
      const shareData = { title: movie.title, text: `Check out ${movie.title} on Movies By Prosper Sasuu`, url: shareUrl };
      if (navigator.share) {
        try { await navigator.share(shareData); } catch {}
      } else {
        try {
          await navigator.clipboard.writeText(shareUrl);
          toast('Movie link copied to clipboard!');
        } catch {
          toast('Link: ' + shareUrl);
        }
      }
    };
  }

  $('#detailsMeta').innerHTML = `
    <span>${movie.year}</span>
    <span class="rating">${stars(movie.rating)}</span>
    <span>${movie.runtime ? movie.runtime + ' min' : ''}</span>
    ${movie.mpa_rating ? `<span>${escapeHtml(movie.mpa_rating)}</span>` : ''}
    ${movie.language ? `<span>${escapeHtml(movie.language).toUpperCase()}</span>` : ''}
  `;

  const genres = movie.genres || [];
  $('#detailsGenres').innerHTML = genres.map(g => `<span class="genre-tag">${escapeHtml(g)}</span>`).join('');
  const summary = movie.description_full || movie.description_intro || movie.summary || 'No description available.';
  $('#detailsSummary').textContent = summary;

  // Load AI Critic Insight & mood breakdown
  loadAiInsight(movie);

  // Action buttons
  const actions = $('#detailsActions');
  const inWl = isInWatchlist(movie.id);
  actions.innerHTML = '';
  if (movie.yt_trailer_code) {
    const tBtn = document.createElement('button');
    tBtn.className = 'btn-trailer';
    tBtn.textContent = '▶ Trailer';
    tBtn.title = 'Watch in Cinematic Theater Mode';
    tBtn.onclick = () => openTrailerTheater(movie, movie.yt_trailer_code);
    actions.appendChild(tBtn);
  }
  const wl = document.createElement('button');
  wl.className = 'btn-secondary';
  wl.textContent = inWl ? '♥ In Watchlist' : '❤ Watchlist';
  wl.onclick = () => {
    const on = toggleWatchlist(movie);
    wl.textContent = on ? '♥ In Watchlist' : '❤ Watchlist';
  };
  actions.appendChild(wl);

  // Compare Action Button
  const cmpBtn = document.createElement('button');
  const inCmp = state.compareList.some(c => c.id === movie.id);
  cmpBtn.className = `btn-compare-action ${inCmp ? 'in-compare' : ''}`;
  cmpBtn.textContent = inCmp ? '⚖️ In Comparison' : '⚖️ Add to Compare';
  cmpBtn.onclick = () => {
    const added = toggleCompare(movie);
    cmpBtn.classList.toggle('in-compare', added);
    cmpBtn.textContent = added ? '⚖️ In Comparison' : '⚖️ Add to Compare';
  };
  actions.appendChild(cmpBtn);
  if (movie.imdb_code) {
    const imdb = document.createElement('a');
    imdb.className = 'btn-imdb';
    imdb.href = `https://www.imdb.com/title/${movie.imdb_code.startsWith('tt') ? movie.imdb_code : 'tt' + movie.imdb_code}`;
    imdb.target = '_blank';
    imdb.rel = 'noopener';
    imdb.textContent = 'IMDb';
    actions.appendChild(imdb);
  }
  const shareWrap = document.createElement('div');
  shareWrap.className = 'share-wrap';
  const shareBtn = document.createElement('button');
  shareBtn.className = 'btn-share';
  shareBtn.textContent = '↗ Share';
  shareBtn.setAttribute('aria-expanded', 'false');
  const shareMenu = document.createElement('div');
  shareMenu.className = 'share-menu';
  shareMenu.hidden = true;

  const shareUrl = () => {
    // Path-style URL works with edge OG injection; hash kept as fallback fragment
    const base = location.origin + location.pathname.replace(/\/movie\/\d+\/?$/, '/').replace(/\/?$/, '/');
    return `${location.origin}/movie/${movie.id}`;
  };
  const shareText = () => `${movie.title} (${movie.year}) - watch details on Movies By Prosper Sasuu`;
  const shareImage = () => fixImageUrl(movie.large_cover_image || movie.medium_cover_image || '');

  const shareItems = [
    { id: 'native', label: '📱 System share', show: () => !!navigator.share },
    { id: 'copy', label: '🔗 Copy link', show: () => true },
    { id: 'x', label: '𝕏 Twitter / X', show: () => true },
    { id: 'facebook', label: 'f Facebook', show: () => true },
    { id: 'whatsapp', label: 'WhatsApp', show: () => true },
    { id: 'telegram', label: 'Telegram', show: () => true },
    { id: 'reddit', label: 'Reddit', show: () => true },
  ];

  shareItems.filter(i => i.show()).forEach(item => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'share-menu-item';
    b.textContent = item.label;
    b.dataset.share = item.id;
    shareMenu.appendChild(b);
  });

  async function doShare(kind) {
    const url = shareUrl();
    const text = shareText();
    const enc = encodeURIComponent;
    if (kind === 'native' && navigator.share) {
      try {
        const data = { title: movie.title, text, url };
        // Web Share Level 2: include poster when supported
        if (navigator.canShare && shareImage()) {
          try {
            const imgUrl = shareImage();
            const resp = await fetch(imgUrl, { mode: 'cors' });
            if (resp.ok) {
              const blob = await resp.blob();
              const ext = (blob.type || 'image/jpeg').includes('png') ? 'png' : 'jpg';
              const file = new File([blob], `${(movie.title || 'movie').replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}.${ext}`, { type: blob.type || 'image/jpeg' });
              const withFile = { ...data, files: [file] };
              if (navigator.canShare(withFile)) {
                await navigator.share(withFile);
                toast('Shared');
                return;
              }
            }
          } catch (_) { /* fall back to link-only share */ }
        }
        await navigator.share(data);
        toast('Shared');
      } catch (e) {
        if (e.name !== 'AbortError') toast('Share cancelled');
      }
      return;
    }
    if (kind === 'copy') {
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      } catch {
        prompt('Copy link:', url);
      }
      return;
    }
    const map = {
      x: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
      whatsapp: `https://wa.me/?text=${enc(text + ' ' + url)}`,
      telegram: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`,
      reddit: `https://reddit.com/submit?url=${enc(url)}&title=${enc(text)}`,
    };
    if (map[kind]) window.open(map[kind], '_blank', 'noopener,width=600,height=500');
  }

  on(shareBtn, 'click', (e) => {
    e.stopPropagation();
    const open = shareMenu.hidden;
    document.querySelectorAll('.share-menu').forEach(m => { m.hidden = true; });
    shareMenu.hidden = !open;
    shareBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  on(shareMenu, 'click', (e) => {
    const item = e.target.closest('[data-share]');
    if (!item) return;
    e.stopPropagation();
    shareMenu.hidden = true;
    shareBtn.setAttribute('aria-expanded', 'false');
    doShare(item.dataset.share);
  });
  shareWrap.appendChild(shareBtn);
  shareWrap.appendChild(shareMenu);
  actions.appendChild(shareWrap);
  const report = document.createElement('button');
  report.className = 'btn-report';
  report.textContent = '⚠ Report';
  report.onclick = () => {
    const subject = encodeURIComponent('Broken link report: ' + movie.title);
    const body = encodeURIComponent(`Movie: ${movie.title} (${movie.year})\nID: ${movie.id}\nURL: ${location.href}\n\nDescribe the issue:\n`);
    window.open(`mailto:prospersasuu808@gmail.com?subject=${subject}&body=${body}`);
  };
  actions.appendChild(report);

  // Torrents sorted
  const torrents = sortTorrents(movie.torrents || []);
  $('#torrentCount').textContent = `(${torrents.length})`;
  const list = $('#torrentsList');
  list.innerHTML = '';
  if (!torrents.length) {
    list.innerHTML = '<p class="torrents-empty">No community torrent links listed for this title yet. Check back later or try another quality filter.</p>';
  } else {
    torrents.forEach(t => {
      const card = document.createElement('div');
      card.className = 'torrent-card';
      const magnet = createMagnet(movie, t);
      card.innerHTML = `
        <div class="torrent-info">
          <div class="torrent-quality">${escapeHtml(t.quality)} · ${escapeHtml(t.type || '')}</div>
          <div class="torrent-meta">Size: ${escapeHtml(t.size)} · Seeds: ${t.seeds} · Peers: ${t.peers}</div>
        </div>
        <div class="torrent-actions">
          <button class="btn-magnet">Magnet</button>
          <button class="btn-copy">Copy</button>
          <button class="btn-torrent">Torrent</button>
        </div>
      `;
      card.querySelector('.btn-magnet').onclick = () => { window.location.href = magnet; };
      card.querySelector('.btn-copy').onclick = async () => {
        try {
          await navigator.clipboard.writeText(magnet);
          toast('Magnet link copied');
        } catch {
          prompt('Copy magnet:', magnet);
        }
      };
      card.querySelector('.btn-torrent').onclick = () => window.open(t.url, '_blank');
      list.appendChild(card);
    });
  }

  // Cast with interactive filmography click-through
  const cast = movie.cast || [];
  $('#castCount').textContent = `(${cast.length})`;
  const castGrid = $('#castGrid');
  castGrid.innerHTML = '';
  if (!cast.length) {
    castGrid.innerHTML = '<p style="color:#666">No cast information available</p>';
  } else {
    cast.forEach(c => {
      const card = document.createElement('div');
      card.className = 'cast-card';
      card.title = `Click to browse all films featuring ${c.name}`;
      card.innerHTML = `
        <img class="cast-photo" src="${fixImageUrl(c.url_small_image || '')}" alt="${escapeHtml(c.name)}"
             onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect fill=%22%231a1a1a%22 width=%22100%22 height=%22100%22/%3E%3Ctext x=%2250%22 y=%2255%22 fill=%22%23666%22 text-anchor=%22middle%22 font-size=%2214%22%3E?%3C/text%3E%3C/svg%3E'" />
        <div class="cast-info">
          <div class="cast-name">${escapeHtml(c.name)}</div>
          <div class="cast-character">${escapeHtml(c.character_name || '')}</div>
        </div>
      `;
      on(card, 'click', () => searchFilmography(c.name));
      castGrid.appendChild(card);
    });
  }

  // Screenshots with high-res Lightbox gallery
  const shots = [];
  for (let i = 1; i <= 3; i++) {
    const large = movie[`large_screenshot_image${i}`];
    const medium = movie[`medium_screenshot_image${i}`];
    if (large || medium) shots.push({ large: fixImageUrl(large || medium), medium: fixImageUrl(medium || large) });
  }
  $('#shotCount').textContent = `(${shots.length})`;
  const shotsGrid = $('#shotsGrid');
  shotsGrid.innerHTML = '';
  if (!shots.length) {
    shotsGrid.innerHTML = '<p style="color:#666">No screenshots available</p>';
  } else {
    shots.forEach((s, idx) => {
      const card = document.createElement('div');
      card.className = 'shot-card';
      card.innerHTML = `<img src="${s.medium}" alt="Screenshot" loading="lazy" />`;
      const gallery = shots.map(x => x.large);
      on(card, 'click', () => openLightboxGallery(gallery, idx));
      shotsGrid.appendChild(card);
    });
    bindStripSwipe('.shots-grid');
  }

  switchDetailsTab('torrents');
}

function switchDetailsTab(tab) {
  document.querySelectorAll('.details-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = true; p.classList.remove('active'); });
  const map = { torrents: 'panelTorrents', cast: 'panelCast', shots: 'panelShots' };
  const el = document.getElementById(map[tab]);
  if (el) { el.hidden = false; el.classList.add('active'); }
}

// ==========================================================================
// FEATURE 1 & 2: AI INSIGHTS & FILMOGRAPHY EXPLORER
// ==========================================================================

async function loadAiInsight(movie) {
  const container = $('#detailsAiInsight');
  const hookEl = $('#aiInsightHook');
  const moodEl = $('#aiInsightMood');
  const bestForEl = $('#aiInsightBestFor');
  if (!container || !movie) return;

  container.hidden = false;
  hookEl.textContent = 'Generating critic insight & thematic vibe…';
  moodEl.textContent = 'Analyzing…';
  bestForEl.textContent = '';

  const cacheKey = 'mbps_insight_' + movie.id;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      renderInsight(parsed);
      return;
    }
  } catch {}

  try {
    const res = await fetch('/api/ai/movie-insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: movie.title,
        year: movie.year,
        genres: movie.genres || [],
        summary: movie.description_full || movie.summary || ''
      })
    });
    if (!res.ok) throw new Error('Insight error');
    const data = await res.json();
    try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch {}
    renderInsight(data);
  } catch (err) {
    renderInsight({
      hook: `A compelling ${(movie.genres?.[0] || 'cinema').toLowerCase()} work featuring memorable performances and distinctive style.`,
      vibe: `${movie.genres?.[0] || 'Drama'}, Atmospheric`,
      bestFor: `Fans of quality ${movie.genres?.[0] || 'film'} productions`
    });
  }

  function renderInsight(data) {
    hookEl.textContent = `"${data.hook || ''}"`;
    moodEl.textContent = data.vibe || (movie.genres || []).join(' • ');
    bestForEl.textContent = data.bestFor ? `Best for: ${data.bestFor}` : '';
  }
}

function searchFilmography(name) {
  if (!name) return;
  if (state.currentMovieId) closeDetails();
  state.mode = 'browse';
  state.query = name;
  state.genre = '';
  state.quality = '';
  state.rating = '';
  state.year = '';
  searchInput.value = name;
  updateSectionHeader();
  loadMovies(true);
  window.scrollTo({ top: $('#moviesSection')?.offsetTop - 80 || 0, behavior: 'smooth' });
}

// ==========================================================================
// FEATURE 3: CINEMATIC TRAILER THEATER & LIGHTBOX GALLERY
// ==========================================================================

function openTrailerTheater(movie, ytCode) {
  if (!ytCode) return toast('No trailer available for this title');
  const theater = $('#trailerTheater');
  const titleEl = $('#theaterMovieTitle');
  const metaEl = $('#theaterMovieMeta');
  const frame = $('#theaterVideoFrame');
  const detailsBtn = $('#theaterOpenDetailsBtn');

  titleEl.textContent = movie.title || 'Movie Trailer';
  metaEl.textContent = `${movie.year || ''} • ${stars(movie.rating || 0)}`;
  frame.innerHTML = `
    <iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(ytCode)}?autoplay=1&rel=0&modestbranding=1"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen></iframe>
  `;

  if (detailsBtn) {
    detailsBtn.onclick = () => {
      closeTrailerTheater();
      openDetails(movie.id, movie.title, movie);
    };
  }

  theater.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeTrailerTheater() {
  const theater = $('#trailerTheater');
  const frame = $('#theaterVideoFrame');
  if (theater) theater.hidden = true;
  if (frame) frame.innerHTML = '';
  document.body.style.overflow = '';
}

function openTrailer(code, title) {
  openTrailerTheater({ title, yt_trailer_code: code }, code);
}

let lightboxImages = [];
let lightboxCurrentIdx = 0;

function openLightboxGallery(images, startIdx = 0) {
  if (!images || !images.length) return;
  lightboxImages = images;
  lightboxCurrentIdx = startIdx;
  const lb = $('#lightboxModal');
  lb.hidden = false;
  document.body.style.overflow = 'hidden';
  updateLightboxImage();
}

function updateLightboxImage() {
  const imgEl = $('#lightboxImg');
  const counterEl = $('#lightboxCounter');
  if (!imgEl || !lightboxImages.length) return;
  imgEl.src = lightboxImages[lightboxCurrentIdx];
  counterEl.textContent = `${lightboxCurrentIdx + 1} / ${lightboxImages.length}`;
}

function nextLightboxImage() {
  if (!lightboxImages.length) return;
  lightboxCurrentIdx = (lightboxCurrentIdx + 1) % lightboxImages.length;
  updateLightboxImage();
}

function prevLightboxImage() {
  if (!lightboxImages.length) return;
  lightboxCurrentIdx = (lightboxCurrentIdx - 1 + lightboxImages.length) % lightboxImages.length;
  updateLightboxImage();
}

function closeLightboxGallery() {
  const lb = $('#lightboxModal');
  if (lb) lb.hidden = true;
  document.body.style.overflow = '';
}

function openLightbox(src) {
  openLightboxGallery([src], 0);
}

// ==========================================================================
// FEATURE 1 & 2: SIDE-BY-SIDE MOVIE COMPARISON
// ==========================================================================

function toggleCompare(movie) {
  const index = state.compareList.findIndex(m => m.id === movie.id);
  if (index >= 0) {
    state.compareList.splice(index, 1);
    toast('Removed from comparison');
    updateCompareDock();
    return false;
  } else {
    if (state.compareList.length >= 2) {
      toast('Maximum 2 movies can be compared. Clear one first.');
      return false;
    }
    state.compareList.push({
      id: movie.id,
      title: movie.title,
      year: movie.year,
      rating: movie.rating,
      runtime: movie.runtime,
      genres: movie.genres || [],
      medium_cover_image: movie.medium_cover_image || movie.large_cover_image,
      torrents: movie.torrents || [],
      summary: movie.summary || movie.description_full || '',
      cast: movie.cast || [],
      yt_trailer_code: movie.yt_trailer_code || ''
    });
    toast(`Added "${movie.title}" to comparison`);
    updateCompareDock();
    return true;
  }
}

function updateCompareDock() {
  const dock = $('#compareDock');
  const items = $('#compareDockItems');
  const countSpan = $('#compareDockCount');
  const badge = $('#compareBadge');
  const sideBadge = $('#sideCompareBadge');
  const headerBtn = $('#btnHeaderCompare');

  const count = state.compareList.length;
  if (countSpan) countSpan.textContent = count;
  if (badge) badge.textContent = count;
  if (sideBadge) sideBadge.textContent = count;
  if (headerBtn) headerBtn.hidden = count === 0;

  const mobileBadge = $('#mobileCompareBadge');
  if (mobileBadge) {
    mobileBadge.hidden = count === 0;
    mobileBadge.textContent = count;
  }
  const sheetCount = $('#sheetCompareCount');
  if (sheetCount) sheetCount.textContent = count;

  if (count === 0) {
    if (dock) dock.hidden = true;
    return;
  }
  if (dock) dock.hidden = false;
  if (items) {
    items.innerHTML = state.compareList.map(m => `
      <img class="dock-thumb" src="${fixImageUrl(m.medium_cover_image)}" title="${escapeHtml(m.title)}" alt="" />
    `).join('');
  }
}

function renderCompareColumn(movie, otherGenresSet, commonGenres, commonCast) {
  const img = fixImageUrl(movie.medium_cover_image || movie.large_cover_image);
  const ratingPercent = Math.min(100, Math.round((movie.rating || 0) * 10));
  const torrentQualities = [...new Set((movie.torrents || []).map(t => t.quality))].join(', ') || 'HD';
  const genres = movie.genres || [];

  return `
    <div class="compare-col">
      <div class="compare-head">
        <img src="${img}" alt="${escapeHtml(movie.title)}" onerror="this.style.opacity=0.3" />
        <div class="compare-head-info">
          <h3>${escapeHtml(movie.title)} (${movie.year})</h3>
          <div style="color:var(--gold);font-weight:700;">★ ${movie.rating} / 10</div>
          <div class="rating-compare-bar"><div class="rating-compare-fill" style="width:${ratingPercent}%"></div></div>
          <div style="margin-top:10px;">
            <button type="button" class="btn-primary btn-sm btn-compare-view" data-id="${movie.id}">View Details</button>
          </div>
        </div>
      </div>
      <div class="compare-row">
        <div class="compare-row-label">Runtime</div>
        <div class="compare-row-val">${movie.runtime ? movie.runtime + ' minutes' : 'N/A'}</div>
      </div>
      <div class="compare-row">
        <div class="compare-row-label">Genres (Green = Common Overlap)</div>
        <div class="compare-row-val">
          ${genres.map(g => `
            <span class="${commonGenres.includes(g) ? 'genre-badge-overlap' : 'genre-badge-unique'}">${escapeHtml(g)}</span>
          `).join('') || 'None listed'}
        </div>
      </div>
      <div class="compare-row">
        <div class="compare-row-label">Available Qualities</div>
        <div class="compare-row-val">${escapeHtml(torrentQualities)}</div>
      </div>
      <div class="compare-row">
        <div class="compare-row-label">Shared Cast Overlap</div>
        <div class="compare-row-val">
          ${commonCast.length ? commonCast.map(a => `<strong style="color:#4ade80;">${escapeHtml(a)}</strong>`).join(', ') : '<span style="color:#888;">No overlapping actors</span>'}
        </div>
      </div>
      <div class="compare-row">
        <div class="compare-row-label">Plot Synopsis</div>
        <div class="compare-row-val" style="font-size:0.82rem;line-height:1.45;color:var(--text-muted);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">
          ${escapeHtml(movie.summary || movie.description_full || 'No summary available.')}
        </div>
      </div>
    </div>
  `;
}

async function openCompareModal() {
  if (state.compareList.length < 2) {
    return toast('Please select 2 movies to compare side-by-side.');
  }
  const modal = $('#compareModal');
  const body = $('#compareBody');
  modal.hidden = false;
  document.body.style.overflow = 'hidden';

  const [m1, m2] = state.compareList;
  const [rich1, rich2] = await Promise.all([
    fetchMovieDetails(m1.id, { rich: true }).then(r => r || m1).catch(() => m1),
    fetchMovieDetails(m2.id, { rich: true }).then(r => r || m2).catch(() => m2),
  ]);

  const genres1 = new Set(rich1.genres || []);
  const genres2 = new Set(rich2.genres || []);
  const commonGenres = [...genres1].filter(g => genres2.has(g));

  const cast1 = (rich1.cast || []).map(c => c.name);
  const cast2 = (rich2.cast || []).map(c => c.name);
  const commonCast = cast1.filter(name => cast2.includes(name));

  body.innerHTML = `
    <div class="compare-grid">
      ${renderCompareColumn(rich1, genres2, commonGenres, commonCast)}
      ${renderCompareColumn(rich2, genres1, commonGenres, commonCast)}
    </div>
  `;

  body.querySelectorAll('.btn-compare-view').forEach(btn => {
    btn.onclick = () => {
      const id = parseInt(btn.dataset.id, 10);
      closeCompareModal();
      openDetails(id);
    };
  });
}

function closeCompareModal() {
  const modal = $('#compareModal');
  if (modal) modal.hidden = true;
  document.body.style.overflow = '';
}

// ==========================================================================
// FEATURE 1: AI VIBE MATCHER & SURPRISE ME ROULETTE
// ==========================================================================

function openAiVibeModal() {
  const modal = $('#aiVibeModal');
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#aiVibeInput').focus();
}

function closeAiVibeModal() {
  const modal = $('#aiVibeModal');
  if (modal) modal.hidden = true;
  document.body.style.overflow = '';
}

async function searchVibe(vibeText) {
  const statusEl = $('#aiVibeStatus');
  const resultsEl = $('#aiVibeResults');
  const gridEl = $('#aiVibeGrid');
  const bannerEl = $('#aiCuratorSummary');

  if (!vibeText || !vibeText.trim()) return toast('Please enter a movie vibe');

  statusEl.hidden = false;
  resultsEl.hidden = true;
  gridEl.innerHTML = '';

  try {
    const res = await fetch('/api/ai/vibe-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vibe: vibeText.trim() })
    });

    if (!res.ok) throw new Error('AI search failed');
    const data = await res.json();
    statusEl.hidden = true;
    resultsEl.hidden = false;
    bannerEl.textContent = data.summary || 'Curated movie matches:';

    const items = data.items || [];
    if (!items.length) {
      gridEl.innerHTML = '<p style="color:#888;padding:20px 0;">No matching movies found. Try another mood or keyword.</p>';
      return;
    }

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'ai-vibe-card';
      const img = fixImageUrl(item.medium_cover_image || '');
      card.innerHTML = `
        <img class="ai-vibe-thumb" src="${img}" alt="${escapeHtml(item.title)}" onerror="this.style.opacity=0.3" />
        <div class="ai-vibe-info">
          <div class="ai-vibe-title">${escapeHtml(item.title)}</div>
          <div class="ai-vibe-meta">${item.year || ''} • ${stars(item.rating || 0)} • ${escapeHtml(item.genre || item.genres?.[0] || 'Film')}</div>
          <div class="ai-vibe-reason">✨ ${escapeHtml(item.matchReason)}</div>
        </div>
        <button type="button" class="ai-vibe-btn">Explore</button>
      `;
      card.querySelector('.ai-vibe-btn').onclick = () => {
        closeAiVibeModal();
        if (item.id) {
          openDetails(item.id, item.title + (item.year ? ' ' + item.year : ''), item);
        } else {
          searchInput.value = item.title;
          state.query = item.title;
          loadMovies(true);
        }
      };
      gridEl.appendChild(card);
    });
  } catch (err) {
    statusEl.hidden = true;
    resultsEl.hidden = false;
    bannerEl.textContent = 'Curated recommendations:';
    gridEl.innerHTML = `<p style="color:#ff6b6b;padding:20px 0;">Error fetching AI matches: ${escapeHtml(err.message)}</p>`;
  }
}

function openSurpriseModal() {
  const modal = $('#surpriseModal');
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSurpriseModal() {
  const modal = $('#surpriseModal');
  if (modal) modal.hidden = true;
  document.body.style.overflow = '';
}

async function rollSurpriseMovie() {
  const btn = $('#surpriseRollBtn');
  const resultWrap = $('#surpriseResultWrap');
  const cardEl = $('#surpriseCard');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:8px;"></span> Rolling Cinema...`;

  const genre = $('#surpriseGenre').value;
  const rating = $('#surpriseRating').value;
  const quality = $('#surpriseQuality').value;

  const params = new URLSearchParams();
  if (genre) params.set('genre', genre);
  if (rating) params.set('minimum_rating', rating);
  if (quality) params.set('quality', quality);

  try {
    const res = await fetch(`/api/random-movie?${params}`);
    if (!res.ok) throw new Error('Failed to roll random movie');
    const { movie } = await res.json();
    resultWrap.hidden = false;
    const img = fixImageUrl(movie.medium_cover_image || movie.large_cover_image);
    cardEl.innerHTML = `
      <img class="surprise-card-img" src="${img}" alt="${escapeHtml(movie.title)}" onerror="this.style.opacity=0.3" />
      <div class="surprise-card-info">
        <h3 class="surprise-card-title">${escapeHtml(movie.title)} (${movie.year})</h3>
        <div class="surprise-card-meta">${stars(movie.rating)} · ${escapeHtml(movie.genres?.join(', ') || 'Film')}</div>
        <p class="surprise-card-desc">${escapeHtml(movie.summary || movie.description_full || 'No summary available.')}</p>
        <div class="surprise-card-actions">
          <button type="button" class="btn-primary btn-sm" id="surpriseWatchBtn">View Movie</button>
          <button type="button" class="btn-secondary btn-sm" id="surpriseAgainBtn">Roll Another</button>
        </div>
      </div>
    `;
    $('#surpriseWatchBtn').onclick = () => {
      closeSurpriseModal();
      openDetails(movie.id, movie.title + (movie.year ? ' ' + movie.year : ''), movie);
    };
    $('#surpriseAgainBtn').onclick = () => rollSurpriseMovie();
  } catch (err) {
    toast('Could not find random movie matching those criteria. Try loosening filters.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg class="btn-ico" aria-hidden="true"><use href="#i-dice"/></svg> Roll Random Movie`;
  }
}

function parseMovieIdFromLocation() {
  // 1) Handle SPA redirect from 404.html (e.g. /?/movie/123/slug)
  const search = location.search;
  if (search.startsWith('?/')) {
    const redirectPath = search.slice(1);
    const m = redirectPath.match(/\/movie\/(\d+)(?:\/.*)?$/);
    if (m) return parseInt(m[1], 10);
  }

  // 2) /movie/123/slug
  const pathMatch = location.pathname.match(/\/movie\/(\d+)(?:\/.*)?$/);
  if (pathMatch) return parseInt(pathMatch[1], 10);
  // 3) ?movie=123
  const q = new URLSearchParams(location.search).get('movie');
  if (q && /^\d+$/.test(q)) return parseInt(q, 10);
  // 3) #movie/123
  const hash = location.hash;
  if (hash.startsWith('#movie/')) {
    const id = parseInt(hash.replace('#movie/', ''), 10);
    if (!isNaN(id)) return id;
  }
  return null;
}

function closeDetails() {
  clearMovieStructuredData();
  state.currentMovieId = null;
  try {
    history.pushState({}, '', location.pathname.replace(/\/movie\/\d+(?:\/.*)?$/, '/') || '/');
  } catch (_) {
    window.location.hash = '';
  }
  if (location.hash.startsWith('#movie/')) {
    history.replaceState({}, '', location.pathname + location.search);
  }
  detailsView.hidden = true;
  homeView.hidden = false;
  window.scrollTo(0, 0);
  if (state.movies.length === 0) loadMovies(true);
}

function handleRoute() {
  const id = parseMovieIdFromLocation();
  if (id != null) {
    if (id !== state.currentMovieId) openDetails(id);
    return;
  }

  // Handle path-based category routing
  const path = location.pathname.toLowerCase().replace(/\/$/, '');
  const navItems = document.querySelectorAll('.nav-item');

  if (path === '/trending') {
    const nav = document.querySelector('.nav-item[data-view="trending"]');
    if (nav) nav.click();
  } else if (path === '/4k') {
    const nav = document.querySelector('.nav-item[data-view="4k"]');
    if (nav) nav.click();
  } else if (path === '/top-rated') {
    const nav = document.querySelector('.nav-item[data-view="top"]');
    if (nav) nav.click();
  } else if (path === '/genres') {
    const nav = document.querySelector('.nav-item[data-view="genres"]');
    if (nav) nav.click();
  } else if (path.startsWith('/genres/')) {
    const genre = decodeURIComponent(path.split('/')[2]);
    const formattedGenre = genre.charAt(0).toUpperCase() + genre.slice(1).toLowerCase();
    selectGenreFromHub(formattedGenre);
  } else if (path === '' || path === '/' || path === '/index.html') {
    if (state.currentMovieId) {
      state.currentMovieId = null;
      detailsView.hidden = true;
      homeView.hidden = false;
    }
    if (state.movies.length === 0 && !state.loading) {
      loadMovies(true);
    }
  }
}

function applyFiltersAndSearch() {
  state.pageSize = window.matchMedia('(max-width: 600px)').matches ? 16 : 20;
  state.mode = 'browse';
  state.query = searchInput.value.trim();
  state.quality = $('#filterQuality').value;
  state.genre = $('#filterGenre').value;
  state.rating = $('#filterRating').value;
  state.year = $('#filterYear').value;
  state.language = $('#filterLanguage').value;
  state.sort = $('#filterOrder').value;
  document.querySelectorAll('.genre-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.genre === state.genre);
  });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector('.nav-item[data-view="browse"]')?.classList.add('active');
  loadMovies(true);
}

function clearFilters() {
  searchInput.value = '';
  $('#filterQuality').value = '';
  $('#filterGenre').value = '';
  $('#filterRating').value = '';
  $('#filterYear').value = '';
  $('#filterLanguage').value = '';
  $('#filterOrder').value = 'latest';
  document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
  state.query = state.quality = state.genre = state.rating = state.year = state.language = '';
  state.sort = 'latest';
  state.mode = 'browse';
  loadMovies(true);
}

// Events
on('#searchBtn', 'click', applyFiltersAndSearch);
on(searchInput, 'keydown', (e) => { if (e.key === 'Enter') applyFiltersAndSearch(); });
['filterQuality','filterGenre','filterRating','filterYear','filterLanguage','filterOrder'].forEach(id => {
  on(`#${id}`, 'change', applyFiltersAndSearch);
});
on('#backBtn', 'click', closeDetails);
on('#clearFiltersBtn', 'click', () => {
  if ($('#clearFiltersBtn').dataset.action === 'retry') loadMovies(true);
  else clearFilters();
});
on('#clearRecent', 'click', () => {
  LS.set('mbps_recent', []);
  renderRecent();
});

on('#logo', 'click', (e) => {
  e.preventDefault();
  if (location.pathname !== '/') {
    history.pushState({}, '', '/');
  }
  if (state.currentMovieId) closeDetails();
  clearFilters();
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector('.nav-item[data-view="browse"]')?.classList.add('active');
  syncMobileNavActive('browse');
});

document.querySelectorAll('.nav-item').forEach(item => {
  on(item, 'click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const view = item.dataset.view;
    syncMobileNavActive(view);

    // Update URL for the view
    const viewPath = view === 'browse' ? '/' : `/${view}`;
    if (location.pathname !== viewPath && view !== 'watchlist' && view !== 'genres') {
      history.pushState({ view }, '', viewPath);
    }

    if (view === 'watchlist') {
      if (state.currentMovieId) closeDetails();
      const hub = $('#genresHub');
      const moviesSec = $('#moviesSection');
      if (hub) hub.hidden = true;
      if (moviesSec) moviesSec.hidden = false;
      loadWatchlist();
      return;
    }
    if (view === 'genres') {
      showGenresHub();
      return;
    }
    state.mode = 'browse';
    state.query = '';
    const si = searchInput;
    if (si) si.value = '';
    state.quality = state.genre = state.rating = state.year = state.language = '';
    const fq = $('#filterQuality'); if (fq) fq.value = '';
    const fg = $('#filterGenre'); if (fg) fg.value = '';
    const fr = $('#filterRating'); if (fr) fr.value = '';
    const fy = $('#filterYear'); if (fy) fy.value = '';
    const fl = $('#filterLanguage'); if (fl) fl.value = '';
    document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.genre-card').forEach(c => c.classList.remove('active'));
    const hub = $('#genresHub');
    const moviesSec = $('#moviesSection');
    if (hub) hub.hidden = true;
    if (moviesSec) moviesSec.hidden = false;
    if (view === '4k') {
      state.quality = '2160p';
      const fq2 = $('#filterQuality'); if (fq2) fq2.value = '2160p';
      state.sort = 'latest';
    } else if (view === 'top') {
      state.sort = 'rating';
      const fo = $('#filterOrder'); if (fo) fo.value = 'rating';
    } else if (view === 'trending') {
      state.sort = 'seeds';
      const fo2 = $('#filterOrder'); if (fo2) fo2.value = 'seeds';
    } else {
      state.sort = 'latest';
      const fo3 = $('#filterOrder'); if (fo3) fo3.value = 'latest';
    }
    if (state.currentMovieId) closeDetails();
    loadMovies(true);
  });
});

document.querySelectorAll('.bc-link[data-view]').forEach(link => {
  on(link, 'click', (e) => {
    e.preventDefault();
    const view = link.dataset.view;
    const nav = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (nav) nav.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

function syncMobileNavActive(view) {
  document.querySelectorAll('.mobile-nav-item[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
}

function initViewMode() {
  const toggle = $('#viewModeToggle');
  state.viewLayout = (typeof LS !== 'undefined' && LS.get('mbps_view_mode', 'grid')) || 'grid';
  if (movieGrid) movieGrid.classList.toggle('list-view', state.viewLayout === 'list');
  if (!toggle) return;
  toggle.querySelectorAll('.btn-view-mode').forEach(b => {
    b.classList.toggle('active', b.dataset.layout === state.viewLayout);
    b.onclick = () => {
      const mode = b.dataset.layout;
      state.viewLayout = mode;
      if (typeof LS !== 'undefined') LS.set('mbps_view_mode', mode);
      toggle.querySelectorAll('.btn-view-mode').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layout === mode);
      });
      if (movieGrid) movieGrid.classList.toggle('list-view', mode === 'list');
      if (state.movies && state.movies.length) {
        renderGrid(state.movies, false);
      }
    };
  });
}

function renderActiveFilters() {
  const strip = $('#activeFiltersStrip');
  const container = $('#activeFiltersChips');
  if (!strip || !container) return;

  const chips = [];
  if (state.query && state.mode !== 'watchlist') {
    chips.push({
      label: `Search: "${state.query}"`,
      clear: () => {
        state.query = '';
        if (searchInput) searchInput.value = '';
        loadMovies(true);
      }
    });
  }
  if (state.genre) {
    chips.push({
      label: `Genre: ${state.genre}`,
      clear: () => {
        state.genre = '';
        const fg = $('#filterGenre'); if (fg) fg.value = '';
        document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
        loadMovies(true);
      }
    });
  }
  if (state.quality) {
    chips.push({
      label: `Quality: ${state.quality}`,
      clear: () => {
        state.quality = '';
        const fq = $('#filterQuality'); if (fq) fq.value = '';
        loadMovies(true);
      }
    });
  }
  if (state.rating) {
    chips.push({
      label: `Rating: ${state.rating}+`,
      clear: () => {
        state.rating = '';
        const fr = $('#filterRating'); if (fr) fr.value = '';
        loadMovies(true);
      }
    });
  }
  if (state.year) {
    chips.push({
      label: `Year: ${state.year}`,
      clear: () => {
        state.year = '';
        const fy = $('#filterYear'); if (fy) fy.value = '';
        loadMovies(true);
      }
    });
  }
  if (state.advFilters && state.advFilters.decade) {
    chips.push({
      label: `Era: ${state.advFilters.decade}`,
      clear: () => {
        state.advFilters.decade = '';
        const fd = $('#filterDecade'); if (fd) fd.value = '';
        loadMovies(true);
      }
    });
  }
  if (state.advFilters && state.advFilters.runtime) {
    chips.push({
      label: `Runtime: ${state.advFilters.runtime}`,
      clear: () => {
        state.advFilters.runtime = '';
        const fr = $('#filterRuntime'); if (fr) fr.value = '';
        loadMovies(true);
      }
    });
  }
  if (state.advFilters && state.advFilters.seeds) {
    chips.push({
      label: `Seeds: ${state.advFilters.seeds}+`,
      clear: () => {
        state.advFilters.seeds = '';
        const fs = $('#filterSeeds'); if (fs) fs.value = '';
        loadMovies(true);
      }
    });
  }

  if (chips.length === 0 || state.mode === 'watchlist') {
    strip.hidden = true;
    container.innerHTML = '';
    return;
  }

  strip.hidden = false;
  container.innerHTML = '';
  chips.forEach(chip => {
    const el = document.createElement('span');
    el.className = 'active-filter-chip';
    el.innerHTML = `<span>${escapeHtml(chip.label)}</span><button type="button" class="chip-remove" aria-label="Remove filter">&times;</button>`;
    el.querySelector('.chip-remove').onclick = (e) => {
      e.stopPropagation();
      chip.clear();
    };
    container.appendChild(el);
  });
}

function initMobileNavigation() {
  const bottomNav = $('#mobileBottomNav');
  const sheet = $('#mobileToolsSheet');
  const sheetBackdrop = $('#mobileSheetBackdrop');
  const sheetClose = $('#mobileSheetClose');
  const toolsBtn = $('#mobileToolsBtn');

  const closeSheet = () => {
    if (sheet) sheet.hidden = true;
    if (sheetBackdrop) sheetBackdrop.hidden = true;
  };
  const openSheet = () => {
    if (sheet) sheet.hidden = false;
    if (sheetBackdrop) sheetBackdrop.hidden = false;
  };

  if (toolsBtn) {
    toolsBtn.onclick = () => {
      if (sheet && !sheet.hidden) closeSheet();
      else openSheet();
    };
  }
  if (sheetClose) sheetClose.onclick = closeSheet;
  if (sheetBackdrop) sheetBackdrop.onclick = closeSheet;

  // Sync mobile bottom nav items
  document.querySelectorAll('.mobile-nav-item[data-view]').forEach(item => {
    item.onclick = (e) => {
      e.preventDefault();
      closeSheet();
      const view = item.dataset.view;
      const targetNav = document.querySelector(`.nav-item[data-view="${view}"]`);
      if (targetNav) targetNav.click();
      syncMobileNavActive(view);
    };
  });

  // Sheet tools click handlers
  on('#sheetAiVibeBtn', 'click', () => {
    closeSheet();
    if (typeof openAiVibeModal === 'function') openAiVibeModal();
  });
  on('#sheetSurpriseBtn', 'click', () => {
    closeSheet();
    if (typeof openSurpriseModal === 'function') openSurpriseModal();
  });
  on('#sheetCompareBtn', 'click', () => {
    closeSheet();
    if (state.compareList.length > 0) openCompareModal();
    else toast('Pick movies using Compare on movie cards to compare');
  });
  on('#sheetGenresBtn', 'click', () => {
    closeSheet();
    showGenresHub();
  });
  on('#sheetThemeToggle', 'click', () => {
    const isLight = document.body.classList.contains('light');
    applyTheme(isLight ? 'dark' : 'light');
  });

  on('#clearActiveFiltersBtn', 'click', () => {
    clearFilters();
  });

  // Hotkey navigation: "/" or Cmd+K/Ctrl+K to focus search; Esc to close modals / details
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      if (hSearchInput) {
        hSearchInput.focus();
        hSearchInput.select();
      } else if (searchInput) {
        searchInput.focus();
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (hSearchInput) {
        hSearchInput.focus();
        hSearchInput.select();
      }
    } else if (e.key === 'Escape') {
      closeSheet();
      if (state.currentMovieId && detailsView && !detailsView.hidden) {
        closeDetails();
      }
    }
  });
}

// Infinite scroll disabled in favor of numbered pagination
/*
const sentinel = $('#scrollSentinel');
if (sentinel && 'IntersectionObserver' in window) {
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && state.hasMore && !state.loading && state.mode !== 'watchlist' && !detailsView.hidden === false) {
      if (!homeView.hidden) loadMovies(false);
    }
  }, { rootMargin: '400px' }).observe(sentinel);
}
*/

// Theme
function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
  document.body.classList.add('theme-set');
  const btn = $('#themeToggle');
  if (btn) {
    const use = btn.querySelector('use');
    if (use) use.setAttribute('href', theme === 'light' ? '#i-sun' : '#i-moon');
    else btn.textContent = theme === 'light' ? '☀' : '☾';
    btn.setAttribute('aria-label', theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    btn.title = theme === 'light' ? 'Dark mode' : 'Light mode';
  }
  LS.set('mbps_theme', theme);
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    meta.content = theme === 'light' ? '#f4f4f5' : '#0a0a0a';
  });
}
(function initTheme() {
  const stored = LS.get('mbps_theme', null);
  if (stored === 'light' || stored === 'dark') applyTheme(stored);
  else {
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(prefersLight ? 'light' : 'dark');
  }
})();
on('#themeToggle', 'click', () => {
  applyTheme(document.body.classList.contains('light') ? 'dark' : 'light');
});

/**
 * Gesture conflict handling for horizontal strips:
 * - Axis lock after small movement (horizontal vs vertical)
 * - Vertical intent → ignore (page scroll wins)
 * - Multi-touch → cancel
 * - Moved past threshold → suppress click on children
 * - Native overflow scroll preferred; JS only nudges when locked horizontal
 */
function enableSwipe(el, hooks) {
  if (!el || el.dataset.swipeBound === '1') return;
  el.dataset.swipeBound = '1';
  const onSwipeLeft = hooks && hooks.onSwipeLeft;
  const onSwipeRight = hooks && hooks.onSwipeRight;
  const LOCK = 10;      // px before axis decision
  const SWIPE = 50;     // px to count as swipe
  const MAX_MS = 600;

  let x0 = 0, y0 = 0, t0 = 0;
  let axis = null;       // 'h' | 'v' | null
  let active = false;
  let suppressedClick = false;

  function reset() {
    active = false;
    axis = null;
  }

  el.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 1) { reset(); return; }
    const t = e.touches[0];
    active = true;
    axis = null;
    suppressedClick = false;
    x0 = t.clientX;
    y0 = t.clientY;
    t0 = Date.now();
  }, { passive: true });

  el.addEventListener('touchmove', function(e) {
    if (!active || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;

    if (!axis) {
      if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
      // Decide dominant axis — vertical wins page scroll conflict
      if (Math.abs(dy) > Math.abs(dx)) {
        axis = 'v';
        // Let the browser handle vertical scrolling; stop tracking as swipe
        active = false;
        return;
      }
      axis = 'h';
      suppressedClick = true;
    }

    if (axis === 'h') {
      // Horizontal: allow native overflow-x; mark that click should be ignored
      suppressedClick = true;
    }
  }, { passive: true });

  el.addEventListener('touchend', function(e) {
    if (!active && axis !== 'h') { reset(); return; }
    const t = e.changedTouches[0];
    if (!t) { reset(); return; }
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    const dt = Date.now() - t0;

    if (axis === 'h' && dt <= MAX_MS && Math.abs(dx) >= SWIPE && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) { if (onSwipeLeft) onSwipeLeft(); }
      else { if (onSwipeRight) onSwipeRight(); }
    }
    reset();
  }, { passive: true });

  el.addEventListener('touchcancel', function() { reset(); }, { passive: true });

  // Suppress click after horizontal drag so posters don't open mid-swipe
  el.addEventListener('click', function(e) {
    if (suppressedClick) {
      e.preventDefault();
      e.stopPropagation();
      suppressedClick = false;
    }
  }, true);
}

function bindStripSwipe(selector) {
  document.querySelectorAll(selector).forEach(function(strip) {
    // Allow rebinding after DOM refresh
    if (strip.dataset.swipeBound === '1') return;
    enableSwipe(strip, {
      onSwipeLeft: function() {
        // Prefer native momentum; only nudge if not already scrolling fast
        const step = Math.min(Math.max(strip.clientWidth * 0.75, 160), 320);
        strip.scrollBy({ left: step, behavior: 'smooth' });
      },
      onSwipeRight: function() {
        const step = Math.min(Math.max(strip.clientWidth * 0.75, 160), 320);
        strip.scrollBy({ left: -step, behavior: 'smooth' });
      }
    });
  });
}

/** Suppress accidental card navigation when user was scrolling a parent strip */
function guardPosterClicks(container) {
  if (!container || container.dataset.clickGuard === '1') return;
  container.dataset.clickGuard = '1';
  let startX = 0, startY = 0, moved = false;
  container.addEventListener('pointerdown', function(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
  }, { passive: true });
  container.addEventListener('pointermove', function(e) {
    if (Math.abs(e.clientX - startX) > 12 || Math.abs(e.clientY - startY) > 12) moved = true;
  }, { passive: true });
  container.addEventListener('click', function(e) {
    if (moved) {
      e.preventDefault();
      e.stopPropagation();
      moved = false;
    }
  }, true);
}


// Keyboard
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== searchInput && !e.ctrlKey && !e.metaKey) {
    const tag = document.activeElement?.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      e.preventDefault();
      searchInput.focus();
    }
  }
  if (e.key === 'Escape') {
    const modalOv = $('#modalOverlay');
    if (modalOv && !modalOv.hidden) closeModal();
    else if (document.getElementById('lightboxModal') && !document.getElementById('lightboxModal').hidden) {
      if (typeof closeLightboxGallery === 'function') closeLightboxGallery();
      else {
        document.getElementById('lightboxModal').hidden = true;
        document.body.style.overflow = '';
      }
    } else if (detailsView && !detailsView.hidden) closeDetails();
  }
});

// Details tabs
document.getElementById('detailsTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.details-tab');
  if (btn?.dataset.tab) switchDetailsTab(btn.dataset.tab);
});

// PWA install
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = $('#installBtn');
  if (btn) btn.hidden = false;
});
on('#installBtn', 'click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  const btn = $('#installBtn');
  if (btn) btn.hidden = true;
});

// Modals (legal + trailer)
const MODAL_CONTENT = {
  privacy: { title: 'Privacy Policy', body: `
      <p><strong>Last updated:</strong> August 2026</p>
      <p>Movies By Prosper Sasuu respects your privacy.</p>
      <h3>Information we collect</h3>
      <ul>
        <li>No accounts or registration are required.</li>
        <li>Anonymous usage data may be collected via analytics (for example Google Analytics) and server logs.</li>
        <li>Watchlist and preferences are stored only in your browser (localStorage).</li>
      </ul>
      <h3>Cookies and advertising</h3>
      <p>We use Google AdSense to display ads. Google and authorized partners may use cookies or similar technologies to serve and personalize ads based on your visits to this and other sites. You can manage ad personalization through Google’s ad settings. Third-party vendors, including Google, use cookies to serve ads based on a user’s prior visits.</p>
      <h3>Third-party services</h3>
      <p>Movie metadata and images are loaded from public APIs. Those services have their own privacy policies. Analytics (Google Analytics) and heatmapping (Microsoft Clarity) may process usage data as described in their policies.</p>
      <h3>Contact</h3>
      <p><a href="mailto:prospersasuu808@gmail.com">prospersasuu808@gmail.com</a></p>
    ` },
  terms: { title: 'Terms of Service', body: `
      <p><strong>Last updated:</strong> August 2026</p>
      <h3>Service description</h3>
      <p>Movies By Prosper Sasuu (“the Site”) provides movie discovery tools and metadata (titles, artwork, ratings, summaries, and related information) gathered from public sources.</p>
      <h3>No hosting of media</h3>
      <p>We do not host, store, stream, upload, or transmit copyrighted video or audio files. Any magnet links or torrent URLs displayed are third-party references outside our control.</p>
      <h3>User responsibility</h3>
      <p>You agree to use the Site in accordance with the laws of your jurisdiction. You are solely responsible for any actions you take based on information or links on the Site, including downloading or sharing content.</p>
      <h3>Disclaimer of liability</h3>
      <p>The Site is provided “as is” without warranties of any kind. We are not liable for third-party links, accuracy of metadata, or damages arising from use of the Site.</p>
      <h3>Advertising</h3>
      <p>The Site may display advertisements served by Google AdSense or similar partners. See our Privacy Policy for cookie and advertising details.</p>
    ` },
  dmca: { title: 'DMCA / Copyright', body: `
      <p><strong>Last updated:</strong> August 2026</p>
      <h3>Our role</h3>
      <p>Movies By Prosper Sasuu is a metadata directory. We do not host copyrighted video files. Screenshots, posters, and text descriptions are displayed as part of publicly available catalog information.</p>
      <h3>Disclaimer</h3>
      <p>If you believe material referenced on this Site infringes your copyright, please send a notice to <strong>prospersasuu808@gmail.com</strong> with: identification of the work, the exact URL or movie title on our Site, your contact details, a good-faith statement, and your signature. We will review valid notices and remove or disable metadata entries where appropriate.</p>
    ` },
  agreement: { title: 'User Agreement', body: `
      <p><strong>Last updated:</strong> August 2026</p>
      <p>By accessing Movies By Prosper Sasuu you agree to this User Agreement, our Terms of Service, and Privacy Policy.</p>
      <h3>Eligibility</h3>
      <p>You must be old enough to use the Site under the laws of your country (generally 18+ where required).</p>
      <h3>Acceptable use</h3>
      <p>You will not use the Site to engage in copyright infringement or other illegal activity. You understand that third-party magnet or torrent links are not provided as a service to obtain pirated content, and that compliance with local law is your responsibility.</p>
      <h3>No warranty</h3>
      <p>Metadata and links may be incomplete or inaccurate. The Site is provided without warranties.</p>
    ` },
  about: { title: 'About Us', body: `<p><strong>Movies By Prosper Sasuu</strong> is an independent movie discovery project. We index public metadata so you can explore titles and find encodes - we never host video files.</p>` },
  contact: { title: 'Contact', body: `<p>📧 <a href="mailto:prospersasuu808@gmail.com">prospersasuu808@gmail.com</a></p><p>We aim to reply within 2–5 business days.</p>` },
  guides: { title: 'Guides & FAQ', body: `<h3>Search</h3><p>Use the search bar or press <kbd>/</kbd>. Filter by quality, genre, rating, year, language.</p><h3>Watchlist</h3><p>Tap ♡ on a poster or details page. Saved in your browser only.</p><h3>Magnets</h3><p>Use Magnet or Copy, then open in your torrent client.</p><h3>Legality</h3><p>Browsing metadata is generally fine; downloading may not be - follow your local laws.</p>` }
};

function openModal(key, titleOverride, bodyOverride) {
  const data = MODAL_CONTENT[key];
  $('#modalTitle').textContent = titleOverride || data?.title || '';
  $('#modalBody').innerHTML = bodyOverride || data?.body || '';
  $('#modalOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  const ov = $('#modalOverlay');
  if (ov) ov.hidden = true;
  document.body.style.overflow = '';
  // stop youtube if trailer was open
  const body = $('#modalBody');
  if (body) body.innerHTML = '';
}
on('#modalClose', 'click', closeModal);
on('#modalOverlay', 'click', (e) => { if (e.target === $('#modalOverlay')) closeModal(); });

document.querySelectorAll('[data-modal]').forEach(el => {
  on(el, 'click', (e) => { e.preventDefault(); openModal(el.dataset.modal); });
});
document.querySelectorAll('[data-page]').forEach(el => {
  on(el, 'click', (e) => {
    e.preventDefault();
    const view = el.dataset.page;
    const nav = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (nav) nav.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

window.addEventListener('hashchange', handleRoute);
window.addEventListener('popstate', handleRoute);

// Init
updateWatchlistBadge();
if (typeof initAdSlots === 'function') initAdSlots();
if (typeof bindStripSwipe === 'function') { bindStripSwipe('.recent-strip'); bindStripSwipe('.genre-chips'); }
if (typeof guardPosterClicks === 'function') { guardPosterClicks($('#movieGrid')); guardPosterClicks($('#recentStrip')); }
handleRoute();
if (parseMovieIdFromLocation() == null) {
  loadMovies(true);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.share-wrap')) {
    document.querySelectorAll('.share-menu').forEach(m => { m.hidden = true; });
    document.querySelectorAll('.btn-share').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
});


// ===== Side menu drawer =====
const menuToggle = $('#menuToggle');
const sideMenu = $('#sideMenu');
const menuBackdrop = $('#menuBackdrop');
const menuCloseBtn = $('#menuClose');

function openMenu() {
  if (!sideMenu) return;
  sideMenu.hidden = false;
  if (menuBackdrop) menuBackdrop.hidden = false;
  requestAnimationFrame(function() {
    sideMenu.classList.add('is-open');
  });
  sideMenu.setAttribute('aria-hidden', 'false');
  if (menuToggle) {
    menuToggle.setAttribute('aria-expanded', 'true');
    menuToggle.setAttribute('aria-label', 'Close menu');
  }
  document.body.classList.add('menu-open');
}

function closeMenu() {
  if (!sideMenu) return;
  sideMenu.classList.remove('is-open');
  sideMenu.setAttribute('aria-hidden', 'true');
  if (menuToggle) {
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open menu');
  }
  document.body.classList.remove('menu-open');
  setTimeout(function() {
    if (!sideMenu.classList.contains('is-open')) {
      sideMenu.hidden = true;
      if (menuBackdrop) menuBackdrop.hidden = true;
    }
  }, 280);
}

if (menuToggle) {
  on(menuToggle, 'click', function(e) {
    e.stopPropagation();
    if (sideMenu && sideMenu.classList.contains('is-open')) closeMenu();
    else openMenu();
  });
}
on('#menuClose', 'click', closeMenu);
on('#menuBackdrop', 'click', closeMenu);

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && sideMenu && sideMenu.classList.contains('is-open')) closeMenu();
});
window.addEventListener('resize', function() {
  if (window.innerWidth > 960) closeMenu();
});

document.querySelectorAll('.side-menu-item[data-view]').forEach(function(el) {
  on(el, 'click', function(e) {
    e.preventDefault();
    var view = el.dataset.view;
    var nav = document.querySelector('.nav-item[data-view="' + view + '"]');
    closeMenu();
    if (nav) nav.click();
  });
});
document.querySelectorAll('.side-menu-item[data-modal]').forEach(function(el) {
  on(el, 'click', function(e) {
    e.preventDefault();
    closeMenu();
    if (typeof openModal === 'function') openModal(el.dataset.modal);
  });
});

// ==========================================================================
// FEATURE 1: AI VIBE MATCHER & SURPRISE ME EVENT LISTENERS
// ==========================================================================

on('#btnAiVibe', 'click', openAiVibeModal);
on('#sideAiVibe', 'click', (e) => { e.preventDefault(); closeMenu(); openAiVibeModal(); });
on('#aiVibeClose', 'click', closeAiVibeModal);
on('#aiVibeModal', 'click', (e) => { if (e.target === $('#aiVibeModal')) closeAiVibeModal(); });
on('#aiVibeSubmitBtn', 'click', () => searchVibe($('#aiVibeInput').value));
on('#aiVibeInput', 'keydown', (e) => { if (e.key === 'Enter') searchVibe($('#aiVibeInput').value); });

document.querySelectorAll('.vibe-chip').forEach(chip => {
  on(chip, 'click', () => {
    const v = chip.dataset.vibe;
    $('#aiVibeInput').value = v;
    searchVibe(v);
  });
});

on('#btnSurpriseMe', 'click', openSurpriseModal);
on('#sideSurpriseMe', 'click', (e) => { e.preventDefault(); closeMenu(); openSurpriseModal(); });
on('#surpriseClose', 'click', closeSurpriseModal);
on('#surpriseModal', 'click', (e) => { if (e.target === $('#surpriseModal')) closeSurpriseModal(); });
on('#surpriseRollBtn', 'click', rollSurpriseMovie);

// ==========================================================================
// FEATURE 2: ADVANCED FILTER PANEL & COMPARISON DOCK
// ==========================================================================

const toggleAdvBtn = $('#toggleAdvFilters');
const advPanel = $('#advFiltersPanel');

if (toggleAdvBtn && advPanel) {
  on(toggleAdvBtn, 'click', () => {
    const isHidden = advPanel.hidden;
    advPanel.hidden = !isHidden;
    toggleAdvBtn.classList.toggle('active', isHidden);
    toggleAdvBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
  });
}

on('#filterDecade', 'change', (e) => {
  state.advFilters.decade = e.target.value;
  loadMovies(true);
});
on('#filterRuntime', 'change', (e) => {
  state.advFilters.runtime = e.target.value;
  loadMovies(true);
});
on('#filterSeeds', 'change', (e) => {
  state.advFilters.seeds = e.target.value;
  loadMovies(true);
});

on('#resetAllFiltersBtn', 'click', () => {
  state.quality = '';
  state.genre = '';
  state.rating = '';
  state.year = '';
  state.language = '';
  state.sort = 'latest';
  state.query = '';
  state.advFilters = { decade: '', runtime: '', seeds: '' };

  $('#filterQuality').value = '';
  $('#filterGenre').value = '';
  $('#filterRating').value = '';
  $('#filterYear').value = '';
  $('#filterLanguage').value = '';
  $('#filterOrder').value = 'latest';
  searchInput.value = '';
  if ($('#filterDecade')) $('#filterDecade').value = '';
  if ($('#filterRuntime')) $('#filterRuntime').value = '';
  if ($('#filterSeeds')) $('#filterSeeds').value = '';

  document.querySelectorAll('.genre-chip').forEach(c => c.classList.remove('active'));
  loadMovies(true);
  toast('All filters reset');
});

// Compare Modal & Dock
on('#btnHeaderCompare', 'click', openCompareModal);
on('#sideCompare', 'click', (e) => { e.preventDefault(); closeMenu(); openCompareModal(); });
on('#compareClose', 'click', closeCompareModal);
on('#compareModal', 'click', (e) => { if (e.target === $('#compareModal')) closeCompareModal(); });
on('#compareLaunchBtn', 'click', openCompareModal);
on('#compareClearBtn', 'click', () => {
  state.compareList = [];
  updateCompareDock();
  toast('Movie comparison cleared');
});

// ==========================================================================
// FEATURE 3: THEATER & LIGHTBOX MODAL EVENT LISTENERS
// ==========================================================================

on('#theaterCloseBtn', 'click', closeTrailerTheater);
on('#theaterBackdrop', 'click', closeTrailerTheater);
on('#theaterFullscreenBtn', 'click', () => {
  const container = $('#trailerTheater');
  if (!document.fullscreenElement) {
    if (container.requestFullscreen) container.requestFullscreen();
    else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
});

on('#lightboxClose', 'click', closeLightboxGallery);
on('#lightboxBackdrop', 'click', closeLightboxGallery);
on('#lightboxPrev', 'click', prevLightboxImage);
on('#lightboxNext', 'click', nextLightboxImage);

document.addEventListener('keydown', (e) => {
  const theater = $('#trailerTheater');
  const lb = $('#lightboxModal');

  if (theater && !theater.hidden) {
    if (e.key === 'Escape') closeTrailerTheater();
    if (e.key === 'f' || e.key === 'F') {
      $('#theaterFullscreenBtn')?.click();
    }
    return;
  }

  if (lb && !lb.hidden) {
    if (e.key === 'Escape') closeLightboxGallery();
    if (e.key === 'ArrowLeft') prevLightboxImage();
    if (e.key === 'ArrowRight') nextLightboxImage();
    return;
  }

  if (e.key === 'Escape') {
    closeAiVibeModal();
    closeSurpriseModal();
    closeCompareModal();
  }
});

// ==========================================================================
// FEATURE 4: WATCHLIST CATEGORIES, EXPORT/IMPORT & SHARING
// ==========================================================================

document.querySelectorAll('.wl-cat-btn').forEach(btn => {
  on(btn, 'click', () => {
    document.querySelectorAll('.wl-cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.wlCategory = btn.dataset.cat;
    loadWatchlist();
  });
});

on('#wlExportJson', 'click', exportWatchlistJson);
on('#wlExportCsv', 'click', exportWatchlistCsv);
on('#wlImportInput', 'change', (e) => {
  if (e.target.files && e.target.files[0]) {
    importWatchlistFile(e.target.files[0]);
    e.target.value = '';
  }
});
on('#wlShareBtn', 'click', shareWatchlist);

// Shared Watchlist banner handling on page load
(function checkSharedWatchlist() {
  const hash = location.hash;
  if (hash.includes('#shared-watchlist=')) {
    try {
      const b64 = hash.split('#shared-watchlist=')[1];
      const json = decodeURIComponent(atob(b64));
      const sharedList = JSON.parse(json);
      if (Array.isArray(sharedList) && sharedList.length > 0) {
        const banner = $('#sharedWlBanner');
        if (banner) {
          banner.hidden = false;
          banner.querySelector('strong').textContent = `Shared Watchlist (${sharedList.length} movies loaded):`;
          on('#saveSharedWlBtn', 'click', () => {
            const current = getWatchlist();
            const existing = new Set(current.map(m => m.id));
            let added = 0;
            sharedList.forEach(m => {
              if (m && m.id && !existing.has(m.id)) {
                current.push({
                  id: m.id,
                  title: m.t || m.title || 'Movie',
                  year: m.y || m.year || 2020,
                  rating: m.r || m.rating || 0,
                  category: m.c || 'plan',
                  medium_cover_image: m.img || m.medium_cover_image || '',
                  addedAt: Date.now()
                });
                existing.add(m.id);
                added++;
              }
            });
            setWatchlist(current);
            banner.hidden = true;
            toast(`Saved ${added} shared movies to your watchlist!`);
            const wlNav = document.querySelector('.nav-item[data-view="watchlist"]');
            if (wlNav) wlNav.click();
          });
          on('#dismissSharedWlBtn', 'click', () => {
            banner.hidden = true;
          });
        }
      }
    } catch (err) {
      console.warn('Invalid shared watchlist hash', err);
    }
  }
})();

// Online / Offline Status
function updateNetworkStatus() {
  const offlineBanner = $('#offlineBanner');
  if (offlineBanner) {
    offlineBanner.hidden = navigator.onLine;
  }
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
updateNetworkStatus();

// Initialize modern view mode and mobile bottom navigation
if (typeof initViewMode === 'function') initViewMode();
if (typeof initMobileNavigation === 'function') initMobileNavigation();

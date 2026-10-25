const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const AFFILIATE_CONFIG_PATH = path.join(__dirname, 'config', 'affiliate.json');
const LIBRARY_DATA_PATH = path.join(__dirname, 'data', 'library.json');

function getAffiliateConfig() {
  try {
    if (fs.existsSync(AFFILIATE_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(AFFILIATE_CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.warn('[CONFIG WARN] Error reading affiliate.json:', e.message);
  }
  return { enabled: true, default_affiliate_link: 'https://s.shopee.co.id/' };
}

function extractProductInfo(caption, rawTitle) {
  const text = (caption || rawTitle || '').trim();
  
  // 1. Coba ambil teks non-hashtag terlebih dahulu
  let cleanName = text
    .replace(/#ShopeeCOD|#RacunShopee|#ShopeeLook|#DiskonShopee|#ShopeeHaul|#PromoShopee|#ViralDiShopeeVideo|#SpillBawaBerkah|#Diskon\d+Persen|#BadaiTapiBudget/gi, '')
    .replace(/#[a-zA-Z0-9_]+/g, '')
    .replace(/[<>:"/\\|?*#\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 2. Jika teks kosong (karena caption hanya berisi hashtag), ambil kata kunci dari hashtag produk
  if (!cleanName || cleanName.length < 3) {
    const tags = (text.match(/#[a-zA-Z0-9_]+/g) || [])
      .map(t => t.replace(/^#/, ''))
      .filter(t => !/^(Shopee|RacunShopee|Viral|Spill|Diskon|Promo|Badai|FYP)/i.test(t));
    
    if (tags.length > 0) {
      cleanName = tags.slice(0, 3).join(' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ');
    }
  }

  if (!cleanName || cleanName.length < 3) {
    cleanName = 'Produk Rekomendasi Shopee';
  }

  // Batasi panjang nama produk
  if (cleanName.length > 60) {
    cleanName = cleanName.substring(0, 60).trim();
  }

  const keyword = cleanName.toLowerCase();
  const config = getAffiliateConfig();
  const affId = config.affiliate_id || 'an_11369380175';

  // Link pencarian dinamis Shopee sesuai dengan produk di video + ID Affiliate
  const dynamicAffiliateUrl = `https://shopee.co.id/search?keyword=${encodeURIComponent(cleanName)}&utm_source=${affId}&utm_medium=affiliates`;
  const affiliateUrl = config.dynamic_product_search !== false ? dynamicAffiliateUrl : (config.default_affiliate_link || dynamicAffiliateUrl);

  return {
    name: cleanName,
    keyword: keyword,
    search_url: `https://shopee.co.id/search?keyword=${encodeURIComponent(cleanName)}`,
    affiliate_url: affiliateUrl
  };
}

function saveToLibrary(videoData) {
  try {
    let list = [];
    if (fs.existsSync(LIBRARY_DATA_PATH)) {
      list = JSON.parse(fs.readFileSync(LIBRARY_DATA_PATH, 'utf-8') || '[]');
    }

    const videoId = videoData.id || `vid-${Date.now()}`;
    const productInfo = videoData.product || extractProductInfo(videoData.title, videoData.title);

    const existingIndex = list.findIndex(item => item.id === videoId || item.video_url === videoData.video_url || item.title === videoData.title);

    if (existingIndex !== -1) {
      list[existingIndex].download_count = (list[existingIndex].download_count || 1) + 1;
      list[existingIndex].last_downloaded = new Date().toISOString();
    } else {
      const newItem = {
        id: videoId,
        title: videoData.title,
        author: videoData.author,
        cover: videoData.cover,
        video_url: videoData.video_url,
        duration: videoData.duration || 0,
        quality: videoData.quality || 'HD 1080p',
        download_count: 1,
        created_at: new Date().toISOString(),
        product: productInfo
      };
      list.unshift(newItem);
      if (list.length > 100) {
        list = list.slice(0, 100);
      }
    }

    fs.writeFileSync(LIBRARY_DATA_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[LIBRARY WARN] Gagal menyimpan ke library:', err.message);
  }
}

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': DESKTOP_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
  'Referer': 'https://shopee.co.id/'
};

/**
 * Helper: Menyelesaikan URL pendek (id.shp.ee, s.shopee.co.id, universal-link, dsb.) dan redirect Shopee
 */
async function resolveShopeeUrl(inputUrl) {
  let resolvedUrl = inputUrl;
  let finalHtml = '';

  try {
    const resp1 = await axios.get(inputUrl, {
      headers: HEADERS,
      maxRedirects: 10,
      validateStatus: status => status >= 200 && status < 400
    });
    resolvedUrl = resp1.request?.res?.responseUrl || resp1.config.url || inputUrl;
    finalHtml = typeof resp1.data === 'string' ? resp1.data : '';
  } catch (e) {
    console.warn('[RESOLVE WARN] Redirect error:', e.message);
  }

  // Cek jika terdapat parameter 'redir' di query string (misal universal-link Shopee)
  try {
    const parsed = new URL(resolvedUrl);
    const redir = parsed.searchParams.get('redir');
    if (redir) {
      resolvedUrl = decodeURIComponent(redir);
      const resp2 = await axios.get(resolvedUrl, { headers: HEADERS, maxRedirects: 10 });
      resolvedUrl = resp2.request?.res?.responseUrl || resolvedUrl;
      finalHtml = typeof resp2.data === 'string' ? resp2.data : finalHtml;
    }
  } catch (e) {}

  return { resolvedUrl, html: finalHtml };
}

/**
 * Engine 1 (Utama): Ekstraksi Bersih Langsung dari Shopee (Direct Native Engine - No Watermark)
 * Mengambil file master langsung dari CDN Shopee tanpa watermark dan tanpa ketergantungan pihak ketiga.
 */
async function fetchDirectShopeeVideo(inputUrl) {
  const { resolvedUrl, html: initialHtml } = await resolveShopeeUrl(inputUrl);
  console.log('[DIRECT ENGINE] Target URL resolved:', resolvedUrl);

  let targetUrl = resolvedUrl;
  let finalHtml = initialHtml;

  // Jika HTML awal belum memiliki __NEXT_DATA__, lakukan fetch langsung ke targetUrl
  if (!finalHtml || !finalHtml.includes('__NEXT_DATA__')) {
    const resp = await axios.get(targetUrl, {
      headers: HEADERS
    });
    finalHtml = resp.data;
  }

  const $ = cheerio.load(finalHtml);
  const nextDataEl = $('script#__NEXT_DATA__').html();
  if (!nextDataEl) {
    throw new Error('Halaman Shopee tidak memiliki data video');
  }

  const nextData = JSON.parse(nextDataEl);
  const mediaInfo = nextData?.props?.pageProps?.mediaInfo;
  if (!mediaInfo || !mediaInfo.video) {
    throw new Error('Data video Shopee tidak ditemukan pada halaman ini');
  }

  const video = mediaInfo.video;
  const userInfo = mediaInfo.userInfo || {};

  let title = 'Shopee Video';
  if (video.caption) {
    title = video.caption.split('#')[0].trim() || video.caption.trim();
  }

  const author = userInfo.videoUserName || 'Kreator Shopee';
  const coverUrl = video.watermarkCoverUrl || '';
  const watermarkUrl = video.watermarkVideoUrl || '';
  const durationSec = Math.round((video.duration || 0) / 1000);

  // Deteksi domain negara (co.id, sg, vn, ph, my, dll.)
  let domain = 'co.id';
  try {
    const host = new URL(targetUrl).hostname;
    const parts = host.split('.');
    if (parts.length >= 2) {
      domain = parts.slice(-2).join('.');
      if (['shopee.vn', 'shopee.sg', 'shopee.ph', 'shopee.my'].includes(domain)) {
        domain = parts.slice(-1)[0];
      }
    }
  } catch (e) {}

  let cleanVideoUrl = null;
  // Pola media ID Shopee: /mms/(id-xxx)
  const m = watermarkUrl.match(/\/mms\/(id-[a-zA-Z0-9_-]+)/);
  if (m) {
    const fileId = m[1];
    cleanVideoUrl = `https://cv.shopee.${domain}/api/v4/11110124/mms/${fileId}.mp4`;
  } else if (watermarkUrl) {
    cleanVideoUrl = watermarkUrl.replace(/\.\d+\.\d+\.mp4$/, '.mp4');
  }

  // Verifikasi ketersediaan link clean master tanpa watermark dengan HEAD request
  let verifiedUrl = null;
  let fileSizeMB = null;
  if (cleanVideoUrl) {
    try {
      const headCheck = await axios.head(cleanVideoUrl, {
        headers: { 'User-Agent': DESKTOP_UA, 'Referer': 'https://shopee.co.id/' },
        timeout: 6000
      });
      if (headCheck.status === 200) {
        verifiedUrl = cleanVideoUrl;
        const bytes = parseInt(headCheck.headers['content-length'] || '0', 10);
        if (bytes > 0) {
          fileSizeMB = (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        }
      }
    } catch (e) {
      console.warn('[DIRECT ENGINE] Clean URL verification warning:', e.message);
    }
  }

  // Cek ukuran berkas SD terkompresi
  let sdSizeMB = null;
  if (watermarkUrl) {
    try {
      const sdHead = await axios.head(watermarkUrl, {
        headers: { 'User-Agent': DESKTOP_UA, 'Referer': 'https://shopee.co.id/' },
        timeout: 4000
      });
      if (sdHead.status === 200) {
        const bytes = parseInt(sdHead.headers['content-length'] || '0', 10);
        if (bytes > 0) {
          sdSizeMB = (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        }
      }
    } catch (e) {}
  }

  const finalVideoUrl = verifiedUrl || watermarkUrl;
  const isNoWatermark = !!verifiedUrl;

  // Siapkan seluruh opsi unduhan (HD, SD, Audio MP3, Cover HD)
  const streams = {};
  if (verifiedUrl) {
    streams['HD 1080p (No Watermark)'] = {
      label: 'HD 1080p (Tanpa Watermark)',
      url: verifiedUrl,
      quality: 'HD 1080p',
      type: 'video',
      size: fileSizeMB || '',
      no_watermark: true
    };
  }
  if (watermarkUrl) {
    streams['SD Standard'] = {
      label: 'Kualitas Standar (SD)',
      url: watermarkUrl,
      quality: 'SD (Standar)',
      type: 'video',
      size: sdSizeMB || '',
      no_watermark: false
    };
  }
  // Opsi Audio / Musik Saja
  if (finalVideoUrl) {
    streams['Audio MP3'] = {
      label: 'Audio / Musik Saja (MP3)',
      url: watermarkUrl || finalVideoUrl,
      quality: 'Audio MP3',
      type: 'audio',
      size: sdSizeMB ? `~${sdSizeMB}` : '',
      no_watermark: true
    };
  }
  // Opsi Cover Thumbnail HD
  if (coverUrl) {
    streams['Cover HD'] = {
      label: 'Cover / Thumbnail HD',
      url: coverUrl,
      quality: 'Gambar HD',
      type: 'image',
      size: 'JPG HD',
      no_watermark: true
    };
  }

  const productInfo = extractProductInfo(video.caption, title);

  return {
    id: m ? m[1] : `vid-${Date.now()}`,
    title,
    author,
    cover: coverUrl,
    duration: durationSec,
    video_url: finalVideoUrl,
    preview_url: finalVideoUrl,
    quality: isNoWatermark ? 'HD 1080p (No Watermark)' : 'Standard',
    no_watermark: isNoWatermark,
    size: fileSizeMB || '',
    product: productInfo,
    streams
  };
}

/**
 * Engine 2 (Secondary Fallback): Mengambil video via Svxtract API
 */
async function fetchCleanShopeeVideo(shopeeUrl) {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  
  const homeResp = await axios.get('https://svxtract.com/', {
    headers: { 'User-Agent': ua },
    timeout: 5000
  });
  
  const cookies = (homeResp.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const html = homeResp.data;
  const hashes = html.match(/[a-f0-9]{64}/g) || [];
  const csrf = hashes[0] || '';
  
  if (!csrf) {
    throw new Error('Gagal mendapatkan token extractor');
  }

  const apiUrl = `https://svxtract.com/apiv3.php?url=${encodeURIComponent(shopeeUrl)}&csrf_token=${encodeURIComponent(csrf)}`;
  const apiResp = await axios.get(apiUrl, {
    headers: {
      'User-Agent': ua,
      'Referer': 'https://svxtract.com/',
      'Accept': 'application/json',
      'Cookie': cookies
    },
    timeout: 8000
  });

  const data = apiResp.data;
  if (!data || data.error) {
    throw new Error(data?.error || 'Gagal mengekstrak video');
  }

  let bestDownloadUrl = null;
  let downloadQuality = '1280p';
  const maxQualities = ['1280p', '960p', '720P', '640p', '540P', '360P'];
  if (data.stream) {
    for (const q of maxQualities) {
      if (data.stream[q] && data.stream[q].stream) {
        bestDownloadUrl = data.stream[q].stream;
        downloadQuality = q;
        break;
      }
    }
  }

  let previewUrl = null;
  if (data.stream) {
    const h264Qualities = ['960p', '720P', '540P', '360P', '1280p', '640p'];
    for (const q of h264Qualities) {
      if (data.stream[q] && data.stream[q].stream) {
        if (data.stream[q].codec === 'H264' || !previewUrl) {
          previewUrl = data.stream[q].stream;
          if (data.stream[q].codec === 'H264') break;
        }
      }
    }
  }

  if (!bestDownloadUrl && data.preview) bestDownloadUrl = data.preview;
  if (!previewUrl) previewUrl = bestDownloadUrl;

  return {
    title: `Shopee Video @${data.username || 'Kreator Shopee'}`,
    author: data.username || 'Kreator Shopee',
    cover: '',
    video_url: bestDownloadUrl,
    preview_url: previewUrl,
    quality: downloadQuality,
    streams: data.stream || {},
    no_watermark: true
  };
}

/**
 * Endpoint Utama: /api/download?url=...
 */
app.get('/api/download', async (req, res) => {
  try {
    let inputUrl = (req.query.url || '').trim();

    if (!inputUrl) {
      return res.status(400).json({ status: false, message: 'URL tidak boleh kosong!' });
    }

    if (!inputUrl.startsWith('http://') && !inputUrl.startsWith('https://')) {
      inputUrl = 'https://' + inputUrl;
    }

    console.log('[REQUEST] Input URL:', inputUrl);

    // 1. Prioritas Utama: Engine Direct Native (Bersih 100% No Watermark & Anti-Block)
    try {
      const directData = await fetchDirectShopeeVideo(inputUrl);
      if (directData && directData.video_url) {
        console.log('[SUCCESS DIRECT ENGINE] Video Clean diperoleh:', directData.quality);
        saveToLibrary(directData);
        return res.json({
          status: true,
          data: directData
        });
      }
    } catch (directErr) {
      console.warn('[WARN] Direct Engine fallback trigger:', directErr.message);
    }

    // 2. Fallback: Engine Svxtract (jika Direct gagal)
    try {
      const cleanData = await fetchCleanShopeeVideo(inputUrl);
      if (cleanData && cleanData.video_url) {
        console.log('[SUCCESS ENGINE SVXTRACT] Clean Video diperoleh:', cleanData.quality);
        saveToLibrary(cleanData);
        return res.json({
          status: true,
          data: cleanData
        });
      }
    } catch (engineErr) {
      console.warn('[WARN] Svxtract fallback trigger:', engineErr.message);
    }

    return res.status(404).json({
      status: false,
      message: 'Gagal menemukan URL video. Pastikan link yang Anda masukkan adalah tautan Shopee Video yang valid.'
    });

  } catch (error) {
    console.error('[ERROR]', error.message);
    return res.status(500).json({
      status: false,
      message: 'Terjadi kesalahan saat memproses video. Silakan coba kembali.'
    });
  }
});

/**
 * Endpoint Video Library: /api/library
 */
app.get('/api/library', (req, res) => {
  try {
    let list = [];
    if (fs.existsSync(LIBRARY_DATA_PATH)) {
      list = JSON.parse(fs.readFileSync(LIBRARY_DATA_PATH, 'utf-8') || '[]');
    }
    const limit = parseInt(req.query.limit || '24', 10);
    return res.json({
      status: true,
      total: list.length,
      data: list.slice(0, limit)
    });
  } catch (err) {
    return res.status(500).json({ status: false, message: 'Gagal memuat library video.' });
  }
});

/**
 * Endpoint Feed Global: POST /api/library
 * Menerima entri metadata video dari aplikasi VidSaver untuk feed global.
 * Hanya metadata video + kreator Shopee — tanpa identitas user dan tanpa
 * device ID (upload dari aplikasi bersifat anonim, sesuai keputusan pemilik).
 * - Validasi: title dan video_url wajib (string non-kosong), selain itu 400.
 * - Dedup: video_url yang sudah ada hanya menaikkan download_count +
 *   last_downloaded, lewat saveToLibrary (yang juga punya fallback dedup
 *   berdasarkan title). Entri baru ditaruh paling depan.
 * - Kap: daftar dipotong 100 entri terbaru (sama seperti saveToLibrary).
 * - Baca feed memakai GET /api/library yang sudah ada (param limit).
 * CATATAN KEAMANAN (v1): endpoint ini tanpa auth — hanya validasi + dedup.
 * Siapa pun yang tahu URL-nya bisa mengirim entri; itu risiko spam yang
 * diterima sadar di v1 dan perlu API key / rate limit di iterasi berikutnya.
 */
app.post('/api/library', (req, res) => {
  try {
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const videoUrl = typeof body.video_url === 'string' ? body.video_url.trim() : '';
    if (!title || !videoUrl) {
      return res.status(400).json({ status: false, message: 'title dan video_url wajib diisi.' });
    }

    let existing = [];
    if (fs.existsSync(LIBRARY_DATA_PATH)) {
      try { existing = JSON.parse(fs.readFileSync(LIBRARY_DATA_PATH, 'utf-8') || '[]'); } catch (e) { existing = []; }
    }
    const deduped = existing.some(item => item.video_url === videoUrl);

    saveToLibrary({
      title,
      author: typeof body.author === 'string' && body.author.trim() ? body.author.trim() : 'Kreator Shopee',
      cover: typeof body.cover === 'string' ? body.cover : '',
      video_url: videoUrl,
      duration: Number(body.duration) || 0,
      quality: typeof body.quality === 'string' && body.quality ? body.quality : 'HD 1080p'
    });

    return res.json({
      status: true,
      deduped,
      data: { title, video_url: videoUrl }
    });
  } catch (err) {
    console.error('[FEED SUBMIT ERROR]', err.message);
    return res.status(500).json({ status: false, message: 'Gagal menyimpan entri feed.' });
  }
});

/**
 * Helper untuk membersihkan judul agar aman menjadi nama file
 */
function sanitizeFilename(name) {
  if (!name) return 'Shopee_Video_NoWatermark';
  let clean = name.replace(/[<>:"/\\|?*#\x00-\x1F]/g, '').trim();
  clean = clean.replace(/\s+/g, '_');
  if (clean.length > 80) {
    clean = clean.substring(0, 80);
  }
  return clean || 'Shopee_Video_NoWatermark';
}

/**
 * Proxy Stream Endpoint: Menyalurkan video langsung ke user (Bypass CORS, support Range Streaming, dan Force Download)
 */
app.get('/api/proxy', async (req, res) => {
  try {
    const videoUrl = req.query.url;
    const rawTitle = req.query.title || '';
    
    if (!videoUrl) return res.status(400).send('URL video tidak ditemukan');

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://shopee.co.id/',
      'Accept': '*/*'
    };

    // Teruskan Range header untuk kelancaran preview iOS Safari & streaming video
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const response = await axios({
      method: 'get',
      url: videoUrl,
      responseType: 'stream',
      headers: headers,
      validateStatus: (status) => status >= 200 && status < 400
    });

    const fileType = req.query.type || 'video';
    let ext = '.mp4';
    let mimeType = response.headers['content-type'] || 'video/mp4';

    if (fileType === 'audio') {
      ext = '.mp3';
      mimeType = 'audio/mpeg';
    } else if (fileType === 'image') {
      ext = '.jpg';
      mimeType = response.headers['content-type'] || 'image/jpeg';
    }

    const safeTitle = sanitizeFilename(rawTitle);
    const filename = `${safeTitle}${ext}`;

    res.status(response.status);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Accept-Ranges', 'bytes');

    // Jika parameter title ada (tombol download ditekan), jadikan file download (attachment)
    // Jika tidak ada title (video player preview), tampilkan inline
    if (rawTitle) {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    } else {
      res.setHeader('Content-Disposition', 'inline');
    }

    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    }
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    response.data.pipe(res);
  } catch (err) {
    console.error('[PROXY ERROR]', err.message);
    res.status(500).send('Gagal mengunduh video.');
  }
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`✅ Server ShopeeSaver berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;

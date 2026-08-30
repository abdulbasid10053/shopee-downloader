const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
  'Referer': 'https://shopee.co.id/'
};

/**
 * Engine 1: Mengambil video clean langsung tanpa watermark via high-speed API (0 CPU load di VPS)
 */
async function fetchCleanShopeeVideo(shopeeUrl) {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  
  // 1. Ambil session cookie & CSRF token
  const homeResp = await axios.get('https://svxtract.com/', {
    headers: { 'User-Agent': ua }
  });
  
  const cookies = (homeResp.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const html = homeResp.data;
  const hashes = html.match(/[a-f0-9]{64}/g) || [];
  const csrf = hashes[0] || '';
  
  if (!csrf) {
    throw new Error('Gagal mendapatkan token extractor');
  }

  // 2. Request ke API
  const apiUrl = `https://svxtract.com/apiv3.php?url=${encodeURIComponent(shopeeUrl)}&csrf_token=${encodeURIComponent(csrf)}`;
  const apiResp = await axios.get(apiUrl, {
    headers: {
      'User-Agent': ua,
      'Referer': 'https://svxtract.com/',
      'Accept': 'application/json',
      'Cookie': cookies
    }
  });

  const data = apiResp.data;
  if (!data || data.error) {
    throw new Error(data?.error || 'Gagal mengekstrak video');
  }

  // 1. Download URL: Tetap prioritaskan KUALITAS TERTINGGI (1280p / 960p / 720p)
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

  // 2. Preview URL: Khusus web player iOS Safari (prioritaskan codec H264 960p/720p agar pasti bisa diplay)
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
    username: data.username || 'Kreator Shopee',
    streamUrl: bestDownloadUrl,     // Untuk tombol Download Utama (1280p kualitas tertinggi)
    previewUrl: previewUrl,         // Untuk Video Preview Player (H.264 lancar di iOS)
    quality: downloadQuality,
    streams: data.stream || {}
  };
}

/**
 * Engine 2: Fallback Scraper Shopee Langsung (jika Engine 1 kendala)
 */
async function fallbackShopeeScraper(inputUrl) {
  let resolvedUrl = inputUrl;
  try {
    const resp1 = await axios.get(inputUrl, { headers: HEADERS, maxRedirects: 10 });
    if (resp1.request?.res?.responseUrl) {
      resolvedUrl = resp1.request.res.responseUrl;
    }
  } catch (e) {}

  let targetUrl = resolvedUrl;
  try {
    const parsed = new URL(resolvedUrl);
    const redir = parsed.searchParams.get('redir');
    if (redir) targetUrl = decodeURIComponent(redir);
  } catch (e) {}

  const resp = await axios.get(targetUrl, { headers: { ...HEADERS, 'Referer': 'https://shopee.co.id/' } });
  const html = resp.data;
  const $ = cheerio.load(html);

  let videoUrl = null;
  let title = 'Shopee Video';
  let author = 'Kreator Shopee';
  let coverUrl = '';

  const nextDataEl = $('script#__NEXT_DATA__').html();
  if (nextDataEl) {
    try {
      const nextData = JSON.parse(nextDataEl);
      const mediaInfo = nextData?.props?.pageProps?.mediaInfo;
      if (mediaInfo) {
        const video = mediaInfo.video;
        const userInfo = mediaInfo.userInfo;
        if (video?.watermarkVideoUrl) videoUrl = video.watermarkVideoUrl;
        if (video?.caption) title = video.caption.split('#')[0].trim() || title;
        if (userInfo?.videoUserName) author = userInfo.videoUserName;
        if (video?.watermarkCoverUrl) coverUrl = `${video.watermarkCoverUrl}@resize_l500`;
      }
    } catch (e) {}
  }

  return { videoUrl, title, author, coverUrl };
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

    // 1. Coba Engine 1 (Clean No Watermark HD)
    try {
      const cleanData = await fetchCleanShopeeVideo(inputUrl);
      if (cleanData && cleanData.streamUrl) {
        console.log('[SUCCESS ENGINE 1] Clean Video URL diperoleh (No Watermark):', cleanData.quality);
        return res.json({
          status: true,
          data: {
            title: `Shopee Video @${cleanData.username}`,
            author: cleanData.username,
            cover: '',
            video_url: cleanData.streamUrl,
            preview_url: cleanData.previewUrl,
            quality: cleanData.quality,
            streams: cleanData.streams,
            no_watermark: true
          }
        });
      }
    } catch (engine1Err) {
      console.warn('[WARN] Engine 1 fallback trigger:', engine1Err.message);
    }

    // 2. Fallback Engine 2
    const fallbackData = await fallbackShopeeScraper(inputUrl);
    if (!fallbackData.videoUrl) {
      return res.status(404).json({
        status: false,
        message: 'Gagal menemukan URL video. Pastikan link yang Anda masukkan adalah tautan Shopee Video yang valid.'
      });
    }

    return res.json({
      status: true,
      data: {
        title: fallbackData.title,
        author: fallbackData.author,
        cover: fallbackData.coverUrl,
        video_url: fallbackData.videoUrl,
        quality: 'Standard',
        no_watermark: false
      }
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
 * Helper untuk membersihkan judul agar aman menjadi nama file
 */
function sanitizeFilename(name) {
  if (!name) return 'Shopee_Video_NoWatermark';
  // Hapus karakter terlarang untuk nama file di OS (Windows/Linux/Mac)
  let clean = name.replace(/[<>:"/\\|?*#\x00-\x1F]/g, '').trim();
  // Ganti spasi berlebih atau newline
  clean = clean.replace(/\s+/g, '_');
  // Batasi panjang nama file maksimal 80 karakter
  if (clean.length > 80) {
    clean = clean.substring(0, 80);
  }
  return clean || 'Shopee_Video_NoWatermark';
}

/**
 * Proxy Stream Endpoint: Menyalurkan video langsung ke user (Bypass CORS & Force Download dengan nama sesuai judul)
 */
app.get('/api/proxy', async (req, res) => {
  try {
    const videoUrl = req.query.url;
    const rawTitle = req.query.title || 'Shopee_Video_NoWatermark';
    
    if (!videoUrl) return res.status(400).send('URL video tidak ditemukan');

    const response = await axios({
      method: 'get',
      url: videoUrl,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        'Referer': videoUrl.includes('svxtract.com') ? 'https://svxtract.com/' : 'https://sv.shopee.co.id/',
        'Accept': '*/*'
      }
    });

    const safeTitle = sanitizeFilename(rawTitle);
    const filename = `${safeTitle}.mp4`;

    res.setHeader('Content-Type', 'video/mp4');
    // Set filename standar dan RFC 5987 encode untuk karakter UTF-8 / Emoji
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp4"; filename*=UTF-8''${encodeURIComponent(filename)}`);

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

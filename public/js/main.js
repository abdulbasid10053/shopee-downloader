document.addEventListener('DOMContentLoaded', () => {
  const downloadForm = document.getElementById('downloadForm');
  const shopeeUrlInput = document.getElementById('shopeeUrl');
  const btnPaste = document.getElementById('btnPaste');
  const loadingStatus = document.getElementById('loadingStatus');
  const resultCard = document.getElementById('resultCard');
  
  const videoPreview = document.getElementById('videoPreview');
  const videoTitle = document.getElementById('videoTitle');
  const videoAuthor = document.getElementById('videoAuthor');
  const btnDownloadVideo = document.getElementById('btnDownloadVideo');

  const videoPosterWrapper = document.getElementById('videoPosterWrapper');
  const videoCoverImg = document.getElementById('videoCoverImg');
  const btnPlayPreview = document.getElementById('btnPlayPreview');
  const videoDurationBadge = document.getElementById('videoDurationBadge');
  const badgeNoWatermark = document.getElementById('badgeNoWatermark');
  const badgeQuality = document.getElementById('badgeQuality');
  const qualityOptions = document.getElementById('qualityOptions');
  const productAffiliateCard = document.getElementById('productAffiliateCard');
  const productTitle = document.getElementById('productTitle');
  const btnBuyProduct = document.getElementById('btnBuyProduct');
  const libraryContainer = document.getElementById('libraryContainer');

  let currentPreviewUrl = '';
  let activeDownloadUrl = '';
  let activeFilename = 'Shopee_Video_NoWatermark.mp4';

  function formatDuration(sec) {
    if (!sec || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // Handle Play Pratinjau Video On-Demand
  function startVideoPreview() {
    if (!currentPreviewUrl) return;
    videoPosterWrapper.style.display = 'none';
    videoPreview.style.display = 'block';
    videoPreview.src = `/api/proxy?url=${encodeURIComponent(currentPreviewUrl)}`;
    videoPreview.load();
    videoPreview.play().catch(() => {});
  }

  if (videoPosterWrapper) {
    videoPosterWrapper.addEventListener('click', startVideoPreview);
  }
  if (btnPlayPreview) {
    btnPlayPreview.addEventListener('click', (e) => {
      e.stopPropagation();
      startVideoPreview();
    });
  }

  // Paste dari Clipboard
  if (btnPaste) {
    btnPaste.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          shopeeUrlInput.value = text;
        }
      } catch (err) {
        alert('Gagal membaca clipboard. Silakan tempel secara manual.');
      }
    });
  }

  // Handle Submit Form Extractor
  if (downloadForm) {
    downloadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = shopeeUrlInput.value.trim();

      if (!url) {
        alert('Silakan masukkan URL Shopee Video terlebih dahulu!');
        return;
      }

      // Reset & Tampilkan Loading
      resultCard.style.display = 'none';
      videoPreview.pause();
      videoPreview.src = '';
      videoPreview.style.display = 'none';
      if (videoPosterWrapper) videoPosterWrapper.style.display = 'flex';
      loadingStatus.style.display = 'block';

      try {
        const response = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
        const result = await response.json();

        loadingStatus.style.display = 'none';

        if (result.status && result.data) {
          const { title, author, cover, duration, video_url, preview_url, quality, no_watermark, size, streams } = result.data;

          videoTitle.textContent = title || 'Shopee Video';
          videoAuthor.textContent = `Kreator: @${author || 'Kreator Shopee'}`;

          // Badges
          if (badgeNoWatermark) {
            badgeNoWatermark.textContent = no_watermark ? '✨ 100% Tanpa Watermark' : '⚠️ Versi Standar';
            badgeNoWatermark.className = no_watermark ? 'badge badge-success' : 'badge';
          }
          if (badgeQuality) {
            badgeQuality.textContent = quality || 'HD 1080p';
          }

          // Setup Poster & On-Demand Video Preview
          currentPreviewUrl = preview_url || video_url;
          if (cover && videoCoverImg) {
            videoCoverImg.src = cover;
            videoCoverImg.style.display = 'block';
          } else if (videoCoverImg) {
            videoCoverImg.style.display = 'none';
          }

          if (videoDurationBadge) {
            if (duration && duration > 0) {
              videoDurationBadge.textContent = formatDuration(duration);
              videoDurationBadge.style.display = 'block';
            } else {
              videoDurationBadge.style.display = 'none';
            }
          }

          const rawVideoTitle = title || 'Shopee_Video_NoWatermark';
          const cleanFileName = rawVideoTitle.replace(/[<>:"/\\|?*#]/g, '').trim().replace(/\s+/g, '_').substring(0, 80);

          // Siapkan list pilihan kualitas
          const qualityList = [];
          if (streams && Object.keys(streams).length > 0) {
            Object.keys(streams).forEach((k) => {
              qualityList.push({
                key: k,
                ...streams[k]
              });
            });
          } else {
            // Fallback default
            qualityList.push({
              key: 'hd',
              label: 'HD 1080p (Tanpa Watermark)',
              quality: 'HD 1080p',
              url: video_url,
              size: size || '',
              no_watermark: no_watermark
            });
          }

          // Render Kartu Pilihan Kualitas (HD, SD, Audio MP3, Cover HD)
          qualityOptions.innerHTML = '';
          qualityList.forEach((item, idx) => {
            const card = document.createElement('div');
            card.className = `quality-card ${idx === 0 ? 'active' : ''}`;

            let tagClass = '';
            let tagLabel = 'No Watermark';
            if (item.type === 'audio') {
              tagClass = 'tag-audio';
              tagLabel = 'Audio';
            } else if (item.type === 'image') {
              tagClass = 'tag-image';
              tagLabel = 'Gambar';
            } else if (!item.no_watermark) {
              tagClass = 'tag-sd';
              tagLabel = 'Standar';
            }

            let detailText = item.no_watermark ? 'Kualitas Asli Jernih' : 'Ukuran Ringan';
            if (item.type === 'audio') detailText = 'Format MP3 / Suara';
            if (item.type === 'image') detailText = 'Foto Sampul HD';

            card.innerHTML = `
              <div class="quality-header">
                <span class="quality-name">${item.quality || item.label}</span>
                <span class="quality-tag ${tagClass}">${tagLabel}</span>
              </div>
              <div class="quality-detail">
                ${detailText} ${item.size ? `• ${item.size}` : ''}
              </div>
            `;

            card.addEventListener('click', () => {
              document.querySelectorAll('.quality-card').forEach(c => c.classList.remove('active'));
              card.classList.add('active');
              selectQuality(item, cleanFileName);
            });

            qualityOptions.appendChild(card);
          });

          // Pilih kualitas pertama (HD) secara default
          selectQuality(qualityList[0], cleanFileName);

          // Tampilkan Rekomendasi Produk Terkait (Shopee Affiliate)
          if (result.data.product && productAffiliateCard) {
            productTitle.textContent = result.data.product.name || 'Produk Terkait di Shopee';
            btnBuyProduct.href = result.data.product.affiliate_url || result.data.product.search_url;
            productAffiliateCard.style.display = 'flex';
          } else if (productAffiliateCard) {
            productAffiliateCard.style.display = 'none';
          }

          resultCard.style.display = 'block';
          resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

          // Refresh library secara otomatis
          loadVideoLibrary();
        } else {
          alert(result.message || 'Gagal memproses video.');
        }
      } catch (error) {
        loadingStatus.style.display = 'none';
        alert('Terjadi kesalahan jaringan atau server. Pastikan koneksi Anda lancar.');
      }
    });
  }

  function selectQuality(item, baseFileName) {
    activeDownloadUrl = item.url;
    const type = item.type || 'video';
    let tag = 'HD_NoWatermark';
    let ext = 'mp4';
    let btnText = `⬇️ Download HD Tanpa Watermark ${item.size ? `(${item.size})` : ''}`;

    if (type === 'audio') {
      tag = 'Audio';
      ext = 'mp3';
      btnText = `🎵 Download Audio MP3 ${item.size ? `(${item.size})` : ''}`;
    } else if (type === 'image') {
      tag = 'Cover';
      ext = 'jpg';
      btnText = '🖼️ Download Cover Thumbnail HD (JPG)';
    } else if (!item.no_watermark) {
      tag = 'SD';
      btnText = `⬇️ Download Kualitas Standar ${item.size ? `(${item.size})` : ''}`;
    }

    activeFilename = `${baseFileName}_${tag}.${ext}`;

    btnDownloadVideo.href = `/api/proxy?url=${encodeURIComponent(item.url)}&title=${encodeURIComponent(`${baseFileName}_${tag}`)}&type=${type}`;
    btnDownloadVideo.download = activeFilename;
    btnDownloadVideo.innerHTML = btnText;
  }

  // Muat dan Render Koleksi Video Viral Populer (Video Library)
  async function loadVideoLibrary() {
    if (!libraryContainer) return;
    try {
      const res = await fetch('/api/library?limit=12');
      const json = await res.json();
      if (json.status && json.data && json.data.length > 0) {
        libraryContainer.innerHTML = '';
        json.data.forEach(item => {
          const card = document.createElement('div');
          card.className = 'library-card';
          
          const coverImg = item.cover || '/favicon.png';
          const durBadge = item.duration > 0 ? formatDuration(item.duration) : '';
          const prodName = item.product?.name || item.title;
          const buyUrl = item.product?.affiliate_url || item.product?.search_url || 'https://shopee.co.id/';

          card.innerHTML = `
            <div class="library-thumb-wrap">
              <img src="${coverImg}" alt="${item.title}" class="library-thumb-img" loading="lazy">
              <span class="library-badge-clean">✨ 1080p Clean</span>
              ${durBadge ? `<span class="duration-badge">${durBadge}</span>` : ''}
              <div class="library-play-btn">
                <div class="library-play-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
              </div>
            </div>
            <div class="library-info">
              <h4 class="library-title" title="${item.title}">${item.title}</h4>
              <div class="library-creator">@${item.author || 'Kreator Shopee'} • ⬇️ ${item.download_count || 1}x diunduh</div>
              <div class="library-product-box">
                <div class="library-product-name" title="${prodName}">🛍️ ${prodName}</div>
                <a href="${buyUrl}" target="_blank" rel="noopener noreferrer nofollow" class="btn-library-shopee">Cek di Shopee</a>
              </div>
            </div>
          `;

          // Klik thumbnail untuk putar langsung di preview player atas
          const thumbWrap = card.querySelector('.library-thumb-wrap');
          thumbWrap.addEventListener('click', () => {
            currentPreviewUrl = item.video_url;
            videoTitle.textContent = item.title;
            videoAuthor.textContent = `Kreator: @${item.author || 'Shopee'}`;
            if (videoCoverImg) {
              videoCoverImg.src = item.cover;
              videoCoverImg.style.display = 'block';
            }
            if (productAffiliateCard) {
              productTitle.textContent = prodName;
              btnBuyProduct.href = buyUrl;
              productAffiliateCard.style.display = 'flex';
            }
            startVideoPreview();
            resultCard.style.display = 'block';
            window.scrollTo({ top: 0, behavior: 'smooth' });
          });

          libraryContainer.appendChild(card);
        });
      }
    } catch (e) {
      console.warn('Gagal memuat library video:', e.message);
    }
  }

  // Panggil saat halaman pertama kali dibuka
  loadVideoLibrary();

  // FAQ Accordion Handler
  const faqHeaders = document.querySelectorAll('.faq-header');
  faqHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const item = header.parentElement;
      item.classList.toggle('active');
    });
  });
});

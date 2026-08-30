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
  const btnCopyLink = document.getElementById('btnCopyLink');

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
      loadingStatus.style.display = 'block';

      try {
        const response = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
        const result = await response.json();

        loadingStatus.style.display = 'none';

        if (result.status && result.data) {
          const { title, author, video_url, quality, no_watermark, streams } = result.data;

          videoTitle.textContent = title || 'Shopee Video';
          videoAuthor.textContent = `Kreator: @${author || 'Shopee User'}${no_watermark ? ' • ✅ Tanpa Watermark (HD)' : ''}`;
          videoPreview.src = `/api/proxy?url=${encodeURIComponent(video_url)}`;

          const rawVideoTitle = title || 'Shopee_Video_NoWatermark';
          const cleanFileName = rawVideoTitle.replace(/[<>:"/\\|?*#]/g, '').trim().replace(/\s+/g, '_').substring(0, 80);

          // Tombol Download Utama
          btnDownloadVideo.href = `/api/proxy?url=${encodeURIComponent(video_url)}&title=${encodeURIComponent(cleanFileName)}`;
          btnDownloadVideo.download = `${cleanFileName}.mp4`;
          btnDownloadVideo.innerHTML = `⬇️ Download Video HD (No Watermark)`;

          // Render opsi resolusi lain jika tersedia
          let qualityContainer = document.getElementById('qualityContainer');
          if (!qualityContainer) {
            qualityContainer = document.createElement('div');
            qualityContainer.id = 'qualityContainer';
            qualityContainer.style.marginTop = '15px';
            qualityContainer.style.display = 'flex';
            qualityContainer.style.flexWrap = 'wrap';
            qualityContainer.style.gap = '8px';
            btnDownloadVideo.parentElement.after(qualityContainer);
          }
          qualityContainer.innerHTML = '';

          if (streams && Object.keys(streams).length > 0) {
            Object.keys(streams).forEach(q => {
              const item = streams[q];
              if (item.stream) {
                const btnQ = document.createElement('a');
                btnQ.className = 'btn-secondary';
                btnQ.style.fontSize = '0.85rem';
                btnQ.style.padding = '6px 12px';
                btnQ.href = `/api/proxy?url=${encodeURIComponent(item.stream)}&title=${encodeURIComponent(`${cleanFileName}_${q}`)}`;
                btnQ.download = `${cleanFileName}_${q}.mp4`;
                btnQ.textContent = `📥 ${q} (${item.codec || 'MP4'})`;
                qualityContainer.appendChild(btnQ);
              }
            });
          }

          // Tombol Salin Link Direct
          btnCopyLink.onclick = () => {
            navigator.clipboard.writeText(video_url);
            btnCopyLink.textContent = '✅ Link Tersalin!';
            setTimeout(() => { btnCopyLink.textContent = '🔗 Salin Link'; }, 2500);
          };

          resultCard.style.display = 'block';
          resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
          alert(result.message || 'Gagal memproses video.');
        }
      } catch (error) {
        loadingStatus.style.display = 'none';
        alert('Terjadi kesalahan jaringan atau server. Pastikan koneksi Anda lancar.');
      }
    });
  }

  // FAQ Accordion Handler
  const faqHeaders = document.querySelectorAll('.faq-header');
  faqHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const item = header.parentElement;
      item.classList.toggle('active');
    });
  });
});

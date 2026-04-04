// Irene Gipsy Tattoo - Main JS

document.addEventListener('DOMContentLoaded', () => {

    // ── Navbar ──────────────────────────────────────────────────────────────
    const navbar    = document.querySelector('.navbar');
    const navToggle = document.getElementById('navToggle');
    const navMenu   = document.getElementById('navMenu');
    const navLinks  = document.querySelectorAll('.nav-link');

    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
    });

    navToggle.addEventListener('click', () => {
        navMenu.classList.toggle('active');
        const icon = navToggle.querySelector('i');
        icon.classList.toggle('fa-bars', !navMenu.classList.contains('active'));
        icon.classList.toggle('fa-times',  navMenu.classList.contains('active'));
    });

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navMenu.classList.remove('active');
            const icon = navToggle.querySelector('i');
            icon.classList.replace('fa-times', 'fa-bars');
        });
    });

    // ── Filter Gallery (live query — funziona con foto caricate dinamicamente) ─
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filterValue = btn.getAttribute('data-filter');

            // Query live: cattura sempre gli elementi presenti nel DOM al momento del click
            document.querySelectorAll('#galleryGrid .gallery-item').forEach(item => {
                if (filterValue === 'all' || item.classList.contains(filterValue)) {
                    item.style.display = 'block';
                    setTimeout(() => {
                        item.style.opacity   = '1';
                        item.style.transform = 'scale(1)';
                    }, 50);
                } else {
                    item.style.opacity   = '0';
                    item.style.transform = 'scale(0.8)';
                    setTimeout(() => { item.style.display = 'none'; }, 400);
                }
            });
        });
    });

    // ── Gallery: overlay + lightbox (event delegation — funziona con foto dinamiche) ─
    const galleryGrid = document.getElementById('galleryGrid');

    const lightbox = document.createElement('div');
    lightbox.id = 'lightbox';
    document.body.appendChild(lightbox);
    lightbox.addEventListener('click', e => {
        if (e.target === e.currentTarget) lightbox.classList.remove('active');
    });

    let touchStartX = 0, touchStartY = 0, touchMoved = false;

    if (galleryGrid) {
        // Desktop: click su item → overlay; click su img → lightbox
        galleryGrid.addEventListener('click', function (e) {
            if (touchMoved) return;
            const item = e.target.closest('.gallery-item');
            if (!item) return;

            if (e.target.tagName === 'IMG') {
                lightbox.classList.add('active');
                lightbox.innerHTML = '';
                const img = document.createElement('img');
                img.src = e.target.src;
                lightbox.appendChild(img);
                e.stopPropagation();
                return;
            }

            const isActive = item.classList.contains('overlay-active');
            document.querySelectorAll('.gallery-item').forEach(gi => gi.classList.remove('overlay-active'));
            if (!isActive) item.classList.add('overlay-active');
            e.stopPropagation();
        });

        // Mobile: touch tracking
        galleryGrid.addEventListener('touchstart', function (e) {
            touchStartX  = e.touches[0].clientX;
            touchStartY  = e.touches[0].clientY;
            touchMoved   = false;
        }, { passive: true });

        galleryGrid.addEventListener('touchmove', function () {
            touchMoved = true;
        }, { passive: true });

        galleryGrid.addEventListener('touchend', function (e) {
            if (touchMoved) return;
            const item = e.target.closest('.gallery-item');
            if (!item) {
                document.querySelectorAll('.gallery-item').forEach(gi => gi.classList.remove('overlay-active'));
                return;
            }
            const dx = Math.abs(e.changedTouches[0].clientX - touchStartX);
            const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
            if (dx > 10 || dy > 10) return;
            e.preventDefault();
            const isActive = item.classList.contains('overlay-active');
            document.querySelectorAll('.gallery-item').forEach(gi => gi.classList.remove('overlay-active'));
            if (!isActive) item.classList.add('overlay-active');
        });
    }

    // Chiudi overlay cliccando fuori
    document.addEventListener('click', () => {
        document.querySelectorAll('.gallery-item').forEach(item => item.classList.remove('overlay-active'));
    });
    document.addEventListener('touchend', function (e) {
        if (!e.target.closest('.gallery-item')) {
            document.querySelectorAll('.gallery-item').forEach(item => item.classList.remove('overlay-active'));
        }
    }, { passive: true });

    // ── Smooth Scroll ────────────────────────────────────────────────────────
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    // ── Scroll Animations (IntersectionObserver) ─────────────────────────────
    const observerOptions = { threshold: 0.1, rootMargin: '0px 0px -50px 0px' };
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    function observeAnimated(root) {
        (root || document).querySelectorAll('.fade-in, .fade-in-up, .fade-in-left, .fade-in-right').forEach(el => observer.observe(el));
    }
    observeAnimated();

    // ── Reviews Carousel ─────────────────────────────────────────────────────
    function initReviewsCarousel() {
        const track = document.getElementById('reviewsTrack');
        const dotsContainer = document.getElementById('reviewsDots');
        if (!track) return;

        const cards = Array.from(track.querySelectorAll('.review-card'));
        const prevBtn = track.closest('.reviews-carousel')?.querySelector('.reviews-prev');
        const nextBtn = track.closest('.reviews-carousel')?.querySelector('.reviews-next');
        let currentIndex = 0;

        if (dotsContainer) {
            dotsContainer.innerHTML = '';
            cards.forEach((_, i) => {
                const dot = document.createElement('button');
                dot.className = 'reviews-dot' + (i === 0 ? ' active' : '');
                dot.setAttribute('aria-label', `Recensione ${i + 1}`);
                dot.addEventListener('click', () => scrollToCard(i));
                dotsContainer.appendChild(dot);
            });
        }

        function getVisibleCount() {
            if (window.innerWidth <= 600) return 1;
            if (window.innerWidth <= 900) return 2;
            return 3;
        }

        function scrollToCard(index) {
            const visibleCount = getVisibleCount();
            const maxIndex = Math.max(0, cards.length - visibleCount);
            currentIndex = Math.max(0, Math.min(index, maxIndex));
            const cardWidth = cards[0].offsetWidth + 20;
            track.scrollTo({ left: currentIndex * cardWidth, behavior: 'smooth' });
            updateDots();
            updateButtons();
        }

        function updateDots() {
            if (!dotsContainer) return;
            const visibleCount = getVisibleCount();
            const maxIndex = Math.max(0, cards.length - visibleCount);
            Array.from(dotsContainer.querySelectorAll('.reviews-dot')).forEach((dot, i) => {
                dot.classList.toggle('active', i === currentIndex || (currentIndex >= maxIndex && i === maxIndex));
            });
        }

        function updateButtons() {
            const visibleCount = getVisibleCount();
            const maxIndex = Math.max(0, cards.length - visibleCount);
            if (prevBtn) prevBtn.disabled = currentIndex <= 0;
            if (nextBtn) nextBtn.disabled = currentIndex >= maxIndex;
        }

        if (prevBtn) prevBtn.addEventListener('click', () => scrollToCard(currentIndex - 1));
        if (nextBtn) nextBtn.addEventListener('click', () => scrollToCard(currentIndex + 1));

        track.addEventListener('scroll', () => {
            const cardWidth = cards[0] ? cards[0].offsetWidth + 20 : 1;
            currentIndex = Math.round(track.scrollLeft / cardWidth);
            updateDots();
            updateButtons();
        }, { passive: true });

        updateButtons();
        window.addEventListener('resize', () => { updateButtons(); updateDots(); });
    }

    initReviewsCarousel();

    // ── Mobile Scroll Zoom ───────────────────────────────────────────────────
    // Usa container.children (live HTMLCollection) — funziona con item aggiunti dopo il load
    function initScrollZoom() {
        if (window.innerWidth > 768) return;

        document.querySelectorAll('.masonry-grid, .bts-grid, .reviews-track, .aftercare-grid, .process-grid').forEach(container => {
            if (container.dataset.zoomBound) {
                // Già inizializzato: triggera solo l'aggiornamento iniziale sui nuovi item
                setTimeout(() => container._updateZoom?.(), 150);
                return;
            }

            function updateZoom() {
                const containerRect   = container.getBoundingClientRect();
                const containerCenter = containerRect.left + containerRect.width / 2;
                Array.from(container.children).forEach(item => {
                    const itemRect   = item.getBoundingClientRect();
                    const itemCenter = itemRect.left + itemRect.width / 2;
                    const distance   = Math.abs(containerCenter - itemCenter);
                    const maxDistance = containerRect.width * 0.5;
                    const progress   = Math.min(distance / maxDistance, 1);
                    const scale      = 1 - (progress * 0.12);
                    const shadowOpacity = Math.max(0, 1 - progress * 1.5);
                    item.style.transform = `scale(${scale})`;
                    item.style.boxShadow = shadowOpacity > 0.1
                        ? `0 ${20 * shadowOpacity}px ${50 * shadowOpacity}px rgba(0,0,0,${0.6 * shadowOpacity}), 0 ${8 * shadowOpacity}px ${25 * shadowOpacity}px rgba(212,175,55,${0.2 * shadowOpacity}), 0 0 ${30 * shadowOpacity}px rgba(212,175,55,${0.08 * shadowOpacity})`
                        : 'none';
                });
            }

            container.addEventListener('scroll', updateZoom, { passive: true });
            container.dataset.zoomBound = '1';
            container._updateZoom = updateZoom;
            setTimeout(updateZoom, 100);
        });
    }

    initScrollZoom();
    window.addEventListener('resize', initScrollZoom);

    // ── Frecce scroll ────────────────────────────────────────────────────────
    function initScrollArrows(grid, itemSelector) {
        if (window.innerWidth > 768) return;
        if (!grid) return;

        const wrap = grid.closest('.gallery-scroll-wrap');
        if (!wrap) return;

        const arrowLeft  = wrap.querySelector('.gallery-arrow-left');
        const arrowRight = wrap.querySelector('.gallery-arrow-right');
        if (!arrowLeft || !arrowRight) return;

        function update() {
            // Query live: aggiornata ogni volta che viene chiamata
            const items = Array.from(grid.querySelectorAll(itemSelector));
            if (items.length === 0) { arrowLeft.style.opacity = '0'; arrowRight.style.opacity = '0'; return; }

            const cRect   = grid.getBoundingClientRect();
            const cCenter = cRect.left + cRect.width / 2;
            let minDist = Infinity, centeredIdx = 0;

            items.forEach((item, i) => {
                const iRect = item.getBoundingClientRect();
                const dist  = Math.abs(cCenter - (iRect.left + iRect.width / 2));
                if (dist < minDist) { minDist = dist; centeredIdx = i; }
            });

            const progress = Math.min(minDist / (cRect.width * 0.4), 1);
            const opacity  = Math.max(0, 1 - progress * 3).toFixed(2);
            arrowLeft.style.opacity  = centeredIdx === 0 ? '0' : opacity;
            arrowRight.style.opacity = centeredIdx === items.length - 1 ? '0' : opacity;
        }

        if (!grid.dataset.arrowBound) {
            grid.addEventListener('scroll', update, { passive: true });
            grid.dataset.arrowBound = '1';
        }
        setTimeout(update, 150);
    }

    function initAllScrollArrows() {
        initScrollArrows(document.getElementById('galleryGrid'), '.gallery-item');
        initScrollArrows(document.querySelector('.bts-grid'), '.bts-item');
    }

    initAllScrollArrows();
    window.addEventListener('resize', initAllScrollArrows);

    // ── Portfolio: caricamento da Supabase ───────────────────────────────────
    async function loadPortfolio() {
        const galleryGrid = document.getElementById('galleryGrid');
        const btsGrid     = document.getElementById('btsGrid');
        if (!galleryGrid && !btsGrid) return;

        try {
            const { data, error } = await db
                .from('portfolio_gallery')
                .select('id, storage_path, title, description, categories, gallery_type')
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: false });

            if (error) throw error;

            const tatuaggi = (data || []).filter(i => i.gallery_type !== 'al_lavoro');
            const alLavoro = (data || []).filter(i => i.gallery_type === 'al_lavoro');

            // Griglia tatuaggi
            if (galleryGrid) {
                if (tatuaggi.length === 0) {
                    galleryGrid.innerHTML = '<p class="gallery-empty">Portfolio in aggiornamento, torna presto.</p>';
                } else {
                    galleryGrid.innerHTML = tatuaggi.map(item => {
                        const { data: urlData } = db.storage.from('portfolio-gallery').getPublicUrl(item.storage_path);
                        const cats  = (item.categories || []).join(' ');
                        const title = item.title || '';
                        const desc  = item.description || '';
                        return `<div class="gallery-item ${cats} fade-in-up">
                            <img src="${urlData.publicUrl}" alt="${title}" loading="lazy">
                            <div class="gallery-overlay">
                                <h3>${title}</h3>
                                <p>${desc}</p>
                            </div>
                        </div>`;
                    }).join('');
                    observeAnimated(galleryGrid);
                }
            }

            // Griglia "Al Lavoro"
            if (btsGrid) {
                if (alLavoro.length === 0) {
                    btsGrid.innerHTML = '<p class="gallery-empty"></p>';
                } else {
                    btsGrid.innerHTML = alLavoro.map(item => {
                        const { data: urlData } = db.storage.from('portfolio-gallery').getPublicUrl(item.storage_path);
                        return `<div class="bts-item fade-in">
                            <img src="${urlData.publicUrl}" alt="${item.title || 'Irene al lavoro'}" loading="lazy">
                        </div>`;
                    }).join('');
                    observeAnimated(btsGrid);
                }
            }

            // Re-inizializza zoom e frecce sui nuovi elementi
            initScrollZoom();
            initAllScrollArrows();

        } catch (err) {
            console.error('Errore caricamento portfolio:', err);
            if (galleryGrid) galleryGrid.innerHTML = '<p class="gallery-empty">Portfolio momentaneamente non disponibile.</p>';
            if (btsGrid)     btsGrid.innerHTML     = '';
        }
    }

    loadPortfolio();

});

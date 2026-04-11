/* ═══════════════════════════════════════════════════════════════
   Irene Gipsy Tattoo — Premium Animations (Public Site)
   Features: #1 Hero text, #2 Lenis, #3 Parallax, #4 Cursor,
             #5 Tilt, #6 Navbar blur, #7 Skeleton, #8 Ripple,
             #9 Dividers, #10 Reviews depth
   ═══════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // Wait for DOM
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        initLenis();           // #2
        initHeroTextReveal();  // #1
        initParallax();        // #3
        initCustomCursor();    // #4
        initGalleryTilt();     // #5
        initNavbarBlur();      // #6
        initSkeletons();       // #7
        initButtonRipple();    // #8
        initSectionDividers(); // #9
        initReviewsDepth();    // #10
    }

    /* ── #2 Lenis Smooth Scroll ──────────────────────────────── */
    function initLenis() {
        if (typeof Lenis === 'undefined') return;
        // Skip on mobile — no smooth wheel needed on touch devices
        if (window.innerWidth < 769) return;

        var lenis = new Lenis({
            duration: 1.15,
            easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
            smoothWheel: true,
            smoothTouch: false
        });

        // Store globally so other scripts can access
        window.__lenis = lenis;

        function raf(time) {
            lenis.raf(time);
            requestAnimationFrame(raf);
        }
        requestAnimationFrame(raf);

        // Disable CSS scroll-behavior so Lenis handles all scrolling
        document.documentElement.style.scrollBehavior = 'auto';
    }

    /* ── #1 Hero Text Reveal (word by word) ──────────────────── */
    function initHeroTextReveal() {
        var heroH1 = document.querySelector('.hero h1');
        var heroH2 = document.querySelector('.hero h2');
        var heroP = document.querySelector('.hero p');

        if (!heroH1) return;

        // Split text into words wrapped in spans
        function splitWords(el) {
            if (!el) return [];
            var html = el.innerHTML;
            // Preserve existing spans (like .hero-gipsy)
            var tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;

            var words = [];
            var newHTML = '';

            tempDiv.childNodes.forEach(function (node) {
                if (node.nodeType === 3) {
                    // Text node — split by spaces
                    var parts = node.textContent.split(/(\s+)/);
                    parts.forEach(function (part) {
                        if (part.trim() === '') {
                            newHTML += part;
                        } else {
                            newHTML += '<span class="word"><span class="word-inner">' + part + '</span></span>';
                            words.push(null); // placeholder
                        }
                    });
                } else if (node.nodeType === 1) {
                    // Element node (like <span class="hero-gipsy">)
                    newHTML += '<span class="word"><span class="word-inner">' + node.outerHTML + '</span></span>';
                    words.push(null);
                }
            });

            el.innerHTML = newHTML;
            return el.querySelectorAll('.word-inner');
        }

        // Remove fade-in classes to avoid double animation
        [heroH1, heroH2, heroP].forEach(function (el) {
            if (el) {
                el.classList.remove('fade-in', 'delay-1', 'delay-2');
                el.style.opacity = '1';
                el.style.transform = 'none';
            }
        });

        // Also handle the CTA group
        var ctaGroup = document.querySelector('.hero .cta-group');
        if (ctaGroup) {
            ctaGroup.classList.remove('fade-in', 'delay-3');
            ctaGroup.style.opacity = '0';
            ctaGroup.style.transform = 'translateY(20px)';
            ctaGroup.style.transition = 'opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1)';
        }

        var h1Words = splitWords(heroH1);
        var h2Words = splitWords(heroH2);
        var pWords = splitWords(heroP);

        // Stagger reveal
        var delay = 200; // initial delay
        var stagger = 70;

        function revealWords(wordEls, startDelay) {
            wordEls.forEach(function (w, i) {
                setTimeout(function () {
                    w.classList.add('revealed');
                }, startDelay + i * stagger);
            });
            return startDelay + wordEls.length * stagger;
        }

        var nextDelay = revealWords(h1Words, delay);
        nextDelay = revealWords(h2Words, nextDelay + 150);
        nextDelay = revealWords(pWords, nextDelay + 100);

        // Reveal CTA group after text
        if (ctaGroup) {
            setTimeout(function () {
                ctaGroup.style.opacity = '1';
                ctaGroup.style.transform = 'translateY(0)';
            }, nextDelay + 150);
        }
    }

    /* ── #3 Parallax Effect on Hero ──────────────────────────── */
    function initParallax() {
        var heroBg = document.querySelector('.hero-bg');
        if (!heroBg) return;

        // Only on desktop (parallax on mobile is janky)
        if (window.innerWidth < 769) return;

        heroBg.classList.add('parallax-active');

        var ticking = false;
        window.addEventListener('scroll', function () {
            if (!ticking) {
                requestAnimationFrame(function () {
                    var scrolled = window.pageYOffset;
                    if (scrolled < window.innerHeight * 1.5) {
                        heroBg.style.transform = 'translate3d(0, ' + (scrolled * 0.35) + 'px, 0)';
                    }
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });
    }

    /* ── #4 Custom Cursor (desktop only) ─────────────────────── */
    function initCustomCursor() {
        // Skip on touch devices
        if (window.matchMedia('(hover: none)').matches || window.innerWidth < 1025) return;

        var cursor = document.createElement('div');
        cursor.className = 'custom-cursor';
        var dot = document.createElement('div');
        dot.className = 'custom-cursor-dot';
        document.body.appendChild(cursor);
        document.body.appendChild(dot);

        var mouseX = 0, mouseY = 0;
        var cursorX = 0, cursorY = 0;

        document.addEventListener('mousemove', function (e) {
            mouseX = e.clientX;
            mouseY = e.clientY;
            // Dot follows instantly
            dot.style.left = mouseX + 'px';
            dot.style.top = mouseY + 'px';
        });

        // Lerp for smooth cursor follow
        function updateCursor() {
            cursorX += (mouseX - cursorX) * 0.15;
            cursorY += (mouseY - cursorY) * 0.15;
            cursor.style.left = cursorX + 'px';
            cursor.style.top = cursorY + 'px';
            requestAnimationFrame(updateCursor);
        }
        requestAnimationFrame(updateCursor);

        // Hover detection
        var hoverTargets = 'a, button, .btn, .filter-btn, .gallery-item, .process-step, .nav-toggle, .reviews-nav, input, textarea, select';
        document.addEventListener('mouseover', function (e) {
            if (e.target.closest(hoverTargets)) {
                cursor.classList.add('hovering');
            }
        });
        document.addEventListener('mouseout', function (e) {
            if (e.target.closest(hoverTargets)) {
                cursor.classList.remove('hovering');
            }
        });

        // Hide default cursor globally
        document.documentElement.style.cursor = 'none';
        var cursorStyle = document.createElement('style');
        cursorStyle.textContent = 'a, button, input, textarea, select, [role="button"], .btn, .filter-btn, .gallery-item, .process-step, .nav-toggle { cursor: none !important; }';
        document.head.appendChild(cursorStyle);
    }

    /* ── #5 Gallery 3D Tilt on Hover ─────────────────────────── */
    function initGalleryTilt() {
        if (window.innerWidth < 769) return;

        var grid = document.getElementById('galleryGrid');
        if (!grid) return;

        grid.addEventListener('mousemove', function (e) {
            var item = e.target.closest('.gallery-item');
            if (!item) return;

            var rect = item.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            var centerX = rect.width / 2;
            var centerY = rect.height / 2;

            var rotateX = ((y - centerY) / centerY) * -6;
            var rotateY = ((x - centerX) / centerX) * 6;

            item.style.transform = 'perspective(800px) rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg) scale(1.02)';
            item.classList.add('tilt-active');
        });

        // Reset all tilts when mouse leaves the grid
        grid.addEventListener('mouseleave', function () {
            grid.querySelectorAll('.gallery-item').forEach(function (item) {
                item.style.transform = '';
                item.classList.remove('tilt-active');
            });
        });
    }

    /* ── #6 Navbar Progressive Blur ──────────────────────────── */
    function initNavbarBlur() {
        var navbar = document.querySelector('.navbar');
        if (!navbar) return;

        var ticking = false;
        window.addEventListener('scroll', function () {
            if (!ticking) {
                requestAnimationFrame(function () {
                    var scrollY = window.pageYOffset;
                    var progress = Math.min(scrollY / 200, 1);
                    var blur = Math.round(progress * 12);
                    navbar.style.backdropFilter = 'blur(' + blur + 'px)';
                    navbar.style.webkitBackdropFilter = 'blur(' + blur + 'px)';

                    // Progressive navbar height reduction
                    var padding = 20 - (progress * 5);
                    navbar.style.padding = padding + 'px 0';
                    ticking = false;
                });
                ticking = true;
            }
        }, { passive: true });
    }

    /* ── #7 Skeleton Loading for Portfolio ────────────────────── */
    function initSkeletons() {
        var galleryGrid = document.getElementById('galleryGrid');
        var btsGrid = document.getElementById('btsGrid');

        function addSkeletons(grid, count) {
            if (!grid) return;
            var loading = grid.querySelector('.gallery-loading');
            if (!loading) return;

            var isMobile = window.innerWidth <= 768;
            var skeletonCount = isMobile ? 3 : count;

            var skeletonWrap = document.createElement('div');
            skeletonWrap.className = 'gallery-skeleton';
            skeletonWrap.style.gridColumn = '1 / -1';

            for (var i = 0; i < skeletonCount; i++) {
                var sk = document.createElement('div');
                sk.className = 'skeleton-item';
                skeletonWrap.appendChild(sk);
            }

            loading.innerHTML = '';
            loading.appendChild(skeletonWrap);
            loading.style.padding = '0';
        }

        addSkeletons(galleryGrid, 6);
        addSkeletons(btsGrid, 4);
    }

    /* ── #8 Button Ripple Effect ─────────────────────────────── */
    function initButtonRipple() {
        document.addEventListener('click', function (e) {
            var btn = e.target.closest('.btn, .filter-btn');
            if (!btn) return;

            var rect = btn.getBoundingClientRect();
            var ripple = document.createElement('span');
            ripple.className = 'ripple';
            var size = Math.max(rect.width, rect.height);
            ripple.style.width = size + 'px';
            ripple.style.height = size + 'px';
            ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
            ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
            btn.appendChild(ripple);
            setTimeout(function () { ripple.remove(); }, 650);
        });
    }

    /* ── #9 Section Dividers ─────────────────────────────────── */
    function initSectionDividers() {
        var sections = document.querySelectorAll('.section-padding');
        sections.forEach(function (section, i) {
            if (i === 0) return; // Skip first section
            var divider = document.createElement('div');
            divider.className = 'section-divider';
            section.parentNode.insertBefore(divider, section);
        });

        // Observe dividers
        var dividerObs = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    dividerObs.unobserve(entry.target);
                }
            });
        }, { threshold: 0.5 });

        document.querySelectorAll('.section-divider').forEach(function (d) {
            dividerObs.observe(d);
        });
    }

    /* ── #10 Reviews Depth Effect ────────────────────────────── */
    function initReviewsDepth() {
        var track = document.getElementById('reviewsTrack');
        if (!track) return;
        if (window.innerWidth <= 600) return;

        function updateDepth() {
            var cards = track.querySelectorAll('.review-card');
            var trackRect = track.getBoundingClientRect();
            var center = trackRect.left + trackRect.width / 2;

            cards.forEach(function (card) {
                var cardRect = card.getBoundingClientRect();
                var cardCenter = cardRect.left + cardRect.width / 2;
                var distance = Math.abs(center - cardCenter);
                var threshold = cardRect.width * 0.8;

                if (distance < threshold) {
                    card.classList.add('review-active');
                    card.classList.remove('review-dimmed');
                } else {
                    card.classList.remove('review-active');
                    card.classList.add('review-dimmed');
                }
            });
        }

        track.addEventListener('scroll', updateDepth, { passive: true });
        window.addEventListener('resize', updateDepth);
        // Initial
        setTimeout(updateDepth, 300);
    }

})();

/* ═══════════════════════════════════════════════════════════════
   Irene Gipsy Tattoo — Dashboard Visual Enhancements
   Features: #11 Tab transitions, #12 Journey stagger,
             #13 Card hover, #14 Calendar ripple,
             #15 Toast spring, #16 Gallery stagger,
             #17 Badge pulse, #18 Skeleton loading
   ═══════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    /* ── Inject animation CSS ────────────────────────────────── */
    var css = [
        /* #11 Tab panel fade-in on switch (only during transition) */
        '@keyframes tabFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }',
        '.tab-panel.tab-animate { animation: tabFadeIn 0.4s cubic-bezier(0.16,1,0.3,1) both; }',

        /* #12 Journey timeline stagger */
        '.journey-step { opacity: 0; transform: translateY(18px); transition: opacity 0.6s cubic-bezier(0.16,1,0.3,1), transform 0.6s cubic-bezier(0.16,1,0.3,1); }',
        '.journey-step.j-visible { opacity: 1; transform: translateY(0); }',

        /* #13 Card hover/press feedback */
        '.journey-body, .profile-card { transition: transform 0.25s cubic-bezier(0.16,1,0.3,1), box-shadow 0.25s ease !important; }',
        '@media (hover: hover) { .journey-body:hover, .profile-card:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(212,175,55,0.08) !important; } }',
        '.journey-body:active, .profile-card:active { transform: scale(0.985); }',

        /* #14 Calendar day ripple */
        '.rsch-day.avail { position: relative; overflow: hidden; }',
        '.rsch-day .day-ripple { position: absolute; border-radius: 50%; background: rgba(212,175,55,0.2); transform: scale(0); animation: dayRipple 0.5s ease-out forwards; pointer-events: none; }',
        '@keyframes dayRipple { to { transform: scale(3); opacity: 0; } }',

        /* #15 Toast spring animation */
        '@keyframes toastSpring { 0% { opacity: 0; transform: translateY(20px) scale(0.95); } 50% { transform: translateY(-4px) scale(1.02); } 100% { opacity: 1; transform: translateY(0) scale(1); } }',
        '.toast.toast-spring { animation: toastSpring 0.5s cubic-bezier(0.16,1,0.3,1) forwards !important; }',
        '.toast-progress { position: absolute; bottom: 0; left: 0; height: 2px; background: var(--gold); border-radius: 0 0 10px 10px; transition: width linear; }',

        /* #16 Gallery grid stagger */
        '.gallery-thumb.g-stagger { opacity: 0; transform: scale(0.92); transition: opacity 0.5s cubic-bezier(0.16,1,0.3,1), transform 0.5s cubic-bezier(0.16,1,0.3,1); }',
        '.gallery-thumb.g-visible { opacity: 1; transform: scale(1); }',

        /* #17 Badge pulse for pending */
        '@keyframes badgePulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(251,188,5,0.3); } 50% { box-shadow: 0 0 0 6px rgba(251,188,5,0); } }',
        '.badge-pending { animation: badgePulse 2.5s ease-in-out infinite; }',

        /* #18 Skeleton loading */
        '.dash-skeleton { background: var(--bg-card); border-radius: 12px; overflow: hidden; position: relative; border: 1px solid var(--border); }',
        '.dash-skeleton::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 0%, rgba(212,175,55,0.04) 40%, rgba(212,175,55,0.08) 50%, rgba(212,175,55,0.04) 60%, transparent 100%); animation: dashShimmer 1.8s infinite; }',
        '@keyframes dashShimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }',
        '.dash-skeleton-row { display: flex; flex-direction: column; gap: 12px; }',
        '.dash-skeleton-item { height: 80px; }'
    ].join('\n');

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    document.addEventListener('DOMContentLoaded', function () {
        initTabTransitions();    // #11
        initJourneyStagger();    // #12
        initCalendarRipple();    // #14
        enhanceToasts();         // #15
        initGalleryStagger();    // #16
        // #13 Card hover, #17 Badge pulse — handled by CSS above
    });

    /* ── #11 Tab Panel Transitions ───────────────────────────── */
    function initTabTransitions() {
        var tabBtns = document.querySelectorAll('.tab-btn');
        if (tabBtns.length === 0) return;

        // Animate on initial load
        setTimeout(function () {
            var activePanel = document.querySelector('.tab-panel.active');
            if (activePanel) {
                activePanel.classList.add('tab-animate');
                animateJourneySteps(activePanel);
            }
        }, 100);

        tabBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                // Wait for dashboard.js to toggle .active
                setTimeout(function () {
                    // Remove animation from all panels
                    document.querySelectorAll('.tab-panel').forEach(function (p) {
                        p.classList.remove('tab-animate');
                    });

                    var activePanel = document.querySelector('.tab-panel.active');
                    if (activePanel) {
                        // Trigger reflow then animate in
                        void activePanel.offsetHeight;
                        activePanel.classList.add('tab-animate');

                        // Re-trigger content animations
                        if (activePanel.id === 'panel-appointments') {
                            animateJourneySteps(activePanel);
                        }
                        if (activePanel.id === 'panel-gallery') {
                            animateGalleryThumbs(activePanel);
                        }
                    }
                }, 30);
            });
        });
    }

    /* ── #12 Journey Timeline Stagger ────────────────────────── */
    function initJourneyStagger() {
        // Observe mutations for dynamically added journey steps
        var observer = new MutationObserver(function (mutations) {
            var hasNewNodes = false;
            mutations.forEach(function (m) {
                if (m.addedNodes.length > 0) hasNewNodes = true;
            });
            if (hasNewNodes) {
                var panel = document.getElementById('panel-appointments');
                if (panel && panel.classList.contains('active')) {
                    setTimeout(function () { animateJourneySteps(panel); }, 100);
                }
            }
        });

        var panel = document.getElementById('panel-appointments');
        if (panel) {
            observer.observe(panel, { childList: true, subtree: true });
        }
    }

    function animateJourneySteps(container) {
        if (!container) return;
        var steps = container.querySelectorAll('.journey-step');
        steps.forEach(function (step, i) {
            step.classList.remove('j-visible');
            void step.offsetHeight;
            setTimeout(function () {
                step.classList.add('j-visible');
            }, 80 + i * 120);
        });
    }

    /* ── #14 Calendar Day Ripple ─────────────────────────────── */
    function initCalendarRipple() {
        document.addEventListener('click', function (e) {
            var day = e.target.closest('.rsch-day.avail');
            if (!day) return;

            var rect = day.getBoundingClientRect();
            var ripple = document.createElement('span');
            ripple.className = 'day-ripple';
            var size = Math.max(rect.width, rect.height);
            ripple.style.width = size + 'px';
            ripple.style.height = size + 'px';
            ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
            ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
            day.appendChild(ripple);
            setTimeout(function () { ripple.remove(); }, 550);
        });
    }

    /* ── #15 Enhanced Toast Notifications ─────────────────────── */
    function enhanceToasts() {
        // Monkey-patch showToast: signature is showToast(msg, isError)
        var origShowToast = window.showToast;
        if (typeof origShowToast === 'function') {
            window.showToast = function (msg, isError) {
                origShowToast(msg, isError);
                // Enhance the existing #toast element
                var toast = document.getElementById('toast');
                if (!toast) return;

                toast.classList.add('toast-spring');

                // Remove old progress bar if present
                var oldBar = toast.querySelector('.toast-progress');
                if (oldBar) oldBar.remove();

                // Add progress bar (matches the 3500ms timeout in dashboard.js)
                var bar = document.createElement('div');
                bar.className = 'toast-progress';
                bar.style.width = '100%';
                toast.style.position = 'relative';
                toast.style.overflow = 'hidden';
                toast.appendChild(bar);
                requestAnimationFrame(function () {
                    bar.style.width = '0%';
                    bar.style.transitionDuration = '3500ms';
                });
            };
        }
    }

    /* ── #16 Gallery Grid Stagger ────────────────────────────── */
    function initGalleryStagger() {
        var observer = new MutationObserver(function (mutations) {
            var hasNewNodes = false;
            mutations.forEach(function (m) {
                if (m.addedNodes.length > 0) hasNewNodes = true;
            });
            if (hasNewNodes) {
                var panel = document.getElementById('panel-gallery');
                if (panel && panel.classList.contains('active')) {
                    setTimeout(function () { animateGalleryThumbs(panel); }, 50);
                }
            }
        });

        var galleryGrid = document.getElementById('userGallery') || document.querySelector('.gallery-grid');
        if (galleryGrid) {
            observer.observe(galleryGrid, { childList: true });
        }
    }

    function animateGalleryThumbs(container) {
        if (!container) return;
        var thumbs = container.querySelectorAll('.gallery-thumb');
        thumbs.forEach(function (thumb, i) {
            thumb.classList.add('g-stagger');
            thumb.classList.remove('g-visible');
            void thumb.offsetHeight;
            setTimeout(function () {
                thumb.classList.add('g-visible');
            }, 50 + i * 60);
        });
    }

})();

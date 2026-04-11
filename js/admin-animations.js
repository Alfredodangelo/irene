/* ═══════════════════════════════════════════════════════════════
   Irene Gipsy Tattoo — Admin Dashboard Visual Enhancements
   Features: #19 Section transitions, #20 Stats count-up,
             #21 Funnel animation, #22 Chat bubble animations
   ═══════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    /* ── Inject animation CSS ────────────────────────────────── */
    var css = [
        /* #19 Section transitions */
        '@keyframes admSectionIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }',
        '.admin-section.adm-animate { animation: admSectionIn 0.35s cubic-bezier(0.16,1,0.3,1) both; }',

        /* #20 Stats count-up */
        '.stat-value { font-variant-numeric: tabular-nums; }',

        /* #21 Funnel bars */
        '.funnel-bar.f-animate { transition: width 0.8s cubic-bezier(0.16,1,0.3,1) !important; }',

        /* #22 Chat bubble animations */
        '@keyframes chatBubbleIn { 0% { opacity: 0; transform: translateY(8px) scale(0.96); } 100% { opacity: 1; transform: translateY(0) scale(1); } }',
        '.aa-msg { animation: chatBubbleIn 0.35s cubic-bezier(0.16,1,0.3,1) both; }',
        '.aa-typing-indicator { display: inline-flex; gap: 4px; padding: 10px 16px; }',
        '.aa-typing-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(212,175,55,0.5); animation: typingBounce 1.4s infinite; }',
        '.aa-typing-dot:nth-child(2) { animation-delay: 0.2s; }',
        '.aa-typing-dot:nth-child(3) { animation-delay: 0.4s; }',
        '@keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-6px); opacity: 1; } }',

        /* Card hover for admin cards */
        '@media (hover: hover) { .admin-card:hover, .stat-card:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,0,0,0.25) !important; } }',
        '.admin-card, .stat-card { transition: transform 0.25s cubic-bezier(0.16,1,0.3,1), box-shadow 0.25s ease !important; }',

        /* Upcoming items stagger */
        '.upcoming-item { opacity: 0; transform: translateX(-10px); transition: opacity 0.4s cubic-bezier(0.16,1,0.3,1), transform 0.4s cubic-bezier(0.16,1,0.3,1); }',
        '.upcoming-item.up-visible { opacity: 1; transform: translateX(0); }'
    ].join('\n');

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    document.addEventListener('DOMContentLoaded', function () {
        initSectionTransitions();  // #19
        initStatsCountUp();        // #20
        initFunnelAnimation();     // #21
        initChatAnimations();      // #22
        initUpcomingStagger();
    });

    /* ── #19 Section Transitions ─────────────────────────────── */
    function initSectionTransitions() {
        var navBtns = document.querySelectorAll('.admin-nav-item');
        if (navBtns.length === 0) return;

        // Animate initial active section
        setTimeout(function () {
            var activeSection = document.querySelector('.admin-section.active');
            if (activeSection) {
                activeSection.classList.add('adm-animate');
                animateUpcoming(activeSection);
            }
        }, 200);

        navBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                // Wait for admin-dashboard.js to toggle .active
                setTimeout(function () {
                    // Remove animation from all sections
                    document.querySelectorAll('.admin-section').forEach(function (s) {
                        s.classList.remove('adm-animate');
                    });

                    var activeSection = document.querySelector('.admin-section.active');
                    if (activeSection) {
                        void activeSection.offsetHeight;
                        activeSection.classList.add('adm-animate');

                        // Trigger section-specific animations
                        if (activeSection.id === 'section-analytics') {
                            triggerCountUp(activeSection);
                            triggerFunnelAnim(activeSection);
                        }
                        if (activeSection.id === 'section-overview') {
                            triggerCountUp(activeSection);
                            animateUpcoming(activeSection);
                        }
                        animateUpcoming(activeSection);
                    }
                }, 30);
            });
        });
    }

    /* ── #20 Stats Count-Up Animation ────────────────────────── */
    function initStatsCountUp() {
        // Observe stat values for content changes (when data loads)
        var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                if (m.type === 'childList' || m.type === 'characterData') {
                    var el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
                    if (el && el.classList && el.classList.contains('stat-value') && !el.dataset.counted) {
                        animateStatValue(el);
                    }
                }
            });
        });

        document.querySelectorAll('.stat-value').forEach(function (el) {
            observer.observe(el, { childList: true, characterData: true, subtree: true });
        });
    }

    function triggerCountUp(container) {
        if (!container) return;
        container.querySelectorAll('.stat-value').forEach(function (el) {
            el.dataset.counted = '';
            animateStatValue(el);
        });
    }

    function animateStatValue(el) {
        if (!el || el.dataset.counted) return;

        var text = el.textContent.trim();
        if (text === '' || text === '—' || text === '-') return;

        // Extract numeric parts: prefix + number + suffix
        var match = text.match(/^([^\d]*?)([\d.,]+)(.*)$/);
        if (!match) return;

        var prefix = match[1];
        var numStr = match[2];
        var suffix = match[3];
        var cleanNum = numStr.replace(/\./g, '').replace(',', '.');
        var target = parseFloat(cleanNum);
        if (isNaN(target) || target === 0) return;

        el.dataset.counted = '1';
        var hasComma = numStr.includes(',');
        var hasDots = numStr.includes('.');
        var duration = 700;
        var start = performance.now();

        function animate(now) {
            var progress = Math.min((now - start) / duration, 1);
            var eased = 1 - Math.pow(1 - progress, 3);
            var current = target * eased;

            if (hasComma) {
                el.textContent = prefix + current.toFixed(1).replace('.', ',') + suffix;
            } else if (hasDots && target >= 1000) {
                el.textContent = prefix + Math.round(current).toLocaleString('it-IT') + suffix;
            } else {
                el.textContent = prefix + Math.round(current) + suffix;
            }

            if (progress < 1) requestAnimationFrame(animate);
            else el.textContent = text; // Restore exact original text at end
        }

        el.textContent = prefix + '0' + suffix;
        requestAnimationFrame(animate);
    }

    /* ── #21 Funnel Chart Animation ──────────────────────────── */
    function initFunnelAnimation() {
        // Observe for funnel bars being rendered
        var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                    if (node.nodeType === 1 && node.querySelectorAll) {
                        var bars = node.querySelectorAll('.funnel-bar');
                        if (bars.length > 0) {
                            var section = node.closest('.admin-section');
                            if (section) triggerFunnelAnim(section);
                        }
                    }
                });
            });
        });
        var analyticsSection = document.getElementById('section-analytics');
        if (analyticsSection) {
            observer.observe(analyticsSection, { childList: true, subtree: true });
        }
    }

    function triggerFunnelAnim(container) {
        if (!container) return;
        var bars = container.querySelectorAll('.funnel-bar');
        bars.forEach(function (bar, i) {
            if (bar.dataset.animated) return;

            var targetWidth = bar.style.width;
            if (!targetWidth) return;

            bar.dataset.animated = '1';
            var savedWidth = targetWidth;
            bar.style.width = '0%';
            bar.classList.add('f-animate');

            setTimeout(function () {
                bar.style.width = savedWidth;
            }, 100 + i * 120);
        });
    }

    /* ── #22 Chat Bubble Animations ──────────────────────────── */
    function initChatAnimations() {
        var chatArea = document.getElementById('aaChatArea');
        if (!chatArea) return;

        var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                    if (node.nodeType === 1 && node.classList && node.classList.contains('aa-msg')) {
                        node.style.animationDelay = '0.05s';
                    }
                });
            });
        });
        observer.observe(chatArea, { childList: true });
    }

    /* ── Upcoming Items Stagger ───────────────────────────────── */
    function animateUpcoming(container) {
        if (!container) return;
        var items = container.querySelectorAll('.upcoming-item');
        items.forEach(function (item, i) {
            item.classList.remove('up-visible');
            void item.offsetHeight;
            setTimeout(function () {
                item.classList.add('up-visible');
            }, 60 + i * 80);
        });
    }

})();

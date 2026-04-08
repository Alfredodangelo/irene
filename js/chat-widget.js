/* ================================================================
 *  Irene Gipsy Tattoo — Chat Widget
 *  Self-contained: injects own CSS, builds own DOM
 *  Modes: "public" (site FAQ) | "private" (dashboard assistant)
 *  Usage: <script src="js/chat-widget.js" data-mode="public"></script>
 * ================================================================ */
(function () {
  'use strict';

  /* ─── Configuration ─────────────────────────────────── */
  const WEBHOOK_PUBLIC  = 'https://n8n.srv1204993.hstgr.cloud/webhook/chat-public';
  const WEBHOOK_PRIVATE = 'https://n8n.srv1204993.hstgr.cloud/webhook/chat-private';
  const MAX_HISTORY     = 10;

  /* ─── Auto-detect mode & language ───────────────────── */
  const scriptEl = document.currentScript;
  const MODE     = scriptEl?.getAttribute('data-mode') || 'public';
  const LANG     = (document.documentElement.lang === 'en' || location.pathname.includes('/en/')) ? 'en' : 'it';
  const WEBHOOK  = MODE === 'private' ? WEBHOOK_PRIVATE : WEBHOOK_PUBLIC;

  /* ─── Session ID (unique per page load, used by n8n memory) */
  const SESSION_ID = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substr(2) + Date.now().toString(36));

  /* ─── State ─────────────────────────────────────────── */
  let history = [];
  let isOpen  = false;
  let isBusy  = false;
  let els     = {};

  /* ─── i18n ──────────────────────────────────────────── */
  const STRINGS = {
    it: {
      title:       'Assistente Irene',
      subtitle:    'Online',
      placeholder: 'Scrivi un messaggio\u2026',
      welcome: MODE === 'private'
        ? 'Ciao! \uD83D\uDC4B Sono l\'assistente personale di Irene. Posso aiutarti con prenotazioni, appuntamenti e tutto ci\u00f2 che riguarda la tua area personale!'
        : 'Ciao! \uD83D\uDC4B Sono l\'assistente virtuale di Irene Gipsy Tattoo. Chiedimi tutto sul nostro studio: prenotazioni, servizi, cura del tatuaggio e molto altro!',
      tooltip: 'Hai bisogno di aiuto? \uD83D\uDCAC',
      error:   'Ops, qualcosa \u00e8 andato storto. Riprova tra poco! \uD83D\uDE05',
    },
    en: {
      title:       "Irene's Assistant",
      subtitle:    'Online',
      placeholder: 'Type a message\u2026',
      welcome:     'Hi! \uD83D\uDC4B I\'m Irene Gipsy Tattoo\'s virtual assistant. Ask me anything about our studio: bookings, services, tattoo aftercare and more!',
      tooltip:     'Need help? \uD83D\uDCAC',
      error:       'Oops, something went wrong. Please try again! \uD83D\uDE05',
    }
  };
  const S = STRINGS[LANG] || STRINGS.it;

  /* ─── Inject CSS ────────────────────────────────────── */
  function injectCSS() {
    if (document.getElementById('irc-styles')) return;
    const style = document.createElement('style');
    style.id = 'irc-styles';
    style.textContent = `
/* ---- Widget reset ---- */
.irc-widget, .irc-widget * { margin:0; padding:0; box-sizing:border-box; font-family:'Montserrat',-apple-system,sans-serif; }
.irc-widget a { text-decoration:underline; text-underline-offset:2px; }
@media print { .irc-widget { display:none!important; } }

/* ---- Bubble ---- */
.irc-bubble {
  position:fixed; bottom:24px; right:24px;
  width:58px; height:58px; border-radius:50%;
  background:linear-gradient(135deg,#D4AF37 0%,#B8960C 100%);
  border:none; cursor:pointer;
  display:flex; align-items:center; justify-content:center;
  box-shadow:0 4px 18px rgba(212,175,55,0.35);
  z-index:10000;
  transition:transform 0.2s,box-shadow 0.2s;
  animation:irc-pulse 2s ease-in-out 3;
}
.irc-bubble:hover { transform:scale(1.08); box-shadow:0 6px 24px rgba(212,175,55,0.5); }
.irc-bubble i { color:#0a0a0a; font-size:1.4rem; }
.irc-bubble.irc-hidden { display:none; }
@keyframes irc-pulse {
  0%,100% { box-shadow:0 4px 18px rgba(212,175,55,0.35); }
  50% { box-shadow:0 4px 28px rgba(212,175,55,0.6); }
}

/* ---- Tooltip ---- */
.irc-tooltip {
  position:fixed; bottom:90px; right:24px;
  background:#1a1a1a; color:#e8e8e8;
  padding:10px 16px; border-radius:12px;
  font-size:0.82rem; white-space:nowrap;
  box-shadow:0 4px 16px rgba(0,0,0,0.4);
  border:1px solid rgba(212,175,55,0.2);
  z-index:10000; cursor:pointer;
  opacity:0; transform:translateY(8px);
  transition:opacity 0.3s,transform 0.3s;
  pointer-events:none;
}
.irc-tooltip.irc-show { opacity:1; transform:translateY(0); pointer-events:auto; }
.irc-tooltip::after {
  content:''; position:absolute; bottom:-6px; right:22px;
  width:12px; height:12px; background:#1a1a1a;
  border-right:1px solid rgba(212,175,55,0.2);
  border-bottom:1px solid rgba(212,175,55,0.2);
  transform:rotate(45deg);
}

/* ---- Chat Window ---- */
.irc-window {
  position:fixed; bottom:24px; right:24px;
  width:380px; height:520px; max-height:calc(100vh - 48px);
  background:#111;
  border:1px solid rgba(212,175,55,0.2);
  border-radius:16px;
  display:flex; flex-direction:column; overflow:hidden;
  z-index:10001;
  box-shadow:0 8px 40px rgba(0,0,0,0.5);
  opacity:0; transform:translateY(20px) scale(0.95);
  pointer-events:none;
  transition:opacity 0.25s,transform 0.25s;
}
.irc-window.irc-open {
  opacity:1; transform:translateY(0) scale(1); pointer-events:all;
}

/* ---- Header ---- */
.irc-header {
  display:flex; align-items:center; gap:12px;
  padding:14px 16px;
  background:linear-gradient(135deg,rgba(212,175,55,0.12) 0%,rgba(212,175,55,0.04) 100%);
  border-bottom:1px solid rgba(212,175,55,0.15);
  flex-shrink:0;
}
.irc-header-avatar {
  width:36px; height:36px; border-radius:50%;
  background:linear-gradient(135deg,#D4AF37,#B8960C);
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
.irc-header-avatar i { color:#0a0a0a; font-size:0.95rem; }
.irc-header-info { flex:1; }
.irc-header-title {
  font-family:'Playfair Display',serif;
  color:#D4AF37; font-size:0.95rem; font-weight:600; line-height:1.2;
}
.irc-header-subtitle { font-size:0.7rem; color:#8a8a8a; display:flex; align-items:center; gap:5px; }
.irc-header-dot { width:6px; height:6px; border-radius:50%; background:#4ade80; display:inline-block; }
.irc-close {
  width:32px; height:32px; border-radius:8px; border:none;
  background:transparent; color:#888; font-size:1.1rem; cursor:pointer;
  display:flex; align-items:center; justify-content:center;
  transition:background 0.15s,color 0.15s;
}
.irc-close:hover { background:rgba(255,255,255,0.08); color:#ccc; }

/* ---- Messages ---- */
.irc-messages {
  flex:1; overflow-y:auto; padding:16px;
  display:flex; flex-direction:column; gap:12px;
}
.irc-messages::-webkit-scrollbar { width:4px; }
.irc-messages::-webkit-scrollbar-track { background:transparent; }
.irc-messages::-webkit-scrollbar-thumb { background:rgba(212,175,55,0.2); border-radius:2px; }

/* ---- Message bubbles ---- */
.irc-msg { display:flex; gap:8px; max-width:88%; animation:irc-fadeIn 0.2s ease; }
.irc-msg-user { align-self:flex-end; flex-direction:row-reverse; }
.irc-msg-bot  { align-self:flex-start; }
.irc-msg-avatar {
  width:28px; height:28px; border-radius:50%;
  background:linear-gradient(135deg,rgba(212,175,55,0.2),rgba(212,175,55,0.08));
  display:flex; align-items:center; justify-content:center;
  flex-shrink:0; margin-top:2px;
}
.irc-msg-avatar i { color:#D4AF37; font-size:0.65rem; }
.irc-msg-bubble {
  padding:10px 14px; border-radius:14px;
  font-size:0.83rem; line-height:1.55; word-wrap:break-word;
}
.irc-msg-bot .irc-msg-bubble {
  background:rgba(255,255,255,0.05);
  border:1px solid rgba(255,255,255,0.08);
  color:#ddd; border-top-left-radius:4px;
}
.irc-msg-user .irc-msg-bubble {
  background:rgba(212,175,55,0.12);
  border:1px solid rgba(212,175,55,0.25);
  color:#f0f0f0; border-top-right-radius:4px;
}
.irc-msg-bubble a { color:#D4AF37; }
.irc-msg-bubble strong { color:#eee; }
@keyframes irc-fadeIn {
  from { opacity:0; transform:translateY(6px); }
  to   { opacity:1; transform:translateY(0); }
}

/* ---- Typing indicator ---- */
.irc-dots { display:flex; gap:4px; padding:4px 0; }
.irc-dots span {
  width:6px; height:6px; border-radius:50%; background:#888;
  animation:irc-bounce 1.2s ease-in-out infinite;
}
.irc-dots span:nth-child(2) { animation-delay:0.15s; }
.irc-dots span:nth-child(3) { animation-delay:0.3s; }
@keyframes irc-bounce {
  0%,60%,100% { transform:translateY(0); opacity:0.4; }
  30% { transform:translateY(-6px); opacity:1; }
}

/* ---- Input area ---- */
.irc-input-area {
  display:flex; align-items:center; gap:8px;
  padding:12px 14px;
  border-top:1px solid rgba(255,255,255,0.06);
  background:#0d0d0d; flex-shrink:0;
}
.irc-input {
  flex:1; background:#1a1a1a;
  border:1px solid rgba(255,255,255,0.08);
  border-radius:20px; padding:10px 16px;
  color:#e8e8e8; font-size:0.83rem;
  font-family:'Montserrat',sans-serif; outline:none;
  transition:border-color 0.2s;
}
.irc-input::placeholder { color:#555; }
.irc-input:focus { border-color:rgba(212,175,55,0.4); }
.irc-send {
  width:38px; height:38px; border-radius:50%; border:none;
  background:linear-gradient(135deg,#D4AF37,#B8960C);
  color:#0a0a0a; cursor:pointer;
  display:flex; align-items:center; justify-content:center;
  font-size:0.85rem; flex-shrink:0;
  transition:transform 0.15s,opacity 0.15s;
}
.irc-send:hover { transform:scale(1.08); }
.irc-send:disabled { opacity:0.4; cursor:not-allowed; transform:none; }

/* ---- Mobile ---- */
@media (max-width:480px) {
  .irc-window {
    width:calc(100vw - 16px); height:calc(100vh - 80px);
    bottom:8px; right:8px; border-radius:14px;
  }
  .irc-bubble { bottom:16px; right:16px; width:52px; height:52px; }
  .irc-tooltip { bottom:76px; right:16px; }
}
@supports (height:100dvh) {
  @media (max-width:480px) {
    .irc-window { height:calc(100dvh - 80px); }
  }
}
`;
    document.head.appendChild(style);
  }

  /* ─── Build DOM ─────────────────────────────────────── */
  function buildDOM() {
    var container = document.createElement('div');
    container.className = 'irc-widget';

    /* Bubble */
    var bubble = document.createElement('button');
    bubble.className = 'irc-bubble';
    bubble.setAttribute('aria-label', S.title);
    bubble.innerHTML = '<i class="fas fa-comments"></i>';
    bubble.addEventListener('click', toggle);

    /* Tooltip */
    var tooltip = document.createElement('div');
    tooltip.className = 'irc-tooltip';
    tooltip.textContent = S.tooltip;
    tooltip.addEventListener('click', function () { if (!isOpen) toggle(); });

    /* Window */
    var win = document.createElement('div');
    win.className = 'irc-window';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', S.title);

    /* Header */
    var header = document.createElement('div');
    header.className = 'irc-header';
    header.innerHTML =
      '<div class="irc-header-avatar"><i class="fas fa-wand-magic-sparkles"></i></div>' +
      '<div class="irc-header-info">' +
        '<div class="irc-header-title">' + S.title + '</div>' +
        '<div class="irc-header-subtitle"><span class="irc-header-dot"></span>' + S.subtitle + '</div>' +
      '</div>';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'irc-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';
    closeBtn.addEventListener('click', toggle);
    header.appendChild(closeBtn);

    /* Messages */
    var messages = document.createElement('div');
    messages.className = 'irc-messages';

    /* Input area */
    var inputArea = document.createElement('div');
    inputArea.className = 'irc-input-area';

    var input = document.createElement('input');
    input.className = 'irc-input';
    input.type = 'text';
    input.placeholder = S.placeholder;
    input.setAttribute('autocomplete', 'off');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input.value);
      }
    });

    var sendBtn = document.createElement('button');
    sendBtn.className = 'irc-send';
    sendBtn.setAttribute('aria-label', 'Send');
    sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
    sendBtn.addEventListener('click', function () { sendMessage(input.value); });

    inputArea.appendChild(input);
    inputArea.appendChild(sendBtn);

    /* Assemble */
    win.appendChild(header);
    win.appendChild(messages);
    win.appendChild(inputArea);
    container.appendChild(tooltip);
    container.appendChild(bubble);
    container.appendChild(win);
    document.body.appendChild(container);

    /* Escape key to close */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) toggle();
    });

    els = { bubble: bubble, tooltip: tooltip, window: win, messages: messages, input: input, sendBtn: sendBtn };
  }

  /* ─── Helpers ───────────────────────────────────────── */
  function formatMsg(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  }

  function addMessage(role, text) {
    var div = document.createElement('div');
    div.className = 'irc-msg irc-msg-' + role;
    if (role === 'bot') {
      div.innerHTML =
        '<div class="irc-msg-avatar"><i class="fas fa-wand-magic-sparkles"></i></div>' +
        '<div class="irc-msg-bubble">' + formatMsg(text) + '</div>';
    } else {
      div.innerHTML = '<div class="irc-msg-bubble">' + formatMsg(text) + '</div>';
    }
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function showTyping() {
    var div = document.createElement('div');
    div.className = 'irc-msg irc-msg-bot irc-typing';
    div.innerHTML =
      '<div class="irc-msg-avatar"><i class="fas fa-wand-magic-sparkles"></i></div>' +
      '<div class="irc-msg-bubble"><div class="irc-dots"><span></span><span></span><span></span></div></div>';
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function removeTyping() {
    var t = els.messages.querySelector('.irc-typing');
    if (t) t.remove();
  }

  /* ─── Send message ──────────────────────────────────── */
  async function sendMessage(text) {
    text = (text || '').trim();
    if (!text || isBusy) return;
    isBusy = true;

    addMessage('user', text);
    history.push({ role: 'user', content: text });

    els.input.value = '';
    els.sendBtn.disabled = true;
    showTyping();

    var body = {
      message:   text,
      history:   history.slice(-MAX_HISTORY),
      mode:      MODE,
      language:  LANG,
      sessionId: SESSION_ID,
    };

    /* Private mode: attach client info */
    if (MODE === 'private' && window.currentUser) {
      var meta = window.currentUser.user_metadata || {};
      body.client_id   = window.currentUser.id;
      body.client_name = ((meta.first_name || '') + ' ' + (meta.last_name || '')).trim();
    }

    try {
      var res = await fetch(WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      var data = await res.json();
      removeTyping();
      var reply = data.reply || data.output || data.text || S.error;
      addMessage('bot', reply);
      history.push({ role: 'assistant', content: reply });
    } catch (err) {
      removeTyping();
      addMessage('bot', S.error);
    }

    isBusy = false;
    els.sendBtn.disabled = false;
    els.input.focus();
  }

  /* ─── Toggle chat ───────────────────────────────────── */
  function toggle() {
    isOpen = !isOpen;
    els.window.classList.toggle('irc-open', isOpen);
    els.bubble.classList.toggle('irc-hidden', isOpen);
    els.tooltip.classList.remove('irc-show');
    if (isOpen) {
      els.input.focus();
      els.messages.scrollTop = els.messages.scrollHeight;
    }
  }

  /* ─── Init ──────────────────────────────────────────── */
  function init() {
    injectCSS();
    buildDOM();

    /* Welcome message */
    addMessage('bot', S.welcome);

    /* Tooltip: show after 4s, hide after 12s */
    setTimeout(function () { if (!isOpen) els.tooltip.classList.add('irc-show'); }, 4000);
    setTimeout(function () { els.tooltip.classList.remove('irc-show'); }, 12000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

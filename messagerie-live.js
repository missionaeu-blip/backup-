(() => {
  'use strict';
  const body = document.getElementById('chatBody');
  if (!body) return;

  const form = document.getElementById('chatForm');
  const readonly = body.dataset.readonly === '1';
  const userId = Number(body.dataset.userId || 0);
  const status = document.getElementById('chatLiveStatus');
  let serverCursor = 0;
  const seenIds = new Set();
  let pollBusy = false;
  let stopped = false;

  body.querySelectorAll('[data-message-id]').forEach((node) => {
    const id = Number(node.dataset.messageId || 0);
    if (id > 0) { seenIds.add(id); serverCursor = Math.max(serverCursor, id); }
  });

  function showStatus(text) {
    if (!status) return;
    status.textContent = text;
    status.hidden = !text;
  }

  function addMultilineText(target, text) {
    String(text || '').split('\n').forEach((part, index) => {
      if (index) target.appendChild(document.createElement('br'));
      target.appendChild(document.createTextNode(part));
    });
  }

  function appendAttachment(message, bubble) {
    if (!message.fichier_nom) return;
    const wrap = document.createElement('div');
    wrap.className = 'msg-pj';

    const icon = document.createElement('span');
    icon.className = 'msg-pj-ico';
    icon.textContent = '📎';
    wrap.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'msg-pj-nom';
    name.textContent = message.fichier_nom;
    wrap.appendChild(name);

    const size = document.createElement('span');
    size.className = 'msg-pj-taille';
    size.textContent = message.fichier_taille ? `${Math.max(1, Math.round(Number(message.fichier_taille) / 1024))} Ko` : '';
    wrap.appendChild(size);

    if (message.fichier_protege) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-amber';
      badge.style.fontSize = '.62rem';
      badge.textContent = 'Protégé';
      wrap.appendChild(badge);
    }

    const actions = document.createElement('span');
    actions.className = 'msg-pj-actions';
    const messageId = Number(message.id);
    if (message.fichier_previsualisable) {
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.setAttribute('data-apercu-msg', String(messageId));
      preview.setAttribute('data-nom', String(message.fichier_nom));
      preview.setAttribute('data-suivi-non', '');
      preview.setAttribute('aria-label', `Aperçu de ${message.fichier_nom}`);
      preview.textContent = '👁';
      actions.appendChild(preview);
    }
    if (message.fichier_telechargeable && message.fichier_url) {
      const download = document.createElement('a');
      download.href = String(message.fichier_url);
      download.title = 'Télécharger';
      download.setAttribute('aria-label', `Télécharger ${message.fichier_nom}`);
      download.textContent = '⬇';
      actions.appendChild(download);
    }
    if (actions.childNodes.length) wrap.appendChild(actions);
    bubble.appendChild(wrap);
  }

  function appendMessage(message, forceScroll = false) {
    const id = Number(message && message.id);
    if (!Number.isSafeInteger(id) || id <= 0 || seenIds.has(id)) return;

    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 100;
    const empty = body.querySelector('.empty');
    if (empty) empty.remove();

    const bubble = document.createElement('div');
    const mine = Boolean(message.is_mine) || Number(message.expediteur_id) === userId;
    const outgoing = readonly ? String(message.sender_role) === 'freelance' : mine;
    bubble.className = `msg ${outgoing ? 'out' : 'in'}`;
    bubble.dataset.messageId = String(id);
    if (message.expediteur_id) bubble.dataset.senderId = String(message.expediteur_id);
    bubble.style.whiteSpace = 'pre-wrap';

    if (readonly && message.sender_name) {
      const sender = document.createElement('span');
      sender.className = 'badge badge-gray';
      sender.style.cssText = 'font-size:.62rem;margin-bottom:4px';
      sender.textContent = String(message.sender_name);
      bubble.appendChild(sender);
      if (message.contenu) bubble.appendChild(document.createElement('br'));
    }

    addMultilineText(bubble, message.contenu);
    appendAttachment(message, bubble);

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = String(message.heure || '');
    bubble.appendChild(time);
    const next = Array.from(body.querySelectorAll('[data-message-id]')).find((node) => Number(node.dataset.messageId) > id);
    if (next) body.insertBefore(bubble, next); else body.appendChild(bubble);
    seenIds.add(id);

    if (forceScroll || nearBottom) body.scrollTop = body.scrollHeight;
  }

  async function poll() {
    if (stopped || pollBusy || document.hidden) return;
    pollBusy = true;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('live', 'poll');
      url.searchParams.set('after', String(serverCursor));
      const response = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      });
      const type = response.headers.get('content-type') || '';
      if (response.redirected || !type.includes('application/json')) {
        stopped = true;
        showStatus('Session expirée ou connexion interrompue. Recharge la page pour te reconnecter.');
        return;
      }
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error('poll');
      const messages = result.messages || [];
      messages.forEach((message) => appendMessage(message));
      messages.forEach((message) => { serverCursor = Math.max(serverCursor, Number(message.id) || 0); });
      showStatus('');
    } catch (_) {
      showStatus('Reconnexion en cours… Les nouveaux messages réapparaîtront automatiquement.');
    } finally {
      pollBusy = false;
    }
  }

  if (form && !readonly) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (form.dataset.busy === '1') return;
      form.dataset.busy = '1';
      const button = form.querySelector('button[type="submit"]');
      const previousLabel = button ? button.textContent : '';
      if (button) { button.disabled = true; button.textContent = 'Envoi…'; }
      showStatus('Envoi du message…');
      try {
        const data = new FormData(form);
        data.set('_ajax', '1');
        const response = await fetch(form.action || window.location.href, {
          method: 'POST',
          body: data,
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
        });
        const type = response.headers.get('content-type') || '';
        if (response.redirected || !type.includes('application/json')) {
          stopped = true;
          throw new Error('Session expirée. Recharge la page pour te reconnecter.');
        }
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'Le message n’a pas pu être envoyé.');
        const text = form.querySelector('input[name="contenu"]');
        if (text) text.value = '';
        const file = form.querySelector('input[type="file"]');
        if (file) file.value = '';
        if (result.message) appendMessage(result.message, true);
        showStatus('');
      } catch (error) {
        showStatus(error && error.message ? error.message : 'Erreur lors de l’envoi. Réessaie.');
      } finally {
        form.dataset.busy = '0';
        if (button) { button.disabled = false; button.textContent = previousLabel; }
      }
    });
  }

  poll();
  window.setInterval(poll, 3000);
})();

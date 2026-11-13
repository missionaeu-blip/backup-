(() => {
  'use strict';
  const ENDPOINT = '/live-updates';
  const STATUS = {
    nouveau: { label: 'Nouveau', className: 'badge-gray' },
    analyse: { label: 'En analyse', className: 'badge-amber' },
    attribue: { label: 'Attribué', className: 'badge-blue' },
    en_cours: { label: 'En cours', className: 'badge-blue' },
    livraison: { label: 'En livraison', className: 'badge-violet' },
    termine: { label: 'Terminé', className: 'badge-green' },
    annule: { label: 'Annulé', className: 'badge-red' }
  };
  const oldLabels = new Set(Object.values(STATUS).map((x) => x.label));
  let revision = null;
  let notificationState = null;
  let unreadNotificationState = null;
  let unreadMessageState = null;
  let stopped = false;
  let busy = false;
  let updateNotice = null;

  function addProjectContainers() {
    const map = new Map();
    document.querySelectorAll('a[href]').forEach((link) => {
      let url;
      try { url = new URL(link.href, window.location.href); } catch (_) { return; }
      if (url.origin !== window.location.origin) return;
      const path = url.pathname.replace(/\.php$/i, '');
      if (!/(^|\/)projet$/.test(path)) return;
      const id = Number(url.searchParams.get('id') || 0);
      if (!Number.isSafeInteger(id) || id <= 0) return;
      const container = link.closest('tr') || link.closest('.card') || link.closest('.main');
      if (!container) return;
      container.dataset.liveProject = String(id);
      if (!map.has(id)) map.set(id, new Set());
      map.get(id).add(container);
    });

    const pageUrl = new URL(window.location.href);
    const pagePath = pageUrl.pathname.replace(/\.php$/i, '');
    if (/(^|\/)projet$/.test(pagePath)) {
      const id = Number(pageUrl.searchParams.get('id') || 0);
      const main = document.querySelector('.main');
      if (id > 0 && main) {
        main.dataset.liveProject = String(id);
        if (!map.has(id)) map.set(id, new Set());
        map.get(id).add(main);
      }
    }
    return map;
  }

  const projectContainers = addProjectContainers();

  function updateProjectDom(project) {
    const containers = projectContainers.get(Number(project.id));
    if (!containers) return false;
    const status = STATUS[project.statut];
    if (!status) return false;
    let changed = false;
    containers.forEach((container) => {
      const badge = Array.from(container.querySelectorAll('.badge')).find((node) => oldLabels.has(node.textContent.trim()));
      if (badge && badge.textContent.trim() !== status.label) {
        badge.textContent = status.label;
        badge.className = `badge ${status.className}`;
        changed = true;
      }
      container.querySelectorAll('.bar i').forEach((bar) => {
        const width = `${Math.max(0, Math.min(100, Number(project.avancement) || 0))}%`;
        if (bar.style.width !== width) { bar.style.width = width; changed = true; }
        const parent = bar.closest('.bar');
        if (parent) parent.classList.toggle('green', Number(project.avancement) >= 100);
      });
      container.querySelectorAll('.t-sub, strong').forEach((node) => {
        if (/^\d{1,3}\s*%$/.test(node.textContent.trim())) {
          const text = `${Math.max(0, Math.min(100, Number(project.avancement) || 0))} %`;
          if (node.textContent.trim() !== text) { node.textContent = text; changed = true; }
        }
      });
    });
    return changed;
  }

  function updateNotifications(payload) {
    const unread = Math.max(0, Number(payload.unread_notifications) || 0);
    const toggle = document.getElementById('notifToggle');
    if (toggle && unread !== unreadNotificationState) {
      let dot = toggle.querySelector('.dot-red');
      if (unread > 0 && !dot) { dot = document.createElement('span'); dot.className = 'dot-red'; toggle.appendChild(dot); }
      if (unread === 0 && dot) dot.remove();
      toggle.setAttribute('aria-label', unread ? `Notifications (${unread} non lues)` : 'Notifications');
    }
    unreadNotificationState = unread;

    const signature = JSON.stringify(payload.notifications || []);
    const panel = document.getElementById('notifPanel');
    if (panel && signature !== notificationState && Array.isArray(payload.notifications)) {
      const header = document.createElement('div');
      header.className = 'hd';
      header.textContent = 'Notifications';
      const children = [header];
      if (!payload.notifications.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:22px;text-align:center;color:var(--muted);font-size:.8125rem';
        empty.textContent = 'Aucune notification';
        children.push(empty);
      } else {
        payload.notifications.forEach((item) => {
          const link = document.createElement('a');
          let href = '#';
          try {
            const candidate = new URL(String(item.lien || '#'), window.location.origin);
            if (candidate.origin === window.location.origin) href = candidate.pathname + candidate.search + candidate.hash;
          } catch (_) {}
          link.href = href;
          link.className = `notif-item${item.lu ? '' : ' unread'}`;
          link.appendChild(document.createTextNode(String(item.texte || '')));
          const time = document.createElement('time');
          time.textContent = String(item.date || '');
          link.appendChild(time);
          children.push(link);
        });
      }
      panel.replaceChildren(...children);
      notificationState = signature;
    }

    const messageBadge = document.getElementById('liveMessageCount');
    const unreadMessages = Math.max(0, Number(payload.unread_messages) || 0);
    if (messageBadge && unreadMessages !== unreadMessageState) {
      messageBadge.textContent = unreadMessages > 99 ? '99+' : String(unreadMessages);
      messageBadge.hidden = unreadMessages === 0;
      messageBadge.setAttribute('aria-label', `${unreadMessages} message${unreadMessages === 1 ? '' : 's'} non lu${unreadMessages === 1 ? '' : 's'}`);
    }
    unreadMessageState = unreadMessages;

    const unreadAdminChat = Math.max(0, Number(payload.unread_admin_chat) || 0);
    document.querySelectorAll('[data-admin-chat-count]').forEach((badge) => {
      badge.textContent = unreadAdminChat > 99 ? '99+' : String(unreadAdminChat);
      badge.hidden = unreadAdminChat === 0;
      badge.setAttribute('aria-label', `${unreadAdminChat} message${unreadAdminChat === 1 ? '' : 's'} non lu${unreadAdminChat === 1 ? '' : 's'} dans la discussion admin`);
    });
  }

  function hasUnsavedChanges() {
    if (document.querySelector('[contenteditable="true"].is-dirty')) return true;
    for (const form of document.forms) {
      for (const field of Array.from(form.elements)) {
        if (!field || field.disabled || !field.name) continue;
        if (field.type === 'file' && field.files && field.files.length) return true;
        if (field.type === 'checkbox' || field.type === 'radio') {
          if (field.checked !== field.defaultChecked) return true;
        } else if (field.tagName === 'SELECT') {
          if (Array.from(field.options).some((option) => option.selected !== option.defaultSelected)) return true;
        } else if (typeof field.value === 'string' && field.value !== field.defaultValue) {
          return true;
        }
      }
    }
    return false;
  }

  function showUpdateNotice() {
    if (updateNotice) return;
    updateNotice = document.createElement('div');
    updateNotice.setAttribute('role', 'status');
    updateNotice.style.cssText = 'position:fixed;z-index:99999;left:16px;right:16px;bottom:16px;max-width:720px;margin:auto;padding:14px 16px;background:#17202a;color:#fff;border-radius:12px;box-shadow:0 8px 30px #0003;display:flex;gap:14px;align-items:center;justify-content:space-between;font:14px/1.4 system-ui,sans-serif';
    const text = document.createElement('span');
    text.textContent = 'Les données du site ont changé. Enregistre ton formulaire, puis actualise pour voir les dernières informations.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Actualiser';
    button.style.cssText = 'border:0;border-radius:8px;padding:9px 13px;font-weight:700;cursor:pointer;background:#fff;color:#17202a;white-space:nowrap';
    button.addEventListener('click', () => {
      if (hasUnsavedChanges() && !window.confirm('Des modifications ne sont pas enregistrées. Recharger quand même ?')) return;
      reloadKeepingScroll();
    });
    updateNotice.append(text, button);
    document.body.appendChild(updateNotice);
  }

  function reloadKeepingScroll() {
    try { sessionStorage.setItem('missiona-live-scroll', String(window.scrollY)); } catch (_) {}
    window.location.reload();
  }

  function handleDataChange() {
    // La messagerie possède son propre polling : ne jamais recharger son fil.
    if (document.getElementById('chatBody')) return;
    if (!document.querySelector('.app')) return;
    // Le classement est actualisé par admin-matching-live.js sans recharger.
    if (/(^|\/)admin-matching(?:\.php)?\/?$/.test(window.location.pathname)) {
      return;
    }
    if (hasUnsavedChanges()) { showUpdateNotice(); return; }
    window.setTimeout(() => {
      if (!hasUnsavedChanges()) reloadKeepingScroll();
      else showUpdateNotice();
    }, 700);
  }

  try {
    const savedScroll = sessionStorage.getItem('missiona-live-scroll');
    if (savedScroll !== null) {
      sessionStorage.removeItem('missiona-live-scroll');
      window.requestAnimationFrame(() => window.scrollTo(0, Number(savedScroll) || 0));
    }
  } catch (_) {}

  async function poll() {
    if (stopped || busy || document.hidden) return;
    busy = true;
    try {
      const response = await fetch(ENDPOINT, {
        credentials: 'same-origin', cache: 'no-store',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      });
      const type = response.headers.get('content-type') || '';
      if (response.status === 401 || response.redirected || !type.includes('application/json')) { stopped = true; return; }
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error('live');

      let mismatch = false;
      (payload.projects || []).forEach((project) => { if (updateProjectDom(project)) mismatch = true; });
      updateNotifications(payload);

      if (revision === null) {
        revision = payload.revision;
        if (mismatch) handleDataChange();
      } else if (payload.revision !== revision) {
        revision = payload.revision;
        handleDataChange();
      }
    } catch (_) {
      // Échec temporaire : réessayer au prochain intervalle sans gêner l’utilisateur.
    } finally {
      busy = false;
    }
  }

  poll();
  window.setInterval(poll, 5000);
})();

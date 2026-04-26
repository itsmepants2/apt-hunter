// src/router.js — leaf module: pure URL ↔ view mapping. No imports from app/ui.
//
// Routes are URL hashes; #/casa is the default. The ?property=<id> query suffix
// (e.g. #/archivo?property=42) lives outside the router — it triggers a gallery
// overlay that sits above whichever route is active.

const VIEW_IDS = {
  '#/casa':    'homeView',
  '#/archivo': 'archiveView',
  '#/perfil':  'perfilView',
};
const DEFAULT_ROUTE = '#/casa';

let _onEnter = {};
let _current = null;

export function currentRoute() {
  return _current;
}

export function navigateTo(route) {
  if (!VIEW_IDS[route]) return;
  history.pushState(null, '', `${location.pathname}${route}`);
  applyRoute(route);
}

export function initRouter({ onEnter = {} } = {}) {
  _onEnter = onEnter;
  window.addEventListener('popstate', routeFromUrl);
  routeFromUrl();
}

function routeFromUrl() {
  const hashPath = (location.hash || '').split('?')[0];
  const route = VIEW_IDS[hashPath] ? hashPath : DEFAULT_ROUTE;
  applyRoute(route);
}

function applyRoute(route) {
  _current = route;
  Object.entries(VIEW_IDS).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('is-active', key === route);
  });
  document.querySelectorAll('[data-route]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.route === route);
  });
  const fn = _onEnter[route];
  if (typeof fn === 'function') fn();
}

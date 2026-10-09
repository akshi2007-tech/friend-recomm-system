import { route } from './router.js';
import { state, clearUser } from './state.js';
import { navbar } from './components/navbar.js';
import {
  loginPage, dashboardPage, pymkPage, networkPage,
  requestsPage, searchPage, visualizerPage, statsPage, bindPage
} from './pages/pages.js';

const pages = {
  dashboard: dashboardPage,
  pymk: pymkPage,
  network: networkPage,
  requests: requestsPage,
  search: searchPage,
  visualizer: visualizerPage,
  stats: statsPage
};

export async function refresh() {
  await render();
}

async function render() {
  const r = route(), name = r.path.replace('/', '');
  if (!state.user && name !== 'login') {
    location.hash = '#/login';
    return;
  }
  try {
    const page = pages[name];
    const body = page ? await page() : await loginPage();
    const pageMarkup = page
      ? `${navbar(name)}<main class="container" id="page-content">${body}</main>`
      : `<main class="container" id="page-content">${body}</main>`;
    document.querySelector('#app').innerHTML = pageMarkup;
    bindPage();
    document.querySelector('#logout')?.addEventListener('click', () => {
      clearUser();
      location.hash = '#/login';
    });
    document.querySelector('#theme-toggle')?.addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme !== 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      localStorage.setItem('friendgraph.theme', dark ? 'dark' : 'light');
    });
    document.querySelector('#menu-button')?.addEventListener('click', () =>
      document.querySelector('#navlinks').classList.toggle('open')
    );
    const status = document.querySelector('#engine-status');
    if (status) status.textContent = `Engine: ${state.sample ? 'sample data' : 'live'}`;
  } catch (error) {
    document.querySelector('#app').innerHTML = `
      <main class="container">
        <div class="error">
          <h2>Could not load this page</h2>
          <p>${String(error.message || error)}</p>
          <button onclick="location.reload()">Retry</button>
        </div>
      </main>`;
  }
}

document.documentElement.dataset.theme = localStorage.getItem('friendgraph.theme') || 'light';
window.addEventListener('hashchange', render);
window.addEventListener('app:refresh', render);
render();

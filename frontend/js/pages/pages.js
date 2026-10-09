import { api } from '../api.js';
import { state, setUser, uiState, syncOutgoingRequests, addSentRequest, isRequestSent } from '../state.js';
import { refresh } from '../main.js';
import { esc, qs } from '../lib/dom.js';
import { avatar, toast, statTile, chips } from '../components/ui.js';
import { recommendationCard } from '../components/recommendationCard.js';
import { graphView } from '../components/graphView.js';

const uq = () => `user=${encodeURIComponent(state.user?.handle || 'student01')}`;

export async function loginPage() {
  const d = await api.get('/api/users');
  return `<section class="hero">
    <div>
      <span class="eyebrow">Campus connections, by graph</span>
      <h1>Small campus.<br>Connected world.</h1>
      <p>Meet people through the graph you already share. FRIENDGRAPH computes recommendations with BFS, mutual friends and a transparent score.</p>
      <span class="note">Your next study buddy is two hops away.</span>
      <svg class="hero-art" viewBox="0 0 500 260" aria-label="Original graph illustration">
        <circle cx="250" cy="130" r="100" fill="none" stroke="#e5a8b5" stroke-dasharray="5 8"/>
        <path d="M90 150 180 75 270 140 380 65M180 75l75 100 125-35" stroke="#8c1230" stroke-width="3" fill="none"/>
        <g fill="#f4d982" stroke="#8c1230" stroke-width="3">
          <circle cx="90" cy="150" r="18"/>
          <circle cx="180" cy="75" r="22"/>
          <circle cx="270" cy="140" r="27"/>
          <circle cx="380" cy="65" r="18"/>
          <circle cx="255" cy="175" r="16"/>
          <circle cx="380" cy="140" r="20"/>
        </g>
      </svg>
    </div>
    <div class="ticket login">
      <span class="eyebrow">FRIENDGRAPH · CAMPUS EDITION</span>
      <h2>Find your people.</h2>
      <p class="muted">Choose a demo student to enter.</p>
      <div class="grid">
        ${(d.users || []).slice(0, 6).map(u => `
          <button class="button secondary demo-user" data-handle="${esc(u.handle)}">${esc(u.name)} · @${esc(u.handle)}</button>
        `).join('')}
      </div>
      <form id="login-form" class="toolbar">
        <input class="login-input" name="username" placeholder="student01" required>
        <button class="button">Enter network</button>
      </form>
    </div>
  </section>`;
}

export async function dashboardPage() {
  const [d, n, reqData] = await Promise.all([
    api.get(`/api/dashboard?${uq()}`),
    api.get(`/api/network?${uq()}`),
    api.get(`/api/requests?${uq()}`).catch(() => ({ outgoing: [] }))
  ]);
  syncOutgoingRequests(reqData.outgoing);

  return `<p class="eyebrow">Your campus, at a glance</p>
  <h1>Good connections start here.</h1>
  <div class="stats">
    ${statTile('Friends', d.friends)}
    ${statTile('Mutual Connections', d.mutual_connections)}
    ${statTile('Pending Requests', d.pending_requests)}
    ${statTile('Recommended Users', d.recommended_users)}
  </div>
  <div class="section-band">
    <div class="container">
      <p class="eyebrow">Picked by the graph</p>
      <h2>People you may know</h2>
      <div class="grid">
        ${(d.top_recommendations || []).map(recommendationCard).join('')}
      </div>
    </div>
  </div>
  <h2>Your network</h2>
  ${graphView(n)}
  <div class="footer-note">Recommendations are computed by the C engine using BFS + mutual-friend scoring.</div>`;
}

export async function pymkPage() {
  const depth = uiState.pymkDistance ?? 3;
  const min = uiState.pymkMinMutual ?? 0;

  const [d, reqData] = await Promise.all([
    api.get(`/api/recommendations?${uq()}&limit=30&maxDistance=${depth}&minMutual=${min}`),
    api.get(`/api/requests?${uq()}`).catch(() => ({ outgoing: [] }))
  ]);
  syncOutgoingRequests(reqData.outgoing);

  const recs = d.recommendations || [];

  return `<p class="eyebrow">BFS distance ≤ ${depth}</p>
  <h1>People You May Know</h1>
  <div class="toolbar">
    <label>Max distance 
      <select id="distance-filter">
        <option value="3" ${depth == 3 ? 'selected' : ''}>3 hops</option>
        <option value="2" ${depth == 2 ? 'selected' : ''}>2 hops</option>
      </select>
    </label>
    <label>Min mutual 
      <select id="mutual-filter">
        <option value="0" ${min == 0 ? 'selected' : ''}>Any</option>
        <option value="1" ${min == 1 ? 'selected' : ''}>1+</option>
        <option value="2" ${min == 2 ? 'selected' : ''}>2+</option>
      </select>
    </label>
    <span class="chip">${d.engine_us || 0} µs · C engine</span>
  </div>

  ${recs.length > 0 ? `
    <div class="grid">
      ${recs.map(recommendationCard).join('')}
    </div>
  ` : `
    <div class="panel" style="text-align: center; padding: 40px 20px;">
      <h2>No recommendations found</h2>
      <p class="muted" style="max-width: 500px; margin: 10px auto 20px;">
        No people match your current filters. Try relaxing the distance or mutual-friend requirements, or search for classmates to begin connecting!
      </p>
      <a class="button" href="#/search">Search for People</a>
    </div>
  `}`;
}

export async function networkPage() {
  const [netData, blockedData] = await Promise.all([
    api.get(`/api/network?${uq()}`),
    api.get(`/api/blocked?${uq()}`).catch(() => ({ blocked: [] }))
  ]);

  const friends = netData.friends || [];
  const blocked = blockedData.blocked || [];

  return `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px;">
      <div>
        <p class="eyebrow">Rendered from the C graph response</p>
        <h1>My Network</h1>
      </div>
      <div class="toolbar" style="margin-top: 10px;">
        <button class="button secondary" id="undo-button">Undo last friend change</button>
      </div>
    </div>

    ${graphView(netData)}

    <h2>Friends (${friends.length})</h2>
    ${friends.length > 0 ? `
      <div class="grid">
        ${friends.map(u => `
          <article class="panel person-head">
            ${avatar(u.name)}
            <div style="flex: 1;">
              <h3>${esc(u.name)}</h3>
              <div class="muted">@${esc(u.handle)}</div>
            </div>
            <div class="card-actions">
              <button class="button secondary" data-remove="${u.id}">Remove</button>
              <button class="button secondary" data-block="${u.id}">Block</button>
            </div>
          </article>
        `).join('')}
      </div>
    ` : `
      <p class="muted">No friends added yet. Find classmates in <a href="#/pymk" style="text-decoration: underline; color: var(--wine);">People You May Know</a> or <a href="#/search" style="text-decoration: underline; color: var(--wine);">Search</a>.</p>
    `}

    <h2 style="margin-top: 40px;">Blocked Users (${blocked.length})</h2>
    ${blocked.length > 0 ? `
      <div class="grid">
        ${blocked.map(u => `
          <article class="panel person-head">
            ${avatar(u.name)}
            <div style="flex: 1;">
              <h3>${esc(u.name)}</h3>
              <div class="muted">@${esc(u.handle)}</div>
            </div>
            <button class="button secondary" data-unblock="${u.id}">Unblock</button>
          </article>
        `).join('')}
      </div>
    ` : `
      <p class="muted">No blocked users.</p>
    `}
  `;
}

function reqCards(rows, type) {
  if (!rows || rows.length === 0) {
    return `<p class="muted">No ${type} friend requests right now.</p>`;
  }
  return rows.map(x => {
    const u = x.from || x.to;
    if (!u) return '';
    return `
      <article class="ticket person-head">
        ${avatar(u.name)}
        <div style="flex: 1;">
          <h3>${esc(u.name)}</h3>
          <div class="muted">@${esc(u.handle)}</div>
        </div>
        <div class="card-actions">
          ${type === 'incoming' ? `
            <button class="button" data-respond="accept" data-id="${x.id}">Accept</button>
            <button class="button secondary" data-respond="decline" data-id="${x.id}">Decline</button>
          ` : `
            <button class="button secondary" data-respond="cancel" data-id="${x.id}">Cancel</button>
          `}
        </div>
      </article>
    `;
  }).join('');
}

export async function requestsPage() {
  const d = await api.get(`/api/requests?${uq()}`);
  syncOutgoingRequests(d.outgoing);
  const activeTab = uiState.requestsTab || 'incoming';
  const incomingCount = d.incoming?.length || 0;
  const outgoingCount = d.outgoing?.length || 0;

  return `<p class="eyebrow">Keep your circles in sync</p>
  <h1>Friend Requests</h1>
  <div class="tabs">
    <button class="button ${activeTab === 'incoming' ? '' : 'secondary'}" data-tab="incoming">Incoming (${incomingCount})</button>
    <button class="button ${activeTab === 'outgoing' ? '' : 'secondary'}" data-tab="outgoing">Outgoing (${outgoingCount})</button>
  </div>
  <section id="request-list" class="grid">
    ${reqCards(d[activeTab], activeTab)}
  </section>`;
}

export async function searchPage() {
  return `<p class="eyebrow">Prefix autocomplete via C trie</p>
  <h1>User Search</h1>
  <div class="toolbar">
    <input id="search-input" placeholder="Search by name or handle…" autocomplete="off">
    <span id="lookup-time" class="chip">Type to search</span>
  </div>
  <div id="search-results" class="grid">
    <p class="muted">Type a name or handle to search campus members.</p>
  </div>`;
}

export async function visualizerPage() {
  const users = (await api.get('/api/users')).users || [];
  return `<p class="eyebrow">Replay the C BFS trace</p>
  <h1>Algorithm Visualizer</h1>
  <div class="toolbar">
    <label>Source 
      <select id="source-user">
        ${users.map(u => `<option value="${u.handle}" ${u.handle === state.user?.handle ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
      </select>
    </label>
    <label>Target 
      <select id="target-user">
        ${users.map(u => `<option value="${u.handle}">${esc(u.name)}</option>`).join('')}
      </select>
    </label>
    <button class="button" id="load-trace">Load trace</button>
    <button class="button secondary" id="trace-step">Step</button>
    <button class="button secondary" id="trace-play">Play</button>
    <button class="button secondary" id="trace-pause">Pause</button>
    <button class="button secondary" id="trace-reset">Reset</button>
  </div>
  <div id="trace-graph"></div>
  <div class="grid">
    <div class="panel"><h3>Current node</h3><div id="trace-current">Choose endpoints.</div></div>
    <div class="panel"><h3>QUEUE</h3><div id="trace-queue" class="trace-box"></div></div>
    <div class="panel"><h3>VISITED</h3><div id="trace-visited" class="trace-box"></div></div>
  </div>
  <h2>Final shortest path</h2>
  <p id="trace-path" class="note"></p>`;
}

export async function statsPage() {
  const [d, topData, commData] = await Promise.all([
    api.get('/api/stats'),
    api.get('/api/top-users?limit=6').catch(() => ({ users: [] })),
    api.get('/api/communities').catch(() => ({ components: [], count: 0 }))
  ]);

  const topUsers = topData.users || [];
  const commCount = commData.count ?? 0;

  return `<p class="eyebrow">Complexity you can inspect</p>
  <h1>DSA Statistics</h1>
  <div class="grid">
    ${[
      ['Adjacency list', `${d.V} users · ${d.E} edges`],
      ['Hash table', `load ${d.hash_load_factor} · ${d.hash_collisions} collisions · chain ${d.max_chain}`],
      ['Queue / BFS', `${d.bfs_us} µs`],
      ['Max heap', `${d.V} users`],
      ['Trie', `prefix lookup · ${d.engine_us} µs`],
      ['Sorting', `merge ${d.merge_sort_us} µs · quick ${d.quick_sort_us} µs`]
    ].map(([a, b]) => `<article class="ticket"><h3>${a}</h3><p>${b}</p></article>`).join('')}
  </div>

  <h2 style="margin-top: 40px;">Top Connected Users</h2>
  ${topUsers.length > 0 ? `
    <div class="grid">
      ${topUsers.map(u => `
        <article class="panel person-head">
          ${avatar(u.name)}
          <div>
            <h3>${esc(u.name)}</h3>
            <div class="muted">@${esc(u.handle)} · <strong>${u.connections}</strong> connections</div>
          </div>
        </article>
      `).join('')}
    </div>
  ` : `
    <p class="muted">No user connection data available.</p>
  `}

  <h2 style="margin-top: 40px;">Graph Communities</h2>
  <div class="panel">
    <p><strong>${commCount}</strong> connected components detected across ${d.V} users using Union-Find (Disjoint Set Union).</p>
    ${commData.components && commData.components.length > 0 ? `
      <p class="muted" style="font-size: 0.85rem; margin-top: 8px;">Components represent disjoint clusters on campus without connecting friendship bridges.</p>
    ` : ''}
  </div>

  <h2 style="margin-top: 40px;">Big-O table</h2>
  <div class="panel">
    ${Object.entries(d.big_o || {}).map(([k, v]) => `<p><strong>${esc(k)}</strong> — ${esc(v)}</p>`).join('')}
  </div>`;
}

function renderTrace(root) {
  const all = JSON.parse(root.dataset.trace || '[]');
  const i = Number(root.dataset.step || 0);
  const s = all[Math.min(Math.max(i - 1, 0), all.length - 1)];
  if (!s) return;
  qs('#trace-current').textContent = s.current;
  qs('#trace-queue').textContent = (s.queue || []).join(' · ');
  qs('#trace-visited').textContent = (s.visited || []).join(' · ');
  if (root.dataset.graph) {
    qs('#trace-graph').innerHTML = graphView(JSON.parse(root.dataset.graph), s.current);
  }
}

async function doLogin(handle) {
  try {
    const u = await api.post('/api/login', { username: handle });
    if (u?.handle) {
      setUser(u);
      location.hash = '#/dashboard';
    } else {
      toast('Choose a listed demo username');
    }
  } catch (err) {
    toast(err.message || 'Login failed');
  }
}

let searchTimer = null;

export function bindPage() {
  const root = qs('#page-content');
  if (!root) return;

  root.addEventListener('click', async e => {
    // 1. Add friend button
    const add = e.target.closest('[data-add]');
    if (add && !add.disabled) {
      const targetId = add.dataset.add;
      add.disabled = true;
      const originalText = add.textContent;
      add.textContent = 'Sending...';
      try {
        await api.post('/api/requests/send', {
          from: state.user?.handle,
          to: targetId,
          user: state.user?.handle
        });
        addSentRequest(targetId);
        add.textContent = 'Request sent';
        add.className = 'button secondary';
        toast('Friend request sent');
      } catch (err) {
        add.disabled = false;
        add.textContent = originalText;
        toast(err.message || 'Failed to send friend request');
      }
      return;
    }

    // 2. Remove friend button
    const rm = e.target.closest('[data-remove]');
    if (rm && !rm.disabled) {
      rm.disabled = true;
      try {
        await api.post('/api/friends/remove', {
          user: state.user?.handle,
          from: state.user?.handle,
          to: rm.dataset.remove
        });
        toast('Friend removed');
        await refresh();
      } catch (err) {
        rm.disabled = false;
        toast(err.message || 'Failed to remove friend');
      }
      return;
    }

    // 3. Respond to friend request (accept / decline / cancel)
    const respond = e.target.closest('[data-respond]');
    if (respond && !respond.disabled) {
      respond.disabled = true;
      const action = respond.dataset.respond;
      const reqId = Number(respond.dataset.id);
      try {
        await api.post('/api/requests/respond', {
          user: state.user?.handle,
          id: reqId,
          action
        });
        const msg = action === 'accept' ? 'Friend request accepted' : action === 'decline' ? 'Friend request declined' : 'Friend request cancelled';
        toast(msg);
        await refresh();
      } catch (err) {
        respond.disabled = false;
        toast(err.message || 'Failed to process request');
      }
      return;
    }

    // 4. Block user button
    const blockBtn = e.target.closest('[data-block]');
    if (blockBtn && !blockBtn.disabled) {
      blockBtn.disabled = true;
      try {
        await api.post('/api/block', {
          user: state.user?.handle,
          target: blockBtn.dataset.block,
          action: 'block'
        });
        toast('User blocked');
        await refresh();
      } catch (err) {
        blockBtn.disabled = false;
        toast(err.message || 'Failed to block user');
      }
      return;
    }

    // 5. Unblock user button
    const unblockBtn = e.target.closest('[data-unblock]');
    if (unblockBtn && !unblockBtn.disabled) {
      unblockBtn.disabled = true;
      try {
        await api.post('/api/block', {
          user: state.user?.handle,
          target: unblockBtn.dataset.unblock,
          action: 'unblock'
        });
        toast('User unblocked');
        await refresh();
      } catch (err) {
        unblockBtn.disabled = false;
        toast(err.message || 'Failed to unblock user');
      }
      return;
    }

    // 6. Undo friend change
    const undoBtn = e.target.closest('#undo-button');
    if (undoBtn && !undoBtn.disabled) {
      undoBtn.disabled = true;
      try {
        await api.post('/api/undo', { user: state.user?.handle });
        toast('Undid last friend change');
        await refresh();
      } catch (err) {
        undoBtn.disabled = false;
        toast(err.message || 'Nothing to undo');
      }
      return;
    }

    // 7. Request tabs
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      uiState.requestsTab = tab.dataset.tab;
      await refresh();
      return;
    }

    // 8. Mutual friends expander lazy load fallback
    const mutualExpander = e.target.closest('.mutual-expander summary');
    if (mutualExpander) {
      const details = mutualExpander.closest('.mutual-expander');
      const listEl = details?.querySelector('.mutual-list');
      const handle = details?.dataset.handle;
      if (details && listEl && (!listEl.children || listEl.children.length === 0) && handle) {
        try {
          const common = await api.get(`/api/common?${uq()}&target=${encodeURIComponent(handle)}`);
          if (common && Array.isArray(common.mutual_friends)) {
            listEl.innerHTML = chips(common.mutual_friends);
          }
        } catch {
          // Gracefully fallback
        }
      }
    }

    // 9. Visualizer controls
    if (e.target.id === 'load-trace') {
      const source = qs('#source-user').value;
      const target = qs('#target-user').value;
      const [d, g] = await Promise.all([
        api.get(`/api/visualize?user=${source}&target=${target}`),
        api.get(`/api/network?user=${source}`)
      ]);
      root.dataset.trace = JSON.stringify(d.trace || []);
      root.dataset.graph = JSON.stringify(g);
      root.dataset.step = '0';
      qs('#trace-path').textContent = (d.path || []).join(' → ') || 'No path found';
      renderTrace(root);
    }
    if (e.target.id === 'trace-step') {
      root.dataset.step = String(Number(root.dataset.step || 0) + 1);
      renderTrace(root);
    }
    if (e.target.id === 'trace-reset') {
      root.dataset.step = '0';
      renderTrace(root);
    }
    if (e.target.id === 'trace-pause') {
      clearInterval(Number(root.dataset.timer || 0));
      root.dataset.timer = '';
    }
    if (e.target.id === 'trace-play') {
      if (root.dataset.timer) clearInterval(Number(root.dataset.timer));
      root.dataset.timer = String(setInterval(() => {
        root.dataset.step = String(Number(root.dataset.step || 0) + 1);
        renderTrace(root);
      }, 800));
    }
  });

  // Debounced Search Input
  root.addEventListener('input', e => {
    if (e.target.id === 'search-input') {
      clearTimeout(searchTimer);
      const query = e.target.value.trim();
      searchTimer = setTimeout(async () => {
        const resultsEl = qs('#search-results');
        const timeEl = qs('#lookup-time');
        if (!resultsEl) return;

        if (!query) {
          if (timeEl) timeEl.textContent = 'Type to search';
          resultsEl.innerHTML = '<p class="muted">Type a name or handle to search campus members.</p>';
          return;
        }

        try {
          const [searchData, netData, reqData, blockedData] = await Promise.all([
            api.get(`/api/search?${uq()}&q=${encodeURIComponent(query)}&limit=20`),
            api.get(`/api/network?${uq()}`),
            api.get(`/api/requests?${uq()}`),
            api.get(`/api/blocked?${uq()}`).catch(() => ({ blocked: [] }))
          ]);
          syncOutgoingRequests(reqData.outgoing);

          if (timeEl) timeEl.textContent = `${searchData.lookup_us || 0} µs · C trie`;
          const list = searchData.suggestions || [];
          if (list.length === 0) {
            resultsEl.innerHTML = `<p class="muted">No users found matching "${esc(query)}".</p>`;
            return;
          }

          const friendIds = new Set((netData.friends || []).map(f => Number(f.id)));
          const blockedIds = new Set((blockedData.blocked || []).map(b => Number(b.id)));
          const incomingFromIds = new Set((reqData.incoming || []).map(r => Number(r.from?.id ?? r.from)));

          resultsEl.innerHTML = list.map(u => {
            const isMe = u.id === state.user?.id || u.handle === state.user?.handle;
            const isFriend = friendIds.has(Number(u.id));
            const isBlocked = blockedIds.has(Number(u.id));
            const hasSent = isRequestSent(u.id);
            const hasReceived = incomingFromIds.has(Number(u.id));

            let actionBtn = '';
            if (isMe) {
              actionBtn = '<span class="chip">You</span>';
            } else if (isFriend) {
              actionBtn = '<span class="chip">Friends</span>';
            } else if (isBlocked) {
              actionBtn = '<span class="chip">Blocked</span>';
            } else if (hasSent) {
              actionBtn = '<button class="button secondary" disabled>Request sent</button>';
            } else if (hasReceived) {
              actionBtn = '<a class="button secondary" href="#/requests">Respond</a>';
            } else {
              actionBtn = `<button class="button" data-add="${u.id}">Add Friend</button>`;
            }

            return `<article class="ticket person-head">
              ${avatar(u.name)}
              <div style="flex: 1;">
                <h3>${esc(u.name)}</h3>
                <div class="muted">@${esc(u.handle)}</div>
              </div>
              ${actionBtn}
            </article>`;
          }).join('');
        } catch (err) {
          if (timeEl) timeEl.textContent = 'Search error';
          resultsEl.innerHTML = `<p class="muted">Error searching: ${esc(err.message || 'Failed to search')}</p>`;
        }
      }, 250);
    }
  });

  // Filter change on PYMK
  root.addEventListener('change', async e => {
    if (e.target.id === 'distance-filter') {
      uiState.pymkDistance = Number(e.target.value);
      await refresh();
    } else if (e.target.id === 'mutual-filter') {
      uiState.pymkMinMutual = Number(e.target.value);
      await refresh();
    }
  });

  document.querySelectorAll('.demo-user').forEach(x =>
    x.addEventListener('click', () => doLogin(x.dataset.handle))
  );

  qs('#login-form')?.addEventListener('submit', e => {
    e.preventDefault();
    doLogin(new FormData(e.currentTarget).get('username'));
  });
}

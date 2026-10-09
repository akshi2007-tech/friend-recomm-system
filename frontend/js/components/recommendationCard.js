import { esc } from '../lib/dom.js';
import { avatar, chips, sticker } from './ui.js';
import { isRequestSent } from '../state.js';

export function recommendationCard(r) {
  const sent = isRequestSent(r.id);
  const mutuals = r.mutual_friends || [];
  const mutualCount = r.mutual_count ?? mutuals.length;

  return `<article class="ticket" data-user-id="${r.id}">
    <div class="person-head">
      ${avatar(r.name)}
      <div>
        <h3>${esc(r.name)}</h3>
        <div class="muted">@${esc(r.handle)} · ${mutualCount} mutual friend${mutualCount === 1 ? '' : 's'}</div>
      </div>
      ${sticker(`${r.score} pts`)}
    </div>

    ${mutualCount > 0 ? `
      <details class="why mutual-expander" data-handle="${esc(r.handle)}">
        <summary>${mutualCount} mutual friend${mutualCount === 1 ? '' : 's'}</summary>
        <div class="mutual-list">${chips(mutuals)}</div>
      </details>
    ` : `
      <div class="muted" style="margin-top: 8px; font-size: 0.85rem;">0 mutual friends</div>
    `}

    <p class="muted" style="margin: 8px 0;">${r.distance} hops · ${(r.path || []).map(esc).join(' → ')}</p>

    <details class="why">
      <summary>Why recommended?</summary>
      <p>Mutual ${r.score_breakdown?.mutual_points ?? 0} · Distance ${r.score_breakdown?.distance_points ?? 0} · Interests ${r.score_breakdown?.interest_points ?? 0} · Penalty ${r.score_breakdown?.penalty ?? 0}</p>
    </details>

    <div class="card-actions">
      ${sent ? `
        <button class="button secondary" disabled>Request sent</button>
      ` : `
        <button class="button" data-add="${r.id}">Add Friend</button>
      `}
      <button class="button secondary" data-block="${r.id}">Block</button>
    </div>
  </article>`;
}

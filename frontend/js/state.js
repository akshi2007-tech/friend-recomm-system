const key = 'friendgraph.user';

export const state = {
  user: JSON.parse(localStorage.getItem(key) || 'null'),
  sample: false
};

const sessionSentRequests = new Set();
const backendOutgoingRequests = new Set();

export const uiState = {
  requestsTab: 'incoming',
  pymkDistance: 3,
  pymkMinMutual: 0
};

export function setUser(user) {
  state.user = user;
  localStorage.setItem(key, JSON.stringify(user));
  sessionSentRequests.clear();
  backendOutgoingRequests.clear();
}

export function clearUser() {
  state.user = null;
  localStorage.removeItem(key);
  sessionSentRequests.clear();
  backendOutgoingRequests.clear();
}

export function syncOutgoingRequests(requests) {
  backendOutgoingRequests.clear();
  if (Array.isArray(requests)) {
    for (const r of requests) {
      const targetId = r.to?.id ?? r.to;
      if (targetId !== undefined && targetId !== null) {
        backendOutgoingRequests.add(Number(targetId));
      }
    }
  }
}

export function addSentRequest(targetId) {
  sessionSentRequests.add(Number(targetId));
}

export function removeSentRequest(targetId) {
  sessionSentRequests.delete(Number(targetId));
  backendOutgoingRequests.delete(Number(targetId));
}

export function isRequestSent(targetId) {
  const id = Number(targetId);
  return sessionSentRequests.has(id) || backendOutgoingRequests.has(id);
}

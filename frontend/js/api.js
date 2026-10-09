import { mockGet } from './mock/mockApi.js';
import { state } from './state.js';
import { config } from './config.js';

async function call(path, options = {}) {
  if (config.demoMode) {
    state.sample = true;
    if (options.method === 'POST') {
      if (path.includes('/login')) {
        const data = await mockGet('/api/users');
        const handle = options.body ? JSON.parse(options.body).username : '';
        return data.users.find(u => u.handle === handle) || data.users[0];
      }
      return { ok: true };
    }
    return mockGet(path);
  }

  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson && errJson.error) {
        errMsg = errJson.error;
      }
    } catch {
      // Ignore JSON parse error, use default status string
    }
    throw new Error(errMsg);
  }

  state.sample = false;
  return await response.json();
}

export const api = {
  get: path => call(path),
  post: (path, data) => call(path, { method: 'POST', body: JSON.stringify(data) })
};

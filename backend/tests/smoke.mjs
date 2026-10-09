import assert from 'node:assert';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

async function main() {
  console.log(`Running FRIENDGRAPH smoke tests against ${BASE_URL}...`);

  // 1. GET /api/health
  const rHealth = await fetch(`${BASE_URL}/api/health`);
  assert.strictEqual(rHealth.status, 200, 'GET /api/health should return 200');
  const dHealth = await rHealth.json();
  assert.strictEqual(dHealth.ok, true, 'health ok should be true');
  assert.strictEqual(typeof dHealth.users, 'number', 'health users should be number');
  assert.strictEqual(typeof dHealth.edges, 'number', 'health edges should be number');

  // 2. GET /api/users
  const rUsers = await fetch(`${BASE_URL}/api/users`);
  assert.strictEqual(rUsers.status, 200, 'GET /api/users should return 200');
  const dUsers = await rUsers.json();
  assert(Array.isArray(dUsers.users), 'users should be array');

  // 3. GET /api/recommendations (verify double opening brace is fixed and returns valid JSON)
  const rRec = await fetch(`${BASE_URL}/api/recommendations?user=student01`);
  assert.strictEqual(rRec.status, 200, 'GET /api/recommendations should return 200');
  const dRec = await rRec.json();
  assert(Array.isArray(dRec.recommendations), 'recommendations should be array');
  assert.strictEqual(typeof dRec.engine_us, 'number', 'engine_us should be number');

  // 4. GET /api/dashboard
  const rDash = await fetch(`${BASE_URL}/api/dashboard?user=student01`);
  assert.strictEqual(rDash.status, 200);
  const dDash = await rDash.json();
  assert.strictEqual(typeof dDash.friends, 'number');

  // 5. GET /api/network
  const rNet = await fetch(`${BASE_URL}/api/network?user=student01`);
  assert.strictEqual(rNet.status, 200);
  const dNet = await rNet.json();
  assert(Array.isArray(dNet.nodes));

  // 6. GET /api/requests
  const rReqList = await fetch(`${BASE_URL}/api/requests?user=student01`);
  assert.strictEqual(rReqList.status, 200);
  const dReqList = await rReqList.json();
  assert(Array.isArray(dReqList.incoming));

  // 7. GET /api/search with query, limit, empty query
  const rSearch = await fetch(`${BASE_URL}/api/search?q=aarav`);
  assert.strictEqual(rSearch.status, 200);
  const dSearch = await rSearch.json();
  assert(Array.isArray(dSearch.suggestions));

  const rSearchEmpty = await fetch(`${BASE_URL}/api/search`);
  assert.strictEqual(rSearchEmpty.status, 200);
  const dSearchEmpty = await rSearchEmpty.json();
  assert(dSearchEmpty.suggestions.length <= 10, 'Empty search should default to max 10');

  const rSearchLimit = await fetch(`${BASE_URL}/api/search?limit=3`);
  assert.strictEqual(rSearchLimit.status, 200);
  const dSearchLimit = await rSearchLimit.json();
  assert(dSearchLimit.suggestions.length <= 3, 'Search with limit=3 should return <= 3');

  // 8. GET /api/stats
  const rStats = await fetch(`${BASE_URL}/api/stats`);
  assert.strictEqual(rStats.status, 200);
  const dStats = await rStats.json();
  assert.strictEqual(typeof dStats.V, 'number');

  // 9. GET /api/top-users
  const rTop = await fetch(`${BASE_URL}/api/top-users`);
  assert.strictEqual(rTop.status, 200);
  const dTop = await rTop.json();
  assert(Array.isArray(dTop.users));

  // 10. GET /api/communities
  const rComm = await fetch(`${BASE_URL}/api/communities`);
  assert.strictEqual(rComm.status, 200);
  const dComm = await rComm.json();
  assert(Array.isArray(dComm.components));

  // --- Write Flow Tests ---
  console.log('Testing Write Flow...');
  
  // Send request from student01 (0) to student04 (3)
  const rSend = await fetch(`${BASE_URL}/api/requests/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'student01', to: 'student04', user: 'student01' })
  });
  assert.strictEqual(rSend.status, 200, 'send request should return 200');
  const dSend = await rSend.json();
  assert.strictEqual(dSend.ok, true);
  const reqId = dSend.id;

  // List incoming requests for student04
  const rReq3 = await fetch(`${BASE_URL}/api/requests?user=student04`);
  const dReq3 = await rReq3.json();
  const inc = dReq3.incoming.find(r => r.id === reqId);
  assert(inc, 'incoming request should be found in list');

  // Accept request by student04
  const rResp = await fetch(`${BASE_URL}/api/requests/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: reqId, action: 'accept', user: 'student04' })
  });
  assert.strictEqual(rResp.status, 200);
  const dResp = await rResp.json();
  assert.strictEqual(dResp.ok, true);

  // Check friendship in network
  const rNet1 = await fetch(`${BASE_URL}/api/network?user=student01`);
  const dNet1 = await rNet1.json();
  const isFriend = dNet1.friends.some(f => f.handle === 'student04');
  assert(isFriend, 'student04 should now be in student01 friends');

  // Remove friendship
  const rRem = await fetch(`${BASE_URL}/api/friends/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'student01', to: 'student04', user: 'student01' })
  });
  assert.strictEqual(rRem.status, 200);
  const dRem = await rRem.json();
  assert.strictEqual(dRem.ok, true);

  // Undo removal
  const rUndo = await fetch(`${BASE_URL}/api/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'student01' })
  });
  assert.strictEqual(rUndo.status, 200);
  const dUndo = await rUndo.json();
  assert.strictEqual(dUndo.ok, true);

  // Block & Unblock
  const rBlock = await fetch(`${BASE_URL}/api/block`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'student01', target: 'student04', action: 'block' })
  });
  assert.strictEqual(rBlock.status, 200);

  // Check GET /api/blocked includes student04
  const rBlockedList = await fetch(`${BASE_URL}/api/blocked?user=student01`);
  assert.strictEqual(rBlockedList.status, 200, 'GET /api/blocked should return 200');
  const dBlockedList = await rBlockedList.json();
  assert(Array.isArray(dBlockedList.blocked), 'blocked should be an array');
  assert(dBlockedList.blocked.some(u => u.handle === 'student04'), 'student04 should be in blocked list');

  // Verify request cannot be sent while blocked
  const rBlockedSend = await fetch(`${BASE_URL}/api/requests/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'student01', to: 'student04', user: 'student01' })
  });
  assert.strictEqual(rBlockedSend.status, 400, 'Cannot send friend request to blocked user');

  const rUnblock = await fetch(`${BASE_URL}/api/block`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'student01', target: 'student04', action: 'unblock' })
  });
  assert.strictEqual(rUnblock.status, 200);

  // Check GET /api/blocked no longer includes student04
  const rBlockedAfter = await fetch(`${BASE_URL}/api/blocked?user=student01`);
  assert.strictEqual(rBlockedAfter.status, 200);
  const dBlockedAfter = await rBlockedAfter.json();
  assert(!dBlockedAfter.blocked.some(u => u.handle === 'student04'), 'student04 should no longer be blocked');

  // Cleanup edge created during test so CSV state is restored
  await fetch(`${BASE_URL}/api/friends/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'student01', to: 'student04', user: 'student01' })
  });


  // --- Error Cases ---
  console.log('Testing Error Cases...');

  // Duplicate request / invalid request (users 0 and 1 are already friends)
  const rDup = await fetch(`${BASE_URL}/api/requests/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'student01', to: 'student02', user: 'student01' })
  });
  assert.strictEqual(rDup.status, 400, 'Duplicate request should return 400');
  const dDup = await rDup.json();
  assert(dDup.error, 'Response should contain error field');

  // Unknown user
  const rUnk = await fetch(`${BASE_URL}/api/recommendations?user=unknown_user_12345`);
  assert.strictEqual(rUnk.status, 404, 'Unknown user should return 404');
  const dUnk = await rUnk.json();
  assert.strictEqual(dUnk.error, 'Unknown user');

  console.log('All FRIENDGRAPH smoke tests passed successfully!');
}

main().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});

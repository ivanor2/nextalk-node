'use strict';

const http = require('http');

async function run() {
  console.log('--- Testing Inter-Node & User-Nodes functionality ---');

  // 1. Test Auth Server user-nodes endpoints
  console.log('1. Testing nextalk-auth /user-nodes endpoints...');
  const authRes = await fetch('http://nextalk-auth/user-nodes?user_ids=1,2');
  const authData = await authRes.json();
  console.log('Auth user_nodes result:', JSON.stringify(authData));

  if (!authData.ok || !authData.user_nodes) {
    throw new Error('Auth server user_nodes failed');
  }

  // 2. Announce node
  console.log('\n2. Testing /nodes/announce...');
  const annRes = await fetch('http://nextalk-auth/nodes/announce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Node 3001',
      url: 'http://localhost:3001',
      ws_url: 'ws://localhost:3001',
    }),
  });
  const annData = await annRes.json();
  console.log('Announce result:', annData);

  // 3. Bind user 1 to node
  console.log('\n3. Testing /user-nodes binding...');
  const bindRes = await fetch('http://nextalk-auth/user-nodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: 1,
      node_id: annData.node_id,
      is_active: 1,
    }),
  });
  const bindData = await bindRes.json();
  console.log('Bind result:', bindData);

  // 4. Test incoming inter-node message handling via interNode module
  console.log('\n4. Testing local interNode handling...');
  const interNode = require('../src/interNode');
  const { db, stmts } = require('../src/database');

  const mockReq = { method: 'POST' };
  let resStatus = 0;
  let resHeaders = {};
  let resBody = '';
  const mockRes = {
    writeHead(status, headers) {
      resStatus = status;
      resHeaders = headers;
    },
    end(content) {
      resBody = content;
    },
  };

  const testIncoming = {
    source_node_id: 2,
    source_node_url: 'http://localhost:3002',
    source_node_name: 'Remote Node 2',
    chat: {
      id: 9999,
      type: 'private',
      name: 'Inter-Node Test Chat',
      members: [
        { user_id: 1, username: 'admin' },
        { user_id: 2, username: 'remote_user' },
      ],
    },
    message: {
      id: 88888,
      chat_id: 9999,
      sender_id: 2,
      username: 'remote_user',
      content: 'Hello across nodes! ' + Date.now(),
      created_at: new Date().toISOString(),
    },
    target_user_ids: [1],
  };

  interNode.handleIncoming(mockReq, mockRes, testIncoming);
  console.log('Incoming handler status:', resStatus, 'body:', resBody);

  const parsedRes = JSON.parse(resBody);
  if (!parsedRes.ok || !parsedRes.delivered) {
    throw new Error('Incoming message handling failed');
  }

  // Verify in SQLite database
  const chatRow = db.prepare('SELECT * FROM chats WHERE id = ?').get(9999);
  console.log('Chat verified in SQLite:', chatRow);

  const membersRows = db.prepare('SELECT * FROM chat_members WHERE chat_id = ?').all(9999);
  console.log('Members verified in SQLite:', membersRows);

  const msgRow = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND sender_id = ?').get(9999, 2);
  console.log('Message verified in SQLite:', msgRow);

  // Clean up test data from SQLite
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(9999);
  db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(9999);
  db.prepare('DELETE FROM chats WHERE id = ?').run(9999);
  console.log('Cleaned up test chat 9999 from SQLite.');

  console.log('\n=== ALL TESTS PASSED! ===');
}

run().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});


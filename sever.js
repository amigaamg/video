// server.js
const WebSocket = require('ws');
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port });

let waitingUser = null;
const connections = new Map();

wss.on('connection', (ws) => {
  let userId = null;
  let partnerId = null;

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    if (data.type === 'find-partner') {
      userId = data.userId;
      connections.set(userId, ws);

      if (waitingUser && waitingUser !== userId) {
        partnerId = waitingUser;
        const partnerWs = connections.get(partnerId);

        ws.send(JSON.stringify({ type: 'partner-found', partnerId, initiator: true }));
        partnerWs.send(JSON.stringify({ type: 'partner-found', partnerId: userId, initiator: false }));

        waitingUser = null;
      } else {
        waitingUser = userId;
      }
    } else if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice-candidate') {
      if (partnerId) {
        const partnerWs = connections.get(partnerId);
        if (partnerWs) partnerWs.send(JSON.stringify(data));
      }
    }
  });

  ws.on('close', () => {
    if (userId) connections.delete(userId);
    if (waitingUser === userId) waitingUser = null;
    if (partnerId) {
      const partnerWs = connections.get(partnerId);
      if (partnerWs) partnerWs.send(JSON.stringify({ type: 'partner-disconnected' }));
    }
  });
});

console.log(`Signaling server running on port ${port}`);
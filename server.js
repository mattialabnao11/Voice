const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// rooms: { roomId: { peerId: { ws, name } } }
const rooms = new Map();

function getRoomPeers(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

function broadcastToRoom(roomId, senderId, message) {
  const peers = getRoomPeers(roomId);
  peers.forEach((peer, peerId) => {
    if (peerId !== senderId && peer.ws.readyState === peer.ws.OPEN) {
      peer.ws.send(JSON.stringify(message));
    }
  });
}

function sendToPeer(roomId, targetId, message) {
  const peers = getRoomPeers(roomId);
  const peer = peers.get(targetId);
  if (peer && peer.ws.readyState === peer.ws.OPEN) {
    peer.ws.send(JSON.stringify(message));
  }
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentPeerId = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {
      case 'join': {
        const { roomId, peerId, name } = msg;
        currentRoom = roomId;
        currentPeerId = peerId;

        const peers = getRoomPeers(roomId);

        // Send existing peers (with names) to newcomer
        const existingPeers = [...peers.entries()].map(([id, p]) => ({
          peerId: id,
          name: p.name || id.slice(0, 6)
        }));
        ws.send(JSON.stringify({ type: 'peers', peers: existingPeers }));

        // Notify existing peers about the newcomer (with name)
        broadcastToRoom(roomId, peerId, { type: 'peer-joined', peerId, name: name || peerId.slice(0, 6) });

        // Add to room
        peers.set(peerId, { ws, name: name || peerId.slice(0, 6) });
        console.log(`[${roomId}] ${name || peerId} joined. Total: ${peers.size}`);
        break;
      }
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        sendToPeer(currentRoom, msg.targetId, { ...msg, fromId: currentPeerId });
        break;
      }
      case 'mute-state': {
        // Broadcast mute state to all peers
        broadcastToRoom(currentRoom, currentPeerId, {
          type: 'peer-mute-state',
          peerId: currentPeerId,
          muted: msg.muted
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom && currentPeerId) {
      const peers = getRoomPeers(currentRoom);
      peers.delete(currentPeerId);
      broadcastToRoom(currentRoom, currentPeerId, { type: 'peer-left', peerId: currentPeerId });
      console.log(`[${currentRoom}] ${currentPeerId} left. Total: ${peers.size}`);
      if (peers.size === 0) rooms.delete(currentRoom);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

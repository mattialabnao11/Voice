const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// rooms: { roomId: { peerId: ws } }
const rooms = new Map();

function getRoomPeers(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

function broadcastToRoom(roomId, senderId, message) {
  const peers = getRoomPeers(roomId);
  peers.forEach((ws, peerId) => {
    if (peerId !== senderId && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
}

function sendToPeer(roomId, targetId, message) {
  const peers = getRoomPeers(roomId);
  const ws = peers.get(targetId);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
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
        const { roomId, peerId } = msg;
        currentRoom = roomId;
        currentPeerId = peerId;

        const peers = getRoomPeers(roomId);
        // Send existing peer list to newcomer
        const existingPeers = [...peers.keys()];
        ws.send(JSON.stringify({ type: 'peers', peers: existingPeers }));
        // Notify existing peers
        broadcastToRoom(roomId, peerId, { type: 'peer-joined', peerId });
        // Add to room
        peers.set(peerId, ws);
        console.log(`[${roomId}] ${peerId} joined. Total: ${peers.size}`);
        break;
      }
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        sendToPeer(currentRoom, msg.targetId, { ...msg, fromId: currentPeerId });
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

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { DriplElement } from '@dripl/common';
import { v7 as uuidv7 } from 'uuid';


interface User {
  userId: string;
  userName: string;
  color: string;
  ws: WebSocket;
}

interface Room {
  elements: DriplElement[];
  users: Map<string, User>;
}

const server = createServer();
const wss = new WebSocketServer({ server });

const room: Room = {
  elements: [],
  users: new Map(),
};

function generateUserColor(): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', 
    '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// user id
function generateUserId(): string {
  const userId = uuidv7();

  return `user_${userId}`;
}

wss.on('connection', (ws) => {
  const userId = generateUserId();
  const userName = `User ${room.users.size + 1}`;
  const color = generateUserColor();

  const user: User = { userId, userName, color, ws };
  room.users.set(userId, user);

  console.log(`User ${userName} (${userId}) connected`);

  // Send current state to new user
  const syncMessage = {
    type: 'sync_state',
    userId: 'server',
    timestamp: Date.now(),
    elements: room.elements,
    users: Array.from(room.users.values()).map(u => ({
      userId: u.userId,
      userName: u.userName,
      color: u.color,
    })),
  };
  ws.send(JSON.stringify(syncMessage));

  // Broadcast user join to others
  const joinMessage = {
    type: 'user_join',
    userId,
    userName,
    color,
    timestamp: Date.now(),
  };
  broadcast(joinMessage, userId);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle different message types
      switch (message.type) {
        case 'add_element':
          room.elements.push(message.element);
          broadcast(message, userId);
          break;
          
        case 'update_element':
          const index = room.elements.findIndex(e => e.id === message.element.id);
          if (index !== -1) {
            room.elements[index] = message.element;
          }
          broadcast(message, userId);
          break;
          
        case 'delete_element':
          room.elements = room.elements.filter(e => e.id !== message.elementId);
          broadcast(message, userId);
          break;
          
        case 'cursor_move':
          // Just broadcast cursor movements, don't store
          broadcast(message, userId);
          break;
          
        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  });

  ws.on('close', () => {
    room.users.delete(userId);
    console.log(`User ${userName} (${userId}) disconnected`);
    
    // Broadcast user leave
    const leaveMessage = {
      type: 'user_leave',
      userId,
      timestamp: Date.now(),
    };
    broadcast(leaveMessage, userId);
  });
});

// Broadcast message to all users except sender
function broadcast(message: any, excludeUserId?: string) {
  const messageStr = JSON.stringify(message);
  room.users.forEach((user) => {
    if (user.userId !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(messageStr);
    }
  });
}

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});

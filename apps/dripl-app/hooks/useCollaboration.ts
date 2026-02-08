// import { useEffect, useRef, useState } from 'react';
// import { canvasStore, addElement } from '@dripl/state';
// import { SyncClient, User, AddElementMessage } from '@dripl/sync';
// import { useUser } from '@clerk/nextjs';

// export const useCollaboration = () => {
//   const { user } = useUser();
//   const clientRef = useRef<SyncClient | null>(null);
//   const [users, setUsers] = useState<User[]>([]);
//   const [myUserId, setMyUserId] = useState<string>('');
//   const lastElementCountRef = useRef(0);
//   const isReceivingRef = useRef(false);

//   useEffect(() => {
//     // Only connect if user is authenticated
//     if (!user) return;

//     const client = new SyncClient('ws://localhost:3001');
//     clientRef.current = client;

//     // Handle sync state (initial state from server)
//     client.on('sync_state', (message) => {
//       if (message.type === 'sync_state') {
//         isReceivingRef.current = true;

//         // Clear existing elements and set server state
//         canvasStore.setState(() => ({
//           elements: message.elements,
//           selectedIds: [],
//           tool: 'selection',
//         }));

//         lastElementCountRef.current = message.elements.length;

//         // Set users
//         setUsers(message.users);

//         isReceivingRef.current = false;
//       }
//     });

//     // Handle new elements from other users
//     client.on('add_element', (message) => {
//       if (message.type === 'add_element') {
//         isReceivingRef.current = true;
//         addElement(message.element);
//         lastElementCountRef.current++;
//         isReceivingRef.current = false;
//       }
//     });

//     // Handle user join
//     client.on('user_join', (message) => {
//       if (message.type === 'user_join') {
//         setUsers(prev => [...prev, {
//           userId: message.userId,
//           userName: message.userName,
//           color: message.color,
//         }]);
//         // Note: myUserId is set from local user data, not server message for self
//       }
//     });

//     // Handle user leave
//     client.on('user_leave', (message) => {
//       if (message.type === 'user_leave') {
//         setUsers(prev => prev.filter(u => u.userId !== message.userId));
//       }
//     });

//     // Handle cursor movements
//     client.on('cursor_move', (message) => {
//       if (message.type === 'cursor_move') {
//         setUsers(prev => prev.map(u =>
//           u.userId === message.userId
//             ? { ...u, cursorX: message.x, cursorY: message.y }
//             : u
//         ));
//       }
//     });

//     // Connect to server
//     client.connect();

//     // Set my user ID from Clerk
//     setMyUserId(user.id);

//     // Subscribe to local store changes and broadcast to server
//     const unsubscribe = canvasStore.subscribe(() => {
//       // Don't broadcast if we're receiving updates from server
//       if (isReceivingRef.current) return;

//       const state = canvasStore.state;

//       // Check if new elements were added
//       if (state.elements.length > lastElementCountRef.current) {
//         // Get all new elements
//         const newElements = state.elements.slice(lastElementCountRef.current);

//         // Broadcast each new element
//         newElements.forEach((element) => {
//           const message: AddElementMessage = {
//             type: 'add_element',
//             element,
//             userId: user.id,
//             timestamp: Date.now(),
//           };

//           client.send(message);
//         });

//         lastElementCountRef.current = state.elements.length;
//       }
//     });

//     return () => {
//       unsubscribe();
//       client.disconnect();
//     };
//   }, [user]); // Re-run when user changes

//   const sendCursorMove = (x: number, y: number) => {
//     if (clientRef.current && clientRef.current.isConnected() && user) {
//       clientRef.current.send({
//         type: 'cursor_move',
//         x,
//         y,
//         userId: user.id,
//         timestamp: Date.now(),
//         userName: user.fullName || user.username || 'Anonymous',
//         color: '#000000', // Server should ideally assign/manage colors or we pick one based on ID
//       });
//     }
//   };

//   return { users, myUserId, sendCursorMove };
// };

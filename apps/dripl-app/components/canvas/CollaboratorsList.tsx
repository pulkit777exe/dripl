'use client';

import { useCanvasStore } from '@/lib/canvas-store';
import { getOrCreateCollaboratorName } from '@/utils/username';

interface CollaboratorsListProps {
  roomSlug: string | null;
}

const AVATAR_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;

type AvatarColor = (typeof AVATAR_COLORS)[number];

function getAvatarColor(userId: string): AvatarColor {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorIndex = Math.abs(hash) % AVATAR_COLORS.length;
  const color = AVATAR_COLORS[colorIndex];
  return color ?? AVATAR_COLORS[0];
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '??';

  const firstChar = trimmed[0];
  if (!firstChar) return '??';

  const spaceIndex = trimmed.indexOf(' ');

  if (spaceIndex > 0 && spaceIndex < trimmed.length - 1) {
    const secondChar = trimmed[spaceIndex + 1];
    if (secondChar) {
      return (firstChar + secondChar).toUpperCase();
    }
  }

  const secondChar = trimmed[1];
  return (firstChar + (secondChar ?? '')).toUpperCase();
}

export function CollaboratorsList({ roomSlug }: CollaboratorsListProps) {
  const remoteUsers = useCanvasStore(state => state.remoteUsers);
  const isConnected = useCanvasStore(state => state.isConnected);
  const userId = useCanvasStore(state => state.userId);

  if (roomSlug === null) return null;

  if (!isConnected && remoteUsers.size === 0) return null;

  const currentUserName = getOrCreateCollaboratorName();
  const currentUserColor = userId ? getAvatarColor(userId) : getAvatarColor('local-user');

  const allUsers = [
    ...Array.from(remoteUsers.values()).map(user => ({
      userId: user.userId,
      userName: user.userName,
      color: user.color,
      isCurrentUser: user.userId === userId,
    })),
  ];

  return (
    <div className="fixed top-4 right-4 flex items-center gap-2 pointer-events-auto">
      <div className="flex -space-x-2 overflow-hidden bg-background/80 backdrop-blur-sm p-1.5 rounded-full border shadow-lg">
        {/* Current user first */}
        <div
          className="relative w-8 h-8 rounded-full ring-2 ring-white flex items-center justify-center text-xs font-semibold select-none"
          style={{
            backgroundColor: currentUserColor + '30',
            borderColor: currentUserColor,
          }}
          title={`You (${currentUserName})`}
        >
          <span style={{ color: currentUserColor }}>{getInitials(currentUserName)}</span>
          <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
        </div>

        {allUsers.map(user => (
          <div
            key={user.userId}
            className="relative w-8 h-8 rounded-full ring-2 ring-white flex items-center justify-center text-xs font-semibold select-none"
            style={{
              backgroundColor: user.color + '30',
              borderColor: user.color,
            }}
            title={user.userName}
          >
            <span style={{ color: user.color }}>{getInitials(user.userName)}</span>
          </div>
        ))}
      </div>

      <div
        className={`px-2.5 py-1.5 rounded-full text-xs font-medium border ${
          isConnected
            ? 'bg-green-500/10 text-green-600 border-green-500/20'
            : 'bg-red-500/10 text-red-600 border-red-500/20'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <div
            className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
          />
          {isConnected ? 'Online' : 'Offline'}
        </div>
      </div>
    </div>
  );
}

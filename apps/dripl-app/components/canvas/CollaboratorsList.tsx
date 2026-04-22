'use client';

import { useState } from 'react';
import { X, ChevronDown, ChevronUp } from 'lucide-react';
import { useCanvasStore } from '@/lib/canvas-store';
import { getOrCreateCollaboratorName } from '@/utils/username';

interface CollaboratorsListProps {
  roomSlug: string | null;
  onLeaveRoom?: () => void;
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
  return AVATAR_COLORS[colorIndex] ?? AVATAR_COLORS[0];
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '??';
  const firstChar = trimmed[0];
  if (!firstChar) return '??';
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex > 0 && spaceIndex < trimmed.length - 1) {
    const secondChar = trimmed[spaceIndex + 1];
    if (secondChar) return (firstChar + secondChar).toUpperCase();
  }
  const secondChar = trimmed[1];
  return (firstChar + (secondChar ?? '')).toUpperCase();
}

export function CollaboratorsList({ roomSlug, onLeaveRoom }: CollaboratorsListProps) {
  const remoteUsers = useCanvasStore(state => state.remoteUsers);
  const isConnected = useCanvasStore(state => state.isConnected);
  const userId = useCanvasStore(state => state.userId);
  const [isExpanded, setIsExpanded] = useState(true);

  if (roomSlug === null) return null;
  if (!isConnected && remoteUsers.size === 0) return null;

  const currentUserName = getOrCreateCollaboratorName();
  const currentUserColor = userId ? getAvatarColor(userId) : getAvatarColor('local-user');

  const allUsers = Array.from(remoteUsers.values()).map(user => ({
    userId: user.userId,
    userName: user.userName,
    color: user.color,
  }));

  const hasCollaborators = allUsers.length > 0;

  return (
    <div className="fixed right-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3 pointer-events-auto z-50">
      {isExpanded && hasCollaborators && (
        <div className="flex flex-col items-center gap-2">
          {allUsers.map(user => (
            <div
              key={user.userId}
              className="relative w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shadow-md"
              style={{
                backgroundColor: user.color + '30',
                border: `2px solid ${user.color}`,
              }}
              title={user.userName}
            >
              <span style={{ color: user.color }}>{getInitials(user.userName)}</span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="p-2 rounded-full bg-[#FAFAF7] border border-[#E4E0D9] text-[#6B6860] hover:bg-[#E8E5DE] transition-colors shadow-sm"
        title={isExpanded ? 'Collapse' : 'Expand'}
      >
        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      <div
        className="relative w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shadow-md"
        style={{
          backgroundColor: currentUserColor + '30',
          border: `2px solid ${currentUserColor}`,
        }}
        title={`You (${currentUserName})`}
      >
        <span style={{ color: currentUserColor }}>{getInitials(currentUserName)}</span>
        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
      </div>

      {hasCollaborators && onLeaveRoom && (
        <button
          onClick={onLeaveRoom}
          className="p-2 rounded-full bg-[#FAFAF7] border border-[#E4E0D9] text-[#6B6860] hover:bg-[#FAE8E5] hover:border-[#E8462A] hover:text-[#E8462A] transition-colors shadow-sm"
          title="Stop Session"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

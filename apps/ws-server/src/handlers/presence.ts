import { z } from 'zod';
import type { Handler } from './types';
import { send } from '../broadcast';
import { followUserSchema, unfollowUserSchema, viewportUpdateSchema } from '../validation';

type ViewportUpdate = z.infer<typeof viewportUpdateSchema>;
type FollowUser = z.infer<typeof followUserSchema>;
type UnfollowUser = z.infer<typeof unfollowUserSchema>;

export const viewportUpdateHandler: Handler<typeof viewportUpdateSchema, ViewportUpdate> = {
  type: 'viewport-update',
  schema: viewportUpdateSchema,
  apply(msg, ctx) {
    ctx.room.viewports.set(ctx.userId, {
      panX: msg.panX,
      panY: msg.panY,
      zoom: msg.zoom,
    });
    // Broadcast only to followers of this user
    for (const [followerId, leaderId] of ctx.room.following) {
      if (leaderId === ctx.userId && followerId !== ctx.userId) {
        const follower = ctx.room.users.get(followerId);
        if (follower) {
          send(follower.ws, {
            type: 'viewport-update',
            userId: ctx.userId,
            panX: msg.panX,
            panY: msg.panY,
            zoom: msg.zoom,
          });
        }
      }
    }
  },
};

export const followUserHandler: Handler<typeof followUserSchema, FollowUser> = {
  type: 'follow-user',
  schema: followUserSchema,
  apply(msg, ctx) {
    ctx.room.following.set(ctx.userId, msg.targetUserId);
    // Send current viewport of target to follower
    const targetViewport = ctx.room.viewports.get(msg.targetUserId);
    if (targetViewport) {
      send(ctx.ws, {
        type: 'viewport-update',
        userId: msg.targetUserId,
        ...targetViewport,
      });
    }
  },
};

export const unfollowUserHandler: Handler<typeof unfollowUserSchema, UnfollowUser> = {
  type: 'unfollow-user',
  schema: unfollowUserSchema,
  apply(msg, ctx) {
    void msg;
    ctx.room.following.delete(ctx.userId);
  },
};

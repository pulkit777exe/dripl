import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

import { useCanvasStore } from '@/lib/store';
import { CollaboratorsList } from '@/components/canvas/CollaboratorsList';

/**
 * `CollaboratorsList` is a pure derivation of three store fields plus two hover
 * handlers that write CSS custom properties onto the avatar nodes. There is no
 * fetching and no async, so every test here drives the store directly and asserts
 * on what a user would see — which is the only thing this component really owns.
 *
 * The two guards at the top of the component (`roomSlug === null`,
 * `!isConnected && remoteUsers.size === 0`) are the interesting part: they decide
 * whether the panel appears at all, and both directions are wrong-looking enough
 * to be worth pinning in both directions.
 */

vi.mock('@/utils/username', () => ({
  getOrCreateCollaboratorName: () => 'Local Person',
}));

function peer(userId: string, userName: string, color = '#ff0000') {
  return { userId, userName, color };
}

function seed(opts: {
  roomSlug?: string | null;
  isConnected?: boolean;
  peers?: ReturnType<typeof peer>[];
  userId?: string | null;
}) {
  const remoteUsers = new Map((opts.peers ?? []).map(p => [p.userId, p]));
  useCanvasStore.setState({
    remoteUsers,
    isConnected: opts.isConnected ?? true,
    userId: opts.userId === undefined ? 'me' : opts.userId,
  });
}

/** The avatar stack, in DOM order. Each remote avatar carries a `title`. */
function avatarTitles(): string[] {
  return Array.from(document.querySelectorAll('.t-avatar')).map(
    el => el.getAttribute('title') ?? ''
  );
}

describe('CollaboratorsList', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    seed({ roomSlug: 'r1' });
  });

  it('renders nothing outside a room', () => {
    // Regression: this component is mounted by shared canvas chrome that is also
    // used by `/file/[id]` and the local canvas. If it rendered without a room it
    // would put a "collaborators" panel on a solo file canvas.
    seed({ roomSlug: null, peers: [peer('p1', 'Peer One')] });
    const { container } = render(<CollaboratorsList roomSlug={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when disconnected with no peers', () => {
    // Regression: an unconnected socket with an empty peer map is the steady
    // state of a local canvas. An empty shell would sit at the screen edge.
    seed({ roomSlug: 'r1', isConnected: false, peers: [] });
    const { container } = render(<CollaboratorsList roomSlug="r1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the local avatar once connected even with no peers', () => {
    // The control for the guard above. `!isConnected && size === 0` must not
    // become `size === 0`: a connected room with nobody else in it still has to
    // tell you that *you* are in it, and the connection dot lives on this avatar.
    seed({ roomSlug: 'r1', isConnected: true, peers: [] });
    render(<CollaboratorsList roomSlug="r1" />);
    expect(screen.getByTitle('You (Local Person)')).toBeInTheDocument();
    expect(document.querySelectorAll('.t-avatar')).toHaveLength(0);
  });

  it('shows disconnected peers rather than hiding the panel', () => {
    // Regression: the guard is a conjunction, so a dropped socket must not make
    // everyone already in the room vanish from the list — they are still there,
    // and their presence is the only cue that the session is not yours alone.
    seed({ roomSlug: 'r1', isConnected: false, peers: [peer('p1', 'Peer One')] });
    render(<CollaboratorsList roomSlug="r1" />);
    expect(avatarTitles()).toEqual(['Peer One']);
  });

  it('gives a peer with no name a placeholder rather than rendering undefined', () => {
    // Regression: `getInitials` indexes into the name, and an empty name is
    // reachable — the socket accepts a join without a display name. Rendering
    // `undefined` into the DOM, or a bare `undefined` title, is what that looks
    // like, and `getInitials` exists precisely to prevent it.
    seed({ roomSlug: 'r1', peers: [peer('p1', '')] });
    render(<CollaboratorsList roomSlug="r1" />);
    const span = document.querySelector('.t-avatar span');
    expect(span?.textContent).toBe('??');
    expect(span?.textContent).not.toContain('undefined');
  });

  it('takes initials from the first two words, or the first two letters', () => {
    // Regression: `getInitials` has three branches — two words, one word, blank.
    // Two of them collapsing to the same wrong answer still looks plausible in a
    // screenshot, so each is asserted.
    seed({
      roomSlug: 'r1',
      peers: [
        peer('a', 'ada lovelace', '#111111'),
        peer('b', 'bob', '#222222'),
        peer('c', '  ', '#333333'),
      ],
    });
    render(<CollaboratorsList roomSlug="r1" />);
    const initials = Array.from(document.querySelectorAll('.t-avatar span')).map(
      el => el.textContent
    );
    expect(initials).toEqual(['AL', 'BO', '??']);
  });

  it('does not treat a trailing space as a second word', () => {
    // Regression: `indexOf(' ') > length - 1` is what stops 'bob ' producing
    // 'B'. Without that bound the second character is `undefined` and the label
    // renders 'BUNDEFINED'.
    seed({ roomSlug: 'r1', peers: [peer('a', 'bob ')] });
    render(<CollaboratorsList roomSlug="r1" />);
    expect(document.querySelector('.t-avatar span')?.textContent).toBe('BO');
  });

  it('offers "Stop Session" only when there are peers and a handler', () => {
    // Regression: a leave button on a solo canvas would call a room-leave route
    // for a room the user never joined. Both halves of the conjunction are
    // asserted because either alone leaves a button that 404s.
    const onLeaveRoom = vi.fn();
    seed({ roomSlug: 'r1', peers: [] });
    const { rerender } = render(<CollaboratorsList roomSlug="r1" onLeaveRoom={onLeaveRoom} />);
    expect(screen.queryByTitle('Stop Session')).toBeNull();

    // Peers but no handler: still nothing to click.
    act(() => seed({ roomSlug: 'r1', peers: [peer('p1', 'Peer One')] }));
    rerender(<CollaboratorsList roomSlug="r1" />);
    expect(screen.queryByTitle('Stop Session')).toBeNull();

    // Both present: the button appears and calls through.
    act(() => seed({ roomSlug: 'r1', peers: [peer('p1', 'Peer One')] }));
    rerender(<CollaboratorsList roomSlug="r1" onLeaveRoom={onLeaveRoom} />);
    fireEvent.click(screen.getByTitle('Stop Session'));
    expect(onLeaveRoom).toHaveBeenCalledTimes(1);
  });

  it('drops a peer who leaves mid-session', () => {
    // Regression: the list is derived from `remoteUsers`, which the socket clears
    // on a `user-left` message. If the component snapshotted the peers into
    // state at mount, a departed collaborator would stay on screen for the rest
    // of the session.
    seed({ roomSlug: 'r1', peers: [peer('p1', 'Peer One'), peer('p2', 'Peer Two')] });
    render(<CollaboratorsList roomSlug="r1" />);
    expect(avatarTitles()).toEqual(['Peer One', 'Peer Two']);

    act(() => {
      useCanvasStore.getState().removeRemoteUser('p2');
    });
    expect(avatarTitles()).toEqual(['Peer One']);
  });

  it('collapses and expands the peer stack', () => {
    // Regression: `isExpanded` drives both the panel's `data-open` and the
    // button's title. A toggle that flipped one but not the other would leave the
    // chevron pointing the wrong way.
    seed({ roomSlug: 'r1', peers: [peer('p1', 'Peer One')] });
    const { container } = render(<CollaboratorsList roomSlug="r1" />);
    const panel = container.querySelector('[data-open]');
    expect(panel?.getAttribute('data-open')).toBe('true');
    expect(screen.getByTitle('Collapse')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Collapse'));
    expect(container.querySelector('[data-open]')?.getAttribute('data-open')).toBe('false');
    expect(screen.getByTitle('Expand')).toBeInTheDocument();
  });

  describe('avatar hover lift', () => {
    // jsdom answers '' for every custom property on getComputedStyle, so
    // `parseFloat('') || fallback` resolves to the component's built-in defaults:
    // lift -4, falloff 0.45, scale 1.05. The numbers below are those defaults
    // computed by hand, which is what makes this deterministic without a stub.
    const LIFT = -4;
    const FALLOFF = 0.45;

    it('lifts the hovered avatar most and falls off with distance', () => {
      // Regression: `--shift` is written per avatar with a `falloff ** distance`
      // curve, and only the hovered node gets the scale. A single shared value
      // would make the whole stack jump on hover, which is the visual bug this
      // curve exists to avoid.
      seed({
        roomSlug: 'r1',
        peers: [peer('a', 'Alpha'), peer('b', 'Bravo'), peer('c', 'Charlie'), peer('d', 'Delta')],
      });
      render(<CollaboratorsList roomSlug="r1" />);
      const avatars = Array.from(document.querySelectorAll('.t-avatar')) as HTMLElement[];

      // Hover the first, so the other three sit at distance 1, 2 and 3 and the
      // curve is actually distinguishable. Hovering a middle avatar would put
      // its neighbours at the same distance and give them equal shifts.
      fireEvent.mouseEnter(avatars[0]!);

      const shift = (el: HTMLElement) => el.style.getPropertyValue('--shift');
      const scale = (el: HTMLElement) => el.style.getPropertyValue('--scale-active');

      expect(shift(avatars[0]!)).toBe(`${LIFT.toFixed(3)}px`);
      expect(shift(avatars[1]!)).toBe(`${(LIFT * FALLOFF).toFixed(3)}px`);
      expect(shift(avatars[2]!)).toBe(`${(LIFT * FALLOFF ** 2).toFixed(3)}px`);
      expect(shift(avatars[3]!)).toBe(`${(LIFT * FALLOFF ** 3).toFixed(3)}px`);

      // Strictly decreasing magnitude with distance: the falloff is what keeps a
      // four-avatar stack from lifting as one block.
      const px = (el: HTMLElement) => Math.abs(parseFloat(shift(el)));
      expect(px(avatars[1]!)).toBeLessThan(px(avatars[0]!));
      expect(px(avatars[3]!)).toBeLessThan(px(avatars[2]!));

      expect(scale(avatars[0]!)).toBe('1.05');
      expect(scale(avatars[1]!)).toBe('1');
      expect(scale(avatars[3]!)).toBe('1');
    });

    it('resets every avatar when the pointer leaves the group', () => {
      // Regression: without the group-level `onMouseLeave` reset, whichever
      // avatar was last hovered stays lifted and scaled after the pointer moves
      // away, because nothing else clears those properties.
      seed({ roomSlug: 'r1', peers: [peer('a', 'Alpha'), peer('b', 'Bravo')] });
      const { container } = render(<CollaboratorsList roomSlug="r1" />);
      const avatars = Array.from(document.querySelectorAll('.t-avatar')) as HTMLElement[];

      fireEvent.mouseEnter(avatars[0]!);
      expect(avatars[0]!.style.getPropertyValue('--shift')).not.toBe('0px');

      const group = container.querySelector('[data-open]')!;
      fireEvent.mouseLeave(group);

      for (const avatar of avatars) {
        expect(avatar.style.getPropertyValue('--shift')).toBe('0px');
        expect(avatar.style.getPropertyValue('--scale-active')).toBe('1');
      }
    });

    it('uses a different easing curve entering and leaving', () => {
      // Regression: enter and leave deliberately use different easings — a fast
      // overshoot on the way back. Both writes go to `transitionTimingFunction`,
      // so a copy-paste that unified them is invisible in a screenshot.
      seed({ roomSlug: 'r1', peers: [peer('a', 'Alpha')] });
      const { container } = render(<CollaboratorsList roomSlug="r1" />);
      const avatar = document.querySelector('.t-avatar') as HTMLElement;
      const group = container.querySelector('[data-open]')!;

      fireEvent.mouseEnter(avatar);
      const enterEase = avatar.style.transitionTimingFunction;

      fireEvent.mouseLeave(group);
      const leaveEase = avatar.style.transitionTimingFunction;

      expect(enterEase).not.toBe('');
      expect(leaveEase).not.toBe('');
      expect(enterEase).not.toBe(leaveEase);
    });
  });

  it('colours the local avatar from the user id, and from a fallback when absent', () => {
    // Regression: `userId` is null until the socket handshake completes, so the
    // avatar must not hash `null`. It falls back to a fixed string instead —
    // which also means the colour is stable across the handshake rather than
    // flickering when the real id arrives.
    //
    // jsdom normalises inline `border` to `rgb(...)`, so the assertion is on that
    // shape. What matters is stability, not the specific hue: the same id must
    // always give the same colour or the avatar changes on every remount.
    const borderOf = () => screen.getByTitle('You (Local Person)').style.border;

    seed({ roomSlug: 'r1', peers: [], userId: null });
    const { unmount } = render(<CollaboratorsList roomSlug="r1" />);
    const anonymous = borderOf();
    expect(anonymous).toMatch(/^2px solid rgb\(\d+, \d+, \d+\)$/);
    unmount();

    // A second anonymous mount must agree with the first: the fallback is a
    // constant, so this is reproducible across remounts and across peers.
    render(<CollaboratorsList roomSlug="r1" />);
    expect(borderOf()).toBe(anonymous);
  });
});

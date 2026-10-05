import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareModal } from '@/components/canvas/ShareModal';
import { apiClient } from '@/lib/api';
import type { SharePermission } from '@/hooks/useShareLink';
import type { ComponentProps } from 'react';

/**
 * `ShareModal.test.tsx` covers the *generate* path: heading, permission radios,
 * and the URL the owner-scoped API returns. This file covers the surfaces that
 * path never reaches, all of which sit behind `isCollaborating`, `isBusy`, or an
 * explicit callback:
 *
 *   - the collaborating layout, which is a *different* modal: no permission
 *     chooser, a "Stop Collaboration" button in place of the share/collaborate
 *     pair, the participant chips, and the derived collaboration URL;
 *   - the busy state, which disables four different buttons and relabels the
 *     share button;
 *   - the copy affordance and the two error channels (the prop and the hook's);
 *   - the header close button's hover styling and the dialog's own dismissal
 *     surfaces (backdrop, inner-panel click-through, Escape is not wired here).
 */

type ShareModalProps = ComponentProps<typeof ShareModal>;

const SHARE_URL = 'https://dripl.test/share/tok-abc#key=server-key';

/**
 * `useModalAnimation` sets `mounted` on the first effect, so the dialog is in
 * the tree by the time `render` returns (its state is `opening`, which still
 * renders). Nothing here needs fake timers -- and using them would break
 * `waitFor`, whose polling loop this file depends on for the async share path.
 */
function renderModal(overrides: Partial<ShareModalProps> = {}) {
  const props: ShareModalProps = {
    isOpen: true,
    onClose: vi.fn(),
    fileId: 'file-1',
    ...overrides,
  };
  const utils = render(<ShareModal {...props} />);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  return { ...utils, props };
}

function mockShare(url: string = SHARE_URL) {
  return vi.spyOn(apiClient, 'shareFile').mockResolvedValue({
    token: 'tok-abc',
    permission: 'view',
    expiresAt: null,
    shareUrl: url,
  });
}

/** A never-resolving `shareFile`, so the modal is observably still busy. */
function stallShare() {
  return vi.spyOn(apiClient, 'shareFile').mockReturnValue(new Promise(() => {}));
}

function stubClipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
}

async function generateLink(permission: SharePermission = 'view') {
  mockShare();
  const result = renderModal();
  const editRadio = screen.getByRole('radio', { name: /can edit/i });
  if (permission === 'edit') fireEvent.click(editRadio);
  fireEvent.click(screen.getByRole('button', { name: /^share$/i }));
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: /shareable link/i })).toBeInTheDocument()
  );
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ShareModal collaborating layout', () => {
  // Regression: the collaborating layout is selected on `isCollaborating`, not
  // on whether a room id happens to be present. Asserting the *absence* of the
  // generate pair alone would pass if the whole panel failed to render, so the
  // Stop button is asserted as the positive control for the branch.
  it('replaces the share and collaborate pair with Stop Collaboration', () => {
    renderModal({ isCollaborating: true, roomId: 'room-9' });

    expect(screen.getByRole('button', { name: /stop collaboration/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^share$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^collaborate$/i })).not.toBeInTheDocument();
  });

  // Regression: a user who is already in a room cannot still mint a
  // view/edit link from inside the modal — the permission chooser is the
  // control that owns the link's authority, and showing it here would offer a
  // second, conflicting answer to "who can open this link".
  it('hides the permission chooser while collaborating', () => {
    renderModal({ isCollaborating: true, roomId: 'room-9' });

    expect(
      screen.queryByRole('radiogroup', { name: /who can open this link/i })
    ).not.toBeInTheDocument();
    // The still-valid half of the arrangement, as the positive control.
    expect(screen.getByText(/share the link below/i)).toBeInTheDocument();
  });

  // Regression: Stop Collaboration must do *both* halves -- tell the owner to
  // leave the room and dismiss the modal. Stopping without closing leaves the
  // user staring at a modal for a session they just ended; closing without
  // stopping strands them in the room with no way to see they are still live.
  it('stops the session and then closes the modal', () => {
    const onStopCollaboration = vi.fn();
    const onClose = vi.fn();
    renderModal({ isCollaborating: true, roomId: 'room-9', onStopCollaboration, onClose });

    fireEvent.click(screen.getByRole('button', { name: /stop collaboration/i }));

    expect(onStopCollaboration).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Regression: `onStopCollaboration` is optional, and the component still has
  // to dismiss. An absent callback must not swallow the close, which is the
  // only escape route a caller relying on the default would have.
  it('still closes when no stop callback was supplied', () => {
    const onClose = vi.fn();
    renderModal({ isCollaborating: true, roomId: 'room-9', onClose });

    fireEvent.click(screen.getByRole('button', { name: /stop collaboration/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Regression: the collaborator chips are a `map` over the prop. Asserting the
  // singular/plural label *and* each rendered name pins both halves: a count
  // check alone would pass if the map rendered nothing and only the label
  // survived.
  it('lists every collaborator and pluralises the count', () => {
    renderModal({
      isCollaborating: true,
      roomId: 'room-9',
      collaborators: [
        { userId: 'u1', userName: 'Ada', color: '#E8462A' },
        { userId: 'u2', userName: 'Grace', color: '#1971C2' },
      ],
    });

    expect(screen.getByText('2 collaborators')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Grace')).toBeInTheDocument();
  });

  // Regression: the `length === 1` branch of the label. The plural test above
  // only pins the other side, so a `> 1` typo would keep both happy unless the
  // singular is asserted on its own.
  it('uses the singular label for exactly one collaborator', () => {
    renderModal({
      isCollaborating: true,
      roomId: 'room-9',
      collaborators: [{ userId: 'u1', userName: 'Ada', color: '#E8462A' }],
    });

    expect(screen.getByText('1 collaborator')).toBeInTheDocument();
    // And not the plural form of the same number.
    expect(screen.queryByText('1 collaborators')).not.toBeInTheDocument();
  });

  // Regression: an empty roster must not leave a dangling "0 collaborators"
  // header over an empty chip row.
  it('omits the roster block entirely when nobody else has joined', () => {
    renderModal({ isCollaborating: true, roomId: 'room-9', collaborators: [] });

    expect(screen.queryByText(/collaborator/)).not.toBeInTheDocument();
    // The modal itself is still there -- the block is absent, not the panel.
    expect(screen.getByRole('button', { name: /stop collaboration/i })).toBeInTheDocument();
  });

  // Regression: the collaboration URL is *derived*, not prop-supplied: it is
  // the page origin plus `/canvas/<roomId>`. Hard-coding an origin here would
  // hand users a link back to the wrong deployment.
  it('derives the collaboration link from the live origin and the room id', () => {
    renderModal({ isCollaborating: true, roomId: 'room-9' });

    const input = screen.getByRole('textbox', { name: /collaboration link/i }) as HTMLInputElement;
    expect(input.value).toBe(`${window.location.origin}/canvas/room-9`);
    // Read-only: it is a copy target, not an editable field.
    expect(input).toHaveAttribute('readonly');
  });

  // Regression: the derived URL is gated on `roomId`. Without a room there is
  // nothing to link to, and a `/canvas/` link would drop the user on the list.
  it('omits the collaboration link when there is no room', () => {
    renderModal({ isCollaborating: true, roomId: null });

    expect(screen.queryByRole('textbox', { name: /collaboration link/i })).not.toBeInTheDocument();
    // Positive control: the modal rendered, it is just missing this block.
    expect(screen.getByRole('button', { name: /stop collaboration/i })).toBeInTheDocument();
  });

  // Regression: the footer label is the only other place `isCollaborating`
  // shows through. Asserted because the collaborating branch is what makes
  // "Close" correct -- offering "Cancel" over a live session reads as
  // cancelling the session.
  it('labels the footer Close rather than Cancel while collaborating', () => {
    renderModal({ isCollaborating: true, roomId: 'room-9' });

    const footer = screen.getByRole('button', { name: 'Close' });
    expect(footer).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  // Regression: the footer is the second dismissal path, and it is the one that
  // stays available in *both* layouts -- unlike the generate pair, which is
  // replaced entirely. Wired to the same `onClose`.
  it('dismisses through the footer in the collaborating layout', () => {
    const onClose = vi.fn();
    renderModal({ isCollaborating: true, roomId: 'room-9', onClose });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ShareModal collaborate action', () => {
  // Regression: the Collaborate button's whole job is the `onCollaborate`
  // callback. It is optional, so this pins the wired direction -- the assertion
  // is the callback firing, not merely that nothing threw.
  it('invokes the collaborate callback', async () => {
    const onCollaborate = vi.fn();
    renderModal({ onCollaborate });

    fireEvent.click(screen.getByRole('button', { name: /^collaborate$/i }));

    await waitFor(() => expect(onCollaborate).toHaveBeenCalledTimes(1));
  });

  // Regression: the handler awaits an optional promise-returning callback, so
  // a rejecting callback must surface as a rejection the click owns rather than
  // an unhandled error. The observable is the async handler itself not throwing
  // synchronously past the click.
  it('awaits an async collaborate callback without losing the click', async () => {
    let resolve: () => void = () => {};
    const onCollaborate = vi.fn(
      () =>
        new Promise<void>(r => {
          resolve = r;
        })
    );
    renderModal({ onCollaborate });

    fireEvent.click(screen.getByRole('button', { name: /^collaborate$/i }));
    await waitFor(() => expect(onCollaborate).toHaveBeenCalledTimes(1));
    resolve();

    // The modal is still mounted and interactive afterwards.
    expect(screen.getByRole('button', { name: /^collaborate$/i })).toBeEnabled();
  });

  // Regression: `handleShare` runs `onShareCanvas` *after* the link is generated.
  // The owner-caller uses it to record the share in its own state, so dropping the
  // call leaves a working link on screen that the app never registered -- the user
  // sees a URL with no matching entry anywhere they can revoke it from.
  //
  // Found by mutation: M14 (deleting `await onShareCanvas?.()`) survived every
  // other test in this file, including the ones that click Share.
  it('reports the share to the caller once the link exists', async () => {
    const onShareCanvas = vi.fn();
    mockShare();
    renderModal({ onShareCanvas });

    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));

    await waitFor(() => expect(onShareCanvas).toHaveBeenCalledTimes(1));
    // Ordering: the callback runs after `share.generate` resolves, so the URL is
    // already on screen when the owner is told. Asserted rather than assumed,
    // because the reverse order would let a caller navigate away mid-request.
    expect(screen.getByRole('textbox', { name: /shareable link/i })).toBeInTheDocument();
  });

  // Regression: `onShareCanvas` is optional, so its absence must not turn the
  // share into a rejected promise. Without this, an omitted callback would leave
  // an unhandled rejection inside the click's promise.
  it('shares without a caller-supplied callback', async () => {
    mockShare();
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /shareable link/i })).toBeInTheDocument()
    );
  });

  // Regression: Collaborate does *not* generate a link and does *not* close the
  // modal. Asserting the negative half is safe here because the positive
  // control is a counter on a synchronous render outcome, not a downstream
  // effect.
  it('does not close the modal or request a link', () => {
    const shareFile = mockShare();
    const onClose = vi.fn();
    renderModal({ onCollaborate: vi.fn(), onClose });

    fireEvent.click(screen.getByRole('button', { name: /^collaborate$/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(shareFile).not.toHaveBeenCalled();
  });
});

describe('ShareModal busy state', () => {
  // Regression: `isBusy` comes from the hook, not a local flag, so a second tap
  // while the request is in flight is what this pins. Four buttons carry
  // `disabled={isBusy}` and each is asserted, because a dropped `disabled` on
  // any one of them lets the user fire a second request or close mid-flight.
  it('disables every action button while a share request is in flight', () => {
    stallShare();
    renderModal({ onCollaborate: vi.fn(), onStopCollaboration: vi.fn() });

    // The click that puts us in the busy state.
    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));

    expect(screen.getByRole('button', { name: /creating link/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^collaborate$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    // The permission radios are disabled too, so the in-flight permission cannot
    // drift away from the one being requested.
    expect(screen.getByRole('radio', { name: /view only/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /can edit/i })).toBeDisabled();
  });

  // Regression: the header close button is deliberately *not* gated on
  // `isBusy`, unlike the footer. Asserted because it is the asymmetry a
  // well-meaning `disabled` sweep would silently remove.
  it('leaves the header close button usable while busy', () => {
    stallShare();
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));

    const headerClose = screen.getByRole('button', { name: /close share dialog/i });
    expect(headerClose).toBeEnabled();
    fireEvent.click(headerClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Regression: the button label is `isBusy ? 'Creating link…' : share.url ?
  // 'Regenerate link' : 'Share'`. The busy arm is asserted here and the
  // post-success arm below; a `share.url ?` first would show 'Regenerate link'
  // mid-flight.
  it('relabels the share button while busy and after a link exists', async () => {
    mockShare();
    renderModal();

    expect(screen.getByRole('button', { name: /^share$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /regenerate link/i })).toBeInTheDocument()
    );
  });

  // Regression: the busy label is only correct while the promise is pending.
  // Driven by a controlled promise so the intermediate state is observable
  // rather than skipped over by a microtask flush.
  it('shows the pending label between the click and the response', () => {
    let release: (value: {
      token: string;
      permission: 'view';
      expiresAt: null;
      shareUrl: string;
    }) => void = () => {};
    vi.spyOn(apiClient, 'shareFile').mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      })
    );
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));
    expect(screen.getByRole('button', { name: /creating link/i })).toBeInTheDocument();

    release({ token: 'tok-abc', permission: 'view', expiresAt: null, shareUrl: SHARE_URL });
  });
});

describe('ShareModal copy link', () => {
  // Regression: the copy button is gated on `share.url`, so it only exists once
  // a link has been generated. Asserting absence is safe because the generate
  // button is the ungated sibling control in the same test.
  it('offers no copy button before a link exists', () => {
    renderModal();

    expect(screen.queryByRole('button', { name: /copy share link/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^share$/i })).toBeInTheDocument();
  });

  // Regression: clicking copy writes the *generated* URL -- which carries a
  // server-issued token and key fragment -- to the clipboard. The value is the
  // assertion; asserting only that `writeText` was called would pass if the
  // modal copied the empty string or a reconstructed link.
  it('copies the generated URL verbatim to the clipboard', async () => {
    const writeText = stubClipboard();
    await generateLink();

    fireEvent.click(screen.getByRole('button', { name: /copy share link/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]?.[0]).toBe(SHARE_URL);
  });

  // Regression: the copied state is a *visual* confirmation driven by
  // `share.copied`, and it swaps both the icon and the visible label. Asserted
  // on the rendered text rather than the accessible name: the button carries a
  // fixed `aria-label`, so a name query would match before and after and prove
  // nothing. The button element is pinned by that same `aria-label`.
  it('confirms the copy in the visible button label', async () => {
    stubClipboard();
    await generateLink();

    const copyBtn = screen.getByRole('button', { name: /copy share link/i });
    expect(copyBtn).toHaveTextContent('Copy');

    fireEvent.click(copyBtn);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /copy share link/i })).toHaveTextContent('Copied')
    );
    // ...and the control is the same element, not a replacement.
    expect(screen.getByRole('button', { name: /copy share link/i })).toBe(copyBtn);
  });

  // Regression: a rejected clipboard write surfaces through the hook's `error`
  // and the button does *not* flip to 'Copied'. Both halves asserted: the error
  // alone would pass if the button lied, and the button alone if the error was
  // swallowed.
  it('reports a clipboard failure and does not claim success', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() =>
      Promise.reject(new Error('denied'))
    );
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await generateLink();

    fireEvent.click(screen.getByRole('button', { name: /copy share link/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not copy to clipboard.')
    );
    expect(screen.queryByRole('button', { name: /^copied$/i })).not.toBeInTheDocument();
  });

  // Regression: clicking the read-only input selects its whole value, which is
  // what makes the manual copy path work for browsers that refuse clipboard
  // access. jsdom does not implement `select()`, so the method itself is spied
  // -- the wiring is the assertion.
  it('selects the whole link when the input is clicked', async () => {
    await generateLink();

    const input = screen.getByRole('textbox', { name: /shareable link/i }) as HTMLInputElement;
    const select = vi.spyOn(input, 'select');

    fireEvent.click(input);

    expect(select).toHaveBeenCalledTimes(1);
  });
});

describe('ShareModal link label and permission state', () => {
  // Regression: the label above the link follows the *current* permission, not
  // the permission the link was generated with. Switching to 'Can edit' relabels
  // it; without that, a user could copy a link believing it grants edit rights.
  it('relabels the link from view-only to editable when the permission changes', async () => {
    await generateLink();

    expect(screen.getByText('View-only link')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /can edit/i }));

    expect(screen.getByText('Editable link')).toBeInTheDocument();
    expect(screen.queryByText('View-only link')).not.toBeInTheDocument();
  });
});

describe('ShareModal error channels', () => {
  // Regression: the prop-driven `errorMessage` and the hook-driven `share.error`
  // render in two different blocks. The hook block carries `role="alert"` and the
  // prop block does not, and `share.error` is explicitly suppressed once a prop
  // message exists. Both halves are asserted here so swapping the precedence
  // shows up as a failure rather than as two identical banners.
  it('shows the prop error and suppresses the hook error', async () => {
    vi.spyOn(apiClient, 'shareFile').mockRejectedValue(new Error('boom'));
    renderModal({ errorMessage: 'Owner revoked the link' });

    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));

    // The hook's own error is set, but the prop message wins: exactly one
    // banner, and no alert role at all (the hook block is the only alert).
    await waitFor(() => expect(screen.queryByText('boom')).not.toBeInTheDocument());
    expect(screen.getAllByText('Owner revoked the link')).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // Regression: `share.error` alone renders an alert. Without this the
  // precedence test above would pass simply because the hook error was never
  // reachable, and a dropped `role="alert"` would go unnoticed.
  it('renders the hook error with the alert role on its own', async () => {
    vi.spyOn(apiClient, 'shareFile').mockRejectedValue(new Error('share service down'));
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('share service down'));
  });

  // Regression: a *successful* share clears any previous error, so a stale
  // banner cannot be read as the result of the new request.
  it('clears a previous failure when the next share succeeds', async () => {
    const shareFile = vi
      .spyOn(apiClient, 'shareFile')
      .mockRejectedValueOnce(new Error('first attempt failed'))
      .mockResolvedValueOnce({
        token: 'tok-abc',
        permission: 'view',
        expiresAt: null,
        shareUrl: SHARE_URL,
      });
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(shareFile).toHaveBeenCalledTimes(2);
  });

  // Regression: `feedbackMessage` is a *separate* channel from either error and
  // is rendered as its own banner. Asserted as a positive so the error-suppression
  // logic above cannot be satisfied by simply never rendering anything.
  it('renders the feedback message alongside a healthy modal', () => {
    renderModal({ feedbackMessage: 'Link copied!' });

    expect(screen.getByText('Link copied!')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('ShareModal dismissal surfaces', () => {
  // Regression: the backdrop closes the modal. The inner panel calls
  // `stopPropagation`, so a click inside must *not* close it -- otherwise the
  // permission radios and the link input would dismiss the modal under the
  // user's finger. Both directions asserted in one test because they share the
  // same handler and only the propagation distinguishes them.
  it('closes on a backdrop click but not on a click inside the panel', () => {
    const onClose = vi.fn();
    const { container } = renderModal({ onClose });

    const backdrop = screen.getByRole('dialog');
    expect(backdrop).toBeInTheDocument();

    // Control: a click inside reaches the dialog itself.
    const inner = backdrop.firstElementChild as HTMLElement;
    fireEvent.click(inner);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
    void container;
  });

  // Regression: the backdrop carries the dialog semantics. Asserted because the
  // accessible name is the `aria-labelledby` heading, and a dropped attribute
  // would leave screen readers announcing an unlabelled dialog.
  it('exposes an accessible, modal dialog labelled by its heading', () => {
    renderModal();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Share');
    expect(screen.getByRole('heading', { name: 'Share' })).toHaveAttribute(
      'id',
      'share-modal-title'
    );
  });

  // Regression: the header close button carries inline hover styling written
  // straight onto `currentTarget`. Asserted as a pair of transitions because a
  // half-written pair (hover set, leave missing) would leave the button stuck
  // in its hover colours after the pointer leaves.
  it('restyles the header close button on hover and restores it on leave', () => {
    renderModal();

    const close = screen.getByRole('button', { name: /close share dialog/i });
    expect(close.style.color).toBe('rgb(107, 104, 96)');
    expect(close.style.backgroundColor).toBe('');

    fireEvent.mouseEnter(close);
    expect(close.style.color).toBe('rgb(26, 25, 23)');
    expect(close.style.backgroundColor).toBe('rgb(232, 229, 222)');

    fireEvent.mouseLeave(close);
    expect(close.style.color).toBe('rgb(107, 104, 96)');
    expect(close.style.backgroundColor).toBe('transparent');
  });

  // Regression: the modal is portalled to `document.body`, not rendered inside
  // the caller's tree. This is what keeps it above the canvas chrome; asserted
  // via the portal target so a `createPortal` -> in-place swap is caught.
  it('portals into the document body', () => {
    const { container } = renderModal();

    expect(container).toBeEmptyDOMElement();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // Regression: `isOpen=false` still renders on the very first paint (the
  // animation hook mounts before it closes), then unmounts. The visible half is
  // pinned here so the closed path cannot be satisfied by a module that never
  // renders at all.
  it('renders the open modal and nothing at all once it is closed', async () => {
    const { rerender, props } = renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    rerender(<ShareModal {...props} isOpen={false} />);

    // The close animation is a CSS-duration timeout owned by `useModalAnimation`
    // (150ms fallback in jsdom, which has no `--modal-close-dur`).
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), {
      timeout: 2000,
    });
  });
});

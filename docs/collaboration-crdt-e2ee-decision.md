# Collaboration architecture decision: convergence and E2EE

**Date:** 2026-09-25  
**Status:** Proposed; no protocol or product claim is changed by this note  
**Resolution update (2026-09-28):** the dormant Yjs adapter described below was deleted from both client and server (~400 lines plus `yjs`/`y-protocols`/`y-websocket` deps) after verifying the flag gated only reads. The analysis below stands as the re-entry reference; there is no flag left to flip.
**Dripl baseline:** current uncommitted workspace  
**External baseline:** `@excalidraw/excalidraw` / Excalidraw app `v0.18.1`, commit `a2ec2889babf7d2295469c6d90ebe77fae57df84`

**Evidence note:** Any targeted test counts in this decision record are the
original author's recorded runs. The documentation-inventory pass did not
rerun them; they are not being presented as fresh runtime verification. Dripl
line references are snapshot anchors in an actively edited tree; prefer the
named symbol/file when checking current source.

## Decision summary

1. **Make the current JSON protocol canonical and harden it into an Excalidraw-style, deterministic whole-element reconciliation protocol.** This is the recommended path for the current product scope.
2. **Do not call that protocol a CRDT.** It is register-style per-element conflict resolution. It does not provide CRDT operation logs, property-level merges, or arbitrary offline convergence.
3. **Keep Yjs disabled. Do not run JSON and Yjs as co-authorities.** The current adapter is a dormant mirror, not a working Yjs provider. Enabling its flag would be unsafe. Reconsider Yjs only as a ground-up replacement if Dripl commits to hard requirements such as long-lived offline editing, rich-text CRDT semantics, or decentralized update synchronization.
4. **Treat convergence and E2EE as separate decisions.** Dripl's current authenticated collaboration is application-layer plaintext. It is not E2EE. A future E2EE room must be a separately identified protocol and persistence mode; application-layer encryption cannot simply be added while preserving a server-authoritative, server-validating plaintext scene model.
5. **Until the implementation and release gates below pass, Dripl may claim only real-time JSON collaboration (and encrypted share-snapshot envelopes at the API boundary).** It must not claim CRDT convergence, Yjs collaboration, E2EE collaboration, zero knowledge, encrypted database storage, or Excalidraw collaboration compatibility.

This recommendation supersedes the tentative “enable a tested Yjs handshake” item in `docs/codebase-audit.md`. Yjs may be re-evaluated, but it is not the recommended v2 path.

## 1. Evidence from Excalidraw v0.18.1

### 1.1 The package and hosted app are different surfaces

The stable React package explicitly says collaboration is host-specific and is not built in. Real-time collaboration, E2EE, PWA/offline behavior, and share links are listed as features of the hosted `excalidraw.com` app, not automatic package capabilities. Mounting the package does not supply the protocol, persistence, identity, authorization, or key management.

- [Package FAQ, v0.18.1, lines 3–5](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/dev-docs/docs/@excalidraw/excalidraw/faq.mdx#L3-L5)
- [README package/app boundary, v0.18.1, lines 55–84](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/README.md#L55-L84)

### 1.2 Stable collaboration is deterministic reconciliation, not Yjs/CRDT sync

The stable app's collaboration path calls `reconcileElements`; the reviewed package and app do not use Yjs or `y-websocket`.

Each element has:

- a sequential `version`;
- a regenerated `versionNonce` for a same-version tie;
- a fractional ordering index;
- an `isDeleted` tombstone state.

Every real mutation increments the version and regenerates the nonce. Deletion creates a new version with `isDeleted: true`; it is not an unversioned physical delete.

- [Element collaboration metadata, v0.18.1, lines 56–67](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/element/types.ts#L56-L67)
- [Version/nonce generation, v0.18.1, lines 125–140](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/element/mutateElement.ts#L125-L140)
- [Deletion is a versioned element state, v0.18.1, lines 82–99](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/actions/actionDeleteSelected.tsx#L82-L99)
- [Reconciliation rule, v0.18.1, lines 19–40](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/data/reconcile.ts#L19-L40)
- [Union/reconcile/order implementation, v0.18.1, lines 73–117](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/data/reconcile.ts#L73-L117)
- [Fractional-index tie handling by element ID, v0.18.1, lines 117–140](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/fractionalIndex.ts#L117-L140)

For equal versions, Excalidraw's **lower `versionNonce` wins**. An element currently being edited/resized is temporarily protected from a remote replacement. This is best described as deterministic, whole-element register-style reconciliation with transient local-edit protection—not as a general CRDT and not as a semantic merge of two edits to the same element.

The official tests explicitly check reordering, duplicate IDs, and re-reconciliation, but the app's own collaboration test notes that simultaneous two-client scene/history tests are still a gap. Passing reconciliation unit tests is therefore not deployment evidence.

- [Reconciliation/convergence tests, v0.18.1, lines 65–133](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/tests/data/reconcile.test.ts#L65-L133)
- [Concurrent cases and duplicate handling, v0.18.1, lines 275–381](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/tests/data/reconcile.test.ts#L275-L381)
- [Official collaboration test coverage caveat, v0.18.1, lines 55–66](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/tests/collab.test.tsx#L55-L66)

### 1.3 The wire is encrypted JSON element messages, with periodic full recovery

The app emits typed scene, pointer, idle, and followed-viewport payloads. Each of those payloads is JSON/UTF-8 encoded and encrypted before Socket.IO emission. Normal updates include elements newer than the last broadcast version; after updates, a throttled full-scene resync path helps recover dropped/diverged messages. Deleted elements remain syncable for 24 hours.

- [Encrypted Socket.IO emission, v0.18.1, lines 84–100](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Portal.tsx#L84-L100)
- [Incremental selection and full-sync intent, v0.18.1, lines 141–182](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Portal.tsx#L141-L182)
- [20-second resync and one-day tombstone window, v0.18.1, lines 2–9](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/app_constants.ts#L2-L9)
- [Recently deleted elements remain syncable, v0.18.1, lines 40–53](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/data/index.ts#L40-L53)
- [Update/full-resync scheduling, v0.18.1, lines 911–953](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Collab.tsx#L911-L953)

### 1.4 Stable E2EE is client-generated link key plus client-encrypted persistence

The browser generates a random 10-byte room ID and a separate encryption key. The collaboration URL stores both in the fragment. The stable helper uses Web Crypto AES-GCM with a 128-bit key and a random 96-bit IV. The browser encrypts the scene before persistence; Firestore stores ciphertext, IV, and a plaintext scene-version number. Collaboration files are also compressed/encrypted before Firebase Storage.

- [Room ID generation, v0.18.1, lines 65–68](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/data/index.ts#L65-L68)
- [Collaboration-link key and fragment URL, v0.18.1, lines 128–160](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/data/index.ts#L128-L160)
- [AES-GCM key/IV helpers, v0.18.1, lines 4–28 and 49–92](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/data/encryption.ts#L4-L28)
- [Stable key size, v0.18.1, line 318](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/constants.ts#L318)
- [Client-side encrypted scene transaction, v0.18.1, lines 170–242](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/data/firebase.ts#L170-L242)
- [Encrypted collaboration-file upload path, v0.18.1, lines 141–194](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/data/firebase.ts#L141-L194)

**Conclusion:** official Excalidraw v0.18.1 is evidence for encrypted JSON collaboration plus deterministic per-element reconciliation. It is not evidence that “Excalidraw collaboration = Yjs/CRDT.”

## 2. Current Dripl assessment

### 2.1 The live protocol is JSON; the Yjs path is dormant

Both live implementations explicitly hard-code `YJS_WIRE_ENABLED = false`.

- Client: `apps/dripl-app/hooks/useCollaboration.ts:12-15, 502-540`
- Server: `apps/ws-server/src/index.ts:177-225, 446-467, 585-590`

The active path is:

- JSON `scene-update` / `scene-delta` messages;
- a server-side plaintext `Map<string, DriplElement>`;
- client `onFullSync` replacement and remote add/update/delete application;
- JSON persistence and JSON Redis fan-out.

The current tests confirm lifecycle and validation seams, not CRDT convergence:

- Targeted WS tests run during this decision: 2 files / 5 tests passed (`sceneReconciliation`, validation regressions).
- Targeted client test run: 1 file / 3 tests passed (`useCollaboration` lifecycle).
- Targeted crypto utility run: 1 file / 28 tests passed (`encryption.test.ts`).
- No test imports Yjs, sends a Yjs packet, tests update permutations, or exercises an encrypted WebSocket.

### 2.2 Dripl has useful convergence ingredients, but the protocol is not yet convergent under all supported operations

| Area                    | Current evidence                                                                                                                                                                                                                                                                  | Consequence                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Element freshness       | Shared `shouldAcceptElement` compares `version`, then `versionNonce`: `packages/common/src/reconciliation.ts:5-35`.                                                                                                                                                               | Deterministic whole-element update selection using Excalidraw's lower-`versionNonce` tie-break; this still does not provide operation-log convergence.                                                      |
| Duplicate/live reducers | The live canvas uses `@dripl/common/reconciliation` (`RoughCanvas.tsx:16,206-223`); a separate app reducer also documents the same lower-nonce rule but is not the collaboration hook's reducer (`apps/dripl-app/lib/reconciliation.ts:32-149`; `lib/consumption-engine.ts:1-8`). | The live tie-break is aligned, but there is still no single reducer covering every mutation path and both implementations.                                                                                  |
| Delete                  | `delete_element` physically removes the map entry (`apps/ws-server/src/index.ts:715-731`); `scene-delta.deleted` does the same (`:900-906`). Local deletion also filters the element out (`canvasSlice.ts:228-271`).                                                              | Delete has no version/nonce tombstone. Concurrent update/delete outcomes depend on arrival and reconnect order; a delayed update can resurrect an element. This alone prevents a general convergence claim. |
| Initial/reconnect sync  | Server sends `sync_room_state`; client replaces local state and only then replays its bounded queue (`useCollaboration.ts:551-624`; queue cap at `:158-165,258-266`).                                                                                                             | There is no union/rebase at the full-sync boundary and no explicit accepted-operation acknowledgement to the sender. Recovery depends on later traffic/healing.                                             |
| Recovery                | The server compares DB and memory IDs every 60 seconds, then saves memory over the DB (`apps/ws-server/src/index.ts:1362-1416`).                                                                                                                                                  | This detects/logs one class of ID divergence; it does not reconcile versioned element payloads or send a healing snapshot to clients.                                                                       |
| Ordering                | Missing fractional indices are filled (`lib/store/helpers.ts:55-74`), but equal indices compare equal (`utils/zIndexUtils.ts:7-15`).                                                                                                                                              | Equal-index z-order can depend on input/Map insertion order. Excalidraw breaks ties by element ID and repairs invalid indices.                                                                              |
| Multi-instance          | Redis republishes accepted JSON mutations (`apps/ws-server/src/redis.ts:54-78`; `apps/ws-server/src/index.ts:228-267`).                                                                                                                                                           | Redis pub/sub is non-durable fan-out, not a room sequencer or operation store. Process-local dedup and DB timestamp fencing do not establish distributed convergence.                                       |
| Semantic merges         | Each update carries a complete element object.                                                                                                                                                                                                                                    | Concurrent edits to different properties of one element cannot both survive; one whole element wins. Arrow/label and group operations need explicit multi-element atomicity/invariant repair.               |

A concrete counterexample is:

1. Server and client both hold element `E@v2`.
2. Client A disconnects and creates `E@v3`.
3. Client B deletes `E`; Dripl physically removes it.
4. A reconnects and sends `E@v3`; the server sees no existing element and accepts it.
5. The sender receives no accepted echo, and there is no tombstone/periodic healing snapshot.

The result can be a server resurrection, a stale sender, or divergence until unrelated traffic causes another full load. A CRDT cannot be claimed from the current version guard.

### 2.3 The dormant Yjs adapter is not a usable CRDT transport

A real Yjs provider guarantees convergence only when peers exchange the same Yjs document updates; Yjs documents that updates are commutative, associative, and idempotent and describes state-vector exchange for missing updates.

- [Official Yjs update guarantees and state vectors](https://docs.yjs.dev/api/document-updates)
- [Official `Y.Map` API](https://docs.yjs.dev/api/shared-types/y.map)

Dripl's adapter does not currently implement that provider contract:

| Gap                                   | Evidence                                                                                                                                                                                                          | Risk if the flag is merely enabled                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not enabled                           | Both `YJS_WIRE_ENABLED` constants are `false`.                                                                                                                                                                    | No Yjs claim is currently operational.                                                                                                                              |
| Custom packet, not the sync handshake | Server accepts only byte `1`; byte `2` is sent to the client but is not handled inbound. `sendYjsSync` ignores its state-vector argument and sends a full update (`apps/ws-server/src/index.ts:177-225,446-467`). | No y-protocols sync step 1/2, missing-update exchange, or provider `sync` acknowledgement.                                                                          |
| Full-document packets                 | Client and server call `Y.encodeStateAsUpdate(yDoc)` without a target state vector (`useCollaboration.ts:286-313`; `yjsManager.ts:84-89`).                                                                        | Bandwidth grows with room size and this is not an incremental provider implementation.                                                                              |
| Whole-element values                  | The shared type is `Y.Map<DriplElement>` and each `set` replaces one element object (`yjsManager.ts:8-25,45-54`).                                                                                                 | A Yjs CRDT would still not merge concurrent `x`, `color`, or text edits inside one element. `Y.Text`, `Y.Array`, or a field-level model would be a separate design. |
| JSON remains a second authority       | Every JSON handler mirrors into Yjs while `room.elements` remains canonical; binary updates copy Yjs back into `room.elements` (`apps/ws-server/src/index.ts:640-977`).                                           | Split brain, duplicate mutations, feedback loops, and different multi-instance results are possible.                                                                |
| Binary semantic validation bypass     | JSON is Zod-validated, but a binary update is applied directly and the resulting map is trusted (`apps/ws-server/src/index.ts:446-467`).                                                                          | Invalid/oversized shared state can bypass the 5,000-element and `DriplElementSchema` guarantees.                                                                    |
| Awareness is not a provider protocol  | One server-local Awareness state is overwritten from every user's cursor (`handlers/cursorMove.ts:26-60`). No awareness update encode/apply/remove loop exists.                                                   | The optional Awareness CRDT cannot provide per-user presence through this adapter.                                                                                  |
| No Yjs persistence/compaction         | The DB stores materialized JSON; a restart constructs a new Y.Doc from that JSON (`rooms.ts:161-188`; `yjsManager.ts:107-121`).                                                                                   | Yjs causal history/state vectors are lost. This is not a durable Yjs document.                                                                                      |
| No Yjs Redis replication              | Redis carries only the current JSON message types.                                                                                                                                                                | Two WS instances can maintain different Yjs docs.                                                                                                                   |
| No tests                              | Repository test search finds no Yjs/Y-protocol test.                                                                                                                                                              | The dormant code has no correctness or security evidence.                                                                                                           |

The mere presence of `yjs`, `y-protocols`, or `y-websocket` in `package.json` is not provider adoption; the live hook uses the browser `WebSocket` API directly.

## 3. Options and recommendation

| Option                                 | Result                                                                                                                                                                                                         | Migration/operational cost                                                                                                                                         | Recommendation                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Keep JSON exactly as-is                | Whole-element updates are mostly deterministic, but physical deletes, initial replacement, tie/order gaps, and no healing prevent a convergence claim.                                                         | Low immediate cost, continuing correctness risk.                                                                                                                   | **Reject.**                                                   |
| Harden JSON using the Excalidraw model | Deterministic whole-element winner, tombstones, canonical ordering, accepted-op ACK, and periodic full recovery. Preserves the current whole-element editor model and server-side schema/ACL enforcement.      | Moderate protocol/storage/client migration; old writers need an explicit protocol gate.                                                                            | **Recommend for v2.**                                         |
| Make Yjs the sole canonical document   | Correct Yjs update convergence is possible if a real provider, persistence, awareness, authorization, and editor binding are built. The current `Y.Map<DriplElement>` still does not merge element properties. | High: replace JSON handlers, add provider protocol, durable update/state-vector storage, compaction, multi-instance replication, migration tooling, and new tests. | **Defer unless hard CRDT/offline requirements are approved.** |
| Run JSON and Yjs together              | Two reducers, two persistence views, and potential split brain.                                                                                                                                                | Very high debugging and data-integrity cost.                                                                                                                       | **Reject.**                                                   |

### 3.1 Recommended v2 convergence contract

The target should be called **deterministic whole-element reconciliation**, not a CRDT.

1. **One reducer in `@dripl/common`.** Client, WS server, Redis application, and tests must call the same pure merge/canonicalization code.
2. **Every mutation is a complete versioned element record.** Add, update, delete, group/ungroup, arrow/label movement, and style changes must all produce versioned records. Delete becomes `isDeleted: true`, not a physical ID deletion on the synchronization path.
3. **Use one deterministic ordering rule.** Match Excalidraw's lower-`versionNonce` tie-break for compatibility. If equal version and nonce can contain different payloads, add a final canonical-payload digest tie-break instead of first-arrival order.
4. **Make fractional ordering total.** Tie equal indices by element ID and run the same index-repair routine on client, server, and persisted migration.
5. **Version the room protocol.** A join/sync response should include a collaboration protocol version, room epoch, and server revision/sequence. Mutations need a unique operation ID and the sender must receive an accepted/rejected acknowledgement or canonical replacement.
6. **Heal explicitly.** Send a full canonical snapshot on initial join, reconnect/gap, acknowledgement failure, and periodically after updates. A 20-second post-update recovery interval is a reasonable baseline copied from Excalidraw, but it is a recovery mechanism—not proof of CRDT semantics.
7. **Retain tombstones safely.** A time window alone is enough only for a bounded offline guarantee. Before compacting a tombstone, require an acknowledgement/epoch barrier showing that no supported client can still submit an older operation. Excalidraw's 24-hour deleted-element window is a reference baseline, not an arbitrary-offline proof.
8. **Treat Redis as fan-out only.** A room needs one authoritative reducer/sequencer and durable revision/dedup storage. Independent in-memory room authorities plus Redis pub/sub are not a distributed convergence design.
9. **Make multi-element invariants explicit.** Operations that update an arrow, label, container, and group should be applied atomically or followed by a shared deterministic repair pass. CRDT convergence of bytes does not prove a valid drawing graph.
10. **Define history separately.** Remote updates must refresh local history snapshots without becoming local undo entries, following the intent of Excalidraw's multiplayer-aware history. Snapshot undo/redo is not automatically collaboration-safe.

## 4. E2EE decision

### 4.1 What Dripl may call encrypted today

The crypto utility uses AES-256-GCM with a random 96-bit IV, and its primitive round-trip/tamper tests pass. That establishes a cryptographic helper test, not system E2EE.

Current share creation is performed by the HTTP server:

- `buildEncryptedShare()` generates the key and encrypts the elements on the server (`apps/http-server/src/lib/encrypt.ts:90-97`).
- The same database row stores plaintext `elements` **and** the encrypted snapshot envelope (`apps/http-server/src/services/fileService.ts:341-380`).
- The browser later receives the key in the URL fragment (`packages/utils/src/encryption/url.ts:10-50`).
- Edit-share pages then open the ordinary JSON WebSocket collaboration path (`apps/dripl-app/app/share/[token]/page.tsx:119-140`; `useCollaboration.ts:258-270`).

The most accurate current description is:

> “The share API returns a point-in-time AES-GCM snapshot envelope whose bearer key is carried in the URL fragment; active edit collaboration is not end-to-end encrypted.”

Do **not** call that envelope encrypted-at-rest storage: the authoritative file row still contains plaintext elements. Do **not** call it E2EE: the server sees plaintext and generates the key.

### 4.2 Recommended E2EE boundary

Do not bolt an encrypted envelope around the current server-authoritative plaintext protocol. That would leave the server unable to reconcile or semantically validate scenes while retaining the appearance of a central authority. Choose one explicit architecture:

- **Plaintext authoritative rooms (recommended v2):** server validates, reduces, persists, and authorizes plaintext scene elements; transport uses TLS in production. Product wording remains non-E2EE.
- **Future E2EE capability rooms:** server authorizes the connection/ticket and enforces outer byte/rate limits, but clients encrypt and reconcile scene content. The server stores opaque encrypted state and cannot enforce element-level schema/capacity semantics.

A future E2EE v1 envelope should require all of the following before an E2EE claim:

1. Browser-generated room key material; the key never enters an HTTP request body/query, server log, analytics event, Redis payload, or database row.
2. A versioned URL-fragment format that does not reuse the current unversioned `#key=<base64>` parameter ambiguously.
3. Encryption of scene/snapshot data, collaboration files, and presence payloads. Limit/document metadata leakage: room/ticket identifiers, user accounts, IP addresses, timing, message sizes, and authorization events remain observable.
4. Random IV generation and authenticated context. Bind protocol version, room epoch, message type, sender/session identifier, and sequence as AES-GCM AAD so cross-room/type substitution and replay are rejected.
5. Client-side schema validation and deterministic reconciliation. The server can enforce encrypted-envelope byte/rate limits, not `DriplElementSchema`, element count, bindings, or drawing invariants.
6. Explicit key lifecycle: invite/link distribution, rotation, revocation behavior, stale clients, and what happens when a link holder exports/copies content. A URL-fragment key is a bearer secret, not user-bound DRM.
7. A distinct encrypted persistence format and crash-recovery test. Do not continue writing the plaintext authoritative scene beside an “encrypted” copy.
8. A documented threat model. E2EE does not imply identity privacy, forward secrecy, post-compromise safety, metadata privacy, or protection from an authorized recipient.

If byte-for-byte Excalidraw collaboration-link compatibility is required, Dripl must implement Excalidraw's 128-bit key and wire format and test against that client. If it is not required, Dripl may retain its 256-bit key behind a separate Dripl protocol version. The two formats must not be presented as interchangeable.

If both **true CRDT convergence** and **E2EE** become hard launch requirements, that is the point to reconsider Yjs as a sole canonical encrypted update stream. The transport design must then distinguish an opaque relay from a server that applies Yjs updates: a server cannot calculate Yjs diffs or enforce document semantics over payloads it cannot decrypt. This still requires a ground-up provider/persistence/key-management design; the dormant adapter is not a migration shortcut.

## 5. Migration and compatibility risks

### 5.1 JSON reconciliation v2

| Risk                                                                                 | Required mitigation                                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy elements have no version/nonce/index.                                         | Perform a deterministic, server-owned migration and persist it. Do not let each client independently invent different tie values.                                       |
| Old clients can continue sending unversioned writes.                                 | Introduce a protocol/room epoch. After a room enters v2, either upgrade old clients to read-only or reject legacy mutations explicitly. Silent compatibility is unsafe. |
| Changing equal-version tie behavior can replace a currently stored divergent branch. | Audit stored divergent branches and bump a migration epoch/version before changing selection rules.                                                                     |
| Tombstones increase scene and sync size.                                             | Bound retention, expose metrics, and compact only behind an acknowledgement/epoch barrier.                                                                              |
| Physical `deleted[]` clients may still remove IDs.                                   | Dual-read during rollout, but do not dual-write two authorities. New protocol sends tombstoned element records and acknowledges the operation.                          |
| HTTP file autosave and WS saves can race.                                            | Route both through the same canonical scene envelope/reducer, or designate one writer while a room is active. Optimistic `updatedAt` alone is not merge logic.          |
| Process-local `recentMsgIds` and room maps are not distributed state.                | Add a durable room revision/operation ledger or a single authoritative room owner before claiming multi-instance correctness.                                           |
| Equal fractional indices remain input-order dependent.                               | Shared repair/ID tie-break plus persisted migration and a test for duplicate/empty indices.                                                                             |
| Bound arrows/labels and groups span elements.                                        | Version every affected record, apply batches atomically where possible, and run shared invariant repair deterministically.                                              |
| Snapshot share ciphertext is preserved while plaintext changes.                      | Keep legacy snapshot behavior explicitly non-E2EE and non-live. Do not present it as current room state.                                                                |

### 5.2 Yjs, if reconsidered

A Yjs migration would require a new room format, not a flag flip:

- one-time JSON-to-Y.Doc migration and an auditable materialized snapshot;
- standard y-protocols/provider sync or a fully specified equivalent;
- incremental updates and state vectors;
- durable encoded updates/state vectors across restart, plus snapshot/compaction;
- field/array/text modeling decisions rather than opaque whole-element values if semantic merges are expected;
- per-connection awareness;
- binary semantic validation, scene capacity, and authorization policy;
- Redis/PubSub or another multi-instance update transport with deduplication;
- browser and server rollback/version negotiation.

Running legacy JSON and Yjs mutations against the same room during this migration would create two sources of truth and should be prohibited.

### 5.3 E2EE

- Existing `{ iv, data }` snapshots have no format version/AAD and were server-keyed. They can be legacy-read only; they cannot be retroactively relabeled as E2EE. Reissue new links after browser-side re-encryption if product policy requires it.
- Moving a key into a fragment does not remove it from copied links, browser history, screenshots, clipboard managers, or recipients. State this in the UX.
- Revoking a server ticket prevents future connection but cannot revoke content or a key already copied by a participant.
- Account-based ACLs and link-based E2EE are different key-distribution models. Dripl must decide whether a room is account-authorized, capability/link-authorized, or both before implementation.
- Production must require TLS for ticket and metadata protection even when payloads are application-layer encrypted. `wss://` is still necessary; it is simply not sufficient for E2EE.

## 6. Required tests and release gates

### Gate A — deterministic JSON convergence

Add property-based tests for the one shared reducer:

- permutations of concurrent whole-element updates;
- update versus tombstone delete in both arrival orders;
- duplicate and delayed delivery;
- same version/different nonce;
- same version/same nonce/different payload digest;
- concurrent adds with the same ID;
- equal, missing, and repaired fractional indices;
- final element ID tie-break for equal indices;
- legacy migration from missing metadata;
- tombstone retention and compaction barrier;
- multi-element arrow/label/group operations;
- canonical serialization equality across all replicas.

The model must prove the intended contract: applying the same accepted operation set in any order yields the same canonical scene. This is deterministic convergence, not a CRDT proof.

### Gate B — real collaboration integration

Use real protocol clients and a real migrated PostgreSQL database:

1. Three clients join the same room from a common snapshot.
2. Two clients edit the same element concurrently; both converge to the documented winner.
3. One client deletes while another updates; both converge to the tombstone/update winner.
4. Drop, duplicate, and reorder messages; a full resync heals every replica.
5. Disconnect each client, edit independently, reconnect, and verify accepted-operation ACKs and no local-edit loss.
6. Verify equal fractional indices canonicalize identically.
7. Verify viewer mutation denial and authorization revocation during an active session.
8. Verify same-user multi-tab identity and presence separately.
9. Verify reload/restart persistence and no stale in-memory save overwrites a newer revision.
10. Run two WS instances with Redis and a durable room sequencer; partition and rejoin them.

The current opt-in two-client process test does not satisfy this gate because it mocks ticket/DB seams and does not test conflict convergence.

### Gate C — browser behavior

Playwright with at least two browser contexts should cover simultaneous drag/resize, text editing, delete/update, z-order moves, reconnect, reload, undo/redo after remote changes, and read-only denial. A pure reducer test cannot prove that editor state, locks, history, and the hook call the reducer on every mutation path.

### Gate D — E2EE system tests

Before any E2EE wording is approved:

- put unique canaries in element text, labels, image/file metadata, usernames, and cursor payloads;
- capture WS frames, Redis messages, database rows, structured logs, analytics, and error telemetry; assert that canaries are absent;
- prove key generation occurs in the browser and the raw key never crosses a server boundary;
- wrong key, modified IV/ciphertext, stale epoch, replay, cross-room, and cross-message-type substitution must fail closed;
- two authorized browser contexts must decrypt and converge after reorder/duplicate/reconnect;
- authorized ticket without key sees only opaque data; valid key with revoked ticket cannot join;
- encrypted persistence must survive process restart without a plaintext fallback;
- legacy share links must be identified and tested as legacy, not silently upgraded;
- the threat model must document visible metadata and the absence of forward secrecy/recipient revocation.

### Gate E — Yjs re-entry gate

Do not set `YJS_WIRE_ENABLED = true` unless a new Yjs-specific plan passes all of these:

- real y-protocols/provider handshake with state vectors and a provider `sync` event;
- randomized update permutation, duplication, delay, and offline replay;
- state-vector diff and reconnect after server restart;
- durable encoded document/state-vector persistence and safe compaction;
- editor binding tests for every mutation path, with no JSON feedback loop;
- explicit Yjs schema/capacity/authorization enforcement;
- per-client awareness timeout/removal;
- multi-instance update replication and deduplication;
- migration and rollback rehearsal with no dual authority.

## 7. Claims policy

| Claim                                                         | Allowed now?            | Rule                                                                                                                                |
| ------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| “Real-time WebSocket collaboration”                           | Yes, with qualification | Describe it as authenticated JSON collaboration; do not imply CRDT or E2EE.                                                         |
| “Differential element sync”                                   | Yes                     | It is an implemented transport optimization, not proof of convergence.                                                              |
| “Deterministic whole-element convergence”                     | No, not yet             | Allowed only after Gates A–C pass and the exact whole-element limitation is stated.                                                 |
| “CRDT” / “conflict-free” / “Yjs collaboration”                | **No**                  | The active protocol is JSON and Yjs is disabled. Fractional indexing alone is not scene-level conflict freedom.                     |
| “End-to-end encrypted collaboration”                          | **No**                  | Active scene/presence transport is plaintext.                                                                                       |
| “Encrypted share snapshot”                                    | Yes, if precise         | Say “fragment-key AES-GCM snapshot envelope”; also disclose active edit transport and plaintext authoritative storage are not E2EE. |
| “Encrypted at rest” / “zero knowledge” / “server cannot read” | **No**                  | The current DB stores plaintext elements and the HTTP server creates the share key.                                                 |
| “Excalidraw-compatible collaboration”                         | **No**                  | Wire format, reconciliation tie-break, key format, persistence, and provider behavior differ.                                       |

## 8. Primary sources

### Excalidraw v0.18.1

- [Tag `v0.18.1` / commit `a2ec288`](https://github.com/excalidraw/excalidraw/tree/a2ec2889babf7d2295469c6d90ebe77fae57df84)
- [Collaboration reconciliation](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/data/reconcile.ts)
- [Collaboration client](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Collab.tsx)
- [Encrypted transport portal](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/collab/Portal.tsx)
- [Encryption helper](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/packages/excalidraw/data/encryption.ts)
- [Encrypted Firebase persistence](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/excalidraw-app/data/firebase.ts)
- [Package FAQ](https://github.com/excalidraw/excalidraw/blob/a2ec2889babf7d2295469c6d90ebe77fae57df84/dev-docs/docs/@excalidraw/excalidraw/faq.mdx)

### Yjs primary documentation

- [Document updates and convergence properties](https://docs.yjs.dev/api/document-updates)
- [`Y.Map`](https://docs.yjs.dev/api/shared-types/y.map)
- [Awareness protocol](https://docs.yjs.dev/api/about-awareness)

### Dripl live-path evidence

- `apps/dripl-app/hooks/useCollaboration.ts`
- `apps/dripl-app/components/canvas/RoughCanvas.tsx`
- `apps/ws-server/src/index.ts`
- `apps/ws-server/src/rooms.ts`
- `apps/ws-server/src/yjsManager.ts`
- `apps/ws-server/src/redis.ts`
- `packages/common/src/reconciliation.ts`
- `packages/utils/src/encryption/crypto.ts`
- `apps/http-server/src/lib/encrypt.ts`
- `apps/http-server/src/services/fileService.ts`

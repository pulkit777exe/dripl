/**
 * Excalidraw-style random username: "Adjective Noun" (e.g., "Adorable Aardvark").
 * Uses a seeded random based on a stable client ID so the same browser gets the same
 * name until the user changes it.
 */

const ADJECTIVES = [
  "Adorable",
  "Ambitious",
  "Brave",
  "Calm",
  "Clever",
  "Curious",
  "Eager",
  "Gentle",
  "Happy",
  "Jolly",
  "Kind",
  "Lively",
  "Lucky",
  "Peaceful",
  "Proud",
  "Silly",
  "Witty",
  "Bold",
  "Cozy",
  "Daring",
];

const NOUNS = [
  "Aardvark",
  "Bear",
  "Cat",
  "Dolphin",
  "Eagle",
  "Fox",
  "Giraffe",
  "Hawk",
  "Ibis",
  "Jaguar",
  "Koala",
  "Lion",
  "Mouse",
  "Newt",
  "Otter",
  "Penguin",
  "Quail",
  "Rabbit",
  "Sloth",
  "Tiger",
  "Unicorn",
  "Viper",
  "Wolf",
  "Yak",
  "Zebra",
];

const DRIPL_USERNAME_KEY = "dripl_username";
const EXCALIDRAW_COLLAB_KEY = "excalidraw-collab";

/**
 * Seeded random number generator (mulberry32) for deterministic results.
 */
function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Get or create a stable client ID (persists in localStorage).
 */
function getClientId(): string {
  if (typeof window === "undefined") return "default";
  let id = localStorage.getItem("dripl_client_id");
  if (!id) {
    id = `dripl-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem("dripl_client_id", id);
  }
  return id;
}

/**
 * Generate a deterministic random username for this client.
 */
export function generateRandomUsername(): string {
  const clientId = getClientId();
  const seed = clientId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const random = mulberry32(seed);

  const adjIndex = Math.floor(random() * ADJECTIVES.length);
  const nounIndex = Math.floor(random() * NOUNS.length);

  return `${ADJECTIVES[adjIndex]} ${NOUNS[nounIndex]}`;
}

/**
 * Get the collaborator username: dripl_username > excalidraw-collab > generated.
 * Persists the generated name to both keys if used.
 */
export function getOrCreateCollaboratorName(): string {
  if (typeof window === "undefined") return "Anonymous";

  const dripl = localStorage.getItem(DRIPL_USERNAME_KEY);
  if (dripl && dripl.trim()) return dripl.trim();

  try {
    const collab = localStorage.getItem(EXCALIDRAW_COLLAB_KEY);
    if (collab) {
      const parsed = JSON.parse(collab) as { username?: string };
      if (parsed?.username?.trim()) {
        localStorage.setItem(DRIPL_USERNAME_KEY, parsed.username.trim());
        return parsed.username.trim();
      }
    }
  } catch {
    // ignore parse errors
  }

  const generated = generateRandomUsername();
  localStorage.setItem(DRIPL_USERNAME_KEY, generated);
  localStorage.setItem(
    EXCALIDRAW_COLLAB_KEY,
    JSON.stringify({ username: generated }),
  );
  return generated;
}

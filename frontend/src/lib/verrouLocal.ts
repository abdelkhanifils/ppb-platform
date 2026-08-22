/**
 * Verrou local — permet à un agent déjà connecté au moins une fois en ligne
 * sur cet appareil de se RECONNECTER hors-ligne (après une déconnexion
 * explicite, ou si le jeton d'accès a expiré) sans attendre le réseau.
 *
 * Principe : jamais le mot de passe en clair. On dérive une empreinte
 * (PBKDF2-SHA256, 100 000 itérations, sel aléatoire par appareil — API
 * Web Crypto native du navigateur) juste après chaque connexion RÉUSSIE EN
 * LIGNE, et on la compare localement à la prochaine tentative hors-ligne.
 *
 * Limite assumée, à connaître : ceci protège contre un accès occasionnel
 * (quelqu'un qui trouve l'appareil), pas contre une analyse experte de
 * l'appareil lui-même — un mot de passe très faible reste théoriquement
 * cassable hors-ligne par une personne qui aurait un accès prolongé au
 * stockage local. C'est le même compromis que la plupart des verrous
 * d'écran d'app mobile hors-ligne (gestionnaires de mots de passe compris),
 * pas un chiffrement à vocation de coffre-fort.
 */

const CLE_VERROU = "ppb_verrou_local";
const ITERATIONS = 100_000;

interface VerrouLocal {
  email: string;
  sel: string; // hex
  hash: string; // hex
}

function bufVersHex(buf: ArrayBuffer | Uint8Array): string {
  const octets = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(octets)
    .map((o) => o.toString(16).padStart(2, "0"))
    .join("");
}

function hexVersOctets(hex: string): Uint8Array {
  const sortie = new Uint8Array(hex.length / 2);
  for (let i = 0; i < sortie.length; i++) sortie[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return sortie;
}

async function deriverEmpreinte(motDePasse: string, sel: Uint8Array): Promise<string> {
  const encodeur = new TextEncoder();
  const cleBase = await crypto.subtle.importKey("raw", encodeur.encode(motDePasse), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {  name: "PBKDF2", salt: sel as BufferSource, iterations: ITERATIONS, hash: "SHA-256"  },
    cleBase,
    256
  );
  return bufVersHex(bits);
}

/** À appeler juste après une connexion EN LIGNE réussie — met à jour
 * l'empreinte locale utilisable pour les reconnexions hors-ligne suivantes. */
export async function enregistrerVerificationLocale(email: string, motDePasse: string): Promise<void> {
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriverEmpreinte(motDePasse, sel);
  const verrou: VerrouLocal = { email: email.trim().toLowerCase(), sel: bufVersHex(sel), hash };
  localStorage.setItem(CLE_VERROU, JSON.stringify(verrou));
}

/** true si l'email + mot de passe fournis correspondent à la dernière
 * connexion en ligne réussie sur cet appareil. */
export async function verifierLocalement(email: string, motDePasse: string): Promise<boolean> {
  const brut = localStorage.getItem(CLE_VERROU);
  if (!brut) return false;
  try {
    const verrou = JSON.parse(brut) as VerrouLocal;
    if (verrou.email !== email.trim().toLowerCase()) return false;
    const hash = await deriverEmpreinte(motDePasse, hexVersOctets(verrou.sel));
    return hash === verrou.hash;
  } catch {
    return false;
  }
}

export function effacerVerrouLocal(): void {
  localStorage.removeItem(CLE_VERROU);
}

/** true si UNE empreinte existe pour cet email sur cet appareil (peu importe
 * si le mot de passe fourni ensuite sera correct) — utile pour distinguer
 * "jamais connecté ici" de "mot de passe incorrect" dans le message affiché
 * à l'agent hors-ligne. */
export function aUnVerrouPour(email: string): boolean {
  const brut = localStorage.getItem(CLE_VERROU);
  if (!brut) return false;
  try {
    return (JSON.parse(brut) as VerrouLocal).email === email.trim().toLowerCase();
  } catch {
    return false;
  }
}

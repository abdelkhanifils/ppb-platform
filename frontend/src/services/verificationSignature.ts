/**
 * Vérification hors-ligne de la signature numérique d'un passeport — Module 5
 * (Document technique §3, M5, et §6 « Sécurité transversale »).
 *
 * Utilise EXCLUSIVEMENT la clé publique — jamais transmise ni stockée côté
 * client autrement : la clé privée reste la propriété exclusive de la
 * CEBEVIRHA (voir backend/app/core/signing.py). La chaîne canonique et son
 * empreinte SHA-256 sont recalculées ICI, à partir des données du passeport
 * (numéro + qr_uuid), plutôt que de faire confiance à un hash transmis tel
 * quel — pour qu'une falsification de l'un des deux (hash ou données) soit
 * détectée par la vérification, pas seulement une falsification de la
 * signature isolément.
 *
 * PIÈGE ÉVITÉ ICI — format de signature ECDSA : la bibliothèque Python
 * `cryptography` (backend) produit des signatures ECDSA au format **DER**
 * (ASN.1, SEQUENCE de deux INTEGER r et s, longueur variable). La Web Crypto
 * API attend le format **"raw"** (IEEE P1363, r et s concaténés sur une
 * longueur fixe — 32 octets chacun pour P-256). Sans la conversion
 * `derVersRaw` ci-dessous, TOUTE vérification échouerait silencieusement,
 * y compris pour une signature parfaitement authentique.
 */

const TAILLE_COMPOSANTE_P256 = 32; // octets — taille fixe de r et s pour la courbe P-256

/** Nouveau format de QR (voir backend/app/services/qrcode_service.py) :
 * `{pays sur 2 chiffres}-{année sur 4 chiffres}-{lot sur 7 chiffres}-{qr_uuid}-{signature}`
 * — auto-suffisant pour vérifier l'authenticité SANS avoir besoin que ce
 * passeport précis ait déjà été synchronisé localement. Découpage à
 * largeur fixe pour les 3 premiers segments (jamais un simple split("-") :
 * le qr_uuid lui-même contient 4 tirets internes, ce qui rendrait un
 * découpage naïf ambigu). Retourne `null` si le texte scanné ne suit pas
 * ce format — dans ce cas l'appelant retombe sur l'ancien comportement
 * (UUID brut, nécessite une recherche locale préalable) pour les
 * passeports déjà imprimés avant ce changement. */
export interface PayloadQrAutoVerifiable {
  numeroPays: string;
  numeroAnnee: string;
  numeroLot: string;
  qrUuid: string;
  signature: string;
}

const MOTIF_PAYLOAD_QR = /^(\d{2})-(\d{4})-(\d{7})-([0-9a-fA-F-]{36})-(.+)$/;

export function analyserPayloadQr(texteDecode: string): PayloadQrAutoVerifiable | null {
  const correspondance = texteDecode.match(MOTIF_PAYLOAD_QR);
  if (!correspondance) return null;
  const [, numeroPays, numeroAnnee, numeroLot, qrUuid, signature] = correspondance;
  return { numeroPays, numeroAnnee, numeroLot, qrUuid, signature };
}

function base64VersOctets(base64: string): Uint8Array {
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

/** DER (produit par `cryptography` côté backend) -> raw IEEE P1363 (attendu
 * par `crypto.subtle.verify`). Lève une erreur si la structure DER est
 * invalide — traité comme "non vérifiable" par l'appelant, jamais comme
 * "valide par défaut". */
function derVersRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("Signature DER malformée (SEQUENCE attendue).");
  let offset = 2; // saute le tag SEQUENCE (0x30) et sa longueur sur 1 octet

  // Certaines longueurs de SEQUENCE codées sur 2 octets (0x81 <len>) selon la
  // taille de r/s — on gère ce cas plutôt que de supposer un octet unique.
  if (der[1] === 0x81) offset = 3;

  const extraireEntier = (): Uint8Array => {
    if (der[offset] !== 0x02) throw new Error("Signature DER malformée (INTEGER attendu).");
    offset += 1;
    const longueur = der[offset];
    offset += 1;
    let valeur = der.slice(offset, offset + longueur);
    offset += longueur;
    // Retire l'éventuel octet 0x00 de tête imposé par DER (nombre positif).
    while (valeur.length > TAILLE_COMPOSANTE_P256 && valeur[0] === 0x00) valeur = valeur.slice(1);
    if (valeur.length < TAILLE_COMPOSANTE_P256) {
      const complete = new Uint8Array(TAILLE_COMPOSANTE_P256);
      complete.set(valeur, TAILLE_COMPOSANTE_P256 - valeur.length);
      valeur = complete;
    }
    return valeur;
  };

  const r = extraireEntier();
  const s = extraireEntier();
  const raw = new Uint8Array(TAILLE_COMPOSANTE_P256 * 2);
  raw.set(r, 0);
  raw.set(s, TAILLE_COMPOSANTE_P256);
  return raw;
}

function pemVersDer(pem: string): ArrayBuffer {
  const corps = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  return base64VersOctets(corps).buffer as ArrayBuffer;
}

let clePubliqueEnCache: { pem: string; cle: CryptoKey } | null = null;

async function importerClePublique(pem: string): Promise<CryptoKey> {
  if (clePubliqueEnCache?.pem === pem) return clePubliqueEnCache.cle;
  const der = pemVersDer(pem);
  const cle = await crypto.subtle.importKey("spki", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  clePubliqueEnCache = { pem, cle };
  return cle;
}

/** Reconstitue EXACTEMENT la même chaîne canonique que le backend (voir
 * backend/app/services/attribution.py::construire_chaine_canonique) — toute
 * divergence entre les deux invalide silencieusement chaque vérification. */
export function construireChaineCanonique(
  numeroPays: string,
  numeroAnnee: string,
  numeroLot: string,
  qrUuid: string
): string {
  return `${numeroPays}-${numeroAnnee}-${numeroLot}-${qrUuid}`;
}

/**
 * Vérifie la signature d'un passeport à partir de la seule clé publique (mise
 * en cache localement, voir db/cacheClePublique.ts). Ne lève jamais
 * d'exception : toute anomalie (clé absente, format incompatible — ex. clé
 * RSA, non couverte par cette implémentation ECDSA P-256) retourne `false`,
 * jamais `true` par défaut.
 */
export async function verifierSignatureLocale(
  numeroPays: string,
  numeroAnnee: string,
  numeroLot: string,
  qrUuid: string,
  signatureBase64: string,
  clePubliquePem: string
): Promise<boolean> {
  try {
    const chaineCanonique = construireChaineCanonique(numeroPays, numeroAnnee, numeroLot, qrUuid);
    const empreinte = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(chaineCanonique) as BufferSource);

    const signatureRaw = derVersRaw(base64VersOctets(signatureBase64));
    const clePublique = await importerClePublique(clePubliquePem);

    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      clePublique,
      signatureRaw as BufferSource,
      empreinte
    );
  } catch {
    return false;
  }
}

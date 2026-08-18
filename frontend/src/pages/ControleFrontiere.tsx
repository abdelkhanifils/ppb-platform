import { useEffect, useState } from "react";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useDeltaSync } from "@/hooks/useDeltaSync";
import { obtenirClePubliqueLocale, rafraichirClePublique } from "@/db/cacheClePublique";
import { enregistrerControleLocalement } from "@/db/queueControle";
import { trouverItinerairePourPasseport, trouverPasseportParQrUuid } from "@/db/syncVerification";
import { verifierConformiteItineraire } from "@/services/conformiteItineraire";
import { verifierSignatureLocale } from "@/services/verificationSignature";
import type { ItineraireVerificationApi, PasseportVerificationApi, ResultatControle } from "@/types/controle";
import ScannerControle from "@/components/controle/ScannerControle";
import ResultatControleCarte from "@/components/controle/ResultatControleCarte";
import ApercuDocumentPasseport from "@/components/controle/ApercuDocumentPasseport";

const CLE_POSTE_ID = "ppb_poste_id";

interface DernierResultat {
  numero: string;
  resultat: ResultatControle;
  signatureValide: boolean;
  conformeItineraire: boolean | null;
  passeport: PasseportVerificationApi;
  itineraire?: ItineraireVerificationApi;
}

/**
 * Écran du Module 5 — Contrôle frontière (Document technique §3, M5).
 *
 * Le résultat affiché à l'agent est calculé INTÉGRALEMENT en local : lecture
 * du QR, recherche dans l'index de vérification synchronisé (IndexedDB),
 * vérification de la signature par Web Crypto API et vérification de
 * conformité au trajet déclaré — jamais une attente réseau au moment du
 * contrôle. La synchronisation différentielle (identité + itinéraire) et la
 * remontée des contrôles se font en tâche de fond, automatiquement, dès
 * détection réseau (voir hooks/useDeltaSync.ts).
 */
export default function ControleFrontiere() {
  const { utilisateur } = useAuth();
  const { enLigne, synchronisationEnCours, derniereErreur, controlesEnAttente, synchroniserMaintenant } = useDeltaSync();

  const [posteId, setPosteId] = useState(() => localStorage.getItem(CLE_POSTE_ID) ?? "");
  const [scanActif, setScanActif] = useState(true);
  const [enTraitement, setEnTraitement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [dernierResultat, setDernierResultat] = useState<DernierResultat | null>(null);

  useEffect(() => {
    // Amorce la clé publique dès l'ouverture si absente localement — sans
    // quoi la toute première vérification, avant le premier cycle de sync,
    // échouerait faute de clé disponible hors-ligne.
    void obtenirClePubliqueLocale().then((cle) => {
      if (!cle && navigator.onLine) void rafraichirClePublique();
    });
  }, []);

  const memoriserPosteId = (valeur: string) => {
    setPosteId(valeur);
    localStorage.setItem(CLE_POSTE_ID, valeur);
  };

  const obtenirPosition = (): Promise<{ latitude?: number; longitude?: number }> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({});
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
        () => resolve({}), // position indisponible : le contrôle reste valable sans coordonnées
        { timeout: 3000 }
      );
    });

  const traiterScan = async (texteDecode: string) => {
    if (enTraitement || !posteId) return;
    setEnTraitement(true);
    setErreur(null);
    setScanActif(false);

    try {
      const qrUuid = texteDecode;
      const passeport = await trouverPasseportParQrUuid(qrUuid);
      if (!passeport) {
        setErreur("Ce QR ne correspond à aucun passeport connu localement. Synchronisez si vous êtes en ligne.");
        return;
      }

      const clePubliquePem = await obtenirClePubliqueLocale();
      if (!clePubliquePem) {
        setErreur("Clé publique de vérification indisponible localement — synchronisez avant de continuer.");
        return;
      }

      const [numeroPays, numeroAnnee, numeroLot] = passeport.numero.split("-");
      const signatureValide = await verifierSignatureLocale(
        numeroPays,
        numeroAnnee,
        numeroLot,
        passeport.qr_uuid,
        passeport.signature,
        clePubliquePem
      );

      let resultat: ResultatControle;
      let conformeItineraire: boolean | null = null;
      let itineraireDisponible = false;
      let itineraireTrouve: ItineraireVerificationApi | undefined;

      if (!signatureValide) {
        // Authenticité en défaut : rédhibitoire, sans même consulter l'itinéraire.
        resultat = "refuse";
      } else {
        itineraireTrouve = await trouverItinerairePourPasseport(passeport.id);
        itineraireDisponible = itineraireTrouve !== undefined;
        conformeItineraire = verifierConformiteItineraire(utilisateur?.pays_id ?? null, itineraireTrouve);
        resultat = conformeItineraire === null ? "a_verifier" : conformeItineraire ? "valide" : "refuse";
      }

      setDernierResultat({
        numero: passeport.numero,
        resultat,
        signatureValide,
        conformeItineraire,
        passeport,
        itineraire: itineraireTrouve,
      });

      const { latitude, longitude } = await obtenirPosition();
      await enregistrerControleLocalement({
        passeport_id: passeport.id,
        poste_id: posteId,
        mode: enLigne ? "en_ligne" : "hors_ligne",
        resultat_local: resultat,
        signature_valide: signatureValide,
        conforme_itineraire: conformeItineraire,
        itineraire_disponible_localement: itineraireDisponible,
        latitude,
        longitude,
      });
    } finally {
      setEnTraitement(false);
    }
  };

  const nouveauScan = () => {
    setDernierResultat(null);
    setErreur(null);
    setScanActif(true);
  };

  if (!posteId) {
    return (
      <div className="mx-auto max-w-sm space-y-4 pt-10">
        <h1 className="text-xl font-semibold text-gray-900">Identification du poste</h1>
        <p className="text-sm text-gray-500">Renseignez l'identifiant de ce poste de contrôle avant de commencer.</p>
        <SaisiePosteId onValide={memoriserPosteId} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <BandeauSynchronisation
        enLigne={enLigne}
        synchronisationEnCours={synchronisationEnCours}
        derniereErreur={derniereErreur}
        controlesEnAttente={controlesEnAttente}
        onSynchroniser={synchroniserMaintenant}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Contrôle frontière</h1>
          <p className="text-xs text-gray-400">Poste : {posteId}</p>
        </div>
        <button onClick={() => memoriserPosteId("")} className="text-xs text-gray-500 hover:underline">
          Changer de poste
        </button>
      </div>

      {dernierResultat ? (
        <div className="space-y-4">
          <ResultatControleCarte
            numero={dernierResultat.numero}
            resultat={dernierResultat.resultat}
            signatureValide={dernierResultat.signatureValide}
            conformeItineraire={dernierResultat.conformeItineraire}
            codeVerification={dernierResultat.passeport.code_verification}
          />
          <ApercuDocumentPasseport passeport={dernierResultat.passeport} itineraire={dernierResultat.itineraire} />
          <button onClick={nouveauScan} className="w-full rounded-md bg-cebevirha px-4 py-3 text-sm font-medium text-white hover:bg-cebevirha-light">
            Contrôle suivant
          </button>
        </div>
      ) : (
        <>
          {enTraitement && <p className="text-sm text-gray-500">Vérification en cours…</p>}
          {erreur && (
            <div className="space-y-3">
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erreur}</p>
              <button onClick={nouveauScan} className="text-sm text-cebevirha hover:underline">
                Réessayer
              </button>
            </div>
          )}
          {!enTraitement && !erreur && <ScannerControle actif={scanActif} onDecode={traiterScan} />}
        </>
      )}
    </div>
  );
}

function SaisiePosteId({ onValide }: { onValide: (valeur: string) => void }) {
  const [valeur, setValeur] = useState("");
  return (
    <div className="flex gap-2">
      <input
        value={valeur}
        onChange={(e) => setValeur(e.target.value)}
        placeholder="Ex. poste-kousseri"
        className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      <button onClick={() => valeur && onValide(valeur)} className="rounded-md bg-cebevirha px-4 py-2 text-sm font-medium text-white">
        Continuer
      </button>
    </div>
  );
}

function BandeauSynchronisation({
  enLigne,
  synchronisationEnCours,
  derniereErreur,
  controlesEnAttente,
  onSynchroniser,
}: {
  enLigne: boolean;
  synchronisationEnCours: boolean;
  derniereErreur: string | null;
  controlesEnAttente: number;
  onSynchroniser: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5 text-gray-600">
        {enLigne ? <Wifi size={14} className="text-green-600" /> : <WifiOff size={14} className="text-amber-600" />}
        {enLigne ? (synchronisationEnCours ? "Synchronisation en cours…" : "En ligne") : "Hors-ligne — vérifications locales toujours actives"}
      </span>
      <span className="flex items-center gap-2">
        {derniereErreur && <span className="text-amber-600">{derniereErreur}</span>}
        {controlesEnAttente > 0 && (
          <button onClick={onSynchroniser} className="flex items-center gap-1 font-medium text-cebevirha hover:underline">
            <RefreshCw size={12} /> {controlesEnAttente} en attente d'envoi
          </button>
        )}
      </span>
    </div>
  );
}

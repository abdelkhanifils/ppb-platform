import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, Wifi, WifiOff, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useDeltaSync } from "@/hooks/useDeltaSync";
import { apiClient } from "@/api/client";
import { obtenirClePubliqueLocale, rafraichirClePublique } from "@/db/cacheClePublique";
import { enregistrerControleLocalement } from "@/db/queueControle";
import { trouverItinerairePourPasseport, trouverPasseportParQrUuid } from "@/db/syncVerification";
import { verifierConformiteItineraire } from "@/services/conformiteItineraire";
import { verifierSignatureLocale } from "@/services/verificationSignature";
import type { ControleResultatApi, ItineraireVerificationApi, PasseportVerificationApi, ResultatControle } from "@/types/controle";
import ScannerControle from "@/components/controle/ScannerControle";
import ResultatControleCarte from "@/components/controle/ResultatControleCarte";
import ApercuDocumentPasseport from "@/components/controle/ApercuDocumentPasseport";
import { useI18n } from "@/lib/i18n";

const CLE_POSTE_ID = "ppb_poste_id";

interface DernierResultat {
  numero: string;
  resultat: ResultatControle;
  signatureValide: boolean;
  conformeItineraire: boolean | null;
  passeport: PasseportVerificationApi;
  itineraire?: ItineraireVerificationApi;
}

/** Contrôle déjà calculé et affiché localement, mais dont l'enregistrement
 * est SUSPENDU en attendant la saisie d'un motif — voir traiterScan et
 * confirmerAvecMotif ci-dessous. `null` tant qu'aucun contrôle n'attend de
 * motif (cas normal : le contrôle est enregistré tout de suite). */
interface ControleEnAttenteMotif {
  passeportId: string;
  posteId: string;
  resultatLocal: ResultatControle;
  signatureValide: boolean;
  conformeItineraire: boolean | null;
  itineraireDisponible: boolean;
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
  const { t } = useI18n();
  const { utilisateur } = useAuth();
  const { enLigne, synchronisationEnCours, derniereErreur, controlesEnAttente, synchroniserMaintenant } = useDeltaSync();

  const [posteId, setPosteId] = useState(() => localStorage.getItem(CLE_POSTE_ID) ?? "");
  const [scanActif, setScanActif] = useState(true);
  const [enTraitement, setEnTraitement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [dernierResultat, setDernierResultat] = useState<DernierResultat | null>(null);
  const [gardeFou, setGardeFou] = useState<ControleResultatApi | null>(null);
  const [controleEnAttenteMotif, setControleEnAttenteMotif] = useState<ControleEnAttenteMotif | null>(null);
  const [motifSaisi, setMotifSaisi] = useState("");
  const [envoiMotifEnCours, setEnvoiMotifEnCours] = useState(false);

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
        setErreur(t("controle.aucun_passeport"));
        return;
      }

      const clePubliquePem = await obtenirClePubliqueLocale();
      if (!clePubliquePem) {
        setErreur(t("controle.cle_indisponible"));
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

      // Garde-fou anti-réutilisation — uniquement possible EN LIGNE : il
      // nécessite l'historique des scans faits par D'AUTRES agents à
      // d'autres postes, que le cache local synchronisé sur cet appareil
      // ne connaît pas à lui seul (voir backend/app/api/v1/endpoints/
      // controles.py::historique_pour_garde_fou pour le détail). Hors
      // connexion, ce contrôle est ignoré — comportement inchangé par
      // rapport à avant cette fonctionnalité, jamais un blocage lié au
      // réseau lui-même.
      let motifRequis = false;
      if (enLigne) {
        try {
          const { data } = await apiClient.get<ControleResultatApi>(`/controles/historique/${passeport.id}`, {
            params: { poste_id: posteId },
          });
          setGardeFou(data);
          motifRequis = data.motif_requis;
        } catch {
          // Échec de la consultation (réseau instable malgré enLigne=true,
          // etc.) : on se comporte comme hors-ligne — jamais bloquant.
          setGardeFou(null);
        }
      } else {
        setGardeFou(null);
      }

      if (motifRequis) {
        // Enregistrement SUSPENDU — voir confirmerAvecMotif, déclenché par
        // le formulaire affiché à l'agent (voir le rendu plus bas). Le
        // résultat reste affiché (setDernierResultat ci-dessus), seule la
        // remontée du contrôle attend la saisie.
        setControleEnAttenteMotif({
          passeportId: passeport.id,
          posteId,
          resultatLocal: resultat,
          signatureValide,
          conformeItineraire,
          itineraireDisponible,
        });
      } else {
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
      }
    } finally {
      setEnTraitement(false);
    }
  };

  /** Confirmation d'un contrôle mis en attente par le garde-fou
   * anti-réutilisation (voir traiterScan ci-dessus) — le motif saisi est
   * transmis avec le contrôle, jamais vérifié côté client : c'est
   * l'API qui refuse un contrôle motif_requis sans motif (voir
   * backend/app/api/v1/endpoints/controles.py::enregistrer_controle), ce
   * bouton se contente de ne pas s'activer tant que le champ est vide. */
  const confirmerAvecMotif = async () => {
    if (!controleEnAttenteMotif || !motifSaisi.trim()) return;
    setEnvoiMotifEnCours(true);
    try {
      const { latitude, longitude } = await obtenirPosition();
      await enregistrerControleLocalement({
        passeport_id: controleEnAttenteMotif.passeportId,
        poste_id: controleEnAttenteMotif.posteId,
        mode: enLigne ? "en_ligne" : "hors_ligne",
        resultat_local: controleEnAttenteMotif.resultatLocal,
        signature_valide: controleEnAttenteMotif.signatureValide,
        conforme_itineraire: controleEnAttenteMotif.conformeItineraire,
        itineraire_disponible_localement: controleEnAttenteMotif.itineraireDisponible,
        latitude,
        longitude,
        motif: motifSaisi.trim(),
      });
      setControleEnAttenteMotif(null);
      setMotifSaisi("");
    } finally {
      setEnvoiMotifEnCours(false);
    }
  };

  const nouveauScan = () => {
    setDernierResultat(null);
    setGardeFou(null);
    setControleEnAttenteMotif(null);
    setMotifSaisi("");
    setErreur(null);
    setScanActif(true);
  };

  if (!posteId) {
    return (
      <div className="mx-auto max-w-sm space-y-4 pt-10">
        <h1 className="text-xl font-semibold text-bleuCemac">{t("controle.identification_poste")}</h1>
        <p className="text-sm text-gray-500">{t("controle.identification_intro")}</p>
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
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-cebevirha/10">
            <ShieldCheck size={18} className="text-cebevirha" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-bleuCemac">{t("nav.controle")}</h1>
            <p className="text-xs text-gray-400">{t("controle.poste", { id: posteId })}</p>
          </div>
        </div>
        <button onClick={() => memoriserPosteId("")} className="text-xs text-gray-500 hover:underline">
          {t("controle.changer_poste")}
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

          {gardeFou && gardeFou.nb_scans_ce_poste > 0 && (
            <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">
                  {t("controle.deja_scanne_ce_poste", { n: gardeFou.nb_scans_ce_poste })}
                </p>
                <p className="mt-1 text-xs text-amber-700">{t("controle.verifiez_document_physique")}</p>
              </div>
            </div>
          )}

          <ApercuDocumentPasseport passeport={dernierResultat.passeport} itineraire={dernierResultat.itineraire} />

          {controleEnAttenteMotif ? (
            <div className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-800">{t("controle.motif_obligatoire_titre")}</p>
              <p className="text-xs text-red-700">{t("controle.motif_obligatoire_explication")}</p>
              <textarea
                value={motifSaisi}
                onChange={(e) => setMotifSaisi(e.target.value)}
                rows={2}
                placeholder={t("controle.motif_placeholder")}
                className="w-full rounded-md border border-red-300 p-2 text-sm"
              />
              <button
                onClick={confirmerAvecMotif}
                disabled={!motifSaisi.trim() || envoiMotifEnCours}
                className="w-full rounded-md bg-red-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
              >
                {envoiMotifEnCours ? "…" : t("controle.confirmer_avec_motif")}
              </button>
            </div>
          ) : (
            <button onClick={nouveauScan} className="w-full rounded-md bg-cebevirha px-4 py-3 text-sm font-medium text-white hover:bg-cebevirha-light">
              {t("controle.suivant")}
            </button>
          )}
        </div>
      ) : (
        <>
          {enTraitement && <p className="text-sm text-gray-500">{t("controle.verification_en_cours")}</p>}
          {erreur && (
            <div className="space-y-3">
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{erreur}</p>
              <button onClick={nouveauScan} className="text-sm text-cebevirha hover:underline">
                {t("controle.reessayer")}
              </button>
            </div>
          )}
          {!enTraitement && !erreur && <ScannerControle actif={scanActif} onDecode={traiterScan} />}
        </>
      )}
    </div>
  );
}

interface PosteAgent {
  code: string;
  nom: string;
}

const CLE_POSTES_CACHE = "ppb_postes_pays_agent";

function SaisiePosteId({ onValide }: { onValide: (valeur: string) => void }) {
  const { t } = useI18n();
  const [postes, setPostes] = useState<PosteAgent[] | null>(null);
  const [chargement, setChargement] = useState(true);
  const [codeSelectionne, setCodeSelectionne] = useState("");
  const [saisieLibre, setSaisieLibre] = useState("");
  const [modeSaisieLibre, setModeSaisieLibre] = useState(false);

  useEffect(() => {
    apiClient
      .get<PosteAgent[]>("/postes")
      .then(({ data }) => {
        setPostes(data);
        localStorage.setItem(CLE_POSTES_CACHE, JSON.stringify(data));
      })
      .catch(() => {
        // Hors-ligne ou erreur réseau — on retombe sur la dernière liste
        // connue de cet appareil (voir docstring de module plus haut :
        // jamais bloquant, même à la toute première identification du
        // poste). S'il n'y a jamais eu de synchronisation réussie sur cet
        // appareil, `postes` reste vide et la saisie libre prend le relais
        // automatiquement ci-dessous.
        const brut = localStorage.getItem(CLE_POSTES_CACHE);
        setPostes(brut ? JSON.parse(brut) : []);
      })
      .finally(() => setChargement(false));
  }, []);

  if (chargement) {
    return <p className="text-sm text-gray-500">{t("commun.chargement")}</p>;
  }

  // Liste déroulante tant qu'au moins un poste est connu pour ce compte
  // (en ligne ou via le cache) ; sinon, ou si l'agent choisit "Autres",
  // repli sur la saisie libre d'origine — jamais un écran bloqué faute de
  // liste disponible.
  if ((postes?.length ?? 0) > 0 && !modeSaisieLibre) {
    return (
      <div className="flex flex-col gap-2">
        <select
          value={codeSelectionne}
          onChange={(e) => {
            if (e.target.value === "__autre__") {
              setModeSaisieLibre(true);
            } else {
              setCodeSelectionne(e.target.value);
            }
          }}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="" disabled>
            {t("champ.choisir")}
          </option>
          {postes!.map((p) => (
            <option key={p.code} value={p.code}>
              {p.nom}
            </option>
          ))}
          <option value="__autre__">{t("controle.poste_autre")}</option>
        </select>
        <button
          onClick={() => codeSelectionne && onValide(codeSelectionne)}
          disabled={!codeSelectionne}
          className="rounded-md bg-cebevirha px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {t("action.continuer")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <input
        value={saisieLibre}
        onChange={(e) => setSaisieLibre(e.target.value)}
        placeholder={t("controle.placeholder_poste")}
        className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      <button onClick={() => saisieLibre && onValide(saisieLibre)} className="rounded-md bg-cebevirha px-4 py-2 text-sm font-medium text-white">
        {t("action.continuer")}
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
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5 text-gray-600">
        {enLigne ? <Wifi size={14} className="text-green-600" /> : <WifiOff size={14} className="text-amber-600" />}
        {enLigne ? (synchronisationEnCours ? t("sync.en_cours") : t("sync.en_ligne")) : t("controle.hors_ligne")}
      </span>
      <span className="flex items-center gap-2">
        {derniereErreur && <span className="text-amber-600">{derniereErreur}</span>}
        {controlesEnAttente > 0 && (
          <button onClick={onSynchroniser} className="flex items-center gap-1 font-medium text-cebevirha hover:underline">
            <RefreshCw size={12} /> {t("controle.en_attente_envoi", { n: controlesEnAttente })}
          </button>
        )}
      </span>
    </div>
  );
}

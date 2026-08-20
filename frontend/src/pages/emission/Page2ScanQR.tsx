import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { QrCode } from "lucide-react";
import { trouverParQrUuid } from "@/db/cachePasseports";
import { validerPageLocalement } from "@/db/queueEmission";
import { CONFIG_SCANNER_QR } from "@/utils/scannerQr";

interface Page2Props {
  onPasseportSelectionne: (passeportId: string, numero: string) => void;
}

const ID_LECTEUR = "lecteur-qr-ppb";

/**
 * Point d'entrée du Module 4 — identification du passeport via son QR Code
 * (Document technique). Le QR encode l'UUID brut du passeport (voir
 * backend/app/services/qrcode_service.py — jamais une URL, pour qu'un
 * scanner grand public n'y voie qu'un texte neutre) ; comparé au cache
 * local `passeports_precharges` — fonctionne intégralement hors-ligne dès
 * lors que le cache a été rafraîchi une première fois en ligne. Rescanner
 * un passeport déjà partiellement rempli est sans risque : la page 2 est
 * déjà actée, la reprise saute simplement à la prochaine page manquante
 * (voir EmissionTerrain.tsx::surPasseportIdentifie).
 */
export default function Page2ScanQR({ onPasseportSelectionne }: Page2Props) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [recherche, setRecherche] = useState(false);
  const lecteurRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    const lecteur = new Html5Qrcode(ID_LECTEUR);
    lecteurRef.current = lecteur;

    lecteur
      .start(
        { facingMode: "environment" },
        CONFIG_SCANNER_QR,
        (texteDecode) => void traiterResultat(texteDecode),
        () => {
          /* callback d'échec de lecture image par image — bruit normal, ignoré */
        }
      )
      .catch(() => setErreur("Caméra indisponible — utilisez la saisie manuelle ci-dessous."));

    return () => {
      void lecteur.stop().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const extraireQrUuid = (texteDecode: string): string => {
    // Le QR encode l'UUID brut ; le découpage sur "/" reste un repli inoffensif
    // si jamais un document plus ancien (avant ce changement de format) est scanné.
    const segments = texteDecode.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? texteDecode;
  };

  const traiterResultat = async (texteDecode: string) => {
    setRecherche(true);
    setErreur(null);
    try {
      const qrUuid = extraireQrUuid(texteDecode);
      const passeport = await trouverParQrUuid(qrUuid);
      if (!passeport) {
        setErreur("Ce QR ne correspond à aucun passeport préchargé pour vous. Rafraîchissez la liste si vous êtes en ligne.");
        return;
      }
      await lecteurRef.current?.pause(true);
      // donnees_json = null : la sélection EST la donnée (le passeport_id de l'URL des pages suivantes).
      await validerPageLocalement(passeport.id, 2, null);
      onPasseportSelectionne(passeport.id, passeport.numero);
    } finally {
      setRecherche(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Scan du QR Code</h2>
      <p className="text-sm text-gray-500">Visez le QR Code de validation en page 2 du document.</p>

      <div className="overflow-hidden rounded-lg border border-gray-200 [&_video]:!w-full [&_video]:!object-cover">
        {/* Conteneur mesuré par html5-qrcode : ni bordure ni padding sur cet
            élément précis (ceux-ci vivent sur le wrapper ci-dessus) — sinon
            la bibliothèque lit une largeur/hauteur faussée par leur épaisseur
            et positionne son cadre de visée légèrement décalé, surtout
            visible sur petit écran (signalé : cadre trop à droite et trop
            bas sur téléphone). `aspect-square` fixe une taille stable dès le
            premier rendu, avant même que la caméra ne démarre — sans elle,
            le conteneur peut mesurer 0 (ou une valeur transitoire) au moment
            où html5-qrcode calcule sa mise en page initiale. */}
        <div id={ID_LECTEUR} className="aspect-square w-full" />
      </div>

      {recherche && <p className="text-sm text-gray-500">Vérification…</p>}
      {erreur && <p className="text-sm text-red-600">{erreur}</p>}

      <SaisieManuelleQrUuid onValide={traiterResultat} />
    </div>
  );
}

function SaisieManuelleQrUuid({ onValide }: { onValide: (texte: string) => void }) {
  const [valeur, setValeur] = useState("");
  return (
    <details className="rounded-lg border border-gray-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-medium text-gray-700">
        <QrCode size={14} className="mr-1 inline" /> Caméra indisponible ? Saisie manuelle
      </summary>
      <div className="mt-3 flex gap-2">
        <input
          value={valeur}
          onChange={(e) => setValeur(e.target.value)}
          placeholder="UUID du QR Code"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          onClick={() => valeur && onValide(valeur)}
          className="rounded-md bg-cebevirha px-3 py-2 text-sm font-medium text-white"
        >
          Valider
        </button>
      </div>
    </details>
  );
}

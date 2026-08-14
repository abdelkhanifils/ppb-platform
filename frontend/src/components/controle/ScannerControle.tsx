import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { QrCode } from "lucide-react";

interface ScannerControleProps {
  actif: boolean;
  onDecode: (texteDecode: string) => void;
}

const ID_LECTEUR = "lecteur-qr-controle";

/** Scanner QR de l'application de contrôle — composant dédié plutôt que
 * partagé avec le Module 4 (Page2ScanQR) : les deux applications terrain
 * restent volontairement indépendantes (bases IndexedDB séparées, cf.
 * db/dbControle.ts), et leurs besoins divergent déjà (celle-ci scanne en
 * continu, celle du Module 4 s'arrête après une sélection). */
export default function ScannerControle({ actif, onDecode }: ScannerControleProps) {
  const [erreur, setErreur] = useState<string | null>(null);
  const lecteurRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    if (!actif) return;

    const lecteur = new Html5Qrcode(ID_LECTEUR);
    lecteurRef.current = lecteur;

    lecteur
      .start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onDecode, () => {
        /* callback d'échec de lecture image par image — bruit normal, ignoré */
      })
      .catch(() => setErreur("Caméra indisponible — utilisez la saisie manuelle ci-dessous."));

    return () => {
      void lecteur.stop().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif]);

  const extraireQrUuid = (texteDecode: string): string => {
    const segments = texteDecode.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? texteDecode;
  };

  return (
    <div className="space-y-3">
      <div id={ID_LECTEUR} className="overflow-hidden rounded-lg border border-gray-200" />
      {erreur && <p className="text-sm text-red-600">{erreur}</p>}
      <SaisieManuelle onValide={(texte) => onDecode(extraireQrUuid(texte))} />
    </div>
  );
}

function SaisieManuelle({ onValide }: { onValide: (texte: string) => void }) {
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
        <button onClick={() => valeur && onValide(valeur)} className="rounded-md bg-cebevirha px-3 py-2 text-sm font-medium text-white">
          Valider
        </button>
      </div>
    </details>
  );
}

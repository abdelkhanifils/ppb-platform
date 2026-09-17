import { useEffect, useRef, useState, type ReactNode } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { CONFIG_SCANNER_QR } from "@/utils/scannerQr";

interface ScannerControleProps {
  actif: boolean;
  onDecode: (texteDecode: string) => void;
  // Rendu exactement là où vivait l'ancienne saisie manuelle par UID
  // (retirée, voir plus haut) — même emplacement, la logique elle-même
  // vit désormais dans le composant parent (voir ControleFrontiere.tsx::
  // traiterSaisieManuelle), ce composant n'a plus besoin de la connaître.
  saisieManuelle?: ReactNode;
}

const ID_LECTEUR = "lecteur-qr-controle";

/** Scanner QR de l'application de contrôle — composant dédié plutôt que
 * partagé avec le Module 4 (Page2ScanQR) : les deux applications terrain
 * restent volontairement indépendantes (bases IndexedDB séparées, cf.
 * db/dbControle.ts), et leurs besoins divergent déjà (celle-ci scanne en
 * continu, celle du Module 4 s'arrête après une sélection). Seule la
 * config du cadre de visée adaptatif (utils/scannerQr.ts) est mutualisée —
 * un simple réglage d'affichage, sans logique métier.
 *
 * Pas de repli manuel intégré ici (contrairement à une version antérieure,
 * qui demandait l'UID brut du QR — 36 caractères, bien trop facile à mal
 * recopier à la main) : le repli par NUMÉRO de passeport, bien plus court
 * et déjà imprimé en gros sur le document, vit désormais au niveau
 * supérieur (voir ControleFrontiere.tsx::traiterSaisieManuelle), affiché
 * juste sous ce composant. */
export default function ScannerControle({ actif, onDecode, saisieManuelle }: ScannerControleProps) {
  const [erreur, setErreur] = useState<string | null>(null);
  const lecteurRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    if (!actif) return;

    const lecteur = new Html5Qrcode(ID_LECTEUR);
    lecteurRef.current = lecteur;

    lecteur
      .start({ facingMode: "environment" }, CONFIG_SCANNER_QR, onDecode, () => {
        /* callback d'échec de lecture image par image — bruit normal, ignoré */
      })
      .catch(() => setErreur("Caméra indisponible — utilisez la saisie manuelle ci-dessous."));

    return () => {
      void lecteur.stop().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif]);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-gray-200 [&_video]:!w-full [&_video]:!object-cover">
        {/* Voir Page2ScanQR.tsx (Module 4) pour l'explication détaillée de
            cette séparation — même bibliothèque, même correction. */}
        <div id={ID_LECTEUR} className="aspect-square w-full" />
      </div>
      {erreur && <p className="text-sm text-red-600">{erreur}</p>}
      {saisieManuelle}
    </div>
  );
}

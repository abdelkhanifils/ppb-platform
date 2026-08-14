import { useEffect, useState } from "react";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useSyncManager } from "@/hooks/useSyncManager";
import { listerPasseportsPrecharges, rafraichirPasseportsPrecharges, retirerPasseportPrecharge } from "@/db/cachePasseports";
import { prechargerTousLesSchemas } from "@/db/cacheSchemas";
import { obtenirProgressionPasseport } from "@/db/queueEmission";
import type { PasseportPrecharge } from "@/types/emission";
import Page1VerificationVisuelle from "./emission/Page1VerificationVisuelle";
import Page2ScanQR from "./emission/Page2ScanQR";
import Page3Identification from "./emission/Page3Identification";
import Page4Troupeau from "./emission/Page4Troupeau";

type Etape = { passeportId: string; numero: string; page: 1 | 2 | 3 | 4 };

/**
 * Écran du Module 4 — Émission terrain (PWA hors-ligne).
 *
 * Deux temps :
 * 1. Sélection du passeport (liste préchargée, ou scan direct qui sélectionne
 *    lui-même — voir Page2ScanQR) — appuie sur le cache IndexedDB, jamais
 *    une dépendance réseau bloquante.
 * 2. Parcours page par page (1 à 4), chaque validation écrivant dans la file
 *    de synchronisation locale (voir src/db/queueEmission.ts) avant même de
 *    tenter un envoi réseau.
 */
export default function EmissionTerrain() {
  const { enLigne, synchronisationEnCours, entreesEnEchec, synchroniserMaintenant } = useSyncManager();
  const [passeports, setPasseports] = useState<PasseportPrecharge[]>([]);
  const [rafraichissement, setRafraichissement] = useState(false);
  const [etape, setEtape] = useState<Etape | null>(null);

  const chargerListeLocale = async () => setPasseports(await listerPasseportsPrecharges());

  useEffect(() => {
    void chargerListeLocale();
    if (navigator.onLine) {
      void rafraichirPasseportsPrecharges().then(chargerListeLocale).catch(() => undefined);
      void prechargerTousLesSchemas();
    }
  }, []);

  const rafraichir = async () => {
    setRafraichissement(true);
    try {
      await rafraichirPasseportsPrecharges();
      await chargerListeLocale();
    } catch {
      // hors-ligne : la liste locale reste valable, rien à signaler d'alarmant à l'agent
    } finally {
      setRafraichissement(false);
    }
  };

  const demarrerEmission = async (passeport: PasseportPrecharge) => {
    const pagesActees = await obtenirProgressionPasseport(passeport.id);
    const prochainePage = ([1, 2, 3, 4] as const).find((p) => !pagesActees.has(p)) ?? 4;
    setEtape({ passeportId: passeport.id, numero: passeport.numero, page: prochainePage });
  };

  const surPageValidee = async () => {
    if (!etape) return;
    if (etape.page === 4) {
      await retirerPasseportPrecharge(etape.passeportId);
      await chargerListeLocale();
      setEtape(null);
      return;
    }
    setEtape({ ...etape, page: (etape.page + 1) as 2 | 3 | 4 });
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <BandeauSynchronisation
        enLigne={enLigne}
        synchronisationEnCours={synchronisationEnCours}
        nombreEnEchec={entreesEnEchec.length}
        onSynchroniser={synchroniserMaintenant}
      />

      {!etape ? (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-gray-900">Passeports à émettre</h1>
            <button onClick={rafraichir} disabled={rafraichissement} className="flex items-center gap-1.5 text-sm text-cebevirha">
              <RefreshCw size={14} className={rafraichissement ? "animate-spin" : ""} />
              Actualiser
            </button>
          </div>

          {passeports.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
              Aucun passeport préchargé localement. Connectez-vous au réseau puis actualisez.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
              {passeports.map((p) => (
                <li key={p.id}>
                  <button onClick={() => demarrerEmission(p)} className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50">
                    <span className="font-mono text-sm text-gray-800">{p.numero}</span>
                    <span className="text-xs text-cebevirha">Émettre →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-sm text-gray-500">{etape.numero}</p>
              <p className="text-xs text-gray-400">Page {etape.page} sur 4</p>
            </div>
            <button onClick={() => setEtape(null)} className="text-sm text-gray-500 hover:underline">
              Annuler
            </button>
          </div>

          <div className="flex gap-1">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className={`h-1 flex-1 rounded-full ${n <= etape.page ? "bg-cebevirha" : "bg-gray-200"}`} />
            ))}
          </div>

          {etape.page === 1 && <Page1VerificationVisuelle passeportId={etape.passeportId} onValidee={surPageValidee} />}
          {etape.page === 2 && (
            <Page2ScanQR
              onPasseportSelectionne={(id, numero) => setEtape({ passeportId: id, numero, page: 3 })}
            />
          )}
          {etape.page === 3 && <Page3Identification passeportId={etape.passeportId} onValidee={surPageValidee} />}
          {etape.page === 4 && <Page4Troupeau passeportId={etape.passeportId} onValidee={surPageValidee} />}
        </>
      )}
    </div>
  );
}

function BandeauSynchronisation({
  enLigne,
  synchronisationEnCours,
  nombreEnEchec,
  onSynchroniser,
}: {
  enLigne: boolean;
  synchronisationEnCours: boolean;
  nombreEnEchec: number;
  onSynchroniser: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5 text-gray-600">
        {enLigne ? <Wifi size={14} className="text-green-600" /> : <WifiOff size={14} className="text-amber-600" />}
        {enLigne ? (synchronisationEnCours ? "Synchronisation en cours…" : "En ligne") : "Hors-ligne — les saisies sont conservées localement"}
      </span>
      {nombreEnEchec > 0 && (
        <button onClick={onSynchroniser} className="font-medium text-red-600 hover:underline">
          {nombreEnEchec} en échec — réessayer
        </button>
      )}
    </div>
  );
}

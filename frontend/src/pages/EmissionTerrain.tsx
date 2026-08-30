import { useEffect, useState } from "react";
import { ChevronDown, RefreshCw, ScanLine, Wifi, WifiOff } from "lucide-react";
import { useSyncManager } from "@/hooks/useSyncManager";
import { listerPasseportsPrecharges, rafraichirPasseportsPrecharges, retirerPasseportPrecharge } from "@/db/cachePasseports";
import { prechargerTousLesSchemas } from "@/db/cacheSchemas";
import { obtenirProgressionPasseport } from "@/db/queueEmission";
import type { EntreeFileSynchronisation } from "@/db/schema";
import type { PasseportPrecharge } from "@/types/emission";
import { useI18n } from "@/lib/i18n";
import Page1VerificationVisuelle from "./emission/Page1VerificationVisuelle";
import Page2ScanQR from "./emission/Page2ScanQR";
import Page3Identification from "./emission/Page3Identification";
import Page4Troupeau from "./emission/Page4Troupeau";

type Etape = { passeportId: string; numero: string; page: 1 | 3 | 4 };

/**
 * Écran du Module 4 — Émission terrain (PWA hors-ligne).
 *
 * Le SCAN est le point d'entrée — jamais une recherche manuelle dans une
 * liste au préalable : l'agent vise le QR Code du document, et le système
 * retrouve seul le passeport correspondant dans le cache local (voir
 * Page2ScanQR::trouverParQrUuid), y compris hors-ligne. Rescanner un
 * passeport déjà partiellement rempli reprend automatiquement à la bonne
 * page (page 2 — le scan lui-même — étant alors déjà actée).
 *
 * La liste des passeports préchargés reste disponible, mais seulement comme
 * option secondaire repliée (reprendre sans avoir le document sous la main,
 * ou caméra indisponible malgré la saisie manuelle de l'UUID).
 */
export default function EmissionTerrain() {
  const { t } = useI18n();
  const { enLigne, synchronisationEnCours, entreesEnEchec, synchroniserMaintenant } = useSyncManager();
  const [passeports, setPasseports] = useState<PasseportPrecharge[]>([]);
  const [rafraichissement, setRafraichissement] = useState(false);
  const [etape, setEtape] = useState<Etape | null>(null);
  const [messageSucces, setMessageSucces] = useState<string | null>(null);

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

  /** Appelé après un scan réussi (ou une reprise depuis la liste repliée) —
   * détermine seul la prochaine page à afficher selon ce qui a déjà été
   * validé pour ce passeport précis. */
  const surPasseportIdentifie = async (passeportId: string, numero: string) => {
    const pagesActees = await obtenirProgressionPasseport(passeportId);
    const prochainePage = ([1, 3, 4] as const).find((p) => !pagesActees.has(p)) ?? 4;
    setEtape({ passeportId, numero, page: prochainePage });
  };

  const surPageValidee = async () => {
    if (!etape) return;
    if (etape.page === 4) {
      const numeroTermine = etape.numero;
      await retirerPasseportPrecharge(etape.passeportId);
      await chargerListeLocale();
      setEtape(null);
      // Confirmation explicite avant de retomber sur l'écran de scan —
      // sans elle, l'agent n'a aucun moyen de savoir si les 4 pages ont
      // bien été enregistrées ou si quelque chose s'est perdu en route
      // (signalé : le retour silencieux au scan donnait cette impression).
      setMessageSucces(t("emission.succes", { numero: numeroTermine }));
      setTimeout(() => setMessageSucces(null), 6000);
      return;
    }
    const suivante = etape.page === 1 ? 3 : 4;
    setEtape({ ...etape, page: suivante });
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <BandeauSynchronisation
        enLigne={enLigne}
        synchronisationEnCours={synchronisationEnCours}
        entreesEnEchec={entreesEnEchec}
        onSynchroniser={synchroniserMaintenant}
      />

      {!etape ? (
        <>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-bleuCemac">
            <ScanLine size={20} className="text-cebevirha" /> {t("emission.titre")}
          </h1>
          {messageSucces && (
            <p className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">✓ {messageSucces}</p>
          )}
          <Page2ScanQR onPasseportSelectionne={surPasseportIdentifie} />

          <ListePasseportsRepliee
            passeports={passeports}
            rafraichissement={rafraichissement}
            onRafraichir={rafraichir}
            onSelection={surPasseportIdentifie}
          />
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-sm text-gray-500">{etape.numero}</p>
              <p className="text-xs text-gray-400">{t("emission.page_sur", { page: etape.page })}</p>
            </div>
            <button onClick={() => setEtape(null)} className="text-sm text-gray-500 hover:underline">
              {t("emission.annuler")}
            </button>
          </div>

          <div className="flex gap-1">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className={`h-1 flex-1 rounded-full ${n <= etape.page ? "bg-cebevirha" : "bg-gray-200"}`} />
            ))}
          </div>

          {etape.page === 1 && <Page1VerificationVisuelle passeportId={etape.passeportId} onValidee={surPageValidee} />}
          {etape.page === 3 && <Page3Identification passeportId={etape.passeportId} onValidee={surPageValidee} />}
          {etape.page === 4 && <Page4Troupeau passeportId={etape.passeportId} onValidee={surPageValidee} />}
        </>
      )}
    </div>
  );
}

function ListePasseportsRepliee({
  passeports,
  rafraichissement,
  onRafraichir,
  onSelection,
}: {
  passeports: PasseportPrecharge[];
  rafraichissement: boolean;
  onRafraichir: () => void;
  onSelection: (id: string, numero: string) => void;
}) {
  const { t } = useI18n();
  const [ouverte, setOuverte] = useState(false);

  return (
    <details className="rounded-lg border border-gray-200 bg-white" open={ouverte} onToggle={(e) => setOuverte(e.currentTarget.open)}>
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-gray-700">
        <span>{t("emission.liste_repliee")}</span>
        <ChevronDown size={16} className={`transition-transform ${ouverte ? "rotate-180" : ""}`} />
      </summary>
      <div className="border-t border-gray-100 px-4 py-3">
        <div className="mb-2 flex justify-end">
          <button onClick={onRafraichir} disabled={rafraichissement} className="flex items-center gap-1.5 text-xs text-cebevirha">
            <RefreshCw size={12} className={rafraichissement ? "animate-spin" : ""} />
            {t("emission.actualiser")}
          </button>
        </div>
        {passeports.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">{t("emission.liste_vide")}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {passeports.map((p) => (
              <li key={p.id}>
                <button onClick={() => onSelection(p.id, p.numero)} className="flex w-full items-center justify-between py-2.5 text-left">
                  <span className="font-mono text-sm text-gray-800">{p.numero}</span>
                  <span className="text-xs text-cebevirha">{t("emission.reprendre")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function BandeauSynchronisation({
  enLigne,
  synchronisationEnCours,
  entreesEnEchec,
  onSynchroniser,
}: {
  enLigne: boolean;
  synchronisationEnCours: boolean;
  entreesEnEchec: EntreeFileSynchronisation[];
  onSynchroniser: () => void;
}) {
  const { t } = useI18n();
  const [detailOuvert, setDetailOuvert] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-gray-600">
          {enLigne ? <Wifi size={14} className="text-green-600" /> : <WifiOff size={14} className="text-amber-600" />}
          {enLigne ? (synchronisationEnCours ? t("sync.en_cours") : t("sync.en_ligne")) : t("sync.hors_ligne")}
        </span>
        {entreesEnEchec.length > 0 && (
          <div className="flex items-center gap-3">
            <button onClick={() => setDetailOuvert((v) => !v)} className="text-gray-500 hover:underline">
              {detailOuvert ? t("sync.masquer_detail") : t("sync.voir_detail")}
            </button>
            <button onClick={onSynchroniser} className="font-medium text-red-600 hover:underline">
              {t("sync.en_echec", { n: entreesEnEchec.length })}
            </button>
          </div>
        )}
      </div>
      {detailOuvert && entreesEnEchec.length > 0 && (
        // Détail brut des échecs — jamais vu auparavant, seul le NOMBRE
        // était affiché jusqu'ici. `derniere_erreur` était déjà capturé
        // localement (voir db/queueEmission.ts) mais ne remontait nulle
        // part à l'écran, obligeant à aller chercher dans les logs
        // serveur pour un diagnostic que l'agent avait déjà sous la main.
        <ul className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
          {entreesEnEchec.map((entree) => (
            <li key={entree.id} className="rounded bg-red-50 px-2 py-1.5">
              <p className="font-mono text-gray-700">
                {t("sync.page_passeport", {
                  page: entree.page_num,
                  id: entree.passeport_id.slice(0, 8),
                  n: entree.tentatives,
                  s: entree.tentatives > 1 ? "s" : "",
                })}
              </p>
              <p className="text-red-700">{entree.derniere_erreur ?? t("sync.erreur_inconnue")}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

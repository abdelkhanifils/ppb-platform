import { useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { apiClient } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@/types/roles";
import type { Commande } from "@/types/commande";
import type { AutorisationImpression, PasseportResume } from "@/types/impression";
import { useI18n } from "@/lib/i18n";

interface PaysApi {
  id: number;
  code_iso: string;
  nom: string;
}

/**
 * Module 3 — Impression (Document technique §3, M3). Un seul geste, quel
 * que soit le mode : choisir un nombre, ouvrir l'aperçu PDF, imprimer — le
 * serveur décompte automatiquement ce qui vient d'être généré (voir
 * Passeport.imprime_le). Pour un Admin National, ce geste n'est disponible
 * QUE si son pays a une autorisation d'impression décentralisée active
 * (voir SectionAutorisations, gérée par Super Admin) — sans elle, aucune
 * action, juste un rappel que l'impression se fait au siège. L'ancien
 * formulaire "numéro de début / numéro de fin" (déclarer un lot après coup)
 * a été retiré : un même geste partout, plus simple à comprendre et à
 * auditer qu'une déclaration a posteriori sur une plage saisie à la main.
 * Les passeports passent directement au statut VIERGE dès la validation du
 * paiement (voir app.api.v1.endpoints.paiements::valider_paiement_presentiel).
 */
export default function Impression() {
  const { utilisateur } = useAuth();
  const { t } = useI18n();
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [pays, setPays] = useState<PaysApi[]>([]);
  const [chargement, setChargement] = useState(true);
  // Uniquement pertinent pour un Admin National — indéfini tant que non
  // chargé, `null` si aucune autorisation active.
  const [autorisationPays, setAutorisationPays] = useState<AutorisationImpression | null | undefined>(undefined);

  const charger = () => {
    setChargement(true);
    Promise.all([
      apiClient.get<Commande[]>("/commandes"),
      apiClient.get<PaysApi[]>("/pays"),
    ])
      .then(([reponseCommandes, reponsePays]) => {
        setCommandes(reponseCommandes.data.filter((c) => c.statut === "payee"));
        setPays(reponsePays.data);
      })
      .finally(() => setChargement(false));
  };

  useEffect(charger, []);

  useEffect(() => {
    if (utilisateur?.role !== Role.ADMIN_NATIONAL || utilisateur.pays_id === null) return;
    apiClient
      .get<AutorisationImpression>(`/passeports/autorisations-impression/${utilisateur.pays_id}`)
      .then(({ data }) => setAutorisationPays(data))
      .catch(() => setAutorisationPays(null));
  }, [utilisateur]);

  const nomPays = (paysId: number) => pays.find((p) => p.id === paysId)?.nom ?? `${t("commun.pays")} #${paysId}`;

  const estAdminNational = utilisateur?.role === Role.ADMIN_NATIONAL;
  const peutImprimer =
    utilisateur?.role === Role.SUPER_ADMIN || utilisateur?.role === Role.GESTIONNAIRE_CEBEVIRHA || (estAdminNational && !!autorisationPays);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3 rounded-lg border border-or/40 bg-amber-50 px-4 py-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-cebevirha/10">
          <Printer size={20} className="text-cebevirha" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-bleuCemac">{t("nav.impression")}</h1>
          <p className="text-sm text-gray-500">{t("impression.description")}</p>
        </div>
      </div>

      {peutImprimer ? (
        <section className="rounded-lg border border-or/40 bg-white">
          <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-800">{t("impression.commandes_payees")}</div>
          {chargement ? (
            <p className="p-4 text-sm text-gray-500">{t("commun.chargement")}</p>
          ) : commandes.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">{t("impression.aucune_en_attente")}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {commandes.map((c) => (
                <LigneCommande key={c.id} commande={c} nomPays={nomPays(c.pays_id)} limiterAAutorisation={estAdminNational} />
              ))}
            </ul>
          )}
        </section>
      ) : (
        estAdminNational &&
        autorisationPays === null && (
          <section className="rounded-lg border border-or/40 bg-white p-4">
            <p className="mb-1 text-sm font-semibold text-gray-800">{t("impression.commandes_payees")}</p>
            <p className="text-sm text-gray-500">{t("impression.aucune_autorisation_pays")}</p>
          </section>
        )
      )}

      {utilisateur?.role === Role.SUPER_ADMIN && <SectionAutorisations pays={pays} />}
    </div>
  );
}

function LigneCommande({
  commande,
  nomPays,
  limiterAAutorisation,
}: {
  commande: Commande;
  nomPays: string;
  limiterAAutorisation: boolean;
}) {
  const { t } = useI18n();
  const [passeports, setPasseports] = useState<PasseportResume[] | null>(null);
  const [nombreAAfficher, setNombreAAfficher] = useState(50);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvertureEnCours, setOuvertureEnCours] = useState(false);

  const chargerPasseports = () => {
    apiClient
      .get<PasseportResume[]>("/passeports", { params: { commande_id: commande.id, limiter_a_autorisation: limiterAAutorisation } })
      .then(({ data }) => setPasseports(data));
  };

  useEffect(chargerPasseports, [commande.id]);

  // Seuls les passeports PAS ENCORE imprimés comptent comme "disponibles" —
  // voir backend/app/models/passeport.py::imprime_le pour le garde-fou
  // anti-doublon dont ceci est le pendant côté affichage.
  const nbRestants = useMemo(() => (passeports ?? []).filter((p) => !p.imprime).length, [passeports]);

  const ouvrirDocument = async () => {
    // Décompte immédiat, dès l'ouverture — pas de confirmation séparée
    // (choix produit) : le serveur marque lui-même le lot comme imprimé au
    // moment où il génère le document (voir document_impression_commande),
    // jamais avant d'avoir réussi à le générer.
    setErreur(null);
    setOuvertureEnCours(true);
    try {
      const { data } = await apiClient.get(`/passeports/commande/${commande.id}/document-impression`, {
        params: { limite: nombreAAfficher },
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      window.open(url, "_blank");
      chargerPasseports();
    } catch {
      setErreur(t("impression.document_echoue"));
    } finally {
      setOuvertureEnCours(false);
    }
  };

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800">
            {nomPays} — {commande.quantite.toLocaleString("fr-FR")} PPB
          </p>
          <p className="text-xs text-gray-500 capitalize">{t("impression.mode", { mode: commande.mode_impression })}</p>
        </div>
        <p className="text-xs text-gray-500">{t("impression.nb_disponibles", { n: nbRestants })}</p>
      </div>

      {nbRestants > 0 && (
        <div className="mt-2 flex items-center justify-end gap-2">
          {erreur && <p className="text-xs text-red-600">{erreur}</p>}
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            {t("impression.nombre_a_afficher")}
            <input
              type="number"
              min={1}
              max={nbRestants}
              value={Math.min(nombreAAfficher, nbRestants)}
              onChange={(e) => setNombreAAfficher(Math.max(1, Math.min(nbRestants, Number(e.target.value))))}
              className="w-16 rounded-md border border-gray-300 px-2 py-1 text-xs"
            />
          </label>
          <button
            onClick={ouvrirDocument}
            disabled={ouvertureEnCours}
            className="rounded-md bg-cebevirha px-3 py-1.5 text-xs font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
          >
            {ouvertureEnCours ? "…" : t("impression.ouvrir_pdf")}
          </button>
        </div>
      )}
    </li>
  );
}

function SectionAutorisations({ pays }: { pays: PaysApi[] }) {
  const { t } = useI18n();
  const [autorisationsParPays, setAutorisationsParPays] = useState<Record<number, AutorisationImpression | null>>({});
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  const charger = () => {
    pays.forEach((p) => {
      apiClient
        .get<AutorisationImpression>(`/passeports/autorisations-impression/${p.id}`)
        .then(({ data }) => setAutorisationsParPays((m) => ({ ...m, [p.id]: data })))
        .catch(() => setAutorisationsParPays((m) => ({ ...m, [p.id]: null })));
    });
  };

  useEffect(() => {
    if (pays.length > 0) charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pays]);

  const suspendre = async (autorisationId: string) => {
    await apiClient.post(`/passeports/autorisations-impression/${autorisationId}/suspendre`);
    charger();
  };

  return (
    <section className="rounded-lg border border-or/40 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <p className="text-sm font-semibold text-gray-800">{t("impression.autorisations_titre")}</p>
        <button onClick={() => setFormulaireOuvert(true)} className="rounded-md bg-cebevirha px-3 py-1.5 text-xs font-medium text-white hover:bg-cebevirha-light">
          {t("impression.nouvelle_autorisation")}
        </button>
      </div>

      {formulaireOuvert && (
        <div className="border-b border-gray-100 p-4">
          <FormulaireNouvelleAutorisation pays={pays} onAnnuler={() => setFormulaireOuvert(false)} onCree={() => { setFormulaireOuvert(false); charger(); }} />
        </div>
      )}

      <ul className="divide-y divide-gray-100">
        {pays.map((p) => {
          const autorisation = autorisationsParPays[p.id];
          return (
            <li key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>{p.nom}</span>
              {autorisation ? (
                <span className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">
                    {t("impression.plage", { debut: autorisation.plage_debut, fin: autorisation.plage_fin, version: autorisation.gabarit_version })}
                  </span>
                  <button onClick={() => suspendre(autorisation.id)} className="text-xs text-red-600 hover:underline">
                    {t("impression.suspendre")}
                  </button>
                </span>
              ) : (
                <span className="text-xs text-gray-400">{t("impression.aucune_autorisation")}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FormulaireNouvelleAutorisation({ pays, onAnnuler, onCree }: { pays: PaysApi[]; onAnnuler: () => void; onCree: () => void }) {
  const { t } = useI18n();
  const [paysId, setPaysId] = useState<number | null>(pays[0]?.id ?? null);
  const [plageDebut, setPlageDebut] = useState(1);
  const [plageFin, setPlageFin] = useState(1000);
  const [gabaritVersion, setGabaritVersion] = useState(1);
  const [erreur, setErreur] = useState<string | null>(null);

  const soumettre = async () => {
    setErreur(null);
    if (paysId === null) return;
    try {
      await apiClient.post("/passeports/autorisations-impression", {
        pays_id: paysId,
        plage_debut: plageDebut,
        plage_fin: plageFin,
        gabarit_version: gabaritVersion,
      });
      onCree();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErreur(detail ?? t("impression.creation_echouee"));
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-or/40 bg-gray-50 p-3">
      <div className="grid grid-cols-4 gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-600">{t("commun.pays")}</span>
          <select value={paysId ?? ""} onChange={(e) => setPaysId(Number(e.target.value))} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            {pays.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-600">{t("impression.numero_debut")}</span>
          <input type="number" value={plageDebut} onChange={(e) => setPlageDebut(Number(e.target.value))} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-600">{t("impression.numero_fin")}</span>
          <input type="number" value={plageFin} onChange={(e) => setPlageFin(Number(e.target.value))} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-600">{t("impression.version_gabarit")}</span>
          <input type="number" value={gabaritVersion} onChange={(e) => setGabaritVersion(Number(e.target.value))} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
      </div>
      {erreur && <p className="text-sm text-red-600">{erreur}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onAnnuler} className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
          {t("action.annuler")}
        </button>
        <button onClick={soumettre} className="rounded-md bg-cebevirha px-3 py-1.5 text-xs font-medium text-white hover:bg-cebevirha-light">
          {t("action.creer")}
        </button>
      </div>
    </div>
  );
}

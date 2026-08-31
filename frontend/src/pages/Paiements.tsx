import { useEffect, useMemo, useState } from "react";
import { CreditCard, CheckCircle2, Clock, XCircle, Wallet, Plus, X, Download, Filter, Eye } from "lucide-react";
import { apiClient } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@/types/roles";
import type { Commande } from "@/types/commande";
import type { MoyenPaiement, Paiement, StatutPaiement } from "@/types/paiement";
import { LIBELLES_MOYEN_PAIEMENT, LIBELLES_STATUT_PAIEMENT } from "@/types/paiement";
import { useI18n } from "@/lib/i18n";
import { drapeauPays } from "@/lib/drapeaux";
import CarteStatIconee from "@/components/CarteStatIconee";

interface PaysApi {
  id: number;
  code_iso: string;
  nom: string;
}

/**
 * Module 2 — Paiement. Uniquement le paiement présentiel/virement (CinetPay
 * retiré, voir backend/app/api/v1/endpoints/paiements.py). Reconstruit en
 * tableau filtrable (toutes les transactions, pas une commande à la fois) —
 * l'enregistrement et la validation d'un paiement restent les mêmes actions
 * qu'avant, accessibles depuis ce tableau plutôt que depuis un écran maître-détail.
 */
export default function Paiements() {
  const { utilisateur } = useAuth();
  const { t } = useI18n();
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [pays, setPays] = useState<PaysApi[]>([]);
  const [paiements, setPaiements] = useState<Paiement[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  // Filtres — appliqués côté client, la liste complète des paiements visibles
  // par l'utilisateur (déjà filtrée par pays côté serveur) est chargée une fois.
  const [filtrePays, setFiltrePays] = useState<number | "tous">("tous");
  const [filtreStatut, setFiltreStatut] = useState<StatutPaiement | "tous">("tous");
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");

  const chargerTout = () => {
    setChargement(true);
    Promise.all([
      apiClient.get<PaysApi[]>("/pays").then(({ data }) => setPays(data)),
      apiClient.get<Commande[]>("/commandes").then(({ data }) => setCommandes(data)),
      apiClient.get<Paiement[]>("/paiements").then(({ data }) => setPaiements(data)),
    ])
      .catch(() => setErreur(t("commandes.erreur_chargement")))
      .finally(() => setChargement(false));
  };

  useEffect(chargerTout, []);

  const commandeParId = useMemo(() => new Map(commandes.map((c) => [c.id, c])), [commandes]);
  const nomPays = (paysId: number) => {
    const p = pays.find((p) => p.id === paysId);
    return p ? `${drapeauPays(p.code_iso)} ${p.nom}` : `${t("commun.pays")} #${paysId}`;
  };

  const paiementsFiltres = useMemo(() => {
    return paiements
      .filter((p) => {
        const commande = commandeParId.get(p.commande_id);
        if (filtrePays !== "tous" && commande?.pays_id !== filtrePays) return false;
        if (filtreStatut !== "tous" && p.statut !== filtreStatut) return false;
        const jour = p.cree_le?.slice(0, 10);
        if (dateDebut && jour && jour < dateDebut) return false;
        if (dateFin && jour && jour > dateFin) return false;
        return true;
      })
      .sort((a, b) => (a.cree_le < b.cree_le ? 1 : -1));
  }, [paiements, commandeParId, filtrePays, filtreStatut, dateDebut, dateFin]);

  const totaux = useMemo(() => {
    const valides = paiements.filter((p) => p.statut === "valide");
    return {
      montantTotal: valides.reduce((s, p) => s + p.montant, 0),
      nbValides: valides.length,
      nbEnAttente: paiements.filter((p) => p.statut === "en_attente_validation").length,
      nbEchoues: paiements.filter((p) => p.statut === "echoue").length,
    };
  }, [paiements]);

  const exporterCsv = () => {
    const entetes = ["Date", "Commande", "Pays", "Montant", "Devise", "Mode de paiement", "Statut", "Référence"];
    const lignes = paiementsFiltres.map((p) => {
      const commande = commandeParId.get(p.commande_id);
      return [
        new Date(p.cree_le).toLocaleString("fr-FR"),
        p.commande_id.slice(0, 8).toUpperCase(),
        commande ? nomPays(commande.pays_id) : "",
        p.montant,
        p.devise,
        LIBELLES_MOYEN_PAIEMENT[p.moyen],
        LIBELLES_STATUT_PAIEMENT[p.statut],
        p.id.slice(0, 8).toUpperCase(),
      ];
    });
    const contenu = [entetes, ...lignes].map((ligne) => ligne.map((v) => `"${v}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + contenu], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `paiements_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cebevirha/10">
            <CreditCard size={20} className="text-cebevirha" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-bleuCemac">{t("nav.paiements")}</h1>
            <p className="text-sm text-gray-500">{t("paiements.description")}</p>
          </div>
        </div>
        <button
          onClick={() => setFormulaireOuvert(true)}
          className="flex items-center gap-1.5 rounded-md bg-cebevirha px-4 py-2 text-sm font-medium text-white hover:bg-cebevirha-light"
        >
          <Plus size={16} /> Enregistrer un paiement
        </button>
      </div>

      {chargement && <p className="text-sm text-gray-500">{t("commun.chargement")}</p>}
      {erreur && <p className="text-sm text-red-600">{erreur}</p>}

      {!chargement && !erreur && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <CarteStatIconee icone={Wallet} couleur="vert" libelle="Montant total (XAF)" valeur={totaux.montantTotal.toLocaleString("fr-FR")} />
            <CarteStatIconee icone={CheckCircle2} couleur="bleu" libelle="Paiements validés" valeur={totaux.nbValides} />
            <CarteStatIconee icone={Clock} couleur="or" libelle="En attente" valeur={totaux.nbEnAttente} />
            <CarteStatIconee icone={XCircle} couleur="rouge" libelle="Échoués" valeur={totaux.nbEchoues} />
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
            <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
            <span className="text-sm text-gray-400">→</span>
            <input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm" />
            <select
              value={filtrePays}
              onChange={(e) => setFiltrePays(e.target.value === "tous" ? "tous" : Number(e.target.value))}
              className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            >
              <option value="tous">Tous pays</option>
              {pays.map((p) => (
                <option key={p.id} value={p.id}>
                  {drapeauPays(p.code_iso)} {p.nom}
                </option>
              ))}
            </select>
            <select
              value={filtreStatut}
              onChange={(e) => setFiltreStatut(e.target.value as StatutPaiement | "tous")}
              className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            >
              <option value="tous">Tous statuts</option>
              {(Object.keys(LIBELLES_STATUT_PAIEMENT) as StatutPaiement[]).map((s) => (
                <option key={s} value={s}>
                  {LIBELLES_STATUT_PAIEMENT[s]}
                </option>
              ))}
            </select>
            <button
              onClick={chargerTout}
              className="flex items-center gap-1.5 rounded-md bg-cebevirha px-3 py-1.5 text-sm font-medium text-white hover:bg-cebevirha-light"
            >
              <Filter size={14} /> Filtrer
            </button>
            <button
              onClick={exporterCsv}
              className="ml-auto flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              <Download size={14} /> Exporter
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-cebevirha/5 text-sm font-medium text-bleuCemac">
                <tr>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Commande</th>
                  <th className="px-4 py-2.5">{t("commun.pays")}</th>
                  <th className="px-4 py-2.5">{t("commandes.montant")}</th>
                  <th className="px-4 py-2.5">Mode de paiement</th>
                  <th className="px-4 py-2.5">Statut</th>
                  <th className="px-4 py-2.5">Référence</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {paiementsFiltres.map((p) => {
                  const commande = commandeParId.get(p.commande_id);
                  return (
                    <tr key={p.id} className="border-t border-gray-100">
                      <td className="px-4 py-2.5 text-xs text-gray-500">{new Date(p.cree_le).toLocaleString("fr-FR")}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{p.commande_id.slice(0, 8).toUpperCase()}</td>
                      <td className="px-4 py-2.5">{commande ? nomPays(commande.pays_id) : "—"}</td>
                      <td className="px-4 py-2.5">
                        {p.montant.toLocaleString("fr-FR")} {p.devise}
                      </td>
                      <td className="px-4 py-2.5">{LIBELLES_MOYEN_PAIEMENT[p.moyen]}</td>
                      <td className="px-4 py-2.5">
                        <BadgeStatut statut={p.statut} />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{p.id.slice(0, 8).toUpperCase()}</td>
                      <td className="px-4 py-2.5">
                        {utilisateur?.role === Role.SUPER_ADMIN && p.statut === "en_attente_validation" && (
                          <BoutonValider paiementId={p.id} onValide={chargerTout} />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {paiementsFiltres.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                      Aucun paiement ne correspond à ces filtres.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {formulaireOuvert && (
        <FormulaireNouveauPaiement
          commandes={commandes.filter((c) => c.statut === "en_attente_paiement")}
          nomPays={nomPays}
          onAnnuler={() => setFormulaireOuvert(false)}
          onCree={() => {
            setFormulaireOuvert(false);
            chargerTout();
          }}
        />
      )}
    </div>
  );
}

function BoutonValider({ paiementId, onValide }: { paiementId: string; onValide: () => void }) {
  const { t } = useI18n();
  const [enCours, setEnCours] = useState(false);

  const valider = async () => {
    setEnCours(true);
    try {
      await apiClient.post(`/paiements/${paiementId}/valider`);
      onValide();
    } finally {
      setEnCours(false);
    }
  };

  return (
    <button
      onClick={valider}
      disabled={enCours}
      className="flex items-center gap-1.5 rounded-md border border-emerald-300 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
    >
      <Eye size={13} /> {enCours ? "…" : t("paiements.valider")}
    </button>
  );
}

function BadgeStatut({ statut }: { statut: StatutPaiement }) {
  const styles: Record<StatutPaiement, string> = {
    initie: "bg-gray-100 text-gray-600",
    en_attente_validation: "bg-amber-100 text-amber-700",
    valide: "bg-green-100 text-green-700",
    echoue: "bg-red-100 text-red-700",
    rembourse: "bg-gray-100 text-gray-600",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[statut]}`}>{LIBELLES_STATUT_PAIEMENT[statut]}</span>;
}

function FormulaireNouveauPaiement({
  commandes,
  nomPays,
  onAnnuler,
  onCree,
}: {
  commandes: Commande[];
  nomPays: (paysId: number) => string;
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const { t } = useI18n();
  const [commandeId, setCommandeId] = useState(commandes[0]?.id ?? "");
  const commandeChoisie = commandes.find((c) => c.id === commandeId) ?? null;
  const [moyen, setMoyen] = useState<MoyenPaiement>("virement");
  const [montant, setMontant] = useState(commandeChoisie?.montant_total ?? 0);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (commandeChoisie) setMontant(commandeChoisie.montant_total);
  }, [commandeChoisie]);

  const soumettre = async () => {
    if (!commandeId) {
      setErreur("Sélectionnez une commande.");
      return;
    }
    setErreur(null);
    setEnvoiEnCours(true);
    try {
      await apiClient.post("/paiements/presentiel", { commande_id: commandeId, moyen, montant });
      onCree();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErreur(detail ?? t("paiements.enregistrement_echoue"));
    } finally {
      setEnvoiEnCours(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">Enregistrer un paiement</h2>
          <button onClick={onAnnuler} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {commandes.length === 0 ? (
          <p className="text-sm text-gray-400">{t("paiements.aucune_commande")}</p>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">{t("nav.commandes")}</label>
              <select value={commandeId} onChange={(e) => setCommandeId(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                {commandes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nomPays(c.pays_id)} — {c.quantite.toLocaleString("fr-FR")} PPB — {c.montant_total.toLocaleString("fr-FR")} XAF
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Mode de paiement</label>
              <select value={moyen} onChange={(e) => setMoyen(e.target.value as MoyenPaiement)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                <option value="virement">{t("paiements.virement")}</option>
                <option value="especes">{t("paiements.especes")}</option>
                <option value="cheque">{t("paiements.cheque")}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">{t("commandes.montant")}</label>
              <input
                type="number"
                value={montant}
                onChange={(e) => setMontant(Number(e.target.value))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            {erreur && <p className="text-sm text-red-600">{erreur}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onAnnuler} className="rounded-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
                {t("action.annuler")}
              </button>
              <button
                onClick={soumettre}
                disabled={envoiEnCours}
                className="rounded-md bg-cebevirha px-4 py-2 text-sm font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
              >
                {envoiEnCours ? "…" : t("paiements.enregistrer")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { apiClient } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@/types/roles";
import { PAYS_CEMAC } from "@/types/pays";
import type { Commande } from "@/types/commande";
import type { MoyenPaiement, Paiement } from "@/types/paiement";
import { LIBELLES_MOYEN_PAIEMENT, LIBELLES_STATUT_PAIEMENT } from "@/types/paiement";

/**
 * Module 2 — Paiement. Uniquement le paiement présentiel/virement (CinetPay
 * retiré, voir backend/app/api/v1/endpoints/paiements.py). Flux : choisir
 * une commande en attente de paiement -> enregistrer un paiement -> un Super
 * Admin le valide, ce qui déclenche l'attribution automatique des passeports.
 */
export default function Paiements() {
  const { utilisateur } = useAuth();
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [commandeSelectionnee, setCommandeSelectionnee] = useState<Commande | null>(null);
  const [paiements, setPaiements] = useState<Paiement[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<Commande[]>("/commandes")
      .then(({ data }) => setCommandes(data.filter((c) => c.statut === "en_attente_paiement" || c.statut === "payee")))
      .catch(() => setErreur("Impossible de charger les commandes."))
      .finally(() => setChargement(false));
  }, []);

  const chargerPaiements = (commande: Commande) => {
    setCommandeSelectionnee(commande);
    apiClient
      .get<Paiement[]>("/paiements", { params: { commande_id: commande.id } })
      .then(({ data }) => setPaiements(data));
  };

  const nomPays = (paysId: number) => PAYS_CEMAC.find((p) => p.id === paysId)?.nom ?? `Pays #${paysId}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Paiements</h1>
        <p className="text-sm text-gray-500">Module 2 — enregistrement et validation des paiements présentiel/virement.</p>
      </div>

      {chargement && <p className="text-sm text-gray-500">Chargement…</p>}
      {erreur && <p className="text-sm text-red-600">{erreur}</p>}

      {!chargement && !erreur && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-800">Commandes</div>
            <ul className="divide-y divide-gray-100">
              {commandes.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => chargerPaiements(c)}
                    className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-gray-50 ${
                      commandeSelectionnee?.id === c.id ? "bg-cebevirha/5" : ""
                    }`}
                  >
                    <span>
                      {nomPays(c.pays_id)} — {c.quantite.toLocaleString("fr-FR")} PPB
                    </span>
                    <span className="text-xs text-gray-500">{c.montant_total.toLocaleString("fr-FR")} XAF</span>
                  </button>
                </li>
              ))}
              {commandes.length === 0 && <li className="px-4 py-8 text-center text-sm text-gray-400">Aucune commande à traiter.</li>}
            </ul>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            {!commandeSelectionnee ? (
              <p className="text-sm text-gray-400">Sélectionnez une commande à gauche.</p>
            ) : (
              <DetailPaiements
                commande={commandeSelectionnee}
                paiements={paiements}
                peutValider={utilisateur?.role === Role.SUPER_ADMIN}
                onChange={() => chargerPaiements(commandeSelectionnee)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailPaiements({
  commande,
  paiements,
  peutValider,
  onChange,
}: {
  commande: Commande;
  paiements: Paiement[];
  peutValider: boolean;
  onChange: () => void;
}) {
  const [moyen, setMoyen] = useState<MoyenPaiement>("virement");
  const [montant, setMontant] = useState(commande.montant_total);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const enregistrer = async () => {
    setErreur(null);
    setEnvoiEnCours(true);
    try {
      await apiClient.post("/paiements/presentiel", { commande_id: commande.id, moyen, montant });
      onChange();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErreur(detail ?? "L'enregistrement a échoué.");
    } finally {
      setEnvoiEnCours(false);
    }
  };

  const valider = async (paiementId: string) => {
    setErreur(null);
    try {
      await apiClient.post(`/paiements/${paiementId}/valider`);
      onChange();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErreur(detail ?? "La validation a échoué.");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-800">Montant dû : {commande.montant_total.toLocaleString("fr-FR")} XAF</p>
        <p className="text-xs text-gray-500">Statut de la commande : {commande.statut}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-600">Paiements enregistrés</p>
        {paiements.length === 0 && <p className="text-sm text-gray-400">Aucun paiement enregistré pour l'instant.</p>}
        {paiements.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2 text-sm">
            <span>
              {LIBELLES_MOYEN_PAIEMENT[p.moyen]} — {p.montant.toLocaleString("fr-FR")} {p.devise}
            </span>
            <span className="flex items-center gap-2">
              <StatutBadge statut={p.statut} />
              {peutValider && p.statut === "en_attente_validation" && (
                <button onClick={() => valider(p.id)} className="rounded-md bg-cebevirha px-2.5 py-1 text-xs font-medium text-white hover:bg-cebevirha-light">
                  Valider
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {commande.statut === "en_attente_paiement" && (
        <div className="space-y-3 border-t border-gray-100 pt-4">
          <p className="text-xs font-medium text-gray-600">Enregistrer un nouveau paiement</p>
          <div className="flex gap-2">
            <select value={moyen} onChange={(e) => setMoyen(e.target.value as MoyenPaiement)} className="rounded-md border border-gray-300 px-2 py-2 text-sm">
              <option value="virement">Virement</option>
              <option value="especes">Espèces</option>
              <option value="cheque">Chèque</option>
            </select>
            <input
              type="number"
              value={montant}
              onChange={(e) => setMontant(Number(e.target.value))}
              className="w-32 rounded-md border border-gray-300 px-2 py-2 text-sm"
            />
            <button
              onClick={enregistrer}
              disabled={envoiEnCours}
              className="rounded-md bg-cebevirha px-3 py-2 text-sm font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
            >
              {envoiEnCours ? "…" : "Enregistrer"}
            </button>
          </div>
          {erreur && <p className="text-sm text-red-600">{erreur}</p>}
        </div>
      )}
    </div>
  );
}

function StatutBadge({ statut }: { statut: Paiement["statut"] }) {
  const styles: Record<Paiement["statut"], string> = {
    initie: "bg-gray-100 text-gray-600",
    en_attente_validation: "bg-amber-100 text-amber-700",
    valide: "bg-green-100 text-green-700",
    echoue: "bg-red-100 text-red-700",
    rembourse: "bg-gray-100 text-gray-600",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[statut]}`}>{LIBELLES_STATUT_PAIEMENT[statut]}</span>;
}

import { useEffect, useMemo, useState } from "react";
import { CreditCard, CheckCircle2, Clock, XCircle, Wallet, ChevronDown, Eye } from "lucide-react";
import { apiClient } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@/types/roles";
import type { Commande, StatutCommande } from "@/types/commande";
import { LIBELLES_STATUT_COMMANDE } from "@/types/commande";
import type { MoyenPaiement, Paiement, StatutPaiement } from "@/types/paiement";
import { LIBELLES_MOYEN_PAIEMENT, LIBELLES_STATUT_PAIEMENT } from "@/types/paiement";
import { useI18n } from "@/lib/i18n";
import { DrapeauPays } from "@/components/DrapeauPays";
import CarteStatIconee from "@/components/CarteStatIconee";

interface PaysApi {
  id: number;
  code_iso: string;
  nom: string;
}

/**
 * Module 2 — Paiement. Uniquement le paiement présentiel/virement (CinetPay
 * retiré, voir backend/app/api/v1/endpoints/paiements.py). Vue centrée sur
 * les COMMANDES (pas un tableau de transactions) : chaque commande est une
 * ligne cliquable, celles en attente de paiement ressortent en jaune —
 * cliquer déplie l'enregistrement ou la validation du paiement inline,
 * jamais une fenêtre modale séparée à ouvrir via un bouton du haut.
 */
export default function Paiements() {
  const { utilisateur } = useAuth();
  const { t } = useI18n();
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [pays, setPays] = useState<PaysApi[]>([]);
  const [paiements, setPaiements] = useState<Paiement[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [commandeDepliee, setCommandeDepliee] = useState<string | null>(null);

  // Filtres — appliqués côté client, la liste complète (déjà filtrée par
  // pays côté serveur selon le rôle) est chargée une fois.
  const [filtrePays, setFiltrePays] = useState<number | "tous">("tous");
  const [filtreStatutCommande, setFiltreStatutCommande] = useState<StatutCommande | "tous">("tous");

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

  const nomPays = (paysId: number) => pays.find((p) => p.id === paysId)?.nom ?? `${t("commun.pays")} #${paysId}`;
  const paiementParCommande = useMemo(() => {
    // Au plus un paiement "actif" (en attente ou validé) par commande — voir
    // le garde-fou anti-doublon côté backend (paiements.py::enregistrer_
    // paiement_presentiel) : jamais deux paiements actifs simultanés pour
    // une même commande, cette carte peut donc s'appuyer sans ambiguïté sur
    // le plus récent.
    const carte = new Map<string, Paiement>();
    for (const p of [...paiements].sort((a, b) => (a.cree_le < b.cree_le ? -1 : 1))) {
      carte.set(p.commande_id, p);
    }
    return carte;
  }, [paiements]);

  const commandesFiltrees = useMemo(() => {
    return commandes
      .filter((c) => {
        if (filtrePays !== "tous" && c.pays_id !== filtrePays) return false;
        if (filtreStatutCommande !== "tous" && c.statut !== filtreStatutCommande) return false;
        return true;
      })
      // En attente de paiement d'abord — c'est le travail à faire, il doit
      // remonter naturellement plutôt que de se perdre dans la liste.
      .sort((a, b) => {
        if (a.statut === "en_attente_paiement" && b.statut !== "en_attente_paiement") return -1;
        if (b.statut === "en_attente_paiement" && a.statut !== "en_attente_paiement") return 1;
        return a.cree_le < b.cree_le ? 1 : -1;
      });
  }, [commandes, filtrePays, filtreStatutCommande]);

  const totaux = useMemo(() => {
    const valides = paiements.filter((p) => p.statut === "valide");
    return {
      montantTotal: valides.reduce((s, p) => s + p.montant, 0),
      nbValides: valides.length,
      nbEnAttente: paiements.filter((p) => p.statut === "en_attente_validation").length,
      nbEchoues: paiements.filter((p) => p.statut === "echoue").length,
    };
  }, [paiements]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-lg border border-or/40 bg-amber-50 px-4 py-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cebevirha/10">
          <CreditCard size={20} className="text-cebevirha" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-bleuCemac">{t("nav.paiements")}</h1>
          <p className="text-sm text-gray-500">{t("paiements.description")}</p>
        </div>
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

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-or/40 bg-white p-3">
            <select
              value={filtrePays}
              onChange={(e) => setFiltrePays(e.target.value === "tous" ? "tous" : Number(e.target.value))}
              className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            >
              <option value="tous">Tous pays</option>
              {pays.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom}
                </option>
              ))}
            </select>
            <select
              value={filtreStatutCommande}
              onChange={(e) => setFiltreStatutCommande(e.target.value as StatutCommande | "tous")}
              className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
            >
              <option value="tous">Tous statuts</option>
              {(Object.keys(LIBELLES_STATUT_COMMANDE) as StatutCommande[]).map((s) => (
                <option key={s} value={s}>
                  {LIBELLES_STATUT_COMMANDE[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-or/40 bg-white">
            {commandesFiltrees.map((commande) => {
              const enAttente = commande.statut === "en_attente_paiement";
              const paiement = paiementParCommande.get(commande.id);
              const depliee = commandeDepliee === commande.id;
              return (
                <div key={commande.id}>
                  <button
                    onClick={() => setCommandeDepliee(depliee ? null : commande.id)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition-colors ${
                      enAttente ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <DrapeauPays codeIso={pays.find((p) => p.id === commande.pays_id)?.code_iso} />
                      <div>
                        <p className="text-sm font-medium text-gray-800">
                          {nomPays(commande.pays_id)} — {commande.quantite.toLocaleString("fr-FR")} PPB
                        </p>
                        <p className="text-xs text-gray-500">
                          {commande.montant_total.toLocaleString("fr-FR")} XAF · {new Date(commande.cree_le).toLocaleDateString("fr-FR")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          enAttente ? "bg-amber-400 text-amber-950" : STYLES_STATUT_COMMANDE[commande.statut]
                        }`}
                      >
                        {LIBELLES_STATUT_COMMANDE[commande.statut]}
                      </span>
                      <ChevronDown size={16} className={`text-gray-400 transition-transform ${depliee ? "rotate-180" : ""}`} />
                    </div>
                  </button>

                  {depliee && (
                    <div className="border-t border-gray-100 bg-gray-50 px-4 py-4">
                      <PanneauPaiementCommande
                        commande={commande}
                        paiement={paiement}
                        peutValider={utilisateur?.role === Role.SUPER_ADMIN || utilisateur?.role === Role.COMPTABILITE}
                        peutEnregistrer={utilisateur?.role !== Role.COMPTABILITE}
                        onChange={chargerTout}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {commandesFiltrees.length === 0 && (
              <p className="px-4 py-8 text-center text-gray-400">Aucune commande ne correspond à ces filtres.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const STYLES_STATUT_COMMANDE: Record<StatutCommande, string> = {
  brouillon: "bg-gray-100 text-gray-600",
  en_attente_paiement: "bg-amber-100 text-amber-700",
  payee: "bg-green-100 text-green-700",
  expiree: "bg-gray-100 text-gray-500",
  annulee: "bg-red-100 text-red-700",
};

/** Contenu déplié sous une commande — remplace l'ancienne fenêtre modale
 * "Enregistrer un paiement" : mêmes actions (enregistrer, valider), mais
 * rattachées visuellement à LA commande concernée plutôt qu'à choisir dans
 * une liste déroulante générique. */
function PanneauPaiementCommande({
  commande,
  paiement,
  peutValider,
  peutEnregistrer,
  onChange,
}: {
  commande: Commande;
  paiement: Paiement | undefined;
  peutValider: boolean;
  peutEnregistrer: boolean;
  onChange: () => void;
}) {
  const { t } = useI18n();

  if (paiement) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 bg-white p-3">
        <div>
          <p className="text-sm text-gray-700">
            {LIBELLES_MOYEN_PAIEMENT[paiement.moyen]} — {paiement.montant.toLocaleString("fr-FR")} {paiement.devise}
          </p>
          <p className="text-xs text-gray-400">
            Enregistré le {new Date(paiement.cree_le).toLocaleString("fr-FR")} · Réf. {paiement.id.slice(0, 8).toUpperCase()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BadgeStatut statut={paiement.statut} />
          {peutValider && paiement.statut === "en_attente_validation" && <BoutonValider paiementId={paiement.id} onValide={onChange} />}
        </div>
      </div>
    );
  }

  if (commande.statut !== "en_attente_paiement") {
    return <p className="text-sm text-gray-400">Aucun paiement à enregistrer pour cette commande.</p>;
  }

  if (!peutEnregistrer) {
    return <p className="text-sm text-gray-400">Cette commande attend son paiement — vous n'êtes pas autorisé(e) à l'enregistrer.</p>;
  }

  return <FormulaireEnregistrerPaiement commande={commande} onCree={onChange} />;
}

function FormulaireEnregistrerPaiement({ commande, onCree }: { commande: Commande; onCree: () => void }) {
  const { t } = useI18n();
  const [moyen, setMoyen] = useState<MoyenPaiement>("virement");
  const [montant, setMontant] = useState(commande.montant_total);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const soumettre = async () => {
    setErreur(null);
    setEnvoiEnCours(true);
    try {
      await apiClient.post("/paiements/presentiel", { commande_id: commande.id, moyen, montant });
      onCree();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErreur(detail ?? t("paiements.enregistrement_echoue"));
    } finally {
      setEnvoiEnCours(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Mode de paiement</label>
        <select value={moyen} onChange={(e) => setMoyen(e.target.value as MoyenPaiement)} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
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
          className="w-32 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <button
        onClick={soumettre}
        disabled={envoiEnCours}
        className="rounded-md bg-cebevirha px-4 py-2 text-sm font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
      >
        {envoiEnCours ? "…" : t("paiements.enregistrer")}
      </button>
      {erreur && <p className="w-full text-sm text-red-600">{erreur}</p>}
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


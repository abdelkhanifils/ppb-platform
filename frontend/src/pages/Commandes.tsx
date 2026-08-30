import { useEffect, useState } from "react";
import { ClipboardList, Package, Wallet, CheckCircle2, Plus, X, FileText } from "lucide-react";
import { apiClient } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@/types/roles";
import type { Commande, CommandeCreate, LangueVersion, ModeImpression } from "@/types/commande";
import { LIBELLES_STATUT_COMMANDE } from "@/types/commande";
import { useI18n } from "@/lib/i18n";
import CarteStatIconee from "@/components/CarteStatIconee";

interface PaysApi {
  id: number;
  code_iso: string;
  nom: string;
}

/** Module 1 — Commande. Liste + création. Le périmètre pays est déjà
 * appliqué côté serveur (GET /commandes ne renvoie que le pays de
 * l'utilisateur, sauf Super Admin) — cet écran ne fait qu'afficher ce que
 * l'API renvoie, sans filtrage redondant côté client. */
export default function Commandes() {
  const { utilisateur } = useAuth();
  const { t } = useI18n();
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [pays, setPays] = useState<PaysApi[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  const chargerCommandes = () => {
    setChargement(true);
    apiClient
      .get<Commande[]>("/commandes")
      .then(({ data }) => setCommandes(data))
      .catch(() => setErreur(t("commandes.erreur_chargement")))
      .finally(() => setChargement(false));
  };

  useEffect(() => {
    apiClient.get<PaysApi[]>("/pays").then(({ data }) => setPays(data));
    chargerCommandes();
  }, []);

  const nomPays = (paysId: number) => pays.find((p) => p.id === paysId)?.nom ?? `${t("commun.pays")} #${paysId}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cebevirha/10">
            <ClipboardList size={20} className="text-cebevirha" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-bleuCemac">{t("nav.commandes")}</h1>
            <p className="text-sm text-gray-500">{t("commandes.description")}</p>
          </div>
        </div>
        <button
          onClick={() => setFormulaireOuvert(true)}
          className="flex items-center gap-1.5 rounded-md bg-cebevirha px-4 py-2 text-sm font-medium text-white hover:bg-cebevirha-light"
        >
          <Plus size={16} /> {t("commandes.nouvelle")}
        </button>
      </div>

      {formulaireOuvert && (
        <FormulaireNouvelleCommande
          pays={pays}
          paysImpose={utilisateur?.role === Role.ADMIN_NATIONAL ? utilisateur.pays_id : null}
          onAnnuler={() => setFormulaireOuvert(false)}
          onCree={() => {
            setFormulaireOuvert(false);
            chargerCommandes();
          }}
        />
      )}

      {chargement && <p className="text-sm text-gray-500">{t("commun.chargement")}</p>}
      {erreur && <p className="text-sm text-red-600">{erreur}</p>}

      {!chargement && !erreur && (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-cebevirha/5 text-sm font-medium text-bleuCemac">
                <tr>
                  <th className="px-4 py-2.5">{t("commun.pays")}</th>
                  <th className="px-4 py-2.5">{t("commandes.quantite")}</th>
                  <th className="px-4 py-2.5">{t("commandes.langue")}</th>
                  <th className="px-4 py-2.5">{t("nav.impression")}</th>
                  <th className="px-4 py-2.5">{t("commandes.montant")}</th>
                  <th className="px-4 py-2.5">{t("commandes.statut")}</th>
                  <th className="px-4 py-2.5">{t("commandes.responsable")}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {commandes.map((c) => (
                  <tr key={c.id} className="border-t border-gray-100">
                    <td className="px-4 py-2.5">{nomPays(c.pays_id)}</td>
                    <td className="px-4 py-2.5">{c.quantite.toLocaleString("fr-FR")}</td>
                    <td className="px-4 py-2.5">{c.langue_version}</td>
                    <td className="px-4 py-2.5 capitalize">{c.mode_impression}</td>
                    <td className="px-4 py-2.5">{c.montant_total.toLocaleString("fr-FR")}</td>
                    <td className="px-4 py-2.5">
                      <BadgeStatut statut={c.statut} />
                    </td>
                    <td className="px-4 py-2.5">{c.responsable_nom}</td>
                    <td className="px-4 py-2.5">
                      <BoutonFacture commandeId={c.id} />
                    </td>
                  </tr>
                ))}
                {commandes.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                      {t("commandes.aucune")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <ResumeCommandes commandes={commandes} />
        </>
      )}
    </div>
  );
}

/** Cartes calculées côté client depuis la liste déjà chargée — pas d'appel
 * réseau supplémentaire, ces totaux se déduisent directement de `commandes`. */
function ResumeCommandes({ commandes }: { commandes: Commande[] }) {
  const { t } = useI18n();
  const quantiteTotale = commandes.reduce((s, c) => s + c.quantite, 0);
  const montantTotal = commandes.reduce((s, c) => s + c.montant_total, 0);
  const nbPayees = commandes.filter((c) => c.statut === "payee").length;
  const pourcentagePayees = commandes.length > 0 ? Math.round((nbPayees / commandes.length) * 100) : 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <CarteStatIconee icone={ClipboardList} couleur="vert" libelle="Total commandes" valeur={commandes.length} tendance="Toutes commandes confondues" />
      <CarteStatIconee icone={Package} couleur="or" libelle="Quantité totale" valeur={quantiteTotale.toLocaleString("fr-FR")} tendance="Nombre total de passeports" />
      <CarteStatIconee icone={Wallet} couleur="bleu" libelle={t("commandes.montant") + " (XAF)"} valeur={montantTotal.toLocaleString("fr-FR")} tendance="Valeur totale des commandes" />
      <CarteStatIconee icone={CheckCircle2} couleur="violet" libelle="Commandes payées" valeur={nbPayees} tendance={`${pourcentagePayees}% des commandes sont réglées`} />
    </div>
  );
}

function BoutonFacture({ commandeId }: { commandeId: string }) {
  const { t } = useI18n();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(false);

  const telecharger = async () => {
    setEnCours(true);
    setErreur(false);
    try {
      // Téléchargement authentifié : un simple lien <a href> n'enverrait pas le
      // jeton — on récupère le PDF via l'API (en-tête Authorization inclus par
      // apiClient), puis on l'ouvre depuis un Blob local.
      const { data } = await apiClient.get(`/commandes/${commandeId}/facture`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      window.open(url, "_blank");
    } catch {
      setErreur(true);
    } finally {
      setEnCours(false);
    }
  };

  return (
    <span className="flex items-center gap-2">
      <button
        onClick={telecharger}
        disabled={enCours}
        className="flex items-center gap-1.5 rounded-md border border-cebevirha/30 px-2.5 py-1.5 text-xs font-medium text-cebevirha hover:bg-cebevirha/5 disabled:opacity-50"
      >
        <FileText size={13} />
        {enCours ? "…" : t("commandes.facture_pdf")}
      </button>
      {erreur && <span className="text-xs text-red-600">{t("commandes.echec")}</span>}
    </span>
  );
}

function BadgeStatut({ statut }: { statut: Commande["statut"] }) {
  const styles: Record<Commande["statut"], string> = {
    brouillon: "bg-gray-100 text-gray-600",
    en_attente_paiement: "bg-amber-100 text-amber-700",
    payee: "bg-green-100 text-green-700",
    expiree: "bg-red-100 text-red-700",
    annulee: "bg-red-100 text-red-700",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[statut]}`}>{LIBELLES_STATUT_COMMANDE[statut]}</span>;
}

function FormulaireNouvelleCommande({
  pays,
  paysImpose,
  onAnnuler,
  onCree,
}: {
  pays: PaysApi[];
  paysImpose: number | null;
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const { t } = useI18n();
  const [paysId, setPaysId] = useState<number | null>(paysImpose);
  const [quantite, setQuantite] = useState(200);
  const [langueVersion, setLangueVersion] = useState<LangueVersion>("FR/EN");
  const [modeImpression, setModeImpression] = useState<ModeImpression>("centralisee");
  const [responsableNom, setResponsableNom] = useState("");
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (paysId === null && pays.length > 0) setPaysId(paysImpose ?? pays[0].id);
  }, [pays, paysId, paysImpose]);

  const soumettre = async () => {
    setErreur(null);
    if (!responsableNom.trim()) {
      setErreur(t("commandes.responsable_oblig"));
      return;
    }
    if (paysId === null) {
      setErreur(t("commandes.pays_oblig"));
      return;
    }
    setEnvoiEnCours(true);
    try {
      const payload: CommandeCreate = {
        pays_id: paysId,
        quantite,
        langue_version: langueVersion,
        mode_impression: modeImpression,
        responsable_nom: responsableNom.trim(),
      };
      await apiClient.post("/commandes", payload);
      onCree();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErreur(detail ?? t("commandes.creation_echouee"));
    } finally {
      setEnvoiEnCours(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">{t("commandes.nouvelle")}</h2>
        <button onClick={onAnnuler} className="text-gray-400 hover:text-gray-600">
          <X size={18} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{t("commun.pays")}</label>
          <select
            value={paysId ?? ""}
            disabled={paysImpose !== null}
            onChange={(e) => setPaysId(Number(e.target.value))}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
          >
            {pays.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{t("commandes.quantite")}</label>
          <input
            type="number"
            min={1}
            value={quantite}
            onChange={(e) => setQuantite(Number(e.target.value))}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{t("commandes.version_linguistique")}</label>
          <select
            value={langueVersion}
            onChange={(e) => setLangueVersion(e.target.value as LangueVersion)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="FR/EN">FR/EN</option>
            <option value="FR/AR">FR/AR</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{t("commandes.mode_impression")}</label>
          <select
            value={modeImpression}
            onChange={(e) => setModeImpression(e.target.value as ModeImpression)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="centralisee">{t("commandes.centralisee")}</option>
            <option value="decentralisee">{t("commandes.decentralisee")}</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600">{t("commandes.responsable")}</label>
          <input
            value={responsableNom}
            onChange={(e) => setResponsableNom(e.target.value)}
            placeholder={t("commandes.placeholder_responsable")}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {erreur && <p className="mt-3 text-sm text-red-600">{erreur}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onAnnuler} className="rounded-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">
          {t("action.annuler")}
        </button>
        <button
          onClick={soumettre}
          disabled={envoiEnCours}
          className="rounded-md bg-cebevirha px-4 py-2 text-sm font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
        >
          {envoiEnCours ? t("commandes.creation_en_cours") : t("commandes.creer")}
        </button>
      </div>
    </div>
  );
}

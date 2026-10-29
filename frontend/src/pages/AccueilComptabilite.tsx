import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, CheckCircle2, AlertCircle, Wallet, Download, FileText, FileSpreadsheet, Archive, Calculator, Printer } from "lucide-react";
import { apiClient } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@/types/roles";
import CarteStatIconee from "@/components/CarteStatIconee";
import type { LignePeriode, PaiementsPeriode, SyntheseComptable } from "@/types/comptabilite";
import { LIBELLES_MOYEN_PAIEMENT, LIBELLES_STATUT_PAIEMENT } from "@/types/paiement";
import type { StatutPaiement } from "@/types/paiement";

/** Écran d'accueil du profil Comptabilité : file des paiements à valider,
 * montants des commandes payées / non payées, et consultation ou
 * téléchargement des paiements et factures sur une période donnée. Les
 * chiffres viennent de /comptabilite/* (voir backend), jamais recalculés
 * ici à partir de listes partielles. */

type Preset = "tout" | "mois" | "mois_precedent" | "trimestre" | "annee" | "perso";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function bornesPreset(p: Preset): { debut: string; fin: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (p === "mois") return { debut: iso(new Date(y, m, 1)), fin: iso(new Date(y, m + 1, 0)) };
  if (p === "mois_precedent") return { debut: iso(new Date(y, m - 1, 1)), fin: iso(new Date(y, m, 0)) };
  if (p === "trimestre") {
    const q = Math.floor(m / 3) * 3;
    return { debut: iso(new Date(y, q, 1)), fin: iso(new Date(y, q + 3, 0)) };
  }
  if (p === "annee") return { debut: iso(new Date(y, 0, 1)), fin: iso(new Date(y, 11, 31)) };
  return { debut: "", fin: "" };
}

const PRESETS: { cle: Preset; libelle: string }[] = [
  { cle: "tout", libelle: "Tout" },
  { cle: "mois", libelle: "Ce mois" },
  { cle: "mois_precedent", libelle: "Mois dernier" },
  { cle: "trimestre", libelle: "Ce trimestre" },
  { cle: "annee", libelle: "Cette année" },
];

const fmt = (n: number) => n.toLocaleString("fr-FR");

const STYLE_STATUT: Record<StatutPaiement, string> = {
  initie: "bg-gray-100 text-gray-600",
  en_attente_validation: "bg-amber-100 text-amber-700",
  valide: "bg-emerald-100 text-emerald-700",
  echoue: "bg-red-100 text-red-700",
  rembourse: "bg-violet-100 text-violet-700",
};

async function telecharger(url: string, params: Record<string, string>, nomParDefaut: string, ouvrir = false) {
  const reponse = await apiClient.get(url, { params, responseType: "blob" });
  const disposition = String(reponse.headers["content-disposition"] ?? "");
  const nom = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? nomParDefaut;
  const blobUrl = URL.createObjectURL(reponse.data as Blob);
  if (ouvrir) {
    window.open(blobUrl, "_blank");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return;
  }
  const lien = document.createElement("a");
  lien.href = blobUrl;
  lien.download = nom;
  lien.click();
  URL.revokeObjectURL(blobUrl);
}

/** Les erreurs d'un appel `responseType: "blob"` arrivent elles-mêmes sous
 * forme de Blob : on en extrait le message `detail` renvoyé par l'API. */
async function messageErreur(err: unknown, defaut: string): Promise<string> {
  const data = (err as { response?: { data?: Blob } })?.response?.data;
  if (data instanceof Blob) {
    try {
      const j = JSON.parse(await data.text());
      if (typeof j.detail === "string") return j.detail;
    } catch {
      /* corps non JSON */
    }
  }
  return defaut;
}

export default function AccueilComptabilite({ lectureSeule = false, integre = false }: { lectureSeule?: boolean; integre?: boolean }) {
  // Admin National : le serveur ne renvoie QUE son pays — on n'affiche donc que la situation de ce pays.
  const { utilisateur } = useAuth();
  const estAdminNational = utilisateur?.role === Role.ADMIN_NATIONAL;
  const [preset, setPreset] = useState<Preset>("tout");
  const [debut, setDebut] = useState("");
  const [fin, setFin] = useState("");
  const [statut, setStatut] = useState<StatutPaiement | "tous">("tous");
  const [synthese, setSynthese] = useState<SyntheseComptable | null>(null);
  const [periode, setPeriode] = useState<PaiementsPeriode | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [nbAffiches, setNbAffiches] = useState(25);

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (debut) p.debut = debut;
    if (fin) p.fin = fin;
    return p;
  }, [debut, fin]);
  const periodeInvalide = !!debut && !!fin && debut > fin;

  const choisirPreset = (p: Preset) => {
    setPreset(p);
    const b = bornesPreset(p);
    setDebut(b.debut);
    setFin(b.fin);
  };

  const charger = useCallback(() => {
    if (periodeInvalide) return;
    setChargement(true);
    setErreur(null);
    const paramsListe = statut === "tous" ? params : { ...params, statut };
    Promise.all([
      apiClient.get<SyntheseComptable>("/comptabilite/synthese", { params }).then(({ data }) => setSynthese(data)),
      apiClient.get<PaiementsPeriode>("/comptabilite/periode", { params: paramsListe }).then(({ data }) => setPeriode(data)),
    ])
      .catch(() => setErreur("Impossible de charger les données comptables."))
      .finally(() => setChargement(false));
    setNbAffiches(25);
  }, [params, statut, periodeInvalide]);

  useEffect(charger, [charger]);

  const exporter = async (cle: string, url: string, extra: Record<string, string>, nom: string) => {
    setMessage(null);
    setEnvoi(cle);
    try {
      await telecharger(url, { ...params, ...(statut === "tous" ? {} : { statut }), ...extra }, nom);
    } catch (err) {
      setMessage(await messageErreur(err, "Téléchargement impossible."));
    } finally {
      setEnvoi(null);
    }
  };

  const ouvrirFacture = async (l: LignePeriode) => {
    setMessage(null);
    setEnvoi(l.paiement_id);
    try {
      await telecharger(`/commandes/${l.commande_id}/facture`, {}, `facture-${l.reference}.pdf`, true);
    } catch (err) {
      setMessage(await messageErreur(err, "Facture indisponible."));
    } finally {
      setEnvoi(null);
    }
  };

  const total = synthese?.montant_total_commandes ?? 0;
  const partPayee = total > 0 ? Math.round(((synthese?.commandes_payees.montant ?? 0) / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <style>{"@media print { aside, header, nav, .hors-impression { display: none !important; } }"}</style>
      {!integre && <div className="flex items-center gap-3 rounded-lg border border-or/40 bg-amber-50 px-4 py-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cebevirha/10">
          <Calculator size={18} className="text-cebevirha" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-bleuCemac">{lectureSeule ? "États de paiements" : "Tableau de bord — Comptabilité"}</h1>
          <p className="text-sm text-gray-500">{lectureSeule ? "Consultation et impression des paiements, commandes et factures par période (lecture seule)." : "Paiements à valider, situation des commandes, paiements et factures par période."}</p>
        </div>
      </div>}

      {/* Période — s'applique à tous les chiffres et à la liste ci-dessous */}
      <p className="hidden text-sm text-gray-700 print:block">Période : {debut || fin ? `du ${debut ? new Date(debut).toLocaleDateString("fr-FR") : "…"} au ${fin ? new Date(fin).toLocaleDateString("fr-FR") : "…"}` : "toute la période"}</p>
      <div className="hors-impression flex flex-wrap items-end gap-3 rounded-lg border border-or/40 bg-white p-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.cle}
              onClick={() => choisirPreset(p.cle)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${preset === p.cle ? "bg-cebevirha text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {p.libelle}
            </button>
          ))}
        </div>
        <label className="text-xs text-gray-500">
          Du
          <input type="date" value={debut} onChange={(e) => { setPreset("perso"); setDebut(e.target.value); }} className="ml-1 rounded-md border border-gray-300 px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-gray-500">
          au
          <input type="date" value={fin} onChange={(e) => { setPreset("perso"); setFin(e.target.value); }} className="ml-1 rounded-md border border-gray-300 px-2 py-1 text-sm" />
        </label>
        {periodeInvalide && <p className="text-xs text-red-600">La date de début doit précéder la date de fin.</p>}
      </div>

      {erreur && <p className="text-sm text-red-600">{erreur}</p>}
      {chargement && !synthese && <p className="text-sm text-gray-500">Chargement…</p>}

      {synthese && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <CarteStatIconee icone={Clock} couleur="or" libelle="Paiements en attente" valeur={`${synthese.en_attente.nombre} · ${fmt(synthese.en_attente.montant)} XAF`} />
            <CarteStatIconee icone={CheckCircle2} couleur="vert" libelle="Commandes payées (XAF)" valeur={fmt(synthese.commandes_payees.montant)} tendance={`${synthese.commandes_payees.nombre} commande(s)`} />
            <CarteStatIconee icone={AlertCircle} couleur="rouge" libelle="Commandes non payées (XAF)" valeur={fmt(synthese.commandes_non_payees.montant)} tendance={`${synthese.commandes_non_payees.nombre} commande(s)`} />
            <CarteStatIconee icone={Wallet} couleur="bleu" libelle="Encaissé — paiements validés (XAF)" valeur={fmt(synthese.encaisse.montant)} tendance={`${synthese.encaisse.nombre} paiement(s)`} />
          </div>

          <div className="rounded-lg border border-or/40 bg-white p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="font-semibold text-gray-800">Montant total des commandes : {fmt(total)} XAF</p>
              <p className="text-xs text-gray-500">{partPayee} % payé · {100 - partPayee} % restant à payer</p>
            </div>
            <div className="flex h-3 overflow-hidden rounded-full bg-red-100" role="img" aria-label={`${partPayee} % des commandes payées`}>
              <div className="bg-emerald-500" style={{ width: `${partPayee}%` }} />
            </div>
          </div>

          {/* File de travail : paiements à valider */}
          <div className="rounded-lg border border-or/40 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <p className="text-sm font-semibold text-gray-800">Paiements en attente de validation <span className="font-normal text-gray-400">(toutes périodes)</span></p>
              {!lectureSeule && <Link to="/paiements" className="text-xs font-medium text-cebevirha hover:underline">Ouvrir les paiements →</Link>}
            </div>
            {synthese.en_attente.paiements.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400">Aucun paiement en attente. 🎉</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {synthese.en_attente.paiements.map((p) => (
                  <div key={p.id} className="grid grid-cols-1 gap-1 bg-amber-50/50 px-4 py-2.5 text-sm sm:grid-cols-[2fr_2fr_1fr] sm:gap-4">
                    <span className="font-medium text-gray-800">{p.pays} <span className="font-normal text-gray-400">· #{p.reference}</span></span>
                    <span className="text-gray-600">{LIBELLES_MOYEN_PAIEMENT[p.moyen]} · {new Date(p.cree_le).toLocaleDateString("fr-FR")}</span>
                    <span className="font-semibold text-gray-800 sm:text-right">{fmt(p.montant)} {p.devise}</span>
                  </div>
                ))}
                {synthese.en_attente.nombre > synthese.en_attente.paiements.length && (
                  <p className="px-4 py-2 text-xs text-gray-500">… et {synthese.en_attente.nombre - synthese.en_attente.paiements.length} autre(s). Cette liste n'est pas limitée par la période choisie.</p>
                )}
              </div>
            )}
          </div>

          {/* Situation par pays */}
          {synthese.par_pays.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-or/40 bg-white">
              <p className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-800">{estAdminNational ? `Situation — ${synthese.par_pays[0]?.pays ?? "mon pays"}` : "Situation par pays"}</p>
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr><th className="px-4 py-2">Pays</th><th className="px-4 py-2 text-right">Payé (XAF)</th><th className="px-4 py-2 text-right">Non payé (XAF)</th><th className="px-4 py-2 text-right">Taux payé</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(estAdminNational ? synthese.par_pays.slice(0, 1) : synthese.par_pays).map((l) => {
                    const t = l.montant_payees + l.montant_non_payees;
                    return (
                      <tr key={l.pays}>
                        <td className="px-4 py-2 font-medium text-gray-800">{l.pays}</td>
                        <td className="px-4 py-2 text-right">{fmt(l.montant_payees)} <span className="text-xs text-gray-400">({l.nb_payees})</span></td>
                        <td className="px-4 py-2 text-right">{fmt(l.montant_non_payees)} <span className="text-xs text-gray-400">({l.nb_non_payees})</span></td>
                        <td className="px-4 py-2 text-right">{t > 0 ? Math.round((l.montant_payees / t) * 100) : 0} %</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Paiements et factures par période */}
      <div className="rounded-lg border border-or/40 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-gray-800">Paiements et factures de la période</p>
            <p className="text-xs text-gray-500">
              {periode ? `${periode.total} paiement(s) · validés : ${fmt(periode.montant_valide)} XAF · en attente : ${fmt(periode.montant_en_attente)} XAF` : "…"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={statut} onChange={(e) => setStatut(e.target.value as StatutPaiement | "tous")} className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm">
              <option value="tous">Tous statuts</option>
              {(Object.keys(LIBELLES_STATUT_PAIEMENT) as StatutPaiement[]).map((s) => (
                <option key={s} value={s}>{LIBELLES_STATUT_PAIEMENT[s]}</option>
              ))}
            </select>
            <button onClick={() => window.print()} className="hors-impression inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              <Printer size={14} /> Imprimer
            </button>
            <button disabled={!!envoi || periodeInvalide} onClick={() => exporter("xlsx", "/comptabilite/export", { format: "xlsx" }, "paiements-ppb.xlsx")} className="inline-flex items-center gap-1.5 rounded-md bg-cebevirha px-3 py-1.5 text-xs font-medium text-white hover:bg-cebevirha-light disabled:opacity-50">
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button disabled={!!envoi || periodeInvalide} onClick={() => exporter("csv", "/comptabilite/export", { format: "csv" }, "paiements-ppb.csv")} className="inline-flex items-center gap-1.5 rounded-md border border-cebevirha px-3 py-1.5 text-xs font-medium text-cebevirha hover:bg-cebevirha/5 disabled:opacity-50">
              <Download size={14} /> CSV
            </button>
            <button disabled={!!envoi || periodeInvalide || !periode?.total} onClick={() => exporter("zip", "/comptabilite/factures-zip", {}, "factures-ppb.zip")} className="inline-flex items-center gap-1.5 rounded-md border border-cebevirha px-3 py-1.5 text-xs font-medium text-cebevirha hover:bg-cebevirha/5 disabled:opacity-50">
              <Archive size={14} /> Factures (ZIP)
            </button>
          </div>
        </div>
        {message && <p className="border-b border-gray-100 bg-red-50 px-4 py-2 text-sm text-red-700">{message}</p>}
        {envoi && ["xlsx", "csv", "zip"].includes(envoi) && <p className="px-4 py-2 text-xs text-gray-500">Préparation du fichier…</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Commande</th><th className="px-4 py-2">Pays</th><th className="px-4 py-2 text-right">Montant (XAF)</th><th className="px-4 py-2">Moyen</th><th className="px-4 py-2">Statut</th><th className="px-4 py-2">Facture</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(periode?.lignes ?? []).slice(0, nbAffiches).map((l) => (
                <tr key={l.paiement_id}>
                  <td className="whitespace-nowrap px-4 py-2">{new Date(l.cree_le).toLocaleDateString("fr-FR")}</td>
                  <td className="px-4 py-2 text-gray-500">#{l.reference} · {fmt(l.quantite)} PPB</td>
                  <td className="px-4 py-2">{l.pays}</td>
                  <td className="px-4 py-2 text-right font-medium">{fmt(l.montant)}</td>
                  <td className="px-4 py-2">{LIBELLES_MOYEN_PAIEMENT[l.moyen]}</td>
                  <td className="px-4 py-2"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE_STATUT[l.statut_paiement]}`}>{LIBELLES_STATUT_PAIEMENT[l.statut_paiement]}</span></td>
                  <td className="px-4 py-2">
                    <button disabled={envoi === l.paiement_id} onClick={() => ouvrirFacture(l)} className="inline-flex items-center gap-1 text-xs font-medium text-cebevirha hover:underline disabled:opacity-50">
                      <FileText size={13} /> {l.facture_definitive ? "Définitive" : "Proforma"}
                    </button>
                  </td>
                </tr>
              ))}
              {periode && periode.lignes.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucun paiement sur cette période.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {periode && periode.lignes.length > nbAffiches && (
          <div className="border-t border-gray-100 px-4 py-3 text-center">
            <button onClick={() => setNbAffiches((n) => n + 50)} className="text-sm font-medium text-cebevirha hover:underline">
              Afficher plus ({periode.lignes.length - nbAffiches} restants)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

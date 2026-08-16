import { useEffect, useState } from "react";
import { apiClient } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@/types/roles";
import type { Commande } from "@/types/commande";
import type { AutorisationImpression, PasseportResume } from "@/types/impression";

interface PaysApi {
  id: number;
  code_iso: string;
  nom: string;
}

/**
 * Module 3 — Impression (Document technique §3, M3). Deux volets :
 * 1. Confirmer l'impression des commandes payées (centralisée : un clic ;
 *    décentralisée : déclarer le lot réellement imprimé, plage fermée).
 * 2. Gérer les autorisations d'impression décentralisée par pays.
 * Le passage PRECHARGE -> VIERGE ici est ce qui rend un passeport utilisable
 * par le Module 4 (Émission terrain).
 */
export default function Impression() {
  const { utilisateur } = useAuth();
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [pays, setPays] = useState<PaysApi[]>([]);
  const [chargement, setChargement] = useState(true);

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

  const nomPays = (paysId: number) => pays.find((p) => p.id === paysId)?.nom ?? `Pays #${paysId}`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Impression</h1>
        <p className="text-sm text-gray-500">Module 3 — confirmer l'impression des commandes payées.</p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-800">Commandes payées</div>
        {chargement ? (
          <p className="p-4 text-sm text-gray-500">Chargement…</p>
        ) : commandes.length === 0 ? (
          <p className="p-4 text-sm text-gray-400">Aucune commande payée en attente d'impression.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {commandes.map((c) => (
              <LigneCommande key={c.id} commande={c} nomPays={nomPays(c.pays_id)} peutConfirmer={utilisateur?.role === Role.SUPER_ADMIN} onChange={charger} />
            ))}
          </ul>
        )}
      </section>

      {utilisateur?.role === Role.SUPER_ADMIN && <SectionAutorisations pays={pays} />}

      <SectionDeclarerLot pays={pays} paysImpose={utilisateur?.role === Role.ADMIN_NATIONAL ? utilisateur.pays_id : null} />
    </div>
  );
}

function LigneCommande({
  commande,
  nomPays,
  peutConfirmer,
  onChange,
}: {
  commande: Commande;
  nomPays: string;
  peutConfirmer: boolean;
  onChange: () => void;
}) {
  const [passeports, setPasseports] = useState<PasseportResume[] | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const chargerPasseports = () => {
    apiClient.get<PasseportResume[]>("/passeports", { params: { commande_id: commande.id } }).then(({ data }) => setPasseports(data));
  };

  useEffect(chargerPasseports, [commande.id]);

  const nbPrecharge = passeports?.filter((p) => p.statut === "precharge").length ?? 0;
  const nbVierge = passeports?.filter((p) => p.statut === "vierge").length ?? 0;

  const confirmerImpression = async () => {
    setErreur(null);
    setEnCours(true);
    try {
      await apiClient.post("/passeports/impression-centralisee/confirmer", null, { params: { commande_id: commande.id } });
      chargerPasseports();
      onChange();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErreur(detail ?? "La confirmation a échoué.");
    } finally {
      setEnCours(false);
    }
  };

  const telechargerDocument = async () => {
    // Téléchargement authentifié — voir la même remarque que BoutonFacture (écran Commandes) :
    // un simple <a href> n'enverrait pas le jeton d'accès.
    setErreur(null);
    try {
      const { data } = await apiClient.get(`/passeports/commande/${commande.id}/document-impression`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      window.open(url, "_blank");
    } catch {
      setErreur("Le document n'a pas pu être généré — réessayez, ou signalez ce blocage.");
    }
  };

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800">
            {nomPays} — {commande.quantite.toLocaleString("fr-FR")} PPB
          </p>
          <p className="text-xs text-gray-500 capitalize">Mode : {commande.mode_impression}</p>
        </div>
        <div className="text-right text-xs text-gray-500">
          <p>{nbPrecharge} préchargé(s)</p>
          <p>{nbVierge} vierge(s)</p>
        </div>
      </div>

      {nbPrecharge > 0 && (
        <div className="mt-2 flex items-center justify-end gap-2">
          {erreur && <p className="text-xs text-red-600">{erreur}</p>}
          <button onClick={telechargerDocument} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            Télécharger le document PDF ({nbPrecharge} passeport{nbPrecharge > 1 ? "s" : ""})
          </button>
          {commande.mode_impression === "centralisee" &&
            (peutConfirmer ? (
              <button
                onClick={confirmerImpression}
                disabled={enCours}
                className="rounded-md bg-cebevirha px-3 py-1.5 text-xs font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
              >
                {enCours ? "…" : "Confirmer l'impression"}
              </button>
            ) : (
              <p className="text-xs text-gray-400">Seul un Super Admin peut confirmer l'impression centralisée.</p>
            ))}
        </div>
      )}

      {commande.mode_impression === "decentralisee" && nbPrecharge > 0 && (
        <p className="mt-2 text-xs text-gray-400">
          Imprimez le document téléchargé ci-dessus, puis déclarez le lot réellement imprimé dans la section ci-dessous.
        </p>
      )}
    </li>
  );
}

function SectionAutorisations({ pays }: { pays: PaysApi[] }) {
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
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <p className="text-sm font-semibold text-gray-800">Autorisations d'impression décentralisée</p>
        <button onClick={() => setFormulaireOuvert(true)} className="rounded-md bg-cebevirha px-3 py-1.5 text-xs font-medium text-white hover:bg-cebevirha-light">
          + Nouvelle autorisation
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
                    Plage {autorisation.plage_debut}–{autorisation.plage_fin} (gabarit v{autorisation.gabarit_version})
                  </span>
                  <button onClick={() => suspendre(autorisation.id)} className="text-xs text-red-600 hover:underline">
                    Suspendre
                  </button>
                </span>
              ) : (
                <span className="text-xs text-gray-400">Aucune autorisation active</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FormulaireNouvelleAutorisation({ pays, onAnnuler, onCree }: { pays: PaysApi[]; onAnnuler: () => void; onCree: () => void }) {
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
      setErreur(detail ?? "La création a échoué.");
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="grid grid-cols-4 gap-2">
        <select value={paysId ?? ""} onChange={(e) => setPaysId(Number(e.target.value))} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          {pays.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nom}
            </option>
          ))}
        </select>
        <input type="number" placeholder="Début" value={plageDebut} onChange={(e) => setPlageDebut(Number(e.target.value))} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <input type="number" placeholder="Fin" value={plageFin} onChange={(e) => setPlageFin(Number(e.target.value))} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <input type="number" placeholder="Version gabarit" value={gabaritVersion} onChange={(e) => setGabaritVersion(Number(e.target.value))} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      {erreur && <p className="text-sm text-red-600">{erreur}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onAnnuler} className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
          Annuler
        </button>
        <button onClick={soumettre} className="rounded-md bg-cebevirha px-3 py-1.5 text-xs font-medium text-white hover:bg-cebevirha-light">
          Créer
        </button>
      </div>
    </div>
  );
}

function SectionDeclarerLot({ pays, paysImpose }: { pays: PaysApi[]; paysImpose: number | null }) {
  const [paysId, setPaysId] = useState<number | null>(paysImpose);
  const [numeroDebut, setNumeroDebut] = useState(1);
  const [numeroFin, setNumeroFin] = useState(50);
  const [resultat, setResultat] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (paysId === null && pays.length > 0) setPaysId(paysImpose ?? pays[0].id);
  }, [pays, paysId, paysImpose]);

  const declarer = async () => {
    setErreur(null);
    setResultat(null);
    if (paysId === null) return;
    try {
      const { data } = await apiClient.post("/passeports/impression-decentralisee/declarer", {
        pays_id: paysId,
        numero_debut: numeroDebut,
        numero_fin: numeroFin,
      });
      setResultat(`${data.quantite} passeport(s) déclaré(s) imprimé(s) — passés au statut "vierge".`);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErreur(detail ?? "La déclaration a échoué.");
    }
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-gray-800">Déclarer un lot imprimé (impression décentralisée)</p>
      <p className="mb-3 text-xs text-gray-500">
        À utiliser une fois le lot physiquement imprimé localement, dans la plage autorisée pour le pays. Rejeté en bloc si un
        numéro de la plage est manquant ou déjà imprimé.
      </p>
      <div className="grid grid-cols-4 gap-2">
        <select
          value={paysId ?? ""}
          disabled={paysImpose !== null}
          onChange={(e) => setPaysId(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100"
        >
          {pays.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nom}
            </option>
          ))}
        </select>
        <input type="number" placeholder="Numéro début" value={numeroDebut} onChange={(e) => setNumeroDebut(Number(e.target.value))} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <input type="number" placeholder="Numéro fin" value={numeroFin} onChange={(e) => setNumeroFin(Number(e.target.value))} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <button onClick={declarer} className="rounded-md bg-cebevirha px-3 py-1.5 text-sm font-medium text-white hover:bg-cebevirha-light">
          Déclarer
        </button>
      </div>
      {resultat && <p className="mt-2 text-sm text-green-700">{resultat}</p>}
      {erreur && <p className="mt-2 text-sm text-red-600">{erreur}</p>}
    </section>
  );
}

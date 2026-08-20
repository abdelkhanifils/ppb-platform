import { useEffect, useState } from "react";
import { apiClient } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import type { TypeChamp } from "@/types/emission";
import type {
  ChampAdmin,
  ChampCreate,
  CompletionGabarit,
  FormulaireAdmin,
  Parametre,
  TexteGabarit,
} from "@/types/admin";
import { LIBELLES_STATUT_GABARIT, LIBELLES_TYPE_CHAMP } from "@/types/admin";
import { LIBELLES_ROLE, Role } from "@/types/roles";
import type { UtilisateurAdmin, UtilisateurCreate, UtilisateurUpdate } from "@/types/utilisateurs";

type Onglet = "parametres" | "formulaires" | "gabarit" | "utilisateurs";

/**
 * Module Administration — configuration dynamique (Document technique §4).
 * Accessible au seul Super Admin (déjà garanti par la route, voir App.tsx) :
 * pas de vérification de rôle supplémentaire nécessaire dans cet écran.
 */
export default function Administration() {
  const [onglet, setOnglet] = useState<Onglet>("parametres");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Administration</h1>
        <p className="text-sm text-gray-500">Configuration dynamique des formulaires, paramètres système et gabarit du PPB.</p>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {(
          [
            ["parametres", "Paramètres système"],
            ["formulaires", "Formulaires dynamiques"],
            ["gabarit", "Gabarit du passeport"],
            ["utilisateurs", "Utilisateurs"],
          ] as [Onglet, string][]
        ).map(([valeur, libelle]) => (
          <button
            key={valeur}
            onClick={() => setOnglet(valeur)}
            className={`px-4 py-2 text-sm font-medium ${
              onglet === valeur ? "border-b-2 border-cebevirha text-cebevirha" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {libelle}
          </button>
        ))}
      </div>

      {onglet === "parametres" && <OngletParametres />}
      {onglet === "formulaires" && <OngletFormulaires />}
      {onglet === "gabarit" && <OngletGabarit />}
      {onglet === "utilisateurs" && <OngletUtilisateurs />}
    </div>
  );
}

// --- Onglet Paramètres ------------------------------------------------------------------------

function OngletParametres() {
  const [parametres, setParametres] = useState<Parametre[]>([]);
  const [chargement, setChargement] = useState(true);
  const [modification, setModification] = useState<Record<string, string>>({});
  const [enregistrementEnCours, setEnregistrementEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = () => {
    setChargement(true);
    apiClient
      .get<Parametre[]>("/admin/parametres")
      .then(({ data }) => setParametres(data))
      .finally(() => setChargement(false));
  };

  useEffect(charger, []);

  const enregistrer = async (cle: string) => {
    const nouvelleValeur = modification[cle];
    if (nouvelleValeur === undefined) return;
    setErreur(null);
    setEnregistrementEnCours(cle);
    try {
      await apiClient.patch(`/admin/parametres/${cle}`, { valeur: nouvelleValeur });
      charger();
      setModification((m) => {
        const copie = { ...m };
        delete copie[cle];
        return copie;
      });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErreur(detail ?? "La modification a échoué.");
    } finally {
      setEnregistrementEnCours(null);
    }
  };

  if (chargement) return <p className="text-sm text-gray-500">Chargement…</p>;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      {erreur && <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600">{erreur}</p>}
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="px-4 py-2.5">Clé</th>
            <th className="px-4 py-2.5">Description</th>
            <th className="px-4 py-2.5">Valeur</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {parametres.map((p) => (
            <tr key={p.cle} className="border-t border-gray-100">
              <td className="px-4 py-2.5 font-mono text-xs">{p.cle}</td>
              <td className="px-4 py-2.5 text-gray-500">{p.description}</td>
              <td className="px-4 py-2.5">
                <input
                  value={modification[p.cle] ?? p.valeur}
                  onChange={(e) => setModification((m) => ({ ...m, [p.cle]: e.target.value }))}
                  className="w-32 rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
              </td>
              <td className="px-4 py-2.5">
                {modification[p.cle] !== undefined && modification[p.cle] !== p.valeur && (
                  <button
                    onClick={() => enregistrer(p.cle)}
                    disabled={enregistrementEnCours === p.cle}
                    className="rounded-md bg-cebevirha px-2.5 py-1 text-xs font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
                  >
                    {enregistrementEnCours === p.cle ? "…" : "Enregistrer"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Onglet Formulaires dynamiques -------------------------------------------------------------

function OngletFormulaires() {
  const [formulaires, setFormulaires] = useState<FormulaireAdmin[]>([]);
  const [codeSelectionne, setCodeSelectionne] = useState<string | null>(null);
  const [champs, setChamps] = useState<ChampAdmin[]>([]);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  useEffect(() => {
    apiClient.get<FormulaireAdmin[]>("/admin/formulaires").then(({ data }) => setFormulaires(data));
  }, []);

  const chargerChamps = (code: string) => {
    setCodeSelectionne(code);
    apiClient.get<ChampAdmin[]>(`/admin/formulaires/${code}/champs`).then(({ data }) => setChamps(data));
  };

  const rafraichirTout = () => {
    apiClient.get<FormulaireAdmin[]>("/admin/formulaires").then(({ data }) => setFormulaires(data));
    if (codeSelectionne) chargerChamps(codeSelectionne);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="rounded-lg border border-gray-200 bg-white lg:col-span-1">
        <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-800">Formulaires</div>
        <ul className="divide-y divide-gray-100">
          {formulaires.map((f) => (
            <li key={f.id}>
              <button
                onClick={() => chargerChamps(f.code)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-gray-50 ${
                  codeSelectionne === f.code ? "bg-cebevirha/5" : ""
                }`}
              >
                <span>{f.nom}</span>
                <span className="text-xs text-gray-400">v{f.schema_version}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white lg:col-span-2">
        {!codeSelectionne ? (
          <p className="p-4 text-sm text-gray-400">Sélectionnez un formulaire à gauche.</p>
        ) : (
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">Champs — {codeSelectionne}</p>
              <button
                onClick={() => setFormulaireOuvert(true)}
                className="rounded-md bg-cebevirha px-3 py-1.5 text-xs font-medium text-white hover:bg-cebevirha-light"
              >
                + Ajouter un champ
              </button>
            </div>

            {formulaireOuvert && (
              <FormulaireAjoutChamp
                code={codeSelectionne}
                onAnnuler={() => setFormulaireOuvert(false)}
                onCree={() => {
                  setFormulaireOuvert(false);
                  rafraichirTout();
                }}
              />
            )}

            <ul className="mt-3 divide-y divide-gray-100">
              {champs.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                  <span className={c.actif ? "" : "text-gray-400 line-through"}>
                    {c.libelle_fr} <span className="text-xs text-gray-400">({LIBELLES_TYPE_CHAMP[c.type_champ]})</span>
                  </span>
                  {c.actif && (
                    <button
                      onClick={async () => {
                        await apiClient.delete(`/admin/formulaires/${codeSelectionne}/champs/${c.id}`);
                        rafraichirTout();
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Désactiver
                    </button>
                  )}
                </li>
              ))}
              {champs.length === 0 && <li className="py-4 text-center text-sm text-gray-400">Aucun champ configuré.</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function FormulaireAjoutChamp({ code, onAnnuler, onCree }: { code: string; onAnnuler: () => void; onCree: () => void }) {
  const [codeChamp, setCodeChamp] = useState("");
  const [libelleFr, setLibelleFr] = useState("");
  const [typeChamp, setTypeChamp] = useState<TypeChamp>("texte");
  const [obligatoire, setObligatoire] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const soumettre = async () => {
    setErreur(null);
    if (!codeChamp.trim() || !libelleFr.trim()) {
      setErreur("Le code et le libellé sont obligatoires.");
      return;
    }
    try {
      const payload: ChampCreate = {
        code_champ: codeChamp.trim(),
        libelle_fr: libelleFr.trim(),
        type_champ: typeChamp,
        obligatoire,
        ordre_affichage: 0,
        ...(typeChamp === "liste" ? { options_liste: { valeurs: ["Option 1", "Option 2"] } } : {}),
      };
      await apiClient.post(`/admin/formulaires/${code}/champs`, payload);
      onCree();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErreur(detail ?? "L'ajout a échoué.");
    }
  };

  return (
    <div className="mb-3 space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="code_champ" value={codeChamp} onChange={(e) => setCodeChamp(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <input placeholder="Libellé (français)" value={libelleFr} onChange={(e) => setLibelleFr(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <select value={typeChamp} onChange={(e) => setTypeChamp(e.target.value as TypeChamp)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          {Object.entries(LIBELLES_TYPE_CHAMP).map(([valeur, libelle]) => (
            <option key={valeur} value={valeur}>
              {libelle}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={obligatoire} onChange={(e) => setObligatoire(e.target.checked)} /> Obligatoire
        </label>
      </div>
      {erreur && <p className="text-sm text-red-600">{erreur}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onAnnuler} className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
          Annuler
        </button>
        <button onClick={soumettre} className="rounded-md bg-cebevirha px-3 py-1.5 text-xs font-medium text-white hover:bg-cebevirha-light">
          Ajouter
        </button>
      </div>
    </div>
  );
}

// --- Onglet Gabarit (circuit à deux comptes) ----------------------------------------------------

function OngletGabarit() {
  const { utilisateur } = useAuth();
  const [version, setVersion] = useState(1);
  const [textes, setTextes] = useState<TexteGabarit[]>([]);
  const [completion, setCompletion] = useState<CompletionGabarit | null>(null);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  const charger = () => {
    apiClient.get<TexteGabarit[]>(`/admin/gabarit/${version}/textes`).then(({ data }) => setTextes(data));
    apiClient.get<CompletionGabarit>(`/admin/gabarit/${version}/completion`).then(({ data }) => setCompletion(data));
  };

  useEffect(charger, [version]);

  const valider = async (texteId: string) => {
    try {
      await apiClient.post(`/admin/gabarit/textes/${texteId}/valider`);
      charger();
    } catch {
      /* le badge de statut reflète déjà l'échec au prochain chargement */
    }
  };

  const rejeter = async (texteId: string) => {
    const motif = window.prompt("Motif du rejet ?");
    if (!motif) return;
    await apiClient.post(`/admin/gabarit/textes/${texteId}/rejeter`, { motif });
    charger();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-gray-600">Version du gabarit</label>
        <input
          type="number"
          min={1}
          value={version}
          onChange={(e) => setVersion(Number(e.target.value))}
          className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
        {completion && (
          <span className="text-xs text-gray-500">
            {completion.par_statut.valide ?? 0} validés / {completion.total} textes proposés pour cette version
          </span>
        )}
        <button
          onClick={() => setFormulaireOuvert(true)}
          className="ml-auto rounded-md bg-cebevirha px-3 py-1.5 text-xs font-medium text-white hover:bg-cebevirha-light"
        >
          + Proposer un texte
        </button>
      </div>

      {formulaireOuvert && (
        <FormulaireProposerTexte
          versionCourante={version}
          onAnnuler={() => setFormulaireOuvert(false)}
          onCree={() => {
            setFormulaireOuvert(false);
            charger();
          }}
        />
      )}

      <div className="rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2.5">Clé</th>
              <th className="px-4 py-2.5">Langue</th>
              <th className="px-4 py-2.5">Texte</th>
              <th className="px-4 py-2.5">Statut</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {textes.map((t) => (
              <tr key={t.id} className="border-t border-gray-100">
                <td className="px-4 py-2.5 font-mono text-xs">{t.cle}</td>
                <td className="px-4 py-2.5">{t.langue}</td>
                <td className="max-w-sm px-4 py-2.5 truncate">{t.valeur}</td>
                <td className="px-4 py-2.5 text-xs">{LIBELLES_STATUT_GABARIT[t.statut]}</td>
                <td className="px-4 py-2.5">
                  {t.statut === "propose" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => valider(t.id)}
                        disabled={t.propose_par_id === utilisateur?.id}
                        title={t.propose_par_id === utilisateur?.id ? "Le proposant ne peut pas valider sa propre proposition." : ""}
                        className="rounded-md bg-cebevirha px-2 py-1 text-xs font-medium text-white hover:bg-cebevirha-light disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Valider
                      </button>
                      <button onClick={() => rejeter(t.id)} className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                        Rejeter
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {textes.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  Aucun texte proposé pour cette version.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormulaireProposerTexte({
  versionCourante,
  onAnnuler,
  onCree,
}: {
  versionCourante: number;
  onAnnuler: () => void;
  onCree: () => void;
}) {
  const [cle, setCle] = useState("");
  const [langue, setLangue] = useState("fr");
  const [valeur, setValeur] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  const soumettre = async () => {
    setErreur(null);
    if (!cle.trim() || !valeur.trim()) {
      setErreur("La clé et le texte sont obligatoires.");
      return;
    }
    try {
      await apiClient.post("/admin/gabarit/textes/proposer", {
        cle: cle.trim(),
        langue,
        valeur: valeur.trim(),
        gabarit_version_courante: versionCourante,
      });
      onCree();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setErreur(detail ?? "La proposition a échoué.");
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="grid grid-cols-3 gap-2">
        <input placeholder="cle (ex. bullet_2)" value={cle} onChange={(e) => setCle(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <select value={langue} onChange={(e) => setLangue(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
          <option value="fr">Français</option>
          <option value="en">Anglais</option>
          <option value="ar">Arabe</option>
        </select>
        <span className="flex items-center text-xs text-gray-500">Version {versionCourante}</span>
      </div>
      <textarea
        placeholder="Texte proposé"
        value={valeur}
        onChange={(e) => setValeur(e.target.value)}
        rows={3}
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      />
      {erreur && <p className="text-sm text-red-600">{erreur}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onAnnuler} className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
          Annuler
        </button>
        <button onClick={soumettre} className="rounded-md bg-cebevirha px-3 py-1.5 text-xs font-medium text-white hover:bg-cebevirha-light">
          Proposer
        </button>
      </div>
    </div>
  );
}

// --- Onglet Utilisateurs -------------------------------------------------------------------

interface PaysApi {
  id: number;
  code_iso: string;
  nom: string;
}

/**
 * Gestion des comptes applicatifs et de leurs rôles RBAC (Document
 * technique §6). Réservé au Super Admin — la route /administration l'est
 * déjà (voir App.tsx), pas de vérification de rôle supplémentaire ici.
 *
 * Un compte ne peut jamais désactiver ou rétrograder son propre rôle : le
 * backend le refuse (HTTP 409) même si cet écran, qui liste tous les
 * comptes y compris celui de l'utilisateur connecté, ne l'empêche pas
 * visuellement.
 */
function OngletUtilisateurs() {
  const { utilisateur: moi } = useAuth();
  const [utilisateurs, setUtilisateurs] = useState<UtilisateurAdmin[]>([]);
  const [pays, setPays] = useState<PaysApi[]>([]);
  const [chargement, setChargement] = useState(true);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);

  const charger = () => {
    setChargement(true);
    Promise.all([apiClient.get<UtilisateurAdmin[]>("/utilisateurs"), apiClient.get<PaysApi[]>("/pays")])
      .then(([reponseUtilisateurs, reponsePays]) => {
        setUtilisateurs(reponseUtilisateurs.data);
        setPays(reponsePays.data);
      })
      .finally(() => setChargement(false));
  };

  useEffect(charger, []);

  const nomPays = (paysId: number | null) => (paysId === null ? "—" : pays.find((p) => p.id === paysId)?.nom ?? `Pays #${paysId}`);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Comptes applicatifs et rôles RBAC — création, changement de rôle/pays, activation.</p>
        <button
          onClick={() => setFormulaireOuvert(true)}
          className="rounded-md bg-cebevirha px-3 py-1.5 text-xs font-medium text-white hover:bg-cebevirha-light"
        >
          + Nouvel utilisateur
        </button>
      </div>

      {erreurGlobale && <p className="text-sm text-red-600">{erreurGlobale}</p>}

      {formulaireOuvert && (
        <FormulaireNouvelUtilisateur
          pays={pays}
          onAnnuler={() => setFormulaireOuvert(false)}
          onCree={() => {
            setFormulaireOuvert(false);
            charger();
          }}
        />
      )}

      {chargement ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2.5">Nom</th>
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Rôle</th>
                <th className="px-4 py-2.5">Pays</th>
                <th className="px-4 py-2.5">Statut</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {utilisateurs.map((u) => (
                <LigneUtilisateur
                  key={u.id}
                  utilisateur={u}
                  pays={pays}
                  nomPays={nomPays(u.pays_id)}
                  estMoi={u.id === moi?.id}
                  onChange={charger}
                  onErreur={setErreurGlobale}
                />
              ))}
              {utilisateurs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    Aucun utilisateur.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function detailErreur(err: unknown, repli: string): string {
  const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
  return detail ?? repli;
}

function LigneUtilisateur({
  utilisateur,
  pays,
  nomPays,
  estMoi,
  onChange,
  onErreur,
}: {
  utilisateur: UtilisateurAdmin;
  pays: PaysApi[];
  nomPays: string;
  estMoi: boolean;
  onChange: () => void;
  onErreur: (message: string | null) => void;
}) {
  const [edition, setEdition] = useState(false);
  const [role, setRole] = useState(utilisateur.role);
  const [paysId, setPaysId] = useState<number | null>(utilisateur.pays_id);
  const [enCours, setEnCours] = useState(false);

  const enregistrer = async () => {
    onErreur(null);
    setEnCours(true);
    try {
      const donnees: UtilisateurUpdate = {};
      if (role !== utilisateur.role) donnees.role = role;
      if (paysId !== utilisateur.pays_id) donnees.pays_id = paysId;
      if (Object.keys(donnees).length > 0) {
        await apiClient.patch(`/utilisateurs/${utilisateur.id}`, donnees);
        onChange();
      }
      setEdition(false);
    } catch (err) {
      onErreur(detailErreur(err, "La modification a échoué."));
    } finally {
      setEnCours(false);
    }
  };

  const basculerActif = async () => {
    onErreur(null);
    try {
      await apiClient.patch(`/utilisateurs/${utilisateur.id}`, { actif: !utilisateur.actif });
      onChange();
    } catch (err) {
      onErreur(detailErreur(err, "La modification a échoué."));
    }
  };

  const reinitialiserMotDePasse = async () => {
    const nouveau = window.prompt(`Nouveau mot de passe pour ${utilisateur.email} (8 caractères minimum) :`);
    if (!nouveau) return;
    onErreur(null);
    try {
      await apiClient.post(`/utilisateurs/${utilisateur.id}/reinitialiser-mot-de-passe`, { nouveau_mot_de_passe: nouveau });
    } catch (err) {
      onErreur(detailErreur(err, "La réinitialisation a échoué."));
    }
  };

  return (
    <tr className="border-t border-gray-100">
      <td className="px-4 py-2.5">
        {utilisateur.nom_complet}
        {estMoi && <span className="ml-1.5 text-xs text-gray-400">(vous)</span>}
      </td>
      <td className="px-4 py-2.5 text-gray-500">{utilisateur.email}</td>
      <td className="px-4 py-2.5">
        {edition ? (
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-md border border-gray-300 px-2 py-1 text-xs">
            {Object.values(Role).map((r) => (
              <option key={r} value={r}>
                {LIBELLES_ROLE[r]}
              </option>
            ))}
          </select>
        ) : (
          LIBELLES_ROLE[utilisateur.role]
        )}
      </td>
      <td className="px-4 py-2.5">
        {edition ? (
          <select
            value={paysId ?? ""}
            onChange={(e) => setPaysId(e.target.value === "" ? null : Number(e.target.value))}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="">— Aucun —</option>
            {pays.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
              </option>
            ))}
          </select>
        ) : (
          nomPays
        )}
      </td>
      <td className="px-4 py-2.5">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            utilisateur.actif ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
          }`}
        >
          {utilisateur.actif ? "Actif" : "Désactivé"}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex justify-end gap-2">
          {edition ? (
            <>
              <button
                onClick={() => {
                  setRole(utilisateur.role);
                  setPaysId(utilisateur.pays_id);
                  setEdition(false);
                }}
                className="rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
              >
                Annuler
              </button>
              <button
                onClick={enregistrer}
                disabled={enCours}
                className="rounded-md bg-cebevirha px-2 py-1 text-xs font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
              >
                {enCours ? "…" : "Enregistrer"}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEdition(true)} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                Modifier
              </button>
              <button onClick={reinitialiserMotDePasse} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                Mot de passe
              </button>
              <button
                onClick={basculerActif}
                disabled={estMoi && utilisateur.actif}
                title={estMoi && utilisateur.actif ? "Vous ne pouvez pas désactiver votre propre compte." : ""}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {utilisateur.actif ? "Désactiver" : "Réactiver"}
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function FormulaireNouvelUtilisateur({ pays, onAnnuler, onCree }: { pays: PaysApi[]; onAnnuler: () => void; onCree: () => void }) {
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [nomComplet, setNomComplet] = useState("");
  const [role, setRole] = useState<Role>(Role.CONSULTATION);
  const [paysId, setPaysId] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const soumettre = async () => {
    setErreur(null);
    if (!email.trim() || !nomComplet.trim() || motDePasse.length < 8) {
      setErreur("Email et nom complet obligatoires ; mot de passe de 8 caractères minimum.");
      return;
    }
    setEnCours(true);
    try {
      const payload: UtilisateurCreate = {
        email: email.trim(),
        mot_de_passe: motDePasse,
        nom_complet: nomComplet.trim(),
        role,
        pays_id: paysId,
      };
      await apiClient.post("/utilisateurs", payload);
      onCree();
    } catch (err) {
      setErreur(detailErreur(err, "La création a échoué."));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-600">Nom complet</span>
          <input value={nomComplet} onChange={(e) => setNomComplet(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-600">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-600">Mot de passe</span>
          <input
            type="password"
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-600">Rôle</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            {Object.values(Role).map((r) => (
              <option key={r} value={r}>
                {LIBELLES_ROLE[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-600">Pays</span>
          <select
            value={paysId ?? ""}
            onChange={(e) => setPaysId(e.target.value === "" ? null : Number(e.target.value))}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">— Aucun —</option>
            {pays.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
              </option>
            ))}
          </select>
        </label>
      </div>
      {erreur && <p className="text-sm text-red-600">{erreur}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onAnnuler} className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100">
          Annuler
        </button>
        <button
          onClick={soumettre}
          disabled={enCours}
          className="rounded-md bg-cebevirha px-3 py-1.5 text-xs font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
        >
          {enCours ? "…" : "Créer"}
        </button>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  Settings,
  Users,
  ShieldCheck,
  SlidersHorizontal,
  FileText,
  MapPin,
  ScrollText,
  DatabaseBackup,
  Info,
  ArrowLeft,
} from "lucide-react";
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
import { chargerEtAppliquerBranding, ZONE_CONTROLE, ZONE_EMISSION, ZONE_GLOBAL, type Branding } from "@/lib/branding";

type Section = "utilisateurs" | "roles" | "parametres" | "documents" | "pays" | "journaux" | "sauvegarde" | "apropos";

interface CarteSection {
  cle: Section;
  icone: typeof Settings;
  titre: string;
  description: string;
  action: string;
  disponible: boolean;
}

const SECTIONS: CarteSection[] = [
  { cle: "utilisateurs", icone: Users, titre: "Utilisateurs", description: "Gérer les comptes et les rôles des utilisateurs.", action: "Gérer", disponible: true },
  { cle: "roles", icone: ShieldCheck, titre: "Rôles & Permissions", description: "Définir les rôles et les droits d'accès.", action: "Gérer", disponible: false },
  { cle: "parametres", icone: SlidersHorizontal, titre: "Paramètres généraux", description: "Configurer les paramètres de la plateforme.", action: "Configurer", disponible: true },
  { cle: "documents", icone: FileText, titre: "Modèles de documents", description: "Gérer les modèles de passeports et documents.", action: "Gérer", disponible: true },
  { cle: "pays", icone: MapPin, titre: "Pays & Frontières", description: "Gérer les pays, postes frontières et régions.", action: "Gérer", disponible: false },
  { cle: "journaux", icone: ScrollText, titre: "Journaux d'activité", description: "Consulter l'historique des actions.", action: "Consulter", disponible: false },
  { cle: "sauvegarde", icone: DatabaseBackup, titre: "Sauvegarde", description: "Gérer les sauvegardes des données.", action: "Gérer", disponible: false },
  { cle: "apropos", icone: Info, titre: "À propos", description: "Informations sur la plateforme et version.", action: "Voir", disponible: true },
];

/**
 * Module Administration — configuration dynamique (Document technique §4).
 * Accessible au seul Super Admin (déjà garanti par la route, voir App.tsx) :
 * pas de vérification de rôle supplémentaire nécessaire dans cet écran.
 *
 * Écran d'accueil en grille de cartes, chacune menant à une section — les
 * anciens onglets horizontaux (Paramètres système, Formulaires dynamiques,
 * Gabarit du passeport, Utilisateurs, Apparence) sont conservés tels quels
 * à l'intérieur de la section correspondante (voir ci-dessous), regroupés
 * différemment plutôt que réécrits. Les sections sans contrepartie
 * existante (Rôles & Permissions, Pays & Frontières, Journaux d'activité,
 * Sauvegarde) affichent un espace réservé « à venir » — la carte reste
 * visible et cliquable, seul son contenu reste à construire.
 */
export default function Administration() {
  const [section, setSection] = useState<Section | null>(null);

  if (section === null) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 rounded-lg border border-or/40 bg-amber-50 px-4 py-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cebevirha/10">
            <Settings size={20} className="text-cebevirha" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-bleuCemac">Administration</h1>
            <p className="text-sm text-gray-500">Gestion des paramètres et des utilisateurs.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SECTIONS.map((s) => (
            <button key={s.cle} onClick={() => setSection(s.cle)} className="rounded-lg border border-or/40 bg-white p-5 text-left transition hover:border-cebevirha hover:shadow-sm">
              <span className="mb-3 inline-flex size-11 items-center justify-center rounded-full bg-cebevirha/10">
                <s.icone size={20} className="text-cebevirha" />
              </span>
              <p className="text-base font-semibold text-bleuCemac">{s.titre}</p>
              <p className="mt-1 text-xs text-gray-500">{s.description}</p>
              <span className="mt-4 inline-block rounded-md border border-cebevirha/30 px-3 py-1.5 text-xs font-medium text-cebevirha">{s.action}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const courante = SECTIONS.find((s) => s.cle === section)!;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-lg border border-or/40 bg-amber-50 px-4 py-3">
        <button onClick={() => setSection(null)} className="flex size-10 shrink-0 items-center justify-center rounded-full border border-or/40 text-gray-500 hover:bg-gray-50">
          <ArrowLeft size={18} />
        </button>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cebevirha/10">
          <courante.icone size={20} className="text-cebevirha" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-bleuCemac">{courante.titre}</h1>
          <p className="text-sm text-gray-500">{courante.description}</p>
        </div>
      </div>

      {section === "utilisateurs" && <OngletUtilisateurs />}
      {section === "parametres" && <SectionParametresGeneraux />}
      {section === "documents" && <SectionModelesDocuments />}
      {section === "apropos" && <SectionAPropos />}
      {(section === "roles" || section === "pays" || section === "journaux" || section === "sauvegarde") && <SectionAVenir />}
    </div>
  );
}

/** Regroupe les deux anciens onglets "Paramètres système" et "Formulaires
 * dynamiques", proches par nature (configuration de la plateforme). */
function SectionParametresGeneraux() {
  const [sousOnglet, setSousOnglet] = useState<"parametres" | "formulaires">("parametres");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-or/40">
        {(
          [
            ["parametres", "Paramètres système"],
            ["formulaires", "Formulaires dynamiques"],
          ] as const
        ).map(([valeur, libelle]) => (
          <button
            key={valeur}
            onClick={() => setSousOnglet(valeur)}
            className={`px-4 py-2 text-sm font-medium ${
              sousOnglet === valeur ? "border-b-2 border-cebevirha text-cebevirha" : "text-bleuCemac hover:text-cebevirha"
            }`}
          >
            {libelle}
          </button>
        ))}
      </div>
      {sousOnglet === "parametres" && <OngletParametres />}
      {sousOnglet === "formulaires" && <OngletFormulaires />}
    </div>
  );
}

/** Regroupe les deux anciens onglets "Gabarit du passeport" et "Apparence",
 * tous deux liés à l'apparence des documents produits par la plateforme. */
function SectionModelesDocuments() {
  const [sousOnglet, setSousOnglet] = useState<"gabarit" | "apparence">("gabarit");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-or/40">
        {(
          [
            ["gabarit", "Gabarit du passeport"],
            ["apparence", "Apparence"],
          ] as const
        ).map(([valeur, libelle]) => (
          <button
            key={valeur}
            onClick={() => setSousOnglet(valeur)}
            className={`px-4 py-2 text-sm font-medium ${
              sousOnglet === valeur ? "border-b-2 border-cebevirha text-cebevirha" : "text-bleuCemac hover:text-cebevirha"
            }`}
          >
            {libelle}
          </button>
        ))}
      </div>
      {sousOnglet === "gabarit" && <OngletGabarit />}
      {sousOnglet === "apparence" && <OngletApparence />}
    </div>
  );
}

function SectionAVenir() {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center">
      <p className="text-sm font-medium text-gray-600">Cette section n'est pas encore disponible.</p>
      <p className="mt-1 text-xs text-gray-400">Elle sera complétée dans une prochaine mise à jour.</p>
    </div>
  );
}

function SectionAPropos() {
  return (
    <div className="max-w-lg space-y-3 rounded-lg border border-or/40 bg-white p-5">
      <div>
        <p className="text-xs text-gray-500">Plateforme</p>
        <p className="text-sm font-medium text-gray-800">Passeport Pour Bétail (PPB) — CEBEVIRHA</p>
      </div>
      <div>
        <p className="text-xs text-gray-500">Version</p>
        <p className="text-sm font-medium text-gray-800">v1.0.0</p>
      </div>
      <div>
        <p className="text-xs text-gray-500">Description</p>
        <p className="text-sm text-gray-600">
          Plateforme régionale de gestion des passeports pour bétail de la zone CEMAC : commandes, paiements,
          impression, émission terrain, contrôle frontière et statistiques.
        </p>
      </div>
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
    <div className="rounded-lg border border-or/40 bg-white">
      {erreur && <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600">{erreur}</p>}
      <table className="w-full text-left text-sm">
        <thead className="bg-cebevirha/5 text-xs text-gray-500">
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
      <div className="rounded-lg border border-or/40 bg-white lg:col-span-1">
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

      <div className="rounded-lg border border-or/40 bg-white lg:col-span-2">
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
    <div className="mb-3 space-y-3 rounded-md border border-or/40 bg-gray-50 p-3">
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

      <div className="rounded-lg border border-or/40 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-cebevirha/5 text-xs text-gray-500">
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
    <div className="space-y-3 rounded-md border border-or/40 bg-gray-50 p-3">
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
        <div className="rounded-lg border border-or/40 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-cebevirha/5 text-xs text-gray-500">
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
    <div className="space-y-3 rounded-md border border-or/40 bg-gray-50 p-3">
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

// --- Onglet Apparence (Personnalisation) ----------------------------------------------------

/**
 * Identité visuelle de la plateforme — nom, couleurs, logo, icône (favicon +
 * PWA « Ajouter à l'écran d'accueil »), cachet. TROIS zones indépendantes
 * (voir backend/app/models/branding.py::ZONES_VALIDES) : le reste du
 * tableau de bord web, les écrans d'émission mobile, et l'écran de contrôle
 * frontière (partagé web + mobile). Sélecteur en haut de page — chaque zone
 * a son propre formulaire, chargé/enregistré indépendamment des autres via
 * le paramètre `zone` de l'API (voir backend/app/api/v1/endpoints/branding.py).
 *
 * Une zone jamais personnalisée affiche silencieusement les valeurs de la
 * zone "Reste du tableau de bord" (repli côté backend, voir
 * _get_avec_repli) — donc rien ne semble "vide" tant que personne n'a
 * encore rien personnalisé pour elle.
 *
 * Après chaque modification touchant la zone "global", `chargerEtAppliquerBranding()`
 * est rappelée pour que le reste de l'écran courant (logo de la barre du
 * haut notamment) reflète immédiatement le changement — sans recharger la
 * page. Les zones "emission"/"controle" n'affectent jamais l'apparence de
 * cet écran d'administration lui-même (jamais actives ici), pas besoin du
 * même rafraîchissement pour elles.
 */
function OngletApparence() {
  const ZONES: Array<{ valeur: string; libelle: string; description: string }> = [
    { valeur: ZONE_GLOBAL, libelle: "Reste du tableau de bord", description: "Web Admin — toutes les pages sauf Contrôle frontière." },
    { valeur: ZONE_EMISSION, libelle: "Émission (mobile)", description: "Écrans d'émission de l'application mobile terrain." },
    { valeur: ZONE_CONTROLE, libelle: "Contrôle frontière", description: "Écran de contrôle — partagé entre le Web Admin et l'application mobile." },
  ];

  const [zoneSelectionnee, setZoneSelectionnee] = useState(ZONE_GLOBAL);
  const [brandingZone, setBrandingZone] = useState<Branding | null>(null);
  const [nomApplication, setNomApplication] = useState("");
  const [couleurPrimaire, setCouleurPrimaire] = useState("#0f5132");
  const [couleurPrimaireClaire, setCouleurPrimaireClaire] = useState("#146c43");
  const [enCoursCouleurs, setEnCoursCouleurs] = useState(false);
  const [enCoursLogo, setEnCoursLogo] = useState(false);
  const [enCoursIcone, setEnCoursIcone] = useState(false);
  const [enCoursCachet, setEnCoursCachet] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);

  const chargerZone = (zone: string) => {
    apiClient.get<Branding>("/branding", { params: { zone } }).then(({ data }) => {
      setBrandingZone(data);
      setNomApplication(data.nom_application);
      setCouleurPrimaire(data.couleur_primaire);
      setCouleurPrimaireClaire(data.couleur_primaire_claire);
    });
  };

  useEffect(() => {
    chargerZone(zoneSelectionnee);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneSelectionnee]);

  const rafraichirApresModification = async () => {
    chargerZone(zoneSelectionnee);
    if (zoneSelectionnee === ZONE_GLOBAL) await chargerEtAppliquerBranding();
  };

  const notifierSucces = (message: string) => {
    setErreur(null);
    setSucces(message);
    window.setTimeout(() => setSucces(null), 3000);
  };

  const enregistrerIdentite = async () => {
    setErreur(null);
    setEnCoursCouleurs(true);
    try {
      await apiClient.patch<Branding>(
        "/branding",
        { nom_application: nomApplication, couleur_primaire: couleurPrimaire, couleur_primaire_claire: couleurPrimaireClaire },
        { params: { zone: zoneSelectionnee } }
      );
      await rafraichirApresModification();
      notifierSucces("Identité mise à jour.");
    } catch (err) {
      setErreur(detailErreur(err, "La mise à jour a échoué."));
    } finally {
      setEnCoursCouleurs(false);
    }
  };

  const televerserLogo = async (fichier: File) => {
    setErreur(null);
    setEnCoursLogo(true);
    try {
      const formData = new FormData();
      formData.append("fichier", fichier);
      await apiClient.post("/branding/logo", formData, { params: { zone: zoneSelectionnee } });
      await rafraichirApresModification();
      notifierSucces("Logo mis à jour.");
    } catch (err) {
      setErreur(detailErreur(err, "Le téléversement du logo a échoué."));
    } finally {
      setEnCoursLogo(false);
    }
  };

  const televerserIcone = async (fichier: File) => {
    setErreur(null);
    setEnCoursIcone(true);
    try {
      const formData = new FormData();
      formData.append("fichier", fichier);
      await apiClient.post("/branding/icone", formData, { params: { zone: zoneSelectionnee } });
      await rafraichirApresModification();
      notifierSucces("Icône mise à jour.");
    } catch (err) {
      setErreur(detailErreur(err, "Le téléversement de l'icône a échoué."));
    } finally {
      setEnCoursIcone(false);
    }
  };

  const televerserCachet = async (fichier: File) => {
    setErreur(null);
    setEnCoursCachet(true);
    try {
      const formData = new FormData();
      formData.append("fichier", fichier);
      await apiClient.post("/branding/cachet", formData, { params: { zone: zoneSelectionnee } });
      await rafraichirApresModification();
      notifierSucces("Cachet mis à jour.");
    } catch (err) {
      setErreur(detailErreur(err, "Le téléversement du cachet a échoué."));
    } finally {
      setEnCoursCachet(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-gray-500">
        Nom, couleurs, logo et icône — personnalisables indépendamment pour chacune des 3 zones ci-dessous. Une zone
        jamais personnalisée reprend automatiquement l'apparence de « Reste du tableau de bord », le temps que vous
        la personnalisiez à son tour.
      </p>

      <div className="flex gap-2 rounded-lg border border-or/40 bg-white p-1.5">
        {ZONES.map((z) => (
          <button
            key={z.valeur}
            onClick={() => setZoneSelectionnee(z.valeur)}
            className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
              zoneSelectionnee === z.valeur ? "bg-cebevirha text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            {z.libelle}
          </button>
        ))}
      </div>
      <p className="-mt-3 text-xs text-gray-400">{ZONES.find((z) => z.valeur === zoneSelectionnee)?.description}</p>

      {erreur && <p className="text-sm text-red-600">{erreur}</p>}
      {succes && <p className="text-sm text-green-700">{succes}</p>}

      <div className="space-y-3 rounded-lg border border-or/40 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">Nom et couleurs</h3>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-600">Nom de l'application</span>
          <input
            value={nomApplication}
            onChange={(e) => setNomApplication(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-600">Couleur primaire</span>
            <div className="flex items-center gap-2">
              <input type="color" value={couleurPrimaire} onChange={(e) => setCouleurPrimaire(e.target.value)} className="h-9 w-12 rounded border border-gray-300" />
              <input
                value={couleurPrimaire}
                onChange={(e) => setCouleurPrimaire(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-600">Couleur primaire (claire)</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={couleurPrimaireClaire}
                onChange={(e) => setCouleurPrimaireClaire(e.target.value)}
                className="h-9 w-12 rounded border border-gray-300"
              />
              <input
                value={couleurPrimaireClaire}
                onChange={(e) => setCouleurPrimaireClaire(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </label>
        </div>
        <div className="flex justify-end">
          <button
            onClick={enregistrerIdentite}
            disabled={enCoursCouleurs}
            className="rounded-md bg-cebevirha px-3 py-1.5 text-xs font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
          >
            {enCoursCouleurs ? "…" : "Enregistrer"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-or/40 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-800">Logo</h3>
        <div className="flex items-center gap-4">
          {brandingZone?.a_logo ? (
            <img
              src={`${apiClient.defaults.baseURL}/branding/logo?zone=${zoneSelectionnee}&v=${brandingZone.version}`}
              alt="Logo actuel"
              className="h-14 w-auto rounded border border-or/40 p-1"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded border border-dashed border-gray-300 text-xs text-gray-400">Aucun</div>
          )}
          <label className="cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
            {enCoursLogo ? "Envoi…" : "Changer le logo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              disabled={enCoursLogo}
              onChange={(e) => e.target.files?.[0] && televerserLogo(e.target.files[0])}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-400">PNG, JPEG, WEBP ou SVG — 3 Mo maximum.</p>
      </div>

      <div className="rounded-lg border border-or/40 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-800">Icône (favicon &amp; PWA)</h3>
        <div className="flex items-center gap-4">
          {brandingZone?.a_icone ? (
            <img
              src={`${apiClient.defaults.baseURL}/branding/icone?zone=${zoneSelectionnee}&v=${brandingZone.version}`}
              alt="Icône actuelle"
              className="h-14 w-14 rounded border border-or/40 object-cover p-1"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded border border-dashed border-gray-300 text-xs text-gray-400">Aucune</div>
          )}
          <label className="cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
            {enCoursIcone ? "Envoi…" : "Changer l'icône"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={enCoursIcone}
              onChange={(e) => e.target.files?.[0] && televerserIcone(e.target.files[0])}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-400">Carrée, 512×512 recommandé — PNG, JPEG ou WEBP, 3 Mo maximum.</p>
      </div>

      {zoneSelectionnee === ZONE_GLOBAL && (
        <div className="rounded-lg border border-or/40 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-800">Cachet et signature</h3>
          <p className="mb-3 text-xs text-gray-500">
            Apposé automatiquement en bas de la première page de chaque PPB généré, et en bas de chaque facture.
            Toujours le même quelle que soit la zone visuelle active à l'écran — pas de variante par zone, uniquement
            disponible ici.
          </p>
          <div className="flex items-center gap-4">
            {brandingZone?.a_cachet ? (
              <img
                src={`${apiClient.defaults.baseURL}/branding/cachet?zone=${ZONE_GLOBAL}&v=${brandingZone.version}`}
                alt="Cachet actuel"
                className="h-14 w-auto rounded border border-or/40 object-contain p-1"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded border border-dashed border-gray-300 text-xs text-gray-400">Aucun</div>
            )}
            <label className="cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
              {enCoursCachet ? "Envoi…" : "Parcourir…"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={enCoursCachet}
                onChange={(e) => e.target.files?.[0] && televerserCachet(e.target.files[0])}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-gray-400">PNG à fond transparent recommandé — JPEG ou WEBP acceptés, 3 Mo maximum.</p>
        </div>
      )}
    </div>
  );
}

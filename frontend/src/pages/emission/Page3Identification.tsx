import { useEffect, useState } from "react";
import { obtenirSchemaLocal, rafraichirSchema } from "@/db/cacheSchemas";
import { validerPageLocalement } from "@/db/queueEmission";
import { obtenirEtConsommerSuggestion } from "@/db/cacheOcr";
import CapturePhotoOcr from "@/components/emission/CapturePhotoOcr";
import FormulaireDynamique, { validerValeursFormulaire } from "@/components/emission/FormulaireDynamique";
import { PAYS_CEMAC } from "@/types/pays";
import type { DonneesPage3, DonneesPersonne, SchemaFormulaire } from "@/types/emission";
import type { ChampsOcrPage3 } from "@/types/ocr";

interface Page3Props {
  passeportId: string;
  onValidee: () => void;
}

type ValeursDynamiques = Record<string, string | number | boolean | undefined>;

/**
 * Page 3 — Éleveur, Convoyeur et Itinéraire déclaré (Document technique,
 * Module 4). Trois blocs :
 * - Éleveur et Convoyeur : 3 champs structurels fixes (nom_prenom,
 *   numero_cni, telephone — jamais pilotés par la configuration dynamique)
 *   + les champs dynamiques publiés par le Super Admin pour chaque
 *   formulaire (voir Module Administration).
 * - Itinéraire : DÉCLARÉ ORALEMENT par l'éleveur/convoyeur à l'agent — non
 *   prédéfini à la commande, non connu à l'attribution du QR (voir Document
 *   de conception PPB, encadré « le trajet déclaré détermine la validité »).
 *   Ce sont des champs structurels fixes eux aussi : l'itinéraire n'est pas
 *   configurable dynamiquement.
 */
export default function Page3Identification({ passeportId, onValidee }: Page3Props) {
  const [schemaEleveur, setSchemaEleveur] = useState<SchemaFormulaire | null>(null);
  const [schemaConvoyeur, setSchemaConvoyeur] = useState<SchemaFormulaire | null>(null);

  const [eleveur, setEleveur] = useState<DonneesPersonne>({ nom_prenom: "", numero_cni: "", donnees_dynamiques: {} });
  const [convoyeur, setConvoyeur] = useState<DonneesPersonne>({ nom_prenom: "", numero_cni: "", donnees_dynamiques: {} });
  const [itineraire, setItineraire] = useState({
    pays_origine_id: PAYS_CEMAC[0].id,
    province_origine: "",
    localite_origine: "",
    pays_destination_id: PAYS_CEMAC[0].id,
    province_destination: "",
    localite_destination: "",
  });

  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [erreursEleveur, setErreursEleveur] = useState<Record<string, string>>({});
  const [erreursConvoyeur, setErreursConvoyeur] = useState<Record<string, string>>({});
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    // Offline-first : on affiche le cache local immédiatement, on rafraîchit
    // en tâche de fond si le réseau est là (jamais d'attente réseau bloquante).
    void obtenirSchemaLocal("eleveur").then((s) => s && setSchemaEleveur(s));
    void obtenirSchemaLocal("convoyeur").then((s) => s && setSchemaConvoyeur(s));
    if (navigator.onLine) {
      void rafraichirSchema("eleveur").then(setSchemaEleveur).catch(() => undefined);
      void rafraichirSchema("convoyeur").then(setSchemaConvoyeur).catch(() => undefined);
    }
    // Une suggestion OCR reçue pendant que l'agent était sur une autre page
    // (photo prise hors-ligne, traitée depuis) est proposée dès l'ouverture.
    void obtenirEtConsommerSuggestion(passeportId, 3).then((champs) => {
      if (champs) appliquerSuggestion(champs as ChampsOcrPage3);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passeportId]);

  /** Ne renseigne QUE les champs encore vides — une suggestion OCR ne doit
   * jamais écraser une valeur que l'agent a déjà saisie ou corrigée. */
  const appliquerSuggestion = (champs: ChampsOcrPage3) => {
    setEleveur((p) => ({
      ...p,
      nom_prenom: p.nom_prenom || champs.eleveur.nom_prenom || p.nom_prenom,
      numero_cni: p.numero_cni || champs.eleveur.numero_cni || p.numero_cni,
      telephone: p.telephone || champs.eleveur.telephone || p.telephone,
    }));
    setConvoyeur((p) => ({
      ...p,
      nom_prenom: p.nom_prenom || champs.convoyeur.nom_prenom || p.nom_prenom,
      numero_cni: p.numero_cni || champs.convoyeur.numero_cni || p.numero_cni,
      telephone: p.telephone || champs.convoyeur.telephone || p.telephone,
    }));
    setItineraire((p) => ({
      ...p,
      province_origine: p.province_origine || champs.itineraire.province_origine || p.province_origine,
      province_destination: p.province_destination || champs.itineraire.province_destination || p.province_destination,
      localite_origine: p.localite_origine || champs.itineraire.localite_origine || p.localite_origine,
      localite_destination: p.localite_destination || champs.itineraire.localite_destination || p.localite_destination,
    }));
  };

  const majDynamique = (
    setter: (fn: (p: DonneesPersonne) => DonneesPersonne) => void
  ) => (code: string, valeur: ValeursDynamiques[string]) =>
    setter((p) => ({ ...p, donnees_dynamiques: { ...p.donnees_dynamiques, [code]: valeur } }));

  const soumettre = async () => {
    const nouvellesErreursEleveur = schemaEleveur
      ? validerValeursFormulaire(schemaEleveur, eleveur.donnees_dynamiques)
      : {};
    const nouvellesErreursConvoyeur = schemaConvoyeur
      ? validerValeursFormulaire(schemaConvoyeur, convoyeur.donnees_dynamiques)
      : {};
    setErreursEleveur(nouvellesErreursEleveur);
    setErreursConvoyeur(nouvellesErreursConvoyeur);

    const erreursStructurelles: Record<string, string> = {};
    if (!eleveur.nom_prenom) erreursStructurelles["eleveur.nom_prenom"] = "Obligatoire";
    if (!eleveur.numero_cni) erreursStructurelles["eleveur.numero_cni"] = "Obligatoire";
    if (!itineraire.province_origine) erreursStructurelles["itineraire.province_origine"] = "Obligatoire";
    if (!itineraire.province_destination) erreursStructurelles["itineraire.province_destination"] = "Obligatoire";

    const toutesErreurs = { ...nouvellesErreursEleveur, ...nouvellesErreursConvoyeur, ...erreursStructurelles };
    setErreurs(toutesErreurs);
    if (Object.keys(toutesErreurs).length > 0) return;

    setEnCours(true);
    try {
      const donnees: DonneesPage3 = { eleveur, convoyeur, itineraire };
      await validerPageLocalement(passeportId, 3, donnees);
      onValidee();
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-gray-900">3 · Éleveur, convoyeur et itinéraire</h2>

      <CapturePhotoOcr passeportId={passeportId} pageNum={3} onSuggestion={(c) => appliquerSuggestion(c as ChampsOcrPage3)} />

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">Propriétaire</h3>
        <ChampTexte label="Nom et prénom *" valeur={eleveur.nom_prenom} onChange={(v) => setEleveur((p) => ({ ...p, nom_prenom: v }))} erreur={erreurs["eleveur.nom_prenom"]} />
        <ChampTexte label="N° CNI *" valeur={eleveur.numero_cni} onChange={(v) => setEleveur((p) => ({ ...p, numero_cni: v }))} erreur={erreurs["eleveur.numero_cni"]} />
        <ChampTexte label="Téléphone" valeur={eleveur.telephone ?? ""} onChange={(v) => setEleveur((p) => ({ ...p, telephone: v }))} />
        {schemaEleveur && (
          <FormulaireDynamique schema={schemaEleveur} valeurs={eleveur.donnees_dynamiques} onChange={majDynamique(setEleveur)} erreurs={erreursEleveur} />
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">Convoyeur</h3>
        <ChampTexte label="Nom et prénom" valeur={convoyeur.nom_prenom} onChange={(v) => setConvoyeur((p) => ({ ...p, nom_prenom: v }))} />
        <ChampTexte label="N° CNI" valeur={convoyeur.numero_cni} onChange={(v) => setConvoyeur((p) => ({ ...p, numero_cni: v }))} />
        <ChampTexte label="Téléphone" valeur={convoyeur.telephone ?? ""} onChange={(v) => setConvoyeur((p) => ({ ...p, telephone: v }))} />
        {schemaConvoyeur && (
          <FormulaireDynamique schema={schemaConvoyeur} valeurs={convoyeur.donnees_dynamiques} onChange={majDynamique(setConvoyeur)} erreurs={erreursConvoyeur} />
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">Itinéraire déclaré</h3>
        <p className="text-xs text-gray-500">
          Déclaré oralement par l'éleveur ou le convoyeur — détermine à lui seul la validité du passeport pour ce trajet.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <SelectPays label="Pays d'origine" valeur={itineraire.pays_origine_id} onChange={(id) => setItineraire((p) => ({ ...p, pays_origine_id: id }))} />
          <SelectPays label="Pays de destination" valeur={itineraire.pays_destination_id} onChange={(id) => setItineraire((p) => ({ ...p, pays_destination_id: id }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ChampTexte label="Province d'origine *" valeur={itineraire.province_origine} onChange={(v) => setItineraire((p) => ({ ...p, province_origine: v }))} erreur={erreurs["itineraire.province_origine"]} />
          <ChampTexte label="Province de destination *" valeur={itineraire.province_destination} onChange={(v) => setItineraire((p) => ({ ...p, province_destination: v }))} erreur={erreurs["itineraire.province_destination"]} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ChampTexte label="Localité d'origine" valeur={itineraire.localite_origine} onChange={(v) => setItineraire((p) => ({ ...p, localite_origine: v }))} />
          <ChampTexte label="Localité de destination" valeur={itineraire.localite_destination} onChange={(v) => setItineraire((p) => ({ ...p, localite_destination: v }))} />
        </div>
      </section>

      <button
        onClick={soumettre}
        disabled={enCours}
        className="w-full rounded-md bg-cebevirha px-4 py-3 text-sm font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
      >
        {enCours ? "Validation…" : "Valider cette page"}
      </button>
    </div>
  );
}

function ChampTexte({ label, valeur, onChange, erreur }: { label: string; valeur: string; onChange: (v: string) => void; erreur?: string }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <input
        type="text"
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cebevirha focus:outline-none"
      />
      {erreur && <p className="mt-1 text-xs text-red-600">{erreur}</p>}
    </div>
  );
}

function SelectPays({ label, valeur, onChange }: { label: string; valeur: number; onChange: (id: number) => void }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <select
        value={valeur}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cebevirha focus:outline-none"
      >
        {PAYS_CEMAC.map((pays) => (
          <option key={pays.id} value={pays.id}>
            {pays.nom}
          </option>
        ))}
      </select>
    </div>
  );
}

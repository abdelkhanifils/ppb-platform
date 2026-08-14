import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { obtenirSchemaLocal, rafraichirSchema } from "@/db/cacheSchemas";
import { validerPageLocalement } from "@/db/queueEmission";
import FormulaireDynamique, { validerValeursFormulaire } from "@/components/emission/FormulaireDynamique";
import type {
  DonneesPage4,
  DonneesVaccination,
  EffectifEspece,
  EspeceTroupeau,
  MaladieControlee,
  SchemaFormulaire,
} from "@/types/emission";

interface Page4Props {
  passeportId: string;
  onValidee: () => void;
}

const ESPECES: { valeur: EspeceTroupeau; libelle: string }[] = [
  { valeur: "bovin", libelle: "Bovins" },
  { valeur: "ovin", libelle: "Ovins" },
  { valeur: "caprin", libelle: "Caprins" },
  { valeur: "camelin", libelle: "Camelins" },
  { valeur: "autre", libelle: "Autres" },
];

// Les 4 maladies contrôlées figurant sur le gabarit physique du PPB (page
// « Santé · Cheptel · Contrôle ») — liste fixe, structurelle, pas pilotée
// par la configuration dynamique.
const MALADIES: { valeur: MaladieControlee; libelle: string }[] = [
  { valeur: "peste_petits_ruminants", libelle: "Peste des Petits Ruminants" },
  { valeur: "peripneumonie_contagieuse", libelle: "Péripneumonie contagieuse" },
  { valeur: "charbon", libelle: "Charbon" },
  { valeur: "trypanosomiase", libelle: "Trypanosomiase" },
];

function effectifVide(espece: EspeceTroupeau): EffectifEspece {
  return { espece, nombre_males: 0, nombre_femelles_jeunes: 0, nombre_femelles_adultes: 0, nombre_total: 0 };
}

/**
 * Page 4 — Composition du troupeau (par espèce) et vaccinations (Document
 * technique, Module 4). Crée, côté serveur, les entités Troupeau /
 * TroupeauEspece et Vaccination (voir backend/app/models/troupeau.py et
 * vaccination.py) à partir des données validées ici — jamais d'image.
 */
export default function Page4Troupeau({ passeportId, onValidee }: Page4Props) {
  const [schemaTroupeau, setSchemaTroupeau] = useState<SchemaFormulaire | null>(null);
  const [donneesDynamiques, setDonneesDynamiques] = useState<Record<string, string | number | boolean | undefined>>({});
  const [erreursDynamiques, setErreursDynamiques] = useState<Record<string, string>>({});

  const [effectifs, setEffectifs] = useState<EffectifEspece[]>([effectifVide("bovin")]);
  const [vaccinations, setVaccinations] = useState<DonneesVaccination[]>(
    MALADIES.map((m) => ({ maladie: m.valeur, date_vaccination: null, lieu: null }))
  );
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    void obtenirSchemaLocal("troupeau").then((s) => s && setSchemaTroupeau(s));
    if (navigator.onLine) {
      void rafraichirSchema("troupeau").then(setSchemaTroupeau).catch(() => undefined);
    }
  }, []);

  const majEffectif = (index: number, champ: keyof EffectifEspece, valeur: number | EspeceTroupeau) => {
    setEffectifs((precedents) =>
      precedents.map((e, i) => {
        if (i !== index) return e;
        const maj = { ...e, [champ]: valeur };
        // Le total est recalculé côté UI pour un retour immédiat à l'agent,
        // mais reste revalidé côté serveur — jamais une source de vérité UI seule.
        if (champ !== "espece" && champ !== "nombre_total") {
          maj.nombre_total = maj.nombre_males + maj.nombre_femelles_jeunes + maj.nombre_femelles_adultes;
        }
        return maj;
      })
    );
  };

  const ajouterLigneEspece = () => setEffectifs((p) => [...p, effectifVide("bovin")]);
  const retirerLigneEspece = (index: number) => setEffectifs((p) => p.filter((_, i) => i !== index));

  const majVaccination = (maladie: MaladieControlee, champ: "date_vaccination" | "lieu", valeur: string) => {
    setVaccinations((p) => p.map((v) => (v.maladie === maladie ? { ...v, [champ]: valeur || null } : v)));
  };

  const soumettre = async () => {
    const erreurs = schemaTroupeau ? validerValeursFormulaire(schemaTroupeau, donneesDynamiques) : {};
    setErreursDynamiques(erreurs);
    if (Object.keys(erreurs).length > 0) return;
    if (effectifs.every((e) => e.nombre_total === 0)) {
      setErreursDynamiques({ _global: "Au moins une espèce doit avoir un effectif non nul." });
      return;
    }

    setEnCours(true);
    try {
      const donnees: DonneesPage4 = {
        especes: effectifs.filter((e) => e.nombre_total > 0),
        vaccinations: vaccinations.filter((v) => v.date_vaccination || v.lieu),
        donnees_dynamiques: schemaTroupeau && schemaTroupeau.champs.length > 0 ? donneesDynamiques : undefined,
      };
      await validerPageLocalement(passeportId, 4, donnees);
      onValidee();
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-gray-900">4 · Composition du troupeau et vaccinations</h2>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">Composition par espèce</h3>

        {effectifs.map((effectif, index) => (
          <div key={index} className="grid grid-cols-12 items-end gap-2 border-b border-gray-100 pb-3 last:border-0">
            <div className="col-span-3">
              <label className="mb-1 block text-xs text-gray-500">Espèce</label>
              <select
                value={effectif.espece}
                onChange={(e) => majEffectif(index, "espece", e.target.value as EspeceTroupeau)}
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              >
                {ESPECES.map((e) => (
                  <option key={e.valeur} value={e.valeur}>
                    {e.libelle}
                  </option>
                ))}
              </select>
            </div>
            <ChampNombre label="Mâles" valeur={effectif.nombre_males} onChange={(v) => majEffectif(index, "nombre_males", v)} />
            <ChampNombre label="Femelles jeunes" valeur={effectif.nombre_femelles_jeunes} onChange={(v) => majEffectif(index, "nombre_femelles_jeunes", v)} />
            <ChampNombre label="Femelles adultes" valeur={effectif.nombre_femelles_adultes} onChange={(v) => majEffectif(index, "nombre_femelles_adultes", v)} />
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-gray-500">Total</label>
              <p className="rounded-md bg-gray-50 px-2 py-1.5 text-sm font-medium text-gray-700">{effectif.nombre_total}</p>
            </div>
            <button onClick={() => retirerLigneEspece(index)} className="col-span-1 flex justify-center text-gray-400 hover:text-red-600">
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        <button onClick={ajouterLigneEspece} className="flex items-center gap-1 text-sm text-cebevirha hover:underline">
          <Plus size={14} /> Ajouter une espèce
        </button>

        {erreursDynamiques._global && <p className="text-sm text-red-600">{erreursDynamiques._global}</p>}
      </section>

      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">Vaccinations réalisées ou vérifiées</h3>
        {MALADIES.map((maladie) => {
          const donnee = vaccinations.find((v) => v.maladie === maladie.valeur)!;
          return (
            <div key={maladie.valeur} className="grid grid-cols-3 items-end gap-2">
              <p className="col-span-1 text-sm text-gray-700">{maladie.libelle}</p>
              <div className="col-span-1">
                <input
                  type="date"
                  value={donnee.date_vaccination ?? ""}
                  onChange={(e) => majVaccination(maladie.valeur, "date_vaccination", e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="col-span-1">
                <input
                  type="text"
                  placeholder="Lieu"
                  value={donnee.lieu ?? ""}
                  onChange={(e) => majVaccination(maladie.valeur, "lieu", e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          );
        })}
      </section>

      {schemaTroupeau && schemaTroupeau.champs.length > 0 && (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-800">Informations complémentaires</h3>
          <FormulaireDynamique
            schema={schemaTroupeau}
            valeurs={donneesDynamiques}
            onChange={(code, valeur) => setDonneesDynamiques((p) => ({ ...p, [code]: valeur }))}
            erreurs={erreursDynamiques}
          />
        </section>
      )}

      <button
        onClick={soumettre}
        disabled={enCours}
        className="w-full rounded-md bg-cebevirha px-4 py-3 text-sm font-medium text-white hover:bg-cebevirha-light disabled:opacity-50"
      >
        {enCours ? "Validation…" : "Valider et clôturer l'émission"}
      </button>
    </div>
  );
}

function ChampNombre({
  label,
  valeur,
  onChange,
}: {
  label: string;
  valeur: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="col-span-2">
      <label className="mb-1 block text-xs text-gray-500">{label}</label>
      <input
        type="number"
        min={0}
        value={valeur}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      />
    </div>
  );
}

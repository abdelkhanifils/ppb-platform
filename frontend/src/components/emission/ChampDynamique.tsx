import type { ChampSchema } from "@/types/emission";

type ValeurChamp = string | number | boolean | undefined;

interface ChampDynamiqueProps {
  champ: ChampSchema;
  valeur: ValeurChamp;
  onChange: (valeur: ValeurChamp) => void;
  erreur?: string;
}

/**
 * Rendu d'UN champ à partir de sa DefinitionChamp (Module Administration) —
 * jamais de logique métier figée ici : le type d'input, le caractère
 * obligatoire et les options de liste viennent entièrement du schéma reçu du
 * serveur. Ajouter un champ côté Super Admin doit faire apparaître le champ
 * ici sans nouvelle version de l'application.
 */
export default function ChampDynamique({ champ, valeur, onChange, erreur }: ChampDynamiqueProps) {
  const libelle = champ.libelle_fr + (champ.obligatoire ? " *" : "");

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{libelle}</label>

      {champ.type_champ === "texte" && (
        <input
          type="text"
          value={(valeur as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          required={champ.obligatoire}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cebevirha focus:outline-none"
        />
      )}

      {champ.type_champ === "nombre" && (
        <input
          type="number"
          value={(valeur as number) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          required={champ.obligatoire}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cebevirha focus:outline-none"
        />
      )}

      {champ.type_champ === "date" && (
        <input
          type="date"
          value={(valeur as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          required={champ.obligatoire}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cebevirha focus:outline-none"
        />
      )}

      {champ.type_champ === "liste" && (
        <select
          value={(valeur as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          required={champ.obligatoire}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-cebevirha focus:outline-none"
        >
          <option value="" disabled>
            Sélectionner…
          </option>
          {(champ.options_liste?.valeurs ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}

      {champ.type_champ === "booleen" && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={Boolean(valeur)} onChange={(e) => onChange(e.target.checked)} />
          Oui
        </label>
      )}

      {erreur && <p className="mt-1 text-xs text-red-600">{erreur}</p>}
    </div>
  );
}

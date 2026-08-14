import type { ChampSchema, SchemaFormulaire } from "@/types/emission";
import ChampDynamique from "./ChampDynamique";

type ValeursFormulaire = Record<string, string | number | boolean | undefined>;

interface FormulaireDynamiqueProps {
  schema: SchemaFormulaire;
  valeurs: ValeursFormulaire;
  onChange: (code: string, valeur: string | number | boolean | undefined) => void;
  erreurs?: Record<string, string>;
}

/** Rend l'ensemble des champs actifs d'un schéma, triés par ordre_affichage —
 * jamais l'ordre d'arrivée du serveur, qui n'est pas garanti. */
export default function FormulaireDynamique({ schema, valeurs, onChange, erreurs }: FormulaireDynamiqueProps) {
  const champsTries = [...schema.champs].sort((a, b) => a.ordre_affichage - b.ordre_affichage);

  return (
    <div className="space-y-4">
      {champsTries.map((champ) => (
        <ChampDynamique
          key={champ.code_champ}
          champ={champ}
          valeur={valeurs[champ.code_champ]}
          onChange={(valeur) => onChange(champ.code_champ, valeur)}
          erreur={erreurs?.[champ.code_champ]}
        />
      ))}
    </div>
  );
}

/** Valide les champs obligatoires et les règles regex du schéma — appelée
 * avant `validerPageLocalement` pour ne jamais mettre en file une page
 * incomplète au regard du schéma actuellement publié. */
export function validerValeursFormulaire(
  schema: SchemaFormulaire,
  valeurs: ValeursFormulaire
): Record<string, string> {
  const erreurs: Record<string, string> = {};

  for (const champ of schema.champs as ChampSchema[]) {
    const valeur = valeurs[champ.code_champ];
    const estVide = valeur === undefined || valeur === "" || valeur === null;

    if (champ.obligatoire && estVide) {
      erreurs[champ.code_champ] = "Ce champ est obligatoire.";
      continue;
    }
    if (!estVide && champ.regle_validation && typeof valeur === "string") {
      try {
        const regex = new RegExp(champ.regle_validation);
        if (!regex.test(valeur)) {
          erreurs[champ.code_champ] = "Format invalide.";
        }
      } catch {
        // Règle mal formée côté serveur : on ne bloque jamais la saisie terrain pour ça.
      }
    }
  }

  return erreurs;
}

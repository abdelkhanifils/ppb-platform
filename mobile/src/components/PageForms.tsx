/**
 * Formulaires des pages 3 et 4 — le point d'arrivée de l'OCR et le seul
 * endroit où la donnée devient officielle.
 *
 * Règle absolue héritée du besoin métier : l'OCR PRÉ-REMPLIT, il ne décide
 * jamais. Chaque champ reste librement modifiable, et l'indice de confiance
 * sert uniquement à orienter le regard de l'agent vers ce qui mérite une
 * vérification. Un champ corrigé à la main perd son badge : il n'est plus une
 * suggestion machine mais une saisie humaine.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, PencilLine } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { DrapeauPays } from '@/components/DrapeauPays';
import {
  ESPECES_PASSEPORT,
  MALADIES_CONTROLEES,
  PAYS_CEMAC,
  type DonneesPage3,
  type DonneesPage4,
  type DonneesPersonne,
  type EspeceTroupeau,
  type PasseportCache,
  type PaysReference,
} from '@/lib/db';
import { MENTION_AUTRE, localitesFrontalieresPourPays, localitesPourPays, provincesPourPays } from '@/lib/paysLocalites';
import type { CarteConfiance, NiveauConfiance } from '@/lib/ocr';

/* ------------------------------------------------------------------ */
/* Badge de confiance                                                  */
/* ------------------------------------------------------------------ */

function BadgeConfiance({ niveau }: { niveau: NiveauConfiance | undefined }) {
  const { t } = useI18n();
  if (!niveau || niveau === 'aucune') return null;

  const styles: Record<Exclude<NiveauConfiance, 'aucune'>, { classe: string; icone: JSX.Element }> = {
    haute: {
      classe: 'bg-[hsl(var(--success))]/12 text-[hsl(var(--success))]',
      icone: <CheckCircle2 className="size-3.5" />,
    },
    moyenne: {
      classe: 'bg-[hsl(var(--warning))]/14 text-[hsl(var(--warning))]',
      icone: <CircleHelp className="size-3.5" />,
    },
    basse: {
      classe: 'bg-destructive/12 text-destructive',
      icone: <AlertTriangle className="size-3.5" />,
    },
  };

  const style = styles[niveau];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
        style.classe,
      )}
    >
      {style.icone}
      {t(`confiance.${niveau}`)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Champ texte piloté                                                  */
/* ------------------------------------------------------------------ */

interface ChampTexteProps {
  id: string;
  libelle: string;
  valeur: string;
  onChange: (valeur: string) => void;
  confiance?: NiveauConfiance;
  obligatoire?: boolean;
  erreur?: boolean;
  type?: 'text' | 'tel' | 'date';
  majuscules?: boolean;
}

function ChampTexte({
  id,
  libelle,
  valeur,
  onChange,
  confiance,
  obligatoire,
  erreur,
  type = 'text',
  majuscules,
}: ChampTexteProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id} className="text-sm font-medium">
          {libelle}
          {obligatoire && <span className="ml-0.5 text-destructive">*</span>}
        </Label>
        <BadgeConfiance niveau={confiance} />
      </div>
      <Input
        id={id}
        type={type}
        value={valeur}
        inputMode={type === 'tel' ? 'tel' : undefined}
        onChange={(e) => onChange(majuscules ? e.target.value.toUpperCase() : e.target.value)}
        aria-invalid={erreur || undefined}
        className={cn('cible-tactile', erreur && 'border-destructive ring-1 ring-destructive')}
      />
      {erreur && <p className="text-xs font-medium text-destructive">{t('validation.requis')}</p>}
    </div>
  );
}

/**
 * Liste déroulante avec repli en saisie libre — utilisée pour toute
 * localité (province/région d'origine ou de destination, lieu de
 * vaccination) : une liste connue à l'avance couvre la grande majorité des
 * cas réels, mais ne peut jamais être garantie exhaustive (hameaux non
 * répertoriés, nouvelles localités). Si la valeur actuelle ne figure pas
 * dans `options` (import initial d'un ancien passeport, ou choix explicite
 * de MENTION_AUTRE), bascule automatiquement en saisie libre plutôt que de
 * forcer un choix approximatif dans la liste.
 */
function ChampListeAvecAutre({
  id,
  libelle,
  options,
  valeur,
  onChange,
  confiance,
  obligatoire,
  erreur,
}: {
  id: string;
  libelle: string;
  options: string[];
  valeur: string;
  onChange: (v: string) => void;
  confiance?: NiveauConfiance;
  obligatoire?: boolean;
  erreur?: boolean;
}) {
  const { t } = useI18n();
  // État EXPLICITE, pas déduit de `valeur` : cliquer sur "Autres" vide la
  // valeur (onChange('')) pour que l'agent parte d'un champ propre — mais
  // une chaîne vide correspond aussi au tout premier affichage (avant tout
  // choix). Sans cet état séparé, les deux cas sont impossibles à
  // distinguer : sélectionner "Autres" repasserait aussitôt en mode liste
  // au lieu de révéler la saisie libre, puisque valeur === '' redeviendrait
  // vrai — c'est le bug corrigé ici. Initialisé une seule fois, à l'ouverture
  // du champ : une valeur déjà présente mais absente de `options` (import
  // d'un ancien passeport) démarre directement en saisie libre.
  const [modeSaisieLibre, setModeSaisieLibre] = useState(valeur !== '' && !options.includes(valeur));

  if (!modeSaisieLibre) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={id} className="text-sm font-medium">
            {libelle}
            {obligatoire && <span className="ml-0.5 text-destructive">*</span>}
          </Label>
          <BadgeConfiance niveau={confiance} />
        </div>
        <Select
          value={valeur}
          onValueChange={(v) => {
            if (v === MENTION_AUTRE) {
              setModeSaisieLibre(true);
              onChange('');
            } else {
              onChange(v);
            }
          }}
        >
          <SelectTrigger id={id} className={cn('cible-tactile', erreur && 'border-destructive ring-1 ring-destructive')}>
            <SelectValue placeholder={t('champ.choisir')} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {erreur && <p className="text-xs font-medium text-destructive">{t('validation.requis')}</p>}
      </div>
    );
  }

  // Saisie libre — déclenchée par le choix explicite de "Autres" ci-dessus,
  // ou par une valeur préexistante absente de la liste (voir l'état initial
  // plus haut). Un bouton permet de revenir à la liste si l'agent s'est
  // trompé de mode.
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={id} className="text-sm font-medium">
            {libelle}
            {obligatoire && <span className="ml-0.5 text-destructive">*</span>}
          </Label>
          <BadgeConfiance niveau={confiance} />
        </div>
        <button
          type="button"
          onClick={() => {
            setModeSaisieLibre(false);
            onChange(options[0] ?? '');
          }}
          className="text-xs font-medium text-primary underline underline-offset-2"
        >
          {t('champ.revenir_a_la_liste')}
        </button>
      </div>
      <Input
        id={id}
        value={valeur}
        placeholder={t('champ.saisir_manuellement')}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        aria-invalid={erreur || undefined}
        className={cn('cible-tactile', erreur && 'border-destructive ring-1 ring-destructive')}
      />
      {erreur && <p className="text-xs font-medium text-destructive">{t('validation.requis')}</p>}
    </div>
  );
}



export interface ErreursPage3 {
  [chemin: string]: boolean;
}

interface Page3Props {
  donnees: DonneesPage3;
  confiances: CarteConfiance;
  erreurs: ErreursPage3;
  onChange: (donnees: DonneesPage3) => void;
  onChampCorrige: (chemin: string) => void;
}

const ROLES: Array<{ cle: 'eleveur' | 'convoyeur'; libelle: string }> = [
  { cle: 'eleveur', libelle: 'p3.eleveur' },
  { cle: 'convoyeur', libelle: 'p3.convoyeur' },
];

export function FormulairePage3({
  donnees,
  confiances,
  erreurs,
  onChange,
  onChampCorrige,
}: Page3Props) {
  const { t } = useI18n();

  const majPersonne = (
    role: 'eleveur' | 'convoyeur',
    champ: keyof Omit<DonneesPersonne, 'donnees_dynamiques'>,
    valeur: string,
  ) => {
    onChampCorrige(`${role}.${champ}`);
    onChange({ ...donnees, [role]: { ...donnees[role], [champ]: valeur } });
  };

  const majItineraire = (champ: keyof DonneesPage3['itineraire'], valeur: string | number) => {
    onChampCorrige(`itineraire.${champ}`);
    onChange({ ...donnees, itineraire: { ...donnees.itineraire, [champ]: valeur } });
  };

  return (
    <div className="flex flex-col gap-6">
      {ROLES.map(({ cle, libelle }) => (
        <section key={cle} className="flex flex-col gap-4 rounded-lg border bg-card p-4">
          <h3 className="text-base font-semibold">{t(libelle)}</h3>
          <ChampTexte
            id={`${cle}-nom`}
            libelle={t('p3.nom_prenom')}
            valeur={donnees[cle].nom_prenom}
            onChange={(v) => majPersonne(cle, 'nom_prenom', v)}
            confiance={confiances[`${cle}.nom_prenom`]}
            erreur={erreurs[`${cle}.nom_prenom`]}
            obligatoire
            majuscules
          />
          <ChampTexte
            id={`${cle}-cni`}
            libelle={t('p3.cni')}
            valeur={donnees[cle].numero_cni}
            onChange={(v) => majPersonne(cle, 'numero_cni', v)}
            confiance={confiances[`${cle}.numero_cni`]}
            erreur={erreurs[`${cle}.numero_cni`]}
            obligatoire
            majuscules
          />
          <ChampTexte
            id={`${cle}-tel`}
            libelle={t('p3.telephone')}
            valeur={donnees[cle].telephone ?? ''}
            onChange={(v) => majPersonne(cle, 'telephone', v)}
            confiance={confiances[`${cle}.telephone`]}
            type="tel"
          />
        </section>
      ))}

      <section className="flex flex-col gap-4 rounded-lg border bg-card p-4">
        <h3 className="text-base font-semibold">{t('p3.itineraire')}</h3>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pays-origine" className="text-sm font-medium">
            {t('p3.pays_origine')}
            <span className="ml-0.5 text-destructive">*</span>
          </Label>
          <Select
            value={donnees.itineraire.pays_origine_id === null ? 'autre' : String(donnees.itineraire.pays_origine_id)}
            onValueChange={(v) => majItineraire('pays_origine_id', v === 'autre' ? null : Number(v))}
          >
            <SelectTrigger id="pays-origine" className="cible-tactile">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYS_CEMAC.map((pays) => (
                <SelectItem key={pays.id} value={String(pays.id)}>
                  <DrapeauPays codeIso={pays.code_iso} /> {pays.nom}
                </SelectItem>
              ))}
              {/* Pays hors CEMAC (Nigeria, Soudan...) : jamais ajouté à
                  PAYS_CEMAC lui-même — cette option révèle un champ de
                  saisie libre juste en dessous à la place. */}
              <SelectItem value="autre">{t('p3.pays_autre')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {donnees.itineraire.pays_origine_id === null && (
          <ChampTexte
            id="pays-origine-autre"
            libelle={t('p3.pays_origine_autre')}
            valeur={donnees.itineraire.pays_origine_autre ?? ''}
            onChange={(v) => majItineraire('pays_origine_autre', v)}
            erreur={erreurs['itineraire.pays_origine_autre']}
            obligatoire
            majuscules
          />
        )}

        <ChampListeAvecAutre
          id="province-origine"
          libelle={t('p3.province_origine')}
          options={provincesPourPays(PAYS_CEMAC.find((p) => p.id === donnees.itineraire.pays_origine_id)?.code_iso ?? '')}
          valeur={donnees.itineraire.province_origine}
          onChange={(v) => majItineraire('province_origine', v)}
          confiance={confiances['itineraire.province_origine']}
          erreur={erreurs['itineraire.province_origine']}
          obligatoire
        />
        <ChampListeAvecAutre
          id="localite-origine"
          libelle={t('p3.localite_origine')}
          options={localitesPourPays(PAYS_CEMAC.find((p) => p.id === donnees.itineraire.pays_origine_id)?.code_iso ?? '')}
          valeur={donnees.itineraire.localite_origine ?? ''}
          onChange={(v) => majItineraire('localite_origine', v)}
          confiance={confiances['itineraire.localite_origine']}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pays-destination" className="text-sm font-medium">
            {t('p3.pays_destination')}
            <span className="ml-0.5 text-destructive">*</span>
          </Label>
          <Select
            value={donnees.itineraire.pays_destination_id === null ? 'autre' : String(donnees.itineraire.pays_destination_id)}
            onValueChange={(v) => majItineraire('pays_destination_id', v === 'autre' ? null : Number(v))}
          >
            <SelectTrigger id="pays-destination" className="cible-tactile">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYS_CEMAC.map((pays) => (
                <SelectItem key={pays.id} value={String(pays.id)}>
                  <DrapeauPays codeIso={pays.code_iso} /> {pays.nom}
                </SelectItem>
              ))}
              <SelectItem value="autre">{t('p3.pays_autre')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {donnees.itineraire.pays_destination_id === null && (
          <ChampTexte
            id="pays-destination-autre"
            libelle={t('p3.pays_destination_autre')}
            valeur={donnees.itineraire.pays_destination_autre ?? ''}
            onChange={(v) => majItineraire('pays_destination_autre', v)}
            erreur={erreurs['itineraire.pays_destination_autre']}
            obligatoire
            majuscules
          />
        )}

        <ChampListeAvecAutre
          id="province-destination"
          libelle={t('p3.province_destination')}
          options={provincesPourPays(PAYS_CEMAC.find((p) => p.id === donnees.itineraire.pays_destination_id)?.code_iso ?? '')}
          valeur={donnees.itineraire.province_destination}
          onChange={(v) => majItineraire('province_destination', v)}
          confiance={confiances['itineraire.province_destination']}
          erreur={erreurs['itineraire.province_destination']}
          obligatoire
        />
        <ChampListeAvecAutre
          id="localite-destination"
          libelle={t('p3.localite_destination')}
          options={localitesPourPays(PAYS_CEMAC.find((p) => p.id === donnees.itineraire.pays_destination_id)?.code_iso ?? '')}
          valeur={donnees.itineraire.localite_destination ?? ''}
          onChange={(v) => majItineraire('localite_destination', v)}
          confiance={confiances['itineraire.localite_destination']}
        />
      </section>
    </div>
  );
}

/** Champs obligatoires de la page 3 — renvoie la carte des erreurs. */
export function validerPage3(donnees: DonneesPage3): ErreursPage3 {
  const erreurs: ErreursPage3 = {};
  for (const role of ['eleveur', 'convoyeur'] as const) {
    if (!donnees[role].nom_prenom.trim()) erreurs[`${role}.nom_prenom`] = true;
    if (!donnees[role].numero_cni.trim()) erreurs[`${role}.numero_cni`] = true;
  }
  if (!donnees.itineraire.province_origine.trim()) erreurs['itineraire.province_origine'] = true;
  if (!donnees.itineraire.province_destination.trim()) {
    erreurs['itineraire.province_destination'] = true;
  }
  if (donnees.itineraire.pays_origine_id === null && !donnees.itineraire.pays_origine_autre?.trim()) {
    erreurs['itineraire.pays_origine_autre'] = true;
  }
  if (donnees.itineraire.pays_destination_id === null && !donnees.itineraire.pays_destination_autre?.trim()) {
    erreurs['itineraire.pays_destination_autre'] = true;
  }
  return erreurs;
}

/* ------------------------------------------------------------------ */
/* Page 4 — cheptel et vaccinations                                    */
/* ------------------------------------------------------------------ */

interface Page4Props {
  donnees: DonneesPage4;
  confiances: CarteConfiance;
  passeport: PasseportCache | null;
  onChange: (donnees: DonneesPage4) => void;
  onChampCorrige: (chemin: string) => void;
}

/** Cellule numérique du tableau des effectifs — vide affichée à la place d'un 0 parasite. */
function CelluleNombre({
  valeur,
  onChange,
  etiquette,
}: {
  valeur: number;
  onChange: (valeur: number) => void;
  etiquette: string;
}) {
  return (
    <Input
      type="number"
      min={0}
      inputMode="numeric"
      aria-label={etiquette}
      value={valeur === 0 ? '' : String(valeur)}
      placeholder="0"
      onChange={(e) => {
        const brut = e.target.value.replace(/[^\d]/g, '');
        onChange(brut === '' ? 0 : Math.min(Number(brut), 99999));
      }}
      className="chiffres h-12 px-1 text-center text-base"
    />
  );
}

/** Pays émetteur du passeport, déduit des 2 premiers chiffres de son numéro
 * (ex. "01-2026-0000042" → "01" → Cameroun) — voir PAYS_CEMAC.code_numerique,
 * même convention que le gabarit imprimé (page 2, légende "01 CMR · 02 CAF...").
 * `undefined` si le numéro ne suit pas ce format (ne devrait pas arriver en
 * usage normal, le numéro étant toujours attribué par le backend). */
function paysEmetteurDepuisNumero(numero: string): PaysReference | undefined {
  const code = numero.slice(0, 2);
  return PAYS_CEMAC.find((p) => p.code_numerique === code);
}

export function FormulairePage4({ donnees, confiances, passeport, onChange, onChampCorrige }: Page4Props) {
  const { t } = useI18n();
  // Le lieu de vaccination se limite aux localités frontalières DU PAYS
  // ÉMETTEUR du passeport — pas les 6 pays CEMAC combinés (trop large : la
  // vaccination concerne le troupeau de CE passeport précis, pas n'importe
  // quel trajet possible dans la zone).
  const localitesVaccination = passeport ? localitesFrontalieresPourPays(paysEmetteurDepuisNumero(passeport.numero)?.code_iso ?? '') : [MENTION_AUTRE];

  const totalGeneral = useMemo(
    () => donnees.especes.reduce((somme, effectif) => somme + effectif.nombre_total, 0),
    [donnees.especes],
  );

  const majEffectif = (
    espece: EspeceTroupeau,
    champ: 'nombre_males' | 'nombre_femelles_jeunes' | 'nombre_femelles_adultes',
    valeur: number,
  ) => {
    onChampCorrige(`especes.${espece}`);
    onChange({
      ...donnees,
      especes: donnees.especes.map((effectif) => {
        if (effectif.espece !== espece) return effectif;
        const misAJour = { ...effectif, [champ]: valeur };
        // Le total n'est jamais saisi : il reste la somme des trois colonnes,
        // exactement comme le calcule le serveur.
        misAJour.nombre_total =
          misAJour.nombre_males +
          misAJour.nombre_femelles_jeunes +
          misAJour.nombre_femelles_adultes;
        return misAJour;
      }),
    });
  };

  const majVaccination = (
    maladie: string,
    champ: 'date_vaccination' | 'lieu',
    valeur: string,
  ) => {
    onChampCorrige(`vaccinations.${maladie}`);
    onChange({
      ...donnees,
      vaccinations: donnees.vaccinations.map((vaccination) =>
        vaccination.maladie === maladie
          ? { ...vaccination, [champ]: valeur.trim() === '' ? null : valeur }
          : vaccination,
      ),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <div>
          <h3 className="text-base font-semibold">{t('p4.effectifs')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('p4.total_auto')}</p>
        </div>

        <div className="flex flex-col gap-4">
          {ESPECES_PASSEPORT.map((espece) => {
            const effectif = donnees.especes.find((e) => e.espece === espece);
            if (!effectif) return null;
            return (
              <div key={espece} className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{t(`espece.${espece}`)}</span>
                    <BadgeConfiance niveau={confiances[`especes.${espece}`]} />
                  </div>
                  <span className="chiffres text-sm font-semibold text-primary">
                    {t('p4.total')} : {effectif.nombre_total}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t('p4.males')}</span>
                    <CelluleNombre
                      valeur={effectif.nombre_males}
                      etiquette={`${t(`espece.${espece}`)} — ${t('p4.males')}`}
                      onChange={(v) => majEffectif(espece, 'nombre_males', v)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t('p4.femelles_jeunes')}</span>
                    <CelluleNombre
                      valeur={effectif.nombre_femelles_jeunes}
                      etiquette={`${t(`espece.${espece}`)} — ${t('p4.femelles_jeunes')}`}
                      onChange={(v) => majEffectif(espece, 'nombre_femelles_jeunes', v)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{t('p4.femelles_adultes')}</span>
                    <CelluleNombre
                      valeur={effectif.nombre_femelles_adultes}
                      etiquette={`${t(`espece.${espece}`)} — ${t('p4.femelles_adultes')}`}
                      onChange={(v) => majEffectif(espece, 'nombre_femelles_adultes', v)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-1 flex items-center justify-between rounded-md bg-accent px-3 py-2.5">
          <span className="text-sm font-semibold text-accent-foreground">{t('p4.total_general')}</span>
          <span className="chiffres text-lg font-bold text-accent-foreground">{totalGeneral}</span>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border bg-card p-4">
        <div>
          <h3 className="text-base font-semibold">{t('p4.vaccinations')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('p4.vaccinations_aide')}</p>
        </div>

        {MALADIES_CONTROLEES.map((maladie) => {
          const vaccination = donnees.vaccinations.find((v) => v.maladie === maladie);
          return (
            <div key={maladie} className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{t(`maladie.${maladie}`)}</span>
                <BadgeConfiance niveau={confiances[`vaccinations.${maladie}`]} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  aria-label={`${t(`maladie.${maladie}`)} — ${t('p4.date_vaccination')}`}
                  value={vaccination?.date_vaccination ?? ''}
                  onChange={(e) => majVaccination(maladie, 'date_vaccination', e.target.value)}
                  className="cible-tactile chiffres"
                />
                <ChampListeAvecAutre
                  id={`lieu-${maladie}`}
                  libelle={t('p4.lieu_vaccination')}
                  options={localitesVaccination}
                  valeur={vaccination?.lieu ?? ''}
                  onChange={(v) => majVaccination(maladie, 'lieu', v)}
                />
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/** Le cheptel ne peut pas être vide : un passeport sans animal n'a aucun sens. */
export function validerPage4(donnees: DonneesPage4): boolean {
  return donnees.especes.some((effectif) => effectif.nombre_total > 0);
}

/** Légende commune, affichée dès qu'un champ porte un badge de confiance. */
export function LegendeConfiance() {
  const { t } = useI18n();
  return (
    <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">
      <PencilLine className="mt-0.5 size-4 shrink-0" />
      {t('confiance.legende')}
    </p>
  );
}
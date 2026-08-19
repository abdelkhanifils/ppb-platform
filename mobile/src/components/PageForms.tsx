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
import { useMemo } from 'react';
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
import {
  ESPECES_PASSEPORT,
  MALADIES_CONTROLEES,
  PAYS_CEMAC,
  type DonneesPage3,
  type DonneesPage4,
  type DonneesPersonne,
  type EspeceTroupeau,
} from '@/lib/db';
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

/* ------------------------------------------------------------------ */
/* Page 3 — identification et trajet                                   */
/* ------------------------------------------------------------------ */

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
            value={String(donnees.itineraire.pays_origine_id)}
            onValueChange={(v) => majItineraire('pays_origine_id', Number(v))}
          >
            <SelectTrigger id="pays-origine" className="cible-tactile">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYS_CEMAC.map((pays) => (
                <SelectItem key={pays.id} value={String(pays.id)}>
                  {pays.nom}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ChampTexte
          id="province-origine"
          libelle={t('p3.province_origine')}
          valeur={donnees.itineraire.province_origine}
          onChange={(v) => majItineraire('province_origine', v)}
          confiance={confiances['itineraire.province_origine']}
          erreur={erreurs['itineraire.province_origine']}
          obligatoire
          majuscules
        />
        <ChampTexte
          id="localite-origine"
          libelle={t('p3.localite_origine')}
          valeur={donnees.itineraire.localite_origine ?? ''}
          onChange={(v) => majItineraire('localite_origine', v)}
          confiance={confiances['itineraire.localite_origine']}
          majuscules
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pays-destination" className="text-sm font-medium">
            {t('p3.pays_destination')}
            <span className="ml-0.5 text-destructive">*</span>
          </Label>
          <Select
            value={String(donnees.itineraire.pays_destination_id)}
            onValueChange={(v) => majItineraire('pays_destination_id', Number(v))}
          >
            <SelectTrigger id="pays-destination" className="cible-tactile">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYS_CEMAC.map((pays) => (
                <SelectItem key={pays.id} value={String(pays.id)}>
                  {pays.nom}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ChampTexte
          id="province-destination"
          libelle={t('p3.province_destination')}
          valeur={donnees.itineraire.province_destination}
          onChange={(v) => majItineraire('province_destination', v)}
          confiance={confiances['itineraire.province_destination']}
          erreur={erreurs['itineraire.province_destination']}
          obligatoire
          majuscules
        />
        <ChampTexte
          id="localite-destination"
          libelle={t('p3.localite_destination')}
          valeur={donnees.itineraire.localite_destination ?? ''}
          onChange={(v) => majItineraire('localite_destination', v)}
          confiance={confiances['itineraire.localite_destination']}
          majuscules
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
  return erreurs;
}

/* ------------------------------------------------------------------ */
/* Page 4 — cheptel et vaccinations                                    */
/* ------------------------------------------------------------------ */

interface Page4Props {
  donnees: DonneesPage4;
  confiances: CarteConfiance;
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

export function FormulairePage4({ donnees, confiances, onChange, onChampCorrige }: Page4Props) {
  const { t } = useI18n();

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
                <Input
                  type="text"
                  placeholder={t('p4.lieu_vaccination')}
                  aria-label={`${t(`maladie.${maladie}`)} — ${t('p4.lieu_vaccination')}`}
                  value={vaccination?.lieu ?? ''}
                  onChange={(e) => majVaccination(maladie, 'lieu', e.target.value.toUpperCase())}
                  className="cible-tactile"
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
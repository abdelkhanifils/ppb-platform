/**
 * Consultation d'une émission enregistrée.
 *
 * Répond au besoin exprimé sur le terrain : « que les informations saisies
 * puissent être enregistrées dans la base de données pour consultation ». Les
 * données partaient déjà en base, mais rien ne permettait de les relire — ni
 * dans l'application, ni par l'API, dont la route de consultation ne renvoyait
 * que des statuts de pages.
 *
 * Cet écran répond donc à deux questions distinctes, sans les confondre :
 *
 * 1. QU'AI-JE SAISI ? — lu depuis IndexedDB, donc disponible en permanence,
 *    même sans réseau. C'est la source affichée par défaut.
 * 2. EST-CE BIEN EN BASE ? — relu depuis la plateforme centrale à la demande.
 *    Tant que la vérification n'a pas eu lieu, l'écran ne prétend RIEN sur le
 *    serveur : afficher « enregistré » sur la seule foi d'une copie locale
 *    serait exactement le faux-semblant que l'agent doit pouvoir écarter.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  CloudOff,
  Database,
  Loader2,
  MapPin,
  Smartphone,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { LOCALES_DATE, useI18n } from '@/lib/i18n';
import { DrapeauPays } from '@/components/DrapeauPays';
import {
  lireEmission,
  PAYS_CEMAC,
  type DonneesPage3,
  type DonneesPage4,
  type Emission,
} from '@/lib/db';
import {
  ErreurAuthentification,
  ErreurReseau,
  lirePasseportEnregistre,
  type PasseportEnregistre,
} from '@/lib/sync';

/** Ce que la plateforme centrale confirme — ou ne confirme pas encore. */
type EtatServeur =
  | { type: 'inconnu' }
  | { type: 'chargement' }
  | { type: 'present'; donnees: PasseportEnregistre }
  | { type: 'absent' }
  | { type: 'echec'; message: string };

export default function Consultation() {
  const { t, langue } = useI18n();
  const naviguer = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [emission, setEmission] = useState<Emission | null>(null);
  const [chargement, setChargement] = useState(true);
  const [serveur, setServeur] = useState<EtatServeur>({ type: 'inconnu' });

  useEffect(() => {
    let actif = true;
    void (async () => {
      const trouvee = id ? await lireEmission(id) : undefined;
      if (!actif) return;
      setEmission(trouvee ?? null);
      setChargement(false);
    })();
    return () => {
      actif = false;
    };
  }, [id]);

  /**
   * Confronte l'affichage à la base centrale.
   *
   * Volontairement manuel : l'agent est souvent hors réseau, et un appel
   * automatique échouerait la plupart du temps en donnant l'impression d'une
   * anomalie là où il n'y a qu'une absence de connexion.
   */
  const verifier = useCallback(async () => {
    if (!emission) return;
    setServeur({ type: 'chargement' });
    try {
      const donnees = await lirePasseportEnregistre(emission.passeport_id);
      setServeur(donnees ? { type: 'present', donnees } : { type: 'absent' });
      if (!donnees) toast.info(t('consult.absent_serveur'));
    } catch (cause) {
      const message =
        cause instanceof ErreurReseau || cause instanceof ErreurAuthentification
          ? t('consult.echec')
          : cause instanceof Error
            ? cause.message
            : t('consult.echec');
      setServeur({ type: 'echec', message });
      toast.error(message);
    }
  }, [emission, t]);

  const formaterDate = useCallback(
    (iso: string) =>
      new Date(iso).toLocaleString(LOCALES_DATE[langue], {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [langue],
  );

  if (chargement) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!emission) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="text-sm text-muted-foreground">{t('consult.introuvable')}</p>
        <Button type="button" onClick={() => naviguer('/')} className="cible-tactile">
          {t('action.retour')}
        </Button>
      </div>
    );
  }

  // Les pages 3 et 4 relues en base font foi quand elles sont disponibles :
  // c'est la seule façon de montrer ce qui est RÉELLEMENT enregistré, et non la
  // copie locale qui, elle, ne prouve rien sur l'état du serveur.
  const pagesServeur = serveur.type === 'present' ? serveur.donnees.pages : [];
  const page3Serveur = pagesServeur.find((page) => page.page_num === 3);
  const page4Serveur = pagesServeur.find((page) => page.page_num === 4);

  const page3 = (page3Serveur?.donnees_json as DonneesPage3 | undefined) ?? emission.page3;
  const page4 = (page4Serveur?.donnees_json as DonneesPage4 | undefined) ?? emission.page4;
  const donneesDuServeur = Boolean(page3Serveur || page4Serveur);

  return (
    <div className="min-h-screen bg-background pb-10">
      <header className="zone-sure-haut sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="cible-tactile size-11 shrink-0"
            onClick={() => naviguer('/')}
            aria-label={t('action.retour')}
          >
            <ArrowLeft className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('consult.titre')}
            </p>
            <h1 className="chiffres truncate text-base font-semibold">{emission.numero}</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-5">
        <p className="text-sm leading-relaxed text-muted-foreground">{t('consult.intro')}</p>

        {/* Provenance des valeurs affichées — jamais ambiguë. */}
        <div
          className={cn(
            'flex items-start gap-2.5 rounded-lg border px-3 py-2.5',
            donneesDuServeur
              ? 'border-[hsl(var(--success))]/35 bg-[hsl(var(--success))]/8'
              : 'border-[hsl(var(--warning))]/35 bg-[hsl(var(--warning))]/10',
          )}
        >
          {donneesDuServeur ? (
            <Database className="mt-0.5 size-4 shrink-0 text-[hsl(var(--success))]" />
          ) : (
            <Smartphone className="mt-0.5 size-4 shrink-0 text-[hsl(var(--warning))]" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {t(donneesDuServeur ? 'consult.source_serveur' : 'consult.source_locale')}
            </p>
            {serveur.type === 'present' && (
              <p className="chiffres mt-0.5 text-xs text-muted-foreground">
                {serveur.donnees.pages.length} {t('consult.pages_recues')}
              </p>
            )}
            {serveur.type === 'absent' && (
              <p className="mt-0.5 text-xs text-muted-foreground">{t('consult.absent_serveur')}</p>
            )}
            {serveur.type === 'echec' && (
              <p className="mt-0.5 break-words text-xs text-destructive">{serveur.message}</p>
            )}
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="cible-tactile w-full !bg-transparent"
          disabled={serveur.type === 'chargement'}
          onClick={() => void verifier()}
        >
          {serveur.type === 'chargement' ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {t('consult.verification_en_cours')}
            </>
          ) : serveur.type === 'present' ? (
            <>
              <CheckCircle2 className="mr-2 size-4" />
              {t('consult.verifier')}
            </>
          ) : (
            <>
              <CloudOff className="mr-2 size-4" />
              {t('consult.verifier')}
            </>
          )}
        </Button>

        <BlocPersonne titre={t('p3.eleveur')} personne={page3.eleveur} />
        <BlocPersonne titre={t('p3.convoyeur')} personne={page3.convoyeur} />

        <section className="flex flex-col rounded-lg border bg-card">
          <EnteteBloc titre={t('p3.itineraire')} />
          <Ligne
            libelle={t('p3.pays_origine')}
            valeur={nomPays(page3.itineraire.pays_origine_id, page3.itineraire.pays_origine_autre)}
          />
          <Ligne
            libelle={t('p3.province_origine')}
            valeur={page3.itineraire.province_origine || '—'}
          />
          <Ligne
            libelle={t('p3.localite_origine')}
            valeur={page3.itineraire.localite_origine || '—'}
          />
          <Ligne
            libelle={t('p3.pays_destination')}
            valeur={nomPays(page3.itineraire.pays_destination_id, page3.itineraire.pays_destination_autre)}
          />
          <Ligne
            libelle={t('p3.province_destination')}
            valeur={page3.itineraire.province_destination || '—'}
          />
          <Ligne
            libelle={t('p3.localite_destination')}
            valeur={page3.itineraire.localite_destination || '—'}
          />
        </section>

        <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <h2 className="text-base font-semibold">{t('consult.effectifs')}</h2>
          {page4.especes.filter((effectif) => effectif.nombre_total > 0).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('consult.aucun_effectif')}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {page4.especes
                .filter((effectif) => effectif.nombre_total > 0)
                .map((effectif) => (
                  <li key={effectif.espece} className="flex flex-col gap-1 py-2.5 first:pt-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold">{t(`espece.${effectif.espece}`)}</span>
                      <span className="chiffres text-base font-bold">{effectif.nombre_total}</span>
                    </div>
                    <p className="chiffres text-xs text-muted-foreground">
                      {t('consult.males')} {effectif.nombre_males} ·{' '}
                      {t('consult.femelles_jeunes')} {effectif.nombre_femelles_jeunes} ·{' '}
                      {t('consult.femelles_adultes')} {effectif.nombre_femelles_adultes}
                    </p>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col rounded-lg border bg-card">
          <EnteteBloc titre={t('p4.vaccinations')} />
          {page4.vaccinations.filter((vaccination) => vaccination.date_vaccination).length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {t('consult.aucune_vaccination')}
            </p>
          ) : (
            page4.vaccinations
              .filter((vaccination) => vaccination.date_vaccination)
              .map((vaccination) => (
                <Ligne
                  key={vaccination.maladie}
                  libelle={t(`maladie.${vaccination.maladie}`)}
                  valeur={`${vaccination.date_vaccination}${
                    vaccination.lieu ? ` · ${vaccination.lieu}` : ''
                  }`}
                  chiffres
                />
              ))
          )}
        </section>

        <section className="flex flex-col rounded-lg border bg-card">
          <EnteteBloc titre={t('recap.titre')} />
          <Ligne libelle={t('recap.passeport')} valeur={emission.numero} chiffres />
          <Ligne libelle={t('tdb.historique')} valeur={formaterDate(emission.cree_le)} chiffres />
          <Ligne libelle={t('connexion.email')} valeur={emission.agent_email} />
          <Ligne
            libelle={t('recap.position')}
            valeur={
              emission.gps
                ? `${emission.gps.latitude}, ${emission.gps.longitude} (±${emission.gps.precision_m} m)`
                : t('recap.position_absente')
            }
            chiffres={Boolean(emission.gps)}
            icone={<MapPin className="size-4 text-muted-foreground" />}
          />
          <Ligne libelle={t('statut.synchronisee')} valeur={t(`statut.${emission.etat_synchro}`)} />
        </section>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sous-composants                                                     */
/* ------------------------------------------------------------------ */

function nomPays(id: number | null, autre: string | null): React.ReactNode {
  if (id === null) return autre || '—';
  const pays = PAYS_CEMAC.find((pays) => pays.id === id);
  if (!pays) return '—';
  return (
    <span className="inline-flex items-center gap-1.5">
      <DrapeauPays codeIso={pays.code_iso} /> {pays.nom}
    </span>
  );
}

function EnteteBloc({ titre }: { titre: string }) {
  return (
    <>
      <h2 className="px-4 pt-4 text-base font-semibold">{titre}</h2>
      <Separator className="mt-3" />
    </>
  );
}

function BlocPersonne({
  titre,
  personne,
}: {
  titre: string;
  personne: DonneesPage3['eleveur'];
}) {
  const { t } = useI18n();
  return (
    <section className="flex flex-col rounded-lg border bg-card">
      <EnteteBloc titre={titre} />
      <Ligne libelle={t('p3.nom_prenom')} valeur={personne.nom_prenom || '—'} />
      <Ligne libelle={t('p3.cni')} valeur={personne.numero_cni || '—'} chiffres />
      <Ligne libelle={t('p3.telephone')} valeur={personne.telephone || '—'} chiffres />
    </section>
  );
}

function Ligne({
  libelle,
  valeur,
  chiffres,
  icone,
}: {
  libelle: string;
  valeur: React.ReactNode;
  chiffres?: boolean;
  icone?: JSX.Element;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b px-4 py-3 last:border-b-0">
      <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {icone}
        {libelle}
      </dt>
      <dd className={cn('max-w-[60%] break-words text-right text-sm font-medium', chiffres && 'chiffres')}>
        {valeur}
      </dd>
    </div>
  );
}
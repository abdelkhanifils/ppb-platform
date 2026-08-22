/**
 * Écran d'entrée : connexion agent, puis tableau de bord d'émission.
 *
 * La connexion est le SEUL moment où le réseau est indispensable : la
 * plateforme centrale doit vérifier l'agent et lui remettre son stock de
 * passeports vierges. Passé ce cap, la session et le stock vivent sur
 * l'appareil et l'application devient entièrement autonome.
 *
 * Le tableau de bord est conçu pour être lu d'un coup d'œil, bras tendu, en
 * plein soleil : trois chiffres (stock, émis aujourd'hui, à synchroniser), une
 * action principale, et l'état de la file de synchronisation toujours visible.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  CloudOff,
  CloudUpload,
  FilePlus2,
  Languages,
  Loader2,
  LogOut,
  RefreshCw,
  Settings,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useI18n, type Langue } from '@/lib/i18n';
import {
  ecrireSession,
  lireMeta,
  lireSession,
  listerEmissions,
  listerPasseportsDisponibles,
  purgerDonneesLocales,
  type Emission,
  type EtatSynchro,
  type SessionAgent,
} from '@/lib/db';
import {
  connecter,
  demarrerRafraichissementStockAutomatique,
  demarrerSynchroAutomatique,
  deconnecter,
  diagnostiquerStock,
  ErreurAuthentification,
  ErreurAutorisation,
  ErreurReseau,
  rafraichirCachePasseports,
  reinitialiserCacheApplication,
  synchroniserTout,
  testerPlateforme,
  type CauseStock,
  type DiagnosticStock,
} from '@/lib/sync';
import { urlLogoActuel, useBranding } from '@/lib/branding';

const LOGO_PAR_DEFAUT =
  'https://mgx-backend-cdn.metadl.com/generate/images/510363/2026-08-18/uxxyicqcakba/logo-ppb-zebu-seal.png';
const ILLUSTRATION_SYNCHRO =
  'https://mgx-backend-cdn.metadl.com/generate/images/510363/2026-08-18/uxxyj2qcaj7a/empty-state-offline-sync-pending.png';
const ILLUSTRATION_STOCK_VIDE =
  'https://mgx-backend-cdn.metadl.com/generate/images/510363/2026-08-18/uxxyjmacaj7q/empty-state-blank-passport-booklet.png';

export default function Index() {
  const [session, setSession] = useState<SessionAgent | null>(() => lireSession());

  return session ? (
    <TableauDeBord session={session} onDeconnexion={() => setSession(null)} />
  ) : (
    <Connexion onConnecte={setSession} />
  );
}

/* ------------------------------------------------------------------ */
/* Indicateur réseau + réglages (partagés par les deux écrans)         */
/* ------------------------------------------------------------------ */

function useEnLigne(): boolean {
  const [enLigne, setEnLigne] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const majEnLigne = () => setEnLigne(navigator.onLine);
    window.addEventListener('online', majEnLigne);
    window.addEventListener('offline', majEnLigne);
    return () => {
      window.removeEventListener('online', majEnLigne);
      window.removeEventListener('offline', majEnLigne);
    };
  }, []);

  return enLigne;
}

function EtiquetteReseau() {
  const { t } = useI18n();
  const enLigne = useEnLigne();

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        enLigne
          ? 'bg-[hsl(var(--success))]/12 text-[hsl(var(--success))]'
          : 'bg-[hsl(var(--warning))]/14 text-[hsl(var(--warning))]',
      )}
    >
      {enLigne ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
      {t(enLigne ? 'reseau.en_ligne' : 'reseau.hors_ligne')}
    </span>
  );
}

function PanneauReglages() {
  const { t, langue, changerLangue, apiBaseUrl, definirApiBaseUrl } = useI18n();
  const [url, setUrl] = useState(apiBaseUrl);
  const [test, setTest] = useState<'inactif' | 'encours'>('inactif');

  // Le test doit porter sur l'adresse affichée, y compris si elle n'a pas encore
  // été enregistrée : sinon l'agent teste une valeur différente de celle qu'il
  // vient de corriger et le diagnostic devient trompeur.
  const lancerTest = useCallback(async () => {
    definirApiBaseUrl(url);
    setTest('encours');
    const resultat = await testerPlateforme();
    setTest('inactif');
    if (resultat.ok) {
      toast.success(t('reglages.test_ok'), { description: resultat.url });
    } else {
      toast.error(t('reglages.test_echec'), { description: resultat.detail });
    }
  }, [definirApiBaseUrl, t, url]);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="cible-tactile size-11" aria-label={t('reglages.titre')}>
          <Settings className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="zone-sure-bas max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>{t('reglages.titre')}</SheetTitle>
          <SheetDescription>{t('reseau.mode_terrain')}</SheetDescription>
        </SheetHeader>

        <div className="mt-5 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <Languages className="size-4" />
              {t('reglages.langue')}
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {(['fr', 'en'] as Langue[]).map((code) => (
                <Button
                  key={code}
                  type="button"
                  variant={langue === code ? 'default' : 'outline'}
                  onClick={() => changerLangue(code)}
                  className="cible-tactile"
                >
                  {code === 'fr' ? 'Français' : 'English'}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="api-url" className="text-sm font-medium">
              {t('reglages.api')}
            </Label>
            <Input
              id="api-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              className="cible-tactile"
            />
            <p className="text-xs text-muted-foreground">{t('reglages.api_aide')}</p>
            <Button
              type="button"
              variant="secondary"
              className="cible-tactile"
              onClick={() => {
                definirApiBaseUrl(url);
                toast.success(t('reglages.enregistres'));
              }}
            >
              {t('action.enregistrer')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="cible-tactile !bg-transparent"
              disabled={test === 'encours'}
              onClick={lancerTest}
            >
              {test === 'encours' ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t('reglages.test_encours')}
                </>
              ) : (
                <>
                  <Wifi className="mr-2 size-4" />
                  {t('reglages.tester')}
                </>
              )}
            </Button>
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">{t('reglages.vider_cache')}</Label>
            <p className="text-xs text-muted-foreground">{t('reglages.vider_cache_aide')}</p>
            <Button
              type="button"
              variant="outline"
              className="cible-tactile !bg-transparent"
              onClick={() => {
                void reinitialiserCacheApplication();
              }}
            >
              <RefreshCw className="mr-2 size-4" />
              {t('reglages.vider_cache')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Connexion                                                           */
/* ------------------------------------------------------------------ */

function Connexion({ onConnecte }: { onConnecte: (session: SessionAgent) => void }) {
  const { t } = useI18n();
  useBranding(); // re-rend ce composant dès que /branding répond, pour que urlLogoActuel() reflète le logo personnalisé
  const logo = urlLogoActuel() ?? LOGO_PAR_DEFAUT;
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const soumettre = useCallback(
    async (evenement: React.FormEvent) => {
      evenement.preventDefault();
      if (!email.trim() || !motDePasse) return;

      // Volontairement PAS de blocage précoce sur `!enLigne` ici : la
      // fonction `connecter` (lib/sync.ts) sait elle-même retomber sur une
      // reconnexion hors-ligne (empreinte de mot de passe vérifiée
      // localement + session déjà présente) — un blocage ici l'empêcherait
      // systématiquement de s'exécuter, même quand elle aurait réussi.
      setEnCours(true);
      setErreur(null);
      try {
        const session = await connecter(email.trim(), motDePasse);
        ecrireSession(session);
        // Premier remplissage du stock : c'est ce qui rend l'application
        // utilisable une fois le réseau perdu.
        try {
          const resultat = await rafraichirCachePasseports();
          toast.success(`${resultat.en_cache} ${t('tdb.stock').toLowerCase()}`);
        } catch (cause) {
          // Un refus de rôle doit être nommé : réessayer ne servirait à rien.
          toast.warning(
            cause instanceof ErreurAutorisation
              ? t('tdb.diag_role_invalide')
              : t('tdb.stock_vide_texte'),
          );
        }
        onConnecte(session);
      } catch (cause) {
        if (cause instanceof ErreurAuthentification) {
          setErreur(t('connexion.identifiants_invalides'));
        } else if (cause instanceof ErreurReseau) {
          setErreur(t('connexion.hors_ligne'));
        } else {
          setErreur(cause instanceof Error ? cause.message : t('connexion.echec_reseau'));
        }
      } finally {
        setEnCours(false);
      }
    },
    [email, motDePasse, t, onConnecte],
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="zone-sure-haut flex items-center justify-between gap-3 px-4 py-3">
        <EtiquetteReseau />
        <PanneauReglages />
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-7 px-5 pb-10">
        <div className="flex flex-col items-center gap-4 text-center">
          <img src={logo} alt="Logo PPB" className="size-24" loading="eager" />
          <div>
            <h1>{t('app.nom')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('app.sous_titre')}</p>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('app.organisme')}
            </p>
          </div>
        </div>

        <form onSubmit={soumettre} className="flex flex-col gap-4 rounded-lg border bg-card p-5">
          <div>
            <h2 className="text-lg font-semibold">{t('connexion.titre')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('connexion.intro')}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="text-sm font-medium">
              {t('connexion.email')}
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              className="cible-tactile"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mot-de-passe" className="text-sm font-medium">
              {t('connexion.mot_de_passe')}
            </Label>
            <Input
              id="mot-de-passe"
              type="password"
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              autoComplete="current-password"
              required
              className="cible-tactile"
            />
          </div>

          {erreur && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              {erreur}
            </p>
          )}

          <Button type="submit" disabled={enCours} className="cible-tactile w-full text-base">
            {enCours ? (
              <>
                <Loader2 className="mr-2 size-5 animate-spin" />
                {t('connexion.en_cours')}
              </>
            ) : (
              t('connexion.valider')
            )}
          </Button>
        </form>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tableau de bord                                                     */
/* ------------------------------------------------------------------ */

function TableauDeBord({
  session,
  onDeconnexion,
}: {
  session: SessionAgent;
  onDeconnexion: () => void;
}) {
  const { t, langue } = useI18n();
  const naviguer = useNavigate();
  const enLigne = useEnLigne();
  useBranding(); // re-rend ce composant dès que /branding répond, pour que urlLogoActuel() reflète le logo personnalisé
  const logo = urlLogoActuel() ?? LOGO_PAR_DEFAUT;

  const [stock, setStock] = useState(0);
  const [emissions, setEmissions] = useState<Emission[]>([]);
  const [derniereSynchro, setDerniereSynchro] = useState<string | null>(null);
  const [synchroEnCours, setSynchroEnCours] = useState(false);
  const [stockEnCours, setStockEnCours] = useState(false);

  const recharger = useCallback(async () => {
    const [disponibles, liste, horodatage] = await Promise.all([
      listerPasseportsDisponibles(),
      listerEmissions(),
      lireMeta<string>('derniere_synchro_emissions'),
    ]);
    setStock(disponibles.length);
    setEmissions(liste);
    setDerniereSynchro(horodatage ?? null);
  }, []);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  // Synchronisation automatique : rien à demander à l'agent, la file se vide
  // dès qu'un réseau apparaît.
  useEffect(() => {
    const arreter = demarrerSynchroAutomatique((resultat) => {
      if (resultat.authentification_perdue) {
        toast.error(t('connexion.session_expiree'));
      } else if (resultat.reussies > 0) {
        toast.success(t('tdb.synchro_terminee'));
      }
      void recharger();
    });
    return arreter;
  }, [recharger, t]);

  // Rafraîchissement automatique du stock : même principe, dès qu'un réseau
  // apparaît puis à intervalle régulier. Silencieux en arrière-plan (pas de
  // toast à chaque passage) — seul l'échec par perte de session est signalé,
  // exactement comme pour la synchronisation des émissions.
  useEffect(() => {
    const arreter = demarrerRafraichissementStockAutomatique((resultat) => {
      if (resultat.authentification_perdue) {
        toast.error(t('connexion.session_expiree'));
        return;
      }
      void recharger();
    });
    return arreter;
  }, [recharger, t]);

  const synchroniser = useCallback(async () => {
    setSynchroEnCours(true);
    try {
      const resultat = await synchroniserTout();
      if (resultat.hors_ligne) {
        toast.info(t('tdb.synchro_hors_ligne'));
      } else if (resultat.authentification_perdue) {
        toast.error(t('connexion.session_expiree'));
      } else if (resultat.reussies > 0) {
        toast.success(t('tdb.synchro_terminee'));
      }
      await recharger();
    } finally {
      setSynchroEnCours(false);
    }
  }, [recharger, t]);

  const [diagnostic, setDiagnostic] = useState<DiagnosticStock | null>(null);
  const [diagEnCours, setDiagEnCours] = useState(false);

  const libelleDiagnostic = useCallback(
    (cause: CauseStock): string => {
      switch (cause) {
        case 'role_invalide':
          return t('tdb.diag_role_invalide');
        case 'aucun_passeport':
          return t('tdb.diag_aucun_passeport');
        case 'aucun_vierge':
          return t('tdb.diag_aucun_vierge');
        case 'ok':
          return t('tdb.diag_ok');
        default:
          return t('tdb.diag_indisponible');
      }
    },
    [t],
  );

  /** Interroge la plateforme pour nommer la cause exacte d'un stock vide. */
  const lancerDiagnostic = useCallback(async () => {
    setDiagEnCours(true);
    try {
      setDiagnostic(await diagnostiquerStock());
    } catch (cause) {
      // L'ordre compte : ErreurAutorisation dérive d'ErreurAuthentification.
      if (cause instanceof ErreurAutorisation) {
        setDiagnostic({ cause: 'role_invalide', total: 0, par_statut: [], vierges: 0 });
      } else if (cause instanceof ErreurAuthentification) {
        toast.error(t('connexion.session_expiree'));
      } else if (cause instanceof ErreurReseau) {
        toast.error(t('connexion.echec_reseau'));
      } else {
        setDiagnostic({ cause: 'indisponible', total: 0, par_statut: [], vierges: 0 });
      }
    } finally {
      setDiagEnCours(false);
    }
  }, [t]);

  const majStock = useCallback(async () => {
    setStockEnCours(true);
    try {
      const resultat = await rafraichirCachePasseports();
      await recharger();
      if (resultat.conserve) {
        // Le stock hors connexion a été préservé : on explique pourquoi la
        // plateforme n'a rien renvoyé au lieu de laisser croire à une perte.
        toast.warning(t('tdb.stock_conserve'));
        await lancerDiagnostic();
      } else {
        toast.success(t('tdb.stock_mis_a_jour'));
        if (resultat.recus === 0) await lancerDiagnostic();
      }
    } catch (cause) {
      if (cause instanceof ErreurAutorisation) {
        toast.error(t('tdb.diag_role_invalide'));
        setDiagnostic({ cause: 'role_invalide', total: 0, par_statut: [], vierges: 0 });
      } else {
        toast.error(
          cause instanceof ErreurReseau ? t('connexion.echec_reseau') : t('tdb.stock_vide_texte'),
        );
      }
    } finally {
      setStockEnCours(false);
    }
  }, [recharger, t, lancerDiagnostic]);

  const seDeconnecter = useCallback(async () => {
    
    deconnecter();
    onDeconnexion();
  }, [onDeconnexion]);

  const enAttente = useMemo(
    () => emissions.filter((emission) => emission.etat_synchro !== 'synchronisee'),
    [emissions],
  );

  const emisAujourdhui = useMemo(() => {
    const aujourdhui = new Date().toDateString();
    return emissions.filter((emission) => new Date(emission.cree_le).toDateString() === aujourdhui)
      .length;
  }, [emissions]);

  const formaterDate = useCallback(
    (iso: string) =>
      new Date(iso).toLocaleString(langue === 'fr' ? 'fr-FR' : 'en-GB', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [langue],
  );

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="zone-sure-haut sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <img src={logo} alt="" className="size-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{session.poste ?? t('tdb.bonjour')}</p>
            <p className="truncate text-xs text-muted-foreground">{session.email}</p>
          </div>
          <EtiquetteReseau />
          <PanneauReglages />
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-5">
        <div className="grid grid-cols-3 gap-3">
          <Indicateur libelle={t('tdb.stock')} valeur={stock} />
          <Indicateur libelle={t('tdb.emis_jour')} valeur={emisAujourdhui} />
          <Indicateur
            libelle={t('tdb.en_attente')}
            valeur={enAttente.length}
            alerte={enAttente.length > 0}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            disabled={stock === 0}
            onClick={() => naviguer('/emission')}
            className="cible-tactile h-14 w-full text-base"
          >
            <FilePlus2 className="mr-2 size-5" />
            {t('tdb.nouvelle_emission')}
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={stockEnCours || !enLigne}
              onClick={() => void majStock()}
              className="cible-tactile"
            >
              {stockEnCours ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              {t('tdb.rafraichir_stock')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={synchroEnCours || enAttente.length === 0}
              onClick={() => void synchroniser()}
              className="cible-tactile"
            >
              {synchroEnCours ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : enLigne ? (
                <CloudUpload className="mr-2 size-4" />
              ) : (
                <CloudOff className="mr-2 size-4" />
              )}
              {synchroEnCours ? t('tdb.synchro_en_cours') : t('tdb.synchroniser')}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            {t('tdb.derniere_synchro')} :{' '}
            <span className="chiffres">
              {derniereSynchro ? formaterDate(derniereSynchro) : t('tdb.jamais')}
            </span>
          </p>
        </div>

        {stock === 0 && (
          <section className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-card p-6 text-center">
            <img src={ILLUSTRATION_STOCK_VIDE} alt="" className="w-40" loading="lazy" />
            <h3>{t('tdb.stock_vide_titre')}</h3>
            <p className="text-sm text-muted-foreground">{t('tdb.stock_vide_texte')}</p>

            <Button
              type="button"
              variant="outline"
              disabled={diagEnCours || !enLigne}
              onClick={() => void lancerDiagnostic()}
              className="cible-tactile w-full"
            >
              {diagEnCours && <Loader2 className="mr-2 size-4 animate-spin" />}
              {diagEnCours ? t('tdb.diagnostic_en_cours') : t('tdb.diagnostic_stock')}
            </Button>

            {diagnostic && (
              <div className="w-full rounded-md border bg-background p-3 text-left">
                <p className="text-sm font-semibold">{t('tdb.diagnostic_titre')}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {libelleDiagnostic(diagnostic.cause)}
                </p>
                {diagnostic.par_statut.length > 0 && (
                  <>
                    <Separator className="my-2" />
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      {t('tdb.diag_repartition')}
                    </p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {diagnostic.par_statut.map((ligne) => (
                        <li
                          key={ligne.statut}
                          className="flex items-center justify-between gap-3 text-sm"
                        >
                          <span className="truncate">{ligne.statut}</span>
                          <span className="chiffres">{ligne.nombre}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {enAttente.length > 0 && (
          <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <div className="flex items-center gap-3">
              <img src={ILLUSTRATION_SYNCHRO} alt="" className="size-14 shrink-0" loading="lazy" />
              <div className="min-w-0">
                <h3>{t('tdb.file_synchro')}</h3>
                <p className="chiffres text-sm text-muted-foreground">
                  {enAttente.length} · {t('tdb.en_attente')}
                </p>
              </div>
            </div>
            <Separator />
            <ul className="flex flex-col gap-2">
              {enAttente.slice(0, 5).map((emission) => (
                <li key={emission.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="chiffres truncate text-sm font-medium">{emission.numero}</span>
                    <PastilleSynchro etat={emission.etat_synchro} />
                  </div>
                  {/* Le motif exact du refus serveur : sans lui, « Échec — sera
                      réessayé » se répète indéfiniment sans que personne ne
                      puisse agir sur la cause. */}
                  {emission.derniere_erreur && (
                    <p className="break-words text-xs text-destructive">
                      {emission.derniere_erreur}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('tdb.historique')}</h2>
          {emissions.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              {t('tdb.historique_vide')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border bg-card">
              {emissions.map((emission) => (
                <li key={emission.id}>
                  {/* Chaque ligne ouvre la fiche détaillée : c'est le point
                      d'entrée de la consultation des données enregistrées, qui
                      n'existait pas — l'historique n'affichait qu'un numéro. */}
                  <button
                    type="button"
                    onClick={() => naviguer(`/emission/${emission.id}`)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:md:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <div className="min-w-0">
                      <p className="chiffres truncate text-sm font-semibold">{emission.numero}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {emission.page3.eleveur.nom_prenom || '—'} · {formaterDate(emission.cree_le)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <PastilleSynchro etat={emission.etat_synchro} />
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Button
          type="button"
          variant="ghost"
          onClick={() => void seDeconnecter()}
          className="cible-tactile mt-2 w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="mr-2 size-4" />
          {t('connexion.deconnexion')}
        </Button>
      </main>
    </div>
  );
}

function Indicateur({
  libelle,
  valeur,
  alerte,
}: {
  libelle: string;
  valeur: number;
  alerte?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border bg-card p-3',
        alerte && 'border-[hsl(var(--warning))]/45 bg-[hsl(var(--warning))]/8',
      )}
    >
      <span className="chiffres text-2xl font-bold leading-none">{valeur}</span>
      <span className="text-xs leading-snug text-muted-foreground">{libelle}</span>
    </div>
  );
}

function PastilleSynchro({ etat }: { etat: EtatSynchro }) {
  const { t } = useI18n();
  const styles: Record<EtatSynchro, string> = {
    en_attente: 'bg-[hsl(var(--warning))]/14 text-[hsl(var(--warning))]',
    en_cours: 'bg-[hsl(var(--info))]/12 text-[hsl(var(--info))]',
    synchronisee: 'bg-[hsl(var(--success))]/12 text-[hsl(var(--success))]',
    erreur: 'bg-destructive/12 text-destructive',
  };

  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
        styles[etat],
      )}
    >
      {t(`statut.${etat}`)}
    </span>
  );
}
/**
 * Assistant d'émission — le parcours métier complet, entièrement hors connexion.
 *
 * Le passeport papier a 4 pages, mais seules les pages 3 et 4 portent des
 * données manuscrites : la page 1 est une vérification visuelle du document,
 * la page 2 la sélection du passeport par son QR Code. C'est exactement le
 * découpage attendu par le serveur (`POST .../pages/{1..4}`), donc l'assistant
 * suit ces 4 étapes plus un récapitulatif.
 *
 * Aucune étape ne dépend du réseau. À la validation, l'émission est écrite
 * dans IndexedDB et le passeport quitte immédiatement le stock disponible :
 * l'agent peut rendre le document au convoyeur sans attendre quoi que ce soit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Camera,
  CheckCircle2,
  Loader2,
  MapPin,
  QrCode,
  ScanLine,
  ShieldAlert,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import Capture from '@/components/Capture';
import {
  FormulairePage3,
  FormulairePage4,
  LegendeConfiance,
  validerPage3,
  validerPage4,
  type ErreursPage3,
} from '@/components/PageForms';
import {
  emissionParPasseport,
  enregistrerEmission,
  identifiantLocal,
  listerPasseportsDisponibles,
  lireSession,
  page3Vide,
  page4Vide,
  PAYS_CEMAC,
  type DonneesPage3,
  type DonneesPage4,
  type Emission as EmissionLocale,
  type PasseportCache,
  type PositionGps,
} from '@/lib/db';
import { ErreurOcr, lirePage3, lirePage4, prechaufferOcr, type CarteConfiance } from '@/lib/ocr';

type Etape = 1 | 2 | 3 | 4 | 5;

type EtatVerification =
  | { type: 'aucune' }
  | { type: 'authentique'; passeport: PasseportCache }
  | { type: 'inconnu' }
  | { type: 'deja_emis' };

const IMAGE_PASSEPORT_VIERGE =
  'https://mgx-backend-cdn.metadl.com/generate/images/510363/2026-08-18/uxxyjmacaj7q/empty-state-blank-passport-booklet.png';

export default function Emission() {
  const { t } = useI18n();
  const naviguer = useNavigate();
  const session = useMemo(() => lireSession(), []);

  const [etape, setEtape] = useState<Etape>(1);
  const [conforme, setConforme] = useState(false);

  const [disponibles, setDisponibles] = useState<PasseportCache[]>([]);
  const [numeroSaisi, setNumeroSaisi] = useState('');
  const [verification, setVerification] = useState<EtatVerification>({ type: 'aucune' });
  const [passeport, setPasseport] = useState<PasseportCache | null>(null);

  const [modeCapture, setModeCapture] = useState<'qr' | 'page3' | 'page4' | null>(null);
  const [ocrEnCours, setOcrEnCours] = useState(false);

  const [page3, setPage3] = useState<DonneesPage3>(() => page3Vide(session?.pays_id ?? null));
  const [page4, setPage4] = useState<DonneesPage4>(() => page4Vide());
  const [confiances3, setConfiances3] = useState<CarteConfiance>({});
  const [confiances4, setConfiances4] = useState<CarteConfiance>({});
  const [erreurs3, setErreurs3] = useState<ErreursPage3>({});
  const [photo3, setPhoto3] = useState<Blob | undefined>();
  const [photo4, setPhoto4] = useState<Blob | undefined>();
  const [page3Scannee, setPage3Scannee] = useState(false);
  const [page4Scannee, setPage4Scannee] = useState(false);



  /**
   * Compte rendu de la dernière lecture, affiché À L'ÉCRAN et non en simple
   * notification éphémère. Sur le terrain, « l'OCR ne fait rien » recouvre
   * trois situations très différentes — moteur en panne, photo illisible, ou
   * photo lue mais gabarit non reconnu — que seule cette distinction permet de
   * trancher sans console de navigateur.
   */
  const [rapportOcr, setRapportOcr] = useState<{
    ton: 'succes' | 'alerte' | 'echec';
    message: string;
    mots?: number;
    extrait?: string;
  } | null>(null);

  const [gps, setGps] = useState<PositionGps | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const ocrPrechauffe = useRef(false);

  useEffect(() => {
    if (!session) {
      naviguer('/', { replace: true });
      return;
    }
    void listerPasseportsDisponibles().then(setDisponibles);

    // Le WASM pèse plusieurs mégaoctets : on le charge pendant que l'agent lit
    // la liste de contrôle, plutôt qu'après la photo où l'attente serait subie.
    if (!ocrPrechauffe.current) {
      ocrPrechauffe.current = true;
      void prechaufferOcr();
    }

    // Position enregistrée au début de l'acte d'émission — l'agent est alors au
    // poste vétérinaire, ce qui est bien le lieu à tracer.
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          setGps({
            latitude: Number(position.coords.latitude.toFixed(6)),
            longitude: Number(position.coords.longitude.toFixed(6)),
            precision_m: Math.round(position.coords.accuracy),
          }),
        () => setGps(null),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 120_000 },
      );
    }
  }, [session, naviguer]);

  /* ---------------- Étape 2 : vérification du passeport ---------------- */

  const verifierPasseport = useCallback(
    async (valeur: string) => {
      const recherche = valeur.trim().toUpperCase();
      if (!recherche) return;

      // Le QR Code peut porter l'UUID seul, une URL le contenant, ou le numéro.
      const trouve = disponibles.find(
        (candidat) =>
          candidat.numero.toUpperCase() === recherche ||
          candidat.qr_uuid.toUpperCase() === recherche ||
          recherche.includes(candidat.qr_uuid.toUpperCase()) ||
          recherche.includes(candidat.numero.toUpperCase()),
      );

      if (trouve) {
        setPasseport(trouve);
        setVerification({ type: 'authentique', passeport: trouve });
        return;
      }

      // Distinguer « inconnu » (fraude possible) de « déjà émis ici » évite
      // d'alarmer l'agent pour un simple doublon local.
      const cachePlein = await listerPasseportsDisponibles();
      const dejaEmis = cachePlein.length !== disponibles.length;
      const parPasseport = await emissionParPasseport(recherche);
      setPasseport(null);
      setVerification(parPasseport || dejaEmis ? { type: 'deja_emis' } : { type: 'inconnu' });
    },
    [disponibles],
  );

  /* ---------------- Étapes 3 et 4 : scan et OCR ---------------- */

  const traiterPhotoPage3 = useCallback(
    async (photo: Blob) => {
      setModeCapture(null);
      setPhoto3(photo);
      setOcrEnCours(true);
      try {
        const resultat = await lirePage3(photo, session?.pays_id ?? null);
        // Les valeurs lues remplacent le formulaire, mais un champ non reconnu
        // ne doit jamais écraser une saisie déjà faite par l'agent.
        setPage3((precedent) => fusionnerPage3(precedent, resultat.donnees));
        setConfiances3(resultat.confiances);
        setPage3Scannee(true);
        if (resultat.nombreChampsLus === 0) {
          setRapportOcr({
            ton: 'alerte',
            message: t('etape.ocr_aucun'),
            mots: resultat.nombreMots,
            extrait: resultat.texteBrut,
          });
          toast.warning(t('etape.ocr_aucun'));
        } else {
          setRapportOcr({
            ton: 'succes',
            message: `${resultat.nombreChampsLus} ${t('etape.ocr_reussi')}`,
            mots: resultat.nombreMots,
          });
          toast.success(`${resultat.nombreChampsLus} ${t('etape.ocr_reussi')}`);
        }
      } catch (cause) {
        setPage3Scannee(true);
        // Un échec du moteur porte une cause exploitable (asset manquant, délai
        // dépassé) : la masquer derrière un message générique reviendrait à
        // reproduire le symptôme « ça ne fait rien » signalé par l'agent.
        const message = cause instanceof ErreurOcr ? cause.message : t('etape.ocr_echec');
        setRapportOcr({ ton: 'echec', message });
        toast.error(message);
      } finally {
        setOcrEnCours(false);
      }
    },
    [session, t],
  );

  const traiterPhotoPage4 = useCallback(
    async (photo: Blob) => {
      setModeCapture(null);
      setPhoto4(photo);
      setOcrEnCours(true);
      try {
        const resultat = await lirePage4(photo);
        setPage4((precedent) => fusionnerPage4(precedent, resultat.donnees));
        setConfiances4(resultat.confiances);
        setPage4Scannee(true);
        if (resultat.nombreChampsLus === 0) {
          setRapportOcr({
            ton: 'alerte',
            message: t('etape.ocr_aucun'),
            mots: resultat.nombreMots,
            extrait: resultat.texteBrut,
          });
          toast.warning(t('etape.ocr_aucun'));
        } else {
          setRapportOcr({
            ton: 'succes',
            message: `${resultat.nombreChampsLus} ${t('etape.ocr_reussi')}`,
            mots: resultat.nombreMots,
          });
          toast.success(`${resultat.nombreChampsLus} ${t('etape.ocr_reussi')}`);
        }
      } catch (cause) {
        setPage4Scannee(true);
        const message = cause instanceof ErreurOcr ? cause.message : t('etape.ocr_echec');
        setRapportOcr({ ton: 'echec', message });
        toast.error(message);
      } finally {
        setOcrEnCours(false);
      }
    },
    [t],
  );

  /* ---------------- Étape 5 : enregistrement local ---------------- */

  const validerEmission = useCallback(async () => {
    if (!passeport || !session) return;
    setEnregistrement(true);
    try {
      const emission: EmissionLocale = {
        id: identifiantLocal(),
        passeport_id: passeport.id,
        qr_uuid: passeport.qr_uuid,
        numero: passeport.numero,
        page3,
        page4,
        photo_page3: photo3,
        photo_page4: photo4,
        gps,
        cree_le: new Date().toISOString(),
        agent_email: session.email,
        etat_synchro: 'en_attente',
        pages_envoyees: [],
        photos_envoyees: [],
        tentatives: 0,
        derniere_erreur: null,
        statut_serveur: null,
      };
      await enregistrerEmission(emission);
      toast.success(t('recap.enregistree'));
      naviguer('/', { replace: true });
    } finally {
      setEnregistrement(false);
    }
  }, [passeport, session, page3, page4, photo3, photo4, gps, t, naviguer]);

  const passerEtape3 = useCallback(() => {
    const erreurs = validerPage3(page3);
    setErreurs3(erreurs);
    if (Object.keys(erreurs).length > 0) {
      toast.error(t('validation.champs_manquants'));
      return;
    }
    setEtape(4);
  }, [page3, t]);

  const passerEtape4 = useCallback(() => {
    if (!validerPage4(page4)) {
      toast.error(t('validation.troupeau_vide'));
      return;
    }
    setEtape(5);
  }, [page4, t]);

  const titreEtape: Record<Etape, string> = {
    1: t('etape1.titre'),
    2: t('etape2.titre'),
    3: t('etape3.titre'),
    4: t('etape4.titre'),
    5: t('recap.titre'),
  };

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="zone-sure-haut sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="cible-tactile size-11 shrink-0"
            onClick={() => (etape === 1 ? naviguer('/') : setEtape((e) => (e - 1) as Etape))}
            aria-label={t('action.retour')}
          >
            <ArrowLeft className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('emission.etape')} {etape} {t('emission.sur')} 5
            </p>
            <h1 className="truncate text-base font-semibold">{titreEtape[etape]}</h1>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="cible-tactile size-11 shrink-0"
            onClick={() => naviguer('/')}
            aria-label={t('emission.quitter')}
          >
            <X className="size-5" />
          </Button>
        </div>
        <Progress value={(etape / 5) * 100} className="h-1 rounded-none" />
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-5">
        {passeport && etape > 2 && (
          <div className="flex items-center gap-2 rounded-md border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/8 px-3 py-2">
            <BadgeCheck className="size-4 shrink-0 text-[hsl(var(--success))]" />
            <span className="chiffres truncate text-sm font-semibold text-[hsl(var(--success))]">
              {passeport.numero}
            </span>
          </div>
        )}

        {etape === 1 && (
          <section className="flex flex-col gap-5">
            <img
              src={IMAGE_PASSEPORT_VIERGE}
              alt="Passeport pour Bétail vierge, ouvert à plat avec un stylo posé à côté"
              className="mx-auto w-full max-w-xs"
              loading="eager"
            />
            <p className="text-sm leading-relaxed text-muted-foreground">{t('etape1.intro')}</p>
            <ul className="flex flex-col gap-3 rounded-lg border bg-card p-4">
              {['etape1.point1', 'etape1.point2', 'etape1.point3'].map((cle) => (
                <li key={cle} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  {t(cle)}
                </li>
              ))}
            </ul>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border bg-card p-4">
              <Checkbox
                checked={conforme}
                onCheckedChange={(valeur) => setConforme(valeur === true)}
                className="size-6"
              />
              <span className="text-sm font-medium">{t('etape1.confirmer')}</span>
            </label>
          </section>
        )}

        {etape === 2 && (
          <section className="flex flex-col gap-5">
            <p className="text-sm leading-relaxed text-muted-foreground">{t('etape2.intro')}</p>

            <Button
              type="button"
              onClick={() => setModeCapture('qr')}
              className="cible-tactile h-14 w-full text-base"
            >
              <QrCode className="mr-2 size-5" />
              {t('action.scanner')}
            </Button>

            <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
              <Label htmlFor="numero-passeport" className="text-sm font-medium">
                {t('etape2.numero')}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="numero-passeport"
                  value={numeroSaisi}
                  onChange={(e) => setNumeroSaisi(e.target.value.toUpperCase())}
                  placeholder="01-2027-0000001"
                  className="chiffres cible-tactile"
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="cible-tactile shrink-0"
                  onClick={() => void verifierPasseport(numeroSaisi)}
                >
                  {t('etape2.rechercher')}
                </Button>
              </div>
              <p className="chiffres text-xs text-muted-foreground">
                {disponibles.length} {t('tdb.stock').toLowerCase()}
              </p>
            </div>

            {verification.type === 'authentique' && (
              <div className="flex items-start gap-2.5 rounded-lg border border-[hsl(var(--success))]/35 bg-[hsl(var(--success))]/8 p-4">
                <BadgeCheck className="mt-0.5 size-5 shrink-0 text-[hsl(var(--success))]" />
                <div className="min-w-0">
                  <p className="chiffres text-sm font-semibold">{verification.passeport.numero}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{t('etape2.authentique')}</p>
                </div>
              </div>
            )}

            {(verification.type === 'inconnu' || verification.type === 'deja_emis') && (
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/8 p-4">
                <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
                <p className="text-sm text-destructive">
                  {t(verification.type === 'inconnu' ? 'etape2.inconnu' : 'etape2.deja_emis')}
                </p>
              </div>
            )}

            {disponibles.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {disponibles.slice(0, 6).map((candidat) => (
                  <button
                    key={candidat.id}
                    type="button"
                    onClick={() => {
                      setNumeroSaisi(candidat.numero);
                      setPasseport(candidat);
                      setVerification({ type: 'authentique', passeport: candidat });
                    }}
                    className={cn(
                      'cible-tactile flex items-center justify-between rounded-md border bg-card px-3 text-left transition-colors',
                      'hover:md:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      passeport?.id === candidat.id && 'border-primary bg-accent',
                    )}
                  >
                    <span className="chiffres text-sm font-medium">{candidat.numero}</span>
                    {passeport?.id === candidat.id && <CheckCircle2 className="size-4 text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {rapportOcr && (etape === 3 || etape === 4) && (
          <div
            className={cn(
              'flex flex-col gap-1.5 rounded-md border px-3 py-2.5',
              rapportOcr.ton === 'succes' &&
                'border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/8',
              rapportOcr.ton === 'alerte' &&
                'border-[hsl(var(--warning))]/35 bg-[hsl(var(--warning))]/10',
              rapportOcr.ton === 'echec' && 'border-destructive/35 bg-destructive/8',
            )}
          >
            <p className="text-sm font-medium">{rapportOcr.message}</p>
            {typeof rapportOcr.mots === 'number' && (
              <p className="chiffres text-xs text-muted-foreground">
                {rapportOcr.mots} {t('etape.ocr_mots_lus')}
              </p>
            )}
            {rapportOcr.extrait && (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('etape.ocr_extrait')}
                </p>
                <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {rapportOcr.extrait}
                </p>
              </>
            )}
          </div>
        )}

        {etape === 3 && (
          <section className="flex flex-col gap-5">
            {!page3Scannee ? (
              <EcranScan
                onScanner={() => setModeCapture('page3')}
                onIgnorer={() => setPage3Scannee(true)}
                enCours={ocrEnCours}
              />
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <LegendeConfiance />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="cible-tactile w-full"
                  onClick={() => setModeCapture('page3')}
                >
                  <ScanLine className="mr-2 size-5" />
                  {t('action.rescanner')}
                </Button>

                <FormulairePage3
                  donnees={page3}
                  confiances={confiances3}
                  erreurs={erreurs3}
                  onChange={setPage3}
                  onChampCorrige={(chemin) => {
                    setConfiances3((precedent) => {
                      if (!precedent[chemin]) return precedent;
                      const copie = { ...precedent };
                      delete copie[chemin];
                      return copie;
                    });
                    setErreurs3((precedent) => {
                      if (!precedent[chemin]) return precedent;
                      const copie = { ...precedent };
                      delete copie[chemin];
                      return copie;
                    });
                  }}
                />
              </>
            )}
          </section>
        )}

        {etape === 4 && (
          <section className="flex flex-col gap-5">
            {!page4Scannee ? (
              <EcranScan
                onScanner={() => setModeCapture('page4')}
                onIgnorer={() => setPage4Scannee(true)}
                enCours={ocrEnCours}
              />
            ) : (
              <>
                <LegendeConfiance />
                <Button
                  type="button"
                  variant="outline"
                  className="cible-tactile w-full"
                  onClick={() => setModeCapture('page4')}
                >
                  <ScanLine className="mr-2 size-5" />
                  {t('action.rescanner')}
                </Button>

                <FormulairePage4
                  donnees={page4}
                  confiances={confiances4}
                  onChange={setPage4}
                  onChampCorrige={(chemin) =>
                    setConfiances4((precedent) => {
                      if (!precedent[chemin]) return precedent;
                      const copie = { ...precedent };
                      delete copie[chemin];
                      return copie;
                    })
                  }
                />
              </>
            )}
          </section>
        )}

        {etape === 5 && passeport && (
          <Recapitulatif
            passeport={passeport}
            page3={page3}
            page4={page4}
            gps={gps}
            nombrePhotos={[photo3, photo4].filter(Boolean).length}
          />
        )}
      </main>

      <footer className="zone-sure-bas fixed inset-x-0 bottom-0 border-t bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-3 px-4 pt-3">
          {etape === 1 && (
            <Button
              type="button"
              disabled={!conforme}
              onClick={() => setEtape(2)}
              className="cible-tactile w-full text-base"
            >
              {t('action.continuer')}
              <ArrowRight className="ml-2 size-5" />
            </Button>
          )}
          {etape === 2 && (
            <Button
              type="button"
              disabled={!passeport}
              onClick={() => setEtape(3)}
              className="cible-tactile w-full text-base"
            >
              {t('action.continuer')}
              <ArrowRight className="ml-2 size-5" />
            </Button>
          )}
          {etape === 3 && (
            <Button
              type="button"
              disabled={!page3Scannee || ocrEnCours}
              onClick={passerEtape3}
              className="cible-tactile w-full text-base"
            >
              {t('action.continuer')}
              <ArrowRight className="ml-2 size-5" />
            </Button>
          )}
          {etape === 4 && (
            <Button
              type="button"
              disabled={!page4Scannee || ocrEnCours}
              onClick={passerEtape4}
              className="cible-tactile w-full text-base"
            >
              {t('action.continuer')}
              <ArrowRight className="ml-2 size-5" />
            </Button>
          )}
          {etape === 5 && (
            <Button
              type="button"
              disabled={enregistrement}
              onClick={() => void validerEmission()}
              className="cible-tactile w-full text-base"
            >
              {enregistrement ? (
                <>
                  <Loader2 className="mr-2 size-5 animate-spin" />
                  {t('recap.enregistrement')}
                </>
              ) : (
                <>
                  <BadgeCheck className="mr-2 size-5" />
                  {t('recap.valider')}
                </>
              )}
            </Button>
          )}
        </div>
      </footer>

      {ocrEnCours && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-background/92 px-8 text-center">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-base font-medium">{t('etape.ocr_en_cours')}</p>
          <p className="text-sm text-muted-foreground">{t('reseau.mode_terrain')}</p>
        </div>
      )}

      {modeCapture === 'qr' && (
        <Capture
          mode="qr"
          onQrDetecte={(contenu) => {
            setModeCapture(null);
            void verifierPasseport(contenu);
          }}
          onFermer={() => setModeCapture(null)}
        />
      )}
      {modeCapture === 'page3' && (
        <Capture
          mode="page"
          onPhoto={(photo) => void traiterPhotoPage3(photo)}
          onFermer={() => setModeCapture(null)}
        />
      )}
      {modeCapture === 'page4' && (
        <Capture
          mode="page"
          onPhoto={(photo) => void traiterPhotoPage4(photo)}
          onFermer={() => setModeCapture(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sous-composants                                                     */
/* ------------------------------------------------------------------ */

function EcranScan({
  onScanner,
  onIgnorer,
  enCours,
}: {
  onScanner: () => void;
  onIgnorer: () => void;
  enCours: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{t('etape.scan_intro')}</p>
      <Button type="button" onClick={onScanner} disabled={enCours} className="cible-tactile h-14 w-full text-base">
        <Camera className="mr-2 size-5" />
        {t('action.scanner')}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={onIgnorer}
        disabled={enCours}
        className="cible-tactile w-full"
      >
        {t('action.ignorer_scan')}
      </Button>
    </div>
  );
}

function Recapitulatif({
  passeport,
  page3,
  page4,
  gps,
  nombrePhotos,
}: {
  passeport: PasseportCache;
  page3: DonneesPage3;
  page4: DonneesPage4;
  gps: PositionGps | null;
  nombrePhotos: number;
}) {
  const { t } = useI18n();
  const total = page4.especes.reduce((somme, effectif) => somme + effectif.nombre_total, 0);
  const nomPays = (id: number) => PAYS_CEMAC.find((pays) => pays.id === id)?.nom ?? '—';
  const vaccinations = page4.vaccinations.filter((v) => v.date_vaccination);

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{t('recap.intro')}</p>

      <dl className="flex flex-col divide-y rounded-lg border bg-card">
        <LigneRecap libelle={t('recap.passeport')} valeur={passeport.numero} chiffres />
        <LigneRecap libelle={t('p3.eleveur')} valeur={page3.eleveur.nom_prenom || '—'} />
        <LigneRecap libelle={t('p3.convoyeur')} valeur={page3.convoyeur.nom_prenom || '—'} />
        <LigneRecap
          libelle={t('p3.pays_origine')}
          valeur={`${nomPays(page3.itineraire.pays_origine_id)} · ${page3.itineraire.province_origine || '—'}`}
        />
        <LigneRecap
          libelle={t('p3.pays_destination')}
          valeur={`${nomPays(page3.itineraire.pays_destination_id)} · ${page3.itineraire.province_destination || '—'}`}
        />
        <LigneRecap libelle={t('p4.total_general')} valeur={String(total)} chiffres />
        <LigneRecap
          libelle={t('p4.vaccinations')}
          valeur={
            vaccinations.length > 0
              ? vaccinations.map((v) => t(`maladie.${v.maladie}`)).join(', ')
              : '—'
          }
        />
        <LigneRecap libelle={t('recap.photos')} valeur={String(nombrePhotos)} chiffres />
        <LigneRecap
          libelle={t('recap.position')}
          valeur={
            gps
              ? `${gps.latitude}, ${gps.longitude} (±${gps.precision_m} m)`
              : t('recap.position_absente')
          }
          chiffres={Boolean(gps)}
          icone={<MapPin className="size-4 text-muted-foreground" />}
        />
      </dl>
    </section>
  );
}

function LigneRecap({
  libelle,
  valeur,
  chiffres,
  icone,
}: {
  libelle: string;
  valeur: string;
  chiffres?: boolean;
  icone?: JSX.Element;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {icone}
        {libelle}
      </dt>
      <dd className={cn('text-right text-sm font-medium', chiffres && 'chiffres')}>{valeur}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fusion OCR / saisie                                                 */
/* ------------------------------------------------------------------ */

/**
 * Un champ non reconnu par l'OCR arrive vide. L'écraser ferait perdre une
 * correction déjà saisie par l'agent avant un second scan : on ne remplace donc
 * que ce que l'OCR a réellement lu.
 */
function fusionnerPage3(actuel: DonneesPage3, lu: DonneesPage3): DonneesPage3 {
  const fusionnerPersonne = (a: DonneesPage3['eleveur'], b: DonneesPage3['eleveur']) => ({
    ...a,
    nom_prenom: b.nom_prenom || a.nom_prenom,
    numero_cni: b.numero_cni || a.numero_cni,
    telephone: b.telephone || a.telephone,
  });

  return {
    eleveur: fusionnerPersonne(actuel.eleveur, lu.eleveur),
    convoyeur: fusionnerPersonne(actuel.convoyeur, lu.convoyeur),
    itineraire: {
      ...actuel.itineraire,
      province_origine: lu.itineraire.province_origine || actuel.itineraire.province_origine,
      localite_origine: lu.itineraire.localite_origine || actuel.itineraire.localite_origine,
      province_destination:
        lu.itineraire.province_destination || actuel.itineraire.province_destination,
      localite_destination:
        lu.itineraire.localite_destination || actuel.itineraire.localite_destination,
    },
  };
}

function fusionnerPage4(actuel: DonneesPage4, lu: DonneesPage4): DonneesPage4 {
  return {
    ...actuel,
    especes: actuel.especes.map((effectif) => {
      const trouve = lu.especes.find((e) => e.espece === effectif.espece);
      return trouve && trouve.nombre_total > 0 ? trouve : effectif;
    }),
    vaccinations: actuel.vaccinations.map((vaccination) => {
      const trouve = lu.vaccinations.find((v) => v.maladie === vaccination.maladie);
      return trouve?.date_vaccination
        ? { ...vaccination, date_vaccination: trouve.date_vaccination }
        : vaccination;
    }),
  };
}
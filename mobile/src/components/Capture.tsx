/**
 * Capture caméra — deux usages, une seule mécanique de flux vidéo.
 *
 * - mode « qr »   : lecture continue du QR Code du passeport. `BarcodeDetector`
 *                   natif quand il existe (rapide, économe), sinon jsQR sur un
 *                   canvas — indispensable sur iOS, où le détecteur natif est
 *                   absent.
 * - mode « page » : une photo unique de la page 3 ou 4, cadrée au ratio A5.
 *
 * Chemin de repli systématique : si la caméra est refusée ou absente,
 * l'agent peut toujours choisir un fichier image. Rien ne doit bloquer une
 * émission sur le terrain.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { verifierAlignement } from '@/lib/alignementDirect';

/** Ratio hauteur/largeur du format A5 (le format du passeport papier). */
const RATIO_A5 = 210 / 148;
const LARGEUR_GUIDE_MAX = 384; // ~ Tailwind max-w-sm

/** Espace réservé sous le cadre pour le texte de conseil (voir
 * camera.conseil_page) — sans cette réserve, un cadre contraint par la
 * hauteur disponible (voir calculerGeometrieGuide) pourrait remplir tout
 * l'espace vertical et couper ce texte, invisible en dessous. */
const HAUTEUR_RESERVEE_TEXTE = 56;

/**
 * Taille et position du cadre-guide au format A5, ajusté pour tenir
 * ENTIÈREMENT dans le conteneur — sur LA largeur ET la hauteur à la fois.
 *
 * Avant ce correctif, seule la largeur était bornée (`max-w-sm`) : sur un
 * écran où l'espace vertical restant est limité (après l'en-tête, le texte
 * de conseil, le bouton en bas), le cadre calculé pouvait être plus haut
 * que l'espace réellement visible — coupé en haut/en bas, rendant impossible
 * l'alignement du cadre imprimé complet du passeport (signalé : ajuster
 * gauche/droite faisait sortir haut/bas du cadrage).
 *
 * Utilisée à la fois pour DESSINER le cadre à l'écran et pour RECADRER
 * réellement la photo (voir prendrePhoto ci-dessous) : les deux restent
 * ainsi toujours synchronisés, par construction.
 */
function calculerGeometrieGuide(largeurConteneur: number, hauteurConteneur: number) {
  const hauteurDisponible = Math.max(hauteurConteneur - HAUTEUR_RESERVEE_TEXTE, 100);
  let largeurGuide = Math.min(largeurConteneur, LARGEUR_GUIDE_MAX);
  let hauteurGuide = largeurGuide * RATIO_A5;
  if (hauteurGuide > hauteurDisponible) {
    hauteurGuide = hauteurDisponible;
    largeurGuide = hauteurGuide / RATIO_A5;
  }
  return {
    largeurGuide,
    hauteurGuide,
    guideX: (largeurConteneur - largeurGuide) / 2,
    guideY: (hauteurDisponible - hauteurGuide) / 2,
  };
}

/**
 * Convertit la zone du cadre-guide (repère écran, voir calculerGeometrieGuide)
 * en zone équivalente dans les PIXELS NATIFS de la vidéo — nécessaire car la
 * vidéo est affichée en `object-cover` (mise à l'échelle pour couvrir le
 * conteneur, rognée sur un axe). Utilisée à la fois par le recadrage réel
 * (prendrePhoto) et le contrôle d'alignement en direct (voir
 * lib/alignementDirect.ts) — toujours le même calcul, jamais de risque de
 * décalage entre ce qui est affiché, capturé, et vérifié en direct.
 */
function zoneVideoPourGuide(
  video: HTMLVideoElement,
  largeurConteneur: number,
  hauteurConteneur: number,
  geometrieGuide: ReturnType<typeof calculerGeometrieGuide>,
) {
  const echelle = Math.max(largeurConteneur / video.videoWidth, hauteurConteneur / video.videoHeight);
  const videoAfficheeL = video.videoWidth * echelle;
  const videoAfficheeH = video.videoHeight * echelle;
  const decalageX = (videoAfficheeL - largeurConteneur) / 2;
  const decalageY = (videoAfficheeH - hauteurConteneur) / 2;
  return {
    x: Math.round((geometrieGuide.guideX + decalageX) / echelle),
    y: Math.round((geometrieGuide.guideY + decalageY) / echelle),
    largeur: Math.round(geometrieGuide.largeurGuide / echelle),
    hauteur: Math.round(geometrieGuide.hauteurGuide / echelle),
  };
}

type ModeCapture = 'qr' | 'page';

interface ProprietesCapture {
  mode: ModeCapture;
  onQrDetecte?: (contenu: string) => void;
  onPhoto?: (photo: Blob) => void;
  onFermer: () => void;
}

export default function Capture({ mode, onQrDetecte, onPhoto, onFermer }: ProprietesCapture) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const conteneurRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fichierRef = useRef<HTMLInputElement>(null);
  const fluxRef = useRef<MediaStream | null>(null);
  const analyseRef = useRef<number | undefined>(undefined);
  const detecteRef = useRef(false);

  const [pret, setPret] = useState(false);
  const [erreurCamera, setErreurCamera] = useState(false);
  const [capture, setCapture] = useState(false);
  const [geometrieGuide, setGeometrieGuide] = useState<ReturnType<typeof calculerGeometrieGuide> | null>(null);
  const [alignementBon, setAlignementBon] = useState(false);
  const alignementRef = useRef<number | undefined>(undefined);
  const comptageStableRef = useRef(0);

  // Mesure réelle du conteneur (pas une supposition CSS figée) : nécessaire
  // car la hauteur disponible varie selon l'appareil, la présence du texte
  // de conseil, etc. — voir calculerGeometrieGuide ci-dessus.
  useLayoutEffect(() => {
    if (mode !== 'page') return;
    const conteneur = conteneurRef.current;
    if (!conteneur) return;
    const mettreAJour = () => {
      const rect = conteneur.getBoundingClientRect();
      setGeometrieGuide(calculerGeometrieGuide(rect.width, rect.height));
    };
    mettreAJour();
    const observateur = new ResizeObserver(mettreAJour);
    observateur.observe(conteneur);
    return () => observateur.disconnect();
  }, [mode]);

  const arreterFlux = useCallback(() => {
    if (analyseRef.current !== undefined) {
      window.clearInterval(analyseRef.current);
      analyseRef.current = undefined;
    }
    fluxRef.current?.getTracks().forEach((piste) => piste.stop());
    fluxRef.current = null;
  }, []);

  const analyserQr = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || detecteRef.current) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    // Détecteur natif (Android/Chrome) : plus rapide et plus tolérant à l'angle.
    const global = window as unknown as {
      BarcodeDetector?: new (options?: { formats?: string[] }) => {
        detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
      };
    };
    if (global.BarcodeDetector) {
      try {
        const detecteur = new global.BarcodeDetector({ formats: ['qr_code'] });
        const codes = await detecteur.detect(video);
        const valeur = codes.find((code) => code.rawValue)?.rawValue;
        if (valeur) {
          detecteRef.current = true;
          arreterFlux();
          onQrDetecte?.(valeur);
          return;
        }
      } catch {
        /* on continue avec jsQR */
      }
    }

    const largeur = Math.min(video.videoWidth, 720);
    const echelle = largeur / video.videoWidth;
    canvas.width = largeur;
    canvas.height = Math.round(video.videoHeight * echelle);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
    if (code?.data) {
      detecteRef.current = true;
      arreterFlux();
      onQrDetecte?.(code.data);
    }
  }, [arreterFlux, onQrDetecte]);

  useEffect(() => {
    let annule = false;

    const demarrer = async () => {
      try {
        const flux = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (annule) {
          flux.getTracks().forEach((piste) => piste.stop());
          return;
        }
        fluxRef.current = flux;
        if (videoRef.current) {
          videoRef.current.srcObject = flux;
          await videoRef.current.play().catch(() => undefined);
        }
        setPret(true);
        if (mode === 'qr') {
          analyseRef.current = window.setInterval(() => void analyserQr(), 350);
        }
      } catch {
        if (!annule) setErreurCamera(true);
      }
    };

    void demarrer();
    return () => {
      annule = true;
      arreterFlux();
    };
  }, [mode, analyserQr, arreterFlux]);

  const prendrePhoto = useCallback(async () => {
    const video = videoRef.current;
    const conteneur = conteneurRef.current;
    if (!video || video.videoWidth === 0) return;
    setCapture(true);

    const canvasComplet = document.createElement('canvas');
    canvasComplet.width = video.videoWidth;
    canvasComplet.height = video.videoHeight;
    const ctxComplet = canvasComplet.getContext('2d');
    if (!ctxComplet) {
      setCapture(false);
      return;
    }
    ctxComplet.drawImage(video, 0, 0);

    // Recadrage sur la zone du cadre-guide affiché à l'écran (le cadre VERT
    // IMPRIMÉ sur le passeport, à 4mm du bord — voir
    // backend/app/services/pdf_passeport.py::_fond_page — plus net et
    // constant que le bord physique du papier, qui se distingue mal sur
    // certains fonds). Jusqu'ici, ce cadre n'était qu'une SUGGESTION
    // visuelle : la photo capturée gardait toute l'image de la caméra,
    // arrière-plan compris — l'OCR pouvait alors lire du bruit hors du
    // document. Le calcul ci-dessous reproduit la disposition CSS réelle
    // (vidéo en `object-cover`, cadre centré en `aspect-[148/210]`) pour
    // ne garder que les pixels réellement montrés à l'agent comme repère.
    let canvasFinal = canvasComplet;
    if (mode === 'page' && conteneur) {
      const rectConteneur = conteneur.getBoundingClientRect();
      const geometrieGuideActuelle = calculerGeometrieGuide(rectConteneur.width, rectConteneur.height);
      const zone = zoneVideoPourGuide(video, rectConteneur.width, rectConteneur.height, geometrieGuideActuelle);

      if (zone.largeur > 0 && zone.hauteur > 0) {
        const canvasRogne = document.createElement('canvas');
        canvasRogne.width = zone.largeur;
        canvasRogne.height = zone.hauteur;
        const ctxRogne = canvasRogne.getContext('2d');
        if (ctxRogne) {
          ctxRogne.drawImage(canvasComplet, zone.x, zone.y, zone.largeur, zone.hauteur, 0, 0, zone.largeur, zone.hauteur);
          canvasFinal = canvasRogne;
        }
      }
    }

    const blob = await new Promise<Blob | null>((resoudre) =>
      canvasFinal.toBlob((b) => resoudre(b), 'image/jpeg', 0.92),
    );
    arreterFlux();
    setCapture(false);
    if (blob) onPhoto?.(blob);
  }, [arreterFlux, onPhoto, mode]);

  // Contrôle d'alignement en direct, léger (voir lib/alignementDirect.ts —
  // échantillonnage de couleur, PAS une détection de coins par OpenCV,
  // volontairement écarté pour risque de blocage). Vérifie périodiquement
  // (~400ms, jamais à chaque image vidéo) si le cadre vert imprimé et les
  // cases crème/doré semblent bien présents dans le cadre-guide ; après
  // quelques vérifications consécutives positives (~1,2s de stabilité), la
  // photo est prise automatiquement — l'agent garde à tout moment la
  // possibilité de capturer manuellement, l'automatique n'est qu'un confort.
  const SEUIL_STABILITE = 3;
  useEffect(() => {
    if (mode !== 'page' || !pret || capture) return;
    const video = videoRef.current;
    const conteneur = conteneurRef.current;
    if (!video || !conteneur) return;

    const id = window.setInterval(() => {
      if (capture) return;
      const rect = conteneur.getBoundingClientRect();
      const geometrieActuelle = calculerGeometrieGuide(rect.width, rect.height);
      const zone = zoneVideoPourGuide(video, rect.width, rect.height, geometrieActuelle);
      const resultat = verifierAlignement(video, zone);

      if (resultat.alignementBon) {
        comptageStableRef.current += 1;
      } else {
        comptageStableRef.current = 0;
      }
      setAlignementBon(resultat.alignementBon);

      if (comptageStableRef.current >= SEUIL_STABILITE) {
        comptageStableRef.current = 0;
        void prendrePhoto();
      }
    }, 400);

    alignementRef.current = id;
    return () => {
      window.clearInterval(id);
      alignementRef.current = undefined;
      comptageStableRef.current = 0;
    };
  }, [mode, pret, capture, prendrePhoto]);

  const traiterFichier = useCallback(
    async (evenement: React.ChangeEvent<HTMLInputElement>) => {
      const fichier = evenement.target.files?.[0];
      if (!fichier) return;

      if (mode === 'page') {
        arreterFlux();
        onPhoto?.(fichier);
        return;
      }

      // Mode QR sur une image existante : on décode le fichier tel quel.
      const bitmap = await createImageBitmap(fichier).catch(() => null);
      if (!bitmap) return;
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, image.width, image.height);
      if (code?.data) {
        arreterFlux();
        onQrDetecte?.(code.data);
      }
    },
    [mode, arreterFlux, onPhoto, onQrDetecte],
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
      <div className="zone-sure-haut flex items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm font-medium text-white/90">
          {mode === 'qr' ? t('camera.cadre_qr') : t('camera.cadre_page')}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            arreterFlux();
            onFermer();
          }}
          className="cible-tactile size-12 text-white hover:bg-white/15 hover:text-white"
          aria-label={t('action.fermer')}
        >
          <X className="size-6" />
        </Button>
      </div>

      <div ref={conteneurRef} className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="size-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {!erreurCamera && (
          <div className="pointer-events-none absolute inset-0">
            {mode === 'qr' ? (
              <div className="flex size-full items-center justify-center p-6">
                <div className="aspect-square w-56 rounded-xl border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
              </div>
            ) : (
              geometrieGuide && (
                <>
                  {/* Positionné en coordonnées absolues calculées (pas via
                      centrage flexbox + padding) : garantit que ce cadre
                      correspond EXACTEMENT à la zone réellement recadrée par
                      prendrePhoto, qui utilise le même calcul. Couleur et
                      épaisseur réagissent à alignementBon (voir
                      lib/alignementDirect.ts) : l'agent voit immédiatement
                      quand le document est bien positionné, sans jargon
                      technique. */}
                  <div
                    className={`absolute rounded-none shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] transition-all ${
                      alignementBon ? 'border-4 border-emerald-400' : 'border-2 border-primary'
                    }`}
                    style={{
                      left: geometrieGuide.guideX,
                      top: geometrieGuide.guideY,
                      width: geometrieGuide.largeurGuide,
                      height: geometrieGuide.hauteurGuide,
                    }}
                  />
                  <p
                    className={`absolute left-1/2 max-w-xs -translate-x-1/2 px-6 text-center text-xs leading-relaxed ${
                      alignementBon ? 'font-medium text-emerald-300' : 'text-white/80'
                    }`}
                    style={{ top: geometrieGuide.guideY + geometrieGuide.hauteurGuide + 12 }}
                  >
                    {alignementBon ? t('camera.document_detecte') : t('camera.conseil_page')}
                  </p>
                </>
              )
            )}
          </div>
        )}

        {!pret && !erreurCamera && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-neutral-950/70 text-white">
            <Loader2 className="size-5 animate-spin" />
            <span className="text-sm">{mode === 'qr' ? t('camera.recherche_qr') : '…'}</span>
          </div>
        )}

        {erreurCamera && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-neutral-950 px-8 text-center">
            <CameraOff className="size-10 text-white/70" />
            <p className="text-sm leading-relaxed text-white/85">{t('camera.autorisation')}</p>
          </div>
        )}
      </div>

      <div className="zone-sure-bas flex flex-col gap-3 px-4 pt-4">
        {mode === 'page' && !erreurCamera && (
          <Button
            type="button"
            onClick={prendrePhoto}
            disabled={!pret || capture}
            className="cible-tactile w-full text-base"
          >
            {capture ? <Loader2 className="mr-2 size-5 animate-spin" /> : <Camera className="mr-2 size-5" />}
            {t('action.prendre_photo')}
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={() => fichierRef.current?.click()}
          className="cible-tactile w-full border-white/40 !bg-transparent text-base text-white hover:!bg-white/10 hover:text-white"
        >
          <ImageIcon className="mr-2 size-5" />
          {t('action.importer_photo')}
        </Button>

        <input
          ref={fichierRef}
          type="file"
          accept="image/*"
          onChange={traiterFichier}
          className="hidden"
        />
      </div>
    </div>
  );
}
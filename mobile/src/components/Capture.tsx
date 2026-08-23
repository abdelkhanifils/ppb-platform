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
import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fichierRef = useRef<HTMLInputElement>(null);
  const fluxRef = useRef<MediaStream | null>(null);
  const analyseRef = useRef<number | undefined>(undefined);
  const detecteRef = useRef(false);

  const [pret, setPret] = useState(false);
  const [erreurCamera, setErreurCamera] = useState(false);
  const [capture, setCapture] = useState(false);

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
    if (!video || video.videoWidth === 0) return;
    setCapture(true);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCapture(false);
      return;
    }
    ctx.drawImage(video, 0, 0);

    const blob = await new Promise<Blob | null>((resoudre) =>
      canvas.toBlob((b) => resoudre(b), 'image/jpeg', 0.92),
    );
    arreterFlux();
    setCapture(false);
    if (blob) onPhoto?.(blob);
  }, [arreterFlux, onPhoto]);

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

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="size-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {!erreurCamera && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
            <div
              className={
                mode === 'qr'
                  ? 'aspect-square w-56 rounded-xl border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]'
                  : 'aspect-[148/210] w-full max-w-sm rounded-lg border-2 border-white/85 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]'
              }
            />
            {mode === 'page' && (
              <p className="max-w-xs text-center text-xs leading-relaxed text-white/80">
                {t('camera.conseil_page')}
              </p>
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
          capture="environment"
          onChange={traiterFichier}
          className="hidden"
        />
      </div>
    </div>
  );
}
/**
 * Lecture du QR Code du passeport (émission) — MÊME bibliothèque et MÊME configuration que le
 * scanner de la plateforme de contrôle (html5-qrcode, cadre resserré), qui lit le QR code sans
 * difficulté. Remplace l'ancien lecteur maison (BarcodeDetector / jsQR) qui ne parvenait pas à
 * reconnaître le code et faisait clignoter le cadre.
 *
 * Chemin de repli conservé : importer une photo du QR code, ou saisie impossible = rien ne bloque
 * une émission sur le terrain.
 */
import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { CameraOff, Image as ImageIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

const ID_LECTEUR = 'lecteur-qr-emission';

/** Cadre resserré, identique au contrôle : 50 % de la vue, entre 140 et 230 px. */
function qrboxResserre(largeurVue: number, hauteurVue: number): { width: number; height: number } {
  const cote = Math.floor(Math.min(largeurVue, hauteurVue) * 0.5);
  const taille = Math.max(140, Math.min(cote, 230));
  return { width: taille, height: taille };
}

interface ProprietesCaptureQr {
  onQrDetecte?: (contenu: string) => void;
  onFermer: () => void;
}

export default function CaptureQr({ onQrDetecte, onFermer }: ProprietesCaptureQr) {
  const { t } = useI18n();
  const lecteurRef = useRef<Html5Qrcode | null>(null);
  const fichierRef = useRef<HTMLInputElement>(null);
  const termineRef = useRef(false);
  const [erreurCamera, setErreurCamera] = useState(false);

  // Le parent recrée sa fonction à chaque rendu : lue via une référence pour ne JAMAIS relancer la caméra.
  const onQrDetecteRef = useRef(onQrDetecte);
  onQrDetecteRef.current = onQrDetecte;

  useEffect(() => {
    const lecteur = new Html5Qrcode(ID_LECTEUR);
    lecteurRef.current = lecteur;
    let demarre = false;

    lecteur
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: qrboxResserre, aspectRatio: 1.0 },
        (texte) => {
          if (termineRef.current) return;
          termineRef.current = true;
          // Pause immédiate (comme le contrôle) : la boucle de décodage ne concurrence pas la suite.
          try {
            lecteur.pause(true);
          } catch {
            /* déjà arrêté */
          }
          onQrDetecteRef.current?.(texte);
        },
        () => {
          /* échec de lecture image par image : bruit normal, ignoré */
        },
      )
      .then(() => {
        demarre = true;
      })
      .catch(() => setErreurCamera(true));

    return () => {
      // Arrêt propre, y compris si la caméra n'avait pas fini de démarrer (React StrictMode, fermeture rapide).
      const arreter = () => void lecteur.stop().catch(() => undefined);
      if (demarre) arreter();
      else window.setTimeout(arreter, 600);
    };
  }, []);

  const traiterFichier = async (evenement: React.ChangeEvent<HTMLInputElement>) => {
    const fichier = evenement.target.files?.[0];
    evenement.target.value = '';
    if (!fichier || termineRef.current) return;
    try {
      const lecteurFichier = new Html5Qrcode(`${ID_LECTEUR}-fichier`, false);
      const texte = await lecteurFichier.scanFile(fichier, false);
      termineRef.current = true;
      onQrDetecteRef.current?.(texte);
    } catch {
      /* aucun QR code reconnu dans l'image */
    }
  };

  // Présentation identique au contrôle : bandeau de titre, flux caméra carré pleine largeur avec le
  // cadre de visée resserré (coins blancs), puis le repli juste en dessous — sur fond clair.
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="zone-sure-haut flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
        <p className="text-base font-semibold text-foreground">{t('camera.cadre_qr')}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onFermer}
          className="cible-tactile size-12"
          aria-label={t('action.fermer')}
        >
          <X className="size-6" />
        </Button>
      </div>

      <div className="relative w-full overflow-hidden bg-neutral-900 [&_video]:!w-full [&_video]:!object-cover">
        {/* Taille stable dès le premier rendu (aspect-square) : html5-qrcode mesure ce conteneur au démarrage. */}
        <div id={ID_LECTEUR} className="aspect-square w-full" />
        <div id={`${ID_LECTEUR}-fichier`} className="hidden" />

        {erreurCamera && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-neutral-950 px-8 text-center">
            <CameraOff className="size-10 text-white/70" />
            <p className="text-sm leading-relaxed text-white/85">{t('camera.autorisation')}</p>
          </div>
        )}
      </div>

      <div className="zone-sure-bas flex flex-col gap-3 px-4 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => fichierRef.current?.click()}
          className="cible-tactile w-full text-base"
        >
          <ImageIcon className="mr-2 size-5" />
          {t('action.importer_photo')}
        </Button>
        <input ref={fichierRef} type="file" accept="image/*" onChange={traiterFichier} className="hidden" />
      </div>
    </div>
  );
}

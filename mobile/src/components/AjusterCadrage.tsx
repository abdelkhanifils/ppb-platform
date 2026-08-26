/**
 * Ajustement manuel du cadrage, après capture — l'agent peut déplacer et
 * zoomer la photo pour la faire correspondre précisément au cadre-guide,
 * plutôt que de dépendre uniquement d'une détection automatique.
 *
 * Ajouté après plusieurs constats en test réel : même une fois la lecture
 * elle-même fiable (cases individuelles nettes, plus d'artefact de
 * prétraitement), certains champs continuaient à capturer le bas du
 * libellé imprimé sur certaines photos — un problème de POSITION, pas de
 * LECTURE. Élargir encore les marges de tolérance automatiques n'est pas
 * la bonne réponse (proposition de l'utilisateur, retenue telle quelle) :
 * mieux vaut laisser l'agent, qui voit la vraie photo, corriger lui-même
 * un léger défaut d'alignement en quelques secondes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

interface ProprietesAjusterCadrage {
  photo: Blob;
  onConfirmer: (photoAjustee: Blob) => void;
  onReprendre: () => void;
}

/** Ratio hauteur/largeur du format A5 — identique au cadre-guide affiché
 * pendant la capture (voir Capture.tsx::RATIO_A5), pour que l'ajustement
 * corresponde exactement à ce que l'agent a déjà vu à l'écran. */
const RATIO_A5 = 210 / 148;

export default function AjusterCadrage({ photo, onConfirmer, onReprendre }: ProprietesAjusterCadrage) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [dimensionsImage, setDimensionsImage] = useState<{ largeur: number; hauteur: number } | null>(null);
  const [decalage, setDecalage] = useState({ x: 0, y: 0 });
  const [echelle, setEchelle] = useState(1);
  const [enTraitement, setEnTraitement] = useState(false);

  const conteneurRef = useRef<HTMLDivElement>(null);
  const pointeurs = useRef<Map<number, { x: number; y: number }>>(new Map());
  const distancePrecedente = useRef<number | null>(null);
  const decalageInitial = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const objetUrl = URL.createObjectURL(photo);
    setUrl(objetUrl);
    setDimensionsImage(null);
    setDecalage({ x: 0, y: 0 });
    setEchelle(1);
    return () => URL.revokeObjectURL(objetUrl);
  }, [photo]);

  // Cadrage initial raisonnable : l'image occupe toute la largeur du
  // conteneur dès le chargement (l'agent n'a le plus souvent qu'à ajuster
  // finement, pas à tout repositionner depuis un coin).
  const initialiserCadrage = useCallback((largeurImg: number, hauteurImg: number) => {
    const conteneur = conteneurRef.current;
    if (!conteneur) return;
    const rect = conteneur.getBoundingClientRect();
    const echelleInitiale = rect.width / largeurImg;
    setEchelle(echelleInitiale);
    setDecalage({ x: 0, y: 0 });
  }, []);

  const distanceEntrePointeurs = (): number | null => {
    const pts = Array.from(pointeurs.current.values());
    if (pts.length < 2) return null;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };

  const gererPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointeurs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointeurs.current.size === 1) {
      decalageInitial.current = decalage;
    }
    if (pointeurs.current.size === 2) {
      distancePrecedente.current = distanceEntrePointeurs();
    }
  };

  const gererPointerMove = (e: React.PointerEvent) => {
    if (!pointeurs.current.has(e.pointerId)) return;
    pointeurs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointeurs.current.size === 2) {
      // Pincer pour zoomer.
      const distance = distanceEntrePointeurs();
      if (distance && distancePrecedente.current) {
        const facteur = distance / distancePrecedente.current;
        setEchelle((v) => Math.min(6, Math.max(0.2, v * facteur)));
      }
      distancePrecedente.current = distance;
    } else if (pointeurs.current.size === 1) {
      // Glisser pour déplacer.
      const pt = pointeurs.current.get(e.pointerId);
      if (!pt) return;
      setDecalage((d) => ({ x: d.x + e.movementX, y: d.y + e.movementY }));
    }
  };

  const gererPointerUp = (e: React.PointerEvent) => {
    pointeurs.current.delete(e.pointerId);
    if (pointeurs.current.size < 2) distancePrecedente.current = null;
  };

  const confirmer = useCallback(async () => {
    const conteneur = conteneurRef.current;
    if (!conteneur || !dimensionsImage || !url) return;
    setEnTraitement(true);
    try {
      const rect = conteneur.getBoundingClientRect();

      // Cadre-guide : centré, hauteur = 90% du conteneur, largeur au ratio
      // A5 — identique à celui affiché à l'écran pendant l'ajustement.
      const guideH = rect.height * 0.9;
      const guideW = guideH / RATIO_A5;
      const guideX = (rect.width - guideW) / 2;
      const guideY = (rect.height - guideH) / 2;

      // Position affichée de l'image : centrée, puis décalée/zoomée par
      // l'agent (voir le style appliqué au <img>, mêmes calculs).
      const largeurAffichee = dimensionsImage.largeur * echelle;
      const hauteurAffichee = dimensionsImage.hauteur * echelle;
      const imgLeft = rect.width / 2 + decalage.x - largeurAffichee / 2;
      const imgTop = rect.height / 2 + decalage.y - hauteurAffichee / 2;

      // Conversion : quelle zone de l'image ORIGINALE correspond au
      // cadre-guide affiché à l'écran.
      const zoneX = (guideX - imgLeft) / echelle;
      const zoneY = (guideY - imgTop) / echelle;
      const zoneL = guideW / echelle;
      const zoneH = guideH / echelle;

      const image = new Image();
      await new Promise<void>((resoudre, rejeter) => {
        image.onload = () => resoudre();
        image.onerror = () => rejeter(new Error('image illisible'));
        image.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(zoneL));
      canvas.height = Math.max(1, Math.round(zoneH));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas indisponible');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, zoneX, zoneY, zoneL, zoneH, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resoudre) => canvas.toBlob((b) => resoudre(b), 'image/jpeg', 0.92));
      if (blob) onConfirmer(blob);
    } finally {
      setEnTraitement(false);
    }
  }, [dimensionsImage, echelle, decalage, url, onConfirmer]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between p-4">
        <p className="text-sm text-white/90">{t('ajustage.instruction')}</p>
      </div>

      <div
        ref={conteneurRef}
        className="relative flex-1 touch-none overflow-hidden"
        onPointerDown={gererPointerDown}
        onPointerMove={gererPointerMove}
        onPointerUp={gererPointerUp}
        onPointerCancel={gererPointerUp}
      >
        {url && (
          <img
            src={url}
            alt=""
            draggable={false}
            className="absolute left-1/2 top-1/2 max-w-none select-none"
            style={{
              transform: `translate(-50%, -50%) translate(${decalage.x}px, ${decalage.y}px) scale(${echelle})`,
              transformOrigin: 'center',
            }}
            onLoad={(e) => {
              const largeur = e.currentTarget.naturalWidth;
              const hauteur = e.currentTarget.naturalHeight;
              setDimensionsImage({ largeur, hauteur });
              initialiserCadrage(largeur, hauteur);
            }}
          />
        )}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-0">
          <div
            className="rounded-none border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
            style={{ height: '90%', aspectRatio: '148 / 210' }}
          />
        </div>
      </div>

      <div className="space-y-3 bg-background p-4">
        <input
          type="range"
          min={0.2}
          max={6}
          step={0.01}
          value={echelle}
          onChange={(e) => setEchelle(Number(e.target.value))}
          className="w-full"
          aria-label={t('ajustage.zoom')}
        />
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onReprendre} disabled={enTraitement}>
            <RotateCcw className="mr-2 size-4" />
            {t('ajustage.reprendre')}
          </Button>
          <Button className="flex-1" onClick={() => void confirmer()} disabled={enTraitement || !dimensionsImage}>
            <Check className="mr-2 size-4" />
            {t('ajustage.valider')}
          </Button>
        </div>
      </div>
    </div>
  );
}

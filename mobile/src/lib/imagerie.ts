/**
 * Décodage d'un Blob photo en bitmap exploitable par un canvas — utilisé à
 * la fois par ./ocr.ts (prétraitement) et ./perspective.ts (détection de
 * document), d'où son isolement ici plutôt que dans l'un des deux (qui
 * créerait une dépendance circulaire entre eux, l'un appelant l'autre).
 */
export async function creerBitmap(source: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(source);
    } catch {
      /* repli ci-dessous */
    }
  }
  return await new Promise<HTMLImageElement>((resoudre, rejeter) => {
    const url = URL.createObjectURL(source);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resoudre(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rejeter(new Error('Photo illisible : reprenez la photo.'));
    };
    img.src = url;
  });
}

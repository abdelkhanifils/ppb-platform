/**
 * Protection contre le plantage (écran blanc) quand le navigateur du téléphone traduit
 * automatiquement la page : la traduction remplace des nœuds de texte par des <font>, et React
 * échoue ensuite sur removeChild / insertBefore (« Failed to execute 'removeChild' on 'Node' »),
 * ce qui vidait toute l'interface (ex. en ouvrant la liste « origine localité »).
 * Les nœuds introuvables sont ignorés au lieu de lever une exception. La page est en outre
 * déclarée « translate=no » dans index.html ; ce correctif couvre les navigateurs qui
 * traduisent malgré tout.
 */
export function installerProtectionTraduction(): void {
  if (typeof Node !== "function" || !Node.prototype) return;
  const retirer = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, enfant: T): T {
    if (enfant.parentNode !== this) {
      return enfant;
    }
    return retirer.call(this, enfant) as T;
  };
  const inserer = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(this: Node, nouveau: T, reference: Node | null): T {
    if (reference && reference.parentNode !== this) {
      return nouveau;
    }
    return inserer.call(this, nouveau, reference) as T;
  };
}

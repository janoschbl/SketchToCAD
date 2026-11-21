import * as THREE from 'three';

/**
 * Aufkleber: Bild mit weißem, ausgestanztem Rand (wie ein echter Sticker) auf einer flachen Fläche.
 * Später sollen Häuser so per Prompt/Klick beklebt werden – das hier ist der Grundbaustein.
 */
export function makeSticker(url: string, size: number, border = true) {
  const S = 512, pad = 44;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, alphaTest: 0.4, roughness: 0.55, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.receiveShadow = true;
  mesh.visible = false;

  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext('2d')!;
    const k = Math.min((S - 2 * pad) / img.width, (S - 2 * pad) / img.height);
    const w = img.width * k, h = img.height * k, x = (S - w) / 2, y = (S - h) / 2;
    // Silhouette in Weiß rundum versetzt zeichnen → ausgestanzter Sticker-Rand
    const sil = document.createElement('canvas');
    sil.width = sil.height = S;
    const sc = sil.getContext('2d')!;
    sc.drawImage(img, x, y, w, h);
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = '#fffaf0';
    sc.fillRect(0, 0, S, S);
    ctx.shadowColor = 'rgba(60,30,10,0.35)';
    ctx.shadowBlur = 10;
    const R = border ? pad * 0.62 : 0;
    for (let a = 0; a < 32; a++) ctx.drawImage(sil, Math.cos(a / 32 * Math.PI * 2) * R, Math.sin(a / 32 * Math.PI * 2) * R);
    ctx.shadowColor = 'transparent';
    ctx.drawImage(img, x, y, w, h);
    tex.needsUpdate = true;
  };
  img.src = url;
  return mesh;
}

/**
 * Klebt einen Sticker mittig auf eine Seitenfläche eines n-eckigen, leicht konischen Zylinders
 * (THREE.CylinderGeometry: Ecke 0 liegt bei +z, Flächenmitten bei (i + 0.5) · 2π/n).
 */
export function stickOnPrism(mesh: THREE.Mesh, face: number, n: number, rTop: number, rBot: number, h: number, yMid: number, shift = 0) {
  const th = (face + 0.5) * Math.PI * 2 / n;
  const apo = ((rTop + rBot) / 2) * Math.cos(Math.PI / n) + 0.006;
  const lean = Math.atan(((rBot - rTop) / h) * Math.cos(Math.PI / n));
  // shift: entlang der Fläche verschieben (positiv = Richtung höherer Flächenindex)
  mesh.position.set(Math.sin(th) * apo + Math.cos(th) * shift, yMid, Math.cos(th) * apo - Math.sin(th) * shift);
  mesh.rotation.set(-lean, th, 0, 'YXZ');
  return mesh;
}

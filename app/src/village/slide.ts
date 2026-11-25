// Titelfolie vor dem Skizzendorf: nur der Teamname, mittig.
// Vollbild-Versuch beim Laden; Browser erlauben das erst nach einer Geste → erster Klick/Taste holt es nach.
// Danach blendet die Folie aus und das Dorf startet mit seiner Intro-Animation direkt dahinter.

export function showSlide(): Promise<void> {
  return new Promise((resolve) => {
    const s = document.createElement('section');
    s.className = 'vslide';
    s.setAttribute('aria-label', 'SketchTo3D: team presentation');
    s.innerHTML = `
      <h1 class="vslide-team">Sketch<span class="to">To</span>3D</h1>`;
    document.body.appendChild(s);
    requestAnimationFrame(() => s.classList.add('on'));

    const goFull = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); };
    // Chrome erlaubt Vollbild nie ohne Nutzergeste; als installierte App (manifest: display fullscreen) startet es direkt im Vollbild.
    goFull();

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      removeEventListener('pointerdown', onGo, true);
      removeEventListener('keydown', onKey, true);
      s.classList.remove('on');
      s.classList.add('out');
      resolve();
      setTimeout(() => s.remove(), 900);
    };
    // Weiter nur mit den Pfeiltasten; Touch-Geräte (keine Tasten) per Tippen
    const onGo = (e: PointerEvent) => { if (e.pointerType !== 'touch') return; e.stopPropagation(); e.preventDefault(); goFull(); finish(); };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.key === ' ' || e.key === 'Enter' || (e.key.startsWith('Arrow') && e.key !== 'ArrowLeft'))) return;
      e.stopPropagation(); e.preventDefault();
      goFull(); finish();
    };
    // Jede erste Geste (Klick, beliebige Taste) schaltet sofort Vollbild – die Folie bleibt, bis eine Pfeiltaste kommt
    const anyGesture = () => { goFull(); removeEventListener('pointerdown', anyGesture, true); removeEventListener('keydown', anyGesture, true); };
    addEventListener('pointerdown', anyGesture, true);
    addEventListener('keydown', anyGesture, true);
    addEventListener('pointerdown', onGo, true);
    addEventListener('keydown', onKey, true);
  });
}

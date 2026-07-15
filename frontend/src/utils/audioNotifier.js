// Singleton AudioContext — reutilizado para evitar agotar el límite del browser (~6 instancias)
let _ctx = null;
function getAudioContext() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

export function playBeep(type) {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.3;

    const cleanup = () => { osc.disconnect(); gain.disconnect(); };

    if (type === 'success') {
      osc.frequency.value = 880;
      osc.type = 'sine';
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
      osc.onended = cleanup;
    } else if (type === 'warning') {
      osc.frequency.value = 440;
      osc.type = 'triangle';
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
      osc.onended = cleanup;
    } else if (type === 'restriction') {
      cleanup(); // Limpiar el oscilador inicial no utilizado
      const beepDuration = 0.25;
      const gap = 0.15;
      const startTime = ctx.currentTime;
      for (let i = 0; i < 5; i++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.frequency.value = 660;
        o.type = 'sine';
        g.gain.value = 0.25;
        const time = startTime + i * (beepDuration + gap);
        o.start(time);
        o.stop(time + beepDuration);
        o.onended = () => {
          o.disconnect();
          g.disconnect();
        };
      }
    } else { // Error Grave
      osc.frequency.value = 220;
      osc.type = 'square';
      gain.gain.value = 0.15;
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
      osc.onended = cleanup;
      
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 220;
      osc2.type = 'square';
      gain2.gain.value = 0.15;
      osc2.start(ctx.currentTime + 0.18);
      osc2.stop(ctx.currentTime + 0.3);
      osc2.onended = () => { osc2.disconnect(); gain2.disconnect(); };
    }
  } catch (e) {
    console.warn('Audio API no soportada en este entorno.', e);
  }
}

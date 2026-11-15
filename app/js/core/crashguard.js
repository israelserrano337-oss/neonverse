// Sistema anticierres. iOS mata la pestaña sin avisar cuando se queda sin memoria y la recarga
// desde cero: no hay ningún evento de «error» que capturar. Por eso, antes de cada operación
// pesada se deja una marca en localStorage y se quita al terminar. Si al arrancar la marca sigue
// ahí, la app se cerró a mitad de esa operación → se arranca en modo seguro y se avisa.
const KEY = 'nv-crash-op', LOG = 'nv-crash-log', ERR = 'nv-error-log';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const OPS = {
  audio: 'cargaba la canción',
  segment: 'leía el tramo de la canción',
  open: 'abría el proyecto y su música',
  photos: 'cargaba fotos',
  export: 'exportaba el vídeo',
};

export const CrashGuard = {
  /** Marca de inicio de una operación pesada. */
  begin(op, detail = '') { write(KEY, { op, detail: String(detail).slice(0, 120), t: Date.now() }); },
  end() { write(KEY, null); },
  /** Ejecuta fn con la marca puesta (se quita también si fn lanza un error normal). */
  async run(op, detail, fn) { this.begin(op, detail); try { return await fn(); } finally { this.end(); } },
  /**
   * Al arrancar: devuelve el cierre de la sesión anterior (o null) y lo pasa al registro.
   * `repeat` cuenta los cierres seguidos durante la misma operación, para no entrar en bucle.
   */
  takeCrash() {
    const op = read(KEY, null);
    write(KEY, null);
    if (!op) return null;
    const log = read(LOG, []);
    const last = log[log.length - 1];
    op.repeat = last && last.op === op.op && Date.now() - last.t < 10 * 60e3 ? (last.repeat || 1) + 1 : 1;
    log.push(op); write(LOG, log.slice(-20));
    return op;
  },
  crashes: () => read(LOG, []),
  errors: () => read(ERR, []),
  clear() { write(LOG, null); write(ERR, null); },
  /** Errores de JavaScript sin capturar: se registran y se avisa sin romper la interfaz. */
  install(notify) {
    let lastToast = 0;
    const rec = (msg) => {
      const log = read(ERR, []); log.push({ t: Date.now(), msg: String(msg).slice(0, 300) }); write(ERR, log.slice(-30));
      if (Date.now() - lastToast > 8000) { lastToast = Date.now(); notify?.(String(msg).slice(0, 140)); }
    };
    window.addEventListener('error', (e) => { if (e.message && !/ResizeObserver/.test(e.message)) rec(e.message); });
    window.addEventListener('unhandledrejection', (e) => rec(e.reason?.message || e.reason || 'Error'));
  },
};

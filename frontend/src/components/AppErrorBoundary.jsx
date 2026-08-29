import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { recoverFromStaleChunk } from '../utils/chunkRecovery.js';

class AppErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    if (recoverFromStaleChunk(error)) return;
    console.error('Error no controlado en la interfaz:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="fatal-error" role="alert">
        <AlertTriangle size={42} />
        <h1>No fue posible mostrar esta sección</h1>
        <p>La interfaz se detuvo antes de poder confirmar el estado de esta sección. Recarga la página y verifica la última acción antes de repetirla.</p>
        <button type="button" onClick={() => window.location.reload()}>
          <RefreshCw size={18} /> Recargar página
        </button>
      </main>
    );
  }
}

export default AppErrorBoundary;


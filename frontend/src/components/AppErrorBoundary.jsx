import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

class AppErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Error no controlado en la interfaz:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="fatal-error" role="alert">
        <AlertTriangle size={42} />
        <h1>No fue posible mostrar esta sección</h1>
        <p>Los datos no se han modificado. Recarga la página para volver a intentarlo.</p>
        <button type="button" onClick={() => window.location.reload()}>
          <RefreshCw size={18} /> Recargar página
        </button>
      </main>
    );
  }
}

export default AppErrorBoundary;


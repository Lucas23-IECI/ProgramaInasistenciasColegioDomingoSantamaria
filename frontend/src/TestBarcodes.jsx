import React, { useEffect, useRef } from 'react';
import './index.css';

const TEST_STUDENTS = [
  { rut: '11111111-1', name: 'Pedro Pascal', grade: '3A' },
  { rut: '22222222-2', name: 'Daniela Vega', grade: '3A' },
  { rut: '33333333-3', name: 'Alexis Sanchez', grade: '4B' },
  { rut: '44444444-4', name: 'Mon Laferte', grade: '4B' },
  { rut: '55555555-5', name: 'Claudio Bravo', grade: '1C' },
];

function BarcodeCard({ student }) {
  const svgRef = useRef(null);

  useEffect(() => {
    import('jsbarcode').then((mod) => {
      const JsBarcode = mod.default || mod;
      if (svgRef.current) {
        JsBarcode(svgRef.current, student.rut, {
          format: 'CODE128',
          width: 2,
          height: 60,
          displayValue: true,
          fontSize: 14,
          margin: 10,
          background: '#ffffff',
        });
      }
    });
  }, [student.rut]);

  return (
    <div className="barcode-card">
      <h3>{student.name}</h3>
      <p>{student.grade} — {student.rut}</p>
      <svg ref={svgRef}></svg>
    </div>
  );
}

function TestBarcodes() {
  const handlePrint = () => window.print();

  return (
    <div className="test-barcodes-container">
      <div className="test-barcodes-header no-print">
        <h1>Códigos de Barras de Prueba</h1>
        <p>Imprimí esta página y escaneá los códigos con la pistola USB para probar.</p>
        <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
          <button onClick={handlePrint} className="print-btn">
            Imprimir Códigos
          </button>
          <a href="/" className="back-link">← Volver al Registro</a>
        </div>
      </div>
      <div className="barcodes-grid">
        {TEST_STUDENTS.map((s) => (
          <BarcodeCard key={s.rut} student={s} />
        ))}
      </div>
    </div>
  );
}

export default TestBarcodes;

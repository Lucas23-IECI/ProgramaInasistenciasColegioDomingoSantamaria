const InstitutionalMark = ({ compact = false, inverse = false }) => (
  <div className={`institutional-mark${compact ? ' institutional-mark--compact' : ''}${inverse ? ' institutional-mark--inverse' : ''}`}>
    <img
      className="institutional-mark__crest"
      src="/institucional/escudo-ldsm-concepcion.jpg"
      width="64"
      height="64"
      alt=""
      decoding="async"
    />
    <span className="institutional-mark__copy">
      <strong>Liceo Domingo Santa María</strong>
      <small>Concepción · RBD 4565-9</small>
    </span>
  </div>
);

export default InstitutionalMark;

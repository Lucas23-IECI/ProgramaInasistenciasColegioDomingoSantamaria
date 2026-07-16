const InstitutionalMark = ({ compact = false, inverse = false }) => (
  <div className={`institutional-mark${compact ? ' institutional-mark--compact' : ''}${inverse ? ' institutional-mark--inverse' : ''}`}>
    <span className="institutional-mark__rule" aria-hidden="true" />
    <span className="institutional-mark__copy">
      <strong>LDSM</strong>
      <small>Liceo Domingo Santa María</small>
    </span>
  </div>
);

export default InstitutionalMark;

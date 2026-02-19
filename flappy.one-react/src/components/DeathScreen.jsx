import './DeathScreen.css';

const getCauseLabel = (cause) => {
  switch (cause) {
    case 'bullet':
      return 'Shot';
    case 'pipe':
      return 'Pipe';
    case 'border':
      return 'Border';
    default:
      return 'Unknown';
  }
};

function DeathScreen({ killerName, cause, betAmount, onRespawn, onMainMenu }) {
  const causeLabel = getCauseLabel(cause);
  const showKiller =
    cause === 'bullet' &&
    killerName &&
    killerName !== 'Unknown' &&
    killerName !== 'Pipe' &&
    killerName !== 'Border';

  return (
    <div className="death-screen">
      <div className="death-panel">
        <div className="death-title">Eliminated</div>
        <div className="death-subtitle">Cause of Death</div>
        <div className="death-reason">{causeLabel}</div>
        {showKiller && (
          <div className="death-killer">
            Eliminated by <span className="death-killer-name">{killerName}</span>
          </div>
        )}
        {!showKiller && (
          <div className="death-killer death-killer--dim">
            No killer credited
          </div>
        )}
        <div className="death-actions">
          <button className="death-btn death-btn--primary" onClick={onRespawn}>
            Play Again (${betAmount.toFixed(2)})
          </button>
          <button className="death-btn" onClick={onMainMenu}>
            Main Menu
          </button>
        </div>
      </div>
    </div>
  );
}

export default DeathScreen;

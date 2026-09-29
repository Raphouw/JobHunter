import React from 'react';
import { Icon } from '../Common/Icons';

export function LiveActivityTicker({ scan = {}, mode = '' }) {
  const isRunning = !!scan.running;
  const currentAction = scan.current_action || {
    text: isRunning ? 'Exploration en cours...' : '',
    type: isRunning ? 'active' : 'idle',
    timestamp: '',
  };

  const getActionIcon = (type) => {
    switch (type) {
      case 'browse':
        return 'globe';
      case 'search':
        return 'search';
      case 'analyze':
        return 'spark';
      case 'match':
        return 'heart';
      case 'download':
        return 'download';
      case 'revalidate':
        return 'refresh';
      case 'sync':
        return 'external';
      default:
        return 'search';
    }
  };

  const displayText = currentAction.text || (isRunning ? 'Exploration en cours...' : 'Prêt pour le prochain scan.');

  return (
    <div className={`sh-gemini-single-ticker ${isRunning ? 'active' : ''}`}>
      <div className="sh-ticker-left">
        <strong className="sh-ticker-lead">Moteur IA direct</strong>
        {isRunning && (
          <>
            <span className="sh-ticker-sep">·</span>
            <span className="sh-ticker-badge running">
              {mode ? `En cours (${mode})` : 'En cours'}
            </span>
          </>
        )}
      </div>

      <div className="sh-ticker-center">
        {isRunning && currentAction.type && (
          <div className="sh-ticker-icon-box">
            <Icon name={getActionIcon(currentAction.type)} size={14} />
          </div>
        )}
        <span className="sh-ticker-action-text" title={displayText}>
          {displayText}
        </span>
      </div>

      {currentAction.timestamp && (
        <span className="sh-ticker-time">{currentAction.timestamp}</span>
      )}
    </div>
  );
}

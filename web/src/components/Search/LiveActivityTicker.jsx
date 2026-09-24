import React from 'react';
import { Icon } from '../Common/Icons';

export function LiveActivityTicker({ scan = {}, mode = '' }) {
  const isRunning = !!scan.running;
  const currentAction = scan.current_action || {
    text: isRunning ? 'Exploration en cours...' : 'Moteur prêt pour le prochain scan',
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
        return 'spark';
    }
  };

  return (
    <div className={`sh-gemini-single-ticker ${isRunning ? 'active' : ''}`}>
      <div className="sh-ticker-left">
        <span className="sh-gemini-sparkle">✦</span>
        <strong className="sh-ticker-lead">Moteur IA en direct</strong>
        <span className="sh-ticker-sep">·</span>
        <span className={`sh-ticker-badge ${isRunning ? 'running' : 'idle'}`}>
          <span className={`sh-ticker-dot ${isRunning ? 'pulse' : ''}`} />
          {isRunning ? (mode ? `En cours (${mode})` : 'En cours') : 'En attente'}
        </span>
      </div>

      <div className="sh-ticker-center">
        <div className={`sh-ticker-icon-box ${isRunning ? 'pulse-icon' : ''}`}>
          <Icon name={getActionIcon(currentAction.type)} size={15} />
        </div>
        <span className="sh-ticker-action-text" title={currentAction.text}>
          {currentAction.text || 'Prêt pour le prochain scan.'}
        </span>
      </div>

      {currentAction.timestamp && (
        <span className="sh-ticker-time">{currentAction.timestamp}</span>
      )}
    </div>
  );
}

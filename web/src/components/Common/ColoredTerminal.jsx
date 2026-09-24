import React, { useMemo, useState } from 'react';
import { Icon } from './Icons';

function parseLine(line) {
  // Regex to extract timestamp [00:12] and rest
  const timeMatch = line.match(/^(\[\d{2}:\d{2}\])\s*(.*)$/);
  const time = timeMatch ? timeMatch[1] : '';
  const body = timeMatch ? timeMatch[2] : line;

  let type = 'info';
  let tag = '';
  let content = body;

  if (low.includes('traceback') || low.includes('exception') || low.includes('error') || low.includes('[erreur') || low.includes('crash') || low.includes('échec') || low.includes('failed')) {
    type = 'error';
  } else if (body.includes('RETENUE') || body.includes('TOUJOURS ACTIVE') || low.includes('match validé') || low.includes('offre retenue') || low.includes('retenue(s)')) {
    type = 'retained';
  } else if (body.includes('RETIRÉE') || body.includes('ÉCARTÉE') || body.includes('REJETÉE') || body.includes('DOUBLON') || low.includes('hors cible') || low.includes('score trop bas') || low.includes('fermé') || low.includes('expirée') || low.includes('doublon')) {
    type = 'removed';
  } else if (low.includes('coupe-circuit') || low.includes('attention') || low.includes('avertissement') || low.includes('reprise') || low.includes('retry')) {
    type = 'warn';
  }

  // Tag extraction: e.g. "CONFIG LISTING 01/16 —", "WEB 1/3 ·", "ANALYSE 1/1 ·"
  const tagMatch = body.match(/^([A-ZÀ-ÖØ-öø-ÿ0-9_\s\/\-]{3,25})\s*(?:—|·)\s*(.*)$/);
  if (tagMatch) {
    tag = tagMatch[1].trim();
    content = tagMatch[2];
  }

  return { time, tag, content, raw: line, type };
}

export function ColoredTerminal({
  lines = [],
  retainedLines = [],
  removedLines = [],
  errorLines = [],
  autoScroll = true,
  setAutoScroll,
  terminalRef,
  onDownloadLog,
}) {
  const [filter, setFilter] = useState('all'); // all | retained | removed | error
  const [copied, setCopied] = useState(false);

  const parsedAll = useMemo(() => {
    return lines.map((l, idx) => ({ ...parseLine(l), id: `all-${idx}` }));
  }, [lines]);

  const parsedRetained = useMemo(() => {
    if (retainedLines && retainedLines.length > 0) {
      return retainedLines.map((l, idx) => ({ ...parseLine(l), id: `ret-${idx}`, type: 'retained' }));
    }
    return parsedAll.filter((p) => p.type === 'retained');
  }, [retainedLines, parsedAll]);

  const parsedRemoved = useMemo(() => {
    if (removedLines && removedLines.length > 0) {
      return removedLines.map((l, idx) => ({ ...parseLine(l), id: `rem-${idx}`, type: 'removed' }));
    }
    return parsedAll.filter((p) => p.type === 'removed');
  }, [removedLines, parsedAll]);

  const parsedErrors = useMemo(() => {
    if (errorLines && errorLines.length > 0) {
      return errorLines.map((l, idx) => ({ ...parseLine(l), id: `err-${idx}`, type: 'error' }));
    }
    return parsedAll.filter((p) => p.type === 'error');
  }, [errorLines, parsedAll]);

  const counts = useMemo(() => {
    return {
      all: lines.length,
      retained: parsedRetained.length,
      removed: parsedRemoved.length,
      error: parsedErrors.length,
    };
  }, [lines.length, parsedRetained.length, parsedRemoved.length, parsedErrors.length]);

  const activeList = useMemo(() => {
    switch (filter) {
      case 'retained':
        return parsedRetained;
      case 'removed':
        return parsedRemoved;
      case 'error':
        return parsedErrors;
      default:
        return parsedAll;
    }
  }, [filter, parsedAll, parsedRetained, parsedRemoved, parsedErrors]);

  const handleCopy = () => {
    const rawToCopy = activeList.map((p) => p.raw || p.content).join('\n');
    navigator.clipboard?.writeText(rawToCopy || lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="sh-terminal-container">
      {/* Top Header Bar */}
      <div className="sh-terminal-header">
        <div className="sh-terminal-title">
          <span className="sh-terminal-led" />
          <strong>Journal d'exécution en direct</strong>
          <span className="sh-line-count">
            {filter === 'all'
              ? `${lines.length} lignes`
              : `${activeList.length} ${
                  filter === 'retained' ? 'retenues' : filter === 'removed' ? 'écartées' : 'erreurs'
                } (jusqu'à 1000)`}
          </span>
        </div>

        {/* Quick Filter Tabs */}
        <div className="sh-terminal-filters">
          <button
            type="button"
            className={`sh-term-filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            Tous ({counts.all})
          </button>
          <button
            type="button"
            className={`sh-term-filter-btn green ${filter === 'retained' ? 'active' : ''}`}
            onClick={() => setFilter('retained')}
          >
            ★ Retenues ({counts.retained})
          </button>
          <button
            type="button"
            className={`sh-term-filter-btn red ${filter === 'removed' ? 'active' : ''}`}
            onClick={() => setFilter('removed')}
          >
            ✕ Écartées ({counts.removed})
          </button>
          <button
            type="button"
            className={`sh-term-filter-btn danger ${filter === 'error' ? 'active' : ''}`}
            onClick={() => setFilter('error')}
          >
            ⚠ Erreurs ({counts.error})
          </button>
        </div>

        {/* Action Controls */}
        <div className="sh-terminal-controls">
          <label className="sh-autoscroll-toggle" title="Défilement automatique vers le bas">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll && setAutoScroll(e.target.checked)}
            />
            <span>Auto-scroll</span>
          </label>

          <button
            type="button"
            className="sh-term-ctrl-btn"
            onClick={handleCopy}
            title={
              filter === 'all'
                ? 'Copier tout le journal dans le presse-papier'
                : `Copier les ${activeList.length} lignes filtrées`
            }
          >
            <Icon name="fileText" size={13} />
            <span>{copied ? 'Copié !' : 'Copier'}</span>
          </button>

          {onDownloadLog && (
            <button
              type="button"
              className="sh-term-ctrl-btn"
              onClick={onDownloadLog}
              title="Télécharger le fichier journal complet depuis le disque"
            >
              <Icon name="download" size={13} />
              <span>Télécharger</span>
            </button>
          )}
        </div>
      </div>

      {/* Terminal Content Screen */}
      <div className="sh-terminal-box" ref={terminalRef}>
        {activeList.length > 0 ? (
          <div className="sh-terminal-lines">
            {activeList.map((p) => (
              <div key={p.id} className={`sh-log-row type-${p.type}`}>
                {p.time && <span className="sh-log-time">{p.time}</span>}
                {p.tag && <span className="sh-log-tag">{p.tag}</span>}
                {p.tag && <span className="sh-log-sep">—</span>}
                <span className="sh-log-body">{p.content}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="sh-terminal-empty">
            <span>
              {filter === 'retained'
                ? 'Aucune offre retenue dans les 1000 dernières fiches analysées.'
                : filter === 'removed'
                ? 'Aucune offre écartée pour le moment.'
                : filter === 'error'
                ? 'Aucune erreur détectée.'
                : 'Aucune ligne de journal disponible.'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}


import React, { useId } from 'react';

export function OfferScore({ score, className = '' }) {
  const gradientId = useId();
  return <div className={`so-score ${className}`} aria-label={`Correspondance avec le profil : ${score} %`}>
    <svg className="so-score-gauge" viewBox="0 0 100 64" aria-hidden="true">
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#fff0f7" /><stop offset="100%" stopColor="#e747a0" /></linearGradient></defs>
      <path d="M 12 53 A 38 38 0 0 1 88 53" fill="none" stroke="#f8e6f0" strokeWidth="7" strokeLinecap="round" />
      {score > 0 && <path d="M 12 53 A 38 38 0 0 1 88 53" fill="none" stroke={`url(#${gradientId})`} strokeWidth="7" strokeLinecap="round" pathLength="100" strokeDasharray={`${score} 100`} />}
    </svg>
    <strong>{score}<small>%</small></strong><span>Match profil</span>
  </div>;
}

import React from 'react';
import { Icon } from './Icons';
import { legacyGlyphs } from './vectorIcons';

const pattern = new RegExp(`(${Object.keys(legacyGlyphs).sort((a,b) => b.length-a.length).join('|')})`, 'gu');

// Render historical notes with vector icons without rewriting stored user data.
export function IconText({ children }) {
  return String(children ?? '').split(pattern).map((part, index) => legacyGlyphs[part]
    ? <Icon key={index} name={legacyGlyphs[part]} size={14} />
    : part);
}

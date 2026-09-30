// Font Awesome Free icons (CC BY 4.0): https://fontawesome.com/license/free
import {
  faBriefcase, faRocket, faNoteSticky, faEnvelopeOpenText, faComments,
  faBullseye, faTrophy, faTriangleExclamation, faEnvelope, faCircleCheck,
  faCircleXmark, faStopwatch, faHourglassHalf, faLocationDot, faPlus,
  faClipboard, faTrashCan, faArrowsRotate, faWandMagicSparkles, faGear,
  faTags, faBroom, faFolderOpen, faLanguage, faMedal, faHandshake,
  faBookOpen, faUser, faCompass, faLightbulb, faChartColumn, faCircle,
  faCircleHalfStroke, faChartPie, faDiagramProject, faSignal, faPhone,
  faLaptopCode, faGlobe, faCakeCandles, faCar, faCamera, faEye,
  faLink, faGraduationCap, faHouse, faBicycle, faMobileScreenButton,
  faMagnifyingGlass, faMap, faBolt, faCalendarDays, faThumbtack,
  faRobot, faInbox, faFire, faCheck, faXmark, faStar, faMinus, faQuoteLeft, faArrowRight, faBars, faPaperPlane,
} from '@fortawesome/free-solid-svg-icons';
import { faLinkedin } from '@fortawesome/free-brands-svg-icons';

export const vectorIcons = {
  briefcase: faBriefcase, rocket: faRocket, note: faNoteSticky,
  inbox: faEnvelopeOpenText, message: faComments, target: faBullseye,
  trophy: faTrophy, alert: faTriangleExclamation, mail: faEnvelope,
  success: faCircleCheck, reject: faCircleXmark, stopwatch: faStopwatch,
  hourglass: faHourglassHalf, pin: faLocationDot, plus: faPlus,
  clipboard: faClipboard, trash: faTrashCan, refresh: faArrowsRotate,
  spark: faWandMagicSparkles, settings: faGear, tags: faTags, broom: faBroom,
  folder: faFolderOpen, language: faLanguage, medal: faMedal,
  handshake: faHandshake, book: faBookOpen, user: faUser, compass: faCompass,
  lightbulb: faLightbulb, chart: faChartColumn, circle: faCircle,
  contrast: faCircleHalfStroke, pie: faChartPie, network: faDiagramProject,
  signal: faSignal, phone: faPhone, laptop: faLaptopCode, globe: faGlobe,
  cake: faCakeCandles, car: faCar, camera: faCamera, eye: faEye, link: faLink,
  graduate: faGraduationCap, home: faHouse, bike: faBicycle,
  mobile: faMobileScreenButton, search: faMagnifyingGlass, map: faMap,
  bolt: faBolt, calendar: faCalendarDays, thumbtack: faThumbtack,
  robot: faRobot, downloadInbox: faInbox, fire: faFire, check: faCheck,
  x: faXmark, star: faStar, linkedin: faLinkedin, minus: faMinus, quote: faQuoteLeft, arrow: faArrowRight, menu: faBars, send: faPaperPlane,
};

// Compatibility for icons in saved CVs and notes from earlier versions.
export const legacyGlyphs = {
  '💼':'briefcase','🚀':'rocket','📝':'note','📬':'inbox','💬':'message',
  '🎯':'target','🏆':'trophy','🚨':'alert','✉️':'mail','✉':'mail',
  '✅':'success','❌':'reject','⏱️':'stopwatch','⏳':'hourglass','📍':'pin',
  '➕':'plus','📋':'clipboard','🗑️':'trash','🔄':'refresh','🎉':'success',
  '✦':'spark','✨':'spark','⚙️':'settings','⚙':'settings','🏷️':'tags',
  '🧽':'broom','🗂️':'folder','🗣️':'language','🏅':'medal','🤝':'handshake',
  '📚':'book','👤':'user','🧭':'compass','💡':'lightbulb','📊':'chart',
  '🔵':'circle','🌗':'contrast','🍩':'pie','🍕':'pie','🕸️':'network',
  '📶':'signal','📧':'mail','📞':'phone','💻':'laptop','🌐':'globe',
  '🌍':'globe','🎂':'cake','🚗':'car','📷':'camera','👁':'eye','🔗':'link',
  '🎓':'graduate','🏠':'home','🚴':'bike','📱':'mobile','🔍':'search',
  '🗺️':'map','🗺':'map','⚠️':'alert','⚠':'alert','⚡':'bolt','📅':'calendar',
  '📌':'thumbtack','🤖':'robot','📥':'downloadInbox','🔥':'fire','✓':'check',
  '✕':'x','⭐':'star','★':'star','➖':'minus','❝':'quote','➔':'arrow','☰':'menu',
};

for (const [glyph, name] of Object.entries(legacyGlyphs)) {
  if (glyph.includes('\uFE0F')) legacyGlyphs[glyph.replaceAll('\uFE0F', '')] = name;
}

export function vectorMarkup(name) {
  const definition = vectorIcons[name];
  if (!definition) return '';
  const [width, height, , , paths] = definition.icon;
  return `<svg class="jh-vector-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false" fill="currentColor">${[].concat(paths).map(d => `<path d="${d}"/>`).join('')}</svg>`;
}

import rawEditor from './editor.html?raw';
import { cvVectorBridge } from './cvVectorBridge';
const headEnd = rawEditor.lastIndexOf('</head>');
const editor = rawEditor.slice(0, headEnd) + cvVectorBridge + rawEditor.slice(headEnd);

// Opaque-origin sandbox: the editor never receives the account token or access to the host DOM.
const bridge = `<script>
document.addEventListener('DOMContentLoaded', () => {
  const send = (type, extra={}) => parent.postMessage({channel:'job-hunter-cv',type,...extra}, '*');
  const status=document.querySelector('#status-indicator .status-text');
  if(status) status.textContent='Brouillon';
  document.getElementById('status-indicator').title='Utilise Enregistrer pour sauvegarder en base';
  let loading = false;
  let pdfRequest = null;
  // Keep the original A4 preparation/pagination and delegate only rendering to the host.
  window.html2pdf = () => {
    let options, element;
    const worker = {
      set(value) { options=value; return worker; }, from(value) { element=value; return worker; }, toPdf() { return worker; },
      get() { return Promise.resolve({getNumberOfPages:()=>0}); },
      save() { return new Promise((resolve,reject) => {
        pdfRequest={resolve,reject};
        const styles=Array.from(document.querySelectorAll('style')).map(style=>style.textContent).join('\\n');
        const pageCount=Math.max(1,Math.round(parseFloat(element.style.height)/1123)||Math.ceil(element.scrollHeight/1123));
        send('render-pdf',{html:element.outerHTML,styles,options,pageCount});
      }); }
    };
    return worker;
  };
  const originalRecord = AppState.recordState.bind(AppState);
  AppState.recordState = () => {
    CVIcons.upgrade(document.body);
    originalRecord();
    if (!loading) send('change', {data:JSON.parse(editorStorage.getItem('cv-data-v17'))});
  };
  const originalLoad = AppState.load.bind(AppState);
  AppState.load = (...args) => { originalLoad(...args); if (!loading) AppState.recordState(); };
  window.addEventListener('message', async event => {
    if (event.source !== parent || event.data?.channel !== 'job-hunter-cv') return;
    const message = event.data;
    try {
      if (message.type === 'pdf-result' && pdfRequest) {
        const request=pdfRequest; pdfRequest=null;
        if(message.error) request.reject(new Error(message.error)); else request.resolve();
      }
      if (message.type === 'init') {
        loading = true;
        clearTimeout(AppState.timeout);
        window.cvDocumentTitle = message.title;
        if (message.data) AppState.load(JSON.stringify(message.data));
        CVIcons.upgrade(document.body);
        originalRecord();
        loading = false;
        send('initialized', {data:JSON.parse(editorStorage.getItem('cv-data-v17'))});
      }
      if (message.type === 'snapshot') {
        clearTimeout(AppState.timeout);
        AppState.recordState();
        send('snapshot', {requestId:message.requestId,data:JSON.parse(editorStorage.getItem('cv-data-v17'))});
      }
      if (message.type === 'title') window.cvDocumentTitle = message.title;
      if (message.type === 'pdf') {
        window.cvDocumentTitle = message.title;
        await document.fonts.ready;
        await UI.exportPDF();
        send('pdf-finished');
      }
    } catch (error) { loading=false; send('error', {message:error.message}); }
  });
  document.addEventListener('input', () => {
    queueMicrotask(() => { if (!loading) AppState.recordState(); });
  }, true);
  send('ready');
});
</script>`;

const bodyEnd = editor.lastIndexOf('</body>');
export const editorDocument = editor.slice(0, bodyEnd) + bridge + editor.slice(bodyEnd);

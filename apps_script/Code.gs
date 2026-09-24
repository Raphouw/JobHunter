function optimiserCantons() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Réponses au formulaire 1');
  
  if (!sheet) return;

  // Configuration (Ligne 3 car la ligne 1 est un en-tête fusionné et la ligne 2 les titres)
  var startRow = 3; 
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  
  if (lastRow < startRow) return;

  // 1. Définir la plage de données (toutes les colonnes pour garder la cohérence des lignes)
  var range = sheet.getRange(startRow, 1, lastRow - startRow + 1, lastCol);
  
  // 2. Trier par la colonne B (Cantons)
  range.sort({column: 2, ascending: true});

  // 3. Préparer la colonne B (dé-fusionner pour recalculer et centrer)
  var cantonRange = sheet.getRange(startRow, 2, lastRow - startRow + 1, 1);
  cantonRange.breakApart();
  cantonRange.setVerticalAlignment("middle");
  cantonRange.setHorizontalAlignment("center");

  // 4. Parcourir la colonne B pour fusionner les valeurs identiques consécutives
  var values = cantonRange.getValues();
  var startMergeIndex = 0;

  for (var i = 0; i < values.length; i++) {
    var currentVal = values[i][0];
    var nextVal = (i + 1 < values.length) ? values[i + 1][0] : null;

    // Si la valeur change ou si c'est la fin de la liste
    if (currentVal !== nextVal || currentVal === "") {
      var rowSpan = i - startMergeIndex + 1;
      // On ne fusionne que s'il y a plus d'une ligne identique
      if (rowSpan > 1 && currentVal !== "") {
        sheet.getRange(startRow + startMergeIndex, 2, rowSpan, 1).merge();
      }
      startMergeIndex = i + 1;
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Code.gs — Carte candidatures Suisse
// ══════════════════════════════════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📍 Carte Suisse')
    .addItem('Ouvrir le panneau carte', 'showSidebar')
    .addToUi();

  installStageHunterMenu_();
}

function formaterLien(url, label) {
    if (!url || !url.trim()) return "";
    var urlPropre = url.trim();
    // Si l'URL commence par http/https on met la formule, sinon on laisse le texte brut
    if (urlPropre.toLowerCase().indexOf("http") === 0) {
      return '=HYPERLINK("' + urlPropre + '"; "' + label + '")';
    }
    return urlPropre;
  }

function showSidebar() {
  // On utilise createTemplateFromFile au lieu de createHtmlOutputFromFile 
  // pour permettre l'inclusion dynamique du fichier Cities.html
  var html = HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Candidatures · Suisse')
    .setWidth(1000)
    .setHeight(700);
      
  SpreadsheetApp.getUi().showModalDialog(html, '📍 Candidatures · Suisse');
}

/**
 * Fonction utilitaire qui recherche automatiquement le bon onglet
 * peu importe sur lequel l'utilisateur est actuellement.
 */
function getTargetSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = null;
  var candidates = ['candidature', 'réponse', 'reponse', 'form', 'suivi', 'emploi'];
  
  ss.getSheets().forEach(function(s) {
    if (!sheet) {
      var name = s.getName().toLowerCase();
      if (candidates.some(function(c) { return name.includes(c); })) {
        sheet = s;
      }
    }
  });

  return sheet || ss.getSheets()[0];
}

function getSheetData() {
  var sheet = getTargetSheet();
  var data = sheet.getDataRange().getDisplayValues();
  return data;
}

function updateJobStatus(rowIndex, newStatus) {
  var sheet = getTargetSheet();
  var headers = sheet.getRange(1, 1, 4, sheet.getLastColumn()).getValues();
  var colStatut = -1;
  var colRetours = -1;
  
  // Cherche les colonnes Statut et Retours
  for (var r = 0; r < headers.length; r++) {
    for (var c = 0; c < headers[r].length; c++) {
      var cellVal = String(headers[r][c]).toLowerCase().trim();
      if (cellVal === 'statut actuel' || cellVal === 'statut') colStatut = c + 1;
      if (cellVal === 'retour' || cellVal === 'retours' || cellVal === 'pense-bete' || cellVal === 'memo') colRetours = c + 1;
    }
    if (colStatut !== -1 && colRetours !== -1) break;
  }
  
  if (colStatut > 0) {
    // 1. Met à jour le statut
    sheet.getRange(rowIndex, colStatut).setValue(newStatus);
    
    // 2. Génère la note automatique de changement de statut
    if (colRetours > 0) {
      var now = new Date();
      var day = ("0" + now.getDate()).slice(-2);
      var month = ("0" + (now.getMonth() + 1)).slice(-2);
      var year = now.getFullYear();
      var hours = ("0" + now.getHours()).slice(-2);
      var minutes = ("0" + now.getMinutes()).slice(-2);
      
      var timestamp = "[" + day + "/" + month + "/" + year + " " + hours + ":" + minutes + "]";
      var autoNote = timestamp + " 🔄 Statut passé à : " + newStatus;
      
      var cellRange = sheet.getRange(rowIndex, colRetours);
      var currentNote = String(cellRange.getValue()).trim();
      var updatedNote = currentNote ? currentNote + " || " + autoNote : autoNote;
      
      cellRange.setValue(updatedNote);
    }
    
    return newStatus;
  }
  throw new Error("Colonne de statut introuvable.");
}

function appendJobNote(rowIndex, newNote) {
  var sheet = getTargetSheet();
  var headers = sheet.getRange(1, 1, 4, sheet.getLastColumn()).getValues();
  var colIndex = -1;
  
  for (var r = 0; r < headers.length; r++) {
    for (var c = 0; c < headers[r].length; c++) {
      var cellVal = String(headers[r][c]).toLowerCase().trim();
      // On cible uniquement la colonne réservée aux retours (pour pas écrire dans la note sur 10)
      if (cellVal === 'retour' || cellVal === 'retours' || cellVal === 'pense-bete' || cellVal === 'memos') {
        colIndex = c + 1;
        break;
      }
    }
    if (colIndex !== -1) break;
  }
  
  if (colIndex > 0) {
    var cellRange = sheet.getRange(rowIndex, colIndex);
    var currentNote = String(cellRange.getValue()).trim();
    var updatedNote = currentNote ? currentNote + " || " + newNote : newNote;
    cellRange.setValue(updatedNote);
    return updatedNote;
  }
  
  throw new Error("Aucune colonne nommée 'Retours' (ou 'Notes') n'a été trouvée dans les en-têtes.");
}


// ══════════════════════════════════════════════════════════════
// DÉTECTION AUTOMATIQUE DES MODIFICATIONS SUR LE FICHIER
// ══════════════════════════════════════════════════════════════

function onEdit(e) {
  // 1. Sécurité : s'assurer qu'il y a bien un événement (modification manuelle)
  if (!e || !e.range) return;

  // Stage Hunter est traité avant le suivi classique des candidatures.
  if (handleStageHunterEdit_(e)) return;
  
  var sheet = e.range.getSheet();
  var sheetName = sheet.getName().toLowerCase();
  var row = e.range.getRow();
  var col = e.range.getColumn();

  // 2. On s'assure qu'on est sur le bon onglet (qui contient "réponse", "formulaire", "candidature"...)
  var candidates = ['candidature', 'réponse', 'reponse', 'form', 'suivi', 'emploi'];
  var isTargetSheet = candidates.some(function(c) { return sheetName.includes(c); });
  if (!isTargetSheet && e.source.getSheets()[0].getName() !== sheet.getName()) return;

  // 3. Tes données commencent à la ligne 3 (Ligne 1 = fusionnée, Ligne 2 = Titres).
  // Donc on ignore les modifications de l'utilisateur sur les lignes 1 et 2 pour la suite du script.
  if (row < 3) return;

  // 4. Trouver dynamiquement quelles sont les colonnes "Statut" et "Retours"
  // On scanne les 3 premières lignes pour trouver les titres
  var headers = sheet.getRange(1, 1, 3, sheet.getLastColumn()).getValues();
  var colStatut = -1;
  var colRetours = -1;
  
  for (var r = 0; r < headers.length; r++) {
    for (var c = 0; c < headers[r].length; c++) {
      var cellVal = String(headers[r][c]).toLowerCase().trim();
      if (cellVal === 'statut actuel' || cellVal === 'statut') colStatut = c + 1;
      if (cellVal === 'retour' || cellVal === 'retours' || cellVal === 'pense-bete' || cellVal === 'memo') colRetours = c + 1;
    }
    if (colStatut !== -1 && colRetours !== -1) break;
  }

  // 5. Si la colonne modifiée EST la colonne des Statuts
  if (col === colStatut && colRetours !== -1) {
    var newStatus = e.value; 
    
    // Si on a juste effacé la case, on s'arrête
    if (!newStatus) return;

    // 6. Construction du timestamp
    var now = new Date();
    var day = ("0" + now.getDate()).slice(-2);
    var month = ("0" + (now.getMonth() + 1)).slice(-2);
    var year = now.getFullYear();
    var hours = ("0" + now.getHours()).slice(-2);
    var minutes = ("0" + now.getMinutes()).slice(-2);
    
    var timestamp = "[" + day + "/" + month + "/" + year + " " + hours + ":" + minutes + "]";
    var autoNote = timestamp + " 🔄 Statut passé à : " + newStatus;
    
    // 7. Ajout à l'historique existant dans la colonne "Retours"
    var cellRange = sheet.getRange(row, colRetours);
    var currentNote = String(cellRange.getValue() || "").trim();
    
    // On ajoute le double pipe " || " de séparation si une note existe déjà
    var updatedNote = currentNote ? currentNote + " || " + autoNote : autoNote;
    
    cellRange.setValue(updatedNote);
  }
}



// ══════════════════════════════════════════════════════════════
// SCANNER GMAIL AUTOMATIQUE (MAGIE GOOGLE APPS SCRIPT)
// ══════════════════════════════════════════════════════════════
function scanGmailForResponses() {
  var sheet = getTargetSheet();
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).toLowerCase().trim(); });

  // Repérage des colonnes critiques
  var colEnt = headers.findIndex(function(h) { return h.includes('entreprise'); });
  var colStat = headers.findIndex(function(h) { return h === 'statut actuel' || h === 'statut'; });
  var colRet = headers.findIndex(function(h) { return h.includes('retour') || h.includes('memo'); });

  if (colEnt === -1 || colStat === -1) return "Colonnes introuvables";

  var updatedCount = 0;

  // On scanne les lignes
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var company = String(row[colEnt]).trim();
    var status = String(row[colStat]).toLowerCase();

    // On ne cherche que pour les candidatures sans réponse
    if (company && (status === '' || status.includes('initiale') || status.includes('envoy'))) {
      
      // La requête Gmail : on cherche un mail reçu dans les 10 derniers jours contenant le nom de la boîte
      // (Prend le premier mot du nom de l'entreprise pour ratisser large, ex: "BMC Switzerland" -> "BMC")
      var companyKeyword = company.split(' ')[0];
      var searchQuery = companyKeyword + " newer_than:10d to:me -label:STAGE";

      // Recherche dans Gmail
      var threads = GmailApp.search(searchQuery, 0, 1);
      
      if (threads.length > 0) {
        // BAM ! Un mail a été trouvé. On met à jour le statut.
        sheet.getRange(i + 1, colStat + 1).setValue("Réponse obtenue");

        // Ajout d'une note automatique
        if (colRet !== -1) {
          var now = new Date();
          var timestamp = "[" + ("0"+now.getDate()).slice(-2) + "/" + ("0"+(now.getMonth()+1)).slice(-2) + "/" + now.getFullYear() + "]";
          var autoNote = timestamp + " 🤖 Mail détecté pour : " + company;
          
          var noteRange = sheet.getRange(i + 1, colRet + 1);
          var oldNote = noteRange.getValue();
          noteRange.setValue(oldNote ? oldNote + " || " + autoNote : autoNote);
        }
        updatedCount++;
      }
    }
  }
  
  // Affiche un popup dans le Sheet pour te donner le résultat
  SpreadsheetApp.getUi().alert("Scan terminé : " + updatedCount + " candidature(s) mise(s) à jour automatiquement !");
}


// ══════════════════════════════════════════════════════════════
// AJOUT D'UNE NOUVELLE CANDIDATURE DEPUIS L'INTERFACE
// ══════════════════════════════════════════════════════════════
function addNewJob(data) {
  var sheet = getTargetSheet();
  var headers = sheet.getRange(1, 1, 3, sheet.getLastColumn()).getValues();
  var colMap = {};
  
  // Scanne les 3 premières lignes pour cartographier les colonnes
  for (var r = 0; r < headers.length; r++) {
    for (var c = 0; c < headers[r].length; c++) {
      var val = String(headers[r][c]).toLowerCase().trim();
      if (val && !colMap[val]) colMap[val] = c + 1; // Index 1-based
    }
  }

  // Fonction interne pour trouver une colonne grâce à des mots-clés
  function getCol(keywords, excludeKeywords) {
    excludeKeywords = excludeKeywords || [];
    for (var key in colMap) {
      var matches = keywords.some(function(kw) { return key.includes(kw); });
      var isExcluded = excludeKeywords.some(function(ex) { return key.includes(ex); });
      if (matches && !isExcluded) {
        return colMap[key];
      }
    }
    return -1;
  }

  // Création d'une ligne vierge de la bonne largeur
  var newRow = new Array(sheet.getLastColumn()).fill('');
  
  // Mapping intelligent des colonnes
  var cols = {
    canton: getCol(['cantons', 'canton']),
    entreprise: getCol(['entreprise']),
    email: getCol(['email', 'mail', 'contact']),
    ville: getCol(['ville']),
    secteur: getCol(['secteur']),
    activite: getCol(['détaillée', 'detaillee']),
    lien1: getCol(['lien 1']),
    lien2: getCol(['lien 2']),
    lien3: getCol(['lien 3']),
    // Cible "démarche(s)" OU l'ancien intitulé "statut", mais EXCLUT formellement "actuel"
    statutDemarche: getCol(['démarche', 'demarche', 'statut'], ['actuel']),
    // Cible spécifiquement la colonne du statut déroulant
    statutActuel: getCol(['statut actuel']),
    note: getCol(['note']),
    date: getCol(['horodateur', 'date']),
    retours: getCol(['retour', 'retours', 'memo'])
  };

  var initialStatut = data.statutActuel || "Demande initiale";

  // Remplissage de la ligne avec les données du formulaire
  if (cols.entreprise > 0) newRow[cols.entreprise - 1] = data.entreprise;
  if (cols.email > 0) newRow[cols.email - 1] = data.email;
  if (cols.ville > 0) newRow[cols.ville - 1] = data.ville;
  if (cols.canton > 0) newRow[cols.canton - 1] = data.canton;
  if (cols.secteur > 0) newRow[cols.secteur - 1] = data.secteur;
  if (cols.activite > 0) newRow[cols.activite - 1] = data.activiteDetaillee;
  if (cols.lien1 > 0) newRow[cols.lien1 - 1] = formaterLien(data.lien1, "Lien 1");
  if (cols.lien2 > 0) newRow[cols.lien2 - 1] = formaterLien(data.lien2, "Lien 2");
  if (cols.lien3 > 0) newRow[cols.lien3 - 1] = formaterLien(data.lien3, "Lien 3");
  
  // Démarches (texte libre)
  if (cols.statutDemarche > 0) newRow[cols.statutDemarche - 1] = data.statutDemarche;
  
  // Statut actuel (menu déroulant)
  if (cols.statutActuel > 0) newRow[cols.statutActuel - 1] = initialStatut;
  
  if (cols.note > 0) newRow[cols.note - 1] = data.note;
  
  // Horodateur & Historique Retours
  if (cols.date > 0) {
    var now = new Date();
    var day = ("0" + now.getDate()).slice(-2);
    var month = ("0" + (now.getMonth() + 1)).slice(-2);
    var year = now.getFullYear();
    var hours = ("0" + now.getHours()).slice(-2);
    var minutes = ("0" + now.getMinutes()).slice(-2);
    
    var timestamp = day + "/" + month + "/" + year + " " + hours + ":" + minutes + ":00";
    newRow[cols.date - 1] = timestamp;
    
    if (cols.retours > 0) {
      var noteTimestamp = "[" + day + "/" + month + "/" + year + " " + hours + ":" + minutes + "]";
      newRow[cols.retours - 1] = noteTimestamp + " 🔄 Statut passé à : " + initialStatut;
    }
  }

  // Ajout à la fin du tableau
  sheet.appendRow(newRow);
  if (data.stageHunterMeta) {
    finalizeStageHunterTransfer_(data.stageHunterMeta);
  }
  return true;
}


function compresserAnciensLiens() {
  var sheet = getTargetSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 3) return; // Pas de données (début ligne 3)

  // 1. Repérage des colonnes Lien 1, Lien 2, Lien 3
  var headers = sheet.getRange(1, 1, 3, sheet.getLastColumn()).getValues();
  var colMap = {};
  for (var r = 0; r < headers.length; r++) {
    for (var c = 0; c < headers[r].length; c++) {
      var val = String(headers[r][c]).toLowerCase().trim();
      if (val && !colMap[val]) colMap[val] = c + 1;
    }
  }

  function getCol(name) {
    for (var k in colMap) {
      if (k.indexOf(name) !== -1) return colMap[k];
    }
    return -1;
  }

  var cLien1 = getCol('lien 1');
  var cLien2 = getCol('lien 2');
  var cLien3 = getCol('lien 3');

  var numRows = lastRow - 2; // À partir de la ligne 3

  // 2. Traitement d'une colonne de liens
  function traiterColonne(colIndex, label) {
    if (colIndex <= 0) return;
    var range = sheet.getRange(3, colIndex, numRows, 1);
    var formulas = range.getFormulas();
    var values = range.getValues();
    var modifie = false;

    for (var i = 0; i < numRows; i++) {
      var val = String(values[i][0]).trim();
      var form = formulas[i][0];

      // Si ce n'est pas déjà une formule et que c'est une URL
      if (!form && val.toLowerCase().indexOf("http") === 0) {
        formulas[i][0] = '=HYPERLINK("' + val + '"; "' + label + '")';
        modifie = true;
      }
    }

    if (modifie) {
      range.setFormulas(formulas);
    }
  }

  traiterColonne(cLien1, "Lien 1");
  traiterColonne(cLien2, "Lien 2");
  traiterColonne(cLien3, "Lien 3");

  SpreadsheetApp.getUi().alert("Tous les anciens liens ont été compressés avec succès !");
}


// Fonction pour déployer l'interface en tant qu'Application Web autonome
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Candidatures · Suisse')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1'); // Crucial pour le rendu sur mobile !
}


// Fonction pour ouvrir directement le formulaire de saisie de stage
function ouvrirSaisieDirecte() {
  var template = HtmlService.createTemplateFromFile('FormulaireSaisie');
  template.stageHunterPrefillJson = 'null';
  var html = template.evaluate()
    .setWidth(550)
    .setHeight(600);
      
  SpreadsheetApp.getUi().showModalDialog(html, '✨ Nouvelle Candidature');
}


// ══════════════════════════════════════════════════════════════
// STAGE HUNTER — ACTIONS IMMÉDIATES + MISE EN FORME
// ══════════════════════════════════════════════════════════════

var STAGE_HUNTER_SHEET_ = 'Opportunités';
var STAGE_HUNTER_LOG_SHEET_ = '_StageHunter_Actions';

var STAGE_HUNTER_CANTONS_ = {
  AR: 'Appenzell Rhodes-Extérieures | AR | AL',
  AI: 'Appenzell Rhodes-Intérieures | AI | AL',
  AG: 'Argovie | AG | AL',
  BL: 'Bâle-Campagne | BL | AL',
  BS: 'Bâle-Ville | BS | AL',
  BE: 'Berne | BE | AL/FR',
  FR: 'Fribourg | FR | FR/AL',
  GE: 'Genève | GE | FR',
  GL: 'Glaris | GL | AL',
  GR: 'Grisons | GR | AL/ROM/IT',
  JU: 'Jura | JU | FR',
  LU: 'Lucerne | LU | AL',
  NE: 'Neuchâtel | NE | FR',
  NW: 'Nidwald | NW | AL',
  OW: 'Obwald | OW | AL',
  SG: 'Saint-Gall | SG | AL',
  SH: 'Schaffhouse | SH | AL',
  SZ: 'Schwytz | SZ | AL',
  SO: 'Soleure | SO | AL',
  TI: 'Tessin | TI | IT',
  TG: 'Thurgovie | TG | AL',
  UR: 'Uri | UR | AL',
  VS: 'Valais | VS | FR/AL',
  VD: 'Vaud | VD | FR',
  ZG: 'Zoug | ZG | AL',
  ZH: 'Zurich | ZH | AL'
};

function installStageHunterMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('🎯 Stage Hunter')
    .addItem('Configurer / remettre en forme', 'configurerStageHunter')
    .addItem('Activer les actions immédiates', 'installerActionsImmediatesStageHunter')
    .addItem('Traiter les actions déjà choisies', 'traiterActionsStageHunter')
    .addSeparator()
    .addItem('Normaliser les cantons', 'normaliserCantonsStageHunter')
    .addToUi();
}

function normalizeHeader_(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getStageHunterSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var direct = ss.getSheetByName(STAGE_HUNTER_SHEET_);
  if (direct) return direct;
  var wanted = normalizeHeader_(STAGE_HUNTER_SHEET_);
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (normalizeHeader_(sheets[i].getName()) === wanted) return sheets[i];
  }
  return null;
}

function getHeaderMap_(sheet, headerRow) {
  var values = sheet.getRange(headerRow || 1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var map = {};
  values.forEach(function(value, index) {
    var key = normalizeHeader_(value);
    if (key) map[key] = index + 1;
  });
  return map;
}

function findHeaderColumn_(map, names) {
  for (var i = 0; i < names.length; i++) {
    var exact = normalizeHeader_(names[i]);
    if (map[exact]) return map[exact];
  }
  return -1;
}

function configurerStageHunter() {
  var sheet = getStageHunterSheet_();
  if (!sheet) {
    SpreadsheetApp.getUi().alert("L'onglet 'Opportunités' n'existe pas encore. Lance d'abord Stage Hunter.");
    return;
  }

  // Les "Tables" natives de Google Sheets ajoutent ici un fond vert massif,
  // des menus déroulants automatiques et des erreurs de validation. On les
  // reconvertit en plage normale avant d'appliquer notre propre design.
  removeNativeTablesStageHunter_(sheet);

  var lastRow = Math.max(sheet.getLastRow(), 2);
  var lastCol = sheet.getLastColumn();
  var headers = getHeaderMap_(sheet, 1);
  var actionCol = findHeaderColumn_(headers, ['Action']);
  var scoreCol = findHeaderColumn_(headers, ['Score /100', 'Score']);
  var confidenceCol = findHeaderColumn_(headers, ['Confiance']);
  var cantonCol = findHeaderColumn_(headers, ['Canton']);
  var dateCol = findHeaderColumn_(headers, ['Date découverte']);
  var idCol = findHeaderColumn_(headers, ['ID Stage Hunter']);

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(Math.min(4, lastCol));
  sheet.setHiddenGridlines(true);

  var fullRange = sheet.getRange(1, 1, lastRow, lastCol);
  fullRange.clearFormat();
  if (lastRow >= 2) {
    // Supprime les types de colonnes/dropdowns créés automatiquement par
    // le tableau natif. Seule la colonne Action recevra ensuite une validation.
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearDataValidations();
  }

  sheet.getBandings().forEach(function(banding) { banding.remove(); });
  if (lastRow >= 2) {
    var banding = sheet.getRange(2, 1, lastRow - 1, lastCol)
      .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
    banding.setFirstRowColor('#ffffff').setSecondRowColor('#f5f7fa');
  }

  sheet.getRange(1, 1, 1, lastCol)
    .setBackground('#244c5a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontFamily('Inter')
    .setFontSize(10)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.setRowHeight(1, 44);

  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, lastCol)
      .setFontFamily('Inter')
      .setFontSize(10)
      .setFontColor('#202124')
      .setFontWeight('normal')
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle')
      .setWrap(true);
    sheet.setRowHeights(2, lastRow - 1, 64);
  }

  if (actionCol > 0) {
    var actionRange = sheet.getRange(2, actionCol, Math.max(lastRow - 1, 1), 1);
    var validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(['GARDER', 'TRANSFERER', 'SUPPRIMER'], true)
      .setAllowInvalid(false)
      .setHelpText('GARDER conserve et colore la ligne ; TRANSFERER copie vers Réponses ; SUPPRIMER écarte immédiatement.')
      .build();
    actionRange.setDataValidation(validation).setHorizontalAlignment('center').setFontWeight('bold').setFontColor('#244c5a');
    sheet.setColumnWidth(actionCol, 135);
  }

  if (scoreCol > 0) {
    sheet.getRange(2, scoreCol, Math.max(lastRow - 1, 1), 1).setNumberFormat('0').setHorizontalAlignment('center');
    sheet.setColumnWidth(scoreCol, 82);
  }
  if (confidenceCol > 0) {
    sheet.getRange(2, confidenceCol, Math.max(lastRow - 1, 1), 1).setNumberFormat('0').setHorizontalAlignment('center');
    sheet.setColumnWidth(confidenceCol, 88);
  }
  if (cantonCol > 0) sheet.setColumnWidth(cantonCol, 220);
  if (dateCol > 0) {
    sheet.getRange(2, dateCol, Math.max(lastRow - 1, 1), 1).setNumberFormat('dd/MM/yyyy HH:mm');
    sheet.setColumnWidth(dateCol, 135);
  }

  var widths = {
    'entreprise': 190,
    'offre': 330,
    'ville / lieu': 145,
    'langue': 130,
    'duree': 100,
    'debut': 110,
    'domaine': 175,
    'competences detectees': 300,
    'pourquoi': 420,
    'source': 145,
    'lien': 260
  };
  Object.keys(widths).forEach(function(name) {
    if (headers[name]) sheet.setColumnWidth(headers[name], widths[name]);
  });

  if (actionCol > 0 && lastRow >= 2) {
    var tableRange = sheet.getRange(2, 1, Math.max(lastRow - 1, 1), lastCol);
    var actionLetter = columnToLetter_(actionCol);
    var scoreLetter = scoreCol > 0 ? columnToLetter_(scoreCol) : null;
    var rules = [
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + actionLetter + '2="GARDER"').setBackground('#e6f4ea').setRanges([tableRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + actionLetter + '2="TRANSFERER"').setBackground('#e8f0fe').setRanges([tableRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + actionLetter + '2="SUPPRIMER"').setBackground('#fce8e6').setRanges([tableRange]).build()
    ];
    if (scoreLetter) {
      var scoreRange = sheet.getRange(2, scoreCol, Math.max(lastRow - 1, 1), 1);
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(80).setBackground('#b7e1cd').setFontColor('#0b5e45').setRanges([scoreRange]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(60, 79.999).setBackground('#fce8b2').setFontColor('#7a4d00').setRanges([scoreRange]).build());
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(60).setBackground('#f4c7c3').setFontColor('#8a1c13').setRanges([scoreRange]).build());
    }
    sheet.setConditionalFormatRules(rules);
  }

  if (idCol > 0) sheet.hideColumns(idCol);
  var existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();
  sheet.getRange(1, 1, lastRow, lastCol).createFilter();
  normaliserCantonsStageHunter_(sheet, cantonCol);
  sortStageHunterRows_(sheet, headers);
  ensureStageHunterEditTrigger_();
  SpreadsheetApp.getActiveSpreadsheet().toast('Mise en forme appliquée et actions immédiates activées.', 'Stage Hunter', 5);
}

function removeNativeTablesStageHunter_(sheet) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var spreadsheetId = ss.getId();
  var fields = encodeURIComponent('sheets(properties(sheetId),tables(tableId,range))');
  var baseUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId;
  var options = {
    method: 'get',
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(baseUrl + '?fields=' + fields, options);
  if (response.getResponseCode() !== 200) return 0;

  var payload = JSON.parse(response.getContentText());
  var targetId = sheet.getSheetId();
  var tableIds = [];
  (payload.sheets || []).forEach(function(item) {
    if (!item.properties || item.properties.sheetId !== targetId) return;
    (item.tables || []).forEach(function(table) {
      if (table.tableId) tableIds.push(table.tableId);
    });
  });
  if (!tableIds.length) return 0;

  var update = UrlFetchApp.fetch(baseUrl + ':batchUpdate', {
    method: 'post',
    contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
    payload: JSON.stringify({
      requests: tableIds.map(function(tableId) {
        return {deleteTable: {tableId: tableId}};
      })
    }),
    muteHttpExceptions: true
  });
  if (update.getResponseCode() < 200 || update.getResponseCode() >= 300) {
    ss.toast('Le tableau natif n\'a pas pu être retiré automatiquement. La mise en forme claire sera quand même appliquée.', 'Stage Hunter', 7);
    return 0;
  }
  SpreadsheetApp.flush();
  return tableIds.length;
}

function installerActionsImmediatesStageHunter() {
  ensureStageHunterEditTrigger_();
  SpreadsheetApp.getUi().alert(
    'Actions immédiates activées.\n\n' +
    'GARDER : la ligne reste dans Opportunités.\n' +
    'SUPPRIMER : la ligne disparaît et son lien est mémorisé.\n' +
    'TRANSFERER : le formulaire prérempli s\'ouvre, puis la ligne ne disparaît qu\'après validation.'
  );
}

function ensureStageHunterEditTrigger_() {
  var handler = 'stageHunterInstallableOnEdit';
  var triggers = ScriptApp.getProjectTriggers();
  var exists = triggers.some(function(trigger) {
    return trigger.getHandlerFunction() === handler &&
      trigger.getEventType() === ScriptApp.EventType.ON_EDIT;
  });
  if (!exists) {
    ScriptApp.newTrigger(handler)
      .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
      .onEdit()
      .create();
  }
}

function normaliserCantonsStageHunter() {
  var sheet = getStageHunterSheet_();
  if (!sheet) return;
  var headers = getHeaderMap_(sheet, 1);
  normaliserCantonsStageHunter_(sheet, findHeaderColumn_(headers, ['Canton']));
  SpreadsheetApp.getActiveSpreadsheet().toast('Cantons normalisés.', 'Stage Hunter', 3);
}

function normaliserCantonsStageHunter_(sheet, cantonCol) {
  if (!sheet || cantonCol <= 0 || sheet.getLastRow() < 2) return;
  var range = sheet.getRange(2, cantonCol, sheet.getLastRow() - 1, 1);
  var values = range.getDisplayValues();
  var changed = false;
  for (var i = 0; i < values.length; i++) {
    var formatted = formatCantonStageHunter_(values[i][0]);
    if (formatted !== values[i][0]) {
      values[i][0] = formatted;
      changed = true;
    }
  }
  if (changed) range.setValues(values);
}

function formatCantonStageHunter_(value) {
  var raw = String(value || '').trim();
  if (!raw || raw.indexOf('|') !== -1) return raw;
  var codes = raw.toUpperCase().split(/[,;/]+/).map(function(x) { return x.trim(); }).filter(String);
  var formatted = [];
  codes.forEach(function(code) {
    if (STAGE_HUNTER_CANTONS_[code] && formatted.indexOf(STAGE_HUNTER_CANTONS_[code]) === -1) {
      formatted.push(STAGE_HUNTER_CANTONS_[code]);
    }
  });
  return formatted.length ? formatted.join(' ; ') : raw;
}

function columnToLetter_(column) {
  var result = '';
  while (column > 0) {
    var remainder = (column - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    column = Math.floor((column - 1) / 26);
  }
  return result;
}

function normalizeStageHunterAction_(value) {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z]/g, '');
}

function handleStageHunterEdit_(e) {
  var sheet = e.range.getSheet();
  if (normalizeHeader_(sheet.getName()) !== normalizeHeader_(STAGE_HUNTER_SHEET_)) return false;
  if (e.range.getRow() < 2 || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return true;

  var headers = getHeaderMap_(sheet, 1);
  var actionCol = findHeaderColumn_(headers, ['Action']);
  if (e.range.getColumn() !== actionCol) return true;

  var action = normalizeStageHunterAction_(e.value || e.range.getDisplayValue());
  if (['GARDER', 'TRANSFERER', 'SUPPRIMER'].indexOf(action) === -1) return true;

  // Le formulaire TRANSFERER doit être ouvert par le déclencheur installable
  // stageHunterInstallableOnEdit. Le onEdit simple continue de gérer les deux
  // actions qui n'ont besoin d'aucune autorisation supplémentaire.
  if (action === 'TRANSFERER') return true;

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Une autre action est déjà en cours. Réessaie dans quelques secondes.', 'Stage Hunter', 5);
    return true;
  }
  try {
    executeStageHunterAction_(sheet, e.range.getRow(), action, headers);
  } catch (error) {
    e.range.setNote('Erreur Stage Hunter : ' + error.message).setBackground('#f4cccc');
    SpreadsheetApp.getActiveSpreadsheet().toast(error.message, 'Erreur Stage Hunter', 8);
  } finally {
    lock.releaseLock();
  }
  return true;
}

function executeStageHunterAction_(sheet, row, action, headers) {
  headers = headers || getHeaderMap_(sheet, 1);
  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(row, 1, 1, lastCol).getDisplayValues()[0];
  function value(names) {
    var column = findHeaderColumn_(headers, names);
    return column > 0 ? values[column - 1] : '';
  }

  var actionCol = findHeaderColumn_(headers, ['Action']);
  var id = value(['ID Stage Hunter']);
  var linkCol = findHeaderColumn_(headers, ['Lien']);
  var link = linkCol > 0 ? getCellLink_(sheet.getRange(row, linkCol)) : '';

  if (action === 'GARDER') {
    logStageHunterAction_(id, action, link);
    sheet.getRange(row, 1, 1, lastCol).setBackground('#d9ead3');
    sheet.getRange(row, actionCol).setNote('Offre gardée le ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm'));
    sortStageHunterRows_(sheet, headers);
    SpreadsheetApp.getActiveSpreadsheet().toast('Offre conservée dans Opportunités.', 'Stage Hunter', 3);
    return;
  }

  if (action === 'TRANSFERER') {
    openStageHunterTransferForm_(sheet, row, headers);
    return;
  }

  if (action === 'SUPPRIMER') {
    logStageHunterAction_(id, action, link);
    sheet.deleteRow(row);
    SpreadsheetApp.getActiveSpreadsheet().toast('Offre supprimée et mémorisée comme ignorée.', 'Stage Hunter', 3);
  }
}

function sortStageHunterRows_(sheet, headers) {
  if (!sheet || sheet.getLastRow() < 3) return;
  headers = headers || getHeaderMap_(sheet, 1);
  var actionCol = findHeaderColumn_(headers, ['Action']);
  var scoreCol = findHeaderColumn_(headers, ['Score /100', 'Score']);
  if (actionCol <= 0 || scoreCol <= 0) return;

  var rowCount = sheet.getLastRow() - 1;
  var dataLastCol = sheet.getLastColumn();
  var helperCol = dataLastCol + 1;
  var actions = sheet.getRange(2, actionCol, rowCount, 1).getDisplayValues();
  var groups = actions.map(function(row) {
    return [normalizeStageHunterAction_(row[0]) === 'GARDER' ? 1 : 0];
  });

  sheet.getRange(2, helperCol, rowCount, 1).setValues(groups);
  sheet.getRange(2, 1, rowCount, helperCol).sort([
    {column: helperCol, ascending: true},
    {column: scoreCol, ascending: false}
  ]);
  sheet.getRange(1, helperCol, sheet.getMaxRows(), 1).clearContent();
}

function stageHunterInstallableOnEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (normalizeHeader_(sheet.getName()) !== normalizeHeader_(STAGE_HUNTER_SHEET_)) return;
  if (e.range.getRow() < 2 || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

  var headers = getHeaderMap_(sheet, 1);
  var actionCol = findHeaderColumn_(headers, ['Action']);
  if (e.range.getColumn() !== actionCol) return;
  if (normalizeStageHunterAction_(e.value || e.range.getDisplayValue()) !== 'TRANSFERER') return;

  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Une autre action est déjà en cours.', 'Stage Hunter', 5);
    return;
  }
  try {
    openStageHunterTransferForm_(sheet, e.range.getRow(), headers);
  } catch (error) {
    e.range.setNote('Erreur Stage Hunter : ' + error.message).setBackground('#f4cccc');
    SpreadsheetApp.getActiveSpreadsheet().toast(error.message, 'Erreur Stage Hunter', 8);
  } finally {
    lock.releaseLock();
  }
}

function buildStageHunterTransferData_(sheet, row, headers) {
  headers = headers || getHeaderMap_(sheet, 1);
  var values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  function value(names) {
    var column = findHeaderColumn_(headers, names);
    return column > 0 ? values[column - 1] : '';
  }
  var linkCol = findHeaderColumn_(headers, ['Lien']);
  var link = linkCol > 0 ? getCellLink_(sheet.getRange(row, linkCol)) : '';
  var score = parseFloat(String(value(['Score /100', 'Score'])).replace(',', '.')) || 0;
  var reason = value(['Pourquoi']);

  return {
    entreprise: value(['Entreprise']) || 'Entreprise à vérifier',
    email: '',
    ville: value(['Ville / lieu', 'Ville']),
    canton: formatCantonStageHunter_(value(['Canton'])),
    secteur: value(['Domaine']) || 'Stage / Engineering',
    activiteDetaillee: value(['Offre']),
    lien1: link,
    lien2: '',
    lien3: '',
    statutDemarche: 'Offre transférée depuis Stage Hunter — à vérifier avant candidature. Score : ' + Math.round(score) + '/100' + (reason ? ' — ' + reason : ''),
    note: score ? String(Math.max(1, Math.min(10, Math.round(score / 10)))) : '',
    statutActuel: 'Demande initiale',
    stageHunterMeta: {
      sheetName: sheet.getName(),
      row: row,
      id: value(['ID Stage Hunter']),
      link: link
    }
  };
}

function openStageHunterTransferForm_(sheet, row, headers) {
  var actionCol = findHeaderColumn_(headers || getHeaderMap_(sheet, 1), ['Action']);
  var data = buildStageHunterTransferData_(sheet, row, headers);

  // Remettre l'action à blanc permet de choisir TRANSFERER une seconde fois si
  // l'utilisateur ferme le formulaire sans enregistrer.
  if (actionCol > 0) sheet.getRange(row, actionCol).clearContent().setNote('');

  var template = HtmlService.createTemplateFromFile('FormulaireSaisie');
  template.stageHunterPrefillJson = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  var html = template.evaluate().setWidth(650).setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, '📥 Vérifier puis transférer la candidature');
}

function finalizeStageHunterTransfer_(meta) {
  if (!meta) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(meta.sheetName || STAGE_HUNTER_SHEET_);
  if (!sheet || sheet.getLastRow() < 2) return;

  var headers = getHeaderMap_(sheet, 1);
  var idCol = findHeaderColumn_(headers, ['ID Stage Hunter']);
  var targetRow = Number(meta.row) || -1;
  var wantedId = String(meta.id || '').trim();

  if (targetRow < 2 || targetRow > sheet.getLastRow() ||
      (wantedId && idCol > 0 && String(sheet.getRange(targetRow, idCol).getDisplayValue()).trim() !== wantedId)) {
    targetRow = -1;
    if (wantedId && idCol > 0) {
      var ids = sheet.getRange(2, idCol, sheet.getLastRow() - 1, 1).getDisplayValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === wantedId) {
          targetRow = i + 2;
          break;
        }
      }
    }
  }

  logStageHunterAction_(wantedId, 'TRANSFERER', meta.link || '');
  if (targetRow >= 2 && targetRow <= sheet.getLastRow()) sheet.deleteRow(targetRow);
  ss.toast('Candidature ajoutée dans Réponses et retirée des opportunités.', 'Stage Hunter', 4);
}

function getCellLink_(cell) {
  var rich = cell.getRichTextValue();
  if (rich && rich.getLinkUrl()) return rich.getLinkUrl();
  if (rich) {
    var runs = rich.getRuns();
    for (var i = 0; i < runs.length; i++) if (runs[i].getLinkUrl()) return runs[i].getLinkUrl();
  }
  var formula = cell.getFormula();
  var match = formula && formula.match(/HYPERLINK\(\s*"([^"]+)"/i);
  if (match) return match[1];
  var value = String(cell.getDisplayValue() || '').trim();
  return /^https?:\/\//i.test(value) ? value : '';
}

function logStageHunterAction_(id, action, link) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = ss.getSheetByName(STAGE_HUNTER_LOG_SHEET_);
  if (!log) {
    log = ss.insertSheet(STAGE_HUNTER_LOG_SHEET_);
    log.getRange(1, 1, 1, 5).setValues([['ID Stage Hunter', 'Action', 'Lien', 'Date Apps Script', 'Traité par Python']]);
    log.hideSheet();
  }
  log.appendRow([id, action, link, new Date(), '']);
}

function traiterActionsStageHunter() {
  var sheet = getStageHunterSheet_();
  if (!sheet || sheet.getLastRow() < 2) return;
  var headers = getHeaderMap_(sheet, 1);
  var actionCol = findHeaderColumn_(headers, ['Action']);
  if (actionCol <= 0) throw new Error("Colonne 'Action' introuvable.");
  var count = 0;
  for (var row = sheet.getLastRow(); row >= 2; row--) {
    var action = normalizeStageHunterAction_(sheet.getRange(row, actionCol).getDisplayValue());
    if (['GARDER', 'TRANSFERER', 'SUPPRIMER'].indexOf(action) !== -1) {
      executeStageHunterAction_(sheet, row, action, headers);
      count++;
    }
  }
  SpreadsheetApp.getUi().alert(count + ' action(s) Stage Hunter traitée(s).');
}

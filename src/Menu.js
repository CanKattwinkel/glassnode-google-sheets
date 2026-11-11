/**
 * Menu, sidebar and the "refresh all formulas" action.
 */

function onInstall(e) {
  onOpen(e);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createAddonMenu()
    .addItem('Open', 'gnShowSidebar')
    .addItem('Refresh all formulas', 'gnRefreshAll')
    .addItem('Retry failed formulas', 'gnRetryFailed')
    .addToUi();
}

function gnShowSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('Glassnode');
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Re-run every Glassnode formula in the spreadsheet. Sheets only recalculates
 * a custom function when its arguments change, so this clears and re-enters
 * the formulas and bypasses the short-lived response cache.
 *
 * @return {number} Number of formulas refreshed.
 */
function gnRefreshAll() {
  return gnRerunFormulas_(false);
}

/**
 * Re-run only the Glassnode formulas that currently show an error, for
 * example after a rate limit. Results that already loaded are left alone.
 *
 * @return {number} Number of formulas retried.
 */
function gnRetryFailed() {
  return gnRerunFormulas_(true);
}

function gnRerunFormulas_(onlyFailed) {
  var ss = SpreadsheetApp.getActive();
  var cells = ss.createTextFinder('GN_(METRIC|ASSETS)\\s*\\(').useRegularExpression(true).matchFormulaText(true).findAll();
  var jobs = cells
    .map(function (range) {
      return {range: range, formula: range.getFormula(), shown: range.getDisplayValue()};
    })
    .filter(function (j) {
      return j.formula && (!onlyFailed || /^#(ERROR|N\/A|REF|VALUE|NAME)/.test(j.shown));
    });
  if (!onlyFailed) PropertiesService.getDocumentProperties().setProperty(GN_PROP_.epoch, String(Date.now()));
  jobs.forEach(function (j) {
    j.range.setFormula('');
  });
  SpreadsheetApp.flush();
  jobs.forEach(function (j) {
    j.range.setFormula(j.formula);
  });
  var n = jobs.length;
  ss.toast(n + ' Glassnode formula' + (n === 1 ? '' : 's') + (onlyFailed ? ' retried.' : ' refreshed.'), 'Glassnode');
  return n;
}

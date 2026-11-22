/**
 * CFA Productivity — Backend de Asistencias en Google Apps Script
 * Guarda el detalle de planilla y resumen diario en Google Sheets
 * y las fotos grupales selladas en Google Drive.
 *
 * Pasos de despliegue:
 * 1. Abre https://script.google.com -> Nuevo proyecto (o desde una Google Sheet: Extensiones -> Apps Script).
 * 2. Pega todo este código y guarda.
 * 3. Haz clic en "Implementar" -> "Nueva implementación" -> Tipo: "Aplicación web".
 * 4. Ejecutar como: "Yo" | Quién tiene acceso: "Cualquier persona".
 * 5. Copia la URL (/exec) generada.
 */

var FOLDER_NAME = "CFA_Asistencia_Fotos";
var SPREADSHEET_NAME = "CFA_Planilla_Asistencias";

function _getOrCreateSpreadsheet() {
  var active = null;
  try {
    active = SpreadsheetApp.getActiveSpreadsheet();
  } catch (err) {
    active = null;
  }
  if (active) return active;

  var props = PropertiesService.getScriptProperties();
  var savedId = props.getProperty("SPREADSHEET_ID");
  if (savedId) {
    try {
      return SpreadsheetApp.openById(savedId);
    } catch (err) {
      // Si se eliminó, crear uno nuevo
    }
  }

  var files = DriveApp.getFilesByName(SPREADSHEET_NAME);
  var ss = files.hasNext() ? SpreadsheetApp.open(files.next()) : SpreadsheetApp.create(SPREADSHEET_NAME);
  props.setProperty("SPREADSHEET_ID", ss.getId());
  return ss;
}

function _getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#0B1F3A").setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function _getOrCreatePhotoFolder(projectName) {
  var rootIt = DriveApp.getFoldersByName(FOLDER_NAME);
  var rootFolder = rootIt.hasNext() ? rootIt.next() : DriveApp.createFolder(FOLDER_NAME);
  var safeProj = String(projectName || "General").trim();
  var subIt = rootFolder.getFoldersByName(safeProj);
  return subIt.hasNext() ? subIt.next() : rootFolder.createFolder(safeProj);
}

function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || "ping";
    var ss = _getOrCreateSpreadsheet();

    if (action === "ping") {
      return _jsonResponse({
        ok: true,
        service: "cfa-apps-script-attendance",
        spreadsheet_url: ss.getUrl(),
      });
    }

    if (action === "list") {
      var projectFilter = (e && e.parameter && e.parameter.project_name) || "";
      var summarySheet = ss.getSheetByName("Resumen Diario");
      if (!summarySheet) return _jsonResponse({ ok: true, logs: [] });

      var rows = summarySheet.getDataRange().getValues();
      var logs = [];
      for (var i = rows.length - 1; i >= 1 && logs.length < 25; i--) {
        var r = rows[i];
        if (projectFilter && String(r[1]) !== projectFilter) continue;
        logs.push({
          work_date: String(r[0]),
          project_name: String(r[1]),
          registered_by: String(r[2]),
          present_count: Number(r[3]) || 0,
          total_workers: Number(r[4]) || 0,
          total_hh: Number(r[5]) || 0,
          inside_geofence: r[6] === "SI" ? true : r[6] === "NO" ? false : null,
          distance_m: r[7] === "" ? null : Number(r[7]),
          group_photo_path: String(r[8] || "") || null,
        });
      }
      return _jsonResponse({ ok: true, logs: logs, spreadsheet_url: ss.getUrl() });
    }

    return _jsonResponse({ ok: false, error: "Accion no soportada" });
  } catch (err) {
    return _jsonResponse({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || "{}";
    var data = JSON.parse(raw);

    var projectName = data.project_name || "Obra CFA";
    var workDate = data.work_date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    var registeredBy = data.registered_by || "Maestro";
    var entries = data.entries || [];

    var photoUrl = "";
    if (data.photo_base64) {
      var folder = _getOrCreatePhotoFolder(projectName);
      var bytes = Utilities.base64Decode(data.photo_base64);
      var mime = data.photo_mime || "image/jpeg";
      var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HHmmss");
      var fileName = workDate + "_" + projectName.replace(/\s+/g, "_") + "_" + stamp + ".jpg";
      var blob = Utilities.newBlob(bytes, mime, fileName);
      var file = folder.createFile(blob);
      photoUrl = file.getUrl();
    }

    var ss = _getOrCreateSpreadsheet();
    var summarySheet = _getOrCreateSheet(ss, "Resumen Diario", [
      "Fecha",
      "Proyecto",
      "Registrado Por",
      "Presentes",
      "Total Personal",
      "Total HH",
      "En Obra (100m)",
      "Distancia (m)",
      "Foto Grupal (Drive)",
      "Timestamp",
    ]);

    var detailSheet = _getOrCreateSheet(ss, "Detalle Planilla", [
      "Fecha",
      "Proyecto",
      "Registrado Por",
      "Trabajador",
      "Cargo",
      "Estado",
      "Horas Normales",
      "Horas Extra",
      "Total HH",
      "Motivo Ausencia",
      "Foto Grupal (Drive)",
    ]);

    var presentCount = 0;
    var totalHH = 0;
    for (var i = 0; i < entries.length; i++) {
      var item = entries[i];
      var isAbsent = item.status === "ausente";
      var hh = isAbsent ? 0 : (Number(item.normal_hours) || 0) + (Number(item.extra_hours) || 0);
      if (!isAbsent) presentCount++;
      totalHH += hh;

      detailSheet.appendRow([
        workDate,
        projectName,
        registeredBy,
        item.worker_name || "",
        item.role || "Albañil",
        item.status || "ausente",
        Number(item.normal_hours) || 0,
        Number(item.extra_hours) || 0,
        Math.round(hh * 100) / 100,
        item.reason || "",
        photoUrl,
      ]);
    }

    var geoStr = data.inside_geofence === true ? "SI" : data.inside_geofence === false ? "NO" : "N/A";
    var distVal = data.distance_m != null ? Number(data.distance_m) : "";

    summarySheet.appendRow([
      workDate,
      projectName,
      registeredBy,
      presentCount,
      entries.length,
      Math.round(totalHH * 100) / 100,
      geoStr,
      distVal,
      photoUrl,
      new Date().toISOString(),
    ]);

    return _jsonResponse({
      ok: true,
      present_count: presentCount,
      total_workers: entries.length,
      total_hh: Math.round(totalHH * 100) / 100,
      photo_url: photoUrl,
      spreadsheet_url: ss.getUrl(),
    });
  } catch (err) {
    return _jsonResponse({ ok: false, error: String(err) });
  }
}

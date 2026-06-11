function autoTable(doc, options) {
  console.warn("[jspdf-autotable shim] autoTable called but PDF export is not available in this environment.");
  if (doc) {
    doc.lastAutoTable = { finalY: (options && options.startY ? options.startY : 0) + 20 };
  }
}

module.exports = autoTable;
module.exports.default = autoTable;

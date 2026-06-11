class jsPDF {
  constructor() {
    this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
  }
  setFontSize() { return this; }
  setFont() { return this; }
  setTextColor() { return this; }
  setFillColor() { return this; }
  setDrawColor() { return this; }
  setLineWidth() { return this; }
  text() { return this; }
  rect() { return this; }
  line() { return this; }
  addImage() { return this; }
  addPage() { return this; }
  save(filename) {
    console.warn("[jspdf shim] PDF export is not available in this environment. Would have saved:", filename);
  }
  output() { return ""; }
  getNumberOfPages() { return 1; }
  setPage() { return this; }
  autoTable() { return this; }
  lastAutoTable = { finalY: 0 };
}

module.exports = jsPDF;
module.exports.default = jsPDF;
module.exports.jsPDF = jsPDF;

export class jsPDF {
  constructor() {
    this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    this.lastAutoTable = { finalY: 0 };
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
    console.warn("[jspdf shim] PDF export not available. Would have saved:", filename);
  }
  output() { return ""; }
  getNumberOfPages() { return 1; }
  setPage() { return this; }
  autoTable() { return this; }
}

export default jsPDF;

export default function autoTable(doc, options) {
  console.warn("[jspdf-autotable shim] PDF export not available.");
  if (doc) {
    doc.lastAutoTable = { finalY: (options && options.startY ? options.startY : 0) + 20 };
  }
}

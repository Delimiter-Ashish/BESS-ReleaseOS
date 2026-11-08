import { copyFileSync } from "node:fs";
// Always ship the worker belonging to the installed PDF.js version.
copyFileSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "public/pdf.worker.min.mjs");

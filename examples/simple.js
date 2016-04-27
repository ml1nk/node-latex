
//Simple example
var dvistream = require("../texwrapper.js").create([
  "\\documentclass{article}",
  "\\begin{document}",
  "abc",
  "\\end{document}"
]);
dvistream.pipe(process.stdout);

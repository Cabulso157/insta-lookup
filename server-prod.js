const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const { URL } = require("url");

const execAsync = promisify(exec);

const PORT = process.env.PORT;
const PUBLIC_DIR = path.join(__dirname, "public");

const server = http.createServer((req, res) => {
  let filePath = path.join(PUBLIC_DIR, req.url === "/" ? "index.html" : req.url);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e2, html) => {
        if (e2) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
      });
      return;
    }
    res.writeHead(200);
    res.end(data);
  });
});

server.listen(PORT, () => console.log("Running on", PORT));

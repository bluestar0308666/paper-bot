# PaperBot

PaperBot turns a paper title, PubMed link or WeChat article into a searchable personal literature library with a structured Chinese analysis.

## Features

- accepts paper titles and article links
- identifies the underlying paper and bibliographic metadata when available
- generates Chinese translation and structured sections with DeepSeek
- stores results in SQLite using Node's built-in `node:sqlite`
- supports accounts, per-user libraries, favorites, pagination and an admin overview
- runs on Linux or Android Termux without native database packages

## Requirements

- Node.js 22 or newer (Node 24 recommended)
- a DeepSeek-compatible API key
- `express` is the only runtime dependency

Do not install `better-sqlite3`; PaperBot intentionally uses `DatabaseSync` from `node:sqlite`.

## Quick start

```bash
cp config.example.json config.json
npm install
npm start
```

Edit `config.json` before starting. `PASSWORD` enables the legacy Basic Auth layer when non-empty. The web application is available on the configured port, normally `3008`.

For a public server, run PaperBot as an unprivileged service behind Caddy or Nginx with HTTPS. Keep port 3008 bound to localhost or protected by a firewall.

## Termux

Install Node and OpenSSH with `pkg install nodejs-lts openssh`, copy the project into `~/pubmed`, create `config.json`, and run `bash install.sh`. `tunnel.sh` provides an optional localhost.run reverse tunnel for temporary access; its public URL changes when reconnected.

## Data and backups

The live database (`data.db` plus WAL/SHM files), `config.json`, logs and backups are ignored by Git. Back them up before upgrading. Never commit an API key or a production database.

## Validation

```bash
node --check server.js
npm ci --ignore-scripts
```

Then start the service and verify `/api/list` through the same authentication path used by the browser.

## License

MIT. No user data or third-party article content is bundled with the repository.

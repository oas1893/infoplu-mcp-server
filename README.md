# InfoPlu MCP Server

An MCP (Model Context Protocol) server that wraps the French [Géoportail de l'Urbanisme API](https://www.geoportail-urbanisme.gouv.fr/api/swagger.yaml), enabling AI agents to query urban planning documents, territories, procedures, and spatial planning data.

## Tools

| Tool | Description |
|------|-------------|
| `infoplu_search_documents` | Search PLU, PLUi, CC, POS, PSMV, SUP, SCoT documents by type, status, territory, or date |
| `infoplu_get_document_details` | Get full metadata for a document by ID — title, producer, files, archive URL |
| `infoplu_list_document_files` | List attached written pieces (règlement, annexes, etc.) for a document |
| `infoplu_search_grids` | Find French administrative territories (communes, EPCIs, departments) by code or name |
| `infoplu_get_grid` | Get details of a specific territory by its code |
| `infoplu_get_grid_parents` | Get parent territories (EPCI, department, region) of a territory |
| `infoplu_get_grid_children` | Get child territories of a parent (e.g., all communes in a department) |
| `infoplu_search_procedures` | Find planning procedures (révision, modification, etc.) for a territory |
| `infoplu_list_document_models` | List CNIG national document standards by type |
| `infoplu_get_document_model` | Get the full schema (feature types & attributes) of a document standard |
| `infoplu_list_sup_categories` | List all SUP (servitudes d'utilité publique) category codes and labels |
| `infoplu_list_du_categories` | List urban planning zone category codes (U, AU, N, A, etc.) |
| `infoplu_get_du_at_location` | Get urban planning features (zones, prescriptions) at a lon/lat point |
| `infoplu_get_sup_at_location` | Get SUP servitudes (easements) at a lon/lat point |
| `infoplu_get_scot_at_location` | Get the SCoT document covering a lon/lat point |
| `infoplu_get_features_by_parcel` | Get all planning features intersecting a cadastral parcel ID |

All tools strip geometric coordinate data from API responses — only textual and coded properties relevant to document d'urbanisme analysis are returned.

---

## Running Locally (stdio)

The stdio transport is used for local integration with Claude Desktop or any MCP CLI client.

### Prerequisites

- Node.js >= 18
- npm

### Setup

```bash
cd infoplu-mcp-server
npm install
npm run build
```

### Start

```bash
node dist/index.js
```

Or for development with auto-reload:

```bash
npm run dev
```

### Claude Desktop config

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "infoplu": {
      "command": "node",
      "args": ["/absolute/path/to/infoplu-mcp-server/dist/index.js"],
      "env": {
        "API_BASE_URL": "https://www.geoportail-urbanisme.gouv.fr/api"
      }
    }
  }
}
```

---

## Running with Docker (SSE — for VPS)

The SSE transport exposes an HTTP server suitable for remote deployment.

### Start

```bash
cp .env.example .env
docker compose up --build -d
```

The server listens on port **3000** by default.

- SSE endpoint: `http://your-host:3000/sse`
- Message endpoint: `http://your-host:3000/message`
- Health check: `http://your-host:3000/health`

---

## VPS Deployment (GitHub Actions)

The included workflow (`.github/workflows/deploy.yml`) deploys on every push to `main` by SSHing into the VPS and running `docker compose up --build -d`.

### First-time VPS setup

```bash
# On the VPS
git clone https://github.com/your-org/infoplu-mcp-server /opt/infoplu-mcp-server
cd /opt/infoplu-mcp-server
cp .env.example .env
# Edit .env if needed
docker compose up --build -d
```

### GitHub Secrets required

| Secret | Value |
|--------|-------|
| `VPS_HOST` | Your VPS IP address or hostname |
| `VPS_USER` | SSH username (e.g., `ubuntu`, `root`) |
| `VPS_SSH_KEY` | Private SSH key (contents of `~/.ssh/id_rsa`) |
| `VPS_PORT` | SSH port (optional, defaults to 22) |
| `VPS_APP_DIR` | Path to app on VPS (e.g., `/opt/infoplu-mcp-server`) |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE_URL` | `https://www.geoportail-urbanisme.gouv.fr/api` | Base URL for the Géoportail API |
| `TRANSPORT` | `stdio` | Transport mode: `stdio` or `sse` |
| `PORT` | `3000` | HTTP port (SSE mode only) |

---

## Project Structure

```
src/
├── index.ts              # Entry point — server init, transport selection
├── constants.ts          # Shared constants (API URL, limits, transport)
├── types.ts              # TypeScript interfaces for API response types
├── services/
│   └── api-client.ts     # Axios HTTP client with bracket-notation array serializer
└── tools/
    ├── documents.ts      # search_documents, get_document_details, list_document_files
    ├── grids.ts          # search_grids, get_grid, get_grid_parents, get_grid_children
    ├── procedures.ts     # search_procedures
    ├── standards.ts      # list_document_models, get_document_model, list_sup_categories, list_du_categories
    └── feature-info.ts   # get_du_at_location, get_sup_at_location, get_scot_at_location, get_features_by_parcel
```
